# Hooks and Tasks

Hooks and tasks are how a plugin gets invoked. They're declared in the manifest and both end up calling the same script with a JSON payload on stdin (or as `input.Args` for embedded JS).

The difference: **tasks** are user-initiated (buttons on the plugin settings card), **hooks** are event-initiated (fired automatically when a user performs some action in the Stash UI).

## Hook trigger names

Trigger names use the format `<ObjectType>.<Operation>.<Phase>`. Only `Post` is currently supported.

### Object types

| Type | What it represents |
|---|---|
| `Scene` | A video scene |
| `SceneMarker` | A timecoded marker inside a scene |
| `Image` | An image asset |
| `Gallery` | A gallery (folder or zip of images) |
| `Group` | A "group" entity (formerly called "movie") |
| `Performer` | A performer |
| `Studio` | A studio |
| `Tag` | A tag |

### Operations

| Operation | Fires when | Notes |
|---|---|---|
| `Create` | The entity is created via mutation OR discovered via a scan | `input` may be `nil` for scan-driven creations |
| `Update` | The entity is updated via mutation | `input` contains the GraphQL input; `inputFields` lists which fields were sent |
| `Destroy` | The entity is deleted | `input.id` and possibly `input.delete_file` |
| `Merge` | Two entities are merged | **Tag only.** `input` contains `source` and `destination` |

### Common combinations

A non-exhaustive list of trigger names you'll see in real plugins:

```
Scene.Create.Post
Scene.Update.Post
Scene.Destroy.Post
SceneMarker.Create.Post
SceneMarker.Update.Post
SceneMarker.Destroy.Post
Image.Create.Post
Image.Update.Post
Image.Destroy.Post
Gallery.Create.Post
Gallery.Update.Post
Gallery.Destroy.Post
Group.Create.Post
Group.Update.Post
Group.Destroy.Post
Performer.Create.Post
Performer.Update.Post
Performer.Destroy.Post
Studio.Create.Post
Studio.Update.Post
Studio.Destroy.Post
Tag.Create.Post
Tag.Update.Post
Tag.Destroy.Post
Tag.Merge.Post
```

## Hook manifest

```yaml
hooks:
  - name: Re-tag on scene update
    description: Add the Reviewed tag to any updated scene
    triggeredBy:
      - Scene.Create.Post
      - Scene.Update.Post
    defaultArgs:                       # optional; merged into args
      mode: retag
```

One hook entry can list multiple triggers. Multiple hook entries can fire from the same trigger; they all run.

## `hookContext` shape

When a hook fires, the plugin receives the usual input object plus `args.hookContext`:

```json
{
  "id": "45",
  "type": "Scene.Update.Post",
  "input": { "id": "45", "title": "...", "tag_ids": ["21"], "...": null },
  "inputFields": ["id", "title", "tag_ids"]
}
```

| Field | Meaning |
|---|---|
| `id` | The entity ID, as a string |
| `type` | The trigger name (e.g. `"Scene.Update.Post"`) |
| `input` | The GraphQL input that was passed to the mutation. May be `nil` for scan/clean-driven hooks. |
| `inputFields` | For Update hooks: the list of input fields that were actually sent. Useful to distinguish "field set to null" (cleared) from "field not in the request" (untouched). |

### Reading `input` carefully

In `Scene.Update.Post`, you might see:

```json
"input": {
  "id": "45",
  "title": null,
  "tag_ids": ["21"],
  "studio_id": null,
  "..."
}
```

A `null` value means either "user cleared this field" or "user didn't touch this field". The `inputFields` array disambiguates: if `"title"` is in `inputFields` and `input.title` is `null`, the user cleared it. If `"title"` is not in `inputFields`, it was unchanged.

## Self-trigger prevention

This is the single most important hook gotcha. Stash uses HTTP cookies to track plugin context and won't re-fire a hook that has already run in the same operation chain, **but only if your plugin sends cookies on its outgoing GraphQL calls**. If you use the `stashapi` library, it does the right thing. If you write raw `requests` or `urllib` code, you must propagate cookies/api-key from `server_connection`.

Even with cookie propagation, design hooks defensively:

