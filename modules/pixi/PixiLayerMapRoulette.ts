import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { RenderFrame } from './RenderFrame.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;


/**
 * This class renders Maproulette task markers.
 */
export class PixiLayerMapRoulette extends AbstractPixiLayer {

  /**
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'maproulette';
    this.useBatches = true;
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if the MapRoulette service is registered
   */
  public get supported() {
    return !!this.context.services.maproulette;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled() {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the MapRoulette service when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const maproulette = context.services.maproulette;
    if (val && maproulette) {
      maproulette.startAsync()
        .then(() => this.gfx.immediateRedraw(this.id));
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  The frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public render(frame: RenderFrame, viewport: Viewport): void {
    const maproulette = this.context.services.maproulette;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !maproulette?.started || viewZoom < MINZOOM) return;

    // Fetch new data, if needed..
    maproulette.loadTiles();
    if (this.keepFeatures(frame)) return;   // only the view moved, inside the cull box the last pass covered

    // Render the data that we have..
    const parentContainer = this._spatialContainer('qa', this.id);
    const data = maproulette.getData(frame.cullBox);

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
      }

      if (feature.data !== d || feature.geometry !== part) {   // changed data is a new object
        feature.geometry = part;
        feature.data = d;
      }

      this.syncFeatureClasses(feature);
      this._drawInBatches(feature, parentContainer, viewport);

      this.retainFeature(feature, frame);
    }

  }

}
