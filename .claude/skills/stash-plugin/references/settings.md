# Settings

Plugin settings let users configure behavior from the Stash UI without editing files. They flow through three places:

1. **Manifest** declares them (the schema and UI).
2. **Stash storage** holds the values (under `configuration.plugins[<plugin_id>]`).
3. **Plugin script** reads them at runtime.

## Declaring settings

In the manifest:

```yaml
settings:
  dryRun:
    displayName: Dry Run
    description: Log changes without applying them
    type: BOOLEAN
  tagName:
    displayName: Tag to apply
    description: The tag added by the auto-tagger
    type: STRING
  batchSize:
    displayName: Maximum scenes per run
    type: NUMBER
```

Each entry has:
- `displayName` (required for the setting to render in the UI)
- `description` (optional; hover help)
- `type` (`BOOLEAN`, `STRING`, or `NUMBER`)

The key (e.g. `dryRun`) is what you use to read the value at runtime. Settings are sorted alphabetically by key in the UI, with no override mechanism. A common workaround is prefixing rarely-tweaked keys with `z` or `zz` to push them to the bottom (`zzDebugTracing`, `zzDryRun`).

## Reading settings at runtime

### From Python (with `stashapi`)

```python
config = stash.find_plugin_config("my-plugin")
dry_run    = config.get("dryRun", False)
tag_name   = config.get("tagName", "Auto-Tagged")
batch_size = config.get("batchSize", 100)
```

The first argument is the **plugin ID**, which is the manifest filename minus `.yml`, case-sensitive. If your manifest is `My-Plugin.yml`, the ID is `My-Plugin`.

`find_plugin_config` returns an empty dict if the user hasn't saved settings yet. Always provide defaults via `dict.get`.

You can also pass defaults that get persisted server-side on first read:
```python
config = stash.find_plugin_config("my-plugin", defaults={
    "dryRun": False,
    "tagName": "Auto-Tagged",
    "batchSize": 100,
})
```
This initializes missing keys in stash's storage. Useful for surfacing the defaults in the settings UI on first install.

### From Python (raw GraphQL)

```python
data = stash.call_GQL("query { configuration { plugins } }")
all_plugin_configs = data["configuration"]["plugins"] or {}
mine = all_plugin_configs.get("my-plugin", {})
dry_run = mine.get("dryRun", False)
```

### From embedded JS

```js
function getSettings() {
  var data = gql.Do("query { configuration { plugins } }");
  var plugins = data.configuration.plugins || {};
  var mine = plugins["my-plugin"] || {};
  return {
    dryRun:    mine.dryRun    || false,
    tagName:   mine.tagName   || "Auto-Tagged",
    batchSize: mine.batchSize || 100,
  };
}
```

### From a browser UI plugin

Same query, fetched via `PluginApi.GQL` or `csLib.callGQL`:
```js
const data = await csLib.callGQL({ query: "query { configuration { plugins } }" });
const mine = data.configuration.plugins?.["my-plugin"] || {};
```

## Writing settings

Plugins can update their own settings (or another plugin's) via the `configurePlugin` mutation.

### From Python

```python
stash.configure_plugin("my-plugin", {"dryRun": True, "tagName": "Auto"})
```

The `init_defaults=True` flag only writes keys that aren't already set:
```python
stash.configure_plugin("my-plugin", {"dryRun": False}, init_defaults=True)
```

### Raw GraphQL

```graphql
mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) {
  configurePlugin(plugin_id: $plugin_id, input: $input)
}
```
Variables: `{"plugin_id": "my-plugin", "input": {"dryRun": true}}`.

## Hidden settings (not declared in manifest)

You can write to `configuration.plugins[<plugin_id>]` without declaring the key in `settings:`. The value persists but won't render in the UI. This is the standard pattern for per-plugin state that the user shouldn't see: last-run timestamp, cached IDs, internal counters:

```python
# Stash per-plugin state without polluting the settings UI.
stash.configure_plugin("my-plugin", {"_lastRunAt": time.time(), "_cache": {...}})
```

The underscore prefix is just a community convention to signal "internal".

## Gotchas

**Settings don't exist until the user opens the settings panel and saves once.** Reading before that returns an empty dict. Always default missing values.

**Plugin ID is case-sensitive.** `my-plugin.yml` → `"my-plugin"`, not `"My-Plugin"` or `"myplugin"`. The simplest debugging trick is to dump the entire `configuration.plugins` map and inspect the actual keys.

**Type coercion is loose.** The `type: NUMBER` field is stored as JSON, so it may come back as `int` or `float` depending on the user's input. Coerce defensively:
```python
batch_size = int(config.get("batchSize", 100))
```

**Booleans can be null.** If the user has never toggled a `BOOLEAN` setting, the value may be `None` rather than `False`. Use `bool(config.get(key) or False)`.

**Order in the UI is alphabetical.** No override. Use prefixes (`a_`, `z_`, `zz_`) to control grouping if it matters.

**Settings are global per plugin instance, not per user.** Stash is single-user, so this is rarely an issue, but worth knowing.

## Bootstrap pattern

A complete settings-aware plugin entry, in Python:

```python
import json, sys
import stashapi.log as log
from stashapi.stashapp import StashInterface

DEFAULTS = {
    "dryRun":    False,
    "tagName":   "Auto-Tagged",
    "batchSize": 100,
}

def get_settings(stash):
    cfg = stash.find_plugin_config("my-plugin", defaults=DEFAULTS) or {}
    return {
        "dryRun":    bool(cfg.get("dryRun")    or DEFAULTS["dryRun"]),
        "tagName":   str(cfg.get("tagName")    or DEFAULTS["tagName"]),
        "batchSize": int(cfg.get("batchSize")  or DEFAULTS["batchSize"]),
    }

def main():
    payload = json.loads(sys.stdin.read())
    conn = payload["server_connection"]
    if conn.get("Host") == "0.0.0.0": conn["Host"] = "localhost"
    stash = StashInterface(conn)

    s = get_settings(stash)
    log.info(f"running with settings={s}")

    # ... rest of the plugin

    print(json.dumps({"output": "ok"}))

if __name__ == "__main__":
    main()
```

This shape (named DEFAULTS, helper that coerces types, called from main) is robust and easy to extend as the manifest grows.
