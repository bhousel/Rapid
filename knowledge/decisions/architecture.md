# Decisions: Architecture

Systems and their lifecycle, workers, operations, and the UI's structure. Non-obvious choices where "why did we do it this way?" isn't captured in the code.

## Architecture

- **Scoped data, no aggregate caches** — Both StyleSystem and SchemaSystem store data in `_scopes: Map<ScopeID, ScopeData>`. No aggregate maps across scopes. Callers access scope data directly: `schema.getScope('osm')?.fields.get(id)`.
- **`'*'` common scope** — Holds geometry fallback presets and default styles. Created by `resetAll()`. Always available even without loaded data. Production `rapid_style.json5` uses `scope: '*'`.
- **Scoped format only** — `merge()` only accepts `{ scopes: [{ scope: 'osm', ... }] }`. External flat data (id-tagging-schema, NsiService) gets wrapped before merging.

- **`TreeStore` owns all nested-tree logic** — `modules/lib/TreeStore.ts` is the single home for path access + flat-key (de)serialization; `modules/util/keypath.ts` was folded in and deleted. `SettingsSystem` (persistence: `rapid.settings.*` namespace + migrations) and `LocalizationSystem` (`_store`, keyed `[locale][resource][…]`) both build on it. Nested internal repr chosen because reads are hot and writes rare.
- **`peek` vs `get`** — `TreeStore.peek` returns a copy-free live reference for hot read paths (l10n `t()`); `get` returns a deep copy of composites for safe external use. Strings are returned as-is by both (immutable, no clone).
- **`<TX_DOT>` normalized at load, not resolve** — Transifex can't use dots in translation keys, so data files use a `<TX_DOT>` sentinel. `LocalizationSystem` rewrites those keys to literal dots once when loading each resource; producers (e.g. `ImagerySource`) percent-encode dots as `%2E` (`encodeURIComponent` leaves `.` alone). The resolver stays ignorant of both encodings.

## Context Lifecycle

