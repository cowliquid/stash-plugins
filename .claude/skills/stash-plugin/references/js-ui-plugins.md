# JavaScript UI Plugins

UI plugins inject JS and CSS into Stash's React single-page app. They run in the browser, have access to the React tree, and can either patch built-in components or register entirely new pages.

There's no build step required by Stash itself: ship the `.js` file in the plugin directory and reference it under `ui.javascript` in the manifest. If you want JSX / TSX, you handle the transpile yourself; the manifest must point at the compiled output.

## Three ways to do UI work

Pick the API surface that matches the work.

### 1. `window.PluginApi` (preferred for React-style work)

The official, supported surface. Use this for anything that needs to render React components, patch existing components, or register routes.

```js
const PluginApi = window.PluginApi;
const React = PluginApi.React;

// Patch a built-in component (the patches survive component remounts)
PluginApi.patch.after("SceneCard.Details", function (props, _, result) {
  return [
    result,
    React.createElement("div", { className: "my-badge" }, "★"),
  ];
});

// Register a new SPA route
function MyPage() { return React.createElement("h1", null, "Hi"); }
PluginApi.register.route("/plugins/my-plugin", MyPage);

// Add a nav item that links to it
PluginApi.patch.before("MainNavBar.UtilityItems", function (props) {
  const ReactRouterDOM = PluginApi.libraries.ReactRouterDOM;
  return [{
    children: React.createElement(
      React.Fragment, null,
      props.children,
      React.createElement(ReactRouterDOM.NavLink, { to: "/plugins/my-plugin" }, "My Plugin")
    ),
  }];
});

// Listen for SPA navigation
PluginApi.Event.addEventListener("stash:location", function (e) {
  console.log("now on", e.detail.data.location.pathname);
});
```

### 2. `csLib` (Community Scripts UI Library)

A small helper that's distributed as its own plugin. Add `requires: [CommunityScriptsUILibrary]` to your manifest's `ui:` block, and `csLib` becomes a global. Best for "wait until X appears on Y page, then mutate the DOM" patterns:

```js
csLib.PathElementListener("/scenes/markers", "div.wall", function (el) {
  // runs once the wall is in the DOM on /scenes/markers
  const btn = document.createElement("button");
  btn.textContent = "Delete";
  btn.onclick = async () => {
    await csLib.callGQL({
      query: "mutation($id: ID!) { sceneMarkerDestroy(id: $id) }",
      variables: { id: el.dataset.markerId },
    });
  };
  el.appendChild(btn);
});

csLib.waitForElement(".some-selector", callback);   // lower-level primitive
```

`csLib.callGQL({query, variables})` calls the GraphQL endpoint with the user's existing session.

### 3. Pure DOM + `fetch` (no helper)

For very small tweaks or when you don't want any dependency, raw DOM is fine. Use `MutationObserver` to handle the SPA re-rendering pages, listen for `popstate`/`hashchange` to detect navigation, and call `fetch('/graphql', …)` directly:

```js
async function gql(query, variables) {
  const r = await fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    credentials: "same-origin",
  });
  const { data, errors } = await r.json();
  if (errors) throw new Error(JSON.stringify(errors));
  return data;
}
```

This is fragile (selectors break on UI updates) but has zero dependencies.

## `PluginApi` surface reference

The full set of properties hanging off `window.PluginApi`:

| Property | What it is |
|---|---|
| `React` | The React library instance Stash uses. `PluginApi.React.useState`, etc. |
| `ReactDOM` | ReactDOM instance |
| `GQL` | Apollo-generated typed GraphQL client. `GQL.useFindScenesQuery(...)` etc. |
| `libraries` | Re-exports of `ReactRouterDOM`, `Bootstrap`, `Apollo`, `Intl`, `FontAwesomeRegular/Solid/Brands`, `Mousetrap`, `ReactFontAwesome`, `ReactSelect` |
| `components` | Map of named built-in components (`HoverPopover`, `TagLink`, `SceneCard`, …). **Populated after first script execution; destructure inside FCs, not at module scope.** |
| `loadableComponents` | Lazy import promises for components that aren't always in `components` yet. Pass to `useLoadComponents`. |
| `register.route(path, FC)` | Mounts a new SPA route. Path conventionally starts with `/plugins/`. |
| `register.component(name, FC)` | Adds a component to `PluginApi.components` so other plugins can use it. Prefix names with `plugin-`. |
| `utils.NavUtils` | Helpers for navigation |
| `utils.StashService` | Higher-level wrapper over GQL, with consistent error handling |
| `utils.loadComponents(promises[])` | Returns a Promise that resolves when listed components are loaded |
| `utils.InteractiveUtils` | `getPlayer()` to get the videojs player; `interactiveClientProvider` to hook funscript lifecycle |
| `hooks.useLoadComponents(promises[])` | React hook returning `true` while components are loading |
| `hooks.useToast()` | Use this to show toasts: `const Toast = useToast(); Toast.success("Done")` |
| `hooks.useLightbox`, `hooks.useGalleryLightbox`, `hooks.useSpriteInfo` | Other built-in hooks |
| `patch.before(name, fn)` | Call `fn(...props)` before render; expects array of partial props to merge |
| `patch.instead(name, fn)` | Replace render entirely; `fn(...props, next)` |
| `patch.after(name, fn)` | Call `fn(...props, result)` after render; expects the new rendered output |
| `Event.addEventListener(event, cb)` | Listen for `"stash:location"` and a few other events |

