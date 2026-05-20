---
name: stash-plugin
description: Build, edit, and debug plugins for Stashapp (Stash). Use this skill whenever the user asks to create, modify, or troubleshoot a Stash plugin, theme, hook, scraper task, or UI extension; whenever they mention `stash`, `stashapp`, `stash plugin`, `PluginApi`, `stashapi`, `Scene.Update.Post`, the stash GraphQL API, the `plugins` directory in their stash config, or a plugin `.yml` manifest; or whenever they ask for any kind of automation around their Stash library (auto-tagging on scene update, custom buttons in the UI, bulk operations from the Tasks page, theme tweaks). Trigger even if the user doesn't say "plugin" explicitly, as long as the goal is to extend or automate Stash itself.
---

# Stash Plugin Builder

A skill for writing Stashapp (Stash) plugins from scratch and editing existing ones. Stash plugins extend a self-hosted Stash server in four broad ways: they react to events (hooks), expose buttons in the Tasks page (tasks), inject CSS/JS into the React UI, or do all of the above from one manifest.

Read this whole file before writing code. Then pull the reference file that matches what the user wants, since each plugin flavor has its own runtime, its own gotchas, and its own way of talking to Stash.

## When to use this skill

Use this skill when the user wants to:

- Write a new plugin, theme, or UI tweak for Stash
- Fix or extend an existing plugin (manifest, Python script, embedded JS, or browser JS)
- Generate GraphQL queries/mutations against the Stash schema
- Wire up a hook on `Scene.Update.Post`, `Scene.Create.Post`, etc., or a custom task on the Tasks page
- Patch a built-in Stash UI component (SceneCard, MainNavBar, FrontPage, etc.) via `PluginApi.patch.*`
- Add a new SPA route under `/plugins/<name>` via `PluginApi.register.route`
- Bulk-edit performers, tags, scenes, studios, etc. through the GraphQL API

The skill does not cover the Stash *scraper* system (a separate YAML-driven feature for metadata sources). If the user asks about scrapers, point them at https://docs.stashapp.cc/in-app-manual/scraping/scraperdevelopment/ instead.

## Pick the right plugin flavor first

Stash supports four plugin flavors. Choosing wrong leads to a lot of rework, so decide before writing anything:

| Goal | Flavor | `interface:` | Files |
|---|---|---|---|
| React to events (hooks) using Python | External (raw) | `raw` | `*.yml` + `*.py` |
| Run a task that calls a binary or any non-JS script | External (raw or rpc) | `raw` or `rpc` | `*.yml` + executable |
| Run a small task entirely inside Stash with no extra runtime | Embedded JS | `js` | `*.yml` + `*.js` |
| Modify the UI (add buttons, patch React components, add pages, add CSS) | UI plugin | *(no interface field)* | `*.yml` + `*.js` and/or `*.css` |

One manifest can mix flavors. A UI plugin can also declare hooks and tasks that run a Python script. Most non-trivial plugins do exactly that: a CSS/JS frontend plus a Python backend.

If the user has not told you which flavor they want, ask. Important questions: does the work happen in the browser or in a separate process? Do they want to ship Python (which the user has to install separately) or use the embedded JS runtime (which has no extra install but cannot use libraries like `requests`)? Will the plugin add UI elements or only run from the Tasks page?

## The manifest is the entry point

Every plugin is defined by a single YAML file (`*.yml`) at the plugin root. The filename minus `.yml` becomes the plugin ID used to look up settings at runtime. The basic shape:

```yaml
name: My Plugin
description: One sentence about what it does
version: 1.0.0
url: https://github.com/user/repo

# --- pick the relevant blocks below ---

# UI extensions (browser-side)
ui:
  javascript:
    - my-plugin.js
  css:
    - my-plugin.css
  requires:
    - CommunityScriptsUILibrary    # optional helper lib
  assets:
    /: assets                       # map plugin-dir/assets/* to /plugin/my-plugin/assets/*
  csp:
    connect-src:
      - https://api.example.com

# Backend tasks (external Python OR embedded JS)
exec:
  - python
  - "{pluginDir}/my_plugin.py"
interface: raw                      # raw | rpc | js
errLog: warning                     # default level for unprefixed stderr lines

# User-visible settings (rendered on the plugins page)
settings:
  dryRun:
    displayName: Dry Run
    description: Log changes without applying them
    type: BOOLEAN
  maxScenes:
    displayName: Maximum scenes
    type: NUMBER

# Tasks shown in Settings > Tasks
tasks:
  - name: Tag all scenes
    description: Adds the Auto-Tagged tag to every scene
    defaultArgs:
      mode: tag_all

# Hooks triggered by Stash events
hooks:
  - name: On scene update
    triggeredBy:
      - Scene.Update.Post
      - Scene.Create.Post
```

