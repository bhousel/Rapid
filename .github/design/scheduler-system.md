# Scheduler System Design

This document describes the design for Rapid's centralized work scheduling system, including the frame-aware execution model, task types, backpressure management, and migration path from the current ad-hoc scheduling.

## Problem

Rapid is a map editor built on a **game loop** — a Pixi.js Ticker calling `requestAnimationFrame` to render the map at a consistent frame rate. The target frame budget is 16.7ms (60fps) or 33.3ms (30fps).

Today, deferred work is scheduled against the **browser's event loop** using raw `setTimeout`, `setInterval`, `requestIdleCallback`, and lodash `debounce`/`throttle`. These mechanisms fire whenever the browser decides — potentially right in the middle of a frame that GraphicsSystem is trying to render. Every interruption eats into the frame budget.

Current pain points:
- **~26 `setTimeout` call sites** with manual handle tracking and cleanup
- **~30 lodash `debounce`/`throttle` wrappers** each needing manual `.cancel()` in lifecycle methods
- **No coordination** between rendering and background work (validation, spatial indexing, network responses)
- **No backpressure** — when the render loop falls behind, background work keeps piling on
- Some UI code clumsily combines `debounce` + `requestIdleCallback` to approximate "run this later, but not during rendering"

## Goals

1. **Single coordination point** — All deferred work routes through SchedulerSystem, which decides *when* work actually runs relative to the render loop
2. **Frame-budget-aware** — Background tasks run in leftover frame time, never stealing from rendering
3. **Backpressure** — When frames are dropping, the scheduler defers non-essential work automatically
4. **Familiar API** — Callers schedule work using wall-clock semantics (`setTimeout`, `debounce`, etc.), while the scheduler handles the timing internally
5. **Lifecycle management** — All managed work auto-cancels on `resetAsync()`, eliminating manual handle tracking
6. **Worker-ready** — The same API can route work to web workers when the task doesn't need main-thread access

## Non-Goals (for now)

- Preemptive task interruption — tasks run to completion once started
- Sub-frame phase budgeting (splitting APP into geometry/labels/styles) — a future concern for GraphicsSystem, not the scheduler

## Design

### Ownership of the Game Loop

Today, GraphicsSystem owns a `PIXI.Ticker.shared` instance that drives a `requestAnimationFrame` loop. The ticker is used minimally: `ticker.start()`, `ticker.stop()`, `ticker.deltaMS`, and a single registered listener (`_tick`). No other system accesses it.

**Under this design, SchedulerSystem owns the game loop.** It calls `requestAnimationFrame` directly and orchestrates each frame. GraphicsSystem becomes a *client* of the scheduler — it registers a render callback, and the scheduler calls it with a budget.

This replaces `PIXI.Ticker` entirely. The features we used from it (`deltaMS`, start/stop, FPS) are trivial to compute ourselves, and owning the loop gives the scheduler full control over frame timing, budget allocation, and backpressure — which is the whole point.

```
scheduler._onFrame(timestamp)          ← owns the rAF
  ├─ compute deltaMS, record frame start
  ├─ gfx._tick(frameBudgetMs)          ← scheduler calls graphics
  │   ├─ _tform()                      — transform easing, viewport sync
  │   ├─ _app()                        — scene graph updates
  │   └─ _draw()                       — pixi.render()
  ├─ mature expired timers into idle queue
  ├─ drain idle queue with remaining budget
  │   ├─ urgent tasks first
  │   ├─ normal tasks
  │   └─ idle tasks (only if budget permits)
  └─ record frame metrics, update backpressure
```

**Boundary**: The scheduler owns *when* work happens. GraphicsSystem owns *what* rendering work to do. The scheduler doesn't import Pixi or know about the scene graph. GraphicsSystem doesn't call `requestAnimationFrame` or track frame timing.

**Frame rate target**: The scheduler owns the target frame rate and computes the per-frame budget. It can dynamically adjust (e.g., drop from 60fps to 30fps under heavy pressure). GraphicsSystem's existing `THROTTLE = 250ms` logic (skip rendering for 250ms after each draw) stays in GraphicsSystem — that's a rendering concern about how often to re-prepare the scene graph, not a frame-timing concern.

