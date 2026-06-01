import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { getLineSegments, lineToPoly, type LineToPolyResult } from './helpers.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';


const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;


/**
 *
 * Properties you can access:
 *   `casing`     PIXI.Graphic for the casing (below)
 *   `stroke`     PIXI.Graphic for the stroke (above)
 *
 *   (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeatureLine extends AbstractPixiFeature {
  /** PIXI.Graphics for the casing (below) */
  public casing: PIXI.Graphics | null;
  /** PIXI.Graphics for the stroke (above) */
  public stroke: PIXI.Graphics | null;

  /** Buffer polygon data for hit testing and halo */
  protected _bufferdata: LineToPolyResult | null;

  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._bufferdata = null;

    const casing = new PIXI.Graphics();
    casing.label = 'casing';
    casing.eventMode = 'none';
    casing.sortableChildren = false;
    this.casing = casing;

    const stroke = new PIXI.Graphics();
    stroke.label = 'stroke';
    stroke.eventMode = 'none';
    stroke.sortableChildren = false;
    this.stroke = stroke;

    this.container.addChild(casing, stroke);
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

    this._bufferdata = null;

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
      return;
    }

    // The container lives under the `world` Pixi container (in GraphicsSystem),
    // which provides the position + scale that maps world coords -> screen.
    // Set container.position to the feature's world origin (extent center) and
    // draw vertices using `local.coords` (already origin-relative).
    const origin = world.origin!;
    container.position.set(origin[0], origin[1]);

    this.visible = true;
    this.stroke!.renderable = true;

    if (styleZoom < 16) {
      this.lod = 1;
      this.casing!.renderable = false;
    } else {
      this.lod = 2;
      this.casing!.renderable = true;
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
      lineMarkers.removeChildren();

      // Show line markers (e.g. oneway arrows)
      if (lineMarkerTextureID) {
        const lineMarkerTexture = textureManager.getTexture('symbol', lineMarkerTextureID) || PIXI.Texture.WHITE;
        const segments = getLineSegments(points, ONEWAY_SPACING * localScale, false, true);  /* sided = false, limited = true */
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
        const segments = getLineSegments(points, SIDED_SPACING * localScale, true, true, 7 * localScale);  /* sided = true, limited = true */
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
      this._bufferdata = lineToPoly(flat[0], bufferStyle);
      container.hitArea = new PIXI.Polygon(this._bufferdata.perimeter);
    } else {
      this._bufferdata = null;
      container.hitArea = null;
    }

    if (this.casing!.renderable) {
      this.updateGraphic('casing', this.casing!, points, styleZoom, viewZoom, isWireframe);
    } else {
      this.casing!.clear();
    }
    if (this.stroke!.renderable) {
      this.updateGraphic('stroke', this.stroke!, points, styleZoom, viewZoom, isWireframe);
    } else {
      this.stroke!.clear();
    }

    this._geomDirty = false;
    this._styleDirty = false;

    this.updateHalo(viewport);
  }


  /**
   * Draws a world-coordinate line graphic.
   * Points are in container-local space (z16 world coords minus the feature's
   * world origin) — i.e. `GeometryPart.local.coords`. They can be drawn directly
   * without further translation.
   * Stroke widths are expressed in world local units: `px × 2^(WORLD_ZOOM - viewZoom)`.
   * @param which - Style part to draw ('casing' or 'stroke')
   * @param graphic - PIXI graphics object to update
   * @param points - Local coordinate points (origin-relative, from `local.coords`)
   * @param styleZoom - Effective zoom, used for styling
   * @param viewZoom - Viewport zoom, used for scaling
   * @param isWireframe - Whether wireframe mode is active
   */
  public updateGraphic(
    which: 'casing' | 'stroke',
    graphic: PIXI.Graphics,
    points: Vec2[],
    styleZoom: number,
    viewZoom: number,
    isWireframe: boolean
  ): void {
    const style = this._style;
    const partStyle = style[which];
    if (!partStyle) return;

    const minwidth = which === 'casing' ? 3 : 2;
    let width = partStyle.width || 3;

    // Narrow at lower zooms
    if (styleZoom < 16) {
      width -= 4;
    } else if (styleZoom < 17) {
      width -= 2;
    }
    if (width < minwidth) {
      width = minwidth;
    }

    if (isWireframe) {
      width = 1;
    }

    // Convert screen pixel values to world units
    const scale = 2 ** (WORLD_ZOOM - viewZoom);

    let g: PIXI.Graphics | DashLine = graphic.clear();
    if (partStyle?.opacity === 0) return;  // remove completely

    const strokeStyle: StrokeStyleWithDash = {
      color: partStyle.color,
      width: width * scale,
      alpha: partStyle.opacity ?? 1.0,
      join: partStyle.join,
      cap:  partStyle.cap,
      dash: undefined as number[] | undefined
    };

    if (partStyle.dash) {
      // DashLine handles the scale conversion internally for dash sizes and width,
      // so pass unscaled values + the `scale` option (single source of truth).
      const dashOptions: StrokeStyleWithDash = {
        ...strokeStyle,
        width: width,
        dash: partStyle.dash,
        scale: scale
      };
      g = new DashLine(this.gfx, graphic, dashOptions);
      drawLine(points, g);
    } else {
      drawLine(points, g as PIXI.Graphics);
      (g as PIXI.Graphics).stroke(strokeStyle);
    }

    /**
     *
     * @param points
     * @param graphics
     */
    function drawLine(points: Vec2[], graphics: PIXI.Graphics | DashLine): void {
      points.forEach(([x, y], i) => {
        if (i === 0) {
          graphics.moveTo(x, y);
        } else {
          graphics.lineTo(x, y);
        }
      });
    }
  }


  /**
   * Show/Hide halo (expects `this._bufferdata` to be already set up by `update()`)
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
    if (showSelect && this._bufferdata) {
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
      if (this._bufferdata.outer && this._bufferdata.inner) {   // closed line
        dl.poly(this._bufferdata.outer);
        dl.poly(this._bufferdata.inner);
      } else {   // unclosed line
        dl.poly(this._bufferdata.perimeter);
      }

    } else {
      if (this.halo) {
        this.halo.destroy();
        this.halo = null;
      }
    }
  }

}