See `references/manifest.md` for the full field reference, including the `metadata`, `requires` (plugin-level dependency), `assets` URL rewriting rules, and content-security-policy overrides.

## How a plugin talks to Stash

There are three transport layers, and each plugin flavor uses one or two:

1. **Python (raw) plugins** read a JSON object from stdin (`{server_connection, args}`), then call the Stash GraphQL API at `<scheme>://<host>:<port>/graphql` using the session cookie or API key from `server_connection`. The community library `stashapp-tools` (imports as `stashapi`) wraps this. See `references/python-plugins.md`.
2. **Embedded JS** plugins call `gql.Do(query, variables)` directly. The runtime is goja (ES5), no `fetch`, no `Promise`, no DOM. See `references/embedded-js-plugins.md`.
3. **UI plugins** run in the browser SPA. Use `window.PluginApi` (React, GQL hooks, patch system, route registration) or the lower-level `csLib` helper or raw `fetch('/graphql')`. See `references/js-ui-plugins.md`.

Every flavor ends up sending the same GraphQL. The common queries and mutations (findScenes with filter modifiers, sceneUpdate, tagCreate, metadataScan, configuration plugins lookup) are collected in `references/graphql-cookbook.md`. Pull that file whenever you're writing a query you haven't written before, since the Stash schema has a lot of subtle naming (e.g. `studio_id` vs `studio { id }`, `tag_ids` is write-only).

## Hooks and tasks: the event surface

If the plugin reacts to user activity in Stash, it needs hooks. Hook trigger names follow `<Object>.<Operation>.Post`, where Object is one of `Scene`, `SceneMarker`, `Image`, `Gallery`, `Group`, `Performer`, `Studio`, `Tag` and Operation is one of `Create`, `Update`, `Destroy` (plus `Merge` for `Tag` only). Only `Post` hooks exist today, fired after the operation commits.

For tasks, each entry under `tasks:` becomes a button on the plugins page. `defaultArgs` populates `args` in the plugin input, which is how you dispatch between modes inside one script.

The full event matrix, the exact shape of `hookContext`, and the self-trigger footgun (a `Scene.Update.Post` hook that calls `sceneUpdate` will re-fire itself, so always guard) are documented in `references/hooks-and-tasks.md`. Read it before writing any hook that mutates the entity that triggered it.

## Settings

Settings declared in the manifest show up in the plugin settings UI. They are stored in `configuration.plugins[<plugin_id>]` and you read them at runtime with a GraphQL query (`query { configuration { plugins } }`) or with `stash.find_plugin_config(plugin_id)` if using `stashapi`.

Two gotchas to remember and document in the code:

- Settings won't exist in the configuration map until the user opens the plugin settings panel and saves once. Always default missing values in the script.
- The plugin ID for settings lookup is the manifest filename without `.yml`, case-sensitive. If your file is `My-Plugin.yml`, the key is `My-Plugin`.

Full lifecycle in `references/settings.md`.

## UI plugin essentials

UI plugins inject `<script>` and `<link>` tags into Stash's React SPA. The two ways to do real work are:

1. **`window.PluginApi`**: the official, supported surface. Patch built-in components (`PluginApi.patch.before/instead/after`), register routes (`PluginApi.register.route`), listen for events (`PluginApi.Event.addEventListener("stash:location", …)`), use React via `PluginApi.React`. Components are populated *after* your script first runs, so destructure them inside the FC body, not at module scope.
2. **`csLib`**: community helper that exposes `PathElementListener(path, selector, callback)` and `callGQL({query, variables})`. Requires declaring `requires: [CommunityScriptsUILibrary]` in the manifest. Good for DOM-mutation-style plugins (insert a button next to existing elements).

For pure CSS themes, just ship CSS and skip JS entirely. Selectors should be specific (`.scene-card__details`, not `.details`) because the SPA uses Bootstrap class names broadly.

