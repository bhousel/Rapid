import type { Viewport } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';

const MINZOOM = 12;


/**
 * PixiLayerKeepRight
 * @class
 */
export class PixiLayerKeepRight extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'keepright';
  }


  /**
   * supported
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.keepright;
  }


  /**
   * enabled
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   */
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const keepRight = context.services.keepright;
    if (val && keepRight) {
      keepRight.startAsync()
        .then(() => gfx.immediateRedraw());
    }
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();
  }


  /**
   * render
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   * @param  zoom     -  Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const keepRight = this.context.services.keepright;
    if (!this.enabled || !keepRight?.started || zoom < MINZOOM) return;

    keepRight.loadTiles();

    const parentContainer = this.scene.groups.get('qa')!;
    const data = keepRight.getData();

    for (const d of data) {
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${d.id}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        const style: Partial<MatchedStyle> = {
          marker: { image: 'xlargeCircle', color: 0x000000, opacity: 1 },
          icon: { image: 'keepright', color: keepRight.getColor(d.props.parentIssueType), opacity: 1, size: 16 }
        };

        feature = new PixiFeaturePoint(this, featureID);
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.setCoords(part);
        feature.setData(d.id, d);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }

}