**Context loss**: When WebGL context is lost, GraphicsSystem calls `scheduler.pause()` (which it already supports via the reference-counted pause/resume mechanism). On context restore, it releases the pause. The scheduler stops the rAF loop while paused and resumes it on unpause.

**Lifecycle**: The rAF loop starts in `startAsync()` and stops on `pause()`. Since SchedulerSystem has no required dependencies, it can start very early — before GraphicsSystem is even initialized. The loop simply has nothing to do until render callbacks are registered.

### Task Types

#### 1. Timeout — "run once, after a wall-clock delay"

Replaces `setTimeout`. The task fires at the first idle opportunity *at or after* the specified delay — not exactly at the delay. This is "do this ASAP after 250ms" rather than "do this at 250ms".

```typescript
scheduler.setTimeout(workID, fn, { ms: 250 });
```

- `workID` — string key for tracking/cancellation
- After `ms` elapses, the task moves into the idle queue and runs when budget permits
- Returns a cancel function
- Auto-cancelled on `resetAsync()`

#### 2. Interval — "run repeatedly, about every N ms"

Replaces `setInterval`. Each tick moves into the idle queue after the interval elapses, so execution may float slightly.

```typescript
scheduler.setInterval(workID, fn, { ms: 1000 });
```

- Same float behavior as timeout — runs at next idle opportunity after each interval
- Returns a cancel function
- Auto-cancelled on `resetAsync()`

#### 3. Debounce — "run after N ms of stability"

Replaces lodash `debounce`. Each call resets the timer. After `ms` of no calls, the task enters the idle queue.

```typescript
scheduler.debounce(workID, fn, { ms: 250 });
```

- Subsequent calls with the same `workID` reset the timer and replace `fn`
- The `workID` key provides natural deduplication — no need for callers to track a debounced wrapper function
- Supports `leading` option (fire immediately on first call, then debounce)
- Auto-cancelled on `resetAsync()`

#### 4. Throttle — "run no more than once per N ms"

Replaces lodash `throttle`. Coalesces rapid calls, ensuring the function runs at most once per interval.

```typescript
scheduler.throttle(workID, fn, { ms: 500 });
```

- First call executes (or schedules for next idle); subsequent calls within the window are dropped
- The last trailing call fires after the window expires
- `workID` provides deduplication
- Auto-cancelled on `resetAsync()`

#### 5. Schedule — "generic task with priority"

The general-purpose API. Callers specify priority to indicate urgency.

```typescript
scheduler.schedule(workID, fn, { priority: 'idle' });
```

**Priorities:**

| Priority | Meaning | When it runs |
|----------|---------|-------------|
| `'urgent'` | Must run this frame if possible | Before idle work, within remaining budget |
| `'normal'` | Run when convenient | During idle phase, respects budget |
| `'idle'` | Run whenever there's spare time | Only when frames are consistently under budget |

This covers the `requestIdleCallback` use case (`'idle'` priority) and could eventually cover `requestAnimationFrame`-like scheduling (`'urgent'` priority) for work that needs to happen every frame but isn't part of the core render.

### The `workID` Pattern

Every scheduled task has a string `workID`. This serves several purposes:

1. **Cancellation** — `scheduler.cancel(workID)` cancels by name instead of tracking opaque handles
2. **Deduplication** — scheduling the same `workID` again replaces the pending task (for debounce/throttle this is intrinsic; for schedule/timeout it could optionally replace)
3. **Debugging** — `scheduler.debugPending()` returns a list of pending work with human-readable names
4. **Profiling** — the scheduler can track per-`workID` timing statistics (average duration, frequency)

Callers choose descriptive IDs: `'validation-ui-render'`, `'hash-update'`, `'taginfo-request'`, `'osm-api-status'`.

### Idle Work Execution

After rendering completes each frame, the scheduler drains its idle queue with whatever budget remains:

