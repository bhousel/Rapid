import * as PIXI from 'pixi.js';
import { GlowFilter } from 'pixi-filters';

import { AbstractPixiFeature } from './AbstractPixiFeature.js';
import { DashLine } from './lib/DashLine.js';


/**
 * PixiFeaturePoint
 *
 * Properties you can access:
 *   `geometry`    PixiGeometry() class containing all the information about the geometry
 *   `style`       Object containing styling data
 *   `container`   PIXI.Container containing the display objects used to draw the point
 *   `marker`      PIXI.Sprite for the marker
 *   `icon`        PIXI.Sprite for the icon
 *   `viewfields`  PIXI.Container containing the viewfields (or null if none)
 *
 *   (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePoint extends AbstractPixiFeature {

  /**
   * @constructor
   * @param  {Layer}   layer     - The Layer that owns this Feature
   * @param  {string}  featureID - Unique string to use for the name of this Feature
   */
  constructor(layer, featureID) {
    super(layer, featureID);

    this.type = 'point';
    this._viewfieldCount = 0;   // to watch for change in # of viewfield sprites
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
  destroy() {
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
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   * @param  {number}    zoom     - Effective zoom to use for rendering
   */
  update(viewport, zoom) {
    if (!this.dirty) return;  // nothing to do

    this.updateGeometry(viewport, zoom);
    this.updateStyle(viewport, zoom);

    // Recalculate local and scene bounds
    // (note that the local bounds automatically includes children like viewfields too)
    const position = this.container.position;
    // this.sceneBounds = this.container.getLocalBounds().clone();  // where 0,0 is the origin of the object
    this.sceneBounds = this.container.getBounds().clone();  // where 0,0 is the origin of the object
    this.sceneBounds.x += position.x;
    this.sceneBounds.y += position.y;

    this.updateHitArea();
    this.updateHalo();
  }


  /**
   * updateGeometry
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   * @param  {number}    zoom     - Effective zoom to use for rendering
   */
  updateGeometry(viewport, zoom) {
    if (!this.geometry.dirty) return;

    // Reproject
    this.geometry.update(viewport, zoom);

    const [x, y] = this.geometry.screen.coords;
    this.container.position.set(x, y);

    // sort markers by latitude ascending
    // sort markers with viewfields above markers without viewfields
    // const z = -this.geometry.origCoords[1];  // latitude
    const z = y;  // use y coord as the z-index
    this.container.zIndex = (this._viewfieldCount > 0) ? (z + 1000) : z;
  }


  /**
   * updateStyle
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   * @param  {number}    zoom     - Effective zoom to use for rendering
   */
  updateStyle(viewport, zoom) {
    if (!this._styleDirty) return;

    const context = this.context;
    const wireframeMode = context.systems.map.wireframeMode;
    const textureManager = this.gfx.textures;
    const style = this._style;
    const isPin = ['pin', 'boldPin', 'osmose'].includes(style.markerName);

    const marker = this.marker;
    const icon = this.icon;
    const z = this.geometry.screen.coords[1];  // use y coord as the z-index
    // const latitude = this.geometry.origCoords[1];

    // Apply anti-rotation to keep the icons and markers facing up.
    // (However viewfields container _should_ include the bearing, and will below)
    const bearing = viewport.transform.rotation;
    this.container.rotation = -bearing;

    // Show marker, if any..
    if (style.markerTexture || style.markerName) {
      // note - marker.texture gets set below in the effective zoom block
      marker.alpha = style.markerAlpha ?? 1;
      marker.tint = style.markerTint;
      marker.visible = true;
    } else {  // No marker
      marker.visible = false;
    }

    // Show icon, if any..
    if (style.iconTexture || style.iconName) {
      icon.texture = style.iconTexture || textureManager.get(style.iconName);
      icon.anchor.set(style.anchor?.x || 0.5, style.anchor?.y || 0.5);   // middle, middle by default, can be overridden in layer code
      const iconSize = style.iconSize || 11;
      icon.width = iconSize;
      icon.height = iconSize;
      icon.alpha = style.iconAlpha ?? 1;
      icon.tint = style.iconTint;
      icon.visible = true;
    } else {  // No icon
      icon.visible = false;
    }

    // Update viewfields, if any..
    const vfAngles = style.viewfieldAngles || [];
    let vfTexture = PIXI.Texture.EMPTY;
    if (vfAngles.length > 0) {  // Should have viewfields
      vfTexture = style.viewfieldTexture || textureManager.get(style.viewfieldName) || PIXI.Texture.WHITE;

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

      // # of viewfields has changed, or if the texture name has changed, recreate them
      if (this._viewfieldCount !== vfAngles.length || this._viewfieldName !== style.viewfieldName) {
        this.viewfields.removeChildren();
        for (let i = 0; i < vfAngles.length; i++) {
          const vfSprite = new PIXI.Sprite(vfTexture);
          vfSprite.eventMode = 'none';
          vfSprite.anchor.set(0.5, 0.5);  // middle, middle

          // Make the active photo image pop out at the user
          if (this._classes.has('selectphoto') || this._classes.has('highlightphoto')) {
            this.container.zIndex = 99000;
          }

          this.viewfields.addChild(vfSprite);
        }
        this._viewfieldCount = vfAngles.length;
      }

      // Apply bearing correction to the viewfield container
      this.viewfields.rotation = bearing;

      // Update viewfield angles and style
      const scale = style.scale || 1;
      const xScale = scale * (style.fovWidth || 1);
      const yScale = scale * (style.fovLength || 1);
      for (let i = 0; i < vfAngles.length; i++) {
        const vfSprite = this.viewfields.getChildAt(i);
        vfSprite.alpha = style.viewfieldAlpha ?? 1;
        vfSprite.tint = style.viewfieldTint || 0x333333;
        vfSprite.scale.set(xScale, yScale);
        vfSprite.angle = vfAngles[i];
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
      const markerID = isPin ? 'largeCircle' : style.markerName;
      this._isCircular = (!style.markerTexture && /(circle|midpoint)$/i.test(markerID));
      marker.texture = style.markerTexture || textureManager.get(markerID);
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
      const markerID = (isPin && vfAngles.length) ? 'largeCircle' : style.markerName;
      this._isCircular = (!style.markerTexture && /(circle|midpoint)$/i.test(markerID));
      marker.texture = style.markerTexture || textureManager.get(markerID);
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
    this._styleDirty = (missingMarker || missingIcon || missingViewfields);
  }


// experiment
  updateHitArea() {
    if (!this.visible) return;

    if (this._classes.has('drawing')) {  // Rapid#648 - If drawing, `hitArea = null`
      this.container.hitArea = null;
      return;
    }

    // In v8, getLocalBounds now returns a Bounds, not a Rectangle.
    // The Rectangle is wrapped within the bounds object.
    const rect = this.marker.getLocalBounds().rectangle.clone();

    // getLocalBounds apparently doesn't take scale into account?
    // This only seems to matter when we adjust the marker size manually
    // (The Mapillary Signs layer does this)
    const scale = this.marker.scale;
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
  updateHalo() {
    const showHover = (this.visible && this._classes.has('hover'));
    const showSelect = (this.visible && this._classes.has('select') && !this.virtual);
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
        this.container.filters = null;
      }
    }

    // Select
    if (showSelect) {
      if (!this.halo) {
        this.halo = new PIXI.Graphics();
        this.halo.label = `${this.id}-halo`;
        const haloContainer = this.scene.layers.get('map-ui').halo;
        haloContainer.addChild(this.halo);
      }

      const HALO_STYLE = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,   // px
        color: 0xffff00
      };

      this.halo.clear();

      const shape = this.container.hitArea;
      const dl = new DashLine(this.gfx, this.halo, HALO_STYLE);
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
   * @param {Object} obj - Style `Object` (contents depends on the Feature type)
   *
   * 'point' - @see `PixiFeaturePoint.js`
   * 'line'/'polygon' - @see `StyleSystem.js`
   */
  get style() {
    return this._style;
  }
  set style(obj) {
    this._style = Object.assign({}, STYLE_DEFAULTS, obj);
    this._styleDirty = true;
  }

}


const STYLE_DEFAULTS = {
  iconAlpha: 1,
  iconName: '',
  iconTint: 0x111111,
  iconSize: 11,
  labelTint: 0xeeeeee,
  markerAlpha: 1,
  markerName: 'smallCircle',
  markerTint: 0xffffff,
  viewfieldAlpha: 0.75,
  viewfieldAngles: [],
  viewfieldName: 'viewfield',
  viewfieldTint: 0xffffff
};