1. **No-op when nothing changed.** Read the current entity state before mutating; if your computed update equals the current state, return without writing.
2. **Use a marker.** Tag the entity (e.g. with a tag named `__processed_by_my_plugin`) once you've handled it, then skip on subsequent hooks.
3. **Use the `organized` flag.** Many community plugins skip scenes where `scene.organized == true`, treating "organized" as "the user explicitly finalized this, leave it alone".
4. **Check `input` / `inputFields` and bail out on irrelevant changes.** If your hook only cares about title changes, `if "title" not in ctx["inputFields"]: return`.

Example guard for a rename-on-update plugin:

```python
def on_scene_update(stash, scene_id, ctx):
    scene = stash.find_scene(scene_id)
    new_filename = build_filename(scene)
    current = scene["files"][0]["path"].split("/")[-1]
    if current == new_filename:
        log.debug("no rename needed")
        return                                  # important: prevents loop
    do_rename(stash, scene, new_filename)
```

## Task manifest

```yaml
tasks:
  - name: Clean up orphan tags
    description: Remove tags with zero usage
    defaultArgs:
      mode: cleanup
      dryRun: true
    execArgs:                          # raw plugins only; extra CLI args
      - "--verbose"
```

`defaultArgs` flows into `args` in the plugin input. The standard idiom is to use a single `mode` key to dispatch:

```python
mode = args["mode"]
if   mode == "cleanup":         _cleanup(stash, args.get("dryRun", False))
elif mode == "rebuild_cache":   _rebuild_cache(stash)
elif mode == "test":            _test(stash)
```

A plugin can declare any number of tasks. Each shows up as a separate button on the Plugins page.

## Calling another plugin's task

A plugin can fire another plugin's task via `stash.run_plugin_task(plugin_id, task_name, args)` (Python) or the equivalent GraphQL mutation. Useful for chaining (e.g. "after I finish, also run the Scan task") or for self-restart patterns.

```python
stash.run_plugin_task("other-plugin", "Cleanup", {"mode": "cleanup", "dryRun": False})
```

## Job lifecycle and progress

Tasks and hooks both run as **jobs** in the Stash job queue. They appear in the Jobs panel with the plugin's `name` and the task's `name`.

For long-running work:

- Call `log.progress(0.42)` (Python) or `log.Progress(0.42)` (embedded JS) periodically. Stash uses this to render the progress bar.
- Hooks usually shouldn't take long. Stash does not block the user-initiated mutation on the hook completing, but excessive hook duration causes the job queue to back up under heavy editing.
- There is no graceful stop signal for `raw` plugins. When the user clicks "Stop Job", stash sends `SIGKILL`. Plan for non-graceful interruption: write checkpoints to disk if needed.

## Scan and clean integration

Hooks fire from scans too, but with one quirk: `hookContext.input` is `null` because scan operations don't have a GraphQL input mutation. The hook still fires with `id` and `type`. Plugins that need to detect "was this from a scan vs. a UI edit" can check `input is None`:

```python
if ctx.get("input") is None:
    log.info("scan-driven create, skipping noisy enrichment")
    return
```

## Order of hook execution

When multiple plugins listen for the same trigger, they run in some order (alphabetical by plugin name, in practice). Don't rely on this. If your plugin needs to run after another, document it but assume order is not guaranteed.

## Example: a typical hook + task plugin

A plugin that auto-tags new scenes and also ships a "tag everything" task:

```yaml
name: Auto-Tagger
description: Tag scenes on create + bulk task
version: 1.0.0
exec: [python, "{pluginDir}/auto_tag.py"]
interface: raw
settings:
  tagName:
    displayName: Tag to apply
    type: STRING
tasks:
  - name: Tag all scenes
    defaultArgs: { mode: tag_all }
hooks:
  - name: Auto-tag new scenes
    triggeredBy: [Scene.Create.Post]
    defaultArgs: { mode: tag_one }
```

The script then dispatches uniformly on `mode`:

```python
mode = args["mode"]
if mode == "tag_one":
    sid = args["hookContext"]["id"]
    apply_tag(stash, sid)
elif mode == "tag_all":
    for s in stash.find_scenes()["scenes"]:
        apply_tag(stash, s["id"])
```

This is a useful pattern: the hook just calls the same code path the task does, scoped to one entity.
