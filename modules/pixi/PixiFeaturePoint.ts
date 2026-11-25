import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { PointBatchMesh } from './lib/PointBatchMesh.ts';
import { glowColor } from './helpers.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { BatchMeshItem } from './lib/BatchMesh.ts';
import type { LayerBatches } from './lib/LayerBatches.ts';
import type { PixiFeatureProps } from './AbstractPixiFeature.ts';
import type { PointBatchMeshItem, PointBatchMeshQuad } from './lib/PointBatchMesh.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';

// How many points make the circle of a halo
const HALO_CIRCLE_POINTS = 20;

// The markers that are pins: anchored at their tip, with the icon up in their head
const PINS = ['pin', 'boldPin', 'osmose'];

// Where a pin's icon goes, in pixels above its tip. (The middle of a pin is 15 above it; this looks nicer.
// The `osmose` pin is taller, with its head higher.)
const PIN_ICON_Y: Record<string, number> = { pin: -14, boldPin: -14, osmose: -17 };

// A point can be hit at least this close to it, in pixels across, and this much beyond its marker
const HIT_MINSIZE = 20;
const HIT_PAD = 4;

// In a batch, a point with viewfields is drawn over every point without (see `sceneOrder`).
// (Points are ordered by their place in the world, which is under 2^24.)
const VIEWFIELDS_ABOVE = 2 ** 25;
// ..and the photo that's selected or highlighted over every other (see `sceneOrder`)
const ACTIVE_PHOTO_ABOVE = 2 ** 26;


/** Scratch space for `PixiFeaturePoint.updateAvoid` */
const TEMP: Vec2 = [0, 0];
const TEMP_BOX: [number, number, number, number] = [0, 0, 0, 0];

// The glow behind a hovered or highlighted point: a disc of the glow's color, twice as wide as
// the marker (and at least `GLOW_MIN_SIZE` pixels), that's solid out to half its radius and
// fades from there. It breathes (see `PixiScene.animate`).
const GLOW_SCALE = 2;
const GLOW_MIN_SIZE = 30;
const GLOW_ALPHA = 0.9;

// What `_layout()` worked out, for the feature that's being drawn: its pictures, the lowest
// first (the glow, then the viewfields, then the marker, then the icon), and which of them is
// which. The objects are used again for every feature, so that drawing one makes none.
const QUADS: PointBatchMeshQuad[] = [];
let _glowQuad = -1;
let _firstViewfield = 0;
let _numViewfields = 0;
let _markerQuad = -1;
let _iconQuad = -1;

/**
 * Returns one of the scratch pictures, to be filled in.
 * @param index - Which one
 * @return The picture
 */
function quadAt(index: number): PointBatchMeshQuad {
  let quad = QUADS[index];
  if (!quad) {
    quad = { texture: PIXI.Texture.EMPTY, x: 0, y: 0, width: 0, height: 0, anchorX: 0.5, anchorY: 0.5, rotation: 0, color: 0xffffff, alpha: 1, turns: false, pulses: false };
    QUADS[index] = quad;
  }
  return quad;
}

/**
 * Works out how big a picture is drawn, from what a style says about it.
 * @param quad - The picture. Its `width` and `height` are set.
 * @param size - The style's `size`: the picture is that many pixels across, if it's a number
 * @param scale - The style's `scale`: one number, or one for each direction
 * @param fallback - The size to use if the style has none, or `null` for the texture's own
 */
function setSize(quad: PointBatchMeshQuad, size: number | undefined, scale: number | number[] | undefined, fallback: number | null): void {
  let [scaleX, scaleY] = Array.isArray(scale) ? scale : [scale];
  if (!Number.isFinite(scaleX) || scaleX === 0) scaleX = 1;
  if (!Number.isFinite(scaleY) || scaleY === 0) scaleY = scaleX;

  const across = Number.isFinite(size) ? size! : fallback;
  if (across !== null) {
    quad.width = across * scaleX!;
    quad.height = across * scaleY!;
  } else {
    quad.width = quad.texture.orig.width * scaleX!;
    quad.height = quad.texture.orig.height * scaleY!;
  }
}


/** Additional properties for a point */
export interface PixiFeaturePointProps extends PixiFeatureProps {
  /** Set true to use a circular halo and hit area */
  isCircular: boolean;
  /** Set true if this is a "virtual" pin - these are rendered inside of a polygon */
  isVirtual: boolean;
}


