# Known Quirks

Runtime issues, workarounds, and things that will bite you if you don't know about them.

- **Asset loading vs. render loop timing** — `loadStyleAssetsAsync()` / `loadSchemaAssetsAsync()` at runtime: Pixi keeps rendering during async loading. Current hack: `gfx.pause()` / `gfx.resume()` / `gfx.scene.reset()`. Needs a proper solution.
- **FilterSystem.getMatches** — Skips vertices entirely (returns empty Set). Skips relations unless `tags.type === 'boundary'`. Multipolygon relations get `'area'` geometry, not `'relation'`.
- **RapidSystem._datasetsChanged** — Color-assignment logic is acknowledged as "weird" in code comments. Legacy behavior from before Rapid#1642.
- **ImagerySystem builtins** — `'none'` and `'custom'` sources always exist regardless of merged assets.
- **Structured clone kills DOM objects in workers** — `utilFetchResponse` parses XML into xmldom `Document` objects. These can't survive `postMessage` (structured clone strips prototype methods like `getAttribute`). Services returning XML must either: (a) use `mainThread: true` on `network.fetch`, or (b) parse in the worker and return plain `ParserResult`. MapWithAIService uses approach (b) via `MapWithAIService.worker.ts`.
- **Canvas renderer limitations** — `renderer=canvas` URL param enables Pixi's experimental canvas renderer (v8.16+). Known issues: no Mesh support (dashed lines drawn via DashLine meshes won't render), pattern fills may not work from atlas-packed textures. Atlas textures (symbols, text, tiles) work via canvas-backed `AtlasSource`. `PixiTextures.createTexture()` uses `renderer.generateTexture()` + `renderer.texture.getPixels()` → the canvas path should work since `getPixels` goes through `CanvasTextureSystem.getPixels()`, but test thoroughly.
