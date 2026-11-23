import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { GlowFilter } from 'pixi-filters';
import { LineBatch } from './lib/LineBatch.ts';
import { LineHitArea } from './lib/LineHitArea.ts';
import { LineMesh } from './lib/LineMesh.ts';
import { drawHalo } from './helpers.ts';
import { geomLineSegments, geomStrokeMesh } from '../geo/index.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { LineBatchItem, LineBatchStyle } from './lib/LineBatch.ts';
import type { LineStyleProps } from '../lib/Style.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { StrokeMesh, StrokeOptions } from '../geo/stroke.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';


// How a select halo goes around the line's ends and corners: as the hit area does
const HALO_SHAPE: Partial<StrokeOptions> = { cap: 'round', join: 'round' };

const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;

// The narrowest a casing and a stroke are drawn, in pixels
const MIN_CASING_WIDTH = 3;
const MIN_STROKE_WIDTH = 2;

// In a batch, a line's stroke is drawn this much later than its casing. (Less than what's
// between two lines: their order is their container's `zIndex`, which the layer sets.)
const STROKE_ORDER = 1e-7;


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
 * @return The style, for `LineBatch`
 */
function batchStyle(partStyle: LineStyleProps, minWidth: number, isCasing: boolean): LineBatchStyle {
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
 * This class renders a Line feature.
 *
 * The casing and the stroke are drawn from a stroke mesh (`geomStrokeMesh()`), which has the
 * line's triangles for any width. It's built when the line or its cap or join changes.
 *
 * A layer that draws many lines gives the feature a `LineBatch` (`batch`): the casing and the
 * stroke are then two runs of vertices in the batch's buffers, drawn with every other line of
 * the batch, and the feature has no mesh of its own. A zoom changes nothing in a batch.
 * Without a batch, each is a `LineMesh`, and a zoom works out where its vertices are for the
 * new width. (See `design/graphics-system.md` section 15.)
 *
 * Properties available:
 * - `batch`      - `LineBatch` that draws the casing and the stroke, if the layer gave it one
 * - `casing`     - `LineMesh` for the casing (below), or `null` while there's none to draw
 * - `stroke`     - `LineMesh` for the stroke (above), or `null` while a batch draws it
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
  /** The batch that the layer gave this feature to draw in (see `batch`) */
  protected _batch: LineBatch | null;
  /** The casing in a batch, if a batch draws it */
  protected _casingItem: LineBatchItem | null;
  /** The stroke in a batch, if a batch draws it */
  protected _strokeItem: LineBatchItem | null;
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
    this._casingShape = '';
    this._strokeShape = '';

    this._batch = null;
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

    this._hitArea = null;
    this._meshPart = null;

    super.destroy();
  }


  /**
   * The batch to draw the casing and the stroke in, with the other lines of the layer, or
   * `null` to draw the line with meshes of its own. The layer sets it before `update()`, and
   * positions the batch near the line. The feature may be drawn some frames later, so the
   * batch counts the features it was given to (`LineBatch.users`).
   * @return The batch, or `null`
   */
  public get batch(): LineBatch | null {
    return this._batch;
  }
  /**
   * @param val - The batch to draw in from the next `update()`, or `null` for none
   */
  public set batch(val: LineBatch | null) {
    if (val === this._batch) return;
    if (this._batch) this._batch.users--;
    if (val) val.users++;
    this._batch = val;
  }


  /**
   * Whether the Feature is currently visible
   * @return `true` if the feature is currently visible
   */
  public override get visible(): boolean {
    return super.visible;
  }
  /**
   * A line that a batch draws is shown and hidden there too.
   * @param val - `true` to show the feature, `false` to hide it
   */
  public override set visible(val: boolean) {
    super.visible = val;
    this._casingItem?.batch?.setVisible(this._casingItem, val);
    this._strokeItem?.batch?.setVisible(this._strokeItem, val);
  }


  /**
   * The casing in the batch, if a batch draws this line and it has a casing
   * @return The batch's item, or `null`
   * @readonly
   */
  public get casingItem(): LineBatchItem | null {
    return this._casingItem;
  }


  /**
   * The stroke in the batch, if a batch draws this line
   * @return The batch's item, or `null`
   * @readonly
   */
  public get strokeItem(): LineBatchItem | null {
    return this._strokeItem;
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
    const textureManager = this.gfx.textureManager!;
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

    // Update line markers (oneway arrows, sided markers)
    const showMarkers = (styleZoom >= 16);
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
        const segments = geomLineSegments(points, ONEWAY_SPACING * localScale, false, true);  /* sided = false, limited = true */
        segments.forEach(segment => {
          segment.coords.forEach(([x, y]) => {
            const sprite = new PIXI.Sprite(lineMarkerTexture);
            sprite.eventMode = 'none';
            sprite.sortableChildren = false;
            sprite.anchor.set(0.5, 0.5); // middle, middle
            sprite.position.set(x, y);
            sprite.rotation = segment.angle;
            sprite.scale.set(localScale, localScale);
            sprite.tint = style.lineMarker.color ?? 0x000000;
            lineMarkers!.addChild(sprite);
          });
        });
      }

      // Show side markers (e.g. sided triangles)
      if (sideMarkerTextureID) {
        const sideMarkerTexture = textureManager.getTexture('symbol', sideMarkerTextureID) || PIXI.Texture.WHITE;
        const segments = geomLineSegments(points, SIDED_SPACING * localScale, true, true, 7 * localScale);  /* sided = true, limited = true */
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
    const batch = (this.batch && !this.batch.destroyed && LineBatch.canDraw(style.stroke?.dash) && (!hasCasing || LineBatch.canDraw(casingStyle.dash))) ? this.batch : null;

    if (batch) {
      this._dropMeshes();
      this._drawBatched(batch, flat[0], origin, hasCasing);

    } else {
      this._dropItems();
      this._drawMeshes(flat[0], hasCasing, styleZoom, localScale, isWireframe);
    }
    this._meshPart = this._geom;

    this._geomDirty = false;
    this._styleDirty = false;

    this.updateHalo(viewport);
    this.scene.featureChanged(this);
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
   * Draws the casing and the stroke in a batch: each is a run of vertices there, written when
   * the line or its cap or join changes. The batch's shader works out their width at every zoom,
   * so a zoom alone changes nothing here.
   * @param batch - The batch
   * @param coords - The line's points as `[x, y, x, y, …]`, in container-local space
   * @param origin - Where those coordinates start, in the world's
   * @param hasCasing - Whether the style has a casing that can be seen
   */
  protected _drawBatched(batch: LineBatch, coords: number[], origin: Vec2, hasCasing: boolean): void {
    const style = this._style;
    const strokeStyle = style.stroke;
    const hasStroke = !!strokeStyle && strokeStyle.opacity !== 0;
    const isSameLine = (this._meshPart === this._geom);

    // Only the zoom or the rotation changed, and the batch has the line as it is: nothing to do.
    // (This runs for every line after a zoom, so it makes no objects.)
    if (isSameLine && this.onlyTransformDirty &&
      (hasCasing ? this._casingItem?.batch === batch : !this._casingItem) &&
      (hasStroke ? this._strokeItem?.batch === batch : !this._strokeItem)
    ) {
      return;
    }

    const order = this.container.zIndex;
    const dx = origin[0] - batch.position.x;
    const dy = origin[1] - batch.position.y;
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

      if (item?.batch === batch && isSameLine && this._casingShape === shape) {
        if (isRestyled) batch.setStyle(item, lineStyle);
        batch.setOrder(item, order);
      } else {
        built = geomStrokeMesh(coords, { cap: cap, join: join, closed: closed });
        builtShape = shape;
        if (item?.batch === batch) {
          batch.setStroke(item, built, dx, dy);
          batch.setStyle(item, lineStyle);
          batch.setOrder(item, order);
        } else {
          item?.batch?.remove(item);
          this._casingItem = batch.add(built, dx, dy, lineStyle, order);
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

      if (item?.batch === batch && isSameLine && this._strokeShape === shape) {
        if (isRestyled) batch.setStyle(item, lineStyle);
        batch.setOrder(item, order + STROKE_ORDER);
      } else {
        if (builtShape !== shape) {
          built = geomStrokeMesh(coords, { cap: cap, join: join, closed: closed });
        }
        if (item?.batch === batch) {
          batch.setStroke(item, built!, dx, dy);
          batch.setStyle(item, lineStyle);
          batch.setOrder(item, order + STROKE_ORDER);
        } else {
          item?.batch?.remove(item);
          this._strokeItem = batch.add(built!, dx, dy, lineStyle, order + STROKE_ORDER);
        }
        this._strokeShape = shape;
      }
    } else if (this._strokeItem) {
      this._strokeItem.batch?.remove(this._strokeItem);
      this._strokeItem = null;
    }

    // (A line that was hidden while it changed is shown again: `update()` made it visible before this.)
    if (this._casingItem) batch.setVisible(this._casingItem, true);
    if (this._strokeItem) batch.setVisible(this._strokeItem, true);
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
  public updateHalo(viewport: Viewport): void {
    const showHover = (this.visible && this._classes.has('hover'));
    const showSelect = (this.visible && this._classes.has('select'));
    const showHighlight = (this.visible && this._classes.has('highlight'));

    // Hover
    if (showHover) {
      if (!this.container.filters) {
        const glow = new GlowFilter({ distance: 15, outerStrength: 3, color: 0xffff00 });
        glow.resolution = 2;
        this.container.filters = [glow];
      }
    } else if (showHighlight) {
      if (!this.container.filters) {
        const glow = new GlowFilter({ distance: 15, outerStrength: 3, color: 0x7092ff });
        glow.resolution = 2;
        this.container.filters = [glow];
      }
    } else {
      if (this.container.filters) {
        this.container.filters = null!;
      }
    }

    // Select
    if (showSelect && this._hitArea) {
      const mapui = this.scene.layers.get('map-ui') as PixiLayerMapUI;
      const haloParent = mapui.halo;
      if (!haloParent) return;

      if (!this.halo) {
        this.halo = new PIXI.Container();
        this.halo.label = `${this.id}-halo`;
        this.halo.eventMode = 'none';
        haloParent.addChild(this.halo);
      } else if (this.halo.parent !== haloParent) {
        this.halo.parent?.removeChild(this.halo);
        haloParent.addChild(this.halo);
      }

      // Have the halo transform mimic the container transform.
      // This means that the halo is drawn in _world_ coordinates.
      this.halo.position = this.container.position;
      this.halo.rotation = this.container.rotation;
      this.halo.scale = this.container.scale;

      // The halo is the edge of the hit area: a ring around an open line, and one on each
      // side of a line that ends where it starts.
      const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
      const outline = this._hitArea.outline(HALO_SHAPE);
      const rings = outline.inner ? [outline.outer, outline.inner] : [outline.outer];
      drawHalo(this.halo, rings, localScale, this.gfx.textureManager!);

    } else {
      if (this.halo) {
        this.halo.destroy({ children: true });
        this.halo = null;
      }
    }
  }

}
