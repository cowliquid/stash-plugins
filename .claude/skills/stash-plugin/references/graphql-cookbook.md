# GraphQL Cookbook

Real queries and mutations against the Stash schema, copied from working community plugins. Use these as the starting point for new code instead of guessing field names.

## Endpoint and auth

Endpoint: `<scheme>://<host>:<port>/graphql` (typically `http://localhost:9999/graphql`).

Headers for auth:
- `ApiKey: <key>`: preferred. Get the key from `Settings → Security → Authentication`.
- `Cookie: session=<value>`: legacy, used when stash is in username/password mode.

Sending both headers is harmless. Plugins typically forward whatever appears in `server_connection`.

## Schema introspection

The full schema is browsable at `Settings → Tools → GraphQL Playground`. Click the "Docs" button on the right side. The schema is large; the cookbook below covers what plugins use 90% of the time.

## Reading the Stash configuration (for paths and plugin settings)

```graphql
query Config {
  configuration {
    general {
      stashes { path }              # library root paths
      databasePath
      generatedPath
    }
    plugins                          # all plugin settings, keyed by plugin ID
  }
}
```

Plugins use this to find library paths (for filesystem operations) and to read their own settings (under `plugins.<plugin_id>`).

## Scenes

### Find scenes (paginated)

```graphql
query FindScenes($filter: FindFilterType!, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) {
    count
    scenes {
      id
      title
      details
      date
      rating100
      organized
      files { path size duration video_codec audio_codec width height }
      tags       { id name }
      performers { id name }
      studio     { id name }
      galleries  { id }
      groups     { group { id name } }
    }
  }
}
```

Variables:
```json
{
  "filter": { "per_page": 100, "page": 1, "sort": "date", "direction": "DESC" },
  "scene_filter": {
    "has_markers":     { "value": false, "modifier": "EQUALS" },
    "tags":            { "value": ["1","2"], "modifier": "INCLUDES_ALL" },
    "studios":         { "value": ["5"],     "modifier": "INCLUDES" },
    "organized":       false,
    "title":           { "value": "foo", "modifier": "INCLUDES" }
  }
}
```

Filter modifiers: `EQUALS`, `NOT_EQUALS`, `INCLUDES`, `INCLUDES_ALL`, `EXCLUDES`, `IS_NULL`, `NOT_NULL`, `GREATER_THAN`, `LESS_THAN`, `BETWEEN`, `NOT_BETWEEN`.

Sort field accepts `date`, `title`, `rating`, `random`, `created_at`, `updated_at`, `path`, `duration`, etc.

### Find one scene

```graphql
query FindScene($id: ID!) {
  findScene(id: $id) {
    id title details date rating100 organized
    files { path }
    tags { id name }
    performers { id name }
    studio { id name }
  }
}
```

### Update a scene

```graphql
mutation SceneUpdate($input: SceneUpdateInput!) {
  sceneUpdate(input: $input) { id }
}
```

`SceneUpdateInput` is "all fields optional, only the ones you set will change":
```json
{
  "input": {
    "id": "45",
    "title": "New Title",
    "details": "Long description.",
    "date": "2024-12-01",
    "rating100": 75,
    "organized": true,
    "studio_id": "5",
    "tag_ids":       ["1","2"],     // replaces the entire tag list
    "performer_ids": ["10","11"],   // replaces the entire performer list
    "gallery_ids":   ["3"],
    "groups": [{ "group_id": "1", "scene_index": 1 }],
    "stash_ids": [{ "endpoint": "https://stashdb.org/graphql", "stash_id": "..." }],
    "url": "https://example.com",
    "code": "SC123"
  }
}
```

Watch out: `tag_ids`, `performer_ids`, etc. are **replacement** lists. To "add a tag", first read the existing list and concatenate:

```python
scene = stash.find_scene(scene_id)
existing_tag_ids = [t["id"] for t in scene["tags"]]
new_tags = list(set(existing_tag_ids + [new_tag_id]))
stash.update_scene({"id": scene_id, "tag_ids": new_tags})
```

### Bulk update scenes

```graphql
mutation BulkSceneUpdate($input: BulkSceneUpdateInput!) {
  bulkSceneUpdate(input: $input) { id }
}
```

`BulkSceneUpdateInput` accepts `ids` plus modifiers (`tag_ids: { mode: ADD, ids: [...] }`; modes are `SET | ADD | REMOVE`). Useful when applying the same change to many scenes.

### Destroy a scene

```graphql
mutation SceneDestroy($input: SceneDestroyInput!) {
  sceneDestroy(input: $input)
}
```

Variables:
```json
{ "input": { "id": "45", "delete_file": false, "delete_generated": true } }
```

## Tags

### Find or list

```graphql
query FindTags($filter: FindFilterType, $tag_filter: TagFilterType) {
  findTags(filter: $filter, tag_filter: $tag_filter) {
    count
    tags { id name aliases description }
  }
}
```

Find by name (exact match):
```json
{ "tag_filter": { "name": { "value": "Foo", "modifier": "EQUALS" } } }
```

### Create

```graphql
mutation TagCreate($input: TagCreateInput!) {
  tagCreate(input: $input) { id }
}
```
```json
{ "input": { "name": "Foo", "aliases": ["foo","f"], "description": "..." } }
```

### Update / destroy

```graphql
mutation TagUpdate($input: TagUpdateInput!)  { tagUpdate(input: $input) { id } }
mutation TagDestroy($input: TagDestroyInput!) { tagDestroy(input: $input) }
mutation TagsDestroy($ids: [ID!]!)            { tagsDestroy(ids: $ids) }
mutation TagsMerge($input: TagsMergeInput!)   { tagsMerge(input: $input) { id } }
```

`TagsMergeInput`: `{ "source": ["1","2"], "destination": "3" }`. Merges sources into destination.

## Performers, Studios, Galleries

All follow the same shape as tags: `findX`, `xCreate`, `xUpdate`, `xDestroy`, `xsDestroy`. Examples:

```graphql
query FindPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) {
  findPerformers(filter: $filter, performer_filter: $performer_filter) {
    count
    performers { id name aliases birthdate country }
  }
}

mutation PerformerCreate($input: PerformerCreateInput!) {
  performerCreate(input: $input) { id }
}

mutation StudioCreate($input: StudioCreateInput!) {
  studioCreate(input: $input) { id }
}
```

## Scene markers

```graphql
mutation SceneMarkerCreate($input: SceneMarkerCreateInput!) {
  sceneMarkerCreate(input: $input) { id }
}
```
```json
{ "input": { "scene_id": "45", "seconds": 42.5, "primary_tag_id": "1", "tag_ids": [], "title": "..." } }
```

```graphql
mutation SceneMarkerDestroy($id: ID!) { sceneMarkerDestroy(id: $id) }

query FindSceneMarkers($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
  findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
    count
    scene_markers { id title seconds primary_tag { id name } scene { id } }
  }
}
```

## Images and galleries

```graphql
query FindImages($filter: FindFilterType, $image_filter: ImageFilterType) {
  findImages(filter: $filter, image_filter: $image_filter) {
    count
    images { id title path tags { id name } performers { id name } }
  }
}

mutation ImageUpdate($input: ImageUpdateInput!) { imageUpdate(input: $input) { id } }

query FindGalleries($filter: FindFilterType, $gallery_filter: GalleryFilterType) {
  findGalleries(filter: $filter, gallery_filter: $gallery_filter) {
    count
    galleries { id title path }
  }
}
```

## Long-running metadata jobs

These are how plugins kick off the same operations the user sees in Settings → Tasks.

