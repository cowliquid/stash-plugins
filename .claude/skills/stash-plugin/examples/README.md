# Example plugins

Three minimal but complete plugins. Copy whichever is closest to what you're building, then edit the manifest first and the script second.

| Folder | Flavor | What it does |
|---|---|---|
| `hook-python-tag-on-update/` | Python (raw) | Adds a tag on `Scene.Create/Update.Post`. Also ships a bulk-tag task. Demonstrates `stashapi`, settings, self-trigger guards, the exit JSON protocol. |
| `ui-patch-scene-card/` | UI (JS + CSS) | Patches `SceneCard.Image` with a rating badge. Registers a `/plugins/scene-overlay` page. Adds a nav-bar link. Listens for `stash:location`. |
| `embedded-js-task/` | Embedded JS | Loops over scenes via `gql.Do`, applies a tag to anything untagged. Zero external dependencies, no install step. |

## Installing for local testing

1. Copy the folder into `~/.stash/plugins/<plugin-id>/` (or the Windows equivalent: `%USERPROFILE%\.stash\plugins\<plugin-id>\`).
2. For the Python example: `cd ~/.stash/plugins/hook-python-tag-on-update && pip install -r requirements.txt`.
3. In the Stash UI, go to **Settings → Plugins** and click **Reload Plugins**.
4. The plugin appears in the list. For tasks, scroll to the plugin's section on the Plugins page; for hooks, just edit a scene to trigger them.

## What to change first

For each example, you'll typically only need to edit:

- `name:` and `description:` in the manifest
- The plugin ID (rename the folder + the `.yml` filename)
- The actual logic in the script

Everything else (stdin parsing, error handling, exit JSON) is reusable as-is.
