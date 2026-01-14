import * as PIXI from 'pixi.js';
import { GlowFilter } from 'pixi-filters';

import type { Viewport, Vec2 } from '@rapid-sdk/math';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { getLineSegments, lineToPoly, type LineToPolyResult } from './helpers.ts';

const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;


/** Style properties for line stroke/casing */
export interface LinePartStyle {
  /** Line width in pixels */
  width?: number;
  /** Line color */
  color?: number;
  /** Alpha/opacity (0-1) */
  alpha?: number;
  /** Line cap style */
  cap?: 'butt' | 'round' | 'square';
  /** Line join style */
  join?: 'bevel' | 'miter' | 'round';
  /** Dash pattern [dash, gap] */
  dash?: number[];
}

/** Style properties for line features */
export interface LineStyle {
  /** Texture name for line markers (e.g. 'oneway') */
  lineMarkerName?: string;
  /** Custom line marker texture */
  lineMarkerTexture?: PIXI.Texture;
  /** Line marker tint color */
  lineMarkerTint?: number;
  /** Texture name for sided markers */
  sidedMarkerName?: string;
  /** Custom sided marker texture */
  sidedMarkerTexture?: PIXI.Texture;
  /** Label tint color */
  labelTint?: number;
  /** Fill style (for closed lines) */
  fill?: LinePartStyle;
  /** Casing style (bottom layer) */
  casing?: LinePartStyle;
  /** Stroke style (top layer) */
  stroke?: LinePartStyle;
}


/**
 * PixiFeatureLine
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
  constructor(layer: any, featureID: string) {
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
   * destroy
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
   * update
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  update(viewport: Viewport, zoom: number): void {
    if (!this.dirty) return;  // nothing to do

    const map = this.context.systems.map as any;
    const isWireframe = map?.wireframeMode;
    const textureManager = this.gfx.textures;
    const container = this.container;
    const geom = this.geom;
    const style = this._style as LineStyle;
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
      let showMarkers = true;

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

      if (showMarkers && ((style.lineMarkerTexture || style.lineMarkerName) || (style.sidedMarkerTexture || style.sidedMarkerName))) {
        // Create line marker container, if necessary
        if (!lineMarkers) {
          lineMarkers = new PIXI.Container();
          lineMarkers.label = 'lineMarkers';
          lineMarkers.eventMode = 'none';
          lineMarkers.sortableChildren = false;
          (lineMarkers as any).roundPixels = false;
          container.addChild(lineMarkers);
        }

        const lineMarkerTexture = style.lineMarkerTexture || textureManager.get(style.lineMarkerName!) || PIXI.Texture.WHITE;
        const sidedMarkerTexture = style.sidedMarkerTexture || textureManager.get(style.sidedMarkerName!) || PIXI.Texture.WHITE;
        const sided = style.sidedMarkerName === 'sided';
        const oneway = style.lineMarkerName === 'oneway';
        lineMarkers.removeChildren();

        if (oneway) {
          const segments = getLineSegments(screen.coords as Vec2[], ONEWAY_SPACING, false, true);  /* sided = false, limited = true */

          segments.forEach(segment => {
            segment.coords.forEach(([x, y]) => {
              const arrow = new PIXI.Sprite(lineMarkerTexture);
              arrow.eventMode = 'none';
              arrow.sortableChildren = false;
              arrow.anchor.set(0.5, 0.5); // middle, middle
              arrow.position.set(x, y);
              arrow.rotation = segment.angle;
              arrow.tint = style.lineMarkerTint ?? 0x000000;
              lineMarkers!.addChild(arrow);
            });
          });
        }

        if (sided) {
          const segments = getLineSegments(screen.coords as Vec2[], SIDED_SPACING, true, true);  /* sided = true, limited = true */

          segments.forEach(segment => {
            segment.coords.forEach(([x, y]) => {
              const arrow = new PIXI.Sprite(sidedMarkerTexture);
              arrow.eventMode = 'none';
              arrow.sortableChildren = false;
              arrow.anchor.set(0.5, 0.5); // middle, middle
              arrow.position.set(x, y);
              arrow.rotation = segment.angle;
              arrow.tint = style.stroke?.color ?? 0xcccccc;
              lineMarkers!.addChild(arrow);
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
        let width = style.casing?.width ?? 5;

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

        const bufferStyle = {
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
      this.updateGraphic('casing', this.casing!, screen!.coords as Vec2[], style, zoom, isWireframe);
    }
    if (this.stroke!.renderable) {
      this.updateGraphic('stroke', this.stroke!, screen!.coords as Vec2[], style, zoom, isWireframe);
    }

    this.updateHalo();
  }


  /**
   * updateGraphic
   */
  updateGraphic(which: 'casing' | 'stroke', graphic: PIXI.Graphics, points: Vec2[], style: LineStyle, zoom: number, isWireframe: boolean): void {
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
    if (partStyle.alpha === 0) return;

    const strokeStyle = {
      color: partStyle.color,
      width: width,
      alpha: partStyle.alpha || 1.0,
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
      g = (g as PIXI.Graphics).stroke(strokeStyle);
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
   * updateHalo
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

      const HALO_STYLE = {
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


  /**
   * style
   * @param obj - Style `Object` (contents depends on the Feature type)
   *
   * 'point' - @see `PixiFeaturePoint.ts`
   * 'line'/'polygon' - @see `StyleSystem.ts`
   */
  get style(): LineStyle {
    return this._style as LineStyle;
  }
  set style(obj: Partial<LineStyle>) {
    this._style = Object.assign({}, STYLE_DEFAULTS, obj);
    this._styleDirty = true;
  }

}


const STYLE_DEFAULTS: LineStyle = {
  lineMarkerName: '',
  lineMarkerTint: 0x000000,
  labelTint: 0xeeeeee,

  fill:   { width: 2, color: 0xaaaaaa, alpha: 0.3 },
  casing: { width: 5, color: 0x444444, alpha: 1, cap: 'round', join: 'round' },
  stroke: { width: 3, color: 0xcccccc, alpha: 1, cap: 'round', join: 'round' }
};