```typescript
private _drainIdleQueue(deadline: number): void {
  // Drain by priority: urgent, then normal, then idle
  for (const queue of [this._urgentQueue, this._normalQueue, this._idleQueue]) {
    while (queue.length > 0) {
      const next = queue[0];

      // Check if we have enough budget for this task
      const estimatedDuration = this._taskStats.get(next.workID)?.avgDuration ?? 1;
      if (performance.now() + estimatedDuration > deadline) return;

      // Run it
      queue.shift();
      const start = performance.now();
      next.fn();
      const elapsed = performance.now() - start;

      // Update running average for this workID
      this._updateTaskStats(next.workID, elapsed);
    }
  }
}
```

The scheduler maintains an exponential moving average of each `workID`'s execution time. Before starting a task, it checks whether the estimated duration fits in the remaining budget. If not, the task waits for the next frame. Urgent tasks always drain before normal, and normal before idle.

### Backpressure

The scheduler tracks frame timing to detect when the system is under pressure:

```typescript
interface FrameMetrics {
  avgFrameTime: number;      // Exponential moving average of total frame time
  avgRenderTime: number;     // EMA of APP + DRAW time
  avgIdleTime: number;       // EMA of idle work time
  droppedFrames: number;     // Count of frames exceeding budget in recent window
  targetFrameTime: number;   // Current target (16.7ms or 33.3ms)
}
```

**Responses to backpressure:**

1. **Light pressure** (occasional dropped frames) — Reduce idle work per frame, allow tasks to float longer
2. **Moderate pressure** (consistent drops) — Stop running idle tasks entirely, let rendering catch up
3. **Heavy pressure** (sustained frame drops) — Signal GraphicsSystem to reduce quality (`highQuality = false`), throttle expensive tasks
4. **Recovery** — When frames are consistently under budget again, gradually allow idle work back in

The scheduler emits events so other systems can react:

```typescript
scheduler.on('pressurechange', (level: 'light' | 'moderate' | 'heavy' | 'none') => { ... });
```

### Timer Float

A key design decision: managed timeouts and intervals don't fire at their exact wall-clock time. Instead, when the timer expires, the task enters the idle queue and runs at the next opportunity within the frame budget.

For a `scheduler.setTimeout(id, fn, { ms: 250 })`:
1. At t=0, the scheduler records the deadline (now + 250ms)
2. Each frame, the scheduler checks expired timers before running the idle queue
3. At t=250ms (or the first frame after), the task moves to the idle queue
4. The task runs when budget permits — likely within the same frame, worst case next frame

This "float" means actual execution is 250ms + 0–16ms, which is fine for all current use cases (UI debouncing, deferred renders, API polling). The benefit is that the work doesn't interrupt a frame in progress.

Code that truly needs exact wall-clock timing (e.g., long-press detection at 750ms in SelectBehavior) should use `globalThis.setTimeout` directly — there's no need to opt into the scheduler for those cases.

### Worker Scheduling (Future)

The same API naturally extends to worker-based execution:

```typescript
scheduler.schedule('validate-entities', fn, {
  priority: 'idle',
  thread: 'worker'    // run off the main thread
});
```

For worker tasks, `fn` can't close over main-thread state. The scheduler would:
1. Serialize the task's input data
2. Post it to a managed worker
3. Receive the result and invoke a callback on the main thread (during idle time)

This is a future concern but the API and queue structure should accommodate it from the start.

## Migration Path

### Phase 1 — Foundation (done)

SchedulerSystem exists with managed `scheduleIdleTask`, `scheduleTimeout`, and `scheduleInterval`. Auto-cleanup on `resetAsync()`. All `requestIdleCallback` usage migrated from callers.

### Phase 2 — Own the Game Loop (done)

- SchedulerSystem owns the `requestAnimationFrame` loop via `_onFrame(timestamp)`
- Computes `deltaMS` (capped at 100ms) and exposes it via a getter
- Frame callback registration API: `addFrameCallback(id, fn)` / `removeFrameCallback(id)`
- GraphicsSystem registers `_tick(deltaMS)` as a frame callback instead of using `PIXI.Ticker`
- `PIXI.Ticker.shared` is stopped but no longer used — the scheduler is the sole rAF owner
- Loop stops on `pause()`, restarts on `resume()` (via event handlers)
- WebGL context loss/restore handled through GraphicsSystem's own pause/resume
- Added `requestAnimationFrame`/`cancelAnimationFrame` polyfill for test environments
- 60 tests passing (12 new game loop tests)

