# Python Plugins (raw interface)

Python plugins are the most common backend flavor. The manifest declares `interface: raw` and `exec: [python, "{pluginDir}/script.py"]`. At runtime Stash spawns the Python process, pipes a JSON object to its stdin, and reads stdout for the final result.

## The entry skeleton

This is the shape of every Python plugin. Treat it as the starting point and edit from here:

```python
#!/usr/bin/env python
"""my-plugin: short description."""
import json
import sys

import stashapi.log as log
from stashapi.stashapp import StashInterface


def _get_stash(server_connection: dict) -> StashInterface:
    """Build a StashInterface, remapping 0.0.0.0 to localhost."""
    conn = dict(server_connection)
    if conn.get("Host") == "0.0.0.0":
        conn["Host"] = "localhost"
    return StashInterface(conn)


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw)
    stash = _get_stash(payload["server_connection"])
    args = payload.get("args", {})

    # Dispatch: task (has "mode") vs hook (has "hookContext")
    if "hookContext" in args:
        _on_hook(stash, args["hookContext"], args)
    elif "mode" in args:
        _on_task(stash, args["mode"], args)
    else:
        log.warning("plugin invoked with no mode or hookContext")

    # Emit the final result line. Anything else on stdout will confuse stash.
    print(json.dumps({"output": "ok"}))


def _on_hook(stash, ctx, args):
    entity_id = ctx["id"]
    trigger = ctx["type"]                 # e.g. "Scene.Update.Post"
    log.info(f"hook fired: {trigger} id={entity_id}")
    if trigger == "Scene.Update.Post":
        scene = stash.find_scene(entity_id)
        # ... do something with scene
    # See references/hooks-and-tasks.md for self-trigger prevention.


def _on_task(stash, mode, args):
    log.info(f"task fired: mode={mode}")
    if mode == "tag_all":
        for scene in stash.find_scenes()["scenes"]:
            stash.update_scene({"id": scene["id"], "tag_ids": ["1"]})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log.error(f"plugin crashed: {exc}")
        print(json.dumps({"output": None, "error": str(exc)}))
        sys.exit(1)
```

A few non-obvious things this skeleton encodes:

- `log.*` writes to stderr with stash's framing characters. **Always** use `log.*` for diagnostics, never `print(...)`.
- The final `print(json.dumps({"output": ..., "error": ...}))` is the only thing that should ever go to stdout. Stash parses it as the plugin's result. A garbled stdout shows up in the stash log as a confusing JSON parse error.
- Catch top-level exceptions and emit them as `{"error": "..."}` so the failure is visible in the UI.
- Remap `Host: "0.0.0.0"` before connecting, since stash passes the literal bind address through.

## Plugin input shape

The JSON Stash writes to stdin always has this structure (presented as Python dict):

```python
{
    "server_connection": {
        "Scheme": "http",                    # or "https"
        "Host":   "localhost",                # may be "0.0.0.0"; remap before use
        "Port":    9999,
        "SessionCookie": {"Name": "session", "Value": "..."},  # may be absent
        "ApiKey": "abc123",                    # may be absent
        "Dir":       "/home/user/.stash",
        "PluginDir": "/home/user/.stash/plugins/my-plugin",
    },
    "args": {
        # for a task: exactly the manifest's defaultArgs, e.g. {"mode": "tag_all"}
        "mode": "tag_all",
        # for a hook: defaultArgs merged with this:
        "hookContext": {
            "id":    "45",                     # str
            "type":  "Scene.Update.Post",
            "input":       {...},               # the GraphQL input from the user's action
            "inputFields": ["title", "rating"], # populated on Update; lists which fields were sent
        },
    },
}
```

`SessionCookie` and `ApiKey` may both be absent depending on the stash auth mode. `StashInterface` handles both. Plugins that talk to stash via raw `requests` need to send whichever is present.

## The `stashapi` library

`stashapp-tools` on PyPI (`pip install stashapp-tools`) ships the `stashapi` Python package, which most plugins use. The two universal imports:

```python
import stashapi.log as log
from stashapi.stashapp import StashInterface
```

### `stashapi.log`

Drop-in for stash's stderr framing protocol. Methods (all take a string):

| Method | Level |
|---|---|
| `log.trace(msg)`   | trace |
| `log.debug(msg)`   | debug |
| `log.info(msg)`    | info |
| `log.warning(msg)` | warning |
| `log.error(msg)`   | error |
| `log.progress(0.42)` | sets task progress bar (0.0 to 1.0) |
| `log.exit(msg=None, err=None)` | writes the final `{"output":…, "error":…}` JSON to stdout and `sys.exit()` |
| `log.result(data)` | same as `log.exit` but always treats input as the `output` field |

`log.DISABLE_PROGRESS = True` mutes progress reporting (useful in unit tests).

### `StashInterface`

```python
stash = StashInterface(server_connection_dict)
# or with overrides:
stash = StashInterface({"Scheme":"http","Host":"localhost","Port":9999, "ApiKey":"..."})
```

The constructor performs an initial `version` query to verify connectivity. By default, if a `SessionCookie` is provided it will *also* fetch the API key and switch to API key auth so long-running tasks don't get logged out. Pass `force_api_key=False` to disable.

The methods you'll use most often:

