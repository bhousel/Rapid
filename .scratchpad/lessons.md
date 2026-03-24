# Lessons Learned

Things that went wrong once and shouldn't go wrong again.

## TypeScript

- **`Object.entries()` widens keys** — Always returns `[string, V][]`. Cast at iteration site: `Object.entries(obj) as [keyof MyType, unknown][]`. Or iterate a known key set and index directly.
- **Tiler method chaining** — `new Tiler().tileSize(512)` returns `number | Tiler`. Need `as Tiler` casts on the chain.
- **`utilQsString`** requires 2 args `(obj, noencode: boolean)` — pass `false` for the second.
- **`osmAuth()` types wrong upstream** — Declared as class constructor but is actually a factory function. Local interface workaround in OsmService.ts until upstream is fixed.

## Testing

- **MockContext has no services by default** — Guard clauses needed when testing service-dependent features.
- **DOMParser in unit tests** — Use `import { DOMParser } from '@xmldom/xmldom'`, not the browser global. Tests run without happy-dom unless using browser preload.
- **Test sample data** — `*.sample.js` files alongside the test. Import as `import * as SAMPLE from './Foo.sample.js'`.
- **FilterSystem cache keyed by `entity.key`** (includes version), not `entity.id`.
- **`_isWater` vs `_isPoint`** — When testing filterScene water counts, use way entities. Point nodes with waterway tags match `_isPoint` first.
- **Validator tests: create after schema init** — Validators hoist schema prerequisites at construction time. Create the validator inside `beforeAll` after `schema.merge()`.
- **Inline schema init pattern for tests** — Import `osm_rulesets.json5` directly (Bun native JSON5 import), create real `SchemaSystem`, init + merge in `beforeAll`. Single source of truth.

## Runtime

- **Mark features dirty when styles change** — `immediateRedraw()` alone doesn't work. Call `gfx.scene.dirtyScene()` before redraw so features re-fetch their style.
- **PIXI color formats** — CSS hex `"#FF6600"` and numeric `0xFF6600` work. String `"0xFF6600"` may also work (unverified).