### Phase 3 — Frame-Aware Idle Execution (done)

- Replaced `requestIdleCallback`/`cancelIdleCallback` backing with internal priority queues
- Three queues drained per-frame in priority order: urgent > normal > idle
- New `schedule(fn, opts)` API with `{ priority: 'urgent' | 'normal' | 'idle' }` (default: `'normal'`)
- `scheduleIdleTask(fn)` is now a convenience wrapper for `schedule(fn, { priority: 'idle' })`
- Urgent tasks always drain (even if over budget); normal and idle respect the frame budget
- `targetFrameTime` property (default ~16.7ms / 60fps) controls the per-frame deadline
- No more `requestIdleCallback` / `cancelIdleCallback` usage — tasks accumulate in queues
  naturally while paused and drain when the game loop resumes
- Removed `_scheduleOne`, `_drainPending`, `_idleTasks`, `_pendingTasks`
- Error handling: throwing tasks reject their Promise; subsequent tasks still drain
- Task duration tracking (EMA per `workID`) deferred to Phase 4 when workIDs are introduced
- 72 tests passing (12 new: schedule API, priority ordering, error handling, targetFrameTime)

### Phase 4 — Unified Timer API with `workID` (done)

- New workID-keyed timer methods: `setTimeout(workID, fn, opts)`, `setInterval(workID, fn, opts)`,
  `debounce(workID, fn, opts)`, `throttle(workID, fn, opts)`
- **Timer float**: when a timer matures, its task enters the priority queue and runs at the
  next frame's drain phase — never mid-frame.  ~0–16ms float, acceptable for all use cases.
- `cancel(workID)` cancels both the timer entry and any queued tasks bearing that workID
- `cancelAllTimers()` cancels all workID-keyed timers.  `resetAsync()` calls both
  `cancelAllTimers()` and the legacy `cancelAllTimeouts()`/`cancelAllIntervals()`.
- `debounce`: `leading: true` option fires immediately on first call, then debounces
- `throttle`: fires on leading edge, saves trailing call, cleans up automatically when idle
- Internal helpers: `_enqueue(fn, priority, workID)` for fire-and-forget queue pushes,
  `_removeFromQueues(workID)` for cancel cleanup, `_throttleWindowExpired(entry)` for
  throttle window chaining
- Legacy `scheduleTimeout`/`scheduleInterval` (Phase 1) retained for backward compat —
  they have zero external callers, only tests
- 27 lodash debounce/throttle call sites across UI, services, and core identified for
  future migration
- QueuedTask and ScheduleOptions now support optional `workID` field
- 98 tests passing (26 new: setTimeout, setInterval, debounce, throttle, cancel,
  cancelAllTimers, priority, replacement, leading/trailing, cleanup)

### Phase 4a — Migrate Callers ✅

All 16 files with lodash `debounce`/`throttle` migrated to use SchedulerSystem's workID-keyed API:

**TypeScript core/services (6 files):**
- `EditSystem.ts` — `debounce('edit-backup', ..., { ms: 1000 })`
- `Map3dSystem.ts` — `throttle('map3d-redraw', ..., { ms: 50 })`
- `UrlHashSystem.ts` — `throttle('urlhash-update-hash/title', ..., { ms: 500, leading: false })`
- `OsmService.ts` — `throttle('osm-reload-api-status', ..., { ms: 500 })`
- `TaginfoService.ts` — `debounce('taginfo-request', ..., { ms: 300 })`
- `OsmWikibaseService.ts` — `debounce('osmwikibase-request', ..., { ms: 500 })`