```python
# Raw escape hatch. Use when no helper exists.
stash.call_GQL(query_string, variables={})

# Scenes
stash.find_scene(id, fragment=None)
stash.find_scenes(f={}, filter={}, q="", fragment="", get_count=False)
stash.update_scene({"id": "1", "title": "...", "tag_ids": ["1","2"]})
stash.create_scene({...})
stash.destroy_scene(id, delete_file=False)
stash.merge_scenes(src_ids=[...], dst_id="...", values={...})

# Tags
stash.find_tag("My Tag", create=False)        # accepts name OR id OR dict
stash.find_tags(f={}, filter={}, q="", fragment="")
stash.create_tag({"name": "My Tag"})
stash.update_tag({"id": "1", "name": "Renamed"})
stash.destroy_tag(id)

# Performers, Studios, Galleries (same shape)
stash.find_performer(performer, create=False)
stash.find_studio(studio, create=False)
stash.find_gallery(id, fragment=None)

# Scene markers
stash.find_scene_markers({...})
stash.create_scene_marker({"scene_id":"1","seconds":42.0,"primary_tag_id":"1"})
stash.destroy_scene_marker(id)

# Plugin settings (covered in references/settings.md)
stash.find_plugin_config(plugin_id, defaults={})
stash.find_plugins_config([plugin_id, ...])
stash.configure_plugin(plugin_id, values, init_defaults=False)

# Cross-plugin calls (fires another plugin's task)
stash.run_plugin_task(plugin_id, task_name, args={})

# Metadata jobs (the long-running ones from the Tasks page)
stash.metadata_scan(paths=[...], flags={})
stash.metadata_clean(paths=[...], dry_run=False)
stash.metadata_clean_generated(...)
stash.metadata_identify(sources=[...], paths=[...])
stash.metadata_generate(input={...})
```

All `find_*` methods accept an optional `fragment` string controlling which fields are returned. Default fragments include most fields; pass a custom string to either pull more (`"id title files { path } performers { name }"`) or less.

`find_*` queries return paginated results in a `{"count": N, "scenes": [...]}` shape, matching the GraphQL response.

### Fragment override pattern

The library has a `fragment_overrides` dict that controls how nested objects are serialized; by default deeply nested types reduce to `{id}` to avoid runaway recursion. You can extend it:

```python
stash.fragment_overrides["Scene"] = "id title rating"
```

Useful when you're calling many helper methods and want a consistent fragment across them.

## Dispatching tasks vs hooks

A plugin can do both. The standard idiom:

```python
args = payload["args"]

if "hookContext" in args:
    ctx = args["hookContext"]
    trigger = ctx["type"]              # "Scene.Update.Post" etc.
    target_id = ctx["id"]
    handle_hook(stash, trigger, target_id, ctx)
elif "mode" in args:
    handle_task(stash, args["mode"], args)
else:
    log.warning("no mode or hookContext")
```

Some plugins use `args["mode"]` for both, by setting `mode` in the hook's `defaultArgs` too:

```yaml
hooks:
  - name: On scene create
    triggeredBy: [Scene.Create.Post]
    defaultArgs:
      mode: on_scene_create
```

Then the script's branching is uniformly `if args["mode"] == "..."`.

## Exit protocol and errors

Stash treats the plugin task as successful if:
- The process exits 0, AND
- Either stdout is empty OR stdout's last line is valid JSON of shape `{"output": ..., "error": null}`.

If `"error"` is non-null, the task is marked failed in the UI and the error string appears in the stash log. Exit code != 0 also fails the task. The safest pattern is wrapping `main()` in try/except as in the skeleton above.

For long-running tasks, emit `log.progress(x)` periodically so the UI shows a progress bar. Stash does not currently send a stop signal to raw plugins; the user clicking "Stop Job" results in stash killing the process with `SIGKILL`. There's no way to clean up gracefully. If you need cleanup-on-stop, use the RPC interface instead.

## `requirements.txt`

Ship one. Stash does not auto-install Python deps. A typical file:

```
stashapp-tools>=0.2.50
requests>=2.31
```

The user installs them with `pip install -r requirements.txt` from the plugin directory. Some plugins ship a `ModulesValidate.py` helper that auto-pip-installs missing modules at startup. Useful but optional; calling out the requirements clearly in a README is usually enough.

## When to use raw `requests` instead of stashapi

Almost never. The cases where it makes sense:

1. You don't want a dependency. Then write a tiny GraphQL helper using `urllib.request` (also stdlib).
2. You need streaming/chunked responses (e.g., downloading generated previews via the API). `stashapi` returns parsed JSON only.

The handcrafted version (no deps):

```python
import json
import urllib.request

def gql(server_conn, query, variables=None):
    host = server_conn["Host"]
    if host == "0.0.0.0":
        host = "localhost"
    url = f"{server_conn['Scheme']}://{host}:{server_conn['Port']}/graphql"
    headers = {"Content-Type": "application/json"}
    if server_conn.get("ApiKey"):
        headers["ApiKey"] = server_conn["ApiKey"]
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    if server_conn.get("SessionCookie", {}).get("Value"):
        cookie = server_conn["SessionCookie"]
        req.add_header("Cookie", f"{cookie['Name']}={cookie['Value']}")
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    if "errors" in result:
        raise RuntimeError(result["errors"])
    return result["data"]
```

## Debugging

Stash logs each plugin invocation under `Settings → Logs`. Filter by the plugin's name. `log.info` and friends end up in the same view.

For local development, you can run the script standalone by piping a saved JSON payload:

```bash
echo '{"server_connection":{"Scheme":"http","Host":"localhost","Port":9999,"ApiKey":"..."},"args":{"mode":"tag_all"}}' \
  | python my_plugin.py
```

The output JSON line will go to stdout, log lines to stderr (with the framing characters visible, e.g. `\x01i\x02 message`).
