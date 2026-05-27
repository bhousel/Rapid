import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { lineToPoly, type LineToPolyResult } from './helpers.ts';
import { WORLD_ZOOM, vecEqual } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { Viewport } from '@rapid-sdk/math';

const PARTIALFILLWIDTH = 32;

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;


/**
 *
 * Properties you can access:
 *   `lowRes`     PIXI.Sprite for a replacement graphic to display at low resolution
 *   `fill`       PIXI.Graphic for the fill Graphics (below)
 *   `strokes`    PIXI.Container for the stroke Graphics (above)
 *   `mask`       PIXI.Mesh for the mask (applied to fill)
 *
 *   (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePolygon extends AbstractPixiFeature {
  /** PIXI.Sprite for low resolution representation */
  lowRes: PIXI.Sprite | null;
  /** PIXI.Graphics for the fill (below) */
  fill: PIXI.Graphics | null;
  /** PIXI.Mesh for the mask (applied to fill) */
  mask: PIXI.Mesh | null;
  /** Source graphics for generating mask geometry */
  maskSource: PIXI.Graphics | null;
  /** Container for stroke graphics */
  strokes: PIXI.Container | null;
  /** Debug surrounding rectangle graphics (optional) */
  debugSurround?: PIXI.Graphics | null;

  /** Buffer polygon data for hit testing and halo */
  private _bufferdata: LineToPolyResult | null;


  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._bufferdata = null;

    const lowRes = new PIXI.Sprite();
    lowRes.label = 'lowRes';
    lowRes.anchor.set(0.5, 0.5);  // middle, middle
    lowRes.interactive = false;
    lowRes.eventMode = 'static';
    lowRes.visible = false;
    this.lowRes = lowRes;

    const fill = new PIXI.Graphics();
    fill.label = 'fill';
    fill.eventMode = 'static';
    fill.sortableChildren = false;
    fill.visible = false;
    this.fill = fill;

    // When partially filling areas: we really want to define the mask as a stroke
    // drawn within the inside of the area shape.  Graphics defined as a stroke
    // _can_ be used as a mask, but they do not participate in hit testing!
    // (note: in pixi v8 they now do, but they don't yet respect the `alignment` property)
    // So we'll create the mask graphic and then copy its attributes into a mesh
    // which _does_ hit test properly.
    const mask = new PIXI.Mesh({ geometry: new PIXI.MeshGeometry({}) });
    mask.label = 'mask';
    mask.eventMode = 'static';
    mask.visible = false;
    this.mask = mask;
    this.maskSource = new PIXI.Graphics();  // not added to scene

    const strokes = new PIXI.Container();
    strokes.label = 'strokes';
    strokes.eventMode = 'static';
    strokes.sortableChildren = false;
    strokes.visible = false;
    this.strokes = strokes;

    this.container.addChild(lowRes, fill, strokes, mask);

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
  destroy(): void {
    if (this.lowRes) {
      this.lowRes.destroy();
      this.lowRes = null;
    }
    if (this.fill) {
      this.fill.destroy();
      this.fill = null;
    }
    if (this.mask) {
      this.mask.destroy();
      this.mask = null;
    }
    if (this.maskSource) {
      this.maskSource.destroy();
      this.maskSource = null;
    }
    if (this.strokes) {
      this.strokes.destroy({ children: true });
      this.strokes = null;
    }
    if (this.debugSurround) {
      this.debugSurround.destroy();
      this.debugSurround = null;
    }

    this._bufferdata = null;

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
  update(viewport: Viewport): void {
    if (!this._geom) return;  // wrong path?

    if (!this.dirty) return;  // nothing to do

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
      return;
    }

    const context = this.context;
    const storage = context.systems.storage;
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
    const opacity = style.fill?.opacity ?? 0.3;
    const pattern = style.fill?.pattern;
    const dash = style.stroke?.dash ?? null;

    const fillPreference = storage?.getItem('area-fill') ?? 'partial';
    let doFullFill = (style.fill?.type ?? fillPreference) === 'full';

    const lowRes = this.lowRes!;
    const fill = this.fill!;
    const mask = this.mask!;
    const maskSource = this.maskSource!;
    const strokes = this.strokes!;

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
      lowRes.visible = false;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

    // Very small, swap with lowRes sprite
    } else if (local.surround && (screenW < 20 && screenH < 20)) {
      this.lod = 1;
      this.visible = true;
      lowRes.visible = true;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

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

    } else {
      this.lod = 2;
      this.visible = true;
      lowRes.visible = false;
      fill.visible = !isWireframe;
      mask.visible = !isWireframe;
      strokes.visible = true;
    }

    // Redraw the shapes

    // STROKES
    strokes.removeChildren();
    if (strokes.visible) {
      strokes.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const lineWidth = isWireframe ? 1 : style.fill?.width || 2;
      const strokeStyle: StrokeStyleWithDash = {
        alpha: 1,
        alignment: 0.5,   // middle of line
        color: color,
        width: lineWidth * localScale,
        cap: 'butt',
        join: 'miter'
      };
      const bufferStyle: PIXI.StrokeStyle = {
        alpha: 1,
        alignment: 0.5,   // middle of line
        color: 0x000000,
        width: (lineWidth + 10) * localScale,
        cap: 'butt',
        join: 'bevel'
      };

      for (let i = 0; i < flat.length; i++) {
        const ring = flat[i];
        const stroke = new PIXI.Graphics();

        if (dash) {
          const dashOptions: StrokeStyleWithDash = {
            ...strokeStyle,
            width: lineWidth,
            dash: dash,
            scale: localScale
          };
          const dl = new DashLine(this.gfx, stroke, dashOptions);
          dl.poly(ring);
        } else {
          stroke.poly(ring).stroke(strokeStyle);
        }

        const buffer = lineToPoly(ring, bufferStyle);
        if (i === 0) {
          this._bufferdata = buffer;  // save outer buffer for the hover halo.
        }

        stroke.hitArea = new PIXI.Polygon(buffer.perimeter);
        stroke.label = `stroke${i}`;
        stroke.sortableChildren = false;
        strokes.addChild(stroke);
      }
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

      fill.clear();
      for (let i = 0; i < flat.length; i++) {
        fill.poly(flat[i]);
        if (i === 0) {
          fill.fill(fillStyle);
        } else {
          fill.cut();
        }
      }

      // bhousel 4/1/26: Meshes are not supported for the new experimental Pixi
      // Canvas renderer yet.
      const renderer = this.gfx!.pixi!.renderer;
      if (renderer.type === PIXI.RendererType.CANVAS) {
        doFullFill = true;
      }

      if (doFullFill) {
        mask.visible = false;
        fill.mask = null;

      } else {  // partial fill
        const maskStyle: PIXI.StrokeStyle = {
          alpha: 1,
          color: 0xff0000,
          width: PARTIALFILLWIDTH * localScale,
          cap: 'butt',
          join: 'bevel'
        };

        // Generate mask around the edges of the shape
        maskSource.clear();
        for (let i = 0; i < flat.length; i++) {
          maskSource.poly(flat[i]);
          if (i === 0) {               // outer
            maskStyle.alignment = 1;   // left
            maskSource.stroke(maskStyle);
          } else {                     // holes
            maskStyle.alignment = 0;   // right
            maskSource.stroke(maskStyle);
          }
        }

        // Compute the mask's geometry, then copy its attributes into the mesh's geometry
        // This lets us use the Mesh as the mask and properly hit test against it.
        const graphicsContext = maskSource.context;
        const gpuContext = new PIXI.GpuGraphicsContext();
        gpuContext.context = graphicsContext;
        gpuContext.isBatchable = false;

        PIXI.buildContextBatches(graphicsContext, gpuContext);

        mask.geometry = new PIXI.MeshGeometry({
          indices: new Uint32Array(gpuContext.geometryData.indices),
          positions: new Float32Array(gpuContext.geometryData.vertices),
          uvs: new Float32Array(gpuContext.geometryData.uvs)
        });

        mask.visible = true;
        fill.mask = mask;
      }
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
  }


  /**
   * @param viewport - Pixi viewport to use for rendering
   */
  updateHalo(viewport: Viewport): void {
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
    if (showSelect && this._bufferdata) {
      const mapui = this.scene.layers.get('map-ui') as PixiLayerMapUI;
      const haloParent = mapui.halo;
      if (!haloParent) return;

      if (!this.halo) {
        this.halo = new PIXI.Graphics();
        this.halo.label = `${this.id}-halo`;
        (this.halo as PIXI.Graphics).eventMode = 'none';
        haloParent.addChild(this.halo);
      } else if (this.halo.parent !== this.container) {
        this.halo.parent?.removeChild(this.halo);
        haloParent.addChild(this.halo);
      }

      // Have the halo transform mimic the container transform.
      // This means that the halo is drawn in _world_ coordinates.
      this.halo.position = this.container.position;
      this.halo.rotation = this.container.rotation;
      this.halo.scale = this.container.scale;

      const localScale = 2 ** (WORLD_ZOOM - viewZoom);
      const HALO_STYLE: StrokeStyleWithDash = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,
        scale: localScale,
        color: 0xffff00
      };

      (this.halo as PIXI.Graphics).clear();

      const dl = new DashLine(this.gfx, this.halo as PIXI.Graphics, HALO_STYLE);
      if (this._bufferdata.outer) {
        dl.poly(this._bufferdata.outer);
      }
      if (wireframeMode && this._bufferdata.inner) {
        dl.poly(this._bufferdata.inner);
      }

    } else {
      if (this.halo) {
        this.halo.destroy();
        this.halo = null;
      }
    }
  }

}