The full list of patchable components, the event types, and a working `PluginApi.patch.instead` example are in `references/js-ui-plugins.md`.

## Working examples

Three minimal but complete plugins are in `examples/`. Open them to see how everything fits together:

- `examples/hook-python-tag-on-update/`: a Python plugin with one hook and one task. Adds a tag on scene update, and ships a "Tag everything" task. Uses `stashapi`, settings, and proper exit JSON.
- `examples/ui-patch-scene-card/`: a UI plugin that patches `SceneCard.Details` to add a custom overlay using `PluginApi.patch.after`, plus a small CSS file. No build step required.
- `examples/embedded-js-task/`: an embedded-JS plugin (no Python, no Node) that ships one task. Demonstrates `gql.Do`, `log.Progress`, and pagination.

When starting a new plugin, copy the closest example and edit. The manifests are heavily commented.

## Standard workflow when the user asks for a plugin

1. Confirm the flavor (UI / hook / task / mixed). Ask if unclear.
2. Decide the plugin ID and directory name. Use kebab-case for the directory and a clear `name:` field in the manifest.
3. Copy the closest example from `examples/` into a new folder.
4. Edit the manifest first: set `name`, `description`, `version`, declare hooks/tasks/settings.
5. Write the script. Pull the relevant reference file before writing GraphQL.
6. Test by zipping the plugin directory and dropping it in `~/.stash/plugins/<plugin-id>/`, or by adding it to a custom source `index.yml`.
7. Tell the user the next step is **Settings → Plugins → Reload Plugins** in the Stash UI.

## Installation notes for the user

Plugins live in `~/.stash/plugins/` (or `%USERPROFILE%\.stash\plugins\` on Windows). Each plugin is one folder containing the `*.yml` manifest and any scripts/assets. Stash discovers them on startup and reloads via the **Reload Plugins** button. To publish a plugin so it can be installed via a source URL, the user needs to package the folder into a `.zip` and host an `index.yml` source manifest. See the Stash docs at https://docs.stashapp.cc/plugins/ for the source format.

For Python plugins, the user must `pip install` dependencies themselves. Always ship a `requirements.txt` alongside the script and mention it in the plugin README. The most common dependency is `stashapp-tools` (the `stashapi` library).

## Things to avoid

A few patterns reliably break plugins. Watch for them in user-supplied code and don't write them yourself:

- **Printing debug to stdout from a Python plugin.** Stash parses stdout as the plugin's JSON output. Anything that isn't `{"output": …, "error": …}` confuses the task runner. Use `stashapi.log` (writes to stderr with the right framing) or print to stderr.
- **Looping hook triggers.** A hook that mutates its own object via `sceneUpdate` will retrigger itself. Guard with an `organized` flag, a tag, or a "did anything actually change" comparison.
- **Assuming `server_connection.Host` is `localhost`.** When Stash binds to `0.0.0.0` it passes that literal string. Always remap to `localhost` or `127.0.0.1` before building URLs.
- **Destructuring `PluginApi.components` at module top.** The components dict is populated after your script first executes. Pull components inside the React FC body or use `PluginApi.hooks.useLoadComponents`.
- **Using browser JS features in embedded JS plugins.** No `fetch`, no `async/await`, no `Promise`, no template literals in some goja builds. Stick to ES5 idioms.
- **Hardcoding paths or stash URLs.** Use `server_connection` (Python) or `gql.Do` (embedded JS); never assume `localhost:9999`.

## Reference files

Read these files as you need them. They are not loaded automatically.

- `references/manifest.md`: Full YAML manifest field reference with examples
- `references/python-plugins.md`: Python entry skeleton, stdin parsing, the `stashapi` library, exit protocol
- `references/js-ui-plugins.md`: `PluginApi` surface, patchable components, `csLib`, lifecycle
- `references/embedded-js-plugins.md`: goja runtime, `input`/`log`/`gql`/`util` globals, ES5 constraints
- `references/hooks-and-tasks.md`: Trigger names, `hookContext` shape, task `defaultArgs` dispatch, self-trigger guards
- `references/graphql-cookbook.md`: Common queries and mutations against the Stash GraphQL schema
- `references/settings.md`: Declaring, reading, writing plugin settings

Pick the reference that matches the work in front of you. Don't read all of them at the start, because the bodies are detailed and you'll just waste context.
