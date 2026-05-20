(function () {
  const PluginApi = window.PluginApi;
  if (!PluginApi) {
    console.error("[scene-player-button] PluginApi not available");
    return;
  }
  const React = PluginApi.React;
  const e = React.createElement;

  function PlayerButton() {
    const { useToast } = PluginApi.hooks;
    const Toast = useToast();

    const sceneId = (function () {
      const m = window.location.pathname.match(/\/scenes\/(\d+)/);
      return m ? m[1] : null;
    })();

    function onClick() {
      Toast.success(sceneId ? "Scene #" + sceneId : "Test Button clicked");
      console.log("[scene-player-button] clicked, sceneId=", sceneId);
    }

    return e(
      "div",
      { className: "scene-player-button-wrap" },
      e(
        "button",
        { className: "btn btn-primary scene-player-button", onClick: onClick },
        "Test Button"
      )
    );
  }

  PluginApi.patch.after("ScenePlayer", function () {
    const args = arguments;
    const result = args[args.length - 1];
    return e(
      React.Fragment,
      null,
      result,
      e(PlayerButton, { key: "scene-player-button" })
    );
  });
})();