**JavaScript UI class-based (10 files):**
- `UiScale.js` — `throttle('UiScale-updateScale', ..., { ms: 100 })`
- `UiContributors.js` — `throttle('UiContributors-render', ..., { ms: 1000 })`
- `UiSidebar.js` — `throttle('UiSidebar-hover', ..., { ms: 200 })`
- `UiAttribution.js` — `throttle('UiAttribution-render', ..., { ms: 400, leading: false })`
- `UiFilterStatus.js` — `throttle('UiFilterStatus-render', ..., { ms: 1000 })`
- `UiHistoryCard.js` — `debounce('UiHistoryCard-render', ..., { ms: 250 })`
- `UiBackgroundCard.js` — `debounce('UiBackgroundCard-render/updateMetadata', ..., { ms: 250 })`
- `UiLocationCard.js` — `debounce('UiLocationCard-updateLocation', ..., { ms: 1000 })`
- `UiUndoRedoTool.js` — `throttle('UiUndoRedoTool-render', ..., { ms: 500 })`
- `UiDrawModesTool.js` — `throttle('UiDrawModesTool-render', ..., { ms: 500 })`

**JavaScript UI function-scoped (6 files):**
- `react_container.jsx` — `debounce('ReactContainer-render', ..., { ms: 1000 })`
- `validation_issues.js` — `debounce('ValidationIssues-render', ..., { ms: 500 })`
- `validation_status.js` — `debounce('ValidationStatus-render', ..., { ms: 1000 })`
- `background_list.js` — `throttle('BackgroundList-mapDraw', ..., { ms: 1000 })`
- `overlay_list.js` — `throttle('OverlayList-mapDraw', ..., { ms: 1000 })`
- `preset_list.js` — `debounce('PresetList-searchInput', ...)`

Migration notes:
- Added `leading` option to `scheduler.throttle()` (default `true`)
- lodash `debounce(..., { leading: true, trailing: true })` → `scheduler.throttle()` (semantically equivalent for continuous event handling)
- Functions that accepted arguments (e.g. `UiSidebar.hover(target)`, `UiLocationCard._deferredUpdateLocation(loc)`) use closure capture
- Zero lodash debounce/throttle imports remain
- **Scheduler fallback pattern**: Service request paths (TaginfoService, OsmWikibaseService, OsmService) use `if (shouldDebounce && scheduler) { scheduler.debounce(...) } else { request() }` so requests still fire when scheduler is absent. UI render deferrals use `scheduler?.throttle()` — a no-op is harmless there.
- `scheduler` added to `optionalDependencies` in OsmService, TaginfoService, OsmWikibaseService

### Phase 5 — Backpressure (done)

- Frame timing metrics tracked via EMA: total frame time, render time, idle time
- Dropped-frame ring buffer (60-frame window ≈ 1 second at 60fps)
- Four pressure levels: `none` → `light` → `moderate` → `heavy`
- Hysteresis thresholds prevent oscillation (escalation thresholds > recovery thresholds)
- Idle queue draining automatically throttled under pressure:
  - `none`: unlimited idle tasks per frame
  - `light`: max 3 idle tasks per frame
  - `moderate`: max 1 idle tasks per frame
  - `heavy`: idle tasks blocked entirely
- `pressure` event emitted on level changes
- `metrics` getter exposes `FrameMetrics` snapshot (avgFrameTime, avgRenderTime,
  avgIdleTime, droppedFrames, targetFrameTime, pressure)
- Dynamic frame rate adjustment (drop to 30fps) and GraphicsSystem quality wiring
  deferred — `highQuality` is only read at Pixi renderer initialization, so toggling
  it at runtime requires re-creating the renderer (a separate concern)
- 117 tests passing (19 new backpressure tests)

### Phase 6 — Worker Pool Integration (done)

- New `modules/worker.ts` entry point — loads inside Web Workers spawned by
  WorkerSystem.  Uses `registerListener(listenerID, listener)` registry pattern.
  Built-in `ping` listener for health checks.  Supports async listeners.
- Message protocol: Main→Worker `{ id, listenerID, data }`, Worker→Main `{ id, result?, error? }`
- Worker pool management on WorkerSystem:
  - `workerURL` getter/setter — host app sets path to built worker script
  - `maxWorkers` getter/setter — pool size cap (default 2), lazy spawn
  - `numWorkers`, `numPendingRequests` — read-only diagnostics
  - `dispatch<T>(listenerID, data?, signal?, options?)` — dispatch to pooled worker, returns `Promise<T>`.
    Accepts an `AbortSignal` to cancel in-flight tasks and `DispatchOptions` for deferred
    result resolution (`resultPriority`).
  - `terminateWorkers()` — tear down pool, reject pending requests
