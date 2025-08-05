import { scaleLinear } from 'd3-scale';

import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeatureLine } from './PixiFeatureLine.js';
import { PixiFeaturePoint } from './PixiFeaturePoint.js';

const MINZOOM = 12;
const STREETSIDE_TEAL = 0x0fffc4;
const SELECTED = 0xffee00;

const LINESTYLE = {
  casing: { alpha: 0 },  // disable
  stroke: { alpha: 0.7, width: 4, color: STREETSIDE_TEAL }
};

const MARKERSTYLE = {
  markerAlpha:     0.8,
  markerName:      'mediumCircle',
  markerTint:      STREETSIDE_TEAL,
  viewfieldAlpha:  0.7,
  viewfieldName:   'viewfield',
  viewfieldTint:   STREETSIDE_TEAL,
  scale:           1.0,
  fovWidth:        1,
  fovLength:       1
};

const fovWidthInterp = scaleLinear([90, 10], [1.3, 0.7]);
const fovLengthInterp = scaleLinear([90, 10], [0.7, 1.5]);



/**
 * PixiLayerStreetsidePhotos
 * @class
 */
export class PixiLayerStreetsidePhotos extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);

    // Make sure the event handlers have `this` bound correctly
    this._dirtyCurrentPhoto = this._dirtyCurrentPhoto.bind(this);

    if (this.supported) {
      const streetside = this.context.services.streetside;
      streetside.on('bearingChanged', this._dirtyCurrentPhoto);
      streetside.on('fovChanged', this._dirtyCurrentPhoto);
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
   * _dirtyCurrentPhoto
   * If we are interacting with the viewer (zooming / panning),
   * dirty the current photo so its view cone gets redrawn
   */
  _dirtyCurrentPhoto() {
    const context = this.context;
    const gfx = context.systems.gfx;
    const photos = context.systems.photos;

    const currPhotoID = photos.currPhotoID;
    if (!currPhotoID) return;  // shouldn't happen, the user is zooming/panning an image

    // Dirty the feature(s) for this image so they will be redrawn.
    const featureIDs = this._dataHasFeature.get(currPhotoID) ?? new Set();
    for (const featureID of featureIDs) {
      const feature = this.features.get(featureID);
      if (!feature) continue;
      feature._styleDirty = true;
    }
    gfx.immediateRedraw();
  }


  /**
   * supported
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.streetside;
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
    const streetside = context.services.streetside;
    if (val && streetside) {
      streetside.startAsync()
        .then(() => gfx.immediateRedraw());
    }
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

    return sequences.filter(sequence => {
      const props = sequence.props;
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
    const streetside = this.context.services.streetside;
    if (!streetside?.started) return;

    const parentContainer = this.scene.groups.get('streetview');
    let markers = streetside.getImages();
    let sequences = streetside.getSequences();

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

      // If sequence has changed, update data and coordinates.
      if (feature.v !== version) {
        feature.v = version;
        feature.setData(dataID, d);
        feature.setCoords(part);
        feature.clearChildData(dataID);
        d.props.bubbleIDs.forEach(bubbleID => feature.addChildData(dataID, bubbleID));
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
        feature.setCoords(part);
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        // Start with default style, and apply adjustments
        const style = Object.assign({}, MARKERSTYLE);

        if (feature.hasClass('selectphoto')) {  // selected photo style
          const viewer = streetside._viewer;
          const yaw = viewer?.getYaw() ?? 0;
          const fov = viewer?.getHfov() ?? 45;

          style.viewfieldAngles = [d.props.ca + yaw];
          style.viewfieldName = 'viewfield';
          style.viewfieldAlpha = 1;
          style.viewfieldTint = SELECTED;
          style.markerTint = SELECTED;
          style.scale = 2.0;
          style.fovWidth = fovWidthInterp(fov);
          style.fovLength = fovLengthInterp(fov);

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
    const streetside = this.context.services.streetside;
    if (!this.enabled || !streetside?.started || zoom < MINZOOM) return;

    streetside.loadTiles();
    this.renderMarkers(frame, viewport, zoom);
  }

}

