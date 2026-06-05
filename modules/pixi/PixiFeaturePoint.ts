import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import { DashLine } from './lib/DashLine.ts';
import { GlowFilter } from 'pixi-filters';
import { WORLD_ZOOM } from '@rapid-sdk/math';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { DashLineOptions } from './lib/DashLine.ts';
import type { PixiFeatureProps } from './AbstractPixiFeature.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { Viewport } from '@rapid-sdk/math';

/* Intersection type that includes both Pixi Stroke and DashLineOptions  */
type StrokeStyleWithDash = PIXI.StrokeStyle & DashLineOptions;


/** Additional properties for a point */
export interface PixiFeaturePointProps extends PixiFeatureProps {
  /** Set true to use a circular halo and hit area */
  isCircular: boolean;
  /** Set true if this is a "virtual" pin - these are rendered inside of a polygon */
  isVirtual: boolean;
}


/**
 * This class renders a Point feature.
 *
 * Properties available:
 * - `marker`      PIXI.Sprite for the marker
 * - `icon`        PIXI.Sprite for the icon
 * - `viewfields`  PIXI.Container containing the viewfields (or null if none)
 * - (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeaturePoint extends AbstractPixiFeature {

  /** PIXI.Sprite for the marker */
  public marker: PIXI.Sprite | null;
  /** PIXI.Sprite for the icon */
  public icon: PIXI.Sprite | null;
  /** PIXI.Container containing the viewfields (or null if none) */
  public viewfields: PIXI.Container | null;
  /** Narrows the inherited `PixiFeatureProps` props to `PixiFeaturePointProps` */
  public declare props: PixiFeaturePointProps;

  /** Count of viewfield sprites (to detect changes) */
  protected _viewfieldCount: number;
  /** Name of viewfield texture (to detect changes) */
  protected _viewfieldName: string | null;


  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the name of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    super(layer, featureID);

    this._viewfieldCount = 0;         // to watch for change in # of viewfield sprites
    this._viewfieldName = null;       // to watch for change in viewfield texture
    this.props.isCircular = false;    // set true to use a circular halo and hit area

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
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
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
   * Updates geometry, style, hit area, and halo if the feature is dirty.
   * @param viewport - Pixi viewport to use for rendering
   */
  public update(viewport: Viewport): void {
    if (!this.dirty) return;  // nothing to do

    this.updateGeometry();
    this.updateStyle(viewport);
    this.updateHitArea();
    this.updateHalo();
  }


  /**
   * Updates the container position and z-ordering from the point geometry.
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateGeometry(): void {
    if (!this._geomDirty) return;

    const type = this._geom?.type;
    const world = this._geom?.world;
    const origin = world?.origin;

    // Not a Point, or no GeometryPart data?
    if (type !== 'Point' || !world || !origin) {
      this.lod = 0;
      this.visible = false;
      this._geomDirty = false;
      return;
    }

    const [x, y] = origin;
    this.container.position.set(x, y);

    // sort markers by latitude ascending
    // sort markers with viewfields above markers without viewfields
    const z = y;  // use y coord as the z-index
    this.container.zIndex = (this._viewfieldCount > 0) ? (z + 1000) : z;
    this._geomDirty = false;
  }


  /**
   * Updates the marker, icon, and viewfield display sprites from the current style.
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateStyle(viewport: Viewport): void {
    if (!this._styleDirty) return;

    const context = this.context;
    const map = context.systems.map;
    const viewZoom = viewport.transform.zoom;
    const styleZoom = map?.effectiveZoom() ?? viewZoom;
    const wireframeMode = map?.wireframeMode;
    const textureManager = this.gfx.textureManager!;
    const style = this._style;
    const isPin = ['pin', 'boldPin', 'osmose'].includes(style.marker.image ?? '');

    const container = this.container;
    const marker = this.marker!;
    const icon = this.icon!;

    // Use y-coordinate as the z-index.
    const z = container.position.y;

    // If we are in a rotated frame, apply counter-rotation to keep the icons and markers facing up.
    // (However viewfields container _should_ include the bearing, and will below)
    const bearing = viewport.transform.rotation;
    container.rotation = -bearing;

    // If we are rendering world coordinates, apply counter-scale to get children back to screen coords.
    // Scale down even more at lower zooms.
    const baseScale = (styleZoom < 17 || wireframeMode) ? 0.8 : 1.0;
    if (this._geom) {   // GeometryPart path
      const worldScale = 2 ** (viewZoom - WORLD_ZOOM) || 1;
      container.scale.set(baseScale / worldScale, baseScale / worldScale);
    } else {
      container.scale.set(baseScale, baseScale);
    }

    // Show marker, if any..
    if (style.marker.image) {
      // anchor, default to middle,middle
      let [anchorX, anchorY] = style.marker.anchor || [];
      if (!Number.isFinite(anchorX)) anchorX = 0.5;
      if (!Number.isFinite(anchorY)) anchorY = 0.5;
      marker.anchor.set(anchorX, anchorY);

      // size, if unset, size will be determined by the texture
      const markerSize = style.marker.size;
      const markerScale = style.marker.scale || [];
      let [scaleX, scaleY] = Array.isArray(markerScale) ? markerScale : [markerScale];
      if (!Number.isFinite(scaleX) || scaleX === 0) scaleX = 1;
      if (!Number.isFinite(scaleY) || scaleY === 0) scaleY = scaleX;
      if (Number.isFinite(markerSize)) {
        marker.width = markerSize! * scaleX!;
        marker.height = markerSize! * scaleY!;
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
      if (!Number.isFinite(anchorX)) anchorX = 0.5;
      if (!Number.isFinite(anchorY)) anchorY = 0.5;
      icon.anchor.set(anchorX, anchorY);

      // size, default to 11px to fit within the marker
      const iconSize = style.icon.size || 11;
      const iconScale = style.icon.scale || [];
      let [scaleX, scaleY] = Array.isArray(iconScale) ? iconScale : [iconScale];
      if (!Number.isFinite(scaleX) || scaleX === 0) scaleX = 1;
      if (!Number.isFinite(scaleY) || scaleY === 0) scaleY = scaleX;
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
      container.zIndex = z + 1000;

      // Ensure viewfield container exists
      if (!this.viewfields) {
        this.viewfields = new PIXI.Container();
        this.viewfields.label = 'viewfields';
        this.viewfields.eventMode = 'none';
        this.viewfields.sortableChildren = false;
        this.viewfields.visible = true;
        container.addChildAt(this.viewfields, 0);
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
            container.zIndex = 99000;
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
      if (!Number.isFinite(anchorX)) anchorX = 0.5;
      if (!Number.isFinite(anchorY)) anchorY = 0.5;

      // size, no default (size will be determined by the texture)
      const viewfieldSize = style.viewfield.size;
      const viewfieldScale = style.viewfield.scale || [];
      let [scaleX, scaleY] = Array.isArray(viewfieldScale) ? viewfieldScale : [viewfieldScale];
      if (!Number.isFinite(scaleX) || scaleX === 0) scaleX = 1;
      if (!Number.isFinite(scaleY) || scaleY === 0) scaleY = scaleX;

      // Update viewfield angles and style
      for (let i = 0; i < vfAngles.length; i++) {
        const vfSprite = this.viewfields.getChildAt(i) as PIXI.Sprite;
        vfSprite.anchor.set(anchorX, anchorY);
        vfSprite.alpha = style.viewfield.opacity ?? 1;
        vfSprite.tint = style.viewfield.color ?? 0x333333;
        vfSprite.angle = vfAngles[i];
        if (Number.isFinite(viewfieldSize)) {
          vfSprite.setSize(viewfieldSize! * scaleX!, viewfieldSize! * scaleY!);
        } else {
          vfSprite.scale.set(scaleX, scaleY);
        }
      }

    } else if (this.viewfields) {  // Had viewfields before and now should not
      this.viewfields.destroy({ children: true });
      this.viewfields = null;
      this._viewfieldCount = 0;
      container.zIndex = z;   // restore default marker sorting
    }


    //
    // Apply effectiveZoom style adjustments
    // This is where we adjust the actual texture and anchor properties
    //
    if (styleZoom < 16) {  // Hide container and everything under it
      this.lod = 0;   // off
      this.visible = false;

    } else if (styleZoom < 17 || wireframeMode) {  // Markers drawn but smaller
      this.lod = 1;  // simplified
      this.visible = true;
      if (this.viewfields) {
        this.viewfields.renderable = false;
      }

      // Replace pinlike markers with circles at lower zoom
      const markerID = isPin ? 'largeCircle' : (style.marker.image ?? 'smallCircle');
      this.props.isCircular = /(circle|midpoint)$/i.test(markerID);
      marker.texture = textureManager.getTexture('symbol', markerID) || PIXI.Texture.EMPTY;
      marker.anchor.set(0.5, 0.5);  // middle, middle
      icon.position.set(0, 0);      // middle, middle

    } else {  // z >= 17 - Show the requested marker (circles OR pins)
      this.lod = 2;  // full
      this.visible = true;
      if (this.viewfields) {
        this.viewfields.renderable = true;
      }

      // Replace pinlike markers with circles if viewfields are present
      const markerID = (isPin && vfAngles.length) ? 'largeCircle' : (style.marker.image ?? 'smallCircle');
      this.props.isCircular = /(circle|midpoint)$/i.test(markerID);
      marker.texture = textureManager.getTexture('symbol', markerID) || PIXI.Texture.EMPTY;
      if (isPin && !this.props.isCircular) {
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
  /** Recalculates the interactive hit area for this point feature based on its current bounds. */
  public updateHitArea(): void {
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

    if (this.props.isCircular) {
      this.container.hitArea = new PIXI.Circle(0, 0, rect.width / 2);
    } else {
      this.container.hitArea = rect;
    }
  }


  /**
   * Show/Hide halo (requires `this.container.hitArea` to be already set up by `updateHitArea` as a supported shape)
   */
  public updateHalo(): void {
    const showHover = (this.visible && this._classes.has('hover'));
    const showSelect = (this.visible && this._classes.has('select') && !this.props.isVirtual);
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

      // Make the halo transform mimic the container transform.
      // The container is scaled so that children are drawn in _screen_ coordinates.
      // This means that the halo is drawn in _screen_ coordinates.
      this.halo.position = this.container.position;
      this.halo.rotation = this.container.rotation;
      this.halo.scale = this.container.scale;

      const HALO_STYLE: StrokeStyleWithDash = {
        alpha: 0.9,
        dash: [6, 3],
        width: 2,
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

    } else {
      if (this.halo) {
        this.halo.destroy();
        this.halo = null;
      }
    }
  }

}
