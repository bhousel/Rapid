import { scaleLinear, type ScaleLinear } from 'd3-scale';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { GeoJSON } from '../data/GeoJSON.ts';
import type { Marker } from '../data/Marker.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const MINZOOM = 12;
const MAPILLARY_GREEN = 0x05cb63;
const SELECTED = 0xffee00;

const LINESTYLE = {
  casing: { opacity: 0 },  // disable
  stroke: { opacity: 0.7, width: 4, color: MAPILLARY_GREEN }
} as Partial<MatchedStyle>;

const MARKERSTYLE: Partial<MatchedStyle> = {
  marker:    { color: MAPILLARY_GREEN, opacity: 0.8, image: 'mediumCircle' },
  viewfield: { color: MAPILLARY_GREEN, opacity: 0.7, image: 'viewfield', angles: [], scale: 1.0 }
};

const fovWidthInterp: ScaleLinear<number, number> = scaleLinear([90, 10], [1.3, 0.7]);
const fovLengthInterp: ScaleLinear<number, number> = scaleLinear([90, 10], [0.7, 1.5]);



/**
 * PixiLayerMapillaryPhotos
 * @class
 */
export class PixiLayerMapillaryPhotos extends AbstractPixiLayer {
  private _viewerBearing: number | null;
  private _viewerFov: number;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'mapillary';

    this._viewerBearing = null;
    this._viewerFov = 55;

    // Make sure the event handlers have `this` bound correctly
    this._bearingchanged = this._bearingchanged.bind(this);
    this._fovchanged = this._fovchanged.bind(this);

    if (this.supported) {
      const mapillary = this.context.services.mapillary;
      mapillary.on('bearingChanged', this._bearingchanged);
      mapillary.on('fovChanged', this._fovchanged);
      mapillary.on('imageChanged', () => {
        this._viewerFov = 55;
      });
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
   * _bearingchanged
   * Called whenever the viewer's compass bearing has changed (user pans around)
   * @param bearing - the new bearing value in degrees
   */
  private _bearingchanged(bearing: number): void {
    this._viewerBearing = bearing;
    this._dirtyCurrentPhoto();
  }


  /**
   * _fovchanged
   * Called whenever the viewer's field of view has changed (user zooms/unzooms)
   * @param fov - the new field of view value in degrees
   */
  private _fovchanged(fov: number): void {
    this._viewerFov = fov;
    this._dirtyCurrentPhoto();
  }


  /**
   * _dirtyCurrentPhoto
   * If we are interacting with the viewer (zooming / panning),
   * dirty the current photo so its view cone gets redrawn
   */
  private _dirtyCurrentPhoto(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const photos = context.systems.photos;

    const currPhotoID = photos?.currPhotoID;
    if (!currPhotoID) return;  // shouldn't happen, the user is zooming/panning an image

    // Dirty the feature(s) for this image so they will be redrawn.
    const featureIDs = this._dataHasFeature.get(currPhotoID) ?? new Set();
    for (const featureID of featureIDs) {
      const feature = this.features.get(featureID) as any;
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
    const gfx = context.systems.gfx!;
    const mapillary = context.services.mapillary;
    if (val && mapillary) {
      mapillary.startAsync()
        .then(() => gfx.immediateRedraw());
    }
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

      if (!showFlatPhotos && !props.isPano) return false;
      if (!showPanoramicPhotos && props.isPano) return false;

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
   * Note - a 'sequence' is now a FeatureCollection containing a LineString or MultiLineString, post Rapid#776
   * This is because we can get multiple linestrings for sequences that cross a vector tile boundary.
   * We just look at the first item in the features Array to determine whether to keep/filter the sequence.
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
      const geojson = sequence.props.geojson as GeoJSON.FeatureCollection | undefined;
      const first = geojson?.features?.[0];  // Expect a FeatureCollection, use the first feature
      if (!first) return false;

      const props = first.properties;
      if (!props) return false;
      if (!showFlatPhotos && !props.is_pano) return false;
      if (!showPanoramicPhotos && props.is_pano) return false;

      const timestamp = new Date(props.captured_at).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
      if (toTimestamp && toTimestamp < timestamp) return false;

      if (usernames && !usernames.includes(props.captured_by)) return false;

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
    const mapillary = this.context.services.mapillary;
    if (!mapillary?.started) return;

    // const showMarkers = (zoom >= MINMARKERZOOM);
    // const showViewfields = (zoom >= MINVIEWFIELDZOOM);

    const parentContainer = this.scene.groups.get('streetview')!;
    let sequences = mapillary.getSequences();
    let markers = mapillary.getData('images');

    sequences = this.filterSequences(sequences);
    markers = this.filterMarkers(markers);

    // render sequences
    for (const d of sequences) {
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a LineString
        const part = parts[i];
        if (!part.world || part.type !== 'LineString') continue;

        const featureID = `${this.layerID}-sequence-${dataID}-${i}`;
        let feature = this.features.get(featureID);

        if (!feature) {
          feature = new PixiFeatureLine(this, featureID);
          feature.style = LINESTYLE;
          feature.parentContainer = parentContainer;
          feature.container.zIndex = -100;  // beneath the markers (which should be [-90..90])
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.setCoords(part);
          feature.setData(dataID, d);
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport, zoom);
        this.retainFeature(feature, frame);
      }
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
        const style: Partial<MatchedStyle> = Object.assign({}, MARKERSTYLE);

        if (feature.hasClass('selectphoto')) {  // selected photo style
          style.viewfield!.angles = [this._viewerBearing ?? d.props.ca];
          style.viewfield!.image = 'viewfield';
          style.viewfield!.opacity = 1;
          style.viewfield!.color = SELECTED;
          style.marker = Object.assign({}, style.marker, { color: SELECTED });
          const s = 2.0;
          const fw = fovWidthInterp(this._viewerFov ?? 55);
          const fl = fovLengthInterp(this._viewerFov ?? 55);
          style.viewfield!.scale = [s * fw, s * fl];

        } else {
          style.viewfield!.angles = Number.isFinite(d.props.ca) ? [d.props.ca] : [];  // ca = camera angle
          style.viewfield!.image = d.props.isPano ? 'pano' : 'viewfield';

          if (feature.hasClass('highlightphoto')) {  // highlighted photo style
            style.viewfield!.opacity = 1;
            style.viewfield!.color = SELECTED;
            style.marker = Object.assign({}, style.marker, { color: SELECTED });
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
   * @param zoom - Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const mapillary = this.context.services.mapillary;
    if (!this.enabled || !mapillary?.started || zoom < MINZOOM) return;

    mapillary.loadTiles('images');
    this.renderMarkers(frame, viewport, zoom);
  }

}
