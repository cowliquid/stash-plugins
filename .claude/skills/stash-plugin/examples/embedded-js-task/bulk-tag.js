// bulk-tag.js: embedded JS plugin for Stash. Runs inside the goja JS runtime.
//
// Globals available here: input, log, gql, util.
// Constraints: ES5 only. No fetch, no Promise, no async/await. Use var.
//
// The script's evaluated value is the plugin output. We return {Output:"..."} on
// success or {Error:"..."} on failure (capital O / capital E; goja matches the
// Go field names).

var PLUGIN_ID = "bulk-tag";              // matches the manifest filename, minus .yml

function getSettings() {
  var data = gql.Do("query { configuration { plugins } }");
  var plugins = (data && data.configuration && data.configuration.plugins) || {};
  var mine = plugins[PLUGIN_ID] || {};
  return {
    tagName: mine.tagName || "Auto-Tagged",
  };
}

function ensureTag(name) {
  // Find first; create only if missing. The findTags filter expects strict EQUALS.
  var query =
    "query($filter: TagFilterType) {" +
    "  findTags(tag_filter: $filter) { tags { id name } }" +
    "}";
  var existing = gql.Do(query, {
    filter: { name: { value: name, modifier: "EQUALS" } },
  });
  if (existing.findTags.tags.length > 0) {
    return existing.findTags.tags[0].id;
  }
  log.Info("creating tag '" + name + "'");
  var created = gql.Do(
    "mutation($input: TagCreateInput!) { tagCreate(input: $input) { id } }",
    { input: { name: name } }
  );
  return created.tagCreate.id;
}

function tagAllUntagged(tagId) {
  var perPage = 50;
  var page = 1;
  var tagged = 0;
  var totalSeen = 0;
  var firstCount = -1;

  while (true) {
    var data = gql.Do(
      "query($f: FindFilterType!) {" +
      "  findScenes(filter: $f) {" +
      "    count" +
      "    scenes { id title tags { id } }" +
      "  }" +
      "}",
      { f: { per_page: perPage, page: page } }
    );
    var scenes = data.findScenes.scenes;
    if (firstCount === -1) firstCount = data.findScenes.count;
    if (!scenes.length) break;

    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      totalSeen++;
      if (s.tags && s.tags.length > 0) continue;     // already tagged; skip
      gql.Do(
        "mutation($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }",
        { input: { id: s.id, tag_ids: [tagId] } }
      );
      tagged++;
    }

    if (firstCount > 0) {
      log.Progress(Math.min(totalSeen / firstCount, 1));
    }
    if (scenes.length < perPage) break;
    page++;
  }

  return tagged;
}

function main() {
  if (input.Args.mode !== "run") {
    return { Output: "no-op (unknown mode: " + input.Args.mode + ")" };
  }

  var settings = getSettings();
  log.Info("using tag name: " + settings.tagName);

  var tagId = ensureTag(settings.tagName);
  var tagged = tagAllUntagged(tagId);

  return { Output: "tagged " + tagged + " scene(s) with '" + settings.tagName + "'" };
}

main();
