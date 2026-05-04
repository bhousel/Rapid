# Current Work

## Active

### Scaled world coordinates migration

#### Background and motivation
Rapid currently uses two coordinate spaces:
- **WGS84** (lon/lat): canonical geographic data, stored in `GeometryPart.orig`
- **World coordinates** (unscaled, 0..256): a single-tile z0 WebMercator space. A point at `[128, 128]` is the world center (Null Island is `[128, 128]`). Stored in `GeometryPart.world`. Full range 0..256.

For Pixi rendering, `PixiGeometryPart` reprojects world→screen on every frame for every feature. At pan/zoom/rotate this reprojection is expensive — it's O(vertices) per feature per frame.

The insight (validated by experiment on branch `render_worldcoord`): if we store geometry in **scaled world coordinates** (= world × 2^16), we can place features in a Pixi group with `scale = 2^(z - 16)` and skip per-frame world→screen reprojection entirely. The group transform (one 3×3 matrix multiply per group, GPU-side) does the work instead.

Why z16 specifically:
- `2^16 = 65536`, so scaled world range is `0..16,777,216`
- Vertex deltas in local space (after anchor subtraction) are ~400 units for a 1km line — well above float32 noise floor
- Stroke width at z=20 is `2 × 2^(16-20) = 0.125` local units — healthy for Pixi tessellation (not the 1.9e-6 we saw with z0)
- Experiment showed visual parity with the screen-coord path at z14..z24

This change also benefits spatial systems (rbush culling, conflation): those tests can happen in `worldScaled` space, avoiding repeated lon/lat or z0 conversions.

#### Option A (dual representation): what this means
Option A = keep `world` (z0, 0..256) in place and add `worldScaled` (z16, 0..16.7M) as a second cache alongside it. The two coexist throughout the migration. This lets us port the rendering pipeline incrementally without breaking callers of the existing `world` data structure.

The alternative (Option B, deferred) would redefine "world coordinates" in `@rapid-sdk/math` itself to mean z16-scaled. We own `@rapid-sdk/math` and it has no other consumers, so this is viable — but it's a bigger blast radius and we'll revisit it after the Rapid-side migration stabilizes.

#### Coordinate math reference
```
worldScaled  = world × 2^REF_Z        (REF_Z = 16)
world        = worldScaled / 2^REF_Z

// Group transform in PixiScene._updateWorldCoordinateGroups():
group.scale  = 2^(currentZoom - REF_Z)
group.position = (0, 0)               // origin correction lives in `origin` container above

// Per-feature container:
container.position = (anchor - worldOrigin) × 2^REF_Z    // anchor in world (z0), scaled up

// Stroke width in local space:
strokeWidth_local = strokeWidth_px × 2^(REF_Z - currentZoom)

// Viewport.worldToScreen() reference (from @rapid-sdk/math):
screen = (world - 128) × 2^z + T     // T = viewport translation
```

#### Decisions
- `REF_Z = 16` (constant, not runtime-configurable during migration)
- New field name: `worldScaled` (on `GeometryPartWorldData` and any related types)
- `worldScaled` is populated by `GeometryPart.updateWorld()` alongside existing `world` data
- `worldScaled` includes a parallel extent and anchor: `worldScaled.extent`, `worldScaled.anchor` (= extent center pre-computed)
- Success metric: visual inspection by maintainer
- Workflow: direct commits on working branch `render_worldcoord`, no PR overhead

#### Step-by-step plan

**Step 1 — Types and GeometryPart** ← _next_
- Add `GeometryPartWorldScaledData` interface in `modules/lib/types.ts` mirroring `GeometryPartWorldData` but with scaled coords
- Add `worldScaled: GeometryPartWorldScaledData | null` field to `GeometryPart`
- Populate it inside `GeometryPart.updateWorld()` — iterate world coords and multiply by `2^REF_Z`
- Add conversion utilities in a new `modules/lib/worldScaled.ts` (or inline in GeometryPart if small):
  - `worldToScaled(coord: Vec2): Vec2`
  - `scaledToWorld(coord: Vec2): Vec2`
  - `scaledWorldToScreen(viewport, scaledCoord): Vec2`  (used by render helpers)
- Commit: "feat: add worldScaled coordinate cache to GeometryPart"

**Step 2 — PixiScene group transform**
- `_updateWorldCoordinateGroups` already has `scale = 2^(z - 16)` from the spike. Clean it up, document, add all render groups that will eventually use scaled coords (for now just `streetview2`).
- Commit: "feat: PixiScene group transform uses REF_Z=16 scaled world coordinates"

**Step 3 — Stabilize PixiFeatureLine world path**
- Replace the ad-hoc `2**16` literals in `updateWorld`/`updateWorldGraphic` with utility imports from Step 1
- Remove the "test precision theory" comments and clean up the experimental code into production-quality form
- Commit: "refactor: PixiFeatureLine world path uses worldScaled utilities"

**Step 4 — Port PixiFeaturePolygon**
- Add `updateWorldGraphic` parallel to the existing screen-based path, consuming `worldScaled.coords`
- Commit: "feat: PixiFeaturePolygon supports worldScaled render path"

**Step 5 — Port point features**
- Port the Pixi point feature classes
- Commit: "feat: point feature classes support worldScaled render path"

**Step 6 — Migrate spatial/rbush usage**
- Move viewport membership and hit-test geometry toward `worldScaled` where callers can benefit
- Commit: "refactor: spatial/rbush uses worldScaled coordinates"

**Step 7 — Remove PixiGeometryPart**
- Once all render paths consume `worldScaled` directly, remove `PixiGeometryPart` and screen-reprojection code
- Commit: "remove: PixiGeometryPart and screen reprojection path"

**Step 8 — Cleanup**
- Remove temporary dual-coord bridges, dead code, `streetview2` experimental flag
- Commit: "chore: remove scaled-world migration scaffolding"

**Step 9 (deferred) — SDK canonicalization**
- Redefine `@rapid-sdk/math` "world coordinates" to mean z16-scaled (Option B)
- Update Viewport math, docs, any unit tests in the SDK
- Sweep Rapid for `128`/`256`/`2^z` raw literals and replace with SDK utilities
- Commit across repos

## Future Investigation

### Validator classes (schema-aware lifecycle)
Validators are still factory functions instantiated once at init time. They now use **time-of-use** access for schema prerequisites (variables, rulesets) — lookups happen inline when needed, not hoisted to factory scope. Guard patterns vary by validator file (optional chaining, nullish coalescing, early returns).

The longer-term fix is converting validators to proper classes with lifecycle management (subscribe to `schemachange` events, refresh cached prerequisites). Tracked in `backlog.md`.

### AbortError handling centralization
Nearly every service `catch` handler has `if (err.name === 'AbortError') return;` before any real error handling. Two possible approaches to centralize:
1. **`ignoreAbort(fn)` utility** — wraps the error handler, filters AbortErrors at the wrapper level, zero type changes
2. **`fetch<T>` returns `Promise<T | undefined>`** — NetworkSystem swallows AbortErrors internally, callers guard on `!result` in `.then()` instead — requires broad churn

`MapRouletteService` is the outlier: its AbortError handlers do `cache.tileRequest.delete(tile.id)` / `cache.challengeRequest.delete(challengeID)` to "allow retry". This is arguably a bug — the service maintains its own inflight state (`tileRequest`, `challengeRequest`) that is redundant with NetworkSystem's requestID dedup. On abort, NetworkSystem already cleans up its inflight map and `spatial.hasTile()` returns false, so retry would happen naturally without the manual delete. The redundant cache creates a consistency window where `tileRequest` and NetworkSystem's inflight map can disagree.


