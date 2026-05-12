import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { getLineSegments, lineToPoly, type LineToPolyResult } from './helpers.ts';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';

const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;


/**
 *
 * Properties you can access:
 *   `geom`       PixiGeometryPart() class containing all the information about the geometry
 *   `points`     Array of projected points in scene coordinates
 *   `style`      Object containing styling data
 *   `container`  PIXI.Container containing the display objects used to draw the line
 *   `casing`     PIXI.Graphic for the casing (below)
 *   `stroke`     PIXI.Graphic for the stroke (above)
 *
 *   (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeatureLine extends AbstractPixiFeature {
  /** PIXI.Graphics for the casing (below) */
  casing: PIXI.Graphics | null;
  /** PIXI.Graphics for the stroke (above) */
  stroke: PIXI.Graphics | null;

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
  destroy(): void {
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
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  update(viewport: Viewport, zoom: number): void {
    if (!this.dirty) return;  // nothing to do

    if (this._geom) {  // GeometryPart path
      this.updateWorld(viewport, zoom);
      this.geom.dirty = false;
      return;
    }
    // else PixiGeometryPart path...

    const map = this.context.systems.map;
    const isWireframe = !!map?.wireframeMode;
    const textureManager = this.gfx.textureManager!;
    const container = this.container;
    const geom = this.geom;
    const style = this._style;
    let screen = geom.screen;

    //
    // GEOMETRY
    //
    if (geom.dirty) {
      geom.update(viewport);

      screen = geom.screen;
      if (!screen) return;  // can't render anything without screen coords
    }

    //
    // STYLE
    //
    if (this._styleDirty) {
      screen = geom.screen;
      if (!screen) return;  // can't render anything without screen coords

      // Apply effectiveZoom style adjustments
      let showMarkers: boolean;

      // Cull really tiny shapes
      if (screen.width! < 4 && screen.height! < 4) {  // so tiny
        this.lod = 0;  // off
        this.visible = false;
        this.stroke!.renderable = false;
        this.casing!.renderable = false;
        showMarkers = false;

      } else {
        this.visible = true;
        this.stroke!.renderable = true;

        if (zoom < 16) {
          this.lod = 1;  // simplified
          this.casing!.renderable = false;
          showMarkers = false;

        } else {
          this.lod = 2;  // full
          this.casing!.renderable = true;
          showMarkers = true;
        }
      }

      //
      // Update line markers, if any..
      // Todo: left/right markers (like for coastlines, retaining walls, etc)
      //
      let lineMarkers = container.getChildByLabel('lineMarkers');
      const lineMarkerTextureID = style.lineMarker.image;
      const sideMarkerTextureID = style.sidedMarker.image;

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
          const segments = getLineSegments(screen.coords as Vec2[], ONEWAY_SPACING, false, true);  /* sided = false, limited = true */

          segments.forEach(segment => {
            segment.coords.forEach(([x, y]) => {
              const sprite = new PIXI.Sprite(lineMarkerTexture);
              sprite.eventMode = 'none';
              sprite.sortableChildren = false;
              sprite.anchor.set(0.5, 0.5); // middle, middle
              sprite.position.set(x, y);
              sprite.rotation = segment.angle;
              sprite.tint = style.lineMarker.color ?? 0x000000;
              lineMarkers!.addChild(sprite);
            });
          });
        }

        // show side markers (e.g. sided triangles)
        if (sideMarkerTextureID) {
          const sideMarkerTexture = textureManager.getTexture('symbol', sideMarkerTextureID) || PIXI.Texture.WHITE;
          const segments = getLineSegments(screen.coords as Vec2[], SIDED_SPACING, true, true);  /* sided = true, limited = true */

          segments.forEach(segment => {
            segment.coords.forEach(([x, y]) => {
              const sprite = new PIXI.Sprite(sideMarkerTexture);
              sprite.eventMode = 'none';
              sprite.sortableChildren = false;
              sprite.anchor.set(0.5, 0.5); // middle, middle
              sprite.position.set(x, y);
              sprite.rotation = segment.angle;
              sprite.tint = style.stroke.color ?? 0xcccccc;
              lineMarkers!.addChild(sprite);
            });
          });
        }

      } else if (lineMarkers) {  // No line markers, remove if it exists
        container.removeChild(lineMarkers);
        lineMarkers.destroy({ children: true });
      }

      // Buffer around line, used for hit area and halo..
      if (this.visible && !this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
        // what line width to use?? copied the 'casing' calculation from below, improve this later
        const minwidth = 3;
        let width = style.casing.width ?? 5;

        // Apply effectiveZoom style adjustments
        if (zoom < 16) {
          width -= 4;
        } else if (zoom < 17) {
          width -= 2;
        }
        if (width < minwidth) {
          width = minwidth;
        }

        if (isWireframe) {
          width = 1;
        }

        const bufferStyle: PIXI.StrokeStyle = {
          alpha: 1,
          alignment: 0.5,  // middle of line
          color: 0x000000,
          width: width + 10,
          cap: 'butt',
          join: 'bevel'
        };
        this._bufferdata = lineToPoly(screen.flatCoords as number[], bufferStyle);
        this.container.hitArea = new PIXI.Polygon(this._bufferdata.perimeter);
      } else {
        this._bufferdata = null;
        this.container.hitArea = null;
      }

      this._styleDirty = false;
    }


    if (this.casing!.renderable) {
      this.updateGraphic('casing', this.casing!, screen!.coords as Vec2[], zoom, isWireframe);
    }
    if (this.stroke!.renderable) {
      this.updateGraphic('stroke', this.stroke!, screen!.coords as Vec2[], zoom, isWireframe);
    }

    this.updateHalo();
  }


  /**
   * Line update path that draws from world coordinates (WORLD_ZOOM=16).
   * The feature's container sits inside a group with scale `2^(zoom - WORLD_ZOOM)`, so vertex
   * coordinates in world space map directly to screen pixels without per-frame reprojection.
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  updateWorld(viewport: Viewport, zoom: number): void {
    if (!this._geom) return;  // wrong path?

    const map = this.context.systems.map;
    const isWireframe = !!map?.wireframeMode;
    const container = this.container;

    const type = this._geom.type;
    const world = this._geom.world;
    const local = this._geom.local;
    const points = local?.coords as Vec2[];

    // Not a line, or no world coordinate data?
    if (type !== 'LineString' || !world || !local || !points?.length) {
      this.lod = 0;
      this.visible = false;
      this.geom.dirty = false;
      this._styleDirty = false;
      return;
    }

    // The container lives under the `world` Pixi container (in GraphicsSystem),
    // which provides the position + scale that maps world coords -> screen.
    // Set container.position to the feature's world origin (extent center) and
    // draw vertices using `local.coords` (already origin-relative).
    const origin = world.origin!;
    container.position.set(origin[0], origin[1]);

    const lineMarkers = container.getChildByLabel('lineMarkers');
    if (lineMarkers) {
      container.removeChild(lineMarkers);
      lineMarkers.destroy({ children: true });
    }

    this.visible = true;
    this.stroke!.renderable = true;

    if (zoom < 16) {
      this.lod = 1;
      this.casing!.renderable = false;
    } else {
      this.lod = 2;
      this.casing!.renderable = true;
    }

    // Buffer around line, used for hit area and halo.
    // Build in world-local coords (origin-relative) so the polygon matches the
    // container's local frame. Pixi composes the container transform when
    // hit-testing, so we don't need to project to screen.
    if (this.visible && !this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
      const minwidth = 3;
      let bufWidth = this._style.casing.width ?? 5;
      if (zoom < 16) {
        bufWidth -= 4;
      } else if (zoom < 17) {
        bufWidth -= 2;
      }
      if (bufWidth < minwidth) bufWidth = minwidth;
      if (isWireframe) bufWidth = 1;

      const localBufWidth = (bufWidth + 10) * 2 ** (WORLD_ZOOM - zoom);
      const flatLocal: number[] = new Array(points.length * 2);
      for (let i = 0; i < points.length; i++) {
        flatLocal[i * 2]     = points[i][0];
        flatLocal[i * 2 + 1] = points[i][1];
      }
      const bufferStyle: PIXI.StrokeStyle = {
        alpha: 1,
        alignment: 0.5,
        color: 0x000000,
        width: localBufWidth,
        cap: 'butt',
        join: 'bevel'
      };
      this._bufferdata = lineToPoly(flatLocal, bufferStyle);
      container.hitArea = new PIXI.Polygon(this._bufferdata.perimeter);
    } else {
      this._bufferdata = null;
      container.hitArea = null;
    }

    if (this.casing!.renderable) {
      this.updateWorldGraphic('casing', this.casing!, points, zoom, isWireframe);
    } else {
      this.casing!.clear();
    }
    if (this.stroke!.renderable) {
      this.updateWorldGraphic('stroke', this.stroke!, points, zoom, isWireframe);
    } else {
      this.stroke!.clear();
    }

    this.geom.dirty = false;
    this._styleDirty = false;
    this.updateWorldHalo(zoom);
  }


  /**
   */
  updateGraphic(which: 'casing' | 'stroke', graphic: PIXI.Graphics, points: Vec2[], zoom: number, isWireframe: boolean): void {
    const style = this._style;
    const partStyle = style[which];
    if (!partStyle) return;

    const minwidth = which === 'casing' ? 3 : 2;
    let width = partStyle.width || 3;

    // Apply effectiveZoom style adjustments
    if (zoom < 16) {
      width -= 4;
    } else if (zoom < 17) {
      width -= 2;
    }
    if (width < minwidth) {
      width = minwidth;
    }

    if (isWireframe) {
      width = 1;
    }

    let g: PIXI.Graphics | DashLine = graphic.clear();
    if (partStyle?.opacity === 0) return;  // remove completely

    const strokeStyle: StrokeStyleWithDash = {
      color: partStyle.color,
      width: width,
      alpha: partStyle.opacity ?? 1.0,
      join: partStyle.join,
      cap:  partStyle.cap,
      dash: undefined as number[] | undefined
    };

    if (partStyle.dash) {
      strokeStyle.dash = partStyle.dash;
      g = new DashLine(this.gfx, graphic, strokeStyle);
      drawLineFromPoints(points, g);
    } else {
      drawLineFromPoints(points, g as PIXI.Graphics);
      (g as PIXI.Graphics).stroke(strokeStyle);
    }

    function drawLineFromPoints(points: Vec2[], graphics: PIXI.Graphics | DashLine): void {
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
   * Draws a world-coordinate line graphic.
   * Points are in container-local space (z16 world coords minus the feature's
   * world origin) — i.e. `GeometryPart.local.coords`. They can be drawn directly
   * without further translation.
   * Stroke widths are expressed in world local units: `px × 2^(WORLD_ZOOM - zoom)`.
   * @param which - Style part to draw ('casing' or 'stroke')
   * @param graphic - PIXI graphics object to update
   * @param points - Local coordinate points (origin-relative, from `local.coords`)
   * @param zoom - Effective zoom to use for rendering
   * @param isWireframe - Whether wireframe mode is active
   */
  updateWorldGraphic(
    which: 'casing' | 'stroke',
    graphic: PIXI.Graphics,
    points: Vec2[],
    zoom: number,
    isWireframe: boolean
  ): void {
    const style = this._style;
    const partStyle = style[which];
    if (!partStyle) return;

    const minwidth = which === 'casing' ? 3 : 2;
    let width = partStyle.width || 3;

    // Apply effectiveZoom style adjustments
    if (zoom < 16) {
      width -= 4;
    } else if (zoom < 17) {
      width -= 2;
    }
    if (width < minwidth) {
      width = minwidth;
    }

    if (isWireframe) {
      width = 1;
    }

    // Convert pixel width to world local units
    const localScale = 2 ** (WORLD_ZOOM - zoom);
    const localWidth = width * localScale;

    let g: PIXI.Graphics | DashLine = graphic.clear();
    if (partStyle?.opacity === 0) return;  // remove completely

    const strokeStyle: StrokeStyleWithDash = {
      color: partStyle.color,
      width: localWidth,
      alpha: partStyle.opacity ?? 1.0,
      join: partStyle.join,
      cap:  partStyle.cap,
      dash: undefined as number[] | undefined
    };

    if (partStyle.dash) {
      strokeStyle.dash = partStyle.dash.map(d => d * localScale);
      g = new DashLine(this.gfx, graphic, strokeStyle);
      drawLine(points, g);
    } else {
      drawLine(points, g as PIXI.Graphics);
      (g as PIXI.Graphics).stroke(strokeStyle);
    }

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
   * World-path halo. Draws the select halo as a child of the feature container
   * so it inherits the same world position/scale as the rest of the feature.
   * Widths and dash patterns are expressed in world-local units.
   * @param zoom - Effective zoom (used to convert pixel widths to world-local widths)
   */
  updateWorldHalo(zoom: number): void {
    const showHover = (this.visible && this._classes.has('hover'));
    const showSelect = (this.visible && this._classes.has('select'));
    const showHighlight = (this.visible && this._classes.has('highlight'));

    // Hover/highlight glow — same as legacy
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

    // Select dashed outline
    if (showSelect && this._bufferdata) {
      if (!this.halo) {
        this.halo = new PIXI.Graphics();
        this.halo.label = `${this.id}-halo`;
        this.halo.eventMode = 'none';
        this.container.addChild(this.halo);
      } else if (this.halo.parent !== this.container) {
        this.halo.parent?.removeChild(this.halo);
        this.container.addChild(this.halo);
      }

      const localScale = 2 ** (WORLD_ZOOM - zoom);
      const HALO_STYLE: StrokeStyleWithDash = {
        alpha: 0.9,
        dash: [6 * localScale, 3 * localScale],
        width: 2 * localScale,
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


  /**
   * Show/Hide halo (expects `this._bufferdata` to be already set up by `update()`)
   */
  updateHalo(): void {
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
      if (!this.halo) {
        this.halo = new PIXI.Graphics();
        this.halo.label = `${this.id}-halo`;
        const haloContainer = (this.scene as any).layers.get('map-ui').halo;
        haloContainer.addChild(this.halo);
      }

      const HALO_STYLE: StrokeStyleWithDash = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,   // px
        color: 0xffff00
      };

      (this.halo as PIXI.Graphics).clear();
      const dl = new DashLine(this.gfx, this.halo as PIXI.Graphics, HALO_STYLE);
      if (this._bufferdata) {
        if (this._bufferdata.outer && this._bufferdata.inner) {   // closed line
          dl.poly(this._bufferdata.outer);
          dl.poly(this._bufferdata.inner);
        } else {   // unclosed line
          dl.poly(this._bufferdata.perimeter);
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
