import type { Viewport } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';

const MINZOOM = 12;


/**
 * @class
 */
export class PixiLayerMapRoulette extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'maproulette';
  }


  /**
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.maproulette;
  }


  /**
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
    const maproulette = context.services.maproulette;
    if (val && maproulette) {
      maproulette.startAsync()
        .then(() => gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   * @param  zoom     -  Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const maproulette = this.context.services.maproulette;
    if (!this.enabled || !maproulette?.started || zoom < MINZOOM) return;

    // Fetch new data, if needed..
    maproulette.loadTiles();

    // Render the data that we have..
    const parentContainer = this.scene.groups.get('qa')!;
    const data = maproulette.getData();

    for (const d of data) {
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${d.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        const style: Partial<MatchedStyle> = {
          marker: { color: 0x00ff00, image: 'osmose' },
          icon: { color: 0x000000, image: (d as any).icon }
        };

        feature = new PixiFeaturePoint(this, featureID);
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.geometry = part;
        feature.setData(d.id, d);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport, zoom);
      if (!(feature as any)._isCircular) {  // offset the icon to fit better in the "osmose" pin
        feature.icon?.position.set(0, -17);
      }

      this.retainFeature(feature, frame);
    }

  }

}
