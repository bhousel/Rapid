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

## Network

- **Not all `key` variables in services are requestIDs** — During the `key` → `requestID` rename, WaybackService had `const key = \`${tile.id}_${releaseDate}\`` used as a metadata cache lookup key. This local variable was intentionally NOT renamed — only the option property passed to `network.fetch()` became `requestID`. When doing bulk renames, check whether the variable represents the network request identity or an unrelated domain concept.
- **`multi_replace_string_in_file` can silently break code** — When `oldString` includes text that spans a structural boundary (like `}\n    this._cache = {`), the replacement must include ALL the matched text. A partial replacement dropped the closing brace and object assignment in WaybackService. Always verify structural edits immediately.
- **Copy-paste bugs in catch handlers** — OsmService's `postNoteCreate`/`postNoteUpdate` catch handlers had `this._changeset.inflight = null` — clearly copy-pasted from changeset methods. When removing manual inflight tracking, check ALL catch/finally blocks for mismatched cleanup that was hiding a bug.
- **Request ID prefix collisions cause complex abort predicates** — Original `osm-note-${tileID}` collided with `osm-note-post-*`, requiring negative lookahead in `abortMatching`. Fix: choose non-overlapping prefixes (e.g. `osm-note-tile-` vs `osm-note-post-`). Design request ID schemes so each category can be selected with a simple prefix regex.
- **Dead code in interfaces** — `_tileCache.seen: Set<string>` was declared in the interface, initialized in `_initCache()`, but never read anywhere. When auditing inflight caches, also check for other dead properties in the same interfaces.
- **Manual mock fetch vs fetch-mock library** — Use `fetch-mock` for service tests where real URL routing/counting matters. For NetworkSystem tests (testing fetch lifecycle itself), manual mocks are better — most tests need deferred resolution, abort signal handling, or custom fetchFn, which fetch-mock doesn't naturally support.

## Runtime

- **Mark features dirty when styles change** — `immediateRedraw()` alone doesn't work. Call `gfx.scene.dirtyScene()` before redraw so features re-fetch their style.
- **PIXI color formats** — CSS hex `"#FF6600"` and numeric `0xFF6600` work. String `"0xFF6600"` may also work (unverified).
- **TaginfoService `_clean()` strips `debounce` from params** — When migrating `doRequest = params.debounce ? debouncedVersion : directVersion`, capture `shouldDebounce` BEFORE calling `_clean()`. The same pattern applies to OsmWikibaseService.
- **`scheduler?.debounce()` silently drops calls** — Optional chaining on the scheduler means the debounced function never fires if scheduler is absent. Fix: `if (shouldDebounce && scheduler) { scheduler.debounce(...) } else { request() }`. Only matters for service request paths; UI render deferrals are safe to no-op.
