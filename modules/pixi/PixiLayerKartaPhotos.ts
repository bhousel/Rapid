import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { MarkerData } from '../data/MarkerData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';


const MINZOOM = 12;
const KARTAVIEW_BLUE = 0x20c4ff;
const SELECTED = 0xffee00;

const LINESTYLE: Partial<MatchedStyle> = {
  casing: { opacity: 0 },  // disable
  stroke: { opacity: 0.7, width: 4, color: KARTAVIEW_BLUE }
};

const MARKERSTYLE: Partial<MatchedStyle> = {
  marker: { color: KARTAVIEW_BLUE, opacity: 0.8, image: 'mediumCircle' },
  viewfield: { color: KARTAVIEW_BLUE, opacity: 0.7, image: 'viewfield', angles: [], scale: 1.0 }
};


/**
 * @class
 */
export class PixiLayerKartaPhotos extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'kartaview';
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if the KartaView service is registered
   */
  public get supported() {
    return !!this.context.services.kartaview;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled() {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the KartaView service when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val) {
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
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
    super.reset();
  }


  /**
   * Filters the photo markers by the current date range, username, and photo-type settings.
   * @param markers - all markers
   * @return markers with filtering applied
   */
  public filterMarkers(markers: MarkerData[]): MarkerData[] {
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
   * Each sequence is represented as a GeoJSONData LineString.
   * @param sequences - all sequences
   * @return sequences with filtering applied
   */
  public filterSequences(sequences: GeoJSONData[]): GeoJSONData[] {
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
   * Renders the KartaView photo markers and sequences for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderMarkers(frame: number, viewport: Viewport): void {
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
        feature.geometry = part;
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport);
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
        feature.geometry = part;
        feature.setData(dataID, d);

        if (d.props.sequenceID) {
          feature.addChildData(d.props.sequenceID as string, dataID);
        }
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        // Start with default style, and apply adjustments
        const style: Partial<MatchedStyle> = structuredClone(MARKERSTYLE);

// todo handle pano
        if (feature.hasClass('selectphoto')) {  // selected photo style
          // style.viewfield!.angles = [this._viewerCompassAngle ?? d.props.ca];
          style.viewfield!.angles = Number.isFinite(d.props.ca) ? [d.props.ca as number] : [];
          style.viewfield!.image = 'viewfield';
          style.viewfield!.opacity = 1;
          style.viewfield!.color = SELECTED;
          style.marker!.color = SELECTED;
          style.viewfield!.scale = 2.0;

        } else {
          style.viewfield!.angles = Number.isFinite(d.props.ca) ? [d.props.ca as number] : [];  // ca = camera angle
          style.viewfield!.image = d.props.isPano ? 'pano' : 'viewfield';

          if (feature.hasClass('highlightphoto')) {  // highlighted photo style
            style.viewfield!.opacity = 1;
            style.viewfield!.color = SELECTED;
            style.marker!.color = SELECTED;
          }
        }

        feature.style = style;
      }

      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const kartaview = this.context.services.kartaview;
    const viewZoom = viewport.transform.zoom;

    if (!this.enabled || !kartaview?.started || viewZoom < MINZOOM) return;

    kartaview.loadTiles();
    this.renderMarkers(frame, viewport);
  }

}
