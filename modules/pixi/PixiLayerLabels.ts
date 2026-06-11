import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { HALF_PI, TAU, WORLD_HALF, numWrap, vecAdd, vecAngle, vecScale, vecSubtract, geomRotate } from '@rapid-sdk/math';
import { PixiFeatureLabel } from './PixiFeatureLabel.ts';
import RBush from 'rbush';
import { getDebugBBox, lineToPoly } from './helpers.ts';
import { geomCoverageBoxes } from '../geo/index.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { BBox } from 'rbush';
import type { PixiFeatureLabelProps, TextLabelProps, RopeLabelProps } from './PixiFeatureLabel.ts';
import type { PixiFeatureLine } from './PixiFeatureLine.ts';
import type { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import type { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


const MINZOOM = 12;

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

/** Box used in RBush for collision detection */
interface LabelBox extends BBox {
  type: 'label' | 'avoid' | 'debug';
  id: BoxID;
  featureID: FeatureID;
  labelID?: LabelID | null;
  objectID?: string | null;
  tint?: number;
}

/** Placement ids for labels placed adjacent to map pins */
type PlacementID =
  't1' | 't2' | 't3' | 't4' | 't5' |
  'r1' | 'r2' | 'r3' | 'r4' | 'r5' |
  'b1' | 'b2' | 'b3' | 'b4' | 'b5' |
  'l1' | 'l2' | 'l3' | 'l4' | 'l5';

/** Chain link for rope label placement */
interface ChainLink {
  labelBox: LabelBox;
  debugBox: LabelBox;
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

  /** Labeling spatial index - contains boxes covering placed labels and regions to avoid */
  protected _labelRBush: RBush<LabelBox>;
  /** Debugging spatial index - contains boxes covering all tested regions */
  protected _debugRBush: RBush<LabelBox>;

  /** FeatureIDs that we are avoiding (e.g. map pins, vertices, junctions) */
  protected _avoided: Set<FeatureID>;
  /** FeatureIDs that have been labeled (points, roads, etc) - note that point features can be both avoided and labeled */
  protected _labeled: Set<FeatureID>;

  /** Mapping of a BoxID to a Box, as indexed by RBush */
  protected _boxes: Map<BoxID, LabelBox>;

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

  /** Tracks the difference between the top left corner of the screen and the parent "origin" container */
  protected _labelOffset: PIXI.Point;
  /** Pixi TextStyle for normal-weight label text */
  protected _textStyleNormal: PIXI.TextStyle;
  /** Pixi TextStyle for italic label text */
  protected _textStyleItalic: PIXI.TextStyle;


  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'labels';
    this.enabled = true;   // labels should be enabled by default

    this.labelOriginContainer = null;
    this.debugContainer = null;
    this.labelContainer = null;

    // RBush spatial indexes
    this._labelRBush = new RBush<LabelBox>();  // label placement
    this._debugRBush = new RBush<LabelBox>();  // debug sprites

    // Keep track of the labelable features we have processed
    this._avoided = new Set<FeatureID>();
    this._labeled = new Set<FeatureID>();

    // Label placeholders — store the placement props for every possible label.
    // Each one is materialized into a `PixiFeatureLabel` lazily on first visibility
    // (see `renderLabels()`), to avoid creating display objects for the many labels
    // that are placed far off-screen.
    this._placeholders = new Map<LabelID, PixiFeatureLabelProps>();

    // Pixi Display Objects for debug bbox sprites.
    // (Label display objects live on their owning `PixiFeatureLabel` features.)
    this._debugSprites = new Map<string, PIXI.Sprite>();

    // Boxes are objects for working with RBush.
    this._boxes = new Map<BoxID, LabelBox>();
    this._featureBoxes = new Map<FeatureID, Set<BoxID>>();

    // Mapping of a text string (e.g. "Main Street") to generated texture
    this._textureIDs = new Map<string, TextureID>();

    // Deferred label rasterization queue (see measureLabel / resolveLabelTexture).
    this._pendingRasters = new Map();   // Map<TextureID, { str, style }>
    this._rasterDrainScheduled = false;

    // We reset the labeling when scale or rotation change
    this._tPrev = { x: 0, y: 0, z: 1, r: 0 };

    // Tracks the difference between the top left corner of the screen and the parent "origin" container
    this._labelOffset = new PIXI.Point();

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

    // Destroy any Pixi display objects that we created.
    for (const object of this._debugSprites.values()) {
      object.destroy();
    }

    this._labelRBush.clear();
    this._debugRBush.clear();
    this._avoided.clear();
    this._labeled.clear();
    this._placeholders.clear();
    this._debugSprites.clear();
    this._boxes.clear();
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
      (feature as any)._labelDirty = false;
    }
  }


  /**
   * Remove data from labeling caches for the given feature.
   * This will force the feature to be relabeled.
   * @param featureID - The feature ID to reset
   */
  public resetFeature(featureID: FeatureID): void {
    this._avoided.delete(featureID);
    this._labeled.delete(featureID);

    const labelIDs = new Set<LabelID>();
    const debugObjectIDs = new Set<string>();

    // Gather `labelIDs` from the label boxes, `objectIDs` from the debug boxes.
    // Then remove the boxes from the RBushes and our box cache.
    const boxIDs = this._featureBoxes.get(featureID) || [];
    for (const boxID of boxIDs) {
      const box = this._boxes.get(boxID);
      if (box) {
        if (box.type === 'label' || box.type === 'avoid') {
          this._labelRBush.remove(box);
        }
        if (box.type === 'debug') {
          this._debugRBush.remove(box);
          if (box.objectID) {
            debugObjectIDs.add(box.objectID);
          }
        }
        if (box.labelID) {
          labelIDs.add(box.labelID);
        }
      }
      this._boxes.delete(boxID);
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
   * Render all the labels. This is a multi-step process:
   * - gather avoids - these are places in the scene that we don't want a label
   * - label placement - do the math of figuring out where labels should be
   * - label rendering - show or hide labels based on their visibility
   *
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || viewZoom < MINZOOM) {
      this.labelContainer!.visible = false;
      this.debugContainer!.visible = false;
      return;
    }

    // Reset stale labels, as needed
    const tPrev = this._tPrev;
    const tCurr = viewport.transform.props;
    if (tCurr.z !== tPrev.z || tCurr.r !== tPrev.r) {  // zoom or rotation changed
      this.reset();                                    // reset all labels
    } else {
      for (const [featureID, feature] of this.scene.features) {
        if ((feature as any)._labelDirty) {       // reset only the changed labels
          this.resetFeature(featureID);
          (feature as any)._labelDirty = false;
        }
      }
    }
    this._tPrev = tCurr;


    // The label container should be kept unrotated so that it stays screen-up not north-up.
    // We need to counter the effects of the 'stage' and 'origin' containers that we are underneath.
    const stage = this.gfx.stage!;
    const origin = this.gfx.origin!;
    const bearing = viewport.transform.rotation;
    const worldScale = origin.scale.x;

    // Compute `labelOffset` — the screen-space anchor we subtract from feature positions
    // before caching them in the rbush. The key invariant is that `labelOffset` must change
    // by exactly the pan delta on each frame, so `featureScreen − labelOffset` is invariant
    // under panning (and the cached rbush coords stay valid as the user pans around).
    //
    // `origin.toGlobal(P_local)` gives us that invariance automatically for any constant P_local
    // (since only `origin.position` changes during pan, and it adds the same delta regardless
    // of P_local). The naive choice P_local = (0, 0) is world-coord [0,0] — far from the
    // viewport at high zooms, producing huge labelOffset values that cause GPU float32
    // precision loss in MeshRope vertex math (visible as distorted rope label text).
    //
    // Instead, pick P_local so it maps near the viewport: subtract off the constant
    // `(pixiT - WORLD_HALF*ws)` term that origin.position carries for world→screen scaling.
    // The `viewport` passed in here is the pixi viewport (see GraphicsSystem._app).
    const labelOffset = this._labelOffset;
    const pixiT = viewport.transform.translation;
    origin.toGlobal({
      x: WORLD_HALF - pixiT[0] / worldScale,
      y: WORLD_HALF - pixiT[1] / worldScale
    }, labelOffset);

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

    // Collect features to avoid.
    this.gatherAvoids();

    // Collect features to place labels on.
    const points: PixiFeaturePoint[] = [];
    const lines: PixiFeatureLine[] = [];
    const polygons: PixiFeaturePolygon[] = [];
    for (const [featureID, feature] of this.scene.features) {
      // If the feature can be labeled, and hasn't yet been, add it to the list for placement.
      if (feature.label && feature.visible && !this._labeled.has(featureID)) {
        if (feature.type === 'Point') {
          points.push(feature as PixiFeaturePoint);
        } else if (feature.type === 'LineString') {
          lines.push(feature as PixiFeatureLine);
        } else if (feature.type === 'Polygon') {
          polygons.push(feature as PixiFeaturePolygon);
        }
      }
    }

    // Points first, then lines (so line labels can avoid point labels)
    this.labelPoints(points);
    this.labelLines(lines);
    this.labelPolygons(polygons);

    this.labelContainer!.visible = true;
    this.renderLabels(frame, viewport);

    const showDebug = this.context.getDebug('label');
    if (showDebug) {
      this.debugContainer!.visible = true;
      this.renderDebug();
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
   * and corrupt batcher state — see lessons.md "Pixi v8 renderer is NOT re-entrant").
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
   * not nested inside another `renderer.render()` pass — see lessons.md
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
   * Called from the scheduler's drain phase, NOT from render() — see `_scheduleRasterDrain`.
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

    // Wake the scene so newly-rasterized labels appear on the next frame.
    this.gfx.immediateRedraw();
  }


  /**
   * Gather the avoidable features, create boxes for them,
   *  and insert them into the placement Rbush.
   * If a new avoidance collides with an already placed label,
   *  destroy the label and flag the feature as labeldirty for relabeling
   */
  public gatherAvoids(): void {
    const showDebug = this.context.getDebug('label');

    // Gather the containers that have avoidable stuff on them.
    const avoidContainers: PIXI.Container[] = [];

    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;
    if (selectedContainer) {
      avoidContainers.push(selectedContainer);
    }
    const pointsContainer = this.scene.groups.get('points')!;
    if (pointsContainer) {
      avoidContainers.push(pointsContainer);
    }

    // For each container, gather the things to avoid.
    const labelBoxes: LabelBox[] = [];
    const debugBoxes: LabelBox[] = [];

    const avoidObject = (sourceObject: PIXI.Container): void => {
      if (!sourceObject.visible || !sourceObject.renderable) return;
      const featureID = sourceObject.label;

      if (this._avoided.has(featureID)) return;  // we've processed this avoidance already
      this._avoided.add(featureID);

      // The rectangle is in global/screen coordinates (where [0,0] is top left).
      // To work in a coordinate system that is consistent, remove the label offset.
      // If we didn't do this, as the user pans or rotates the map, the objects that leave
      // and re-enter the scene would end up with different coordinates each time!
      const fRect = sourceObject.getBounds().rectangle;
      fRect.x -= this._labelOffset.x;
      fRect.y -= this._labelOffset.y;

      const EPSILON = 0.01;

      const avoidBox: LabelBox = {
        type: 'avoid',
        id: `${featureID}-avoid`,
        featureID: featureID,
        labelID: null,
        minX: fRect.x + EPSILON,
        minY: fRect.y + EPSILON,
        maxX: fRect.x + fRect.width - EPSILON,
        maxY: fRect.y + fRect.height - EPSILON
      };

      this._cacheBox(avoidBox);
      labelBoxes.push(avoidBox);

      if (showDebug) {
        const debugBox: LabelBox = {
          type: 'debug',
          id: avoidBox.id + '-debug',
          featureID: featureID,
          tint: 0xff0000,   // red (avoid)
          objectID: null,
          minX: avoidBox.minX,
          minY: avoidBox.minY,
          maxX: avoidBox.maxX,
          maxY: avoidBox.maxY
        };

        this._cacheBox(debugBox);
        debugBoxes.push(debugBox);
      }

      // If there is already a label where this avoid box is, we will need to redo that label.
      // This is somewhat common that a label will be placed somewhere, then as more map loads,
      // we learn that some of those junctions become important and we need to avoid them.
      for (const hit of this._labelRBush.search(avoidBox)) {
        if (hit.type === 'label' && hit.featureID) {
          this.resetFeature(hit.featureID);
        }
      }
    };

    for (const container of avoidContainers) {
      for (const child of container.children) {
        avoidObject(child as PIXI.Container);
      }
    }

    // Bulk insert any boxes we collected..
    if (labelBoxes.length) {
      this._labelRBush.load(labelBoxes);
    }
    if (showDebug && debugBoxes.length) {
      this._debugRBush.load(debugBoxes);
    }
  }


  /**
   * Add the given box to the caches.
   * The box should have `id` and `featureID` properties.
   * @param box - the box to cache
   */
  protected _cacheBox(box: LabelBox): void {
    const boxID = box.id;
    const featureID = box.featureID;
    if (!boxID || !featureID) return;

    this._boxes.set(boxID, box);

    let featureBoxIDs = this._featureBoxes.get(featureID);
    if (!featureBoxIDs) {
      featureBoxIDs = new Set<BoxID>();
      this._featureBoxes.set(featureID, featureBoxIDs);
    }
    featureBoxIDs.add(boxID);
  }


  /**
   * This calculates the placement, but does not actually add the label to the scene.
   * @param features - The features to place point labels on
   */
  public labelPoints(features: PixiFeaturePoint[]): void {
    // Sort by container y-position (north-to-south in world coords) for stable placement priority.
    features.sort((a, b) => a.container.position.y - b.container.position.y);

    for (const feature of features) {
      const featureID = feature.id;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;  // no label needed

      const measurement = this.measureLabel(feature.label, 'normal');
      this.placeTextLabel(feature, measurement);
    }
  }


  /**
   * Lines are labeled with `PIXI.SimpleRope` that run along the line.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param features - The features to place point labels on
   */
  public labelLines(features: PixiFeatureLine[]): void {
    /**
     * Priority sort the labels according to what level their feature has been rendered on.
     * This is hacky, but we can sort the line labels by their parent container label (name).
     * It might be a level container with a name like "1", "-1", or just a name like "lines"
     * If `parseInt` fails, just sort the label above everything.
     * @param feature
     */
    function level(feature: PixiFeatureLine): number {
      const parentLabel = feature.container.parent?.label;
      const lvl = parseInt(parentLabel || '999', 10);
      return isNaN(lvl) ? 999 : lvl;
    }

    features.sort((a, b) => level(b) - level(a));

    const temp = new PIXI.Point();
    const labelOffset = this._labelOffset;

    for (const feature of features) {
      const featureID = feature.id;
      const localCoords = feature.geometry?.local?.coords as Vec2[] | undefined;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;   // no label needed
      if (!localCoords || localCoords.length < 2) continue;   // no points
      if (!feature.container.visible || !feature.container.renderable) continue; // not visible

      const fBounds = feature.container.getBounds().rectangle;
      if (fBounds.width < 40 && fBounds.height < 40) continue;    // too small

      // Project line vertices from feature-local space to label space
      // (= global screen minus labelOffset).
      const labelCoords: Vec2[] = new Array(localCoords.length);
      for (let i = 0; i < localCoords.length; i++) {
        const p = localCoords[i];
        feature.container.toGlobal({ x: p[0], y: p[1] }, temp);
        labelCoords[i] = [temp.x - labelOffset.x, temp.y - labelOffset.y];
      }

      const measurement = this.measureLabel(feature.label, 'normal');
      this.placeRopeLabel(feature, measurement, labelCoords);
    }
  }


  /**
   * Polygons are labeled with `PIXI.SimpleRope` that run along the inside of the perimeter.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param features - The features to place point labels on
   */
  public labelPolygons(features: PixiFeaturePolygon[]): void {
    const temp = new PIXI.Point();
    const labelOffset = this._labelOffset;

    for (const feature of features) {
      const featureID = feature.id;
      const outer = feature.geometry?.local?.outer;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;      // no label needed
      if (!outer || outer.length < 3) continue;  // no outer ring
      if (!feature.container.visible || !feature.container.renderable) continue;  // not visible

      const fBounds = feature.container.getBounds().rectangle;
      if (fBounds.width < 600 && fBounds.height < 600) continue;  // too small

      const measurement = this.measureLabel(feature.label, 'italic');

      // Project the outer ring from feature-local space to label space (= global screen minus labelOffset)
      // as a flat array, which is what `lineToPoly` expects.
      const flatOuter: number[] = new Array(outer.length * 2);
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i];
        feature.container.toGlobal({ x: p[0], y: p[1] }, temp);
        flatOuter[i * 2]     = temp.x - labelOffset.x;
        flatOuter[i * 2 + 1] = temp.y - labelOffset.y;
      }

      // someday: precompute line buffer in geometry class maybe?
      const hitStyle = {
        alignment: 0.5,  // middle of line
        color: 0x0,
        width: 24,
        alpha: 1.0,
        join: 'bevel',
        cap: 'butt'
      };
      const bufferdata = lineToPoly(flatOuter, hitStyle);
      if (!bufferdata.inner) continue;
      const coords: Vec2[] = new Array(bufferdata.inner.length / 2);  // un-flatten :(
      for (let i = 0; i < bufferdata.inner.length / 2; ++i) {
        coords[i] = [ bufferdata.inner[(i * 2)], bufferdata.inner[(i * 2) + 1] ];
      }

      this.placeRopeLabel(feature, measurement, coords);
    }
  }


  /**
   * Text labels are used to label point features like map pins.
   * We generate several placement regions around the marker,
   *  try them until we find one that doesn't collide with something.
   * @param  feature - The feature to place point labels on
   * @param  measurement - The label measurements (size + str/style)
   */
  public placeTextLabel(feature: AbstractPixiFeature, measurement: LabelMeasurement): void {
    if (!feature) return;

    const showDebug = this.context.getDebug('label');
    const featureID = feature.id;
    const container = feature.container;
    if (!container.visible || !container.renderable) return;

    // `f` - feature, these bounds are in "global" coordinates
    // The rectangle is in global/screen coordinates (where [0,0] is top left).
    // To work in a coordinate system that is consistent, remove the label offset.
    // If we didn't do this, as the user pans or rotates the map, the objects that leave
    // and re-enter the scene would end up with different coordinates each time!
    const fRect = container.getBounds().clone().pad(1, 0);
    fRect.x -= this._labelOffset.x;
    fRect.y -= this._labelOffset.y;

    const fLeft = fRect.x;
    const fTop = fRect.y;
    const fWidth = fRect.width;
    const fHeight = fRect.height;
    const fRight = fRect.x + fWidth;
    const fMidX = fRect.x + (fWidth * 0.5);
    const fBottom = fRect.y + fHeight;
    const fMidY = (feature.type === 'Point') ? (fRect.y + fHeight - 14)  // next to marker
      : (fRect.y + (fHeight * 0.5));

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

//    let picked = null;
    for (const placementID of attempts) {
      const [x, y] = placements[placementID];
      const EPSILON = 0.01;
      // Use a label-specific ID so the label feature doesn't collide with the source
      // feature in `scene.features` (which is keyed by `feature.id`).
      const labelID: LabelID = `${featureID}-label`;
      const labelBox: LabelBox = {
        type: 'label',
        id: `${featureID}-${placementID}`,
        featureID: featureID,
        labelID: labelID,
        minX: x - lWidthHalf + EPSILON,
        minY: y - lHeightHalf + EPSILON,
        maxX: x + lWidthHalf - EPSILON,
        maxY: y + lHeightHalf - EPSILON
      };

      // If we can render the label in this box..
      // Store the placeholder props, and insert the box into the rbush so
      // nothing else gets placed there.  The PixiFeatureLabel itself is
      // created lazily in renderObjects() the first time this label is in view.
      if (!this._labelRBush.collides(labelBox)) {
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

        this._cacheBox(labelBox);
        this._labelRBush.insert(labelBox);

        if (showDebug) {
          const debugBox: LabelBox = {
            type: 'debug',
            id: labelBox.id + '-debug',
            featureID: featureID,
            tint: 0x00ff00,   // green (ok)
            objectID: null,
            minX: labelBox.minX,
            minY: labelBox.minY,
            maxX: labelBox.maxX,
            maxY: labelBox.maxY
          };

          this._cacheBox(debugBox);
          this._debugRBush.insert(debugBox);
        }
        break;
      }
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
    const scaleX = lWidth / ((numBoxes-1) * boxsize);
    // We'll break long chains into smaller regions and center a label within each region
    const maxChainLength = numBoxes + 15;

    // Cover the line in bounding boxes.
    // `geomCoverageBoxes` walks the line placing square boxes (half-size `boxhalf`)
    // every `boxsize` units, each carrying that segment's heading angle.
    const coverage = geomCoverageBoxes(coords, boxhalf, boxsize);

    const labelBoxes: LabelBox[] = [];
    const debugBoxes: LabelBox[] = [];
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
          link.debugBox.tint = 0xffff33;  // yellow (too small)
        }
      }
      currChain = [];   // reset chain
    };


    // Walk the coverage boxes, creating chains of bounding boxes,
    // and testing for candidate chains where labels can go.
    const EPSILON = 0.01;
    coverage.forEach((cbox, boxIndex) => {
      const currAngle = numWrap(cbox.angle, 0, TAU);  // normalize to 0…2π
      const coord = cbox.coord;

      const labelBox: LabelBox = {
        type: 'label',
        id: `${featureID}-${boxIndex}`,
        featureID: featureID,
        labelID: null,   // will be assigned below if this spot gets a label
        minX: cbox.minX + EPSILON,
        minY: cbox.minY + EPSILON,
        maxX: cbox.maxX - EPSILON,
        maxY: cbox.maxY - EPSILON
      };

      const debugBox: LabelBox = {
        type: 'debug',
        id: labelBox.id + '-debug',
        featureID: featureID,
        tint: 0x00ff00,   // may be changed below
        objectID: null,
        minX: labelBox.minX,
        minY: labelBox.minY,
        maxX: labelBox.maxX,
        maxY: labelBox.maxY
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
        debugBox.tint = 0xff33ff;  // magenta (too bendy)

      } else if (this._labelRBush.collides(labelBox)) {
        finishChain();
        debugBox.tint = 0xff0000;  // red (collision)

      } else {   // Label can go here..
        debugBox.tint = 0x00ff00;  // green (ok)
        currChain.push({
          labelBox: labelBox,
          debugBox: debugBox,
          coord: coord,
          angle: currAngle
        });
        if (currChain.length === maxChainLength) {
          finishChain();
        }
      }

      if (showDebug) {
        this._cacheBox(debugBox);
        debugBoxes.push(debugBox);
      }
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
        const labelBox = chain[i].labelBox;
        labelBox.labelID = labelID;
        this._cacheBox(labelBox);
        labelBoxes.push(labelBox);
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
    });

    // Bulk insert any boxes we collected..
    if (labelBoxes.length) {
      this._labelRBush.load(labelBoxes);
    }
    if (showDebug && debugBoxes.length) {
      this._debugRBush.load(debugBoxes);
    }
  }


  /**
   * Materialize Label features for the placeholders currently in view, then update them.
   * Follows the standard managed-feature pattern used by other layers (see `PixiLayerKeepRight.render`):
   * look up the feature by ID, create one if missing, call `update()` and `retainFeature()`.
   * Off-screen labels are automatically destroyed by `AbstractPixiLayer.cull()` (after 20 frames).
   * Their placeholders remain in `_labels` so they can be rebuilt if they scroll back into view.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderLabels(frame: number, viewport: Viewport): void {
    // bhousel 4/1/26:  MeshRope is not supported for
    // the new experimental Pixi Canvas renderer yet.
    const renderer = this.gfx!.pixi!.renderer;
    const isCanvas = (renderer.type === PIXI.RendererType.CANVAS);

    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi!.screen;
    const labelOffset = this._labelOffset;
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
    for (const box of this._labelRBush.search(screenBounds)) {
      if (box.labelID) {    // a real label (not an avoid)
        labelIDs.add(box.labelID);
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
   * This renders any of the debug sprites in the view
   */
  public renderDebug(): void {
    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi!.screen;
    const labelOffset = this._labelOffset;
    const screenBounds = {
      minX: screen.x - labelOffset.x,
      minY: screen.y - labelOffset.y,
      maxX: screen.width - labelOffset.x,
      maxY: screen.height - labelOffset.y
    };

    // Create and add debug boxes to the scene, if needed
    const boxes = this._debugRBush.search(screenBounds);
    for (const box of boxes) {
      if (!box.objectID) {
        const tint = box.tint ?? 0xffffff;
        const objectID = box.id;
        const sprite = getDebugBBox(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, tint, 0.65, objectID);

        this._debugSprites.set(objectID, sprite);
        box.objectID = objectID;
        this.debugContainer!.addChild(sprite);
      }
    }
  }

}