- Workers spawned lazily on first task, dispatched round-robin
- `resetAsync()` calls `terminateWorkers()` automatically
- Build: two new `Bun.build()` entry points produce `rapid-worker.js` and
  `rapid-worker.min.js` in `dist/js/`
- 135 tests passing (18 new worker pool tests)

### Phase 6a — Network offloading to workers

**Full design**: See `.github/design/network-system.md`.

Move fetch-and-parse work from services into the worker pool via a new
`NetworkSystem` that centralizes fetch lifecycle management — request
dispatch (via worker pool), inflight tracking, deduplication, timeouts,
concurrency limiting, and abort.

Prerequisite SchedulerSystem changes for Phase 6a:
- **Worker-side abort** — extend the message protocol with `{ type: 'cancel', id }`
  messages.  Worker entry point (`worker.ts`) maintains a
  `Map<requestID, AbortController>`; listeners receive an `AbortSignal`.
  When a cancel message arrives, the worker aborts the in-progress fetch.
  This prevents worker starvation when the user pans (dozens of stale tile
  fetches would otherwise block the pool).
- **`dispatch` accepts `AbortSignal`** — callers pass a signal;
  when it fires, the worker system sends the cancel message to the worker and
  rejects the pending promise.
- All worker tasks become abortable via this generic mechanism.

**Migration tiers** (by service difficulty):

| Tier | Services | Notes |
|------|----------|-------|
| Easy | WikipediaService, WikidataService, TaginfoService, OsmWikibaseService, NominatimService, GeoScribbleService | Pure JSON fetch + minimal post-processing |
| Medium | WaybackService, MapRouletteService, OsmoseService, KeepRightService | Stateful coordination (pagination, split GET/POST) |
| Hard | MapillaryService, VectorTileService, OsmService, EsriService, MapWithAIService, StreetsideService, KartaviewService | Complex post-processing, binary parsing, auth, graph integration |

**Easy + Medium tiers: done.** All 10 services migrated. Each adds `'network'`
to `requiredDependencies`.  Inflight tracking caches (`_inflight`, `inflightTile`,
`inflightPost`) removed from individual services — NetworkSystem owns all inflight
state.  `abortMatching` predicates use regex `.test()` (~10% faster than
`startsWith`/`includes` per jsbench).  `key` renamed to `requestID` with
`RequestID` global string ID type.  Tests updated (8 test files).  2939 tests pass.

**Hard tier — OsmService: done.** OsmService `loadFromAPI` dispatches to a
dedicated `osmService:fetchAndParse` listener on the worker via
`listenerID` + `listenerData`.  Parsing (`OsmJSONParser`/`OsmXMLParser`)
runs on the worker; parser instances are module-scoped in
`OsmService.worker.ts`.  Result envelope pattern (`OsmFetchResult`) returns
HTTP error details (status, body text) without throwing, so the main thread
can branch on status codes.  Write operations (changeset, notes) remain
`mainThread: true`.

### Phase 6b — Deferred worker result resolution (done)

Worker `onmessage` resolves promises immediately, which triggers `.then()`
chains as microtasks.  Microtasks are non-preemptible — the browser must
drain them all before the next `requestAnimationFrame`.  When multiple tile
results arrive in one frame, the cascading main-thread work (entity
construction via `createOsmEntity`, `graph.rebase`, `tree.rebase` — ~11ms
per tile) blows the frame budget.

Fix: `WorkerSystem.dispatch()` accepts `DispatchOptions.resultPriority`
(`'urgent' | 'normal' | 'idle'`).  When set, the result is deferred through
`scheduler.schedule()` instead of resolving immediately.  Each deferred
result gets its own slot in `_drainQueues`, so the frame loop can check the
budget and yield between results.  When `SchedulerSystem` is not available
(tests, CLI), resolution is immediate — no worse than before.

Wired through `NetworkFetchOptions.resultPriority` →
`NetworkSystem._dispatchFetch()` → `worker.dispatch(_, _, _, { resultPriority })`.
OsmService tile loading uses `resultPriority: 'normal'`.

### Phase 7 — Validator offloading (future)

