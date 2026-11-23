import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { BufferHitArea } from './lib/BufferHitArea.ts';
import { LineMesh } from './lib/LineMesh.ts';
import { geomLineSegments, geomStrokeMesh } from '../geo/index.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { LineStyleProps } from '../lib/Style.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { StrokeMesh } from '../geo/stroke.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';


const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;


/**
 * This class renders a Line feature.
 *
 * The casing and the stroke are drawn from a stroke mesh (`geomStrokeMesh()`), which has the
 * line's triangles for any width. It's built when the line or its cap or join changes; a zoom
 * only works out where the vertices are for the new width (see `LineMesh`, and
 * `design/graphics-system.md` section 15).
 *
 * Properties available:
 * - `casing`     - `LineMesh` for the casing (below), or `null` while there's none to draw
 * - `stroke`     - `LineMesh` for the stroke (above)
 * -  (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeatureLine extends AbstractPixiFeature {

  /** The mesh that draws the casing (below), or null while there's none to draw (see `update`) */
  public casing: LineMesh | null;
  /** The mesh that draws the stroke (above) */
  public stroke: LineMesh | null;

  /** Buffer polygon data for hit testing and halo */
  protected _hitBuffer: BufferHitArea | null;
  /** The line that the stroke meshes of the casing and the stroke were built from */
  protected _meshPart: GeometryPart | null;


  /**
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._hitBuffer = null;
    this._meshPart = null;

    this.casing = null;   // add later only if needed (see `update`)

    const stroke = new LineMesh();
    stroke.label = 'stroke';
    stroke.eventMode = 'none';
    stroke.sortableChildren = false;
    this.stroke = stroke;

    this.container.addChild(stroke);
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    if (this.casing) {
      this.casing.destroy();
      this.casing = null;
    }
    if (this.stroke) {
      this.stroke.destroy();
      this.stroke = null;
    }

    this._hitBuffer = null;
    this._meshPart = null;

    super.destroy();
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

    // The casing is drawn from zoom 16, if the style has one that can be seen. Its mesh
    // exists only then: the lines of the photo and data layers have none, nor has any line
    // below zoom 16.
    const casingStyle = style.casing;
    const showCasing = (styleZoom >= 16) && !!casingStyle && casingStyle.opacity !== 0;
    this.lod = (styleZoom < 16) ? 1 : 2;
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

    // Buffer around line, used for hit area and halo.
    // Build in world-local coords (origin-relative) so the polygon matches the
    // container's local frame. Pixi composes the container transform when
    // hit-testing, so we don't need to project to screen.
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

      const localBufWidth = (bufWidth + 10) * localScale;
      const bufferStyle: PIXI.StrokeStyle = {
        alpha: 1,
        alignment: 0.5,
        color: 0x000000,
        width: localBufWidth,
        cap: 'butt',
        join: 'bevel'
      };
      // (Worked out when the pointer comes near, or for a halo: see `BufferHitArea`)
      this._hitBuffer = new BufferHitArea(flat[0], bufferStyle, local!.extent);
      container.hitArea = this._hitBuffer;
    } else {
      this._hitBuffer = null;
      container.hitArea = null;
    }

    // The casing and the stroke. They keep the stroke mesh they were last drawn from, and share
    // one when they have the same cap and join. Those are only good while the line is the same:
    // a line that changed is a different part.
    const casing = this.casing;
    const stroke = this.stroke!;
    const isSameLine = (this._meshPart === this._geom);
    const oldCasing = isSameLine ? (casing?.strokeMesh ?? null) : null;
    const oldStroke = isSameLine ? stroke.strokeMesh : null;
    if (casing) {
      this._drawPart(casing, style.casing, 3, flat[0], oldCasing, oldStroke, styleZoom, localScale, isWireframe);
    }
    this._drawPart(stroke, style.stroke, 2, flat[0], oldStroke, casing?.strokeMesh ?? null, styleZoom, localScale, isWireframe);
    this._meshPart = this._geom;

    this._geomDirty = false;
    this._styleDirty = false;

    this.updateHalo(viewport);
    this.scene.featureChanged(this);
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
      const last = coords.length - 2;
      const closed = (last >= 6 && coords[0] === coords[last] && coords[1] === coords[last + 1]);
      strokeMesh = geomStrokeMesh(coords, { cap: cap, join: join, closed: closed });
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
   * Show/Hide halo (expects `this._hitBuffer` to be already set up by `update()`)
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
    if (showSelect && this._hitBuffer) {
      const mapui = this.scene.layers.get('map-ui') as PixiLayerMapUI;
      const haloParent = mapui.halo;
      if (!haloParent) return;

      if (!this.halo) {
        this.halo = new PIXI.Graphics();
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

      const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
      const HALO_STYLE: StrokeStyleWithDash = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,
        scale: localScale,
        color: 0xffff00
      };

      (this.halo as PIXI.Graphics).clear();

      const dl = new DashLine(this.gfx, this.halo as PIXI.Graphics, HALO_STYLE);
      const buffer = this._hitBuffer.buffer;
      if (buffer.outer && buffer.inner) {   // closed line
        dl.poly(buffer.outer);
        dl.poly(buffer.inner);
      } else {   // unclosed line
        dl.poly(buffer.perimeter);
      }

    } else {
      if (this.halo) {
        this.halo.destroy();
        this.halo = null;
      }
    }
  }

}
