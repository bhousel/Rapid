import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { lineToPoly, type LineToPolyResult } from './helpers.ts';
import { WORLD_ZOOM, vecEqual, vecLength } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';

const PARTIALFILLWIDTH = 32;

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;

/** SSR (smallest surrounding rectangle) data for a polygon */
interface SSRData {
  screenSSR: any;
  worldSSR: any;
  worldSSRHeight: Vec2[];
  worldSSRWidth: Vec2[];
  worldSSRCenter: Vec2;
  shapeType: 'square' | 'circle';
}


/**
 *
 * Properties you can access:
 *   `geom`       PixiGeometryPart() class containing all the information about the geometry
 *   `style`      Object containing styling data
 *   `container`  PIXI.Container containing the display objects used to draw the polygon
 *   `lowRes`     PIXI.Sprite for a replacement graphic to display at low resolution
 *   `fill`       PIXI.Graphic for the fill (below)
 *   `stroke`     PIXI.Graphic for the stroke (above)
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
  /** Debug SSR graphics (optional) */
  debugSSR?: PIXI.Graphics | null;

  /** SSR data for low-res rendering */
  private _ssrdata: SSRData | null;
  /** Buffer polygon data for hit testing and halo */
  private _bufferdata: LineToPolyResult | null;
  /** Vertex count for Rapid#1636 workaround */
  private _vertexCount: number;

  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._ssrdata = null;
    this._bufferdata = null;
    this._vertexCount = 0;  // we will watch these for Rapid#1636

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

    // Debug SSR
    // const debugSSR = new PIXI.Graphics();
    // debugSSR.label = 'ssr';
    // debugSSR.eventMode = 'none';
    // debugSSR.sortableChildren = false;
    // this.debugSSR = debugSSR;
    // this.container.addChild(debugSSR);
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
    if (this.debugSSR) {
      this.debugSSR.destroy();
      this.debugSSR = null;
    }

    this._ssrdata = null;
    this._bufferdata = null;

    super.destroy();
  }


  /**
   * @param viewport - Pixi viewport to use for rendering
   */
  update(viewport: Viewport): void {
    if (!this.dirty) return;  // nothing to do

    if (this._geom) {  // GeometryPart path
      this.updateWorld(viewport);
      this.geom.dirty = false;
      return;
    }
    // else PixiGeometryPart path...

    const context = this.context;
    const storage = context.systems.storage;
    const map = context.systems.map;
    const isWireframeMode = map?.wireframeMode;
    const bearing = context.viewport.transform.rotation;
    const geom = this.geom;
    let screen: typeof geom.screen;

    //
    // GEOMETRY
    //
    if (geom.dirty) {
      geom.update(viewport);

      screen = geom.screen;
      if (!screen) return;  // can't render anything without screen coords

      // Redo ssr (move more of this into PixiGeometryPart later)
      this._ssrdata = null;

      // We use the SSR to approximate a low resolution polygon at low zooms
      if (screen.ssr?.polygon) {
        // Calculate axes of symmetry to determine width, height
        // The shape's surrounding rectangle has 2 axes of symmetry.
        //
        //       0
        //   p1 /\              p1 = midpoint of poly[0]-poly[1]
        //     /\ \ q2          q1 = midpoint of poly[2]-poly[3]
        //   1 \ \/\
        //      \/\ \ 3         p2 = midpoint of poly[1]-poly[2]
        //    p2 \ \/           q2 = midpoint of poly[3]-poly[0]
        //        \/ q1
        //        2

        const poly = screen.ssr.polygon;  // note: wound counterclockwise
        const p1: Vec2 = [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2 ];
        const q1: Vec2 = [(poly[2][0] + poly[3][0]) / 2, (poly[2][1] + poly[3][1]) / 2 ];
        const p2: Vec2 = [(poly[3][0] + poly[0][0]) / 2, (poly[3][1] + poly[0][1]) / 2 ];
        const q2: Vec2 = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2 ];
        // axis1 (p1→q1) is perpendicular to `angle` — this is the SSR's height
        // axis2 (p2→q2) is along `angle` — this is the SSR's width
        const height = [p1, q1];
        const width = [p2, q2];
        const center: Vec2 = [ (p1[0] + q1[0]) / 2, (p1[1] + q1[1]) / 2 ];

        // Pick an appropriate lowRes sprite for this shape
        // Are any SSR corners part of the shape?
        const EPSILON = 0.1;
        let c0in: boolean | undefined;
        let c1in: boolean | undefined;
        let c2in: boolean | undefined;
        let c3in: boolean | undefined;
        const outer = (screen.coords as Vec2[][])[0];
        outer.forEach((point: Vec2) => {
          if (!c0in) c0in = vecEqual(point, poly[0], EPSILON);
          if (!c1in) c1in = vecEqual(point, poly[1], EPSILON);
          if (!c2in) c2in = vecEqual(point, poly[2], EPSILON);
          if (!c3in) c3in = vecEqual(point, poly[3], EPSILON);
        });
        const cornersInSSR = c0in || c1in || c2in || c3in;

        this._ssrdata = {
          screenSSR: geom.screen!.ssr,
          worldSSR: geom.world!.ssr,
          worldSSRHeight: height.map(coord => viewport.screenToWorld(coord)),
          worldSSRWidth: width.map(coord => viewport.screenToWorld(coord)),
          worldSSRCenter: viewport.screenToWorld(center),
          shapeType: (cornersInSSR ? 'square' : 'circle')
        };
      }
    }


    //
    // STYLE
    //
    screen = geom.screen;
    if (!screen) return;  // can't render anything without screen coords

    const w = screen.width ?? 0;
    const h = screen.height ?? 0;

    const style = this._style;
    const textureManager = this.gfx.textureManager!;
    const color = style.fill?.color ?? 0xaaaaaa;
    const opacity = style.fill?.opacity ?? 0.3;
    const pattern = style.fill?.pattern;
    const dash = style.stroke?.dash ?? null;

    const fillPreference = storage?.getItem('area-fill') ?? 'partial';
    let doFullFill = (style.fill?.type ?? fillPreference) === 'full';

    const lowRes = this.lowRes!;
    const fill = this.fill!;
    let mask = this.mask!;   // Rapid#1636, see below - we may need to replace the mask
    const maskSource = this.maskSource!;
    const strokes = this.strokes!;

    let texture = pattern && textureManager.getPatternTexture(pattern) || PIXI.Texture.WHITE;    // WHITE turns off the texture
    // textureSpace:'global' tiles the pattern at consistent world-space density rather than stretching it per shape.
    const textureMatrix = new PIXI.Matrix().rotate(-bearing);  // keep patterns face up