## Patchable components (the catalog)

Component names you can pass as the first argument to `PluginApi.patch.before/instead/after`. This list is verbatim from the stash UI docs and may grow over time:

Cards and grids: `SceneCard`, `SceneCard.Details`, `SceneCard.Image`, `SceneCard.Overlays`, `SceneCard.Popovers`, `SceneCard.SceneSpecs`, `SceneCardsGrid`, `GalleryCard`, `GalleryCard.Details`, `GalleryCard.Image`, `GalleryCard.Overlays`, `GalleryCard.Popovers`, `GalleryCardGrid`, `ImageCard`, `ImageCard.Details`, `ImageCard.Image`, `ImageCard.Overlays`, `ImageCard.Popovers`, `ImageGridCard`, `PerformerCard`, `PerformerCard.Details`, `PerformerCard.Image`, `PerformerCard.Overlays`, `PerformerCard.Popovers`, `PerformerCard.Title`, `PerformerCardGrid`, `GroupCard`, `GroupCardGrid`, `StudioCard`, `StudioCardGrid`, `TagCard`, `TagCard.Details`, `TagCard.Image`, `TagCard.Overlays`, `TagCard.Popovers`, `TagCard.Title`, `TagCardGrid`, `SceneMarkerCard`, `SceneMarkerCard.Details`, `SceneMarkerCard.Image`, `SceneMarkerCard.Popovers`, `SceneMarkerCardsGrid`, `GridCard`.

Lists: `SceneList`, `GalleryList`, `ImageList`, `PerformerList`, `GroupList`, `StudioList`, `TagList`, `SceneMarkerList`, `FilteredSceneList`, `FilteredGalleryList`, `FilteredImageList`, `FilteredPerformerList`, `FilteredGroupList`, `FilteredStudioList`, `FilteredTagList`, `FilteredSceneMarkerList`.

Pages and panels: `App`, `FrontPage`, `ScenePage`, `ScenePage.Tabs`, `ScenePage.TabContent`, `ScenePlayer`, `PerformerPage`, `PerformerDetailsPanel`, `PerformerDetailsPanel.DetailGroup`, `PerformerAppearsWithPanel`, `PerformerScenesPanel`, `PerformerGalleriesPanel`, `PerformerGroupsPanel`, `PerformerImagesPanel`, `PerformerHeaderImage`, `CompressedPerformerDetailsPanel`, `StudioDetailsPanel`, `ImageDetailPanel`, `SceneFileInfoPanel`.

Navigation and chrome: `MainNavBar.MenuItems`, `MainNavBar.UtilityItems`, `BackgroundImage`, `HeaderImage`, `DetailImage`.

Recommendation rows on the FrontPage: `SceneRecommendationRow`, `GalleryRecommendationRow`, `ImageRecommendationRow`, `PerformerRecommendationRow`, `GroupRecommendationRow`, `StudioRecommendationRow`, `TagRecommendationRow`, `SceneMarkerRecommendationRow`, `RecommendationRow`.

Inputs and selectors: `SceneSelect`, `SceneSelect.sort`, `SceneIDSelect`, `GallerySelect`, `GallerySelect.sort`, `GalleryIDSelect`, `ImageInput`, `PerformerSelect`, `PerformerSelect.sort`, `PerformerIDSelect`, `GroupSelect`, `GroupSelect.sort`, `GroupIDSelect`, `StudioSelect`, `StudioSelect.sort`, `StudioIDSelect`, `TagSelect`, `TagSelect.sort`, `TagIDSelect`, `CountrySelect`, `FolderSelect`, `DateInput`, `CustomFieldInput`, `CustomFields`, `CustomFieldsInput`.

Settings: `Setting`, `SettingGroup`, `SettingModal`, `BooleanSetting`, `NumberSetting`, `StringSetting`, `StringListSetting`, `SelectSetting`, `ModalSetting`, `ConstantSetting`, `ChangeButtonSetting`, `PluginSettings`.

