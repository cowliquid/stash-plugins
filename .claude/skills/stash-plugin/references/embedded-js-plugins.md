# Embedded JS Plugins (goja runtime)

Embedded JS plugins run inside the Stash Go process using the [goja](https://github.com/dop251/goja) JavaScript engine. They are the lightest-weight plugin flavor: no external runtime, no installation step, just a `.js` file referenced by the manifest. The tradeoff is that you get a restricted ES5-ish environment with no DOM, no `fetch`, no `Promise`, no `async`/`await`.

Use them for short server-side tasks (bulk operations, simple hooks) where pulling in Python feels heavy.

## Manifest

```yaml
name: My Embedded Plugin
description: Adds a tag to every untagged scene
version: 1.0.0
exec:
  - my-plugin.js
interface: js
tasks:
  - name: Tag untagged scenes
    defaultArgs:
      mode: tag_untagged
```

Note: `exec` is a single-element list pointing at the JS file relative to the manifest. Path-template `{pluginDir}` is not needed (and not substituted) for the `js` interface.

## The runtime

Inside the script, four global objects are available:

| Global | Purpose |
|---|---|
| `input` | The plugin input. `input.Args` holds the args object (manifest `defaultArgs` + `hookContext` if applicable). Note the capital `A`: `Args`, not `args`. |
| `log` | Logging methods (see below). |
| `gql` | `gql.Do(query, variables?)` runs GraphQL against the parent stash; returns the `data` field. |
| `util` | Currently just `util.Sleep(ms)` for synchronous sleep. |

The script's evaluated value is the plugin output. Three equivalent ways to return:

```js
// 1. IIFE
(function() {
  doWork();
  return { Output: "done" };
})();
```

```js
// 2. Named function + trailing call
function main() {
  doWork();
  return { Output: "done" };
}
main();
```

```js
// 3. Trailing expression
var result = doWork();
({ Output: result });
```

Output shape: `{Output: <anything serializable>}` for success, `{Error: "msg"}` for failure (note capital E, capital O).

## `input.Args`

For a **task**, `input.Args` equals the manifest's `defaultArgs`:

```yaml
tasks:
  - name: Bulk tag
    defaultArgs: { mode: tag_all, tag_id: "5" }
```

```js
log.Info("mode = " + input.Args.mode);     // "tag_all"
log.Info("tag id = " + input.Args.tag_id); // "5"
```

For a **hook**, `input.Args.hookContext` holds the event metadata, alongside any `defaultArgs`:

```js
var ctx = input.Args.hookContext;
if (ctx.type === "Scene.Update.Post") {
  var sceneId = ctx.id;
  // ...
}
```

`input.ServerConnection` exists but is rarely needed; the script runs in-process so `gql.Do` already targets the right server.

## `log` methods

```js
log.Trace("…");
log.Debug("…");
log.Info("…");
log.Warning("…");        // note: Warning, not Warn
log.Error("…");
log.Progress(0.5);       // 0..1 progress bar; required for long tasks
```

## `gql.Do` patterns

`gql.Do(query, variables)` is synchronous. Returns the `data` object (errors throw).

```js
// Find scenes (paginated)
function listAllScenes() {
  var all = [];
  var page = 1;
  while (true) {
    var data = gql.Do(
      "query($filter: FindFilterType!) { findScenes(filter: $filter) { count scenes { id title } } }",
      { filter: { per_page: 100, page: page } }
    );
    all = all.concat(data.findScenes.scenes);
    if (data.findScenes.scenes.length < 100) break;
    page++;
  }
  return all;
}

// Update a scene
function tagScene(id, tagId) {
  var mutation = "mutation($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }";
  gql.Do(mutation, { input: { id: id, tag_ids: [tagId] } });
}

// Find or create a tag
function ensureTag(name) {
  var existing = gql.Do(
    "query { findTags(tag_filter: { name: { value: \"" + name + "\", modifier: EQUALS } }) { tags { id name } } }"
  );
  if (existing.findTags.tags.length > 0) return existing.findTags.tags[0].id;
  var created = gql.Do(
    "mutation($input: TagCreateInput!) { tagCreate(input: $input) { id } }",
    { input: { name: name } }
  );
  return created.tagCreate.id;
}
```

Multi-line strings are awkward in ES5. Either keep queries on one line (as above), or build them with `+` concatenation:

```js
var q = "" +
  "query findScenes($filter: FindFilterType!) {" +
  "  findScenes(filter: $filter) {" +
  "    count" +
  "    scenes { id title }" +
  "  }" +
  "}";
```

## A complete embedded-JS plugin

`my-plugin.yml`:
```yaml
name: Bulk Auto-Tag
description: Adds a default tag to every scene without one
version: 1.0.0
exec:
  - bulk-auto-tag.js
interface: js
settings:
  tagName:
    displayName: Tag to add
    type: STRING
tasks:
  - name: Run
    defaultArgs: { mode: run }
```

`bulk-auto-tag.js`:
```js
function getSetting() {
  var data = gql.Do("query { configuration { plugins } }");
  var p = data.configuration.plugins["my-plugin"] || {};
  return p.tagName || "Auto-Tagged";
}

function ensureTag(name) {
  var found = gql.Do(
    'query { findTags(tag_filter: { name: { value: "' + name + '", modifier: EQUALS } }) { tags { id } } }'
  );
  if (found.findTags.tags.length) return found.findTags.tags[0].id;
  var created = gql.Do(
    "mutation($input: TagCreateInput!) { tagCreate(input: $input) { id } }",
    { input: { name: name } }
  );
  return created.tagCreate.id;
}

function main() {
  if (input.Args.mode !== "run") return { Output: "no-op" };

  var tagId = ensureTag(getSetting());
  var page = 1;
  var processed = 0;
  while (true) {
    var data = gql.Do(
      "query($f: FindFilterType!) { findScenes(filter: $f) { count scenes { id tags { id } } } }",
      { f: { per_page: 50, page: page } }
    );
    var scenes = data.findScenes.scenes;
    if (!scenes.length) break;

    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      if (s.tags.length > 0) continue;
      gql.Do(
        "mutation($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }",
        { input: { id: s.id, tag_ids: [tagId] } }
      );
      processed++;
    }

    log.Progress(Math.min((page * 50) / data.findScenes.count, 1));
    if (scenes.length < 50) break;
    page++;
  }
  return { Output: "tagged " + processed + " scenes" };
}

main();
```

## Limitations and idioms

- **No `Promise`, no `async`, no `await`.** Everything is synchronous, including `gql.Do`. Long-running tasks block until they finish; that's fine because stash runs them off the main request loop.
- **No `fetch`, no HTTP libraries.** You can only talk to the parent stash via `gql.Do`. To hit external APIs, use a raw Python plugin instead.
- **No `console.log`.** Use `log.Info(…)`. Lines printed to stdout disappear.
- **No template literals in older builds.** Some goja versions don't support backticks. Use `"a" + b + "c"` to be safe.
- **No `JSON.stringify` of complex objects with non-enumerable props.** Stick to plain objects and arrays.
- **Top-level `let`/`const` are accepted in recent goja builds but `var` is the lowest-common-denominator choice.** The community plugins almost universally use `var`.

## When to use embedded JS vs Python

| Use embedded JS when… | Use Python when… |
|---|---|
| The task is "for each X, mutate Y" loops over GraphQL | You need third-party libs (`requests`, `Pillow`, `ffmpeg-python`) |
| You don't want users to install anything | You want to call external APIs |
| Logic fits in a few hundred lines | The work is complex or needs unit tests |
| You're shipping a community plugin and want zero-friction install | You need filesystem access beyond what stash exposes |

Both flavors hit the same GraphQL schema and have access to the same data, so the choice is purely about runtime ergonomics.
