"""tag-on-update: tag scenes when they're edited, plus a bulk-tag task.

Demonstrates the standard Python plugin skeleton:
  * Read JSON from stdin
  * Build a StashInterface (remapping 0.0.0.0 -> localhost)
  * Read plugin settings from configuration.plugins["tag-on-update"]
  * Dispatch on mode (task) or hookContext (hook)
  * Print final {"output": ...} line to stdout

Self-trigger guard:
  Updating a scene fires Scene.Update.Post -> this plugin -> sceneUpdate -> Scene.Update.Post...
  We avoid the loop by checking whether the tag is already present before writing.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import stashapi.log as log
from stashapi.stashapp import StashInterface


PLUGIN_ID = "tag-on-update"      # must match the manifest filename minus .yml
DEFAULTS = {
    "tagName": "Reviewed",
    "zzDryRun": False,
}


def get_stash(server_connection: dict) -> StashInterface:
    conn = dict(server_connection)
    if conn.get("Host") == "0.0.0.0":
        conn["Host"] = "localhost"
    return StashInterface(conn)


def get_settings(stash: StashInterface) -> dict:
    cfg = stash.find_plugin_config(PLUGIN_ID, defaults=DEFAULTS) or {}
    return {
        "tagName":  str(cfg.get("tagName") or DEFAULTS["tagName"]),
        "zzDryRun": bool(cfg.get("zzDryRun") or False),
    }


def ensure_tag(stash: StashInterface, name: str) -> str:
    """Return the ID of the tag with the given name, creating it if missing."""
    tag = stash.find_tag(name)
    if tag:
        return tag["id"]
    log.info(f"creating tag '{name}'")
    return stash.create_tag({"name": name})["id"]


def apply_tag_to_scene(stash: StashInterface, scene_id: str, tag_id: str, dry_run: bool) -> bool:
    """Add tag_id to scene_id's tag list. Returns True iff a change was needed."""
    scene = stash.find_scene(scene_id, "id title tags { id }")
    if scene is None:
        log.warning(f"scene {scene_id} not found")
        return False
    existing = {t["id"] for t in scene["tags"]}
    if tag_id in existing:
        log.debug(f"scene {scene_id} already tagged, skipping")
        return False                                  # SELF-TRIGGER GUARD
    new_tags = list(existing | {tag_id})
    if dry_run:
        log.info(f"[dry-run] would tag scene {scene_id} ({scene.get('title','')})")
        return True
    stash.update_scene({"id": scene_id, "tag_ids": new_tags})
    log.info(f"tagged scene {scene_id} ({scene.get('title','')})")
    return True


def handle_hook(stash: StashInterface, ctx: dict, settings: dict) -> None:
    if ctx.get("type") not in ("Scene.Create.Post", "Scene.Update.Post"):
        log.debug(f"ignoring hook type {ctx.get('type')}")
        return
    scene_id = ctx["id"]
    tag_id = ensure_tag(stash, settings["tagName"])
    apply_tag_to_scene(stash, scene_id, tag_id, settings["zzDryRun"])


def handle_task(stash: StashInterface, mode: str, settings: dict) -> None:
    if mode != "tag_all":
        log.warning(f"unknown task mode: {mode}")
        return
    tag_id = ensure_tag(stash, settings["tagName"])
    page = 1
    processed = 0
    while True:
        res = stash.find_scenes(filter={"per_page": 100, "page": page},
                                fragment="id title tags { id }")
        scenes = res.get("scenes", [])
        if not scenes:
            break
        for s in scenes:
            if apply_tag_to_scene(stash, s["id"], tag_id, settings["zzDryRun"]):
                processed += 1
        total = res.get("count", 0)
        if total:
            log.progress(min((page * 100) / total, 1.0))
        if len(scenes) < 100:
            break
        page += 1
    log.info(f"tagged {processed} scene(s)")


def main() -> None:
    payload: dict[str, Any] = json.loads(sys.stdin.read())
    stash = get_stash(payload["server_connection"])
    settings = get_settings(stash)
    args = payload.get("args", {}) or {}

    if "hookContext" in args:
        handle_hook(stash, args["hookContext"], settings)
    elif "mode" in args:
        handle_task(stash, args["mode"], settings)
    else:
        log.warning("plugin invoked with no mode or hookContext")

    print(json.dumps({"output": "ok"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:                          # noqa: BLE001 (top-level catch)
        log.error(f"plugin crashed: {exc}")
        print(json.dumps({"output": None, "error": str(exc)}))
        sys.exit(1)
