import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { HALF_PI, TAU, numWrap, vecAdd, vecAngle, vecScale, vecSubtract, geomRotate } from '@rapid-sdk/math';
import { PixiFeatureLabel } from './PixiFeatureLabel.ts';
import { getDebugBBox } from './helpers.ts';
import { geomLineSegments, geomStrokeOutline } from '../geo/index.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { CellRect } from './lib/AvoidGrid.ts';
import type { PixiFeatureLabelProps, TextLabelProps, RopeLabelProps } from './PixiFeatureLabel.ts';
import type { SpatialItem } from '../core/SpatialSystem.ts';
import type { PixiFeatureLine } from './PixiFeatureLine.ts';
import type { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import type { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import type { PixiScene } from './PixiScene.ts';
import type { RenderFrame } from './RenderFrame.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


const MINZOOM = 12;
const POLYGON_LABEL_INSET = 12;   // how far inside a polygon's outer ring its label runs, in pixels

// SpatialSystem cache identifiers for label placement boxes and debug boxes.
const SPATIAL_LABELS = 'labels';
const SPATIAL_DEBUG = 'labels-debug';

const TEXTSTYLE_NORMAL: PIXI.TextStyleOptions = {
  fill: { color: 0x333333 },
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 12,
  fontWeight: '600',
  stroke: { color: 0xffffff, width: 3, join: 'round' }
};

const TEXTSTYLE_ITALIC: PIXI.TextStyleOptions = {
  fill: { color: 0x333333 },
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 12,
  fontStyle: 'italic',
  fontWeight: '600',
  stroke: { color: 0xffffff, width: 3, join: 'round' }
};

/** Measurements for a label, including its expected width and height */
/** A box in label space: `[minX, minY, maxX, maxY]` */
type LabelRoom = [number, number, number, number];

/** Past this many freed boxes in a frame, they're treated as one box around them all */
const MAX_FREED = 64;

/**
 * Milliseconds that the zoom and rotation have to stay as they are before labels are placed.
 * Every label is taken away when either changes, so during a pinch or a turn of the map,
 * labels placed between two steps would only flash.
 */
const SETTLE_MS = 150;

/** Features that a frame places labels for whatever the time, so that placement always moves on */
const MIN_PLACED = 25;

interface LabelMeasurement {
  /** Label text, e.g. "Main Street" */
  str: string;
  /** Label style, either 'normal' or 'italic' */
  style: 'normal' | 'italic';
  /** Label texture width (includes padding) */
  width: number;
  /** Label texture height (includes padding) */
  height: number;
}

/**
 * Label-specific metadata, stored as the `contents` of a `LabelItem`.
 * The spatial framing (`id` and `minX`/`minY`/`maxX`/`maxY`) lives on the `LabelItem` itself.
 */
interface LabelContents {
  type: 'label' | 'avoid' | 'debug';
  featureID: FeatureID;
  labelID?: LabelID | null;
  objectID?: string | null;
  tint?: number;
  /** For a label's box: the cells of the avoid grid that it marked */
  cells?: CellRect | null;
}

/**
 * A `SpatialItem` used for label placement and collision detection.
 * Narrows `contents` to `LabelContents` so label items can be stored in the
 * `SpatialSystem` directly, with no wrapping or conversion step.
 */
interface LabelItem extends SpatialItem {
  contents: LabelContents;
}

/** Placement ids for labels placed adjacent to map pins */
type PlacementID =
  't1' | 't2' | 't3' | 't4' | 't5' |
  'r1' | 'r2' | 'r3' | 'r4' | 'r5' |
  'b1' | 'b2' | 'b3' | 'b4' | 'b5' |
  'l1' | 'l2' | 'l3' | 'l4' | 'l5';

/** Chain link for rope label placement */
interface ChainLink {
  labelItem: LabelItem;
  debugItem: LabelItem;
  coord: Vec2;
  angle: number;
}


/**
 * This class renders text labels.
 * Labels are placed on their own layer above most map data.
 */
export class PixiLayerLabels extends AbstractPixiLayer {
  /** Container whose origin is pinned to the world origin (for stable text placement) */
  public labelOriginContainer: PIXI.Container | null;
  /** Container for debug visualization sprites showing label bounding boxes */
  public debugContainer: PIXI.Container | null;
  /** Container that holds all visible label features */
  public labelContainer: PIXI.Container | null;

  /** FeatureIDs that have been labeled (points, roads, etc) - note that point features can be both avoided and labeled */
  protected _labeled: Set<FeatureID>;

  /** Mapping of a FeatureID to the boxes that cover it */
  protected _featureBoxes: Map<FeatureID, Set<BoxID>>;
  /** Mapping of a text string (e.g. "Main Street") to generated texture */
  protected _textureIDs: Map<string, TextureID>;
  /** Storage for label placeholders - they will be added to the scene lazily */
  protected _placeholders: Map<LabelID, PixiFeatureLabelProps>;
  /** Mapping of Pixi object id to PIXI.Sprite */
  protected _debugSprites: Map<string, PIXI.Sprite>;

  /** Queue of label textures awaiting rasterization (drained lazily to avoid frame spikes) */
  protected _pendingRasters: Map<TextureID, { str: string; style: 'normal' | 'italic' }>;
  /** Whether a raster-drain microtask has been scheduled for this frame */
  protected _rasterDrainScheduled: boolean;
  /** Map transform at the last labeling pass; used to detect zoom/rotation changes that need a full relabel */
  protected _tPrev: { x: number; y: number; z: number; r: number };
  /** The features whose labels are to be looked at: they changed, or their label was taken away (see `render`) */
  protected _pending: Set<FeatureID>;
  /** Whether every feature in the scene is to be looked at, as after a zoom (see `reset`) */
  protected _placeAll: boolean;
  /**
   * The features that have a label and got no place for it, with the box in label space where
   * the label would have gone. They're tried again when room is made there (see `_retryUnplaced`).
   */
  protected _unplaced: Map<FeatureID, LabelRoom>;
  /** Boxes in label space where a label was taken away since the last placement */
  protected _freed: LabelRoom[];
  /** Whether the last call to `placeTextLabel` or `placeRopeLabel` placed a label */
  protected _didPlace: boolean;
  /** Scratch space for the box of the point that `placeTextLabel` is placing a label for */
  protected _pointBox: [number, number, number, number];
  /** Whether the last `render()` showed no labels: the layer is off, or the view is zoomed out too far */
  protected _isOff: boolean;
  /** The red boxes that show what labels avoid, in the label debug view, by feature (see `renderDebugAvoids`) */
  protected _debugAvoids: Map<FeatureID, { sprite: PIXI.Sprite, cells: CellRect }>;
  /** Whether the last frame put off placing labels (so that another frame should follow it) */
  protected _placementWaiting: boolean;
  /**
   * The features that are ready for a label and haven't been tried yet. A frame places as many
   * as it has time for, the ones in view first (see `_placeQueued`).
   */
  protected _queue: Set<FeatureID>;
  /** When the zoom and rotation will have stayed the same for long enough to place labels (`RenderFrame.time`) */
  protected _settleAt: number;
  /** How many features this frame has placed labels for (see `MIN_PLACED`) */
  protected _numTried: number;

  /** Pixi TextStyle for normal-weight label text */
  protected _textStyleNormal: PIXI.TextStyle;
  /** Pixi TextStyle for italic label text */
  protected _textStyleItalic: PIXI.TextStyle;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'labels';
    this.enabled = true;   // labels should be enabled by default

    this.labelOriginContainer = null;
    this.debugContainer = null;
    this.labelContainer = null;

    // Keep track of the labelable features we have processed
    this._labeled = new Set<FeatureID>();

    // Label placeholders — store the placement props for every possible label.
    // Each one is materialized into a `PixiFeatureLabel` lazily on first visibility
    // (see `renderLabels()`), to avoid creating display objects for the many labels
    // that are placed far off-screen.
    this._placeholders = new Map<LabelID, PixiFeatureLabelProps>();

    // Pixi Display Objects for debug bbox sprites.
    // (Label display objects live on their owning `PixiFeatureLabel` features.)
    this._debugSprites = new Map<string, PIXI.Sprite>();

    // Track which boxes cover each feature (so we can find them again in `resetFeature`).
    this._featureBoxes = new Map<FeatureID, Set<BoxID>>();

    // Mapping of a text string (e.g. "Main Street") to generated texture
    this._textureIDs = new Map<string, TextureID>();

    // Deferred label rasterization queue (see measureLabel / resolveLabelTexture).
    this._pendingRasters = new Map();   // Map<TextureID, { str, style }>
    this._rasterDrainScheduled = false;

    // We reset the labeling when scale or rotation change
    this._tPrev = { x: 0, y: 0, z: 1, r: 0 };
    this._placementWaiting = false;
    this._queue = new Set<FeatureID>();
    this._settleAt = 0;
    this._numTried = 0;
    this._pending = new Set<FeatureID>();
    this._placeAll = true;
    this._unplaced = new Map<FeatureID, LabelRoom>();
    this._freed = [];
    this._didPlace = false;
    this._pointBox = [0, 0, 0, 0];
    this._isOff = false;
    this._debugAvoids = new Map<FeatureID, { sprite: PIXI.Sprite, cells: CellRect }>();

    // For ASCII-only labels, we can use PIXI.BitmapText to avoid generating label textures
    PIXI.BitmapFont.install({ name: 'label-normal', style: TEXTSTYLE_NORMAL });
    // PIXI.BitmapFont.install({ name: 'label-italic', style: TEXTSTYLE_ITALIC });  // not currently used

    // For all other labels, generate it on the fly in a PIXI.Text or PIXI.Sprite
    this._textStyleNormal = new PIXI.TextStyle(TEXTSTYLE_NORMAL);
    this._textStyleItalic = new PIXI.TextStyle(TEXTSTYLE_ITALIC);
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
    super.reset();
    const spatial = this.context.systems.spatial!;

    // Destroy any Pixi display objects that we created.
    for (const object of this._debugSprites.values()) {
      object.destroy();
    }

    spatial.clearCache(SPATIAL_LABELS);
    spatial.clearCache(SPATIAL_DEBUG);
    this.scene.labelSpace.avoidGrid.clearLabels();
    this._labeled.clear();
    this._placeholders.clear();
    this._debugSprites.clear();
    this._debugAvoids?.clear();      // (their sprites go with the containers, below)
    this._pending?.clear();
    this._placeAll = true;           // nothing is labeled now: look at every feature once
    this._unplaced?.clear();
    this._queue?.clear();
    if (this._freed) this._freed.length = 0;
    this._featureBoxes.clear();
    this._pendingRasters.clear();
    if (this._rasterDrainScheduled) {
      this.context.systems.scheduler?.cancel('labels-raster-drain');
      this._rasterDrainScheduled = false;
    }

    // Items in this layer don't actually need to be interactive
    const groupContainer = this.scene.groups.get('labels')!;
    groupContainer.eventMode = 'none';

    // Remove any existing containers
    for (const child of groupContainer.children) {
      groupContainer.removeChild(child);
      child.destroy({ children: true });  // recursive
    }

    // Add containers
    const labelOriginContainer = new PIXI.Container();
    labelOriginContainer.label= 'labelorigin';
    labelOriginContainer.eventMode = 'none';
    this.labelOriginContainer = labelOriginContainer;

    const debugContainer = new PIXI.Container();  //PIXI.ParticleContainer(50000);
    debugContainer.label = 'debug';
    debugContainer.eventMode = 'none';
    debugContainer.sortableChildren = false;
    this.debugContainer = debugContainer;

    const labelContainer = new PIXI.Container();
    labelContainer.label = 'labels';
    labelContainer.eventMode = 'none';
    labelContainer.sortableChildren = true;
    this.labelContainer = labelContainer;

    groupContainer.addChild(labelOriginContainer);
    labelOriginContainer.addChild(debugContainer, labelContainer);

    for (const feature of this.scene.features.values()) {
      feature.labelPlaced();
    }
  }


  /**
   * Remove data from labeling caches for the given feature.
   * This will force the feature to be relabeled.
   * @param featureID - The feature ID to reset
   */
  public resetFeature(featureID: FeatureID): void {
    const spatial = this.context.systems.spatial!;
    this._labeled.delete(featureID);
    this._unplaced.delete(featureID);
    this._queue.delete(featureID);
    this._pending.add(featureID);     // to be placed again, if it's still there

    const labelIDs = new Set<LabelID>();
    const debugObjectIDs = new Set<string>();

    // Gather `labelIDs` from the label boxes, `objectIDs` from the debug boxes.
    // Then remove the boxes from the spatial caches.
    const boxIDs = this._featureBoxes.get(featureID) || [];
    for (const boxID of boxIDs) {
      // Note that label and debug `boxIDs` will not collide (debug IDs will have `-debug` at the end of them).
      // A given boxID will be found in either SPATIAL_LABELS or SPATIAL_DEBUG.
      const contents = spatial.getItem<LabelContents>(SPATIAL_LABELS, boxID) ?? spatial.getItem<LabelContents>(SPATIAL_DEBUG, boxID);
      if (contents) {
        if (contents.type === 'label' || contents.type === 'avoid') {
          spatial.removeItems(SPATIAL_LABELS, boxID);
          if (contents.cells) {
            const size = this.scene.labelSpace.avoidGrid.cellSize;
            const c = contents.cells;
            this._freed.push([c[0] * size, c[1] * size, (c[2] + 1) * size, (c[3] + 1) * size]);
            this.scene.labelSpace.avoidGrid.unmark('label', contents.cells);
            contents.cells = null;
          }
        }
        if (contents.type === 'debug') {
          spatial.removeItems(SPATIAL_DEBUG, boxID);
          if (contents.objectID) {
            debugObjectIDs.add(contents.objectID);
          }
        }
        if (contents.labelID) {
          labelIDs.add(contents.labelID);
        }
      }
    }
    this._featureBoxes.delete(featureID);


    // Destroy any materialized label features, then forget the placeholders.
    // `feature.destroy()` removes from this layer's `features` cache, the scene's
    // `features` cache, and the `labelContainer` (if parented).
    for (const labelID of labelIDs) {
      const labelFeature = this.features.get(labelID) as PixiFeatureLabel | undefined;
      if (labelFeature) {
        labelFeature.destroy();
      }
      this._placeholders.delete(labelID);
    }

    // Destroy debug sprites that were tied to the boxes.
    // (They automatically remove from parent containers.)
    for (const objectID of debugObjectIDs) {
      const object = this._debugSprites.get(objectID);
      if (object) {
        object.destroy();
      }
      this._debugSprites.delete(objectID);
    }
  }


  /**
   * The labels layer has no features of its own to draw again later. It reports 1 while placing
   * labels is waiting for a later frame, so that the frame comes (see `render`): placement was
   * put off, or something was drawn over a label after this frame's placement.
   * @return 1 if placement is waiting, otherwise 0
   */
  public override get numWaiting(): number {
    if (this._placementWaiting || this.scene.labelSpace.numAvoidHits > 0) return 1;
    // Room was made, and something is waiting for room
    if (this._unplaced.size > 0 && (this._freed.length > 0 || this.scene.labelSpace.numAvoidFrees > 0)) return 1;
    return 0;
  }


  /**
   * Render all the labels. This is a multi-step process:
   * - avoids - the places where we don't want a label. The features that labels avoid mark
   *   themselves in the scene's avoid grid as they're drawn; here we take back the labels that
   *   one of them landed on
   * - label placement - do the math of figuring out where labels should be. The features that
   *   are ready for a label wait on a queue, and each frame places what it has time for. Nothing
   *   is placed while the zoom or rotation is changing (see `SETTLE_MS`)
   * - label rendering - show or hide labels based on their visibility
   *
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: RenderFrame, viewport: Viewport): void {
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || viewZoom < MINZOOM) {
      // No label is shown, so none is in anything's way and none waits for room. Forget what
      // was placed (it's all placed again when labels are back), and what the scene noted
      // since: left there, it counts as placement that's waiting (`numWaiting`), and asks for
      // another frame after every frame.
      if (!this._isOff) {
        this._isOff = true;
        this.reset();
      }
      this.scene.labelSpace.takeAvoidHits();
      this.scene.labelSpace.takeAvoidFrees();
      this.labelContainer!.visible = false;
      this.debugContainer!.visible = false;
      this._placementWaiting = false;
      return;
    }
    this._isOff = false;

    // Reset stale labels, as needed
    const tPrev = this._tPrev;
    const tCurr = viewport.transform.props;
    const didReset = (tCurr.z !== tPrev.z || tCurr.r !== tPrev.r);  // zoom or rotation changed
    if (didReset) {
      this.reset();                                    // reset all labels
      this._settleAt = frame.time + SETTLE_MS;         // ..and wait for the view to hold still
    }
    this._tPrev = tCurr;

    // Placing labels waits for the view: while the zoom or rotation is changing, every label
    // placed is taken away at the next step, and would only flash. (A pan moves the labels along.)
    const settled = frame.time >= this._settleAt;

    // The features that were drawn, shown, hidden or destroyed since the last frame said so
    // to the scene. Those are the only ones whose labels can need anything.
    const changedIDs = this.scene.labelSpace.takeChangedFeatures();
    for (const featureID of changedIDs) {
      this._pending.add(featureID);
    }


    // The label container should be kept unrotated so that it stays screen-up not north-up.
    // We need to counter the effects of the 'stage' and 'origin' containers that we are underneath.
    const stage = this.gfx.stage!;
    const origin = this.gfx.origin!;
    const bearing = viewport.transform.rotation;
    const worldScale = origin.scale.x;

    // Label space (the screen minus its offset) is the scene's, worked out before the layers
    // render: see `LabelSpace.update`.
    const labelOffset = this.scene.labelSpace.offset;

    // Position the labels group to render in screen space.
    // `origin` now carries both the pan offset and world-scale transforms,
    // so we must undo its full transform to get back to screen-space rendering.
    const groupContainer = this.scene.groups.get('labels')!;
    const groupPos = origin.toLocal(stage.position);
    groupContainer.position.copyFrom(groupPos);
    groupContainer.scale.set(1 / worldScale, 1 / worldScale);  // undo world scale
    groupContainer.rotation = -bearing;                         // undo stage rotation

    const labelOriginContainer = this.labelOriginContainer!;
    labelOriginContainer.position.set(-stage.position.x + labelOffset.x, -stage.position.y + labelOffset.y);

    if (settled) {
      // Take back the labels that something was drawn over.
      this.resolveAvoidHits();
      // ..and try the features again that had no room, where room was made.
      this._retryUnplaced();

      // Look at the features that changed, or after a zoom, at all of them. The ones that are
      // ready for a label go on the queue.
      const consider = (feature: AbstractPixiFeature): void => {
        if (feature.layer === this) return;     // (a label is a feature too)
        if (feature.labelDirty) {               // its shape, label or visibility changed: place it again
          if (this._labeled.has(feature.id)) {
            this.resetFeature(feature.id);
          }
          feature.labelPlaced();
        }
        // If the feature can be labeled, and hasn't yet been, add it to the queue for placement.
        // (Not one that's still waiting to be drawn: it's labeled once it has its shape, and it
        // says so then.)
        if (feature.label && feature.visible && !feature.dirty && !this._labeled.has(feature.id)) {
          this._queue.add(feature.id);
        } else {
          this._queue.delete(feature.id);
        }
      };

      if (this._placeAll) {
        this._placeAll = false;
        for (const feature of this.scene.features.values()) {
          consider(feature);
        }
      } else {
        for (const featureID of [...this._pending]) {
          const feature = this.scene.features.get(featureID);
          if (feature) {
            consider(feature);
          } else {                              // it's gone, and its label with it
            this._labeled.delete(featureID);
            this._unplaced.delete(featureID);
            this._queue.delete(featureID);
            if (this._featureBoxes.has(featureID)) {
              this.resetFeature(featureID);
            }
          }
        }
      }
      this._pending.clear();

      // Place what's on the queue, as far as this frame's time goes.
      // - What the user just changed is placed now, whatever the time.
      // - The rest goes by the shapes of the features around it, so it waits until the features
      //   in view have been drawn again. (A label placed before a point is drawn there would
      //   be taken away again: right in the end, but it would flash.)
      this._numTried = 0;
      if (frame.urgent) {
        const urgentIDs: FeatureID[] = [];
        for (const featureID of changedIDs) {
          if (this._queue.has(featureID)) urgentIDs.push(featureID);
        }
        this._placeQueued(urgentIDs, frame, true);
      }
      if (this._queue.size && frame.waitingInView === 0) {
        this._placeQueued(this._queue, frame, false);
      }
    }
    this._placementWaiting = !settled || this._queue.size > 0;

    this.labelContainer!.visible = true;
    this.renderLabels(frame, viewport);

    const showDebug = this.context.getDebug('label');
    if (showDebug) {
      this.debugContainer!.visible = true;
      this.renderDebug();
      this.renderDebugAvoids();
    } else {
      this.debugContainer!.visible = false;
    }
  }


  /**
   * Pick the padding to use for a label.
   * Combining marks (diacritics, Zalgo text) need extra room so glyphs don't get clipped.
   * Both measurement and rasterization must agree on this value.
   * @param str - The label text
   * @return Padding in CSS pixels
   */
  protected _getLabelPadding(str: string): number {
    const marks = str.match(/\p{M}/gu);  // count unicode combining marks
    if (!marks) return 0;
    if (marks.length > 20) return 50;    // Zalgo text?
    if (marks.length > 0)  return 10;    // a few ascenders/descenders?
    return 0;
  }


  /**
   * Pick a `PIXI.TextStyle` for a (str, style) pair, applying combining-mark padding if needed.
   * @param str - The label text
   * @param style - 'normal' or 'italic'
   * @return A TextStyle ready to pass to CanvasTextMetrics.measureText / PIXI.Text
   */
  protected _getTextStyle(str: string, style: 'normal' | 'italic'): PIXI.TextStyle {
    const pad = this._getLabelPadding(str);
    if (pad) {  // need a one-off style with extra padding
      const opts = Object.assign({}, (style === 'normal' ? TEXTSTYLE_NORMAL : TEXTSTYLE_ITALIC), { padding: pad });
      return new PIXI.TextStyle(opts);
    }
    return (style === 'normal' ? this._textStyleNormal : this._textStyleItalic);
  }


  /**
   * Measure a label without rasterizing it.
   *
   * Uses `PIXI.CanvasTextMetrics.measureText` (pure CPU canvas2D measurement, internally cached)
   * to compute the size of the label texture frame that *would* be allocated for this string.
   * This is what `Sprite.getLocalBounds()` would report after rasterization.
   *
   * Decoupling sizing from rasterization lets us do placement math during the layer's render()
   * without triggering `renderer.generateTexture()` (which would recursively call `renderer.render()`
   * and corrupt batcher state — see `knowledge/lessons/pixi.md`, "Pixi v8 renderer is NOT re-entrant").
   *
   * @param str - The label text
   * @param style - 'normal' or 'italic'
   * @return Frame width/height in CSS pixels, padded the same way the texture will be
   */
  public measureLabel(str: string, style: 'normal' | 'italic' = 'normal'): LabelMeasurement {
    const textStyle = this._getTextStyle(str, style);
    const metrics = PIXI.CanvasTextMetrics.measureText(str, textStyle);
    const pad = this._getLabelPadding(str);
    // Texture frame is `ceil(measured + pad*2)` — see node_modules/pixi.js/lib/scene/text/canvas/CanvasTextGenerator.mjs
    const width = Math.ceil(metrics.width + pad * 2);
    const height = Math.ceil(metrics.height + pad * 2);
    return { str, style, width, height };
  }


  /**
   * Look up an existing label texture, or queue a rasterization request.
   *
   * Public so `PixiFeatureLabel.update()` can resolve its own texture without
   * the layer reaching into feature internals.
   *
   * Returns `null` if the texture isn't allocated yet. The caller should leave
   * itself dirty and try again next frame; the scheduler will drain the queue
   * after frame callbacks complete (outside of render()) and trigger a redraw
   * so the texture is picked up on the next frame.
   *
   * @param str - The label text
   * @param style - 'normal' or 'italic'
   * @return The texture if already allocated, otherwise `null` (and a request is queued)
   */
  public resolveLabelTexture(str: string, style: 'normal' | 'italic'): PIXI.Texture | null {
    const textureID: TextureID = `${str}-${style}`;
    const textureManager = this.gfx.textureManager!;
    const existing = textureManager.getTexture('text', textureID);
    if (existing) return existing;
    if (!this._pendingRasters.has(textureID)) {
      this._pendingRasters.set(textureID, { str, style });
      this._scheduleRasterDrain();
    }
    return null;
  }


  /**
   * Schedule a task to drain `_pendingRasters` outside of the current render path.
   * `SchedulerSystem.schedule()` queues the task to run during `_drainQueues()`, which
   * fires AFTER all per-frame callbacks (including layer rendering) complete.  That means
   * any `renderer.generateTexture()` call inside the drain is a TOP-LEVEL render call,
   * not nested inside another `renderer.render()` pass — see `knowledge/lessons/pixi.md`,
   * "Pixi v8 renderer is NOT re-entrant".
   *
   * The `_rasterDrainScheduled` flag dedups within a frame so we don't enqueue N drain
   * tasks when N labels are queued.
   */
  protected _scheduleRasterDrain(): void {
    if (this._rasterDrainScheduled) return;

    this._rasterDrainScheduled = true;
    const scheduler = this.context.systems.scheduler!;
    scheduler.schedule(() => this._drainPendingRasters(), {
      priority: 'normal',
      workID: 'labels-raster-drain'
    })
      .catch(err => {
        if (err?.name === 'AbortError') return;   // expected cancellation
        console.error(err);  // eslint-disable-line no-console
      });
  }


  /**
   * Rasterize queued labels into the text atlas.
   * Called when the scheduler drains its queues, NOT from render() — see `_scheduleRasterDrain`.
   */
  protected _drainPendingRasters(): void {
    this._rasterDrainScheduled = false;
    if (!this._pendingRasters.size) return;
    if (!this.gfx?.textureManager) return;  // layer was reset

    const textureManager = this.gfx.textureManager;
    for (const [textureID, { str, style }] of this._pendingRasters) {
      const textStyle = this._getTextStyle(str, style);
      const textOptions: PIXI.CanvasTextOptions = {
        text: str,
        resolution: 2,
        style: textStyle,
        textureStyle: { scaleMode: 'nearest' }
      };
      textureManager.createTexture('text', textureID, new PIXI.Text(textOptions));
      this._textureIDs.set(str, textureID);
    }
    this._pendingRasters.clear();

    // Wake the scene so newly-rasterized labels appear on the next frame. (Only the labels changed.)
    this.gfx.immediateRedraw(this.id);
  }


  /**
   * Takes back the labels that something has been drawn over since the last placement.
   * The points and vertices that labels avoid mark themselves in the scene's avoid grid as
   * they're drawn, and the scene notes where one landed on a label (a tile arrives, a way is
   * selected and gets vertices). Those labels are placed again, somewhere else; no other
   * label moves.
   */
  public resolveAvoidHits(): void {
    const spatial = this.context.systems.spatial!;
    const size = this.scene.labelSpace.avoidGrid.cellSize;

    for (const cells of this.scene.labelSpace.takeAvoidHits()) {
      const box = { minX: cells[0] * size, minY: cells[1] * size, maxX: (cells[2] + 1) * size, maxY: (cells[3] + 1) * size };
      for (const item of spatial.getItemsAtBox(SPATIAL_LABELS, box)) {
        const hit = item.contents as LabelContents;
        if (hit.type === 'label' && hit.labelID && hit.featureID) {
          this.resetFeature(hit.featureID);
        }
      }
    }
  }


  /**
   * Track which boxes cover the given feature, so we can find them again in `resetFeature`.
   * @param item - the label item to track
   */
  protected _cacheBox(item: LabelItem): void {
    const boxID = item.id;
    const featureID = item.contents.featureID;
    if (!boxID || !featureID) return;

    let featureBoxIDs = this._featureBoxes.get(featureID);
    if (!featureBoxIDs) {
      featureBoxIDs = new Set<BoxID>();
      this._featureBoxes.set(featureID, featureBoxIDs);
    }
    featureBoxIDs.add(boxID);
  }


  /**
   * This calculates the placement, but does not actually add the label to the scene.
   * @param features - The features to place labels on
   * @param stop - Asked before each feature whether to stop there (the frame is out of time)
   * @return `false` if it stopped before the end of the list
   */
  public labelPoints(features: PixiFeaturePoint[], stop?: () => boolean): boolean {
    // Sort by container y-position (north-to-south in world coords) for stable placement priority.
    features.sort((a, b) => a.container.position.y - b.container.position.y);
    const tempVec: Vec2 = [0, 0];

    for (const feature of features) {
      const featureID = feature.id;

      if (stop?.()) return false;                  // (what's left stays on the queue)
      this._queue.delete(featureID);
      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;  // no label needed

      const measurement = this.measureLabel(feature.label, 'normal');
      this._didPlace = false;
      this.placeTextLabel(feature, measurement);

      if (!this._didPlace) {   // no room: remember where it would have gone (anywhere around the point)
        const origin = feature.geometry?.world?.origin;
        if (origin) {
          const [x, y] = this.scene.labelSpace.worldToLabel(origin[0], origin[1], tempVec);
          const dx = measurement.width + 50;
          const dy = measurement.height + 50;
          this._unplaced.set(featureID, [x - dx, y - dy, x + dx, y + dy]);
        }
      }
    }
    return true;
  }


  /**
   * Lines are labeled with `PIXI.SimpleRope` that run along the line.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param features - The features to place labels on
   * @param stop - Asked before each feature whether to stop there (the frame is out of time)
   * @return `false` if it stopped before the end of the list
   */
  public labelLines(features: PixiFeatureLine[], stop?: () => boolean): boolean {
    const origin = this.gfx.origin;
    if (!origin) return true;

    // The lines of the more important roads get their labels first: a line's `zIndex` is its
    // road class, and a part of 1 that puts the lines of a class in order.
    // (Not by anything about the line's container: a line that's drawn in a batch isn't in the scene.)
    features.sort((a, b) => Math.floor(b.container.zIndex) - Math.floor(a.container.zIndex));

    const temp = new PIXI.Point();
    const world = new PIXI.Point();
    const labelOffset = this.scene.labelSpace.offset;

    for (const feature of features) {
      const featureID = feature.id;
      const localCoords = feature.geometry?.local?.coords as Vec2[] | undefined;

      if (stop?.()) return false;                  // (what's left stays on the queue)
      this._queue.delete(featureID);
      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;   // no label needed
      if (!localCoords || localCoords.length < 2) continue;   // no points
      if (!feature.container.visible || !feature.container.renderable) continue; // not visible

      // Project line vertices from feature-local space to label space
      // (= global screen minus labelOffset).
      const labelCoords: Vec2[] = new Array(localCoords.length);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      // (The line's coordinates start at its container's position in the world, and `origin`
      // puts the world on screen. The container itself may not be in the scene.)
      const position = feature.container.position;
      for (let i = 0; i < localCoords.length; i++) {
        const p = localCoords[i];
        world.set(p[0] + position.x, p[1] + position.y);
        origin.toGlobal(world, temp);
        labelCoords[i] = [temp.x - labelOffset.x, temp.y - labelOffset.y];
        if (temp.x < minX) minX = temp.x;
        if (temp.x > maxX) maxX = temp.x;
        if (temp.y < minY) minY = temp.y;
        if (temp.y > maxY) maxY = temp.y;
      }

      // How much room the line takes on screen: its points, and its width around them.
      // (Not the bounds of its container: a line that's drawn in a batch has nothing in it.
      // A line is hit 5 pixels beyond its casing, see `PixiFeatureLine`.)
      const lineWidth = Math.max(0, 2 * feature.hitReach - 10);
      if ((maxX - minX + lineWidth) < 40 && (maxY - minY + lineWidth) < 40) continue;    // too small

      const measurement = this.measureLabel(feature.label, 'normal');
      this._didPlace = false;
      this.placeRopeLabel(feature, measurement, labelCoords);
      if (!this._didPlace) this._noteUnplaced(featureID, labelCoords);
    }
    return true;
  }


  /**
   * Polygons are labeled with `PIXI.SimpleRope` that run along the inside of the perimeter.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param features - The features to place labels on
   * @param stop - Asked before each feature whether to stop there (the frame is out of time)
   * @return `false` if it stopped before the end of the list
   */
  public labelPolygons(features: PixiFeaturePolygon[], stop?: () => boolean): boolean {
    const origin = this.gfx.origin;
    if (!origin) return true;

    const temp = new PIXI.Point();
    const world = new PIXI.Point();
    const labelOffset = this.scene.labelSpace.offset;

    for (const feature of features) {
      const featureID = feature.id;
      const outer = feature.geometry?.local?.outer;

      if (stop?.()) return false;                  // (what's left stays on the queue)
      this._queue.delete(featureID);
      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;      // no label needed
      if (!outer || outer.length < 3) continue;  // no outer ring
      if (!feature.container.visible || !feature.container.renderable) continue;  // not visible

      // Project the outer ring from feature-local space to label space (= global screen minus labelOffset)
      // as a flat array, which is what `geomStrokeOutline` expects.
      // (The polygon's coordinates start at its container's position in the world, and `origin`
      // puts the world on screen. The container itself may not be in the scene: a polygon
      // that's drawn in batches has nothing in it.)
      const position = feature.container.position;
      const flatOuter: number[] = new Array(outer.length * 2);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i];
        world.set(p[0] + position.x, p[1] + position.y);
        origin.toGlobal(world, temp);
        flatOuter[i * 2]     = temp.x - labelOffset.x;
        flatOuter[i * 2 + 1] = temp.y - labelOffset.y;
        if (temp.x < minX) minX = temp.x;
        if (temp.x > maxX) maxX = temp.x;
        if (temp.y < minY) minY = temp.y;
        if (temp.y > maxY) maxY = temp.y;
      }
      if ((maxX - minX) < 600 && (maxY - minY) < 600) continue;  // too small

      const measurement = this.measureLabel(feature.label, 'italic');

      // The label runs along the inside of the ring, 12 pixels in.
      const inner = geomStrokeOutline(flatOuter, POLYGON_LABEL_INSET, { closed: true, join: 'bevel' }).inner;
      if (!inner) continue;
      const coords: Vec2[] = new Array(inner.length / 2);  // un-flatten :(
      for (let i = 0; i < inner.length / 2; ++i) {
        coords[i] = [ inner[(i * 2)], inner[(i * 2) + 1] ];
      }

      this._didPlace = false;
      this.placeRopeLabel(feature, measurement, coords);
      if (!this._didPlace) this._noteUnplaced(featureID, coords);
    }
    return true;
  }


  /**
   * Places labels for features on the queue: the ones in view first, and of those the points,
   * then the lines, then the polygons (so that a line's label fits around the points' labels).
   * It stops when the frame is out of time, after a minimum (`MIN_PLACED`). What's left stays
   * on the queue for the next frame.
   * @param featureIDs - The features to place labels for, all of them on the queue
   * @param frame - The frame being rendered
   * @param force - `true` to place them all, whatever the time
   * @return `false` if it stopped before the end
   */
  protected _placeQueued(featureIDs: Iterable<FeatureID>, frame: RenderFrame, force: boolean): boolean {
    const viewBox = frame.viewBox;

    // [in view, outside]
    const points: PixiFeaturePoint[][] = [[], []];
    const lines: PixiFeatureLine[][] = [[], []];
    const polygons: PixiFeaturePolygon[][] = [[], []];

    for (const featureID of [...featureIDs]) {
      const feature = this.scene.features.get(featureID);
      // (One that isn't ready anymore says so when it is again.)
      if (!feature || !feature.label || !feature.visible || feature.dirty) {
        this._queue.delete(featureID);
        continue;
      }
      const extent = feature.geometry?.world?.extent;
      const i = (!viewBox || !extent || extent.intersects(viewBox)) ? 0 : 1;
      if (feature.type === 'Point') {
        points[i].push(feature as PixiFeaturePoint);
      } else if (feature.type === 'LineString') {
        lines[i].push(feature as PixiFeatureLine);
      } else if (feature.type === 'Polygon') {
        polygons[i].push(feature as PixiFeaturePolygon);
      } else {
        this._queue.delete(featureID);
      }
    }

    const stop = force ? undefined : () => (this._numTried++ >= MIN_PLACED && !frame.hasTime());
    for (const i of [0, 1]) {
      if (!this.labelPoints(points[i], stop)) return false;
      if (!this.labelLines(lines[i], stop)) return false;
      if (!this.labelPolygons(polygons[i], stop)) return false;
    }
    return true;
  }


  /**
   * Remembers a line or polygon that had a label and no room for it, so that it's tried again
   * when room is made along it (see `_retryUnplaced`).
   * @param featureID - The feature
   * @param coords - The coordinates its label would have run along, in label space
   */
  protected _noteUnplaced(featureID: FeatureID, coords: Vec2[]): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX <= maxX) {
      this._unplaced.set(featureID, [minX, minY, maxX, maxY]);
    }
  }


  /**
   * Puts the features that had no room for their label back on the list to be placed, where
   * room has been made since: a label was taken away, or something that labels avoid was
   * hidden, moved or destroyed (the vertices of a way that isn't selected anymore).
   * Nothing else would try them again: a feature is only looked at when it changes.
   */
  protected _retryUnplaced(): void {
    const size = this.scene.labelSpace.avoidGrid.cellSize;

    let freed = this._freed;
    this._freed = [];
    for (const c of this.scene.labelSpace.takeAvoidFrees()) {
      freed.push([c[0] * size, c[1] * size, (c[2] + 1) * size, (c[3] + 1) * size]);
    }
    if (!freed.length || !this._unplaced.size) return;

    if (freed.length > MAX_FREED) {   // too many to compare one by one
      const all: LabelRoom = [Infinity, Infinity, -Infinity, -Infinity];
      for (const box of freed) {
        if (box[0] < all[0]) all[0] = box[0];
        if (box[1] < all[1]) all[1] = box[1];
        if (box[2] > all[2]) all[2] = box[2];
        if (box[3] > all[3]) all[3] = box[3];
      }
      freed = [all];
    }

    for (const [featureID, room] of this._unplaced) {
      for (const box of freed) {
        if (box[0] <= room[2] && box[2] >= room[0] && box[1] <= room[3] && box[3] >= room[1]) {
          this._unplaced.delete(featureID);
          this._labeled.delete(featureID);
          this._pending.add(featureID);
          break;
        }
      }
    }
  }


  /**
   * Text labels are used to label point features like map pins.
   * We generate several placement regions around the marker,
   *  try them until we find one that doesn't collide with something.
   * @param  feature - The feature to place point labels on
   * @param  measurement - The label measurements (size + str/style)
   */
  public placeTextLabel(feature: PixiFeaturePoint, measurement: LabelMeasurement): void {
    if (!feature) return;

    const spatial = this.context.systems.spatial!;
    const grid = this.scene.labelSpace.avoidGrid;
    const showDebug = this.context.getDebug('label');
    const featureID = feature.id;
    const container = feature.container;
    if (!container.visible || !container.renderable) return;

    // `f` - feature, the box of what the point draws, in label space: the screen minus the
    // label offset. (In screen coordinates, as the user pans or rotates the map, the objects
    // that leave and re-enter the scene would end up with different coordinates each time!)
    // The point says where it's drawn: it may be drawn by a batch, and not be in the scene.
    const box = feature.labelBox(this._pointBox);
    if (!box) return;

    const fLeft = box[0] - 1;   // (a pixel of room on either side)
    const fTop = box[1];
    const fWidth = box[2] - box[0] + 2;
    const fHeight = box[3] - box[1];
    const fRight = fLeft + fWidth;
    const fMidX = fLeft + (fWidth * 0.5);
    const fBottom = fTop + fHeight;
    const fMidY = fBottom - 14;  // next to marker

    // `l` = label, these bounds are in "local" coordinates to the label,
    // 0,0 is the center of the label
    // (padY -1, because for some reason, calculated height seems higher than necessary)
    const lWidth = measurement.width;
    const lHeight = measurement.height - 2;  // .pad(0, -1) equivalent: shrink height by 1 on each side
    const some = 5;
    const more = 10;
    const lWidthHalf = lWidth * 0.5;
    const lHeightHalf = lHeight * 0.5;

    // Attempt several placements (these are calculated in "global" coordinates)
    const placements: Record<PlacementID, number[]> = {
      t1: [fMidX - more,  fTop - lHeightHalf],       //    t1 t2 t3 t4 t5
      t2: [fMidX - some,  fTop - lHeightHalf],       //      +---+---+
      t3: [fMidX,         fTop - lHeightHalf],       //      |       |
      t4: [fMidX + some,  fTop - lHeightHalf],       //      |       |
      t5: [fMidX + more,  fTop - lHeightHalf],       //      +---+---+

      b1: [fMidX - more,  fBottom + lHeightHalf],    //      +---+---+
      b2: [fMidX - some,  fBottom + lHeightHalf],    //      |       |
      b3: [fMidX,         fBottom + lHeightHalf],    //      |       |
      b4: [fMidX + some,  fBottom + lHeightHalf],    //      +---+---+
      b5: [fMidX + more,  fBottom + lHeightHalf],    //    b1 b2 b3 b4 b5

      r1: [fRight + lWidthHalf,  fMidY - more],      //      +---+---+  r1
      r2: [fRight + lWidthHalf,  fMidY - some],      //      |       |  r2
      r3: [fRight + lWidthHalf,  fMidY],             //      |       |  r3
      r4: [fRight + lWidthHalf,  fMidY + some],      //      |       |  r4
      r5: [fRight + lWidthHalf,  fMidY + more],      //      +---+---+  r5

      l1: [fLeft - lWidthHalf,  fMidY - more],       //  l1  +---+---+
      l2: [fLeft - lWidthHalf,  fMidY - some],       //  l2  |       |
      l3: [fLeft - lWidthHalf,  fMidY],              //  l3  |       |
      l4: [fLeft - lWidthHalf,  fMidY + some],       //  l4  |       |
      l5: [fLeft - lWidthHalf,  fMidY + more]        //  l5  +---+---+
    };

    // In order of preference (If left-to-right language, prefer the right of the pin)
    // Prefer placements that are more "visually attached" to the pin (right,bottom,left,top)
    // over placements that are further away (corners)
    let attempts: PlacementID[];
    const isRTL = this.context.systems.l10n?.isRTL;

    if (isRTL) {   // right to left
      attempts = [
        'l3', 'l4', 'l2',
        'b3', 'b2', 'b4', 'b1', 'b5',
        't3', 't2', 't4', 't1', 't5',
        'r3', 'r4', 'r2',
        'l5', 'l1',
        'r5', 'r1'
      ];
    } else {   // left to right
      attempts = [
        'r3', 'r4', 'r2',
        'b3', 'b4', 'b2', 'b5', 'b1',
        'l3', 'l4', 'l2',
        't3', 't4', 't2', 't5', 't1',
        'r5', 'r1',
        'l5', 'l1'
      ];
    }

    // A point's label goes right next to the point, and the point is something to avoid: its
    // own cells would be in the way of every place tried. So they're set aside while its label
    // is placed. (The points around it stay in the way.)
    const ownCells = feature.avoidCells;
    if (ownCells) {
      grid.unmark('avoid', ownCells);
    }

//    let picked = null;
    for (const placementID of attempts) {
      const [x, y] = placements[placementID];
      const EPSILON = 0.01;
      // Use a label-specific ID so the label feature doesn't collide with the source
      // feature in `scene.features` (which is keyed by `feature.id`).
      const labelID: LabelID = `${featureID}-label`;
      const labelItem: LabelItem = {
        id: `${featureID}-${placementID}`,
        contents: {
          type: 'label',
          featureID: featureID,
          labelID: labelID
        },
        minX: x - lWidthHalf + EPSILON,
        minY: y - lHeightHalf + EPSILON,
        maxX: x + lWidthHalf - EPSILON,
        maxY: y + lHeightHalf - EPSILON
      };

      // If we can render the label in this box..
      // Store the placeholder props, and insert the box into the rbush so
      // nothing else gets placed there.  The PixiFeatureLabel itself is
      // created lazily in renderObjects() the first time this label is in view.
      // (Against the other labels, the boxes themselves are compared: there are few of them, and
      // the grid's cells would keep two labels further apart than they need to be.)
      const cells = grid.cellsOf(labelItem.minX, labelItem.minY, labelItem.maxX, labelItem.maxY);
      if (cells && !grid.isTaken('avoid', cells) && !spatial.hasItemsAtBox(SPATIAL_LABELS, labelItem)) {
//        picked = placementID;
        const style = feature.style as any;
        const props: TextLabelProps = {
          kind: 'text',
          str: measurement.str,
          style: measurement.style,
          width: measurement.width,
          height: measurement.height,
          x: x,
          y: y,
          tint: style?.label?.color ?? 0xeeeeee
        };
        this._placeholders.set(labelID, props);
        this._didPlace = true;

        this._cacheBox(labelItem);
        spatial.addItems(SPATIAL_LABELS, labelItem);
        labelItem.contents.cells = cells;
        grid.mark('label', cells);

        if (showDebug) {
          const debugItem: LabelItem = {
            id: labelItem.id + '-debug',
            contents: {
              type: 'debug',
              featureID: featureID,
              tint: 0x00ff00,   // green (ok)
              objectID: null
            },
            minX: labelItem.minX,
            minY: labelItem.minY,
            maxX: labelItem.maxX,
            maxY: labelItem.maxY
          };

          this._cacheBox(debugItem);
          spatial.addItems(SPATIAL_DEBUG, debugItem);
        }
        break;
      }
    }

    if (ownCells) {
      grid.mark('avoid', ownCells);
    }

//    if (!picked) {
//      labelObj.destroy();  // didn't place it
//    }
  }


  /**
   * Rope labels are placed along a string of coordinates.
   * We generate chains of bounding boxes along the line,
   *  then add the labels in spaces along the line wherever they fit.
   * @param feature - The feature to place rope labels on
   * @param measurement - The label measurements (size + str/style)
   * @param coords - The coordinates to place a rope on, in label space (= global screen minus labelOffset)
   */
  public placeRopeLabel(feature: AbstractPixiFeature, measurement: LabelMeasurement, coords: Vec2[]): void {
    if (!feature || !measurement || !coords) return;
    if (!feature.container.visible || !feature.container.renderable) return;

    const spatial = this.context.systems.spatial!;
    const grid = this.scene.labelSpace.avoidGrid;
    const showDebug = this.context.getDebug('label');
    const featureID = feature.id;

    // `l` = label, these bounds are in "local" coordinates to the label,
    // 0,0 is the center of the label
    const lWidth = measurement.width;
    const lHeight = measurement.height;
    const BENDLIMIT = Math.PI / 8;

    // The size of the collision test bounding boxes, in pixels.
    // Higher numbers will be faster but yield less granular placement
    const boxsize = lHeight + 4;
    const boxhalf = boxsize * 0.5;

    // # of boxes needed to provide enough length for this label
    const numBoxes = Math.ceil(lWidth / boxsize) + 1;
    // Labels will be stretched across boxes slightly, this will scale them back to `lWidth` pixels
    const scaleX = lWidth / ((numBoxes - 1) * boxsize);
    // We'll break long chains into smaller regions and center a label within each region
    const maxChainLength = numBoxes + 15;

    // Cover the line in bounding boxes.
    // `geomLineSegments` walks the whole line continuously, emitting positions spaced exactly
    // `boxsize` apart.  That uniform spacing is what lets the `scaleX` math above hold (so the
    // label text is sized correctly without any post-correction).
    const segments = geomLineSegments(coords, boxsize);

    const labelItems: LabelItem[] = [];
    const debugItems: LabelItem[] = [];
    const candidates: ChainLink[][] = [];
    let currChain: ChainLink[] = [];
    let prevAngle: number | null = null;

    // Finish current chain of bounding boxes, if any.
    // It will be saved as a label candidate if it is long enough.
    // Each chain link has:  { box: box, coord: coord, angle: currAngle }
    const finishChain = (): void => {
      const isCandidate = (currChain.length >= numBoxes);
      if (isCandidate) {
        candidates.push(currChain);
      } else {  // too short to be a candidate
        for (const link of currChain) {
          link.debugItem.contents.tint = 0xffff33;  // yellow (too small)
        }
      }
      currChain = [];   // reset chain
    };


    // Whether a box is clear of everything labels avoid (by the grid), and of the other labels
    // (by their boxes: there are few of them, and cells would keep labels further apart).
    const isFree = (item: LabelItem): boolean => {
      const cells = grid.cellsOf(item.minX, item.minY, item.maxX, item.maxY);
      return !!cells && !grid.isTaken('avoid', cells) && !spatial.hasItemsAtBox(SPATIAL_LABELS, item);
    };

    // Walk the line, creating chains of bounding boxes,
    // and testing for candidate chains where labels can go.
    const EPSILON = 0.01;
    segments.forEach((segment, segmentIndex) => {
      const currAngle = numWrap(segment.angle, 0, TAU);  // normalize to 0…2π

      segment.coords.forEach((coord, coordIndex) => {
        const [x, y] = coord;

        const labelItem: LabelItem = {
          id: `${featureID}-${segmentIndex}-${coordIndex}`,
          contents: {
            type: 'label',
            featureID: featureID,
            labelID: null   // will be assigned below if this spot gets a label
          },
          minX: x - boxhalf + EPSILON,
          minY: y - boxhalf + EPSILON,
          maxX: x + boxhalf - EPSILON,
          maxY: y + boxhalf - EPSILON
        };

        const debugItem: LabelItem = {
          id: labelItem.id + '-debug',
          contents: {
            type: 'debug',
            featureID: featureID,
            tint: 0x00ff00,   // may be changed below
            objectID: null
          },
          minX: labelItem.minX,
          minY: labelItem.minY,
          maxX: labelItem.maxX,
          maxY: labelItem.maxY
        };

        // Avoid placing labels where the line bends too much..
        let tooBendy = false;
        if (prevAngle !== null) {
          // compare angles properly: https://stackoverflow.com/a/1878936/7620
          const diff = Math.abs(currAngle - prevAngle);
          tooBendy = Math.min(TAU - diff, diff) > BENDLIMIT;
        }
        prevAngle = currAngle;

        if (tooBendy) {
          finishChain();
          debugItem.contents.tint = 0xff33ff;  // magenta (too bendy)

        } else if (!isFree(labelItem)) {
          finishChain();
          debugItem.contents.tint = 0xff0000;  // red (collision)

        } else {   // Label can go here..
          debugItem.contents.tint = 0x00ff00;  // green (ok)
          currChain.push({
            labelItem: labelItem,
            debugItem: debugItem,
            coord: coord,
            angle: currAngle
          });
          if (currChain.length === maxChainLength) {
            finishChain();
          }
        }

        if (showDebug) {
          this._cacheBox(debugItem);
          debugItems.push(debugItem);
        }
      });
    });

    finishChain();


    // Compute a Label placement in the middle of each chain,
    // and insert the boxes into the rbush so nothing else gets placed there.
    candidates.forEach((chain, chainIndex) => {
      // Set aside half any extra boxes at the beginning of the chain
      // (This centers the label within the chain)
      const startIndex = Math.floor((chain.length - numBoxes) / 2);
      const labelID = `${featureID}-rope-${chainIndex}`;

      const ropeCoords: Vec2[] = [];
      for (let i = startIndex; i < startIndex + numBoxes; i++) {
        ropeCoords.push(chain[i].coord);
        const labelItem = chain[i].labelItem;
        labelItem.contents.labelID = labelID;
        const cells = grid.cellsOf(labelItem.minX, labelItem.minY, labelItem.maxX, labelItem.maxY);
        if (cells) {
          labelItem.contents.cells = cells;
          grid.mark('label', cells);
        }
        this._cacheBox(labelItem);
        labelItems.push(labelItem);
      }

      if (!ropeCoords.length) return;  // shouldn't happen, min numBoxes is 2 boxes

      const sum = ropeCoords.reduce((acc, coord) => vecAdd(acc, coord), [0, 0]);
      const ropeOrigin = vecScale(sum, 1 / ropeCoords.length);  // pick local origin as the average of the points
      let angle = vecAngle(ropeCoords.at(0)!, ropeCoords.at(-1)!);
      angle = numWrap(angle, 0, TAU);  // angle from x-axis, normalize to 0…2π
      if (angle > HALF_PI && angle < (3 * HALF_PI)) {  // rope is upside down, flip it
        angle -= Math.PI;
        ropeCoords.reverse();
      }

      // The `ropeCoords` array follows our bounding box chain, however it will be a little
      // longer than the label needs to be, which can cause stretching of small labels.
      // Here we will scale the points down to the desired label width.
      let scaledCoords = ropeCoords.map(coord => vecSubtract(coord, ropeOrigin));  // to local coords
      scaledCoords = geomRotate(scaledCoords, -angle, [0,0]);                      // rotate to x axis
      scaledCoords = scaledCoords.map(([x,y]) => [x * scaleX, y]);                 // apply `scaleX`
      scaledCoords = geomRotate(scaledCoords, angle, [0,0]);                       // rotate back
      scaledCoords = scaledCoords.map(coord => vecAdd(coord, ropeOrigin));         // back to global coords

      const style = feature.style as any;
      const props: RopeLabelProps = {
        kind: 'rope',
        str: measurement.str,
        style: measurement.style,
        width: measurement.width,
        height: measurement.height,
        coords: scaledCoords,
        tint: style?.label?.color ?? 0xeeeeee
      };
      this._placeholders.set(labelID, props);
      this._didPlace = true;
    });

    // Bulk insert any items we collected..
    if (labelItems.length) {
      spatial.addItems(SPATIAL_LABELS, labelItems);
    }
    if (showDebug && debugItems.length) {
      spatial.addItems(SPATIAL_DEBUG, debugItems);
    }
  }


  /**
   * Materialize Label features for the placeholders currently in view, then update them.
   * Follows the standard managed-feature pattern used by other layers (see `PixiLayerKeepRight.render`):
   * look up the feature by ID, create one if missing, call `update()` and `retainFeature()`.
   * Off-screen labels are automatically destroyed by `AbstractPixiLayer.cull()` (after 20 frames).
   * Their placeholders remain in `_labels` so they can be rebuilt if they scroll back into view.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderLabels(frame: RenderFrame, viewport: Viewport): void {
    const spatial = this.context.systems.spatial!;
    // bhousel 4/1/26:  MeshRope is not supported for
    // the new experimental Pixi Canvas renderer yet.
    const renderer = this.gfx!.pixi!.renderer;
    const isCanvas = (renderer.type === PIXI.RendererType.CANVAS);

    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi!.screen;
    const labelOffset = this.scene.labelSpace.offset;
    const screenBounds = {
      minX: screen.x - labelOffset.x,
      minY: screen.y - labelOffset.y,
      maxX: screen.width - labelOffset.x,
      maxY: screen.height - labelOffset.y
    };

    // Collect Labels in view
    // Note that a single label may have many covering boxes inserted into the rbush.
    const labelIDs = new Set<LabelID>();
    const seenTextures = new Set<string>();
    for (const item of spatial.getItemsAtBox(SPATIAL_LABELS, screenBounds)) {
      const contents = item.contents as LabelContents;
      if (contents.labelID) {    // a real label (not an avoid)
        labelIDs.add(contents.labelID);
      }
    }

    // Materialize / update each visible Label feature.
    const parentContainer = this.labelContainer!;
    for (const labelID of labelIDs) {
      const props = this._placeholders.get(labelID);
      if (!props) continue;                              // unknown labelID - shouldn't happen?
      if (props.kind === 'rope' && isCanvas) continue;   // canvas renderer can't do MeshRope

      seenTextures.add(props.str);

      let feature = this.features.get(labelID) as PixiFeatureLabel | undefined;
      if (!feature) {
        feature = new PixiFeatureLabel(this, labelID);
        feature.parentContainer = parentContainer;
        feature.props = props;
      }

      // this.syncFeatureClasses(feature);  // not needed at this time
      feature.update(viewport);
      this.retainFeature(feature, frame);
    }

    // Cleanup label textures not visible in the scene anymore.
    // (Otherwise the text atlas will just keep growing)
    const textureManager = this.gfx.textureManager!;
    for (const [str, textureID] of this._textureIDs) {
      if (!seenTextures.has(str)) {
        textureManager.free('text', textureID);
        this._textureIDs.delete(str);
      }
    }
  }


  /**
   * Shows what labels avoid, as red boxes, in the label debug view (`context.setDebug('label')`).
   * The avoids are marks in the scene's avoid grid, made by the features themselves, so this
   * asks every feature for the cells it marked. (A walk over the whole scene, on every frame:
   * for the debug view only.)
   */
  public renderDebugAvoids(): void {
    const size = this.scene.labelSpace.avoidGrid.cellSize;
    const debugAvoids = this._debugAvoids;
    const seen = new Set<FeatureID>();

    for (const feature of this.scene.features.values()) {
      const cells = feature.avoidCells;
      if (!cells) continue;
      seen.add(feature.id);

      const existing = debugAvoids.get(feature.id);
      if (existing?.cells === cells) continue;      // (a feature gets a new array when its cells change)
      existing?.sprite.destroy();

      const x = cells[0] * size;
      const y = cells[1] * size;
      const w = (cells[2] - cells[0] + 1) * size;
      const h = (cells[3] - cells[1] + 1) * size;
      const sprite = getDebugBBox(x, y, w, h, 0xff0000, 0.65, `${feature.id}-avoid-debug`);   // red (avoid)
      this.debugContainer!.addChild(sprite);
      debugAvoids.set(feature.id, { sprite: sprite, cells: cells });
    }

    for (const [featureID, { sprite }] of debugAvoids) {
      if (!seen.has(featureID)) {
        sprite.destroy();
        debugAvoids.delete(featureID);    // (deleting from a Map while iterating over it is safe)
      }
    }
  }


  /**
   * This renders any of the debug sprites in the view
   */
  public renderDebug(): void {
    const spatial = this.context.systems.spatial!;
    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi!.screen;
    const labelOffset = this.scene.labelSpace.offset;
    const screenBounds = {
      minX: screen.x - labelOffset.x,
      minY: screen.y - labelOffset.y,
      maxX: screen.width - labelOffset.x,
      maxY: screen.height - labelOffset.y
    };

    // Create and add debug boxes to the scene, if needed
    const items = spatial.getItemsAtBox(SPATIAL_DEBUG, screenBounds);
    for (const item of items) {
      const contents = item.contents as LabelContents;
      if (!contents.objectID) {
        const tint = contents.tint ?? 0xffffff;
        const objectID = item.id;
        const sprite = getDebugBBox(item.minX, item.minY, item.maxX - item.minX, item.maxY - item.minY, tint, 0.65, objectID);

        this._debugSprites.set(objectID, sprite);
        contents.objectID = objectID;
        this.debugContainer!.addChild(sprite);
      }
    }
  }

}
