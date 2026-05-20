// scene-overlay: a UI plugin that demonstrates the three core PluginApi patterns.
//
// 1. Patch a built-in component to decorate its output.
// 2. Register a new SPA route.
// 3. Listen for navigation events.
//
// All three live in one file because UI plugins are loaded as a single <script>.
// No JSX, no build step: everything goes through React.createElement.

(function () {
  const PluginApi = window.PluginApi;
  if (!PluginApi) {
    console.error("[scene-overlay] PluginApi not available");
    return;
  }
  const React = PluginApi.React;
  const e = React.createElement;

  // ----------------------------------------------------------------------
  // 1. Decorate every SceneCard with a small rating badge.
  // ----------------------------------------------------------------------
  PluginApi.patch.after("SceneCard.Image", function (props, result) {
    const rating = props.scene && props.scene.rating100;
    if (rating == null) return result;
    return e(
      "div",
      { className: "scene-overlay-wrap" },
      result,
      e("span", { className: "scene-overlay-badge" }, Math.round(rating))
    );
  });

  // ----------------------------------------------------------------------
  // 2. Register a custom page at /plugins/scene-overlay.
  //    Demonstrates pulling a built-in component (HoverPopover) from the
  //    PluginApi.components map INSIDE the FC body, not at module scope.
  // ----------------------------------------------------------------------
  function TopRatedPage() {
    const { useFindScenesQuery } = PluginApi.GQL;
    const { data, loading, error } = useFindScenesQuery({
      variables: {
        filter: { per_page: 20, sort: "rating", direction: "DESC" },
        scene_filter: { rating100: { value: 80, modifier: "GREATER_THAN" } },
      },
    });
    if (loading) return e("div", { className: "scene-overlay-page" }, "Loading…");
    if (error) return e("div", { className: "scene-overlay-page" }, "Error: " + error.message);

    const items = data.findScenes.scenes.map(function (s) {
      return e(
        "li",
        { key: s.id, className: "scene-overlay-item" },
        e("strong", null, s.title || "(untitled)"),
        " - ",
        e("span", null, s.rating100 + "/100")
      );
    });

    return e(
      "div",
      { className: "scene-overlay-page" },
      e("h1", null, "Top Rated Scenes"),
      e("ul", null, items)
    );
  }
  PluginApi.register.route("/plugins/scene-overlay", TopRatedPage);

  // ----------------------------------------------------------------------
  // 3. Add a nav-bar link to the page above.
  //    patch.before returns an array of partial props to MERGE with the
  //    original. We replace `children` with a fragment that includes our link.
  // ----------------------------------------------------------------------
  PluginApi.patch.before("MainNavBar.UtilityItems", function (props) {
    const NavLink = PluginApi.libraries.ReactRouterDOM.NavLink;
    return [
      {
        children: e(
          React.Fragment,
          null,
          props.children,
          e(NavLink, { to: "/plugins/scene-overlay", className: "nav-link" }, "Top Rated")
        ),
      },
    ];
  });

  // ----------------------------------------------------------------------
  // 4. Watch SPA navigation. Use this for plugins that need to do work
  //    every time the user lands on a particular path.
  // ----------------------------------------------------------------------
  PluginApi.Event.addEventListener("stash:location", function (ev) {
    const pathname = ev.detail.data.location.pathname;
    console.debug("[scene-overlay] navigated to", pathname);
  });
})();
