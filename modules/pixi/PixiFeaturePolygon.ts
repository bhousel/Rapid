import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { LineBatchMesh } from './lib/LineBatchMesh.ts';
import { LineHitArea } from './lib/LineHitArea.ts';
import { LineMesh } from './lib/LineMesh.ts';
import { glowColor, ringsContain, setGlowFilter, triangulate } from './helpers.ts';
import { geomAreaBand, geomStrokeContains, geomStrokeMesh, geomStrokeOutline } from '../geo/index.ts';
import { WORLD_ZOOM, vecEqual } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { BandPolygon } from '../geo/band.ts';
import type { FillBatchMesh, FillBatchMeshItem } from './lib/FillBatchMesh.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { LineBatchMeshItem } from './lib/LineBatchMesh.ts';
import type { Viewport } from '@rapid-sdk/math';

const PARTIALFILLWIDTH = 32;
const INRADIUS_PRECISION = 1;   // a polygon's `inradius` may be this much short of the truth (see `GeometryPart`)
const HIT_PADDING = 10;   // pixels around an outline's width that still hit it, and where its halo is drawn

// The fill of a hovered or highlighted polygon, while a batch draws it: this much of the way to
// the glow's color, and this many times as opaque. (The glow itself is around the outlines.)
const LIT_FILL_TINT = 0.5;
const LIT_FILL_OPACITY = 2;

// A polygon smaller than this, in pixels, is drawn in less detail: a batch draws its fill and
// no outline. (An outline is 3 triangles a corner, a rectangle's fill is 2.)
const SMALL_SIZE = 20;

// In the outlines' batch, the glow of a hovered or highlighted polygon is over every outline.
// (A polygon's place among the others is its area, negative: nowhere near this.)
const GLOW_ABOVE = 1e15;


/**
 * Mixes two colors.
 * @param a - A color, as 0xRRGGBB
 * @param b - Another
 * @param t - How much of the second: 0 for none of it, 1 for all
 * @return The color between them
 */
function mixColors(a: number, b: number, t: number): number {
  const red = Math.round(((a >> 16) & 0xff) * (1 - t) + ((b >> 16) & 0xff) * t);
  const green = Math.round(((a >> 8) & 0xff) * (1 - t) + ((b >> 8) & 0xff) * t);
  const blue = Math.round((a & 0xff) * (1 - t) + (b & 0xff) * t);
  return (red << 16) | (green << 8) | blue;
}


