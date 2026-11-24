import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { LineBatchMesh, LINE_MARKERS } from './lib/LineBatchMesh.ts';
import { LineHitArea } from './lib/LineHitArea.ts';
import { LineMesh } from './lib/LineMesh.ts';
import { glowColor, setGlowFilter } from './helpers.ts';
import { geomLineSegments, geomStrokeMesh } from '../geo/index.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { LineBatchMeshGlow, LineBatchMeshItem, LineBatchMeshMarkers, LineBatchMeshStyle, LineMarkerKind } from './lib/LineBatchMesh.ts';
import type { LineStyleProps } from '../lib/Style.ts';
import type { StrokeMesh, StrokeOptions } from '../geo/stroke.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';


// How a select halo goes around the line's ends and corners: as the hit area does
const HALO_SHAPE: Partial<StrokeOptions> = { cap: 'round', join: 'round' };

// How far apart the markers along a line are, in pixels, and how far beside the line the
// middle of a sided marker is. (A batch's shader draws the same: see `LINE_MARKERS`.)
const ONEWAY_SPACING = LINE_MARKERS.oneway.spacing;
const SIDED_SPACING = LINE_MARKERS.sided.spacing;
const SIDED_OFFSET = 7;

// In a batch, the markers along a line are drawn over every stroke of its level (see
// `_drawBatched`). (A line's place among the others is its road class and ID, far below this.)
const MARKERS_ABOVE = 1e6;

// ..and the glow of a hovered or highlighted line over those.
const GLOW_ABOVE = 2e6;

// The stroke mesh that a glow's strip is made from: the glow goes around the line's ends and corners
const GLOW_CAP = 'round';
const GLOW_JOIN = 'round';

// The stroke mesh that the markers' strip is made from: no caps, and the simplest corners
const MARKER_CAP = 'butt';
const MARKER_JOIN = 'miter';

// The narrowest a casing and a stroke are drawn, in pixels
const MIN_CASING_WIDTH = 3;
const MIN_STROKE_WIDTH = 2;



/**
 * Whether a line ends where it starts, with at least three points before it gets there.
 * @param coords - The line's points as `[x, y, x, y, …]`
 * @return `true` if it's a ring
 */
function isRing(coords: number[]): boolean {
  const last = coords.length - 2;
  return (last >= 6 && coords[0] === coords[last] && coords[1] === coords[last + 1]);
}


/**
 * Says how a batch should draw a casing or a stroke.
 * @param partStyle - The style of the part (`style.casing` or `style.stroke`)
 * @param minWidth - The narrowest the part is drawn, in pixels
 * @param isCasing - Whether it's the casing
 * @return The style, for `LineBatchMesh`
 */
function batchStyle(partStyle: LineStyleProps, minWidth: number, isCasing: boolean): LineBatchMeshStyle {
  return {
    width: partStyle.width || 3,
    minWidth: minWidth,
    color: partStyle.color ?? 0xffffff,
    alpha: partStyle.opacity ?? 1,
    dash: partStyle.dash,
    isCasing: isCasing
  };
}


/**
 * Whether a part of a line is in its batch as it should be: there and shown if the line has
 * that part, not there at all if it hasn't.
 * @param item - The part in a batch, if any
 * @param batch - The batch it belongs in
 * @param wanted - Whether the line has that part
 * @return `true` if nothing has to be done about it
 */
function isAsWanted(item: LineBatchMeshItem | null, batch: LineBatchMesh, wanted: boolean): boolean {
  return wanted ? (item?.batch === batch && item.visible) : !item;
}

/**
 * Which arrows a batch draws along a line for a style's `lineMarker`.
 * @param image - The marker's image, if the style has one
 * @return The kind of marker, `null` for none, or `undefined` for an image that a batch has no shape for
 */
function arrowKind(image: Nullable<string>): LineMarkerKind | null | undefined {
  if (!image) return null;
  return (image === 'oneway' || image === 'twoway') ? image : undefined;
}

/**
 * Whether a style's marker is drawn the other way around along its line: its `scale` is
 * negative along the line (a oneway that runs against the way it's drawn, `oneway=-1`).
 * @param scale - The marker's `scale`, if the style has one
 * @return `true` if the marker points back along the line
 */
function isFlipped(scale: Nullable<number | number[]>): boolean {
  const along = Array.isArray(scale) ? scale[0] : scale;
  return (along ?? 1) < 0;
}

/**
 * Which markers a batch draws beside a line for a style's `sidedMarker`.
 * @param image - The marker's image, if the style has one
 * @return The kind of marker, `null` for none, or `undefined` for an image that a batch has no shape for
 */
function sidedKind(image: Nullable<string>): LineMarkerKind | null | undefined {
  if (!image) return null;
  return (image === 'sided') ? image : undefined;
}


