import * as PIXI from 'pixi.js';
import { GlowFilter } from 'pixi-filters';

import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { getLineSegments, lineToPoly, type LineToPolyResult } from './helpers.ts';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';

const ONEWAY_SPACING = 35;
const SIDED_SPACING = 30;


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
      this.updateGraphic('casing', this.casing!, screen!.coords as Vec2[], zoom, isWireframe);
    }
    if (this.stroke!.renderable) {
      this.updateGraphic('stroke', this.stroke!, screen!.coords as Vec2[], zoom, isWireframe);
    }

    this.updateHalo();
  }


  /**
   * updateGraphic
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
    if (partStyle?.opacity === 0) return;

    const strokeStyle = {
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

}
