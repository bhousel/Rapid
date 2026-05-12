import type { Viewport } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { MarkerData } from '../data/MarkerData.ts';
import type { PixiScene } from './PixiScene.ts';

const MINZOOM = 12;
const MAPILLARY_GREEN = 0x05cb63;
const SELECTED = 0xffee00;


/**
 * @class
 */
export class PixiLayerMapillaryDetections extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'mapillary-detections';
  }


  /**
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.mapillary;
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
    const mapillary = context.services.mapillary;
    if (val && mapillary) {
      mapillary.startAsync()
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
   * @param  markers - all markers
   * @return markers with filtering applied
   */
  filterMarkers(markers: MarkerData[]): MarkerData[] {
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
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   * @param  zoom     -  Effective zoom level to use for rendering
   */
  renderMarkers(frame: number, viewport: Viewport, zoom: number): void {
    const context = this.context;
    const schema = context.systems.schema!;

    const mapillary = context.services.mapillary;
    if (!mapillary?.started) return;

    const parentContainer = this.scene.groups.get('qa')!;

    let markers = mapillary.getData('detections');
    markers = this.filterMarkers(markers);

    for (const d of markers) {
      const dataID = d.id;
      const part = d.geoms.parts[0];

      // Check that this part has coordinates and is a Point
      if (!part.world || part.type !== 'Point') continue;

      const featureID = `${this.layerID}-detection-${dataID}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.parentContainer = parentContainer;
        feature.geometry = part;
        feature.setData(d.id, d);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const isSelected = feature.hasClass('selectdetection');
        const presetID = mapillary.getDetectionPresetID(d.props.value as string);
        const preset = presetID ? schema.getScope('osm').presets.get(presetID) : undefined;
        const iconName = preset?.props?.icon || 'fas-question';

        const style: Partial<MatchedStyle> = {
          marker: {
            color: 0x000000,
            image: 'xlargeCircle'
          },
          icon: {
            color: isSelected ? SELECTED : MAPILLARY_GREEN,
            image: iconName,
            size: 16
          }
        };

        feature.style = style;
      }

      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   * @param  zoom     -  Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const mapillary = this.context.services.mapillary;
    if (!this.enabled || !mapillary?.started || zoom < MINZOOM) return;

    mapillary.loadTiles('detections');
    this.renderMarkers(frame, viewport, zoom);
  }

}