/**
 * This class renders a Line feature.
 *
 * The casing and the stroke are drawn from a stroke mesh (`geomStrokeMesh()`), which has the
 * line's triangles for any width. It's built when the line or its cap or join changes.
 *
 * A layer that draws many lines gives the feature two `LineBatchMesh`es, one for its casing and one
 * for its stroke (the layer draws every casing of a level, then every stroke). Each is then a
 * run of vertices in its batch's buffers, drawn with the other lines there, and the feature has
 * no mesh of its own and nothing in its container: it needn't be in the scene at all
 * (`drawsInContainer()`). A zoom changes nothing in a batch. The markers along the line
 * (oneway arrows, the triangles of a line with sides) are a strip in the strokes' batch too,
 * which the batch's shader draws them in.
 *
 * Without batches, the casing and the stroke are each a `LineMesh` in the feature's container,
 * and a zoom works out where its vertices are for the new width; the markers are sprites, made
 * again at every zoom.
 *
 * The glow of a hovered or highlighted line is a strip in the strokes' batch as well
 * (`glowItem`), which the shader fades out from the line's edge. For a line without batches
 * it's a filter on the container.
 * (See "Hovers, selections and animation draws" in `design/graphics-system.md`.)
 *
 * Properties available:
 * - `batch`       - `LineBatchMesh` that draws the stroke, if the layer gave it one
 * - `casingBatch` - `LineBatchMesh` that draws the casing, if the layer gave it one
 * - `casing`      - `LineMesh` for the casing (below), or `null` while there's none to draw
 * - `stroke`      - `LineMesh` for the stroke (above), or `null` while a batch draws it
 * -  (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeatureLine extends AbstractPixiFeature {

  /** The mesh that draws the casing (below), or null while there's none to draw (see `update`) */
  public casing: LineMesh | null;
  /** The mesh that draws the stroke (above), or null while a batch draws it */
  public stroke: LineMesh | null;

  /** The line with a few pixels around it, for hit testing and the halo (null while the line can't be hit) */
  protected _hitArea: LineHitArea | null;
  /** The line that the stroke meshes of the casing and the stroke were built from */
  protected _meshPart: GeometryPart | null;
  /** The batch that the layer gave this feature to draw its stroke in (see `batch`) */
  protected _batch: LineBatchMesh | null;
  /** The batch that the layer gave this feature to draw its casing in (see `casingBatch`) */
  protected _casingBatch: LineBatchMesh | null;
  /** The line that the casing and the stroke in the batches were built from */
  protected _batchPart: GeometryPart | null;
  /** The casing in a batch, if a batch draws it */
  protected _casingItem: LineBatchMeshItem | null;
  /** The stroke in a batch, if a batch draws it */
  protected _strokeItem: LineBatchMeshItem | null;
  /** The arrows along the line (oneway) in the strokes' batch, if the style has them and a batch draws the line */
  protected _arrowItem: LineBatchMeshItem | null;
  /** The markers beside the line (sided) in the strokes' batch, if the style has them and a batch draws the line */
  protected _sidedItem: LineBatchMeshItem | null;
  /** The glow around the line in the strokes' batch, while the line is hovered or highlighted and a batch draws it */
  protected _glowItem: LineBatchMeshItem | null;
  /** The cap and join that the casing in the batch was built with */
  protected _casingShape: string;
  /** The cap and join that the stroke in the batch was built with */
  protected _strokeShape: string;


  /**
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._hitArea = null;
    this._meshPart = null;
    this._casingItem = null;
    this._strokeItem = null;
    this._arrowItem = null;
    this._sidedItem = null;
    this._glowItem = null;
    this._casingShape = '';
    this._strokeShape = '';

    this._batch = null;
    this._casingBatch = null;
    this._batchPart = null;
    this.casing = null;   // the meshes are made in `update()`, if no batch draws the line
    this.stroke = null;
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    this._dropMeshes();
    this._dropItems();
    this.batch = null;
    this.casingBatch = null;

    this._hitArea = null;
    this._meshPart = null;
    this._batchPart = null;

    super.destroy();
  }


  /**
   * The batch to draw the stroke in, with the other lines of the layer, or `null` to draw the
   * line with meshes of its own. The layer sets it before `update()`, with `casingBatch`, and
   * positions the batch near the line. The feature may be drawn some frames later, so the
   * batch counts the features it was given to (`LineBatchMesh.users`).
   * @return The batch, or `null`
   */
  public get batch(): LineBatchMesh | null {
    return this._batch;
  }
  /**
   * @param val - The batch to draw the stroke in from the next `update()`, or `null` for none
   */
  public set batch(val: LineBatchMesh | null) {
    if (val === this._batch) return;
    if (this._batch) this._batch.users--;
    if (val) val.users++;
    this._batch = val;
  }


  /**
   * The batch to draw the casing in (see `batch`). The layer draws its casing batches before
   * its stroke batches, so every casing of a level is under every stroke of it.
   * @return The batch, or `null`
   */
  public get casingBatch(): LineBatchMesh | null {
    return this._casingBatch;
  }
  /**
   * @param val - The batch to draw the casing in from the next `update()`, or `null` for none
   */
  public set casingBatch(val: LineBatchMesh | null) {
    if (val === this._casingBatch) return;
    if (this._casingBatch) this._casingBatch.users--;
    if (val) val.users++;
    this._casingBatch = val;
  }


  /**
   * Whether this line draws something in its own container, and so has to be in the scene (the
   * layer asks before `update()`, to know whether to give it a place there).
   * A line whose casing and stroke are in batches draws nothing itself (its glow, when it's
   * hovered or highlighted, is in a batch too), unless it has markers along it that a batch
   * has no shape for (none of Rapid's styles has): those are sprites in the container.
   * @return `true` if its container has to be in the scene
   */
  public drawsInContainer(): boolean {
    if (!this._batchesFor()) return true;
    return !this._markersBatchable();
  }


  /**
   * Whether a batch can draw the markers that this line's style has along it, if it has any:
   * oneway arrows and the triangles of a line with sides (see `LINE_MARKERS`).
   * @return `true` if no marker needs a sprite
   */
  protected _markersBatchable(): boolean {
    const style = this._style;
    return arrowKind(style.lineMarker?.image) !== undefined && sidedKind(style.sidedMarker?.image) !== undefined;
  }


  /**
   * Whether the pointer is over this line: within a few pixels of it. This needs nothing of
   * Pixi's, so it's the same whether the line's container is in the scene or not.
   * @param _point - The pointer's place in the stage's coordinates
   * @param world - The same place in world coordinates
   * @return `true` if the pointer hits it
   */
  public override hitTest(_point: PIXI.PointData, world: PIXI.PointData): boolean {
    const hitArea = this._hitArea;
    if (!hitArea || !this.visible || !this._allowInteraction) return false;
    const position = this.container.position;    // the line's coordinates start here, in the world's
    return hitArea.contains(world.x - position.x, world.y - position.y);
  }


  /**
   * The mesh in the scene that draws this line's stroke, if a batch does: where the line is
   * drawn among the others is where that batch is, and the line's `sceneOrder` in it.
   * @return The batch, or this feature's own container
   */
  public override get sceneContainer(): PIXI.Container {
    const item = this._strokeItem ?? this._casingItem;
    return (item?.batch && item.visible) ? item.batch : this.container;
  }


  /**
   * Where this line is drawn among the others that its batch draws.
   * @return The order of its stroke in the batch (0 if no batch draws it)
   */
  public override get sceneOrder(): number {
    const item = this._strokeItem ?? this._casingItem;
    return (item?.batch && item.visible) ? item.order : 0;
  }


  /**
   * The batches that draw this line's casing and stroke, if the layer gave it both and they
   * can draw its dashes.
   * @return `true` if batches draw this line
   */
  protected _batchesFor(): boolean {
    const style = this._style;
    const batch = this._batch;
    const casingBatch = this._casingBatch;
    if (!batch || batch.destroyed || !casingBatch || casingBatch.destroyed) return false;
    return LineBatchMesh.canDraw(style.stroke?.dash) && LineBatchMesh.canDraw(style.casing?.dash);
  }


  /**
   * Whether the Feature is currently visible
   * @return `true` if the feature is currently visible
   */
  public override get visible(): boolean {
    return super.visible;
  }
  /**
   * A line that a batch draws is shown and hidden there too. (Not shown there while the line
   * draws itself: see `drawsInContainer`.)
   * @param val - `true` to show the feature, `false` to hide it
   */
  public override set visible(val: boolean) {
    super.visible = val;
    const inBatch = val && !this.stroke;
    this._casingItem?.batch?.setVisible(this._casingItem, inBatch);
    this._strokeItem?.batch?.setVisible(this._strokeItem, inBatch);
    this._arrowItem?.batch?.setVisible(this._arrowItem, inBatch);
    this._sidedItem?.batch?.setVisible(this._sidedItem, inBatch);
    this._glowItem?.batch?.setVisible(this._glowItem, inBatch);
  }


  /**
   * The casing in the batch, if a batch draws this line and it has a casing
   * @return The batch's item, or `null`
   * @readonly
   */
  public get casingItem(): LineBatchMeshItem | null {
    return this._casingItem;
  }


  /**
   * The stroke in the batch, if a batch draws this line
   * @return The batch's item, or `null`
   * @readonly
   */
  public get strokeItem(): LineBatchMeshItem | null {
    return this._strokeItem;
  }


  /**
   * The oneway arrows along the line in the strokes' batch, if a batch draws them
   * @return The batch's item, or `null`
   * @readonly
   */
  public get arrowItem(): LineBatchMeshItem | null {
    return this._arrowItem;
  }


  /**
   * The markers on the line's side in the strokes' batch, if a batch draws them
   * @return The batch's item, or `null`
   * @readonly
   */
  public get sidedItem(): LineBatchMeshItem | null {
    return this._sidedItem;
  }


  /**
   * The glow around the line in the strokes' batch, while a batch draws it there
   * @return The batch's item, or `null`
   * @readonly
   */
  public get glowItem(): LineBatchMeshItem | null {
    return this._glowItem;
  }


  /**
   * Destroys the meshes of the casing and the stroke, if this feature has them.
   */
  protected _dropMeshes(): void {
    this.casing?.destroy();
    this.casing = null;
    this.stroke?.destroy();
    this.stroke = null;
  }


  /**
   * Takes the casing and the stroke out of the batch that draws them, if one does.
   */
  protected _dropItems(): void {
    this._casingItem?.batch?.remove(this._casingItem);
    this._casingItem = null;
    this._strokeItem?.batch?.remove(this._strokeItem);
    this._strokeItem = null;
    this._arrowItem?.batch?.remove(this._arrowItem);
    this._arrowItem = null;
    this._sidedItem?.batch?.remove(this._sidedItem);
    this._sidedItem = null;
    this._glowItem?.batch?.remove(this._glowItem);
    this._glowItem = null;
    this._batchPart = null;
  }


  /**
   * Line update path that draws from world coordinates (WORLD_ZOOM=16).
   * The feature's container sits inside a group with scale `2^(viewZoom - WORLD_ZOOM)`, so vertex
   * coordinates in world space map directly to screen pixels without per-frame reprojection.
   * @param viewport - Pixi viewport to use for rendering
   */
  public update(viewport: Viewport): void {
    if (!this.dirty) return;  // nothing to do
    this.layer.work.updated++;

    const map = this.context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const styleZoom = map?.effectiveZoom() ?? viewZoom;
    const isWireframe = !!map?.wireframeMode;
    const container = this.container;
    const style = this._style;
    const localScale = 2 ** (WORLD_ZOOM - viewZoom);

    const type = this._geom?.type;
    const world = this._geom?.world;
    const local = this._geom?.local;
    const points = local?.coords as Vec2[];
    const flat = local?.flat as number[][];

    // Not a LineString, or no GeometryPart data?
    if (type !== 'LineString' || !world || !local || !points?.length || flat?.length !== 1 || !flat[0].length) {
      this.lod = 0;
      this.visible = false;
      this._geomDirty = false;
      this._styleDirty = false;
      return;   // (hiding it told the scene that it changed)
    }

    // The container lives under the `world` Pixi container (in GraphicsSystem),
    // which provides the position + scale that maps world coords -> screen.
    // Set container.position to the feature's world origin (extent center) and
    // draw vertices using `local.coords` (already origin-relative).
    const origin = world.origin!;
    container.position.set(origin[0], origin[1]);

    this.visible = true;

    this.lod = (styleZoom < 16) ? 1 : 2;

    // The casing and the stroke are in the layer's batches if it gave them and they can draw
    // the line: then its markers and its glow are too.
    const inBatches = this._batchesFor();

    // The markers along the line (oneway arrows, sided markers): sprites in the container,
    // unless the strokes' batch draws them (see `_drawBatched`).
    const showMarkers = (styleZoom >= 16) && !(inBatches && this._markersBatchable());
    this._drawMarkerSprites(points, localScale, showMarkers);

    // The line with a few pixels around it, used for hit area and halo.
    // It's in world-local coords (origin-relative), the container's local frame.
    // Pixi composes the container transform when hit-testing, so we don't need to project to screen.
    if (this.visible && !this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
      const minwidth = 3;
      let bufWidth = this._style.casing.width ?? 5;
      if (styleZoom < 16) {
        bufWidth -= 4;
      } else if (styleZoom < 17) {
        bufWidth -= 2;
      }
      if (bufWidth < minwidth) bufWidth = minwidth;
      if (isWireframe) bufWidth = 1;

      // (A zoom changes the distance and nothing else: the hit area is kept, and has no shape to build.)
      const coords = flat[0];
      const halfWidth = (bufWidth + 10) * localScale / 2;
      const closed = isRing(coords);
      if (this._hitArea) {
        this._hitArea.set(coords, halfWidth, local.extent, closed);
      } else {
        this._hitArea = new LineHitArea(coords, halfWidth, local.extent, closed);
      }
      container.hitArea = this._hitArea;
      this.hitReach = (bufWidth + 10) / 2;
    } else {
      this._hitArea = null;
      container.hitArea = null;
      this.hitReach = 0;
    }

    // The casing and the stroke: in the layer's batch if it gave one that can draw them,
    // otherwise as meshes of this feature's own.
    const casingStyle = style.casing;
    const hasCasing = !!casingStyle && casingStyle.opacity !== 0;

    if (inBatches) {
      this._dropMeshes();
      this._drawBatched(this._batch!, this._casingBatch!, flat[0], origin, hasCasing);
      this._batchPart = this._geom;

    } else {
      // Meshes of this feature's own, in its container.
      this._dropItems();
      this._drawMeshes(flat[0], hasCasing, styleZoom, localScale, isWireframe);
      this._meshPart = this._geom;
    }

    this._geomDirty = false;
    this._styleDirty = false;

    this.updateHalo(viewport);
    this.scene.labelSpace.featureChanged(this);
  }


  /**
   * Draws the markers along the line as sprites in the feature's container: an arrow every
   * 35 pixels along a oneway, a triangle every 30 on the right of a line with sides. They're
   * made again on every call (their places depend on the zoom), and taken away when there's
   * nothing to show.
   * @param points - The line's points, in container-local space
   * @param localScale - How many units of the line's coordinates a pixel is
   * @param showMarkers - Whether to draw the markers that the style has (not below zoom 16, and not while a batch draws them)
   */
  protected _drawMarkerSprites(points: Vec2[], localScale: number, showMarkers: boolean): void {
    const container = this.container;
    const style = this._style;
    const textureManager = this.gfx.textureManager!;

    const lineMarkerTextureID = style.lineMarker.image;
    const sideMarkerTextureID = style.sidedMarker.image;
    let lineMarkers = container.getChildByLabel('lineMarkers');

    if (showMarkers && (lineMarkerTextureID || sideMarkerTextureID)) {
      // Create line marker container, if necessary
      if (!lineMarkers) {
        lineMarkers = new PIXI.Container();
        lineMarkers.label = 'lineMarkers';
        lineMarkers.eventMode = 'none';
        lineMarkers.sortableChildren = false;
        container.addChild(lineMarkers);
      }
      for (const sprite of lineMarkers.removeChildren()) {
        sprite.destroy();
      }

      // Show line markers (e.g. oneway arrows)
      if (lineMarkerTextureID) {
        const lineMarkerTexture = textureManager.getTexture('symbol', lineMarkerTextureID) || PIXI.Texture.WHITE;
        const flip = isFlipped(style.lineMarker.scale) ? -1 : 1;   // an arrow that points back along the line
        const segments = geomLineSegments(points, ONEWAY_SPACING * localScale, false, true);  /* sided = false, limited = true */
        segments.forEach(segment => {
          segment.coords.forEach(([x, y]) => {
            const sprite = new PIXI.Sprite(lineMarkerTexture);
            sprite.eventMode = 'none';
            sprite.sortableChildren = false;
            sprite.anchor.set(0.5, 0.5); // middle, middle
            sprite.position.set(x, y);
            sprite.rotation = segment.angle;
            sprite.scale.set(localScale * flip, localScale);
            sprite.tint = style.lineMarker.color ?? 0x000000;
            lineMarkers!.addChild(sprite);
          });
        });
      }

      // Show side markers (e.g. sided triangles)
      if (sideMarkerTextureID) {
        const sideMarkerTexture = textureManager.getTexture('symbol', sideMarkerTextureID) || PIXI.Texture.WHITE;
        const segments = geomLineSegments(points, SIDED_SPACING * localScale, true, true, SIDED_OFFSET * localScale);  /* sided = true, limited = true */
        segments.forEach(segment => {
          segment.coords.forEach(([x, y]) => {
            const sprite = new PIXI.Sprite(sideMarkerTexture);
            sprite.eventMode = 'none';
            sprite.sortableChildren = false;
            sprite.anchor.set(0.5, 0.5); // middle, middle
            sprite.position.set(x, y);
            sprite.rotation = segment.angle;
            sprite.scale.set(localScale, localScale);
            sprite.tint = style.stroke.color ?? 0xcccccc;
            lineMarkers!.addChild(sprite);
          });
        });
      }

    } else if (lineMarkers) {  // No line markers, remove if it exists
      container.removeChild(lineMarkers);
      lineMarkers.destroy({ children: true });
    }
  }


  /**
   * Draws the casing and the stroke as meshes of this feature's own, making and destroying
   * them as the style and the zoom need.
   * @param coords - The line's points as `[x, y, x, y, …]`, in container-local space
   * @param hasCasing - Whether the style has a casing that can be seen
   * @param styleZoom - Effective zoom, used for styling
   * @param scale - How many units of the line's coordinates a pixel is
   * @param isWireframe - Whether wireframe mode is active
   */
  protected _drawMeshes(coords: number[], hasCasing: boolean, styleZoom: number, scale: number, isWireframe: boolean): void {
    const container = this.container;
    const style = this._style;

    // The casing is drawn from zoom 16, if the style has one that can be seen. Its mesh
    // exists only then: the lines of the photo and data layers have none, nor has any line
    // below zoom 16.
    const showCasing = (styleZoom >= 16) && hasCasing;
    if (showCasing && !this.casing) {
      const casing = new LineMesh();
      casing.label = 'casing';
      casing.eventMode = 'none';
      casing.sortableChildren = false;
      this.casing = casing;
      container.addChildAt(casing, 0);   // below the stroke
    } else if (!showCasing && this.casing) {
      this.casing.destroy();
      this.casing = null;
    }
    if (!this.stroke) {
      const stroke = new LineMesh();
      stroke.label = 'stroke';
      stroke.eventMode = 'none';
      stroke.sortableChildren = false;
      this.stroke = stroke;
      container.addChildAt(stroke, this.casing ? 1 : 0);   // above the casing, below the markers
    }

    // They keep the stroke mesh they were last drawn from, and share one when they have the
    // same cap and join. Those are only good while the line is the same: a line that changed
    // is a different part.
    const casing = this.casing;
    const stroke = this.stroke;
    const isSameLine = (this._meshPart === this._geom);
    const oldCasing = isSameLine ? (casing?.strokeMesh ?? null) : null;
    const oldStroke = isSameLine ? stroke.strokeMesh : null;
    if (casing) {
      this._drawPart(casing, style.casing, MIN_CASING_WIDTH, coords, oldCasing, oldStroke, styleZoom, scale, isWireframe);
    }
    this._drawPart(stroke, style.stroke, MIN_STROKE_WIDTH, coords, oldStroke, casing?.strokeMesh ?? null, styleZoom, scale, isWireframe);
  }


  /**
   * Draws the casing and the stroke in their batches: each is a run of vertices there, written
   * when the line or its cap or join changes. The batches' shader works out their width at
   * every zoom, so a zoom alone changes nothing here. The markers along the line, if a batch
   * has a shape for them, are a strip in the strokes' batch, over every stroke of the level.
   * @param batch - The batch for the stroke
   * @param casingBatch - The batch for the casing
   * @param coords - The line's points as `[x, y, x, y, …]`, in container-local space
   * @param origin - Where those coordinates start, in the world's
   * @param hasCasing - Whether the style has a casing that can be seen
   */
  protected _drawBatched(batch: LineBatchMesh, casingBatch: LineBatchMesh, coords: number[], origin: Vec2, hasCasing: boolean): void {
    const style = this._style;
    const strokeStyle = style.stroke;
    const hasStroke = !!strokeStyle && strokeStyle.opacity !== 0;
    const isSameLine = (this._batchPart === this._geom);
    const color = glowColor(this._classes);
    // (If a batch has no shape for one of the line's markers, the line draws them all itself.)
    const inBatch = this._markersBatchable();
    const arrows = inBatch ? (arrowKind(style.lineMarker?.image) ?? null) : null;
    const sided = inBatch ? (sidedKind(style.sidedMarker?.image) ?? null) : null;

    // Only the zoom or the rotation changed, and the batches have the line as it is: nothing to do.
    // (This runs for every line after a zoom, so it makes no objects.)
    if (isSameLine && this.onlyTransformDirty &&
      isAsWanted(this._casingItem, casingBatch, hasCasing) &&
      isAsWanted(this._strokeItem, batch, hasStroke) &&
      isAsWanted(this._arrowItem, batch, !!arrows) &&
      isAsWanted(this._sidedItem, batch, !!sided) &&
      isAsWanted(this._glowItem, batch.glows ?? batch, color !== null)
    ) {
      return;
    }

    const order = this.container.zIndex;
    const isRestyled = this._styleDirty;
    const closed = isRing(coords);   // a line that ends where it starts gets a join there, not two caps

    // One stroke mesh serves both parts when they have the same cap and join.
    let built: StrokeMesh | null = null;
    let builtShape = '';

    if (hasCasing) {
      const casingStyle = style.casing;
      const cap = casingStyle.cap ?? 'butt';
      const join = casingStyle.join ?? 'miter';
      const shape = `${cap}/${join}`;
      const lineStyle = batchStyle(casingStyle, MIN_CASING_WIDTH, true);
      const item = this._casingItem;
      const dx = origin[0] - casingBatch.position.x;
      const dy = origin[1] - casingBatch.position.y;

      if (item?.batch === casingBatch && isSameLine && this._casingShape === shape) {
        if (isRestyled) casingBatch.setStyle(item, lineStyle);
        casingBatch.setOrder(item, order);
      } else {
        built = geomStrokeMesh(coords, { cap: cap, join: join, closed: closed });
        builtShape = shape;
        if (item?.batch === casingBatch) {
          casingBatch.setStroke(item, built, dx, dy);
          casingBatch.setStyle(item, lineStyle);
          casingBatch.setOrder(item, order);
        } else {
          item?.batch?.remove(item);
          this._casingItem = casingBatch.add(built, dx, dy, lineStyle, order);
        }
        this._casingShape = shape;
      }
    } else if (this._casingItem) {
      this._casingItem.batch?.remove(this._casingItem);
      this._casingItem = null;
    }

    if (hasStroke) {
      const cap = strokeStyle.cap ?? 'butt';
      const join = strokeStyle.join ?? 'miter';
      const shape = `${cap}/${join}`;
      const lineStyle = batchStyle(strokeStyle, MIN_STROKE_WIDTH, false);
      const item = this._strokeItem;
      const dx = origin[0] - batch.position.x;
      const dy = origin[1] - batch.position.y;

      if (item?.batch === batch && isSameLine && this._strokeShape === shape) {
        if (isRestyled) batch.setStyle(item, lineStyle);
        batch.setOrder(item, order);
      } else {
        if (builtShape !== shape) {
          built = geomStrokeMesh(coords, { cap: cap, join: join, closed: closed });
        }
        if (item?.batch === batch) {
          batch.setStroke(item, built!, dx, dy);
          batch.setStyle(item, lineStyle);
          batch.setOrder(item, order);
        } else {
          item?.batch?.remove(item);
          this._strokeItem = batch.add(built!, dx, dy, lineStyle, order);
        }
        this._strokeShape = shape;
      }
    } else if (this._strokeItem) {
      this._strokeItem.batch?.remove(this._strokeItem);
      this._strokeItem = null;
    }

    this._drawBatchedMarkers(batch, coords, origin, closed, (builtShape === `${MARKER_CAP}/${MARKER_JOIN}`) ? built : null, arrows, sided, order, isSameLine);

    this._drawBatchedGlow(batch.glows ?? batch, coords, origin, closed, (builtShape === `${GLOW_CAP}/${GLOW_JOIN}`) ? built : null, color, hasCasing, order, isSameLine);
  }


  /**
   * Draws the markers along the line in the strokes' batch: a strip along the line that the
   * batch's shader draws them in, over every stroke of the level. It's made from a stroke mesh
   * without caps.
   * @param batch - The batch for the stroke
   * @param coords - The line's points as `[x, y, x, y, …]`, in container-local space
   * @param origin - Where those coordinates start, in the world's
   * @param closed - Whether the line ends where it starts
   * @param built - A stroke mesh without caps that was just built for this line, if there is one
   * @param arrows - The kind of arrows the style has along the line, or `null` for none
   * @param sided - The kind of markers the style has beside the line, or `null` for none
   * @param order - The line's place among the lines of the batch
   * @param isSameLine - Whether the line is the one that was last drawn in the batches
   */
  protected _drawBatchedMarkers(
    batch: LineBatchMesh,
    coords: number[],
    origin: Vec2,
    closed: boolean,
    built: StrokeMesh | null,
    arrows: LineMarkerKind | null,
    sided: LineMarkerKind | null,
    order: number,
    isSameLine: boolean
  ): void {
    const style = this._style;
    const dx = origin[0] - batch.position.x;
    const dy = origin[1] - batch.position.y;

    const needsStrip = (arrows && !(this._arrowItem?.batch === batch && isSameLine)) || (sided && !(this._sidedItem?.batch === batch && isSameLine));
    let strip: StrokeMesh | null = null;
    if (needsStrip) {
      strip = built ?? geomStrokeMesh(coords, { cap: MARKER_CAP, join: MARKER_JOIN, closed: closed });
    }
    const arrowMarkers = arrows && { kind: arrows, color: style.lineMarker.color ?? 0x000000, alpha: 1, reversed: isFlipped(style.lineMarker.scale) };
    const sidedMarkers = sided && { kind: sided, color: style.stroke?.color ?? 0xcccccc, alpha: 1 };
    this._arrowItem = this._batchMarkers(batch, this._arrowItem, arrowMarkers, strip, dx, dy, MARKERS_ABOVE + order, isSameLine);
    this._sidedItem = this._batchMarkers(batch, this._sidedItem, sidedMarkers, strip, dx, dy, MARKERS_ABOVE + order, isSameLine);
  }


  /**
   * Draws the glow of a hovered or highlighted line in a batch, or takes it away: a strip
   * over everything of the level, that the batch's shader draws a glow in from the line's
   * edge outward. It's made from a stroke mesh with round ends and corners.
   * @param batch - The batch for the glow: the one that the strokes' batch has for them, or the strokes' batch itself
   * @param coords - The line's points as `[x, y, x, y, …]`, in container-local space
   * @param origin - Where those coordinates start, in the world's
   * @param closed - Whether the line ends where it starts
   * @param built - A stroke mesh with round ends and corners that was just built for this line, if there is one
   * @param color - The glow's color, or `null` if the line doesn't glow
   * @param hasCasing - Whether the style has a casing that can be seen
   * @param order - The line's place among the lines of the batch
   * @param isSameLine - Whether the line is the one that was last drawn in the batches
   */
  protected _drawBatchedGlow(
    batch: LineBatchMesh,
    coords: number[],
    origin: Vec2,
    closed: boolean,
    built: StrokeMesh | null,
    color: number | null,
    hasCasing: boolean,
    order: number,
    isSameLine: boolean
  ): void {
    const item = this._glowItem;
    if (color === null) {
      item?.batch?.remove(item);
      this._glowItem = null;
      return;
    }

    // (The glow starts at the edge of what's drawn widest: the casing, if there's one.)
    const style = this._style;
    const widest = hasCasing ? style.casing : style.stroke;
    const glow: LineBatchMeshGlow = {
      width: widest?.width || 3,
      minWidth: hasCasing ? MIN_CASING_WIDTH : MIN_STROKE_WIDTH,
      color: color,
      alpha: 1
    };

    if (item?.batch === batch && isSameLine) {
      batch.setGlowStyle(item, glow);
      return;
    }

    const dx = origin[0] - batch.position.x;
    const dy = origin[1] - batch.position.y;
    const around = built ?? geomStrokeMesh(coords, { cap: GLOW_CAP, join: GLOW_JOIN, closed: closed });
    if (item?.batch === batch) {
      batch.setGlow(item, around, dx, dy, glow);
    } else {
      item?.batch?.remove(item);
      this._glowItem = batch.addGlow(around, dx, dy, glow, GLOW_ABOVE + order);
    }
  }


  /**
   * Puts one kind of marker along this line in the strokes' batch, changes the ones that are
   * there, or takes them out.
   * @param batch - The batch for the stroke
   * @param item - The markers of this kind that are in a batch now, if any
   * @param markers - Which markers the style has, and their color, or `null` for none
   * @param strip - The stroke mesh to make their strip from, if the line isn't the one the batch has
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param order - Where they're drawn among everything in the batch
   * @param isSameLine - Whether the line is the one that was last drawn in the batches
   * @return The markers in the batch, or `null` if there are none
   */
  protected _batchMarkers(
    batch: LineBatchMesh,
    item: LineBatchMeshItem | null,
    markers: LineBatchMeshMarkers | null,
    strip: StrokeMesh | null,
    dx: number,
    dy: number,
    order: number,
    isSameLine: boolean
  ): LineBatchMeshItem | null {
    if (!markers) {
      item?.batch?.remove(item);
      return null;
    }

    if (item?.batch === batch && isSameLine) {    // on the line they were on
      batch.setMarkerStyle(item, markers);
      batch.setOrder(item, order);
      return item;
    }
    if (!strip) return item;    // (not reached: a strip is made whenever it's needed)

    if (item?.batch === batch) {
      batch.setMarkers(item, strip, dx, dy, markers);
      batch.setOrder(item, order);
      return item;
    }
    item?.batch?.remove(item);
    return batch.addMarkers(strip, dx, dy, markers, order);
  }


  /**
   * Draws the casing or the stroke.
   * The line's coordinates are in container-local space (z16 world coords minus the feature's
   * world origin), i.e. `GeometryPart.local.flat`, and its width is in the same units:
   * `px × 2^(WORLD_ZOOM - viewZoom)`.
   * @param mesh - The mesh to draw it with (`this.casing` or `this.stroke`)
   * @param partStyle - The style of the part (`style.casing` or `style.stroke`)
   * @param minWidth - The narrowest the part is drawn, in pixels
   * @param coords - The line's points as `[x, y, x, y, …]`
   * @param own - The stroke mesh that this part was last drawn from, if it's still this line's
   * @param other - The stroke mesh of the other part, if it's this line's
   * @param styleZoom - Effective zoom, used for styling
   * @param scale - How many units of the line's coordinates a pixel is
   * @param isWireframe - Whether wireframe mode is active
   */
  protected _drawPart(
    mesh: LineMesh,
    partStyle: LineStyleProps,
    minWidth: number,
    coords: number[],
    own: StrokeMesh | null,
    other: StrokeMesh | null,
    styleZoom: number,
    scale: number,
    isWireframe: boolean
  ): void {
    const textureManager = this.gfx.textureManager!;

    if (!partStyle || partStyle.opacity === 0) {   // nothing to see
      mesh.visible = false;
      mesh.clear();
      return;
    }

    let width = partStyle.width || 3;

    // Narrow at lower zooms
    if (styleZoom < 16) {
      width -= 4;
    } else if (styleZoom < 17) {
      width -= 2;
    }
    if (width < minWidth) {
      width = minWidth;
    }

    if (isWireframe) {
      width = 1;
    }

    // The triangles, for any width. Use the ones we have if they're for this cap and join.
    const cap = partStyle.cap ?? 'butt';
    const join = partStyle.join ?? 'miter';
    let strokeMesh: StrokeMesh;
    if (own?.cap === cap && own.join === join) {
      strokeMesh = own;
    } else if (other?.cap === cap && other.join === join) {
      strokeMesh = other;
    } else {
      // A line that ends where it starts is a ring: it gets a join there, not two caps.
      strokeMesh = geomStrokeMesh(coords, { cap: cap, join: join, closed: isRing(coords) });
    }

    // Dashes are a texture that repeats along the line.
    const dash = partStyle.dash;
    let dashTexture: PIXI.Texture | null = null;
    let dashLength = 0;
    if (dash?.length) {
      dashTexture = textureManager.getDashTexture(dash);
      for (const part of dash) {
        dashLength += part * scale;
      }
    }

    mesh.visible = true;
    mesh.tint = partStyle.color ?? 0xffffff;
    mesh.alpha = partStyle.opacity ?? 1;
    mesh.setStroke(strokeMesh, width * scale / 2, dashTexture, dashLength);
  }


  /**
   * Show/Hide halo (expects `this._hitArea` to be already set up by `update()`)
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateHalo(_viewport: Viewport): void {
    // The glow of a hover or a highlight. A line that batches draw has it there (see
    // `_drawBatched`); one that draws itself gets a filter on its container.
    const drawsItself = !!this.stroke;
    setGlowFilter(this.container, (this.visible && drawsItself) ? glowColor(this._classes) : null);

    // The halo of a selection is the edge of the hit area: a ring around an open line, and one
    // on each side of a line that ends where it starts.
    if (this.visible && this._classes.has('select') && this._hitArea) {
      const outline = this._hitArea.outline(HALO_SHAPE);
      this._drawHalo(outline.inner ? [outline.outer, outline.inner] : [outline.outer]);
    } else {
      this._drawHalo(null);
    }
  }

}
