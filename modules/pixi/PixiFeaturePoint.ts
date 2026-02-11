import * as PIXI from 'pixi.js';
import { GlowFilter } from 'pixi-filters';

import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';
import type { MatchedStyle } from '../core/StyleSystem.ts';


/**
 * PixiFeaturePoint
 *
 * Properties you can access:
 *   `geom`        PixiGeometryPart() class containing all the information about the geometry
 *   `style`       Object containing styling data
 *   `container`   PIXI.Container containing the display objects used to draw the point
 *   `marker`      PIXI.Sprite for the marker
 *   `icon`        PIXI.Sprite for the icon
 *   `viewfields`  PIXI.Container containing the viewfields (or null if none)
 *
 *   (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePoint extends AbstractPixiFeature {
  /** PIXI.Sprite for the marker */
  marker: PIXI.Sprite | null;
  /** PIXI.Sprite for the icon */
  icon: PIXI.Sprite | null;
  /** PIXI.Container containing the viewfields (or null if none) */
  viewfields: PIXI.Container | null;

  /** Count of viewfield sprites (to detect changes) */
  private _viewfieldCount: number;
  /** Name of viewfield texture (to detect changes) */
  private _viewfieldName: string | null;
  /** Set true to use a circular halo and hit area */
  private _isCircular: boolean;

  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._viewfieldCount = 0;     // to watch for change in # of viewfield sprites
    this._viewfieldName = null;   // to watch for change in viewfield texture

    this._isCircular = false;   // set true to use a circular halo and hit area

    const marker = new PIXI.Sprite();
    marker.label = 'marker';
    marker.eventMode = 'none';
    marker.sortableChildren = false;
    marker.visible = true;
    this.marker = marker;

    const icon = new PIXI.Sprite();
    icon.label = 'icon';
    icon.eventMode = 'none';
    icon.sortableChildren = false;
    icon.visible = false;
    this.icon = icon;

    this.viewfields = null;   // add later only if needed

    this.container.addChild(marker, icon);
  }


  /**
   * destroy
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  destroy(): void {
    if (this.marker) {
      this.marker.destroy();
      this.marker = null;
    }
    if (this.icon) {
      this.icon.destroy();
      this.icon = null;
    }
    if (this.viewfields) {
      this.viewfields.destroy({ children: true });
      this.viewfields = null;
    }

    super.destroy();
  }


  /**
   * update
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  update(viewport: Viewport, zoom: number): void {
    if (!this.dirty) return;  // nothing to do

    this.updateGeometry(viewport, zoom);
    this.updateStyle(viewport, zoom);
    this.updateHitArea();
    this.updateHalo();
  }


  /**
   * updateGeometry
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  updateGeometry(viewport: Viewport, zoom: number): void {
    if (!this.geom.dirty) return;

    // Reproject
    this.geom.update(viewport);
    const screen = this.geom.screen;
    if (!screen?.coords) return;  // can't render anything without screen coords

    const [x, y] = screen.coords as Vec2;
    this.container.position.set(x, y);

    // sort markers by latitude ascending
    // sort markers with viewfields above markers without viewfields
    const z = y;  // use y coord as the z-index
    this.container.zIndex = (this._viewfieldCount > 0) ? (z + 1000) : z;
  }


  /**
   * updateStyle
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  updateStyle(viewport: Viewport, zoom: number): void {
    if (!this._styleDirty) return;

    function valIsNumber(val: unknown): boolean {
      return !isNaN(val as number) && isFinite(val as number);
    }

    const screen = this.geom.screen;
    if (!screen?.coords) return;  // can't render anything without screen coords

    const context = this.context;
    const map = context.systems.map!;
    const wireframeMode = map?.wireframeMode;
    const textureManager = this.gfx.textureManager!;
    const style = this._style as MatchedStyle;
    const isPin = ['pin', 'boldPin', 'osmose'].includes(style.marker.image ?? '');

    const marker = this.marker!;
    const icon = this.icon!;
    const z = (screen.coords as Vec2)[1];  // use y coord as the z-index

    // Apply anti-rotation to keep the icons and markers facing up.
    // (However viewfields container _should_ include the bearing, and will below)
    const bearing = viewport.transform.rotation;
    this.container.rotation = -bearing;

    // Show marker, if any..
    if (style.marker.image) {
      // anchor, default to middle,middle
      let [anchorX, anchorY] = style.marker.anchor || [];
      if (!valIsNumber(anchorX)) anchorX = 0.5;
      if (!valIsNumber(anchorY)) anchorY = 0.5;
      marker.anchor.set(anchorX, anchorY);

      // size, no default (size will be determined by the texture)
      const markerSize = style.marker.size;
      const markerScale = style.marker.scale || [];
      let [scaleX, scaleY] = Array.isArray(markerScale) ? markerScale : [markerScale];
      if (!valIsNumber(scaleX) || scaleX === 0) scaleX = 1;
      if (!valIsNumber(scaleY) || scaleY === 0) scaleY = scaleX;
      if (valIsNumber(markerSize)) {
        marker.setSize(markerSize! * scaleX!, markerSize! * scaleY!);
      } else {
        marker.scale.set(scaleX, scaleY);
      }

      // note - marker.texture gets set below in the effective zoom block
      marker.alpha = style.marker.opacity ?? 1;
      marker.tint = style.marker.color ?? 0xffffff;
      marker.visible = true;
    } else {  // No marker
      marker.visible = false;
    }

    // Show icon, if any..
    if (style.icon.image) {
      // anchor, default to middle,middle
      let [anchorX, anchorY] = style.icon.anchor || [];
      if (!valIsNumber(anchorX)) anchorX = 0.5;
      if (!valIsNumber(anchorY)) anchorY = 0.5;
      icon.anchor.set(anchorX, anchorY);

      // size, default to 11px to fit within the marker
      const iconSize = style.icon.size || 11;
      const iconScale = style.icon.scale || [];
      let [scaleX, scaleY] = Array.isArray(iconScale) ? iconScale : [iconScale];
      if (!valIsNumber(scaleX) || scaleX === 0) scaleX = 1;
      if (!valIsNumber(scaleY) || scaleY === 0) scaleY = scaleX;
      // icon.setSize(iconSize * scaleX!, iconSize * scaleY!);
      icon.width = iconSize * scaleX!;
      icon.height = iconSize * scaleY!;

      icon.texture = textureManager.getTexture('symbol', style.icon.image) || PIXI.Texture.EMPTY;
      icon.alpha = style.icon.opacity ?? 1;
      icon.tint = style.icon.color ?? 0x111111;
      icon.visible = true;
    } else {  // No icon
      icon.visible = false;
    }

    // Update viewfields, if any..
    const vfAngles = style.viewfield?.angles || [];
    let vfTexture = PIXI.Texture.EMPTY;
    if (vfAngles.length > 0) {  // Should have viewfields
      vfTexture = textureManager.getTexture('symbol', style.viewfield.image || '') || PIXI.Texture.WHITE;

      // Sort markers with viewfields above markers without viewfields
      // this.container.zIndex = -latitude + 1000;
      this.container.zIndex = z + 1000;

      // Ensure viewfield container exists
      if (!this.viewfields) {
        this.viewfields = new PIXI.Container();
        this.viewfields.label = 'viewfields';
        this.viewfields.eventMode = 'none';
        this.viewfields.sortableChildren = false;
        this.viewfields.visible = true;
        this.container.addChildAt(this.viewfields, 0);
      }

      // if # of viewfields has changed, or if the texture name has changed, recreate them
      const vfImage = style.viewfield.image;
      if (this._viewfieldCount !== vfAngles.length || this._viewfieldName !== vfImage) {
        this.viewfields.removeChildren();

        for (const _a of vfAngles) {
          const vfSprite = new PIXI.Sprite(vfTexture);
          vfSprite.eventMode = 'none';

          // Make the active photo image pop out at the user
          if (this._classes.has('selectphoto') || this._classes.has('highlightphoto')) {
            this.container.zIndex = 99000;
          }

          this.viewfields.addChild(vfSprite);
        }
        this._viewfieldCount = vfAngles.length;
        this._viewfieldName = vfImage ?? null;
      }

      // Apply bearing correction to the viewfield container
      this.viewfields.rotation = bearing;

      // anchor, default to middle,middle
      let [anchorX, anchorY] = style.viewfield.anchor || [];
      if (!valIsNumber(anchorX)) anchorX = 0.5;
      if (!valIsNumber(anchorY)) anchorY = 0.5;

      // size, no default (size will be determined by the texture)
      const viewfieldSize = style.viewfield.size;
      const viewfieldScale = style.viewfield.scale || [];
      let [scaleX, scaleY] = Array.isArray(viewfieldScale) ? viewfieldScale : [viewfieldScale];
      if (!valIsNumber(scaleX) || scaleX === 0) scaleX = 1;
      if (!valIsNumber(scaleY) || scaleY === 0) scaleY = scaleX;

      // Update viewfield angles and style
      for (let i = 0; i < vfAngles.length; i++) {
        const vfSprite = this.viewfields.getChildAt(i) as PIXI.Sprite;
        vfSprite.anchor.set(anchorX, anchorY);
        vfSprite.alpha = style.viewfield.opacity ?? 1;
        vfSprite.tint = style.viewfield.color ?? 0x333333;
        vfSprite.angle = vfAngles[i];
        if (valIsNumber(viewfieldSize)) {
          vfSprite.setSize(viewfieldSize! * scaleX!, viewfieldSize! * scaleY!);
        } else {
          vfSprite.scale.set(scaleX, scaleY);
        }
      }

    } else if (this.viewfields) {  // Had viewfields before and now should not
      this.viewfields.destroy({ children: true });
      this.viewfields = null;
      // this.container.zIndex = -latitude;   // restore default marker sorting
      this.container.zIndex = z;   // restore default marker sorting
      this._viewfieldCount = 0;
    }


    //
    // Apply effectiveZoom style adjustments
    // This is where we adjust the actual texture and anchor properties
    //
    if (zoom < 16) {  // Hide container and everything under it
      this.lod = 0;   // off
      this.visible = false;

    } else if (zoom < 17 || wireframeMode) {  // Markers drawn but smaller
      this.lod = 1;  // simplified
      this.visible = true;
      this.container.scale.set(0.8, 0.8);
      if (this.viewfields) {
        this.viewfields.renderable = false;
      }

      // Replace pinlike markers with circles at lower zoom
      const markerID = isPin ? 'largeCircle' : (style.marker.image ?? 'smallCircle');
      this._isCircular = /(circle|midpoint)$/i.test(markerID);
      marker.texture = textureManager.getTexture('symbol', markerID) || PIXI.Texture.EMPTY;
      marker.anchor.set(0.5, 0.5);  // middle, middle
      icon.position.set(0, 0);      // middle, middle

    } else {  // z >= 17 - Show the requested marker (circles OR pins)
      this.lod = 2;  // full
      this.visible = true;
      this.container.scale.set(1, 1);
      if (this.viewfields) {
        this.viewfields.renderable = true;
      }

      // Replace pinlike markers with circles if viewfields are present
      const markerID = (isPin && vfAngles.length) ? 'largeCircle' : (style.marker.image ?? 'smallCircle');
      this._isCircular = /(circle|midpoint)$/i.test(markerID);
      marker.texture = textureManager.getTexture('symbol', markerID) || PIXI.Texture.EMPTY;
      if (isPin && !this._isCircular) {
        marker.anchor.set(0.5, 1);    // middle, bottom
        icon.position.set(0, -14);    // mathematically 0,-15 is center of pin, but looks nicer moved down slightly
      } else {
        marker.anchor.set(0.5, 0.5);  // middle, middle
        icon.position.set(0, 0);      // middle, middle
      }
    }

    // If we are waiting on a texure to load, stay dirty.
    const missingMarker = marker.visible && marker.texture === PIXI.Texture.EMPTY;
    const missingIcon = icon.visible && icon.texture === PIXI.Texture.EMPTY;
    const missingViewfields = this.viewfields && vfTexture === PIXI.Texture.EMPTY;
    this._styleDirty = !!(missingMarker || missingIcon || missingViewfields);
  }


// experiment
  updateHitArea(): void {
    if (!this.visible) return;

    if (this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
      this.container.hitArea = null;
      return;
    }

    // In v8, getLocalBounds now returns a Bounds, not a Rectangle.
    // The Rectangle is wrapped within the bounds object.
    const rect = this.marker!.getLocalBounds().rectangle.clone();

    // getLocalBounds apparently doesn't take scale into account?
    // This only seems to matter when we adjust the marker size manually
    // (The Mapillary Signs layer does this)
    const scale = this.marker!.scale;
    if (scale.x !== 1) {
      rect.width *= scale.x;
      rect.x *= scale.x;
    }
    if (scale.y !== 1) {
      rect.height *= scale.y;
      rect.y *= scale.y;
    }

    // Make sure the rectangle is at least as big as MINSIZE x MINSIZE
    const MINSIZE = 20;
    rect.enlarge(new PIXI.Rectangle(-MINSIZE / 2, -MINSIZE / 2, MINSIZE, MINSIZE));
    rect.pad(4); // then pad a bit more

    if (this._isCircular) {
      this.container.hitArea = new PIXI.Circle(0, 0, rect.width / 2);
    } else {
      this.container.hitArea = rect;
    }
  }


  /**
   * updateHalo
   * Show/Hide halo (requires `this.container.hitArea` to be already set up by `updateHitArea` as a supported shape)
   */
  updateHalo(): void {
    const showHover = (this.visible && this._classes.has('hover'));
    const showSelect = (this.visible && this._classes.has('select') && !(this as any).virtual);
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

      const shape = this.container.hitArea;
      const dl = new DashLine(this.gfx, this.halo as PIXI.Graphics, HALO_STYLE);
      if (shape instanceof PIXI.Circle) {
        dl.circle(shape.x, shape.y, shape.radius, 20);
      } else if (shape instanceof PIXI.Rectangle) {
        dl.rect(shape.x, shape.y, shape.width, shape.height);
      }

      this.halo.position = this.container.position;
      this.halo.rotation = this.container.rotation;

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
  get style(): MatchedStyle {
    return this._style as MatchedStyle;
  }
  set style(obj: Partial<MatchedStyle>) {
    this._style = Object.assign({}, STYLE_DEFAULTS, obj);
    this._styleDirty = true;
  }

}


const STYLE_DEFAULTS: MatchedStyle = {
  fill:   { width: 2, color: 0xaaaaaa, opacity: 0.3, pattern: undefined },
  casing: { width: 5, color: 0x444444, opacity: 1, cap: 'round', join: 'round' },
  stroke: { width: 3, color: 0xcccccc, opacity: 1, cap: 'round', join: 'round' },
  marker: { image: 'smallCircle', color: 0xffffff, opacity: 1 },
  icon: { image: undefined, color: 0x111111, opacity: 1, size: 11 },
  viewfield: { angles: [], color: 0xffffff, opacity: 1, image: 'viewfield' },
  label: { color: 0xeeeeee }
};
