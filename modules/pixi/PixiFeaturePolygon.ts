import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { GlowFilter } from 'pixi-filters';
import { LineHitArea } from './lib/LineHitArea.ts';
import { LineMesh } from './lib/LineMesh.ts';
import { drawHalo } from './helpers.ts';
import { geomAreaBand, geomStrokeMesh, geomStrokeOutline } from '../geo/index.ts';
import { WORLD_ZOOM, vecEqual } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { BandPolygon } from '../geo/band.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { Viewport } from '@rapid-sdk/math';

const PARTIALFILLWIDTH = 32;
const INRADIUS_PRECISION = 1;   // a polygon's `inradius` may be this much short of the truth (see `GeometryPart`)
const HIT_PADDING = 10;   // pixels around an outline's width that still hit it, and where its halo is drawn


/**
 * This class renders a Polygon feature.
 *
 * A partial fill fills a band along the inside of the polygon's edge, 32 pixels wide. The band
 * is real geometry (`geomAreaBand()`): the `fill` draws its polygons, and a click hits them.
 * There's no stencil mask. Most polygons are too narrow to have a middle that the band leaves
 * empty, and are filled whole (see `_bandFor`, and `design/graphics-system.md` section 15).
 *
 * Properties available:
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

    this._meshPart = null;
    this._band = null;
    this._bandPart = null;

    super.destroy();
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

    // Cull really tiny shapes
    if (screenW < 4 && screenH < 4) {  // so tiny
      this.lod = 0;
      this.visible = false;
      this._dropLowRes();
      this._dropShapes();

    // Very small, swap with lowRes sprite
    } else if (local.surround && (screenW < 20 && screenH < 20)) {
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
      this.lod = 2;
      this.visible = true;
      this._dropLowRes();
      this._needShapes();
    }

    // Redraw the shapes. (Only the full level of detail has any.)
    if (this.lod === 2) {
      this._drawShapes(viewport, texture, textureMatrix, doFullFill);
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
    const outer = this._geom?.local?.flat?.[0];
    if (showSelect && outer?.length) {
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

      // The halo follows the outer ring, as far outside it as a hit can be (see `_drawShapes`),
      // and inside it too in wireframe, where there's no fill to hit.
      const localScale = 2 ** (WORLD_ZOOM - viewZoom);
      const lineWidth = wireframeMode ? 1 : this._style.fill?.width || 2;
      const distance = (lineWidth + HIT_PADDING) * localScale / 2;
      const outline = geomStrokeOutline(outer, distance, { closed: true, join: 'round' });
      const rings = (wireframeMode && outline.inner) ? [outline.outer, outline.inner] : [outline.outer];
      drawHalo(this.halo, rings, localScale, this.gfx.textureManager!);

    } else {
      if (this.halo) {
        this.halo.destroy({ children: true });
        this.halo = null;
      }
    }
  }

}
