# Plugin Manifest Reference

The manifest is a YAML file at the plugin root, named anything ending in `.yml` (convention is `<plugin-id>.yml`, e.g. `my-plugin.yml`). The filename root, lowercased exactly as written, is the **plugin ID** that you use later to look up settings via GraphQL (`configuration.plugins[<plugin_id>]`).

## Top-level fields

```yaml
name: My Plugin                        # required: display name in the UI
description: One sentence about it     # optional but recommended
version: 1.0.0                         # optional; free-form string, shown in UI
url: https://github.com/user/repo      # optional; "more info" link in UI

# Plugin-level dependency. Will be auto-installed from the same source.
# requires: <plugin ID>

# UI extensions (browser-side). Optional. Present iff you ship CSS or JS.
ui:
  javascript: [my-plugin.js]
  css:        [my-plugin.css]
  requires:   [CommunityScriptsUILibrary]
  assets:
    /: assets
  csp:
    script-src:  [https://cdn.example.com]
    style-src:   [https://cdn.example.com]
    connect-src: [https://api.example.com]

# User-visible settings. Optional.
settings:
  myKey:
    displayName: My Setting
    description: Explain what it does
    type: BOOLEAN                      # BOOLEAN | NUMBER | STRING

# Backend execution. Optional. Present iff the plugin has tasks or hooks
# that run a script.
exec:
  - python
  - "{pluginDir}/my_plugin.py"
interface: raw                         # raw | rpc | js
errLog: warning                        # default level for unprefixed stderr

# Tasks that show up as buttons on the Plugins page. Optional.
tasks:
  - name: Tag all scenes
    description: Apply default tag to every scene
    defaultArgs:
      mode: tag_all
    execArgs:                          # raw plugins only: extra CLI args
      - "--verbose"

# Hooks fired by Stash events. Optional.
hooks:
  - name: On scene update
    triggeredBy:
      - Scene.Update.Post
      - Scene.Create.Post
    defaultArgs:
      mode: on_event
```

## `ui:` block

`javascript:` and `css:` are lists. Entries are either paths relative to the manifest, or full external URLs (e.g., a CDN). All listed files are loaded on every page of the Stash UI; there is no per-page injection mechanism. Use `PluginApi.Event.addEventListener("stash:location", …)` inside your JS to scope behavior to specific routes.

`ui.requires:` is a list of *other plugin IDs* whose JS/CSS must load **before** this plugin's. Common usage: `requires: [CommunityScriptsUILibrary]` to get the `csLib` helper.

`ui.assets:` maps a URL prefix to a filesystem path relative to the manifest. The mounting point is `/plugin/<plugin-id>/assets/`. For a plugin with `assets: { /: assets, icons: img }`:

```
GET /plugin/my-plugin/assets/icon.png          → <plugin-dir>/assets/icon.png   (via "/")
GET /plugin/my-plugin/assets/icons/x.png       → <plugin-dir>/img/x.png         (via "icons")
```

Attempts to escape the plugin directory (paths with `..`) are silently dropped.

`ui.csp:` adds entries to the browser content security policy. Without this, fetches to third-party domains will be blocked. Use sparingly. Lists are merged with stash's defaults.

## `exec:` field

A list. First element is the executable; subsequent elements are arguments. The executable is searched on `$PATH` first, then in the plugin directory.

For Python plugins:
```yaml
exec:
  - python                      # or python3 on systems where that's the name
  - "{pluginDir}/main.py"
```

For embedded JS:
```yaml
exec:
  - main.js                     # path relative to the manifest
interface: js
```

For compiled binaries:
```yaml
exec:
  - my-plugin                   # the .exe extension is optional on Windows
```

`{pluginDir}` is the only template variable. The working directory at exec time is **the stash process's cwd**, not the plugin directory, so use `{pluginDir}` for any other paths inside the plugin folder.

## `interface:` field

| Value | Meaning |
|---|---|
| `raw` (default) | External binary or script. Stash writes JSON to stdin, reads JSON from stdout, sends `SIGKILL` on stop. |
| `rpc` | External Go binary implementing the `RPCRunner` interface. JSON-RPC. Supports cooperative shutdown. |
| `js` | Embedded goja JavaScript runtime. The `exec[0]` is the JS file path. |

Pick `raw` for Python and most scripting languages. Pick `js` for self-contained plugins with no external dependencies. `rpc` is rare and only useful for Go developers who want long-lived plugin processes.

## `errLog:` field

For `raw` plugins only. Controls the log level used when the plugin writes to stderr without the framing prefix. Defaults to `error`. Valid values: `trace`, `debug`, `info`, `warning`, `error`, `none`. The `stashapi.log` Python module writes properly framed lines, so this field is mostly relevant for plugins that just `print(…, file=sys.stderr)`.

## `settings:` block

The map keys are the setting IDs you'll read at runtime. Each entry has:

```yaml
mySetting:
  displayName: Pretty name shown in UI    # required for it to render
  description: Hover help text             # optional
  type: BOOLEAN                            # required; one of BOOLEAN | NUMBER | STRING
```

Settings declared here render in the Plugins page. Settings written via the `configurePlugin` mutation **don't** need to be declared here, but won't show up in the UI either; this is a useful pattern for hidden per-plugin state.

Note that the order of settings in the UI is alphabetical by key, with no override mechanism. A common community workaround is prefixing rarely-tweaked keys with `z` or `zz` to push them to the bottom (`zzDebug`, `zzDryRun`).

## `tasks:` array

Each entry becomes a button on the plugin's settings card.

```yaml
tasks:
  - name: Cleanup orphans
    description: Removes tags that aren't referenced anywhere
    defaultArgs:
      mode: cleanup
      dryRun: true
```

`defaultArgs` is the contents of the `args` key in the plugin input JSON. Use it to dispatch between modes inside one script (`if args["mode"] == "cleanup": …`).

`execArgs:` is `raw`-only and adds additional CLI arguments to the `exec` list when this specific task fires.

## `hooks:` array

```yaml
hooks:
  - name: On scene create or update
    description: Re-tag the scene
    triggeredBy:
      - Scene.Create.Post
      - Scene.Update.Post
    defaultArgs:
      action: retag
```

When triggered, the plugin runs with the same input shape as a task, **plus** an extra `args.hookContext` field containing `{id, type, input?, inputFields?}`. See `hooks-and-tasks.md` for the full event matrix.

## Mixed manifests

A single plugin can ship UI extensions, hooks, and tasks together. This is the most common pattern for non-trivial plugins. Example:

```yaml
name: Better Studio Page
description: Adds a studios scoreboard and auto-tags new performers on create
version: 1.2.0

ui:
  javascript: [studio-page.js]
  css:        [studio-page.css]

exec:
  - python
  - "{pluginDir}/backend.py"
interface: raw

settings:
  autoTagOnCreate:
    displayName: Auto-tag new performers
    type: BOOLEAN

tasks:
  - name: Rebuild scoreboard cache
    defaultArgs: { mode: rebuild_cache }

hooks:
  - name: Auto-tag on performer create
    triggeredBy: [Performer.Create.Post]
    defaultArgs: { mode: auto_tag }
```

The Python script handles both `mode: rebuild_cache` (from the task) and the hook (which adds `hookContext`), and the UI side is loaded independently in the browser.
