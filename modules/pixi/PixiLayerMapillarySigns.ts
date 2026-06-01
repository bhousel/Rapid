import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { MarkerData } from '../data/MarkerData.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;


/**
 * @class
 */
export class PixiLayerMapillarySigns extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'mapillary-signs';
  }


  /**
   * Whether the Layer's service exists
   */
  public get supported() {
    return !!this.context.services.mapillary;
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
    const mapillary = context.services.mapillary;
    if (val && mapillary) {
      mapillary.startAsync()
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
   * @param  markers - all markers
   * @return markers with filtering applied
   */
  public filterMarkers(markers: MarkerData[]): MarkerData[] {
    const photos = this.context.systems.photos!;
    const fromDate = photos.fromDate;
    const fromTimestamp = fromDate && new Date(fromDate).getTime();
    const toDate = photos.toDate;
    const toTimestamp = toDate && new Date(toDate).getTime();

    return markers.filter(marker => {
      const seenAt = marker.props.first_seen_at;
      if (typeof seenAt !== 'number' && typeof seenAt !== 'string') return true;

      const timestamp = new Date(seenAt).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
      if (toTimestamp && toTimestamp < timestamp) return false;

      return true;
    });
  }


  /**
   * @param  frame     Integer frame being rendered
   * @param  viewport  Pixi viewport to use for rendering
   */
  public renderMarkers(frame: number, viewport: Viewport): void {
    const context = this.context;
    const mapillary = context.services.mapillary;
    if (!mapillary?.started) return;

    const container = context.container();
    const parentContainer = this.scene.groups.get('qa')!;

    let markers = mapillary.getData('signs');
    markers = this.filterMarkers(markers);

    for (const d of markers) {
      const dataID = d.id;
      const part = d.geoms.parts[0];

      // Check that this part has coordinates and is a Point
      if (!part.world || part.type !== 'Point') continue;

      const featureID = `${this.layerID}-sign-${dataID}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        // Some values we don't have icons for, check first - Rapid#1518
        const hasIcon = container.selectAll(`#rapid-defs #${d.props.value}`).size();

        let style: Partial<MatchedStyle>;
        if (hasIcon) {
          style = {
            marker: { image: d.props.value as string, size: 24 }
          };
        } else {
          style = {
            marker: { image: 'xlargeSquare', size: 24 },
            icon: { image: 'fas-question', color: 0x000000, size: 16 }
          };
        }

        feature = new PixiFeaturePoint(this, featureID);
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.geometry = part;
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);
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
    const mapillary = this.context.services.mapillary;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !mapillary?.started || viewZoom < MINZOOM) return;

    mapillary.loadTiles('signs');
    this.renderMarkers(frame, viewport);
  }

}