/**
 * This class renders a Point feature: a marker, perhaps with an icon over it and viewfields
 * under it. They're drawn at a size on screen, whatever the zoom, and the marker and icon stay
 * upright however the map is turned.
 *
 * A layer that draws many points gives the feature a `PointBatchMesh`. Its pictures are then a
 * few rectangles in the batch's buffers, drawn with the other points there, and the feature
 * has no sprites and nothing in its container: it needn't be in the scene at all
 * (`drawsInContainer()`). A zoom or a rotation changes nothing in a batch.
 *
 * Without a batch, the pictures are sprites in the feature's container, which is scaled and
 * turned to undo the map's zoom and rotation. A hovered or highlighted point has one picture
 * more, either way: a glow behind the others.
 * (See "Batches" in `design/graphics-system.md`.)
 *
 * Properties available:
 * - `batch`       - `PointBatchMesh` that draws the point, if the layer gave it one
 * - `marker`      - `PIXI.Sprite` for the marker (or `null` while a batch draws the point)
 * - `icon`        - `PIXI.Sprite` for the icon (or `null` if there's none to draw)
 * - `viewfields`  - `PIXI.Container` containing the viewfields (or `null` if none)
 * - `glow`        - `PIXI.Sprite` for the glow of a hover or a highlight (or `null` if there's none to draw)
 * - (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePoint extends AbstractPixiFeature {

  /** PIXI.Sprite for the marker (or null until the point is drawn, and while a batch draws it) */
  public marker: PIXI.Sprite | null;
  /** PIXI.Sprite for the icon (or null while the style has no icon: most vertices) */
  public icon: PIXI.Sprite | null;
  /** PIXI.Container containing the viewfields (or null if none) */
  public viewfields: PIXI.Container | null;
  /** PIXI.Sprite for the glow of a hover or a highlight (or null while there's none, or a batch draws it) */
  public glow: PIXI.Sprite | null;
  /** How the marker is turned on screen, in radians (a midpoint points along its way). Set it before `update()`. */
  public markerRotation: number;
  /** Narrows the inherited `PixiFeatureProps` props to `PixiFeaturePointProps` */
  public declare props: PixiFeaturePointProps;

  /** The batch that the layer gave this feature to draw in (see `batch`) */
  protected _batch: PointBatchMesh | null;
  /** The point in a batch, if a batch draws it */
  protected _item: PointBatchMeshItem | null;
  /** The point's glow in the batch that its batch has for glows, while it's hovered or highlighted there */
  protected _glowItem: PointBatchMeshItem | null;
  /** Whether the point was last drawn with sprites of its own, in its container */
  protected _ownDraw: boolean;
  /** Whether the point's batch couldn't draw it the last time it was drawn (see `drawsInContainer`) */
  protected _unbatchable: boolean;
  /** Whether the point was last drawn with pictures that turn with the map (viewfields) */
  protected _turns: boolean;
  /** Count of viewfield sprites (to detect changes) */
  protected _viewfieldCount: number;
  /** Name of viewfield texture (to detect changes) */
  protected _viewfieldName: string | null;
  /** How big the point is drawn on screen, compared with what its style says (see `updateStyle`) */
  protected _screenScale: number;
  /** The marker's box, in pixels from the point at the style's own size: `[minX, minY, maxX, maxY]` */
  protected _markerBox: [number, number, number, number];
  /** The box of everything the point draws, in pixels from the point on screen: `[minX, minY, maxX, maxY]` (`maxX < minX` if it draws nothing) */
  protected _box: [number, number, number, number];


  /**
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._viewfieldCount = 0;         // to watch for change in # of viewfield sprites
    this._viewfieldName = null;       // to watch for change in viewfield texture
    this._screenScale = 1;
    this._markerBox = [0, 0, 0, 0];
    this._box = [0, 0, -1, -1];
    this._batch = null;
    this._item = null;
    this._glowItem = null;
    this._ownDraw = false;
    this._unbatchable = false;
    this._turns = false;
    this.props.isCircular = false;    // set true to use a circular halo and hit area
    this.markerRotation = 0;

    // The sprites are made in `update()`, if no batch draws the point
    this.marker = null;
    this.icon = null;
    this.viewfields = null;
    this.glow = null;
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    this._dropSprites();
    this._dropItem();
    this.batch = null;

    super.destroy();
  }


  /**
   * The batch to draw the point in, with the other points of the layer, or `null` to draw it
   * with sprites of its own. The layer sets it before `update()`, and positions the batch near
   * the point. The feature may be drawn some frames later, so the batch counts the features it
   * was given to (`BatchMesh.users`).
   * @return The batch, or `null`
   */
  public get batch(): PointBatchMesh | null {
    return this._batch;
  }
  /**
   * @param val - The batch to draw the point in from the next `update()`, or `null` for none.
   *   A point that gets another is drawn again.
   */
  public set batch(val: PointBatchMesh | null) {
    if (val === this._batch) return;
    if (this._batch) this._batch.users--;
    if (val) val.users++;
    this._batch = val;
    this._styleDirty = true;
    this._transformOnly = false;
  }


  /**
   * The point in the batch, if a batch draws it
   * @return The batch's item, or `null`
   * @readonly
   */
  public get item(): PointBatchMeshItem | null {
    return this._item;
  }


  /**
   * The point's glow in a batch of its own, while the point is hovered or highlighted and its
   * batch has one for glows (see `PointBatchMesh.glows`)
   * @return The glows' batch's item, or `null`
   * @readonly
   */
  public get glowItem(): PointBatchMeshItem | null {
    return this._glowItem;
  }


  /**
   * Gives this point its batch: the one for points in the container (see
   * `LayerBatches.pointBatch`). A point already in that container's batch keeps it.
   * @param batches - The layer's batches, or `null` to draw the point with sprites
   * @param parent - The container whose batch to draw in
   */
  public override placeInBatches(batches: LayerBatches | null, parent: PIXI.Container): void {
    const origin = this._geom?.world?.origin;
    if (!batches || !origin) {
      this.batch = null;
    } else if (this._batch?.parent !== parent) {   // (a destroyed batch has no parent)
      this.batch = batches.pointBatch(parent, origin);
    }
  }


  /**
   * Whether this point draws something in its own container, and so has to be in the scene (the
   * layer asks before `update()`, to know whether to give it a place there).
   * A point that a batch draws has nothing in its container, unless the batch couldn't draw
   * it the last time: one of its pictures isn't in the texture that batches draw from
   * (`PointBatchMesh.canDraw`). That's only known once it's drawn, so a layer asks again after
   * `update()`.
   * @return `true` if its container has to be in the scene
   */
  public override drawsInContainer(): boolean {
    const batch = this._batch;
    if (!batch || batch.destroyed) return true;
    return this._unbatchable;
  }


  /**
   * Whether the pointer is over this point: in its hit area, which is around where the point
   * is on screen. This needs nothing of Pixi's, so it's the same whether a batch draws the
   * point (its container isn't in the scene then) or the point draws itself.
   * @param _point - The pointer's place in the stage's coordinates
   * @param world - The same place in world coordinates
   * @return `true` if the pointer hits it
   */
  public override hitTest(_point: PIXI.PointData, world: PIXI.PointData): boolean {
    const origin = this.gfx.origin;
    const hitArea = this.container.hitArea;
    if (!origin || !hitArea || !this.visible || !this._allowInteraction) return false;

    // From the point to the pointer: in the world, then on screen as the world was last drawn,
    // then in the hit area's own pixels (the marker's, before it's made smaller at low zooms).
    const position = this.container.position;
    const m = origin.worldTransform;
    const dx = world.x - position.x;
    const dy = world.y - position.y;
    const scale = this._screenScale;
    return hitArea.contains((m.a * dx + m.c * dy) / scale, (m.b * dx + m.d * dy) / scale);
  }


  /**
   * The batch that draws this point, if one does: where the point is drawn among the others is
   * where that batch is, and the point's `sceneOrder` in it.
   * @return The batch, or this feature's own container
   */
  public override get sceneContainer(): PIXI.Container {
    const item = this._item;
    return (item?.batch && item.visible) ? item.batch : this.container;
  }


  /**
   * Where this point is drawn among the others that its batch draws.
   * @return Its order in the batch (0 if no batch draws it)
   */
  public override get sceneOrder(): number {
    const item = this._item;
    return (item?.batch && item.visible) ? item.order : 0;
  }


  /**
   * Its item in the batch that draws it (see `sceneItem`)
   * @return The item, or `null` if no batch draws it
   */
  public override get sceneItem(): BatchMeshItem | null {
    const item = this._item;
    return (item?.batch && item.visible) ? item : null;
  }


  /**
   * Whether the Feature is currently visible
   * @return `true` if the feature is currently visible
   */
  public override get visible(): boolean {
    return super.visible;
  }
  /**
   * A point that a batch draws is shown and hidden there too. (Not shown there while the point
   * draws itself: see `drawsInContainer`.)
   * @param val - `true` to show the feature, `false` to hide it
   */
  public override set visible(val: boolean) {
    super.visible = val;
    const item = this._item;
    const glowItem = this._glowItem;
    const inBatch = val && !this._ownDraw;
    if (item && item.visible !== inBatch) {
      item.batch?.setVisible(item, inBatch);
    }
    if (glowItem && glowItem.visible !== inBatch) {
      glowItem.batch?.setVisible(glowItem, inBatch);
    }
  }


  /**
   * The box of everything this point draws, in label space (see `LabelSpace.update`),
   * as the point was last drawn. Labels are placed around it, and keep clear of it.
   * @param out - Where to put the result
   * @return `out`, as `[minX, minY, maxX, maxY]`, or `null` if the point draws nothing
   */
  public labelBox(out: [number, number, number, number]): [number, number, number, number] | null {
    const box = this._box;
    const origin = this._geom?.world?.origin;
    if (!origin || box[2] < box[0]) return null;

    const [x, y] = this.scene.labelSpace.worldToLabel(origin[0], origin[1], TEMP);
    out[0] = x + box[0];
    out[1] = y + box[1];
    out[2] = x + box[2];
    out[3] = y + box[3];
    return out;
  }


  /**
   * Destroys the sprites, if this feature has them.
   */
  protected _dropSprites(): void {
    if (this.glow) {
      this.scene.removePulsing(this.glow);
      this.glow.destroy();
      this.glow = null;
    }
    if (this.marker) {
      this.marker.destroy();
      this.marker = null;
    }
    if (this.icon) {
      this.icon.destroy();
      this.icon = null;
    }
    if (this.viewfields) {
      this.viewfields.destroy({ children: true });
      this.viewfields = null;
    }
    this._viewfieldCount = 0;
    this._viewfieldName = null;
  }


  /**
   * Takes the point out of the batch that draws it, if one does.
   */
  protected _dropItem(): void {
    const item = this._item;
    if (item) item.batch?.remove(item);
    this._item = null;
    this._dropGlowItem();
  }


  /**
   * Takes the point's glow out of the batch that draws it, if one does.
   */
  protected _dropGlowItem(): void {
    const item = this._glowItem;
    if (item) item.batch?.remove(item);
    this._glowItem = null;
  }


  /**
   * Updates geometry, style, hit area, and halo if the feature is dirty.
   * @param viewport - Pixi viewport to use for rendering
   */
  public update(viewport: Viewport): void {
    if (!this.dirty) return;  // nothing to do
    this.layer.work.updated++;

    // (A point that moved is drawn again, wherever it's drawn.)
    if (this._geomDirty) this._styleDirty = true;

    this.updateGeometry();
    this.updateStyle(viewport);
    this.updateHitArea();
    this.updateHalo();
    this.updateAvoid();
    this.scene.labelSpace.featureChanged(this);
  }


  /**
   * Marks where this point is drawn, for labels to keep clear of (see `AbstractPixiFeature.updateAvoid`).
   *
   * A point is drawn at a size on screen, upright, whatever the zoom and rotation: so what it
   * covers is the box of its pictures around its place in label space, from arithmetic.
   * (Viewfields keep their direction on the ground, so their part of the box is for the
   * rotation the point was last drawn at.)
   */
  public override updateAvoid(): void {
    const scene = this.scene;
    if (!this.labelAvoid || !this.container?.visible || !scene?.labelSpace?.avoidGrid) {
      this._setAvoid(null);
      return;
    }
    this._setAvoid(this.labelBox(TEMP_BOX));
  }


  /**
   * Updates the container position from the point geometry.
   */
  public updateGeometry(): void {
    if (!this._geomDirty) return;

    const type = this._geom?.type;
    const world = this._geom?.world;
    const origin = world?.origin;

    // Not a Point, or no GeometryPart data?
    if (type !== 'Point' || !world || !origin) {
      this.lod = 0;
      this.visible = false;
      this._geomDirty = false;
      return;
    }

    const [x, y] = origin;
    this.container.position.set(x, y);
    this._geomDirty = false;
  }


  /**
   * Draws the marker, icon, and viewfields from the current style: in the layer's batch if it
   * gave one that can draw them, otherwise as sprites of this feature's own.
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateStyle(viewport: Viewport): void {
    if (!this._styleDirty) return;

    const context = this.context;
    const map = context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const styleZoom = map?.effectiveZoom() ?? viewZoom;
    const isWireframe = !!map?.wireframeMode;
    const container = this.container;
    const style = this._style;

    // Not a Point, or no GeometryPart data? (`updateGeometry` hid it.)
    if (this._geom?.type !== 'Point' || !this._geom.world?.origin) {
      this._styleDirty = false;
      return;
    }

    // Below zoom 16 points aren't drawn. Up to 17, and in wireframe mode, they're drawn
    // smaller, pins as circles, without viewfields.
    const lod = (styleZoom < 16) ? 0 : (styleZoom < 17 || isWireframe) ? 1 : 2;
    const screenScale = (lod === 2) ? 1.0 : 0.8;
    const hasViewfields = (style.viewfield?.angles?.length ?? 0) > 0;
    const batch = (this._batch && !this._batch.destroyed) ? this._batch : null;
    const item = this._item;

    const bearing = viewport.transform.rotation;

    // Only the zoom or the rotation changed, and the batch has the point as it's drawn now:
    // nothing to do. (This runs for every point after a zoom, so it makes no objects.)
    if (this.onlyTransformDirty && lod === this.lod && (
      lod === 0 || (item && item.batch === batch && !this._ownDraw && !this._turns)
    )) {
      // (A selected point's halo is drawn around its container's place, at its scale.)
      if (this._classes.has('select')) this._setTransform(viewZoom, bearing, screenScale);
      this.visible = (lod > 0);
      this._styleDirty = false;
      return;
    }

    this.lod = lod;
    this._screenScale = screenScale;
    this._setTransform(viewZoom, bearing, screenScale);

    // Sort markers by latitude ascending, and markers with viewfields above markers without.
    // Make the active photo image pop out at the user.
    const z = container.position.y;
    const isActivePhoto = this._classes.has('selectphoto') || this._classes.has('highlightphoto');
    container.zIndex = !hasViewfields ? z : isActivePhoto ? 99000 : (z + 1000);

    if (lod === 0) {   // Hide container and everything under it
      this.visible = false;
      this._styleDirty = false;
      return;
    }

    const missing = this._layout(lod, bearing);
    const count = _firstViewfield + _numViewfields + (_markerQuad >= 0 ? 1 : 0) + (_iconQuad >= 0 ? 1 : 0);

    // A batch draws the point if every picture is in the batch's texture.
    let inBatch = !!batch;
    for (let i = 0; inBatch && i < count; i++) {
      inBatch = batch!.canDraw(QUADS[i].texture);
    }

    this._ownDraw = !inBatch;
    this._unbatchable = (!!batch && !inBatch);
    this._turns = (_numViewfields > 0);
    this.visible = true;

    if (inBatch) {
      this._dropSprites();
      this._drawBatched(batch!, count, hasViewfields);

    } else {
      // Sprites of this feature's own, in its container.
      this._dropItem();
      this._drawSprites(bearing);
    }

    // If we are waiting on a texure to load, stay dirty.
    this._styleDirty = missing;
  }


  /**
   * Scales and turns the container so that what's in it is in pixels on screen, and upright:
   * the container is in world coordinates, under a parent that zooms and turns with the map.
   * (For sprites, and for the halo, which copies the container's transform. A batch's shader
   * does the same for what's in it.)
   * @param viewZoom - The view's zoom
   * @param bearing - The map's rotation, in radians
   * @param screenScale - How big the point is drawn, compared with what its style says
   */
  protected _setTransform(viewZoom: number, bearing: number, screenScale: number): void {
    const container = this.container;
    const worldScale = 2 ** (viewZoom - WORLD_ZOOM) || 1;
    container.rotation = -bearing;
    container.scale.set(screenScale / worldScale, screenScale / worldScale);
  }


  /**
   * Works out what the point is drawn with at a level of detail: its pictures, in the scratch
   * list (`QUADS`), in pixels at the style's own size. Also what follows from them: whether
   * the marker is round (`props.isCircular`), the marker's box and the box of everything.
   * @param lod - The level of detail: 1 (smaller, pins as circles, no viewfields) or 2 (full)
   * @param bearing - The map's rotation, in radians
   * @return `true` if a picture is left out because its texture hasn't loaded yet
   */
  protected _layout(lod: number, bearing: number): boolean {
    const textureManager = this.gfx.textureManager!;
    const style = this._style;
    const vfAngles = style.viewfield?.angles || [];
    const isPin = PINS.includes(style.marker.image ?? '');
    let count = 0;
    let missing = false;

    // The glow of a hover or a highlight, under everything: its place is kept, and it's
    // filled in once the marker is known.
    const color = glowColor(this._classes);
    const glowTexture = (color !== null) ? textureManager.getTexture('symbol', 'glow') : null;
    _glowQuad = (glowTexture && glowTexture !== PIXI.Texture.EMPTY) ? count++ : -1;
    _firstViewfield = count;

    // Pinlike markers are circles at lower zoom, and where viewfields are present.
    const markerID = (isPin && (lod === 1 || vfAngles.length > 0)) ? 'largeCircle' : (style.marker.image ?? 'smallCircle');
    const isCircular = /(circle|midpoint)$/i.test(markerID);
    const isPinned = (isPin && !isCircular);   // drawn as a pin: its tip is at the point
    this.props.isCircular = isCircular;

    // Viewfields, if any, under everything. They turn with the map.
    _numViewfields = 0;
    if (lod === 2 && vfAngles.length > 0) {
      const texture = textureManager.getTexture('symbol', style.viewfield.image || '') || PIXI.Texture.WHITE;
      if (texture === PIXI.Texture.EMPTY) {
        missing = true;
      } else {
        // anchor, default to middle,middle
        let [anchorX, anchorY] = style.viewfield.anchor || [];
        if (!Number.isFinite(anchorX)) anchorX = 0.5;
        if (!Number.isFinite(anchorY)) anchorY = 0.5;

        for (const angle of vfAngles) {
          const quad = quadAt(count++);
          quad.texture = texture;
          quad.x = 0;
          quad.y = 0;
          quad.anchorX = anchorX!;
          quad.anchorY = anchorY!;
          setSize(quad, style.viewfield.size, style.viewfield.scale, null);   // no default (size will be determined by the texture)
          quad.rotation = angle * Math.PI / 180;
          quad.color = style.viewfield.color ?? 0x333333;
          quad.alpha = style.viewfield.opacity ?? 1;
          quad.turns = true;
          quad.pulses = false;
        }
        _numViewfields = count - _firstViewfield;
      }
    }

    // The marker, if any
    const markerBox = this._markerBox;
    markerBox[0] = markerBox[1] = markerBox[2] = markerBox[3] = 0;
    _markerQuad = -1;
    if (style.marker.image) {
      const texture = textureManager.getTexture('symbol', markerID) || PIXI.Texture.EMPTY;
      if (texture === PIXI.Texture.EMPTY) {
        missing = true;
      } else {
        const quad = quadAt(count);
        quad.texture = texture;
        quad.x = 0;
        quad.y = 0;
        quad.anchorX = 0.5;                  // middle,
        quad.anchorY = isPinned ? 1 : 0.5;   // bottom (a pin) or middle
        setSize(quad, style.marker.size, style.marker.scale, null);   // if unset, size will be determined by the texture
        quad.rotation = this.markerRotation;
        quad.color = style.marker.color ?? 0xffffff;
        quad.alpha = style.marker.opacity ?? 1;
        quad.turns = false;
        quad.pulses = false;
        _markerQuad = count++;

        const w = Math.abs(quad.width);
        const h = Math.abs(quad.height);
        markerBox[0] = -quad.anchorX * w;
        markerBox[1] = -quad.anchorY * h;
        markerBox[2] = markerBox[0] + w;
        markerBox[3] = markerBox[1] + h;
      }
    }

    // The icon, if any, over the marker
    _iconQuad = -1;
    if (style.icon.image) {
      const texture = textureManager.getTexture('symbol', style.icon.image) || PIXI.Texture.EMPTY;
      if (texture === PIXI.Texture.EMPTY) {
        missing = true;
      } else {
        // anchor, default to middle,middle
        let [anchorX, anchorY] = style.icon.anchor || [];
        if (!Number.isFinite(anchorX)) anchorX = 0.5;
        if (!Number.isFinite(anchorY)) anchorY = 0.5;

        const quad = quadAt(count);
        quad.texture = texture;
        quad.x = 0;
        quad.y = isPinned ? (PIN_ICON_Y[markerID] ?? -14) : 0;   // in the pin's head, or in the middle
        quad.anchorX = anchorX!;
        quad.anchorY = anchorY!;
        setSize(quad, style.icon.size || 11, style.icon.scale, 11);   // default to 11px to fit within the marker
        quad.rotation = 0;
        quad.color = style.icon.color ?? 0x111111;
        quad.alpha = style.icon.opacity ?? 1;
        quad.turns = false;
        quad.pulses = false;
        _iconQuad = count++;
      }
    }

    // The glow: a disc behind the marker's middle, twice as wide as the marker.
    if (_glowQuad >= 0) {
      const quad = quadAt(_glowQuad);
      const size = Math.max(GLOW_MIN_SIZE, GLOW_SCALE * Math.max(markerBox[2] - markerBox[0], markerBox[3] - markerBox[1]));
      quad.texture = glowTexture!;
      quad.x = (markerBox[0] + markerBox[2]) / 2;
      quad.y = (markerBox[1] + markerBox[3]) / 2;
      quad.width = size;
      quad.height = size;
      quad.anchorX = 0.5;
      quad.anchorY = 0.5;
      quad.rotation = 0;
      quad.color = color!;
      quad.alpha = GLOW_ALPHA;
      quad.turns = false;
      quad.pulses = true;
    }

    this._layoutBox(count, bearing);
    return missing;
  }


  /**
   * Works out the box of everything the point draws, on screen: around the corners of each
   * picture that `_layout()` worked out, as it's turned.
   * (Not the glow: a hover must leave every label where it is.)
   * @param count - How many pictures there are
   * @param bearing - The map's rotation, in radians
   */
  protected _layoutBox(count: number, bearing: number): void {
    const scale = this._screenScale;
    const box = this._box;
    box[0] = box[1] = Infinity;
    box[2] = box[3] = -Infinity;
    for (let i = _firstViewfield; i < count; i++) {
      const quad = QUADS[i];
      const turn = quad.rotation + (quad.turns ? bearing : 0);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const left = -quad.anchorX * quad.width;
      const top = -quad.anchorY * quad.height;
      for (let corner = 0; corner < 4; corner++) {
        const cx = (corner === 0 || corner === 3) ? left : (left + quad.width);
        const cy = (corner < 2) ? top : (top + quad.height);
        let x = cx * cos - cy * sin;
        let y = cx * sin + cy * cos;
        if (!quad.turns) {   // (one that turns has its place turned too; they're all at the point)
          x += quad.x;
          y += quad.y;
        }
        x *= scale;
        y *= scale;
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
    }
    if (count === _firstViewfield) {
      box[0] = box[1] = 0;
      box[2] = box[3] = -1;
    }
  }


  /**
   * Draws the point in its batch: the pictures that `_layout()` worked out, as rectangles there.
   * They're written when the point, its style or its level of detail changes. The batch's
   * shader keeps them the same size on screen, and upright, so a zoom or a rotation alone
   * changes nothing here.
   * @param batch - The batch
   * @param count - How many pictures the point has
   * @param hasViewfields - Whether the point's style has viewfields
   */
  protected _drawBatched(batch: PointBatchMesh, count: number, hasViewfields: boolean): void {
    const position = this.container.position;    // the point's place in the world
    const x = position.x - batch.position.x;
    const y = position.y - batch.position.y;
    const scale = this._screenScale;

    // From north to south, so that each pin overlaps the ones above it on the map, the ones
    // with viewfields over the ones without, and the photo that's selected or highlighted over
    // them all (as its container's `zIndex` says when it draws itself).
    const isActivePhoto = this._classes.has('selectphoto') || this._classes.has('highlightphoto');
    const order = position.y + (hasViewfields ? VIEWFIELDS_ABOVE : 0) + (isActivePhoto ? ACTIVE_PHOTO_ABOVE : 0);

    let item = this._item;
    if (item && item.batch !== batch) {
      item.batch?.remove(item);
      item = this._item = null;
    }

    // The glow, if there's one, is the first of the pictures. Where the batch has a batch for
    // glows it goes there, and the point's own pictures stay as many as they were: a hover
    // then writes them where they are, and nothing else in the batch changes.
    const glows = (_glowQuad >= 0) ? batch.glows : null;
    const start = glows ? 1 : 0;
    const own = count - start;

    if (own <= 0) {
      this._dropItem();
      return;
    } else if (item) {
      batch.set(item, QUADS, own, x, y, scale, start);
      batch.setOrder(item, order);
      batch.setVisible(item, true);
    } else {
      this._item = batch.add(QUADS, own, x, y, scale, order, start);
    }

    let glowItem = this._glowItem;
    if (glowItem && glowItem.batch !== glows) {
      this._dropGlowItem();
      glowItem = null;
    }
    if (glows) {
      const gx = position.x - glows.position.x;
      const gy = position.y - glows.position.y;
      if (glowItem) {
        glows.set(glowItem, QUADS, 1, gx, gy, scale);
        glows.setOrder(glowItem, order);
        glows.setVisible(glowItem, true);
      } else {
        this._glowItem = glows.add(QUADS, 1, gx, gy, scale, order);
      }
    }
  }


  /**
   * Draws the point with sprites of this feature's own, in its container: one for each of the
   * pictures that `_layout()` worked out. They're made and destroyed as the style needs.
   * @param bearing - The map's rotation, in radians
   */
  protected _drawSprites(bearing: number): void {
    const container = this.container;

    // The glow of a hover or a highlight, under everything. Its opacity follows the scene's
    // clock, as a glow in a batch does.
    let glow = this.glow;
    if (_glowQuad >= 0) {
      if (!glow) {
        glow = new PIXI.Sprite();
        glow.label = 'glow';
        glow.eventMode = 'none';
        glow.sortableChildren = false;
        this.glow = glow;
        container.addChildAt(glow, 0);
      }
      const quad = QUADS[_glowQuad];
      this._drawSprite(glow, quad);
      this.scene.addPulsing(glow, quad.alpha);
    } else if (glow) {
      this.scene.removePulsing(glow);
      glow.destroy();
      this.glow = null;
    }

    // The viewfields, in a container below the marker that turns back with the map
    // (the feature's container is turned to keep the marker and the icon upright).
    let viewfields = this.viewfields;
    if (_numViewfields > 0) {
      if (!viewfields) {
        viewfields = new PIXI.Container();
        viewfields.label = 'viewfields';
        viewfields.eventMode = 'none';
        viewfields.sortableChildren = false;
        viewfields.visible = true;
        this.viewfields = viewfields;
        container.addChildAt(viewfields, this.glow ? 1 : 0);   // above the glow
      }

      // if # of viewfields has changed, or if the texture name has changed, recreate them
      const vfImage = this._style.viewfield.image ?? null;
      if (this._viewfieldCount !== _numViewfields || this._viewfieldName !== vfImage) {
        for (const sprite of viewfields.removeChildren()) {
          sprite.destroy();
        }
        for (let i = 0; i < _numViewfields; i++) {
          const vfSprite = new PIXI.Sprite(QUADS[_firstViewfield + i].texture);
          vfSprite.eventMode = 'none';
          viewfields.addChild(vfSprite);
        }
        this._viewfieldCount = _numViewfields;
        this._viewfieldName = vfImage;
      }

      viewfields.rotation = bearing;
      for (let i = 0; i < _numViewfields; i++) {
        this._drawSprite(viewfields.getChildAt(i) as PIXI.Sprite, QUADS[_firstViewfield + i]);
      }

    } else if (viewfields) {  // Had viewfields before and now should not
      viewfields.destroy({ children: true });
      this.viewfields = null;
      this._viewfieldCount = 0;
      this._viewfieldName = null;
    }

    // The marker. (It stays, hidden, while the style has none, or its texture hasn't loaded.)
    let marker = this.marker;
    if (!marker) {
      marker = new PIXI.Sprite();
      marker.label = 'marker';
      marker.eventMode = 'none';
      marker.sortableChildren = false;
      this.marker = marker;
      container.addChildAt(marker, (this.glow ? 1 : 0) + (this.viewfields ? 1 : 0));   // above the glow and the viewfields
    }
    if (_markerQuad >= 0) {
      this._drawSprite(marker, QUADS[_markerQuad]);
      marker.visible = true;
    } else {
      marker.visible = false;
    }

    // The icon
    // (The sprite is made for a point that has one. Of the points and vertices around a view
    // of Užice, two in three have none.)
    let icon = this.icon;
    if (_iconQuad >= 0) {
      if (!icon) {
        icon = new PIXI.Sprite();
        icon.label = 'icon';
        icon.eventMode = 'none';
        icon.sortableChildren = false;
        this.icon = icon;
        container.addChildAt(icon, container.getChildIndex(marker) + 1);   // above the marker
      }
      this._drawSprite(icon, QUADS[_iconQuad]);
      icon.visible = true;
    } else if (icon) {  // Had an icon before and now should not
      icon.destroy();
      this.icon = null;
    }
  }


  /**
   * Makes a sprite draw one of the pictures that `_layout()` worked out.
   * @param sprite - The sprite
   * @param quad - The picture
   */
  protected _drawSprite(sprite: PIXI.Sprite, quad: PointBatchMeshQuad): void {
    const texture = quad.texture;
    sprite.texture = texture;
    sprite.anchor.set(quad.anchorX, quad.anchorY);
    sprite.position.set(quad.x, quad.y);
    sprite.scale.set(quad.width / texture.orig.width, quad.height / texture.orig.height);
    sprite.rotation = quad.rotation;
    sprite.tint = quad.color;
    sprite.alpha = quad.alpha;
  }


  /**
   * Works out where the point can be hit: around its marker, in the container's own pixels
   * (the style's size, before the point is made smaller at low zooms).
   */
  public updateHitArea(): void {
    if (!this.visible) return;

    const container = this.container;
    if (this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
      container.hitArea = null;
      return;
    }

    // The marker's box, at least as big as MINSIZE x MINSIZE around the point, then padded a bit more.
    const box = this._markerBox;
    const half = HIT_MINSIZE / 2;
    const minX = Math.min(box[0], -half) - HIT_PAD;
    const minY = Math.min(box[1], -half) - HIT_PAD;
    const maxX = Math.max(box[2], half) + HIT_PAD;
    const maxY = Math.max(box[3], half) + HIT_PAD;

    // (The shape that's there is used again: every point comes through here after a zoom.)
    const hitArea = container.hitArea;
    if (this.props.isCircular) {
      const radius = (maxX - minX) / 2;
      if (hitArea instanceof PIXI.Circle) {
        hitArea.x = 0;
        hitArea.y = 0;
        hitArea.radius = radius;
      } else {
        container.hitArea = new PIXI.Circle(0, 0, radius);
      }
      this.hitReach = radius * this._screenScale;
    } else {
      if (hitArea instanceof PIXI.Rectangle) {
        hitArea.x = minX;
        hitArea.y = minY;
        hitArea.width = maxX - minX;
        hitArea.height = maxY - minY;
      } else {
        container.hitArea = new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);
      }
      // (To the far corner: the marker stays upright when the map is turned.)
      const reachX = Math.max(-minX, maxX);
      const reachY = Math.max(-minY, maxY);
      this.hitReach = Math.hypot(reachX, reachY) * this._screenScale;
    }
  }


  /**
   * Shows or hides the halo of a selected point: the edge of its hit area (so `updateHitArea`
   * comes first). The glow of a hover or a highlight is one of the point's pictures (see `_layout`).
   */
  public updateHalo(): void {
    const shape = this.container.hitArea;
    if (!this.visible || !this._classes.has('select') || this.props.isVirtual || !shape) {
      this._drawHalo(null);
      return;
    }

    const rings: number[][] = [];
    if (shape instanceof PIXI.Circle) {
      const ring: number[] = [];
      for (let i = 0; i < HALO_CIRCLE_POINTS; i++) {
        const angle = 2 * Math.PI * i / HALO_CIRCLE_POINTS;
        ring.push(shape.x + shape.radius * Math.cos(angle), shape.y + shape.radius * Math.sin(angle));
      }
      rings.push(ring);
    } else if (shape instanceof PIXI.Rectangle) {
      rings.push([shape.left, shape.top, shape.right, shape.top, shape.right, shape.bottom, shape.left, shape.bottom]);
    }
    this._drawHalo(rings);
  }

}