Validators close over `context` at construction time (factory pattern), making
them non-serializable.  Moving validation into workers requires restructuring
validators to accept serializable input and return serializable results — the
validator logic itself would run as a registered listener, receiving a
snapshot of the relevant graph data rather than accessing `context` directly.

This is a worthwhile goal (validation is CPU-heavy and blocks the main thread)
but requires significant refactoring of the validator architecture.

## Decisions

Resolved design questions (kept for context):

1. **`debounce`/`throttle` use the `workID` pattern**, not callable wrappers. Departing from the lodash convention keeps things consistent within Rapid — callers pass `(workID, fn, opts)` rather than holding onto a wrapped function.

2. **Pause/resume affects all task types.** When the scheduler is paused, the game loop stops entirely — no timers fire, no idle work drains. Callers that truly need wall-clock timing can still use `window.setTimeout` directly; the SchedulerSystem is opt-in.

3. **Urgent tasks always preempt** normal and idle. Starvation of idle tasks is acceptable by definition.

4. **SchedulerSystem owns the game loop and the target frame rate.** It replaces `PIXI.Ticker` entirely (Option A — roll our own `requestAnimationFrame` loop). The Pixi Ticker was used for very little (`deltaMS`, start/stop, one listener), and owning the loop gives the scheduler full control over frame timing, budget, and backpressure. See "Ownership of the Game Loop" section above.

5. **"Game loop"** is the term of art for the `requestAnimationFrame` loop throughout code and docs.

## Open Questions

1. **Frame callback registration API** — Should GraphicsSystem call `scheduler.addFrameCallback(fn)` to register, or should the scheduler call `gfx._tick()` directly? The callback approach is more decoupled (any system could register frame work), but direct calling is simpler and GraphicsSystem is the only consumer for now. Leaning toward callback registration for extensibility.

2. **Render throttle interaction** — GraphicsSystem currently throttles rendering to every 250ms via `_timeToNextRender`. With the scheduler owning frame timing, should this logic move to the scheduler (as a render-specific policy), or stay in GraphicsSystem (since it's a rendering concern)? Leaning toward keeping it in GraphicsSystem — the scheduler provides the budget, GraphicsSystem decides whether it's time to actually re-render.

3. **`performance.now()` vs `timestamp` from rAF** — `requestAnimationFrame` provides a `DOMHighResTimeStamp`. Should we use that as the frame's reference time, or call `performance.now()` ourselves? The rAF timestamp is more accurate (it's the time the frame started, not when our callback runs). Leaning toward using the rAF timestamp.

## Known Issues — `d3-transition` and `d3-timer`

`d3-transition` is used extensively in the Rapid codebase (~49 `.transition()` call sites across ~25 UI files). Internally, `d3-transition` depends on `d3-timer`, which spins up its **own `requestAnimationFrame` loop** — completely uncoordinated with the Pixi/scheduler game loop.

Every active d3 transition is a separate rAF competitor that can manipulate the DOM, trigger layout/reflow, and consume frame budget outside the scheduler's control. We've hit this before: d3 transitions were once used for map transform easing and caused jittery rendering. That's been fixed, but the underlying conflict remains for UI animations.

**Current state:**
- **`d3-timer`**: 1 direct import — `flash.js` uses `d3_timeout` for a one-shot notification timer. Trivial to replace with `scheduler.scheduleTimeout`.
- **`d3-transition`**: 49 call sites, all doing DOM animations (opacity fades, height collapses, panel slides). All in UI code — none touch the Pixi render path. They come in via `d3-selection`'s `.transition()` method, so there's no explicit import to grep for.

**Stretch goal (future phase):** Replace `d3-transition` usage with scheduler-managed tween/transition helpers. The scheduler could provide a `scheduler.tween(workID, fn, { duration, easing })` API that runs the animation callback within the frame loop's idle budget — or in a dedicated "UI animation" phase — keeping DOM animation work coordinated with rendering. CSS transitions/animations could also replace many of these cases, since the browser's compositor can run those off the main thread entirely.

**For now:** No action needed. The d3 transitions are all in UI code, they're short-lived, and removing them is a large surface area change best done during the UI TypeScript conversion. We're no worse off than today.