// bhousel update 5/27/22:
// I've noticed that we can't use textures from a spritesheet for patterns,
// and it would be nice to figure out why


    // If this shape is so small that partial filling makes no sense, fill fully (faster?)
    const cutoff = (2 * PARTIALFILLWIDTH) + 5;
    if (w < cutoff || h < cutoff) {
      doFullFill = true;
    }
    // If this shape is so small that texture filling makes no sense, skip it (faster?)
// bhousel update 5/27/22:
// I actually now think this doesn't matter and, if anything, using different
// textures may break up the batches.  Eventually we'll introduce some containers
// so that the scene is sorted by style, and we'll try to just keep similarly
// textured things together to improve batching performance.
    if (w < PARTIALFILLWIDTH || h < PARTIALFILLWIDTH) {
      texture = PIXI.Texture.WHITE;
    }

    // Cull really tiny shapes
    if (w < 4 && h < 4) {  // so tiny
      this.lod = 0;  // off
      this.visible = false;
      lowRes.visible = false;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

    // Very small, swap with lowRes sprite
    } else if (this._ssrdata && (w < 20 && h < 20)) {
      this.lod = 1;  // simplified
      this.visible = true;
      lowRes.visible = true;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

      const ssrdata = this._ssrdata;
      const filling = isWireframeMode ? '-unfilled' : '';
      const textureName = `lowres${filling}-${ssrdata.shapeType}`;
      const [x, y] = viewport.worldToScreen(ssrdata.worldSSRCenter);
      const rotation = ssrdata.worldSSR.angle;
      const axis1 = ssrdata.worldSSRHeight.map(coord => viewport.worldToScreen(coord));
      const axis2 = ssrdata.worldSSRWidth.map(coord => viewport.worldToScreen(coord));
      // axis1 (p1→q1) is perpendicular to `angle` — this is the SSR's height
      // axis2 (p2→q2) is along `angle` — this is the SSR's width
      const w = vecLength(axis2[0], axis2[1]);
      const h = vecLength(axis1[0], axis1[1]);

      lowRes.texture = textureManager.getTexture('symbol', textureName) || PIXI.Texture.WHITE;
      lowRes.position.set(x, y);
      lowRes.scale.set(w / 10, h / 10);   // our sprite is 10x10
      lowRes.rotation = rotation;
      lowRes.tint = color;

    } else {
      this.lod = 2;  // full
      this.visible = true;
      lowRes.visible = false;
      fill.visible = !isWireframeMode;
      mask.visible = !isWireframeMode;
      strokes.visible = true;
    }

    //
    // redraw the shapes
    //
    const rings = (screen.flatCoords || []) as number[][];  // outer, followed by holes if any
    this._bufferdata = null;

    // STROKES
    strokes.removeChildren();
    if (strokes.visible && rings.length) {
      strokes.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const lineWidth = isWireframeMode ? 1 : style.fill?.width || 2;
      const strokeStyle: StrokeStyleWithDash = {
        alpha: 1,
        alignment: 0.5,  // middle of line
        color: color,
        width: lineWidth,
        cap: 'butt',
        join: 'miter'
      };
      const bufferStyle: PIXI.StrokeStyle = {
        alpha: 1,
        alignment: 0.5,  // middle of line
        color: 0x000000,
        width: lineWidth + 10,
        cap: 'butt',
        join: 'bevel'
      };

      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        const stroke = new PIXI.Graphics();

        if (dash) {
          strokeStyle.dash = dash;
          const dl = new DashLine(this.gfx, stroke, strokeStyle);
          dl
            .poly(ring);

        } else {
          stroke
            .poly(ring)
            .stroke(strokeStyle);
        }

        const buffer = lineToPoly(ring, bufferStyle);
        if (i === 0) {
          this._bufferdata = buffer;  // save outer buffer for later, for the hover halo..
        }

        stroke.hitArea = new PIXI.Polygon(buffer.perimeter);
        stroke.label = `stroke${i}`;
        stroke.sortableChildren = false;
        strokes.addChild(stroke);
      }
    }


    // FILL
    if (fill.visible && rings.length) {
      fill.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const fillStyle: PIXI.FillStyle = {
        color: color,
        alpha: opacity,
        texture: texture,
        matrix: textureMatrix,
        textureSpace: 'global'
      };

      fill.clear();
      for (let i = 0; i < rings.length; i++) {
        fill.poly(rings[i]);
        if (i === 0) {
          fill.fill(fillStyle);
        } else {
          fill.cut();
        }
      }

// bhousel 4/1/26:  Meshes are not supported for
// the new experimental Pixi Canvas renderer yet.
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
          width: PARTIALFILLWIDTH,
          cap: 'butt',
          join: 'bevel'
        };

        // Generate mask around the edges of the shape
        maskSource.clear();
        for (let i = 0; i < rings.length; i++) {
          maskSource.poly(rings[i]);
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
        gpuContext.context = graphicsContext;   // _initContext
        gpuContext.isBatchable = false;

        PIXI.buildContextBatches(graphicsContext, gpuContext);

        // Rapid#1636 - A very weird bug!!
        // There is a crash in the Pixi MeshPipe code that occurs when we create a mesh and then
        //  change its vertices from >200 to <200 or vice versa.
        // We will investigate this more, but for now if we detect this condition, just recreate the Mesh.
// probably fixed now, or just supply uvs
// see https://github.com/pixijs/pixijs/issues/11207
        // console.log('id: ' + this.featureID
        //  + ' coords: ' + this.geom.outer.length
        //  + ' indices: ' + gpuContext.geometryData.indices.length
        //  + ' vertices: ' + gpuContext.geometryData.vertices.length
        // );

        const curr = gpuContext.geometryData.vertices.length;
        const prev = this._vertexCount;
        if (curr > 200 && prev <= 200 || curr <= 200 && prev > 200) {
          this.container.removeChild(mask);
          mask.destroy();

          // console.log('REPLACING THE MASK');
          mask = new PIXI.Mesh({ geometry: new PIXI.MeshGeometry({}) });
          mask.label = 'mask';
          mask.eventMode = 'static';
          this.container.addChild(mask);
          this.mask = mask;
        }
        this._vertexCount = curr;

        mask.geometry = new PIXI.MeshGeometry({
          indices:  new Uint32Array(gpuContext.geometryData.indices),
          positions: new Float32Array(gpuContext.geometryData.vertices),
          uvs: new Float32Array(gpuContext.geometryData.uvs)
        });

        mask.visible = true;
        fill.mask = mask;
      }
    }

    // Debug SSR
    // this.debugSSR.clear();
    // if (this._ssrdata) {
    //   const p = this._ssrdata.screenSSR.polygon;
    //   const ssrflat = [
    //     p[0][0], p[0][1],
    //     p[1][0], p[1][1],
    //     p[2][0], p[2][1],
    //     p[3][0], p[3][1],
    //     p[0][0], p[0][1]
    //   ];
    //
    //   this.debugSSR
    //     .poly(ssrflat, true)
    //     .stroke({ width: 2, color: 0x00ff00 });
    // }

    this._styleDirty = false;

    this.updateHalo(viewport);
  }


  /**
   * Polygon update path that draws from world coordinates (WORLD_ZOOM=16).
   * The feature's container sits inside the `world` Pixi container which provides
   * the position + scale mapping world coords -> screen. Vertices are pulled from
   * `_geom.local.coords` (origin-relative cache) so we don't recompute the
   * subtraction every frame.
   * @param viewport - Pixi viewport to use for rendering
   */
  updateWorld(viewport: Viewport): void {
    if (!this._geom) return;  // wrong path?

    const context = this.context;
    const storage = context.systems.storage;
    const map = context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const isWireframe = !!map?.wireframeMode;
    const bearing = context.viewport.transform.rotation;
    const textureManager = this.gfx.textureManager!;
    const container = this.container;

    const type = this._geom.type;
    const world = this._geom.world;
    const local = this._geom.local;
    const rings = local?.coords as Vec2[][];

    // Not a polygon, or no world coordinate data?
    if (type !== 'Polygon' || !world || !local || !rings?.length || !rings[0].length) {
      this.lod = 0;
      this.visible = false;
      this.geom.dirty = false;
      this._styleDirty = false;
      return;
    }

    // Position the container at the world origin (extent center). All vertices
    // in `local.coords` are already relative to this origin.
    const origin = world.origin!;
    container.position.set(origin[0], origin[1]);

    // Compute screen-pixel width/height from the local extent.
    // local.extent is in world units; multiply by worldScale to get screen pixels.
    const worldScale = 2 ** (viewZoom - WORLD_ZOOM);
    const localScale = 1 / worldScale;  // or, 2^(WORLD_ZOOM - viewZoom)
    const localExt = local.extent;
    const localW = localExt.max[0] - localExt.min[0];
    const localH = localExt.max[1] - localExt.min[1];
    const w = localW * worldScale;
    const h = localH * worldScale;

    const style = this._style;
    const color = style.fill?.color ?? 0xaaaaaa;
    const opacity = style.fill?.opacity ?? 0.3;
    const pattern = style.fill?.pattern;
    const dash = style.stroke?.dash ?? null;

    const fillPreference = storage?.getItem('area-fill') ?? 'partial';
    let doFullFill = (style.fill?.type ?? fillPreference) === 'full';

    const lowRes = this.lowRes!;
    const fill = this.fill!;
    let mask = this.mask!;   // Rapid#1636, see below - we may need to replace the mask
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
    if (w < cutoff || h < cutoff) {
      doFullFill = true;
    }
    // If this shape is so small that texture filling makes no sense, skip it (faster?)
    if (w < PARTIALFILLWIDTH || h < PARTIALFILLWIDTH) {
      texture = PIXI.Texture.WHITE;
    }

    // Cull really tiny shapes
    if (w < 4 && h < 4) {  // so tiny
      this.lod = 0;
      this.visible = false;
      lowRes.visible = false;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

    // Very small, swap with lowRes sprite
    } else if (local.ssr && (w < 20 && h < 20)) {
      this.lod = 1;
      this.visible = true;
      lowRes.visible = true;
      fill.visible = false;
      mask.visible = false;
      strokes.visible = false;

      // SSR data is in local coords. The center is the midpoint of opposite midpoints.
      // axis1 (p1->q1) is perpendicular to angle (the SSR's height direction)
      // axis2 (p2->q2) is along angle (the SSR's width direction)
      const poly = local.ssr.polygon;
      const p1: Vec2 = [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2];
      const q1: Vec2 = [(poly[2][0] + poly[3][0]) / 2, (poly[2][1] + poly[3][1]) / 2];
      const p2: Vec2 = [(poly[3][0] + poly[0][0]) / 2, (poly[3][1] + poly[0][1]) / 2];
      const q2: Vec2 = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2];
      const center: Vec2 = [(p1[0] + q1[0]) / 2, (p1[1] + q1[1]) / 2];

      // Lengths in world units; the container's worldScale will convert to screen pixels.
      const heightWorld = vecLength(p1, q1);
      const widthWorld = vecLength(p2, q2);

      // Decide shape: are any SSR corners on the outer ring?
      // Use a small epsilon in world units (the legacy code used 0.1 screen px).
      const EPSILON = 0.1 * localScale;
      const outer = local.outer!;
      let c0in: boolean | undefined;
      let c1in: boolean | undefined;
      let c2in: boolean | undefined;
      let c3in: boolean | undefined;
      for (const point of outer) {
        if (!c0in) c0in = vecEqual(point, poly[0], EPSILON);
        if (!c1in) c1in = vecEqual(point, poly[1], EPSILON);
        if (!c2in) c2in = vecEqual(point, poly[2], EPSILON);
        if (!c3in) c3in = vecEqual(point, poly[3], EPSILON);
        if (c0in && c1in && c2in && c3in) break;
      }
      const cornersInSSR = c0in || c1in || c2in || c3in;
      const shapeType: 'square' | 'circle' = cornersInSSR ? 'square' : 'circle';

      const filling = isWireframe ? '-unfilled' : '';
      const textureName = `lowres${filling}-${shapeType}`;

      lowRes.texture = textureManager.getTexture('symbol', textureName) || PIXI.Texture.WHITE;
      lowRes.position.set(center[0], center[1]);
      // Source sprite is 10x10. Container worldScale will scale it. To display
      // at (widthWorld * worldScale) screen px, the sprite scale must be widthWorld/10.
      lowRes.scale.set(widthWorld / 10, heightWorld / 10);
      lowRes.rotation = local.ssr.angle;
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
    // Build flat number[] arrays per ring (in local coords) for poly() / lineToPoly()
    const flatRings: number[][] = new Array(rings.length);
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      const flat = new Array(ring.length * 2);
      for (let j = 0; j < ring.length; j++) {
        flat[j * 2] = ring[j][0];
        flat[j * 2 + 1] = ring[j][1];
      }
      flatRings[i] = flat;
    }

    this._bufferdata = null;
    container.hitArea = null;

    // STROKES
    strokes.removeChildren();
    if (strokes.visible && flatRings.length) {
      strokes.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const lineWidth = isWireframe ? 1 : style.fill?.width || 2;
      const localStrokeWidth = lineWidth * localScale;
      const localBufWidth = (lineWidth + 10) * localScale;

      const strokeStyle: StrokeStyleWithDash = {
        alpha: 1,
        alignment: 0.5,
        color: color,
        width: localStrokeWidth,
        cap: 'butt',
        join: 'miter'
      };
      const bufferStyle: PIXI.StrokeStyle = {
        alpha: 1,
        alignment: 0.5,
        color: 0x000000,
        width: localBufWidth,
        cap: 'butt',
        join: 'bevel'
      };

      for (let i = 0; i < flatRings.length; i++) {
        const ring = flatRings[i];
        const stroke = new PIXI.Graphics();

        if (dash) {
          // DashLine handles scale conversion internally; pass unscaled dash/width + scale option.
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
          this._bufferdata = buffer;  // save outer buffer for the hover halo + hit area
        }

        stroke.hitArea = new PIXI.Polygon(buffer.perimeter);
        stroke.label = `stroke${i}`;
        stroke.sortableChildren = false;
        strokes.addChild(stroke);
      }
    }

    // Container hit area uses the outer-ring buffer
    if (this._bufferdata && !this._classes.has('drawing')) {
      container.hitArea = new PIXI.Polygon(this._bufferdata.perimeter);
    }

    // FILL
    if (fill.visible && flatRings.length) {
      fill.eventMode = this._classes.has('drawing') ? 'none' : 'static';  // Rapid#648

      const fillStyle: PIXI.FillStyle = {
        color: color,
        alpha: opacity,
        texture: texture,
        matrix: textureMatrix,
        textureSpace: 'global'
      };

      fill.clear();
      for (let i = 0; i < flatRings.length; i++) {
        fill.poly(flatRings[i]);
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
        // Mask stroke width is also in world-local units.
        const localMaskWidth = PARTIALFILLWIDTH * localScale;
        const maskStyle: PIXI.StrokeStyle = {
          alpha: 1,
          color: 0xff0000,
          width: localMaskWidth,
          cap: 'butt',
          join: 'bevel'
        };

        // Generate mask around the edges of the shape
        maskSource.clear();
        for (let i = 0; i < flatRings.length; i++) {
          maskSource.poly(flatRings[i]);
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

        // Rapid#1636 - A very weird bug!! See note in legacy update() path.
        const curr = gpuContext.geometryData.vertices.length;
        const prev = this._vertexCount;
        if (curr > 200 && prev <= 200 || curr <= 200 && prev > 200) {
          this.container.removeChild(mask);
          mask.destroy();

          mask = new PIXI.Mesh({ geometry: new PIXI.MeshGeometry({}) });
          mask.label = 'mask';
          mask.eventMode = 'static';
          this.container.addChild(mask);
          this.mask = mask;
        }
        this._vertexCount = curr;

        mask.geometry = new PIXI.MeshGeometry({
          indices: new Uint32Array(gpuContext.geometryData.indices),
          positions: new Float32Array(gpuContext.geometryData.vertices),
          uvs: new Float32Array(gpuContext.geometryData.uvs)
        });

        mask.visible = true;
        fill.mask = mask;
      }
    }

    this.geom.dirty = false;
    this._styleDirty = false;
    this.updateWorldHalo(viewport);
  }


  /**
   * World-path halo. Draws the select halo as a child of the feature container
   * so it inherits the same world position/scale as the rest of the feature.
   * Widths and dash patterns are expressed in world-local units.
   * @param viewport - Pixi viewport to use for rendering
   */
  updateWorldHalo(viewport: Viewport): void {
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


  /**
   * Show/Hide halo (expects `this._bufferdata` to be already set up by `update()`)
   * @param viewport - Pixi viewport to use for rendering
   */
  updateHalo(viewport: Viewport): void {
    const map = this.context.systems.map;
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
    if (showSelect) {
      const mapui = this.scene.layers.get('map-ui') as PixiLayerMapUI;
      const haloContainer = mapui.halo;
      if (!haloContainer) return;

      if (!this.halo) {
        this.halo = new PIXI.Graphics();
        this.halo.label = `${this.id}-halo`;
        haloContainer.addChild(this.halo);
      } else if (this.halo.parent !== haloContainer) {
        this.halo.parent?.removeChild(this.halo);
        haloContainer.addChild(this.halo);
      }

      const HALO_STYLE = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,
        color: 0xffff00
      };

      const haloGraphics = this.halo as PIXI.Graphics;
      haloGraphics.clear();
      const dl = new DashLine(this.gfx, haloGraphics, HALO_STYLE);
      if (this._bufferdata) {
        dl.poly(this._bufferdata.outer!);
        if (wireframeMode) {
          dl.poly(this._bufferdata.inner!);
        }
      }

    } else {
      if (this.halo) {
        this.halo.destroy();
        this.halo = null;
      }
    }
  }

}
