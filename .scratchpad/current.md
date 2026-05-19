# Current Work

## Labels refactor (rope-label garbling + perf)

### The bug
Rope labels (`PIXI.MeshRope`) sometimes appear garbled when they first enter the scene — wrong texture content, smeared glyphs, incorrect UVs. Self-heals on the next clean frame (any redraw — hover, pan, etc.).

### Root cause
`PixiLayerLabels.getLabelSprite()` calls `gfx.textureManager.createTexture('text', id, new PIXI.Text(...))` synchronously during the labels layer's `render()`. That path runs `renderer.generateTexture()` + `renderer.texture.getPixels()`, which **recursively calls `this._renderer.render(...)`**. Pixi v8's renderer is not re-entrant — shared batcher / renderPipes / renderTarget state gets corrupted when render() is invoked from inside another render(). Timing-dependent, so intermittent, and self-heals next frame.

Secondary issue: each new label = 1 `generateTexture` (nested GPU render) + 1 `readPixels` (full pipeline flush, CPU↔GPU sync stall). N new labels per frame = N stalls. Flame chart shows ~116ms frames dominated by back-to-back `readPixels` inside `labelLines`.

### Plan (4 steps, user-approved)
1. **Step 1 — DONE ✅** (committed `f9e881243`, pushed). Decouple measurement from rasterization in `PixiLayerLabels.ts`. Use `PIXI.CanvasTextMetrics.measureText(str, style)` for sizing without rasterizing. Queue texture creations and drain them OUTSIDE `render()` via `SchedulerSystem.schedule()` (workID `labels-raster-drain`, normal priority) — the scheduler's `_drainQueues()` runs AFTER all per-frame callbacks complete, so any `renderer.generateTexture()` call there is top-level, not nested inside a layer render. `renderObjects()` skips rope/sprite labels whose texture isn't ready yet — they pop in one frame later (user OK with this). BitmapText path for ASCII point labels unchanged. User confirmed visually: no more garbled rope labels.
2. **Step 2 — DONE ✅** (ready to commit). Introduced `PixiFeatureLabel` managed-feature class following the same canonical layer/feature pattern as every other layer (see `PixiLayerKeepRight.render`):
   - New file `modules/pixi/PixiFeatureLabel.ts` — subclass of `AbstractPixiFeature`. Constructor is `(layer, featureID)` exactly like the other managed features. Owns its `TextLabelProps` / `RopeLabelProps` (discriminated by `kind`), assigned by the layer after construction. `update(viewport)` lazily builds the display object (Sprite / BitmapText / MeshRope) when the texture is ready, stays dirty if not. `updateHalo()` is no-op. Disables hit-testing. Calls `this.layer.resolveLabelTexture(str, style)` via a `declare layer: PixiLayerLabels` type narrowing.
   - Refactored `PixiLayerLabels.ts` to follow the canonical pattern: `_labels` is now `Map<LabelID, LabelProps>` — pure placeholders. Placement methods (`placeTextLabel` / `placeRopeLabel`) just store props, no feature construction. `renderObjects(frame, viewport)` follows the standard flow: for each in-view labelID, lookup `this.features.get(labelID)`, lazy-create `new PixiFeatureLabel(this, labelID)` if missing, set `parentContainer` + `props`, call `update(viewport)` + `retainFeature(feature, frame)`. Off-screen labels get auto-destroyed by `AbstractPixiLayer.cull()` after 20 frames; their placeholders remain in `_labels` ready to be rebuilt. Renamed private `_getOrQueueLabelTexture` to public `resolveLabelTexture`. Text label IDs are `${featureID}-label` to avoid collision with source features in `scene.features`. `_objects` map now only holds debug bbox sprites.
   - tsc clean, lint clean (our files), 3063 tests pass (same 2 pre-existing `actionStraightenNodes` failures).
3. **Step 3 — NEXT** — Move text rasterization onto an `OffscreenCanvas` worker. Transfer `ImageData` back, feed `PixiTextures.allocate()` directly — bypasses both the nested render AND the readPixels stall.
4. **Step 4** — Apply the same fix to `PixiFeaturePolygon.ts:417-430` (`PIXI.GpuGraphicsContext` + `PIXI.buildContextBatches` round-trip — same anti-pattern). Replace with direct earcut tessellation.

### Step 1 implementation notes
- Texture frame includes padding: `width = ceil(measured.width + padding*2)`, height likewise. Read padding via `style._getFinalPadding()`.
- `placeRopeLabel` / `placeTextLabel` receive a measured `{ str, style, width, height, bitmapText? }` instead of a Sprite.
- `Label.props` stores `str` + `style` (+ `bitmapText` for ASCII point labels). Texture is looked up at render time.
- After draining the rasterization queue, call `gfx.immediateRedraw()` so the next frame picks up new textures.

---

## Previous: `render_worldcoord` migration — COMPLETE ✅ (see completed.md / decisions.md)

