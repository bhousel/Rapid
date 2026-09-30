# Drag-and-Drop System Design

This document proposes a new `DragAndDropSystem` for Rapid: a single, central owner of the browser's
file drag-and-drop handling. Today the drop handler is buried in a Pixi rendering layer and other
components have to fight for (or comment out) their own handlers. Centralizing it gives us one place
to accept dropped files and route them — via a **claim-based registry** — to whichever component
wants them, the same "one owner, everyone else subscribes" pattern we use for
[`UrlHashSystem`](../../modules/core/UrlHashSystem.ts) and
[`KeyboardSystem`](./keyboard-system.md).

The system is deliberately **domain-agnostic**: it knows nothing about GeoJSON, datasets, photos, or
persistence. It categorizes dropped files as a convenience and offers them to registered consumers in
priority order; each consumer decides whether to take (claim) a drop and is responsible for whatever
happens next — parsing, loading, and (if it wants) persisting to
[`DatabaseSystem`](./database-system.md). This keeps `DragAndDropSystem` decoupled from
`DatabaseSystem` entirely.

Follow-on from the `DatabaseSystem` work ([facebook/Rapid#1078](https://github.com/facebook/Rapid/issues/1078)).
Tracking issue: _TBD_.

> **Status:** Implemented (core). `DragAndDropSystem` ships with the claim registry, file
> categorization, container listeners + overlay, and the migrated custom-data consumer. The
> `UiRapidAddDataset` high-priority consumer is **deferred** — that modal's file→dataset flow is
> currently commented-out/URL-only, so wiring a consumer there is a separate feature.

## Problem

Drag-and-drop is currently owned by [`PixiLayerCustomData`](../../modules/pixi/PixiLayerCustomData.ts),
a *rendering layer*. In its constructor it reaches out and claims the global container:

```ts
context.container()
  .attr('dropzone', 'copy')
  .on('dragenter.draganddrop', over)
  .on('dragexit.draganddrop', over)
  .on('dragover.draganddrop', over)
  .on('drop.draganddrop', (e) => { …; this.setFileList(e.dataTransfer!.files); });
```

Problems with this:

- **Wrong owner.** A Pixi layer owning a top-level DOM/browser interaction is a layering violation.
  The layer can't be the single source of truth for "a file was dropped on Rapid."
- **Resource contention.** Anything else that wants dropped files must register its own
  `drop.*`-namespaced handler on the same container and hope the namespacing doesn't collide.
  [`UiRapidAddDataset`](../../modules/ui/UiRapidAddDataset.ts) wanted this and its file-drop code is
  **commented out** — evidence of exactly this fight.
- **No routing.** When a file is dropped, *who* should receive it depends on app state (is the
  "Add Dataset" modal open? the custom-data settings screen? neither?). There's nowhere to make that
  decision today.
- **No persistence hook.** Dropped files are read once and thrown away; a reload loses them. We now
  have `DatabaseSystem.putFileAsync()` to keep them — but the component that *claims* a drop is the
  one positioned to decide whether to persist, and there's no such routing today.
- **Single file type.** Only geo data (`.geojson/.gpx/.kml/.json`) is handled; there's no path for
  future file kinds (images with EXIF, PBF, PMTiles, …).

This is a blocker on the critical path: persisting user files for `RapidSystem` to reuse requires a
proper owner of the drop interaction.

## Goals

1. **One owner** of the container-level drag-and-drop interaction; everything else goes through it.
2. **Claim-based routing** so a drop goes to exactly one consumer (or none), chosen by priority, with
   no broadcast races.
3. **Categorize** dropped files (geo data vs. image vs. other) as a convenience so consumers filter
   cheaply — but consumers may ignore this and inspect `file.name` / `file.type` themselves.
4. **Hand off raw `File`s** (which are `Blob`s) so a claiming consumer can parse and/or persist them
   however it likes. **Persistence is the consumer's responsibility, not the system's.**
5. **Visual feedback** (a drop overlay) owned in one place.
6. **Graceful degradation** — optional system; no-ops cleanly when there's no DOM (CLI/tests).
7. **Migrate** the existing custom-data drop path onto the new system with no loss of behavior.

## Non-Goals (initial scope)

- **Persisting files.** The system never writes to `DatabaseSystem`. A claiming consumer decides
  whether to persist (most will — e.g. the dataset flow — but a "just seeing what happens" drop that
  nobody claims leaves nothing behind).
- **Parsing files.** The system hands off raw `File`s; parsing to GeoJSON stays in `RapidDataset` /
  `PixiLayerCustomData` (and, later, EXIF parsing in a photo consumer).
- **Default handling of unclaimed drops.** If no consumer claims a drop, **nothing happens** (quietly).
  Today's "load into the custom-data layer" behavior becomes just a *low-priority registered
  consumer*, not special system policy. (A future `RapidSystem` could register a smart fallback that
  sniffs PDFs/CSVs for geodata, but that's far off.)
- The `<input type="file">` picker flows (custom-data settings, etc.) — those already work and can
  *optionally* share the accept ruleset later, but aren't required.
- Dragging *out* of Rapid, or drag-reordering within the UI (that's local to specific components).
- Text/URL drops (drop of a link or selection). Possible later; files first.

## Current State (what moves)

| Concern | Today | After |
|---|---|---|
| Container `drop`/`dragover` handlers | `PixiLayerCustomData` constructor | `DragAndDropSystem` |
| Reading the `FileList` | `PixiLayerCustomData.setFileList` | still there, but **fed by a claimed drop** |
| "Add Dataset" wanting drops | commented-out handler | registers a high-priority consumer |
| "Load into custom-data" default | implicit in the layer's own handler | a *low-priority* registered consumer |
| Persisting the file | nowhere | the **claiming consumer** calls `DatabaseSystem` if it wants to |
| Drop overlay / feedback | `dropzone=copy` attr only | system-owned overlay |

## Design

### Ownership and lifecycle

- `DragAndDropSystem extends AbstractSystem`, id `'dragdrop'`, registered in
  [`modules/core/index.ts`](../../modules/core/index.ts) and typed in
  [`modules/core/types.ts`](../../modules/core/types.ts) as `context.systems.dragdrop`.
- It attaches its listeners to `context.container()` in **`startAsync`** (after `UiSystem` has built
  the container) and detaches in `destroy()`. The drop target is the **entire container**, as today.
- Optional dependencies: `gfx`/`map` (to convert a drop's screen point to a map coordinate, for image
  markers later), `ui` (overlay). Captured-and-branched; the system works without them. **Note there
  is no `database` dependency** — persistence is a consumer concern, so the system stays decoupled
  from `DatabaseSystem`.
- It is itself an **optional system**: in a non-browser/CLI build or tests without a DOM, `startAsync`
  is a no-op and the API degrades to "nothing gets dropped."

### File categorization (a convenience)

The system tags each dropped `File` by a small, extension+MIME driven classifier so consumers don't
each re-implement it. It is **advisory** — a consumer may ignore `kind` and inspect `file.name` /
`file.type` itself.

```ts
type DroppedFileKind = 'data' | 'image' | 'other';

interface DroppedFile {
  file: File;                 // the raw File (a Blob) — unparsed, un-persisted
  kind: DroppedFileKind;      // advisory categorization
  extension: string;          // lowercased, incl. dot, e.g. '.geojson'
}
```

- `'data'` — `.geojson`, `.json`, `.gpx`, `.kml`, and (future) `.pbf`, `.pmtiles`.
- `'image'` — `.jpg/.jpeg`, `.png`, `.heic`, `.tif/.tiff`, …
- `'other'` — anything else.

The accept/classification lists live in one place on the system (a ruleset), replacing the
duplicated `ACCEPT` arrays in `UiSettingsCustomData` and the commented block in `UiRapidAddDataset`.

### Routing — the claim-based registry

*When a file is dropped, who gets it?* Broadcasting to everyone causes races (the modal **and** the
custom-data layer both act). Instead, consumers **register** with a priority, and on drop the system
offers the payload to them **one at a time, highest priority first**, until one **claims** it —
mirroring DOM `stopPropagation`.

Crucially, a consumer decides to claim **after inspecting** the files (your flow: "process the file,
do the checks it needs, *then* decide whether to claim"). A consumer may inspect a file and **decline**
(e.g. malformed GeoJSON), letting the next consumer try. So `handle` may be **async** and the system
awaits it before checking whether it claimed:

```ts
interface DropPayload {
  files: DroppedFile[];       // all dropped files, categorized
  data: DroppedFile[];        // convenience: kind === 'data'
  images: DroppedFile[];      // convenience: kind === 'image'
  point: Vec2;                // screen coords of the drop
  loc?: Vec2;                 // map lng/lat at the drop point, if gfx/map present
  claim(): void;              // the consumer calls this to take the drop
  readonly claimed: boolean;
  originalEvent: DragEvent;
}

interface DropConsumer {
  id: string;
  priority: number;                              // higher is offered first
  accepts?: (p: DropPayload) => boolean;         // optional cheap sync pre-filter (by kind/ext)
  handle: (p: DropPayload) => void | Promise<void>;  // inspect, maybe claim (+ maybe persist)
}
```

Routing loop:

```ts
for (const consumer of sortedByPriorityDesc) {
  if (consumer.accepts && !consumer.accepts(payload)) continue;  // skip obviously-irrelevant
  await consumer.handle(payload);                                // may parse / validate / persist
  if (payload.claimed) break;                                    // first claimer wins
}
// if nobody claimed → nothing happens (quietly)
```

Registration API:

```ts
dragdrop.register({
  id: 'rapid-add-dataset',
  priority: 100,                       // modal beats the always-on custom-data consumer
  accepts: (p) => p.data.length > 0,   // only interested in geo-data drops
  async handle(p) {
    const file = p.data[0].file;       // grab the first understood file (goal #5)
    const ok = await tryParseGeojson(file);
    if (!ok) return;                   // decline — let a lower-priority consumer try
    p.claim();                         // take it
    await context.systems.database?.putFileAsync(file);   // consumer's choice to persist
    // …load it into the modal…
  }
});
dragdrop.unregister('rapid-add-dataset');
```

Notes / tradeoffs:

- **Sequential await:** a slow high-priority `handle` delays lower-priority consumers. Consumers
  should validate cheaply and either claim quickly or defer heavy work until after claiming. Use the
  sync `accepts` pre-filter to avoid calling `handle` at all for irrelevant drops.
- **Grab-the-first:** today's consumers take the first file they understand (`p.data[0]`); the system
  passes **all** dropped files so a future consumer can process a mixed bag.
- **Concurrency:** if a second drop arrives while one is being processed, the system queues it (or
  ignores drops while a `handle` chain is running — TBD, minor).

Worked examples:

- **"Add Dataset" modal is open** → it registered a high-priority `accepts: data` consumer at render,
  unregistered on close. A dropped `.geojson` is offered to the modal first; it parses, `claim()`s,
  and (its choice) persists via `DatabaseSystem`. The custom-data consumer never sees it.
- **No modal open** → the always-on, low-priority **custom-data consumer** is the only one that
  accepts `data`; it claims the first understood file and calls `setFileList` (unchanged UX). It may
  also choose to persist.
- **A `.txt` dropped by accident** → no consumer's `accepts` matches (or none claims). **Nothing
  happens** — no persistence, no residue.
- **An image is dropped** (no photo consumer yet) → nobody claims → nothing happens. When a future
  photo consumer exists, it claims images and does its own EXIF/persist work.

> Alternative considered: plain broadcast with each consumer checking its own visibility. Rejected —
> it scatters the "am I the right target?" decision and reintroduces races. The claim registry keeps
> priority explicit and central, and (per review) we build it from the start.

### Drag feedback + visual overlay

The system tracks drag enter/leave on the window and owns a single drop **overlay** (a full-container
element shown while a drag is in progress, hidden on drop/leave), replacing the bare `dropzone="copy"`
attribute. It also emits `dragstart` / `dragend` events for any component that wants to react. Follows
the UI-component rules (localized text on the update selection, etc.). Optional — skipped if `ui`
isn't present. (File routing is done entirely through the claim registry, **not** through an
`EventEmitter` "drop" broadcast — one mechanism, no races.)

## Migration (files touched)

1. ✅ **New:** `modules/core/DragAndDropSystem.ts` (+ registration in `index.ts`/`types.ts`,
   `headless.js` export), `dragdrop.drop_files` l10n string, `.dragdrop-overlay` CSS, and unit tests
   in `test/unit/core/DragAndDropSystem.test.js`.
2. ✅ **`PixiLayerCustomData`:** deleted the constructor's container drop handlers; now registers a
   persistent **low-priority** (`priority: 0`) consumer that `accepts` data drops, claims, and calls
   `setFileList(payload.fileList)` — behavior-identical to the old handler. Parsing unchanged.
   (For today the Pixi layer registers directly; moving that ownership to a real system later is the
   open question below — a mild smell we accepted for now.)
3. ⏸ **`UiRapidAddDataset` (deferred):** its file→dataset flow is commented-out/URL-only today, so a
   high-priority consumer there is a separate feature. Left untouched.
4. **`UiSettingsCustomData`:** unchanged (its `<input type=file>` still works); later it can share the
   system's accept ruleset and could route its `FileList` through `dragdrop.dropFilesAsync`.
5. ✅ **Accept/classification ruleset:** centralized on the system (`DATA_EXTENSIONS` /
   `IMAGE_EXTENSIONS` + MIME checks).

## Testing

- Unit-test the classifier (extension/MIME → kind) and the **claim/priority ordering** with synthetic
  payloads (no DOM needed): higher priority offered first; a consumer that declines (doesn't claim)
  falls through to the next; the first claimer stops the chain; unclaimed leaves everything untouched.
- Test that `accepts` pre-filters skip `handle`, and that async `handle` is awaited before the claim
  check.
- Simulate a `drop` by feeding a `DataTransfer`-like object; assert categorization and which consumer
  claimed.
- Guard the no-DOM path (`startAsync` no-op).
- Follow the project's "meaningful assertions" rule (assert on which consumer claimed / the files it
  received, not `assert.isTrue(true)`).

## Stretch Goal — dropped images → EXIF → photo markers

People have asked to drop image files onto Rapid, read their EXIF GPS, drop markers where the photos
were taken, and open them in the existing photo viewer (like Mapillary/Kartaview/Streetside do).

`DragAndDropSystem` is the enabling piece. A future **local-photos consumer** (a small service +
photo layer, sibling to the existing photo services) would:

1. Register an `accepts: (p) => p.images.length > 0` consumer.
2. Read EXIF GPS/orientation from each image `Blob`, `claim()`, and (its choice) persist the images
   via `DatabaseSystem` so they survive a reload.
3. Create markers at each photo's location using the same marker mechanism the photo layers use, and
   wire clicks to the existing photo viewer (`PhotoSystem`), pointing at a local `blob:` URL.

Out of scope here, but the `kind: 'image'` categorization and the `loc` on the drop payload are
designed so this drops in cleanly later — and because persistence is the consumer's job, the photo
consumer owns its own storage decisions.

## Resolved Decisions (from review)

- **Claim registry from the start** (not an event-first stopgap). Priority-ordered consumers, first
  claimer wins, `accepts` sync pre-filter + async `handle`.
- **Unclaimed drops do nothing**, quietly. No default system policy; "load into custom-data" is just
  the lowest-priority registered consumer.
- **Persistence is the consumer's responsibility**, never the system's. `DragAndDropSystem` has **no
  `DatabaseSystem` dependency** and stores nothing itself.
- **No `record`/auto-persist on the payload.** A claiming consumer calls `DatabaseSystem` if it wants.
- **Pass all dropped files**; consumers grab the first they understand today, and can handle a mixed
  bag later.

## Open Questions (smaller, for review)

1. **Who registers the custom-data consumer** — `PixiLayerCustomData` itself (it already owns
   `setFileList`), or `RapidSystem` on its behalf? Leaning the layer, since it owns the state; but a
   Pixi layer registering an app-level consumer is a mild smell, so `RapidSystem` is defensible.
2. **Concurrent drops:** queue a second drop that arrives mid-`handle`, or ignore it? (Minor.)
3. **Overlay scope:** a single "drop files here" overlay, or per-consumer hints (e.g. the Add-Dataset
   modal highlighting itself)? Start with one overlay.
