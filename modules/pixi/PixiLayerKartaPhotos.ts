import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine, type LineStyle } from './PixiFeatureLine.ts';
import { PixiFeaturePoint, type PointStyle } from './PixiFeaturePoint.ts';

import type { GeoJSON } from '../data/GeoJSON.ts';
import type { Marker } from '../data/Marker.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;
const KARTAVIEW_BLUE = 0x20c4ff;
const SELECTED = 0xffee00;

const LINESTYLE = {
  casing: { alpha: 0 },  // disable
  stroke: { alpha: 0.7, width: 4, color: KARTAVIEW_BLUE }
} as LineStyle;

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
} as PointStyle;


/**
 * PixiLayerKartaPhotos
 * @class
 */
export class PixiLayerKartaPhotos extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'kartaview';
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
    const gfx = context.systems.gfx!;
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
   * @param markers - all markers
   * @return markers with filtering applied
   */
  filterMarkers(markers: Marker[]): Marker[] {
    const photos = this.context.systems.photos!;
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

      const isPano = !!props.isPano;
      if (!showFlatPhotos && !isPano) return false;
      if (!showPanoramicPhotos && isPano) return false;

      const capturedAt = props.captured_at;
      if (typeof capturedAt === 'number' || typeof capturedAt === 'string') {
        const timestamp = new Date(capturedAt).getTime();
        if (fromTimestamp && fromTimestamp > timestamp) return false;
        if (toTimestamp && toTimestamp < timestamp) return false;
      }

      if (usernames && !usernames.includes(props.captured_by as string)) return false;

      return true;
    });
  }


  /**
   * filterSequences
   * Each sequence is represented as a GeoJSON LineString.
   * @param sequences - all sequences
   * @return sequences with filtering applied
   */
  filterSequences(sequences: GeoJSON[]): GeoJSON[] {
    const photos = this.context.systems.photos!;
    const fromDate = photos.fromDate;
    const fromTimestamp = fromDate && new Date(fromDate).getTime();
    const toDate = photos.toDate;
    const toTimestamp = toDate && new Date(toDate).getTime();
    const usernames = photos.usernames;
    const showFlatPhotos = photos.showsPhotoType('flat');
    const showPanoramicPhotos = photos.showsPhotoType('panoramic');

    return sequences.filter(sequence => {
      const props = sequence.props;

      const isPano = !!props.isPano;
      if (!showFlatPhotos && isPano) return false;
      if (!showPanoramicPhotos && isPano) return false;

      const capturedAt = props.captured_at;
      if (typeof capturedAt === 'number' || typeof capturedAt === 'string') {
        const timestamp = new Date(capturedAt).getTime();
        if (fromTimestamp && fromTimestamp > timestamp) return false;
        if (toTimestamp && toTimestamp < timestamp) return false;
      }

      const capturedBy = props.captured_by;
      if (typeof capturedBy === 'string') {
        if (usernames && !usernames.includes(capturedBy)) return false;
      }

      return true;
    });
  }


  /**
   * renderMarkers
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   */
  renderMarkers(frame: number, viewport: Viewport, zoom: number): void {
    const kartaview = this.context.services.kartaview;
    if (!kartaview?.started) return;

    const parentContainer = this.scene.groups.get('streetview')!;
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
        feature.setCoords(part);
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
        feature.setCoords(part);
        feature.setData(dataID, d);

        if (d.props.sequenceID) {
          feature.addChildData(d.props.sequenceID, dataID);
        }
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        // Start with default style, and apply adjustments
        const style: PointStyle = Object.assign({}, MARKERSTYLE);

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
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const kartaview = this.context.services.kartaview;
    if (!this.enabled || !kartaview?.started || zoom < MINZOOM) return;

    kartaview.loadTiles();
    this.renderMarkers(frame, viewport, zoom);
  }

}
