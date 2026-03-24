# Known Quirks

Runtime issues, workarounds, and things that will bite you if you don't know about them.

- **Asset loading vs. render loop timing** — `loadStyleAssetsAsync()` / `loadSchemaAssetsAsync()` at runtime: Pixi keeps rendering during async loading. Current hack: `gfx.pause()` / `gfx.resume()` / `gfx.scene.reset()`. Needs a proper solution.
- **FilterSystem.getMatches** — Skips vertices entirely (returns empty Set). Skips relations unless `tags.type === 'boundary'`. Multipolygon relations get `'area'` geometry, not `'relation'`.
- **RapidSystem._datasetsChanged** — Color-assignment logic is acknowledged as "weird" in code comments. Legacy behavior from before Rapid#1642.
- **ImagerySystem builtins** — `'none'` and `'custom'` sources always exist regardless of merged assets.
