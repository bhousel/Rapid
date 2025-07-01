import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeaturePoint } from './PixiFeaturePoint.js';

const MINZOOM = 12;
const MAPILLARY_GREEN = 0x05cb63;
const SELECTED = 0xffee00;


/**
 * PixiLayerMapillaryDetections
 * @class
 */
export class PixiLayerMapillaryDetections extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);
  }


  /**
   * supported
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.mapillary;
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
    const gfx = context.systems.gfx;
    const mapillary = context.services.mapillary;
    if (val && mapillary) {
      mapillary.startAsync()
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
   * filterMarkers
   * @param  {Array<Marker>}  markers - all markers
   * @return {Array<Marker>}  markers with filtering applied
   */
  filterMarkers(markers) {
    const photos = this.context.systems.photos;
    const fromDate = photos.fromDate;
    const fromTimestamp = fromDate && new Date(fromDate).getTime();
    const toDate = photos.toDate;
    const toTimestamp = toDate && new Date(toDate).getTime();

    return markers.filter(marker => {
      const props = marker.props;
      const timestamp = new Date(props.first_seen_at).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
      if (toTimestamp && toTimestamp < timestamp) return false;

      return true;
    });
  }


  /**
   * renderMarkers
   * @param  frame     Integer frame being rendered
   * @param  viewport  Pixi viewport to use for rendering
   * @param  zoom      Effective zoom to use for rendering
   */
  renderMarkers(frame, viewport, zoom) {
    const context = this.context;
    const presets = context.systems.presets;

    const mapillary = context.services.mapillary;
    if (!mapillary?.started) return;

    const parentContainer = this.scene.groups.get('qa');

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
        feature.setCoords(part);
        feature.setData(d.id, d);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const isSelected = feature.hasClass('selectdetection');
        const presetID = mapillary.getDetectionPresetID(d.props.value);
        const preset = presetID && presets.item(presetID);

        const style = {
          markerName: 'xlargeCircle',
          markerTint: '#000000',
          iconName: preset?.icon || 'fas-question',
          iconSize: 16,
          iconTint: isSelected ? SELECTED : MAPILLARY_GREEN
        };

        feature.style = style;
      }

      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * render
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  frame     Integer frame being rendered
   * @param  viewport  Pixi viewport to use for rendering
   * @param  zoom      Effective zoom to use for rendering
   */
  render(frame, viewport, zoom) {
    const mapillary = this.context.services.mapillary;
    if (!this.enabled || !mapillary?.started || zoom < MINZOOM) return;

    mapillary.loadTiles('detections');
    this.renderMarkers(frame, viewport, zoom);
  }

}

