import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;


/**
 * @class
 */
export class PixiLayerKeepRight extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'keepright';
  }


  /**
   * Whether the Layer's service exists
   */
  public get supported() {
    return !!this.context.services.keepright;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   */
  public get enabled() {
    return this._enabled;
  }
  public set enabled(val) {
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
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
    super.reset();
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const keepRight = this.context.services.keepright;
    const viewZoom = viewport.transform.zoom;

    if (!this.enabled || !keepRight?.started || viewZoom < MINZOOM) return;

    keepRight.loadTiles();

    const parentContainer = this.scene.groups.get('qa')!;
    const data = keepRight.getData();

    for (const d of data) {
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${d.id}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        const color = keepRight.getColor(d.props.parentIssueType as string);
        const style: Partial<MatchedStyle> = {
          marker: { color: 0x000000, image: 'xlargeCircle'  },
          icon: { color: color, image: 'keepright', size: 16 }
        };

        feature = new PixiFeaturePoint(this, featureID);
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.geometry = part;
        feature.setData(d.id, d);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }

}
