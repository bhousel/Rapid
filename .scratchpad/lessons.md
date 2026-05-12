# Lessons Learned

Things that went wrong once and shouldn't go wrong again.

## TypeScript

- **`Object.entries()` widens keys** — Always returns `[string, V][]`. Cast at iteration site: `Object.entries(obj) as [keyof MyType, unknown][]`. Or iterate a known key set and index directly.
- **Tiler method chaining** — `new Tiler().tileSize(512)` returns `number | Tiler`. Need `as Tiler` casts on the chain.
- **`utilQsString`** requires 2 args `(obj, noencode: boolean)` — pass `false` for the second.
- **`osmAuth()` types wrong upstream** — Declared as class constructor but is actually a factory function. Local interface workaround in OsmService.ts until upstream is fixed.
- **JSDoc first-line duplication** — Two redundant patterns to watch for and avoid:
  1. A line that is just the backticked class name: `` * `ClassName` ``
  2. A `ClassName - description` prefix on the first line
  Both clutter IntelliSense by repeating the symbol name that's already shown. Start the description directly on the first line instead.

## Testing

- **MockContext has no services by default** — Guard clauses needed when testing service-dependent features.
- **DOMParser in unit tests** — Use `import { DOMParser } from '@xmldom/xmldom'`, not the browser global. Tests run without happy-dom unless using browser preload.
- **Test sample data** — `*.sample.js` files alongside the test. Import as `import * as SAMPLE from './Foo.sample.js'`.
- **FilterSystem cache keyed by `entity.key`** (includes version), not `entity.id`.
- **`_isWater` vs `_isPoint`** — When testing filterScene water counts, use way entities. Point nodes with waterway tags match `_isPoint` first.
- **Validator tests: create after schema init** — Validators hoist schema prerequisites at construction time. Create the validator inside `beforeAll` after `schema.merge()`.
- **Inline schema init pattern for tests** — Import `osm_rulesets.json5` directly (Bun native JSON5 import), create real `SchemaSystem`, init + merge in `beforeAll`. Single source of truth.

## Network

- **Worker results resolve as uninterruptible microtask chains** — `worker.onmessage` → `pending.resolve(result)` triggers `.then()` callbacks synchronously as microtasks. The browser event loop can't yield between microtasks. When multiple tile results arrive in one frame, the entire chain (entity construction + `graph.rebase` + `tree.rebase` ~11ms per tile) runs non-preemptibly: 6 tiles = 66ms+ frame drop. Fix: defer resolution through SchedulerSystem with `resultPriority` option on `WorkerSystem.dispatch()`. Each result gets its own scheduler slot, so the frame can yield between tiles.
- **Not all `key` variables in services are requestIDs** — During the `key` → `requestID` rename, WaybackService had `const key = \`${tile.id}_${releaseDate}\`` used as a metadata cache lookup key. This local variable was intentionally NOT renamed — only the option property passed to `network.fetch()` became `requestID`. When doing bulk renames, check whether the variable represents the network request identity or an unrelated domain concept.
- **`multi_replace_string_in_file` can silently break code** — When `oldString` includes text that spans a structural boundary (like `}\n    this._cache = {`), the replacement must include ALL the matched text. A partial replacement dropped the closing brace and object assignment in WaybackService. Always verify structural edits immediately.
- **Copy-paste bugs in catch handlers** — OsmService's `postNoteCreate`/`postNoteUpdate` catch handlers had `this._changeset.inflight = null` — clearly copy-pasted from changeset methods. When removing manual inflight tracking, check ALL catch/finally blocks for mismatched cleanup that was hiding a bug.
- **Request ID prefix collisions cause complex abort predicates** — Original `osm-note-${tileID}` collided with `osm-note-post-*`, requiring negative lookahead in `abortMatching`. Fix: choose non-overlapping prefixes (e.g. `osm-note-tile-` vs `osm-note-post-`). Design request ID schemes so each category can be selected with a simple prefix regex.
- **Dead code in interfaces** — `_tileCache.seen: Set<string>` was declared in the interface, initialized in `_initCache()`, but never read anywhere. When auditing inflight caches, also check for other dead properties in the same interfaces.
- **Manual mock fetch vs fetch-mock library** — Use `fetch-mock` for service tests where real URL routing/counting matters. For NetworkSystem tests (testing fetch lifecycle itself), manual mocks are better — most tests need deferred resolution, abort signal handling, or custom fetchFn, which fetch-mock doesn't naturally support.
- **Don't test the AbortError path in service `_request` methods** — AbortError is the "quietly drop the request" signal: no callback, no promise rejection, no notification. Testing it requires a negative assertion ("callback was never called") with no reliable signal to wait on. Additionally, NetworkSystem's internal promise chain doesn't have a catch for abort-shaped errors, so a fetch-mock `throws: AbortError` approach produces unhandled rejection noise in the test runner. Leave this path untested in all service files — it's an intentional design decision, not a gap.
- **Tests using `listenerID` need WorkerSystem + NetworkSystem init** — When a service uses `listenerID` in `network.fetch()`, the listener must be registered with WorkerSystem. NetworkSystem registers its listeners during `initAsync()`. Tests that skip `network.initAsync()` get `listener not registered` errors. Fix: add `WorkerSystem` to mock context and chain `network.initAsync()` before the service's `initAsync()`.
- **Silent fallthroughs mask bugs in dispatch logic** — `_dispatchFetch` originally fell through to generic fetch+parse when a named `listenerID` was provided but no listener was registered. This would return unparsed text instead of parsed OSM data — silently wrong. Fix: reject with a clear error when a requested listener is missing. General rule: if the caller explicitly asks for a specific behavior, don't silently give them a different one.

