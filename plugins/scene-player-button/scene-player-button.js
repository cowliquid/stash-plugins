(function () {
  const PluginApi = window.PluginApi;
  if (!PluginApi) {
    console.error("[scene-player-button] PluginApi not available");
    return;
  }
  const React = PluginApi.React;
  const e = React.createElement;

  function PlayerButton(props) {
    const { useToast } = PluginApi.hooks;
    const Toast = useToast();
    const scene = props.scene;

    function onClick() {
      const id = scene && scene.id;
      const title = (scene && scene.title) || "(untitled)";
      Toast.success("Scene #" + id + ": " + title);
      console.log("[scene-player-button] clicked", scene);
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

  PluginApi.patch.after("ScenePlayer", function (props, result) {
    return [result, e(PlayerButton, { key: "scene-player-button", scene: props.scene })];
  });
})();