/**
 * This class renders a Polygon feature.
 *
 * A partial fill fills a band along the inside of the polygon's edge, 32 pixels wide. The band
 * is real geometry (`geomAreaBand()`): the `fill` draws its polygons, and a click hits them.
 * There's no stencil mask. Most polygons are too narrow to have a middle that the band leaves
 * empty, and are filled whole (see `_bandFor`, and `design/graphics-system.md` section 15).
 *
 * A layer that draws many polygons gives the feature two batches: a `FillBatchMesh` for its fill and
 * a `LineBatchMesh` for its outlines (the layer draws every fill, then every outline). The fill is
 * then a run of triangles in its batch, worked out once, and each ring's outline a run of
 * vertices in the other. The feature has nothing in its container, and needn't be in the scene
 * (`drawsInContainer()`). A zoom changes nothing in a batch, unless the polygon gets or loses
 * its middle. A hovered or highlighted polygon has its fill tinted with the glow's color
 * meanwhile, and a glow around each of its outlines, drawn by the outlines' batch
 * (`glowItems`).
 *
 * Properties available:
 * - `fillBatch`   - `FillBatchMesh` that draws the fill, if the layer gave it one
 * - `strokeBatch` - `LineBatchMesh` that draws the outlines, if the layer gave it one
 * - `lowRes`     - `PIXI.Sprite` for a replacement graphic to display at low resolution
 * - `fill`       - `PIXI.Graphic` for the fill Graphics (below)
 * - `strokes`    - `PIXI.Container` for the outlines (above): a `LineMesh` for each ring
 * - (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePolygon extends AbstractPixiFeature {

  /** PIXI.Sprite for low resolution representation */
  public lowRes: PIXI.Sprite | null;
  /** PIXI.Graphics for the fill (below) */
  public fill: PIXI.Graphics | null;
  /** Container for the outlines: a `LineMesh` for each ring */
  public strokes: PIXI.Container | null;
  /** Debug surrounding rectangle graphics (optional) */
  public debugSurround?: PIXI.Graphics | null;

  /** Whether `fill` holds geometry from the last time it was drawn */
  protected _hasFill: boolean;
  /** The band of the last partial fill, or `null` if that was the whole polygon (see `_bandFor`) */
  protected _band: BandPolygon[] | null;
  /** The polygon that `_band` is the band of */
  protected _bandPart: GeometryPart | null;
  /** The width that `_band` was worked out for, in the polygon's coordinates */
  protected _bandWidth: number;
  /** The polygon that the stroke meshes of the outlines were built from */
  protected _meshPart: GeometryPart | null;
  /** The batch that the layer gave this feature to draw its fill in (see `fillBatch`) */
  protected _fillBatch: FillBatchMesh | null;
  /** The batch that the layer gave this feature to draw its outlines in (see `strokeBatch`) */
  protected _strokeBatch: LineBatchMesh | null;
  /** The fill in its batch, if a batch draws it */
  protected _fillItem: FillBatchMeshItem | null;
  /** The outlines in their batch, one for each ring, if a batch draws them */
  protected _ringItems: LineBatchMeshItem[];
  /** The glow around each ring in the outlines' batch, while the polygon is hovered or highlighted and batches draw it */
  protected _glowItems: LineBatchMeshItem[];
  /** The polygon that the fill and the outlines in the batches were built from */
  protected _batchPart: GeometryPart | null;
  /** The band that the fill in the batch is (see `_bandFor`), or `null` if it's the whole polygon */
  protected _batchBand: BandPolygon[] | null;
  /** The pattern that the fill in the batch has (its number in the atlas), or -1 if there's no fill there */
  protected _batchPattern: number;


  /**
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._hasFill = false;
    this._meshPart = null;
    this._band = null;
    this._bandPart = null;
    this._bandWidth = 0;
    this._fillBatch = null;
    this._strokeBatch = null;
    this._fillItem = null;
    this._ringItems = [];
    this._glowItems = [];
    this._batchPart = null;
    this._batchBand = null;
    this._batchPattern = -1;

    // The Pixi objects are made when a level of detail first needs them (see `update`): of
    // 36,000 polygons around a view of Užice at z16, 1,900 are drawn in full, 12,000 as a
    // `lowRes` sprite, and the rest are too small to draw at all.
    this.lowRes = null;
    this.fill = null;
    this.strokes = null;

    // // Debug surrounding rectangle
    // const debugSurround = new PIXI.Graphics();
    // debugSurround.label = 'surround';
    // debugSurround.eventMode = 'none';
    // debugSurround.sortableChildren = false;
    // this.debugSurround = debugSurround;
    // this.container.addChild(debugSurround);
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    if (this.lowRes) {
      this.lowRes.destroy();
      this.lowRes = null;
    }
    if (this.fill) {
      this.fill.destroy();
      this.fill = null;
    }
    if (this.strokes) {
      this.strokes.destroy({ children: true });
      this.strokes = null;
    }
    if (this.debugSurround) {
      this.debugSurround.destroy();
      this.debugSurround = null;
    }

    this._dropItems();
    this.fillBatch = null;
    this.strokeBatch = null;

    this._meshPart = null;
    this._band = null;
    this._bandPart = null;

    super.destroy();
  }


  /**
   * The batch to draw the fill in, with the other polygons of the layer, or `null` for the
   * polygon to draw itself. The layer sets it before `update()`, with `strokeBatch`. The
   * feature may be drawn some frames later, so a batch counts the features it was given to.
   * @return The batch, or `null`
   */
  public get fillBatch(): FillBatchMesh | null {
    return this._fillBatch;
  }
  /**
   * @param val - The batch to draw the fill in from the next `update()`, or `null` for none
   */
  public set fillBatch(val: FillBatchMesh | null) {
    if (val === this._fillBatch) return;
    if (this._fillBatch) this._fillBatch.users--;
    if (val) val.users++;
    this._fillBatch = val;
  }


  /**
   * The batch to draw the outlines in (see `fillBatch`). The layer draws its outlines' batch
   * after its fills' batch, so every outline is over every fill.
   * @return The batch, or `null`
   */
  public get strokeBatch(): LineBatchMesh | null {
    return this._strokeBatch;
  }
  /**
   * @param val - The batch to draw the outlines in from the next `update()`, or `null` for none
   */
  public set strokeBatch(val: LineBatchMesh | null) {
    if (val === this._strokeBatch) return;
    if (this._strokeBatch) this._strokeBatch.users--;
    if (val) val.users++;
    this._strokeBatch = val;
  }


  /**
   * The fill in its batch, if a batch draws it
   * @return The batch's item, or `null`
   * @readonly
   */
  public get fillItem(): FillBatchMeshItem | null {
    return this._fillItem;
  }


  /**
   * The outlines in their batch, one for each ring, if a batch draws them
   * @return The batch's items
   * @readonly
   */
  public get ringItems(): readonly LineBatchMeshItem[] {
    return this._ringItems;
  }


  /**
   * Whether the Feature is currently visible
   * @return `true` if the feature is currently visible
   */
  public override get visible(): boolean {
    return super.visible;
  }
  /**
   * A polygon that batches draw is shown and hidden there too. (Its outlines aren't shown
   * there while the polygon draws them itself: see `drawsInContainer`.)
   * @param val - `true` to show the feature, `false` to hide it
   */
  public override set visible(val: boolean) {
    super.visible = val;
    if (this._fillItem) this._fillItem.batch?.setVisible(this._fillItem, val);
    for (const item of this._ringItems) {
      item.batch?.setVisible(item, val);
    }
    for (const item of this._glowItems) {
      item.batch?.setVisible(item, val);
    }
  }


  /**
   * Whether batches draw this polygon: the layer gave it both, and the outlines' batch can draw
   * its dashes.
   * @return `true` if batches draw it
   */
  protected _isBatched(): boolean {
    const fillBatch = this._fillBatch;
    const strokeBatch = this._strokeBatch;
    if (!fillBatch || fillBatch.destroyed || !strokeBatch || strokeBatch.destroyed) return false;
    return LineBatchMesh.canDraw(this._style.stroke?.dash);
  }


  /**
   * The glow around each ring in the outlines' batch, while the polygon is hovered or
   * highlighted and batches draw it
   * @return The batch's items (none if the polygon doesn't glow, or draws itself)
   * @readonly
   */
  public get glowItems(): readonly LineBatchMeshItem[] {
    return this._glowItems;
  }


  /**
   * Whether this polygon draws something in its own container, and so has to be in the scene
   * (the layer asks before `update()`, to know whether to give it a place there).
   * A polygon whose fill and outlines are in batches draws nothing itself: its glow, when
   * it's hovered or highlighted, is in the outlines' batch too.
   * @return `true` if its container has to be in the scene
   */
  public drawsInContainer(): boolean {
    return !this._isBatched();
  }


  /**
   * Whether the pointer is over this polygon: within a few pixels of one of its rings, or in
   * its fill (the band, for a partial fill; nothing, in wireframe mode). For a polygon that
   * batches draw this needs nothing of Pixi's; one that draws itself is asked as Pixi would.
   * @param point - The pointer's place in the stage's coordinates
   * @param world - The same place in world coordinates
   * @return `true` if the pointer hits it
   */
  public override hitTest(point: PIXI.PointData, world: PIXI.PointData): boolean {
    if (!this._fillItem && !this._ringItems.length) return super.hitTest(point, world);
    if (!this.visible || !this._allowInteraction || this._classes.has('drawing')) return false;

    const context = this.context;
    const map = context.systems.map;
    const local = this._geom?.local;
    if (!local) return false;

    const position = this.container.position;    // the polygon's coordinates start here, in the world's
    const x = world.x - position.x;
    const y = world.y - position.y;
    const reach = this.hitReach * (2 ** (WORLD_ZOOM - context.viewport.transform.zoom));
    const [minX, minY] = local.extent.min;
    const [maxX, maxY] = local.extent.max;
    if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) return false;

    const rings = local.flat as number[][];
    for (const ring of rings) {
      if (geomStrokeContains(ring, reach, x, y, true)) return true;
    }
    if (map?.wireframeMode) return false;    // no fill to hit

    const band = this._batchBand;
    if (!band) return ringsContain(rings, x, y);
    for (const polygon of band) {
      if (ringsContain([polygon.outer], x, y) && !ringsContain(polygon.holes, x, y)) return true;
    }
    return false;
  }


  /**
   * The mesh in the scene that draws this polygon's fill, if a batch does: where the polygon is
   * drawn among the others is where that batch is, and the polygon's `sceneOrder` in it.
   * @return The batch, or this feature's own container
   */
  public override get sceneContainer(): PIXI.Container {
    const item = this._fillItem;
    return (item?.batch && item.visible) ? item.batch : this.container;
  }


  /**
   * Where this polygon is drawn among the others that its batch draws.
   * @return The order of its fill in the batch (0 if no batch draws it)
   */
  public override get sceneOrder(): number {
    const item = this._fillItem;
    return (item?.batch && item.visible) ? item.order : 0;
  }


  /**
   * Takes the fill and the outlines out of the batches that draw them, if any do.
   */
  protected _dropItems(): void {
    this._fillItem?.batch?.remove(this._fillItem);
    this._fillItem = null;
    for (const item of this._ringItems) {
      item.batch?.remove(item);
    }
    this._ringItems.length = 0;
    for (const item of this._glowItems) {
      item.batch?.remove(item);
    }
    this._glowItems.length = 0;
    this._batchPart = null;
    this._batchBand = null;
    this._batchPattern = -1;
  }


  /**
   * Polygon update path that draws from world coordinates (WORLD_ZOOM=16).
   * The feature's container sits inside the `world` Pixi container which provides
   * the position + scale mapping world coords -> screen. Vertices are pulled from
   * `_geom.local.coords` (origin-relative cache) so we don't recompute the
   * subtraction every frame.
   * @param viewport - Pixi viewport to use for rendering
   */
  public update(viewport: Viewport): void {
    if (!this._geom) return;  // wrong path?

    if (!this.dirty) return;  // nothing to do
    this.layer.work.updated++;

    const type = this._geom?.type;
    const world = this._geom?.world;
    const local = this._geom?.local;
    const flat = local?.flat as number[][];

    // Not a Polygon, or no GeometryPart data?
    if (type !== 'Polygon' || !world || !local || !flat?.length || !flat[0].length) {
      this.lod = 0;
      this.visible = false;
      this._geomDirty = false;
      this._styleDirty = false;
      return;   // (hiding it told the scene that it changed)
    }

    const context = this.context;
    const settings = context.systems.settings;
    const map = context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const isWireframe = !!map?.wireframeMode;
    const bearing = context.viewport.transform.rotation;
    const textureManager = this.gfx.textureManager!;
    const container = this.container;

    // Position the container at the world origin (extent center). All vertices
    // in `local.coords` are already relative to this origin.
    const origin = world.origin!;
    container.position.set(origin[0], origin[1]);

    // Compute screen-pixel width/height from the local extent.
    // local.extent is in world units; multiply by worldScale to get screen pixels.
    const worldScale = 2 ** (viewZoom - WORLD_ZOOM);
    const localScale = 1 / worldScale;  // or, 2 ** (WORLD_ZOOM - viewZoom)
    const [localW, localH] = local.extent.dimensions();
    const screenW = localW * worldScale;
    const screenH = localH * worldScale;

    const style = this._style;
    const color = style.fill?.color ?? 0xaaaaaa;
    const pattern = style.fill?.pattern;

    const fillPreference = settings?.get('map.areaFill') ?? 'partial';
    let doFullFill = (style.fill?.type ?? fillPreference) === 'full';

    let texture = pattern && textureManager.getPatternTexture(pattern) || PIXI.Texture.WHITE;    // WHITE turns off the texture
    // textureSpace:'global' tiles the pattern at consistent world-space density rather than stretching it per shape.
    // Scale by localScale (1/worldScale) so that 1 UV cycle = 1 pattern tile = natural screen-pixel density.
    const textureMatrix = new PIXI.Matrix().scale(localScale, localScale).rotate(-bearing);  // keep patterns face up

// bhousel update 5/27/22:
// I've noticed that we can't use textures from a spritesheet for patterns,
// and it would be nice to figure out why

    // If this shape is so small that partial filling makes no sense, fill fully (faster?)
    const cutoff = (2 * PARTIALFILLWIDTH) + 5;
    if (screenW < cutoff || screenH < cutoff) {
      doFullFill = true;
    }
    // If this shape is so small that applying a pattern makes no sense, skip it (faster?)
    if (screenW < PARTIALFILLWIDTH || screenH < PARTIALFILLWIDTH) {
      texture = PIXI.Texture.WHITE;
    }

    const isBatched = this._isBatched();
    const litColor = glowColor(this._classes);

    // Cull really tiny shapes
    if (screenW < 4 && screenH < 4) {  // so tiny
      this.lod = 0;
      this.visible = false;
      this._dropLowRes();
      this._dropShapes();

    // Batches draw it: the fill and the outlines as they are. (A zoom changes nothing there,
    // unless the polygon gets or loses its middle, its pattern, or its outlines.)
    // A small polygon is its fill alone, where there's a fill to see: better a block without an
    // edge than nothing, and its outlines would be most of its triangles.
    } else if (isBatched) {
      this.lod = (screenW < SMALL_SIZE && screenH < SMALL_SIZE) ? 1 : 2;
      this.visible = true;
      this._dropLowRes();
      const patternNumber = (texture === PIXI.Texture.WHITE) ? 0 : textureManager.getPatternNumber(pattern);
      // (A hovered or highlighted one has its outline whatever its size, in its glow.)
      const hasOutlines = (this.lod === 2 || isWireframe || litColor !== null);
      this._dropShapes();
      this._drawBatched(localScale, doFullFill, patternNumber, isWireframe, litColor, hasOutlines);

    // Very small, swap with lowRes sprite
    } else if (local.surround && (screenW < SMALL_SIZE && screenH < SMALL_SIZE)) {
      this._dropItems();
      this.lod = 1;
      this.visible = true;
      this._dropShapes();
      const lowRes = this._needLowRes();
      lowRes.visible = true;

      // Use surrounding rectangle data in local coords.
      // (Scale of parent container will apply to it)
      const srPolygon = local.surround.polygon;
      const [srWidth, srHeight] = local.surround.dimensions;
      const [srX, srY] = local.surround.centroid;

      // (LowRes shape selection / line simplification could really go in GeometryPart)
      // Choose a lowRes shape: are any surrounding rectangle corners on the outer ring?
      // Use a small epsilon in world units (the legacy code used 0.1 screen px).
      const EPSILON = 0.1 * localScale;
      const outer = local.outer!;
      let c0in: boolean | undefined;
      let c1in: boolean | undefined;
      let c2in: boolean | undefined;
      let c3in: boolean | undefined;
      for (const point of outer) {
        if (!c0in) c0in = vecEqual(point, srPolygon[0], EPSILON);
        if (!c1in) c1in = vecEqual(point, srPolygon[1], EPSILON);
        if (!c2in) c2in = vecEqual(point, srPolygon[2], EPSILON);
        if (!c3in) c3in = vecEqual(point, srPolygon[3], EPSILON);
        if (c0in && c1in && c2in && c3in) break;
      }
      const cornersInSR = c0in || c1in || c2in || c3in;
      const shapeType: 'square' | 'circle' = cornersInSR ? 'square' : 'circle';

      const filling = isWireframe ? '-unfilled' : '';
      const textureName = `lowres${filling}-${shapeType}`;

      lowRes.texture = textureManager.getTexture('symbol', textureName) || PIXI.Texture.WHITE;
      lowRes.position.set(srX, srY);
      lowRes.scale.set(srWidth / 10, srHeight / 10);   // the sprites are 10px x 10px
      lowRes.rotation = local.surround.angle;
      lowRes.tint = color;
      // (The surrounding rectangle is turned, so its corners can be outside the polygon's own box.)
      this.hitReach = Math.hypot(srWidth, srHeight) / 2 / localScale;

    } else {
      this._dropItems();
      this.lod = 2;
      this.visible = true;
      this._dropLowRes();
      this._needShapes();
      this._drawShapes(viewport, texture, textureMatrix, doFullFill);   // (only the full level of detail has shapes)
    }

    // Debug surrounding rectangle
    if (this.debugSurround) {
      this.debugSurround.clear();
      const p = local.surround?.polygon;
      if (p) {
        this.debugSurround
          .poly(p.flat(), true)
          .stroke({ width: 2 * localScale, color: 0x00ff00 });
      }
    }

    this._geomDirty = false;
    this._styleDirty = false;
    this.updateHalo(viewport);
    this.scene.featureChanged(this);
  }


  /**
   * Draws the fill and the outlines in their batches. The fill is the polygon's triangles (or
   * its band's, for a partial fill that leaves a middle), worked out when the polygon or the
   * band changes; each ring's outline is a stroke mesh, built when the polygon changes.
   * After a zoom alone, this writes nothing unless the band or the pattern is another one.
   * @param scale - How many units of the polygon's coordinates a pixel is
   * @param doFullFill - Whether to fill the whole polygon, not only along its edge
   * @param pattern - The pattern to fill with (its number in the atlas), 0 for none
   * @param isWireframe - Whether wireframe mode is active
   * @param litColor - The color of the hover or the highlight, if the polygon has one: its fill is tinted with it, and more opaque
   * @param hasOutlines - Whether the rings' outlines are drawn (not a small polygon's)
   */
  protected _drawBatched(scale: number, doFullFill: boolean, pattern: number, isWireframe: boolean, litColor: number | null, hasOutlines: boolean): void {
    const fillBatch = this._fillBatch!;
    const strokeBatch = this._strokeBatch!;
    const part = this._geom!;
    const flat = part.local!.flat as number[][];
    const style = this._style;
    const origin = this.container.position;
    const order = this.container.zIndex;
    const isSame = (this._batchPart === part);
    const isRestyled = !this.onlyTransformDirty;
    const band = doFullFill ? null : this._bandFor(PARTIALFILLWIDTH * scale);
    const color = style.fill?.color ?? 0xaaaaaa;
    const isLit = (litColor !== null);
    const fillColor = isLit ? mixColors(color, litColor, LIT_FILL_TINT) : color;
    const fillOpacity = Math.min(1, (style.fill?.opacity ?? 0.3) * (isLit ? LIT_FILL_OPACITY : 1));

    // FILL
    const fillItem = this._fillItem;
    const fillInBatch = (fillItem?.batch === fillBatch);
    if (!fillItem || !fillInBatch || !isSame || band !== this._batchBand) {
      const triangles = triangulate(band ?? [{ outer: flat[0], holes: flat.slice(1) }]);
      const dx = origin.x - fillBatch.position.x;
      const dy = origin.y - fillBatch.position.y;
      const fillStyle = { color: fillColor, alpha: fillOpacity, pattern: pattern };
      if (fillItem && fillInBatch) {
        fillBatch.setFill(fillItem, triangles.positions, triangles.indices, dx, dy);
        fillBatch.setStyle(fillItem, fillStyle);
        fillBatch.setOrder(fillItem, order);
      } else {
        fillItem?.batch?.remove(fillItem);
        this._fillItem = fillBatch.add(triangles.positions, triangles.indices, dx, dy, fillStyle, order);
        if (!this.visible) fillBatch.setVisible(this._fillItem, false);
      }
      this._batchBand = band;
      this._batchPattern = pattern;

    } else if (isRestyled || pattern !== this._batchPattern) {
      fillBatch.setStyle(fillItem, { color: fillColor, alpha: fillOpacity, pattern: pattern });
      fillBatch.setOrder(fillItem, order);
      this._batchPattern = pattern;
    }

    // OUTLINES
    // (Their width isn't narrowed at lower zooms as a line's is: the least width is the width.)
    const lineWidth = style.fill?.width || 2;
    const ringItems = this._ringItems;
    const numRings = hasOutlines ? flat.length : 0;
    for (let i = 0; i < numRings; i++) {
      const item = ringItems[i];
      const inBatch = (item?.batch === strokeBatch);
      if (item && inBatch && isSame && !isRestyled) continue;    // as it is

      const lineStyle = { width: lineWidth, minWidth: lineWidth, color: color, alpha: 1, dash: style.stroke?.dash ?? null };
      if (item && inBatch && isSame) {
        strokeBatch.setStyle(item, lineStyle);
        strokeBatch.setOrder(item, order);
      } else {
        const strokeMesh = geomStrokeMesh(flat[i], { closed: true, cap: 'butt', join: 'miter' });
        const dx = origin.x - strokeBatch.position.x;
        const dy = origin.y - strokeBatch.position.y;
        if (item && inBatch) {
          strokeBatch.setStroke(item, strokeMesh, dx, dy);
          strokeBatch.setStyle(item, lineStyle);
          strokeBatch.setOrder(item, order);
        } else {
          item?.batch?.remove(item);
          ringItems[i] = strokeBatch.add(strokeMesh, dx, dy, lineStyle, order);
        }
      }
    }
    while (ringItems.length > numRings) {   // a ring fewer than before, or none for a polygon that's small now
      const item = ringItems.pop()!;
      item.batch?.remove(item);
    }
    for (const item of ringItems) {   // (one that was hidden with the feature is shown again)
      strokeBatch.setVisible(item, true);
    }

    this._drawBatchedGlow(strokeBatch.glows ?? strokeBatch, flat, litColor, lineWidth, isSame);

    this._batchPart = part;
    this.hitReach = ((isWireframe ? 1 : lineWidth) + HIT_PADDING) / 2;
  }


  /**
   * Draws the glow of a hovered or highlighted polygon in a batch, or takes it away: a strip
   * around each ring, over every outline, that the batch's shader draws a glow in from the
   * outline's edge outward (on both sides of it).
   * @param glowBatch - The batch for the glows: the one that the outlines' batch has for them, or the outlines' batch itself
   * @param flat - The polygon's rings, each as `[x, y, x, y, …]`, in container-local space
   * @param color - The glow's color, or `null` if the polygon doesn't glow
   * @param lineWidth - The outline's width, in pixels
   * @param isSame - Whether the polygon is the one that was last drawn in the batches
   */
  protected _drawBatchedGlow(glowBatch: LineBatchMesh, flat: number[][], color: number | null, lineWidth: number, isSame: boolean): void {
    const origin = this.container.position;
    const glowItems = this._glowItems;
    const numGlows = (color !== null) ? flat.length : 0;

    for (let i = 0; i < numGlows; i++) {
      const item = glowItems[i];
      const inBatch = (item?.batch === glowBatch);
      const glow = { width: lineWidth, minWidth: lineWidth, color: color!, alpha: 1 };
      if (item && inBatch && isSame) {
        glowBatch.setGlowStyle(item, glow);
        glowBatch.setVisible(item, true);
        continue;
      }

      const around = geomStrokeMesh(flat[i], { closed: true, cap: 'round', join: 'round' });
      const dx = origin.x - glowBatch.position.x;
      const dy = origin.y - glowBatch.position.y;
      if (item && inBatch) {
        glowBatch.setGlow(item, around, dx, dy, glow);
        glowBatch.setVisible(item, true);
      } else {
        item?.batch?.remove(item);
        glowItems[i] = glowBatch.addGlow(around, dx, dy, glow, GLOW_ABOVE);
      }
    }
    while (glowItems.length > numGlows) {
      const item = glowItems.pop()!;
      item.batch?.remove(item);
    }
  }


  /**
   * Makes the `lowRes` sprite, if this feature has none.
   * @return The sprite
   */
  protected _needLowRes(): PIXI.Sprite {
    if (!this.lowRes) {
      const lowRes = new PIXI.Sprite();
      lowRes.label = 'lowRes';
      lowRes.anchor.set(0.5, 0.5);  // middle, middle
      lowRes.interactive = false;
      lowRes.eventMode = 'static';
      this.lowRes = lowRes;
      this.container.addChildAt(lowRes, 0);
    }
    return this.lowRes;
  }


  /**
   * Destroys the `lowRes` sprite, if this feature has one.
   */
  protected _dropLowRes(): void {
    this.lowRes?.destroy();
    this.lowRes = null;
  }


  /**
   * Makes the objects that draw the polygon in full, if this feature has none: the fill, and
   * the container of the strokes.
   */
  protected _needShapes(): void {
    if (this.fill) return;

    const fill = new PIXI.Graphics();
    fill.label = 'fill';
    fill.eventMode = 'static';
    fill.sortableChildren = false;
    fill.visible = false;
    this.fill = fill;

    const strokes = new PIXI.Container();
    strokes.label = 'strokes';
    strokes.eventMode = 'static';
    strokes.sortableChildren = false;
    strokes.visible = false;
    this.strokes = strokes;

    this.container.addChild(fill, strokes);
  }


  /**
   * Destroys the objects that draw the polygon in full, if this feature has them, and with them
   * everything Pixi built for them. A polygon that showed a `lowRes` sprite, or nothing, used to
   * keep them, with the geometry of the last zoom they were drawn at.
   */
  protected _dropShapes(): void {
    if (!this.fill) return;

    this.fill.destroy();
    this.fill = null;
    this.strokes?.destroy({ children: true });
    this.strokes = null;
    this._hasFill = false;
    this._meshPart = null;
    this._band = null;
    this._bandPart = null;
  }


  /**
   * Draws the polygon in full: its strokes, and its fill (the whole polygon, or the band along
   * its edge for a partial fill).
   * @param viewport - Pixi viewport to use for rendering
   * @param texture - The fill's pattern, or `PIXI.Texture.WHITE` for none
   * @param textureMatrix - How the pattern is laid out
   * @param doFullFill - Whether to fill the whole polygon, not only along its edge
   */
  protected _drawShapes(viewport: Viewport, texture: PIXI.Texture, textureMatrix: PIXI.Matrix, doFullFill: boolean): void {
    const context = this.context;
    const map = context.systems.map;
    const isWireframe = !!map?.wireframeMode;
    const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
    const local = this._geom!.local!;
    const flat = local.flat as number[][];
    const style = this._style;
    const color = style.fill?.color ?? 0xaaaaaa;
    const opacity = style.fill?.opacity ?? 0.3;
    const dash = style.stroke?.dash ?? null;

    const fill = this.fill!;
    const strokes = this.strokes!;

    fill.visible = !isWireframe;
    strokes.visible = true;

    // In wireframe there's no fill: it holds no geometry then.
    if (!fill.visible && this._hasFill) {
      fill.clear();
      this._hasFill = false;
    }

    // STROKES
    // Each ring's outline is a `LineMesh`, drawn from a stroke mesh that's built once for the
    // ring, for any width: a zoom only moves the vertices it has. Those are only good while the
    // polygon is the same: one that changed is a different part.
    if (strokes.visible) {
      strokes.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const lineWidth = isWireframe ? 1 : style.fill?.width || 2;
      const isSameShape = (this._meshPart === this._geom);
      const hitWidth = (lineWidth + HIT_PADDING) * localScale / 2;   // how far from an outline a hit can be
      this.hitReach = (lineWidth + HIT_PADDING) / 2;

      let dashTexture: PIXI.Texture | null = null;
      let dashLength = 0;
      if (dash?.length) {
        dashTexture = this.gfx.textureManager!.getDashTexture(dash);
        for (const part of dash) {
          dashLength += part * localScale;
        }
      }

      while (strokes.children.length > flat.length) {   // a ring fewer than before
        strokes.children[strokes.children.length - 1].destroy();
      }

      for (let i = 0; i < flat.length; i++) {
        const ring = flat[i];
        let outline = strokes.children[i] as LineMesh | undefined;
        if (!outline) {
          outline = new LineMesh();
          outline.label = `stroke${i}`;
          outline.sortableChildren = false;
          strokes.addChild(outline);
        }

        const strokeMesh = (isSameShape && outline.strokeMesh) || geomStrokeMesh(ring, { closed: true, cap: 'butt', join: 'miter' });
        outline.tint = color;
        outline.setStroke(strokeMesh, lineWidth * localScale / 2, dashTexture, dashLength);

        // The outline with a few pixels around it. (A zoom changes the distance and nothing else:
        // the hit area is kept, and has no shape to build.)
        const hitArea = outline.hitArea as LineHitArea | null | undefined;
        if (hitArea) {
          hitArea.set(ring, hitWidth, local.extent, true);
        } else {
          outline.hitArea = new LineHitArea(ring, hitWidth, local.extent, true);
        }
      }
      this._meshPart = this._geom;
    }

    // FILL
    if (fill.visible) {
      fill.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const fillStyle: PIXI.FillStyle = {
        color: color,
        alpha: opacity,
        texture: texture,
        matrix: textureMatrix,
        textureSpace: 'global'
      };

      // A partial fill fills the band along the inside of the edge, if that leaves a middle.
      const band = doFullFill ? null : this._bandFor(PARTIALFILLWIDTH * localScale);

      this._hasFill = true;
      fill.clear();
      if (band) {
        for (const polygon of band) {
          fill.poly(polygon.outer).fill(fillStyle);
          if (polygon.holes.length) {
            // (All of a polygon's holes in one cut: a second `cut()` would cut the polygon before it too.)
            for (const hole of polygon.holes) {
              fill.poly(hole);
            }
            fill.cut();
          }
        }
      } else {
        fill.poly(flat[0]).fill(fillStyle);
        if (flat.length > 1) {
          for (let i = 1; i < flat.length; i++) {
            fill.poly(flat[i]);
          }
          fill.cut();
        }
      }
    }

  }


  /**
   * Works out the band of a partial fill: the part of the polygon within a distance of its
   * edge (`geomAreaBand()`), which is what's filled, and what a click hits.
   *
   * It's kept from one draw to the next, while the polygon and the width are the same: a hover
   * or a restyle draws again without either changing. A zoom changes the width.
   *
   * Most polygons have no middle at that distance, and are filled whole. The polygon's
   * `inradius` (the widest circle that fits in it) says so without working anything out, for
   * all but the ones that are close to having one.
   *
   * @param width - The band's width, in the polygon's coordinates
   * @return The band's polygons, or `null` if the band is the whole polygon
   */
  protected _bandFor(width: number): BandPolygon[] | null {
    const part = this._geom!;
    if (this._bandPart === part && this._bandWidth === width) return this._band;

    const local = part.local!;
    let band: BandPolygon[] | null = null;
    if (width < (local.inradius ?? 0) + INRADIUS_PRECISION) {
      band = geomAreaBand(local.flat as number[][], width);
      if (band?.length === 0) band = null;   // (nothing to shrink: fill what there is)
    }

    this._band = band;
    this._bandPart = part;
    this._bandWidth = width;
    return band;
  }


  /**
   * Updates the hover/select/highlight halo effect for this polygon.
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateHalo(viewport: Viewport): void {
    const map = this.context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const wireframeMode = map?.wireframeMode;

    // The glow of a hover or a highlight. A polygon that batches draw has it there (see
    // `_drawBatched`); one that draws itself gets a filter on its container.
    const drawsItself = !this._fillItem && !this._ringItems.length;
    setGlowFilter(this.container, (this.visible && drawsItself) ? glowColor(this._classes) : null);

    // The halo of a selection follows the outer ring, as far outside it as a hit can be (see
    // `_drawShapes`), and inside it too in wireframe, where there's no fill to hit.
    const outer = this._geom?.local?.flat?.[0];
    if (this.visible && this._classes.has('select') && outer?.length) {
      const localScale = 2 ** (WORLD_ZOOM - viewZoom);
      const lineWidth = wireframeMode ? 1 : this._style.fill?.width || 2;
      const distance = (lineWidth + HIT_PADDING) * localScale / 2;
      const outline = geomStrokeOutline(outer, distance, { closed: true, join: 'round' });
      this._drawHalo((wireframeMode && outline.inner) ? [outline.outer, outline.inner] : [outline.outer]);
    } else {
      this._drawHalo(null);
    }
  }

}