```graphql
mutation MetadataScan($input: ScanMetadataInput!)         { metadataScan(input: $input) }
mutation MetadataIdentify($input: IdentifyMetadataInput!) { metadataIdentify(input: $input) }
mutation MetadataClean($input: CleanMetadataInput!)       { metadataClean(input: $input) }
mutation MetadataGenerate($input: GenerateMetadataInput!) { metadataGenerate(input: $input) }
mutation MetadataAutoTag($input: AutoTagMetadataInput!)   { metadataAutoTag(input: $input) }
```

`ScanMetadataInput`:
```json
{ "input": { "paths": ["/library/scenes"], "rescan": false, "scanGenerateCovers": true, "scanGeneratePreviews": false } }
```

Each returns a job ID string. The job runs asynchronously; query its status with `findJob(input: {id: "..."})`.

## Plugins (configuration mutation)

```graphql
mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) {
  configurePlugin(plugin_id: $plugin_id, input: $input)
}
```

Use this to persist plugin state outside the declared `settings:` UI. The `input` map is merged into `configuration.plugins[plugin_id]`.

```graphql
mutation RunPluginTask($plugin_id: ID!, $task_name: String!, $args: [PluginArgInput!]) {
  runPluginTask(plugin_id: $plugin_id, task_name: $task_name, args: $args)
}
```

Args use a peculiar `PluginArgInput` shape:
```json
[
  { "key": "mode",  "value": { "str":  "rebuild_cache" } },
  { "key": "limit", "value": { "i": 100 } }
]
```

The value variant keys are `str`, `i` (int), `b` (bool), `f` (float). When using `stashapi`'s `run_plugin_task(args={...})`, the wrapper handles the encoding for you.

## Jobs and progress

```graphql
query FindJob($input: FindJobInput!) {
  findJob(input: $input) {
    id status progress description sub_tasks
  }
}

query Jobs { jobQueue { id status progress description } }
```

## Stash version

```graphql
query Version { version { hash build_time version } }
```

`stashapi.StashInterface.__init__` calls this at startup to verify connectivity. Useful for plugins that want to behave differently on different stash versions.

## Common pitfalls

- **`tag_ids` is write-only and replaces the whole list.** To add tags, read existing, concatenate, write back. Same for `performer_ids`, `gallery_ids`, etc.
- **IDs are strings in GraphQL.** Even though they look numeric, the schema uses `ID!`. Use `"45"`, not `45`.
- **Dates are `YYYY-MM-DD` strings.** Empty string clears the field; `null` is "no change" in updates.
- **`rating` vs `rating100`.** Older versions used `rating` (1–5). Modern stash uses `rating100` (0–100). Prefer `rating100`.
- **`code` field on Scene** is the studio code / SKU. Don't confuse it with `details`.
- **Files vs path.** A Scene has a `files: [...]` array because one scene can span multiple files. Old code may still reference `scene.path` (deprecated); use `scene.files[0].path` for the primary file.
- **`organized` is a meaningful flag.** Many plugins use `organized == true` as a "leave this alone" sentinel. Respect it by default.
- **GraphQL errors return as a `data: null` + `errors: [...]` response.** `stashapi` raises; raw clients should check `errors` before reading `data`.

## A complete example: rename all scenes from "old" to "new" studio

```python
import stashapi.log as log
from stashapi.stashapp import StashInterface

stash = StashInterface(server_connection)

old_studio = stash.find_studio("Old Studio")
new_studio = stash.find_studio("New Studio")
if not old_studio or not new_studio:
    log.error("studio not found")
    raise SystemExit(1)

page = 1
while True:
    res = stash.find_scenes(
        f={"studios": {"value": [old_studio["id"]], "modifier": "INCLUDES"}},
        filter={"per_page": 100, "page": page},
        fragment="id title",
    )
    for s in res["scenes"]:
        stash.update_scene({"id": s["id"], "studio_id": new_studio["id"]})
        log.info(f"updated {s['id']} ({s['title']})")
    if len(res["scenes"]) < 100:
        break
    page += 1
```