- **No backward compat for old `initAsync()`** — It now only inits (doesn't start). Simple consumers use `context.run()`. v3 breaking change.
- **`prepareAsync()` → `initAsync()` → `startAsync()`** — Each phase chains the previous. All idempotent. `run()` is a convenience that chains everything.

## `DatabaseSystem` owns the generic file API (but not the `sessions` domain logic)

`DatabaseSystem` has a generic file API (`putFileAsync` / `getFileAsync` / `listFilesAsync` /
`deleteFileAsync`, Blobs stored natively), although `sessions` is owned by `EditSystem`. The asymmetry is
deliberate: sessions encode domain knowledge (backups, entities, history), while a file is just a Blob
with a name. Bryan's mental model: *`DatabaseSystem` is the persistent store for anything more
complicated than localStorage.* What a file means (which dataset, when to reload it) belongs to its
consumer, on top of these primitives.

## Operations are classes named `ThingOperation` (not factory functions like actions)

Operations sit beside modes and behaviors (each one already makes a `KeyOperationBehavior`), and the
callable-with-expandos idiom scaled badly for their ~10 props and derived state. So they're
`AbstractOperation` classes, named like `ThingMode` and `ThingSystem`, and called with `run()`. The base
is **not** an `EventEmitter` (operations are one-shot and emit nothing), and it's one superset class with
optional hooks rather than per-op interfaces, because the menu uses them through one array.
`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs` stays (a per-click instance can't remember
the previous cycle); moving it onto a system is in `backlog.md`.

## Network and workers

How it works is in `design/network-system.md` and `design/scheduler-system.md`; these are the rules
someone might break by accident.
- **Three systems:** `SchedulerSystem` decides when to run (frame loop, queues, timers, backpressure),
  `WorkerSystem` where (the pool and the listener registry), `NetworkSystem` handles fetches. The split
  kept one system from passing 1,000 lines.
- **Never record an abort.** An `AbortError` is always a rejection, never an envelope, so an aborted
  request stays retryable: "pan away, pan back reloads the tile" depends on it.
- **Every worker listener returns a `FetchEnvelope<T>`.** A thrown error loses its `.status` crossing
  `postMessage`; the envelope is how the status survives.
- **Only explicit `requestID`s are recorded** in `_completed`, and only `NetworkSystem` writes it. Retry
  is a service's choice: `network.forget(id)` in its catch handler (OSM tiles, Streetside, MapWithAI).
- **An unregistered `listenerID` rejects**; it never falls back to the generic fetch and parse.
- **Auth goes through request interceptors**, on the main thread, so the token never needs to reach a
  worker and the request crosses as plain data. Writes (changesets, notes) stay `mainThread: true`.
- **Workers resolve relative URLs against their own script**, so `NetworkSystem` makes them absolute
  before dispatching.
- **`resultPriority`** resolves a worker's result through the scheduler, so heavy `.then()` chains don't
  blow a frame budget (OSM tile loads use `'normal'`).

## Worker Companion Convention (`*.worker.ts`)

- **`Foo.worker.ts` sits next to `Foo.ts`** and exports its listeners plus a `listeners: ListenerRegistry`;
  each folder's `index.worker.ts` re-exports them. The same functions are registered twice: in the worker
  (through the barrels) and by the service with `worker.registerListener()`, for when there's no worker.
- **Worker-safe by construction:** a `.worker.ts` imports only parsers and utilities, never `Context`,
  systems or the DOM. Results must survive structured clone (return a `ParserResult`, not a `Document`).
- **`Listener` and `ListenerRegistry` are global types** (`global.d.ts`), because they cross bundle
  boundaries.
- **Workers live across `resetAsync`.** Terminating them would race with reset messages and re-parse the
  script; a system that needs worker state cleared sends its own message. Module-level objects in a
  companion file (the OSM parsers) must keep no state between calls.

## UI fields: inheritance over composition

Each concrete field (`UiFieldCheck`, `UiFieldCombo`, …) **`extends UiField`** rather than being an
"internal" object composed by a `UiField` wrapper. The composition was an ES5-era holdover (no real
class inheritance back then). Inheritance removes the wrapper/internal split, the `_internal`/
`_createField()` machinery, the `UiFieldInternal` interface, and the event re-wiring — a field now
emits `change` on itself.

- **Construct fields via `createUiField(context, presetField, …)`** (in `fields/index.ts`), never
  `new UiField(...)`. `UiField` can't be constructed generically anymore — the concrete subclass is
  chosen by `presetField.type`. The factory lives in the registry module so that `UiField` itself does
  NOT import `uiFields` (that would be a load-time circular import, since fields `extends UiField`).
- **Name collisions were the real friction, not the mechanics.** The base wrapper API and the field
  render API shared names, so the field-side ones were renamed: `render`→`renderContent` (base
  `render()` draws the field chrome, then calls `renderContent()` for the input body — mirrors
  `AbstractUiSection`), `tags(t)`→`syncTags(t)` (base keeps the fluent `tags(val?)` getter/setter),
  and the field's `entityIDs(ids)` setter was dropped (the base owns the `entityIDs` array).
  `UiFieldAccess`/`UiFieldCycleway` had an `options(key)` choice-list method that collided with the
  base `options` config object → renamed `_fieldOptions(key)`.
- **`supportsMultiselection` is read off the instance** via `(this.constructor as typeof UiField)`,
  not a registry lookup — another reason `UiField` needs no `uiFields` import.

## UI events: EventEmitter over d3_dispatch/utilRebind

UI classes that emit events extend `EventEmitter` from `tseep/lib/ee-safe`, like systems, modes,
behaviors and `Context`: one event API everywhere, without the d3-dispatch + `utilRebind` boilerplate
(both retired). One wrinkle: `UiCombobox`'s consumers re-register `accept`/`cancel` on every render and
relied on d3-dispatch replacing the listener, so its constructor wraps `on` to remove the old one first
(tseep's `on` is a class field, so it can't be overridden as a method).

## UI primitives are classes when they're owned over time

An earlier pass kept `tooltip`, `modal`, `confirm`, `combobox` and `disclosure` as factory functions
("one-shot builders"). The real test is ownership and lifecycle: ~20 components held a
`public Tooltip: any` and reconfigured it every render. So they're classes now (attach with
`sel.call(tooltip.attach)`). `icon` stays a stateless function.

## Modal stack is owned by `UiSystem`

Each `UiModal` owns its own `.shaded` backdrop; `UiSystem` keeps the stack, and one document handler
sends Esc/Backspace to the top modal only. That's what lets modals nest (the Rapid catalog over the
dataset modal) without the old hacks that patched the parent's `close` and rebuilt its keybindings. On a
system because it's runtime state, and a CLI build without `ui` has no modals.

## HTML sanitizing and the CSP (Jul 2026)

- **Use explicit strict sanitization only at known trust boundaries.** External QA content, notes, remote metadata, Markdown, and reusable HTML widgets pass through Rapid's detached-document allowlist. The sanitizer rejects foreign namespaces and unsafe URL schemes, hardens new-window links, and reparses until serialization is stable. It fails closed to escaped text when DOM parsing is unavailable.
- **Do not install a document-wide Trusted Types default policy.** Rapid's registries and embedding model let extensions own their rendering. A global policy rewrites those extension sinks, and DOMPurify's assumptions did not hold in live Chrome. Keep sanitization local to the core trust boundaries instead.
- **Keep CSP inline scripts hash-based and extension-aware.** `script-src` has no `unsafe-inline`; exact SHA-256 hashes authorize the bootstraps and `strict-dynamic` propagates that trust to registered service scripts. HTTPS styles and fonts remain available to extension assets. The editor documents explicitly opt into `unsafe-eval` because Mapillary JS 4 unconditionally compiles filters with `new Function`; the OAuth callback does not. Core Pixi and event emitters use their no-eval implementations.
- **Refresh CSP hashes after deploy-time rewriting.** The predeploy step regenerates the policy after embedding build data, and `check:csp` catches stale committed policies with the capability options for each document.
