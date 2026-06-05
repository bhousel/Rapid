import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;


/**
 * This class renders Osmose Q/A markers.
 */
export class PixiLayerOsmose extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'osmose';
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if the Osmose service is registered
   */
  public get supported() {
    return !!this.context.services.osmose;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled() {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the Osmose service when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const osmose = context.services.osmose;
    if (val && osmose) {
      osmose.startAsync()
        .then(() => this.gfx.immediateRedraw());
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const osmose = this.context.services.osmose;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !osmose?.started || viewZoom < MINZOOM) return;

    // Fetch new data, if needed..
    osmose.loadTiles();

    // Render the data that we have..
    const parentContainer = this.scene.groups.get('qa')!;
    const items = osmose.getData();

    for (const d of items) {
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${d.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        const color = osmose.getColor(d.props.item as number);
        const style: Partial<MatchedStyle> = {
          marker: { color: color, image: 'osmose' },
          icon: { color: 0x000000, image: d.props.iconID as string }
        };

        feature = new PixiFeaturePoint(this, featureID);
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.geometry = part;
        feature.data = d;
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport);
      if (!feature.props.isCircular) {  // offset the icon to fit better in the "osmose" pin
        feature.icon?.position.set(0, -17);
      }

      this.retainFeature(feature, frame);
    }
  }

}