- **`globalThis.localStorage` unavailable in unit tests** — Bun's `test:unit` script runs WITHOUT the happy-dom preload (`--preload ./test/test_setup.js`). Only `test:browser` gets the preload. This means `globalThis.localStorage` is `undefined` in unit tests. osm-auth v3.2.0 exposes `oauth.getAccessToken()` — use that instead of reading localStorage directly. osm-auth handles absence of localStorage internally with a mock Map store (v3.1.1+).
- **osm-auth v3.1.1+ mock store is functional** — When `localStorage` is unavailable, osm-auth creates a mock store backed by `new Map()`. `authenticated()` returns `true` after preauth. External code should use `oauth.getAccessToken()` (v3.2.0+) rather than reading localStorage directly.
- **xmldom 0.9.x throws on leading whitespace before `<?xml`** — `DOMParser.parseFromString()` in xmldom 0.9.x throws `ParseError: processing instruction at position 1 is an xml declaration which is only at the start of the document` if there is any leading whitespace before the XML declaration. Always call `.trimStart()` on the input string before passing to `parseFromString()`. Template literals with a newline before `<?xml` are a common source of this — write `` =\n`<?xml`` (tag on the `` ` `` line) rather than `` = `\n<?xml``.
- **xmldom 0.9.x owns its own `Document` type** — `import { DOMParser } from '@xmldom/xmldom'` gives you an xmldom `Document`, not the global DOM `Document`. These types are incompatible. Use `import type { Document as XmlDocument } from '@xmldom/xmldom'` and annotate any variable holding an xmldom parse result as `XmlDocument`.

## Runtime

- **d3-polygon centroid is numerically unstable for small features at large coordinates** — The shoelace formula accumulates x*y cross-products (~1e13), subtracts pairs (~1e7 difference), and accumulates centroid terms (~1e14 magnitude). For z16 world coordinates and small geometry, this causes catastrophic cancellation and produces centroids far outside the geometry bounds. Fix: translate points to center them near origin before calling d3-polygon functions, then translate results back. See GeometryPart.ts `stablePolygonCentroid()` for the pattern.
- **Mark features dirty when styles change** — `immediateRedraw()` alone doesn't work. Call `gfx.scene.dirtyScene()` before redraw so features re-fetch their style.
- **PIXI color formats** — CSS hex `"#FF6600"` and numeric `0xFF6600` work. String `"0xFF6600"` may also work (unverified).
- **TaginfoService `_clean()` strips `debounce` from params** — When migrating `doRequest = params.debounce ? debouncedVersion : directVersion`, capture `shouldDebounce` BEFORE calling `_clean()`. The same pattern applies to OsmWikibaseService.
- **`scheduler?.debounce()` silently drops calls** — Optional chaining on the scheduler means the debounced function never fires if scheduler is absent. Fix: `if (shouldDebounce && scheduler) { scheduler.debounce(...) } else { request() }`. Only matters for service request paths; UI render deferrals are safe to no-op.
