import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;


/**
 * @class
 */
export class PixiLayerOsmNotes extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'notes';
  }


  /**
   * Whether the Layer's service exists
   */
  public get supported() {
    return !!this.context.services.osm;
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
    const osm = context.services.osm;
    if (val && osm) {
      osm.startAsync()
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
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public renderMarkers(frame: number, viewport: Viewport): void {
    const osm = this.context.services.osm;
    if (!osm?.started) return;

    const parentContainer = this.scene.groups.get('qa')!;
    const notes = osm.getNotes();

    for (const d of notes) {
      const dataID = d.id;
      const version = d.v || 0;
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${dataID}`;
      let feature = this.features.get(featureID);

      // Create feature if necessary..
      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.parentContainer = parentContainer;
      }

      // If data has changed, replace it..
      if (feature.v !== version) {
        feature.v = version;
        feature.geometry = part;
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        let color = 0xff3300;  // open (red)
        let iconName = 'rapid-icon-close';
        if (d.props.status === 'closed') {
          color = 0x55dd00;  // closed (green)
          iconName = 'rapid-icon-apply';
        }
        if (d.isNew) {
          color = 0xffee00;  // new (yellow)
          iconName = 'rapid-icon-plus';
        }

        // Override 'y' anchor for better centering within the note balloon
        const style: Partial<MatchedStyle> = {
          marker: { color: color, image: 'osmnote', anchor: [0.5, 0.65] },
          icon: { color: 0x000000, image: iconName, anchor: [0.5, 0.65] }
        };

        feature.style = style;
      }

      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const osm = this.context.services.osm;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !osm?.started || viewZoom < MINZOOM) return;

    osm.loadNotes();
    this.renderMarkers(frame, viewport);
  }

}

