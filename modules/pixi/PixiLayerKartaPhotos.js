import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeatureLine } from './PixiFeatureLine.js';
import { PixiFeaturePoint } from './PixiFeaturePoint.js';

const MINZOOM = 12;
const KARTAVIEW_BLUE = 0x20c4ff;
const SELECTED = 0xffee00;

const LINESTYLE = {
  casing: { alpha: 0 },  // disable
  stroke: { alpha: 0.7, width: 4, color: KARTAVIEW_BLUE }
};

const MARKERSTYLE = {
  markerAlpha:     0.8,
  markerName:      'mediumCircle',
  markerTint:      KARTAVIEW_BLUE,
  viewfieldAlpha:  0.7,
  viewfieldName:   'viewfield',
  viewfieldTint:   KARTAVIEW_BLUE,
  scale:           1.0,
  fovWidth:        1,
  fovLength:       1
};


/**
 * PixiLayerKartaPhotos
 * @class
 */
export class PixiLayerKartaPhotos extends AbstractPixiLayer {

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
    return !!this.context.services.kartaview;
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
    const kartaview = context.services.kartaview;
    if (val && kartaview) {
      kartaview.startAsync()
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
    const usernames = photos.usernames;
    const showFlatPhotos = photos.showsPhotoType('flat');
    const showPanoramicPhotos = photos.showsPhotoType('panoramic');

    return markers.filter(marker => {
      const props = marker.props;
      if (marker.id === photos.currPhotoID) return true;  // always show current image - Rapid#1512

      if (!showFlatPhotos && !props.isPano) return false;
      if (!showPanoramicPhotos && props.isPano) return false;

      const timestamp = new Date(props.captured_at).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
      if (toTimestamp && toTimestamp < timestamp) return false;

      if (usernames && !usernames.includes(props.captured_by)) return false;

      return true;
    });
  }


  /**
   * filterSequences
   * Each sequence is represented as a GeoJSON LineString.
   * @param  {Array<GeoJSON>}  sequences - all sequences
   * @return {Array<GeoJSON>}  sequences with filtering applied
   */
  filterSequences(sequences) {
    const photos = this.context.systems.photos;
    const fromDate = photos.fromDate;
    const fromTimestamp = fromDate && new Date(fromDate).getTime();
    const toDate = photos.toDate;
    const toTimestamp = toDate && new Date(toDate).getTime();
    const usernames = photos.usernames;
    const showFlatPhotos = photos.showsPhotoType('flat');
    const showPanoramicPhotos = photos.showsPhotoType('panoramic');

    return sequences.filter(seq => {
      const props = seq.properties;
      if (!showFlatPhotos && !props.isPano) return false;
      if (!showPanoramicPhotos && props.isPano) return false;

      const timestamp = new Date(props.captured_at).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
      if (toTimestamp && toTimestamp < timestamp) return false;

      if (usernames && !usernames.includes(props.captured_by)) return false;

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
    const kartaview = this.context.services.kartaview;
    if (!kartaview?.started) return;

    const parentContainer = this.scene.groups.get('streetview');
    let markers = kartaview.getImages();
    let sequences = kartaview.getSequences();

    sequences = this.filterSequences(sequences);
    markers = this.filterMarkers(markers);

    // render sequences
    for (const d of sequences) {
      const dataID = d.id;
      const version = d.v || 0;
      const part = d.geoms.parts[0];

      // Check that this part has coordinates and is a LineString
      if (!part.world || part.type !== 'LineString') continue;

      const featureID = `${this.layerID}-sequence-${dataID}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        feature = new PixiFeatureLine(this, featureID);
        feature.style = LINESTYLE;
        feature.parentContainer = parentContainer;
        feature.container.zIndex = -100;  // beneath the markers (which should be [-90..90])
      }

      // If sequence data has changed, replace it.
      if (feature.v !== version) {
        feature.v = version;
        feature.setCoords(part.world);
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }

    // render markers
    for (const d of markers) {
      const dataID = d.id;
      const part = d.geoms.parts[0];

      // Check that this part has coordinates and is a Point
      if (!part.world || part.type !== 'Point') continue;

      const featureID = `${this.layerID}-photo-${dataID}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.parentContainer = parentContainer;
        feature.setCoords(part.world);
        feature.setData(dataID, d);

        if (d.props.sequenceID) {
          feature.addChildData(d.props.sequenceID, dataID);
        }
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        // Start with default style, and apply adjustments
        const style = Object.assign({}, MARKERSTYLE);

// todo handle pano
        if (feature.hasClass('selectphoto')) {  // selected photo style
          // style.viewfieldAngles = [this._viewerCompassAngle ?? d.props.ca];
          style.viewfieldAngles = Number.isFinite(d.props.ca) ? [d.props.ca] : [];
          style.viewfieldName = 'viewfield';
          style.viewfieldAlpha = 1;
          style.viewfieldTint = SELECTED;
          style.markerTint = SELECTED;
          style.scale = 2.0;
          //style.fovWidth = fovWidthInterp(this._viewerZoom);
          //style.fovLength = fovLengthInterp(this._viewerZoom);

        } else {
          style.viewfieldAngles = Number.isFinite(d.props.ca) ? [d.props.ca] : [];  // ca = camera angle
          style.viewfieldName = d.props.isPano ? 'pano' : 'viewfield';

          if (feature.hasClass('highlightphoto')) {  // highlighted photo style
            style.viewfieldAlpha = 1;
            style.viewfieldTint = SELECTED;
            style.markerTint = SELECTED;
          }
        }

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
    const kartaview = this.context.services.kartaview;
    if (!this.enabled || !kartaview?.started || zoom < MINZOOM) return;

    kartaview.loadTiles();
    this.renderMarkers(frame, viewport, zoom);
  }

}