Other: `Icon`, `TruncatedText`, `RatingStars`, `RatingNumber`, `RatingSystem`, `LightboxLink`, `LoadingIndicator`, `HoverPopover`, `Pagination`, `PaginationIndex`, `TabTitleCounter`, `AlertModal`, `TagLink`, `ExternalLinkButtons`, `ExternalLinksButton`, `PluginRoutes`, `SweatDrops`.

## The three patch styles

| Method | When called | Function signature | Expected return |
|---|---|---|---|
| `patch.before` | Before render. Use to munge props. | `(...props) => …` | Array of partial props that get merged with originals |
| `patch.instead` | Replaces render. | `(...props, next) => …` | A React element. If you don't call `next(...)`, later patches won't run. |
| `patch.after` | After render. Use to wrap/decorate. | `(...props, result) => …` | A React element (typically wrapping `result`) |

Concrete example, adding a star badge to every SceneCard image:

```js
const React = window.PluginApi.React;
window.PluginApi.patch.after("SceneCard.Image", function (props, result) {
  return React.createElement(
    "div", { className: "scene-card-image-wrapper" },
    result,
    React.createElement("span", { className: "my-badge" }, "★")
  );
});
```

The plugin's CSS then styles `.my-badge`.

## Lifecycle and gotchas

**Scripts run once on page load.** Stash's SPA stays mounted; your script does not re-run on navigation. Use `PluginApi.Event.addEventListener("stash:location", …)` or `MutationObserver` to react to navigation. The `PluginApi.patch.*` registrations persist for the lifetime of the page.

**`PluginApi.components` is populated after your script first executes.** This will fail:

```js
// WRONG: components dict not ready yet
const { HoverPopover } = window.PluginApi.components;
function MyCard() { return <HoverPopover ... />; }
```

This is correct:

```js
function MyCard(props) {
  const { HoverPopover } = window.PluginApi.components;  // OK: runs on render
  return React.createElement(HoverPopover, props);
}
```

Or use `useLoadComponents` to wait for specific lazy components:

```js
const React = window.PluginApi.React;
const { useLoadComponents } = window.PluginApi.hooks;
const { Performers } = window.PluginApi.loadableComponents;

function MyPage() {
  const loading = useLoadComponents([Performers]);
  if (loading) return null;
  const { PerformerCard } = window.PluginApi.components;
  return React.createElement(PerformerCard, { ... });
}
```

**No JSX without a build step.** Stash doesn't transpile. Either:
- Write `React.createElement` calls directly (works in any browser).
- Add a build step (esbuild, vite, tsc) that compiles `.tsx`/`.jsx` to `.js`. Point the manifest at the compiled output, not the source.

**CSP is restrictive by default.** Calling external URLs requires `ui.csp.connect-src: [https://example.com]` in the manifest. Loading scripts from a CDN requires `script-src`.

**Order matters with `ui.requires:`**. If your plugin depends on `csLib`, the manifest's `ui.requires: [CommunityScriptsUILibrary]` ensures it loads first. Without this, `csLib` may be undefined when your script runs.

## Events

Subscribe with `PluginApi.Event.addEventListener(name, callback)`. The event object's `detail.data` contains the payload.

| Event | Payload (`e.detail.data.*`) |
|---|---|
| `stash:location` | `.location`: React Router location object (`pathname`, `search`, `hash`) |

The list of events is small and may grow. Inspect at runtime with `PluginApi.Event` in the browser console if you suspect there are more.

## Using `PluginApi.GQL` for typed queries

`PluginApi.GQL` exposes Apollo-generated React hooks. Use them inside FCs instead of writing raw queries:

```js
function ScenesList() {
  const React = window.PluginApi.React;
  const { useFindScenesQuery } = window.PluginApi.GQL;
  const { data, loading } = useFindScenesQuery({
    variables: { filter: { per_page: 10 }, scene_filter: {} },
  });
  if (loading) return React.createElement("div", null, "Loading…");
  return React.createElement("ul", null,
    data.findScenes.scenes.map(s => React.createElement("li", { key: s.id }, s.title)));
}
```

For one-off queries outside a component, use `PluginApi.utils.StashService` (an Apollo client wrapper with built-in error handling) or fall back to raw `fetch('/graphql', …)`.

## CSS-only themes

If the user just wants a theme (no JS, no plugin logic), the manifest is even simpler:

```yaml
name: My Dark Theme
description: Darker dark mode
version: 1.0.0
ui:
  css: [theme.css]
```

Selectors should target Stash's class names. Open the running Stash UI in DevTools and inspect; you'll see Bootstrap-style class names (`.scene-card__details`, `.modal-content`, `.btn-primary`). Themes typically override CSS variables on `:root` or specific elements rather than touching layout.
