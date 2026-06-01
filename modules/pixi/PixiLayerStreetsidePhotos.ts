import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { scaleLinear, type ScaleLinear } from 'd3-scale';

import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { MarkerData } from '../data/MarkerData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';


const MINZOOM = 12;
const STREETSIDE_TEAL = 0x0fffc4;
const SELECTED = 0xffee00;

const LINESTYLE: Partial<MatchedStyle> = {
  casing: { opacity: 0 },  // disable
  stroke: { opacity: 0.7, width: 4, color: STREETSIDE_TEAL }
};

const MARKERSTYLE: Partial<MatchedStyle> = {
  marker: { color: STREETSIDE_TEAL, opacity: 0.8, image: 'mediumCircle' },
  viewfield: { color: STREETSIDE_TEAL, opacity: 0.7, image: 'viewfield', angles: [], scale: 1.0 }
};

const fovWidthInterp: ScaleLinear<number, number> = scaleLinear([90, 10], [1.3, 0.7]);
const fovLengthInterp: ScaleLinear<number, number> = scaleLinear([90, 10], [0.7, 1.5]);



/**
 * This class renders the Bing Streetside map data - photo markers and traces.
 */
export class PixiLayerStreetsidePhotos extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'streetside';

    // Make sure the event handlers have `this` bound correctly
    this._dirtyCurrentPhoto = this._dirtyCurrentPhoto.bind(this);

    if (this.supported) {
      const streetside = this.context.services.streetside!;
      streetside.on('bearingChanged', this._dirtyCurrentPhoto);
      streetside.on('fovChanged', this._dirtyCurrentPhoto);
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
    super.reset();
  }


  /**
   * If we are interacting with the viewer (zooming / panning),
   * dirty the current photo so its view cone gets redrawn
   */
  protected _dirtyCurrentPhoto(): void {
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
   * Whether the Layer's service exists
   * @return  `true` if the Streetside service is registered
   */
  public get supported() {
    return !!this.context.services.streetside;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled() {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the Streetside service when enabling.
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
    const streetside = context.services.streetside;
    if (val && streetside) {
      streetside.startAsync()
        .then(() => gfx.immediateRedraw());
    }
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
   * Filters the photo sequences by the current date range, username, and photo-type settings.
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
      if (!showFlatPhotos && !props.isPano) return false;
      if (!showPanoramicPhotos && props.isPano) return false;

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
   * Renders the Streetside photo markers and sequences for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderMarkers(frame: number, viewport: Viewport): void {
    const streetside = this.context.services.streetside;
    if (!streetside?.started) return;

    const parentContainer = this.scene.groups.get('streetview')!;
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
        feature.geometry = part;
        feature.setData(dataID, d);
        feature.clearChildData(dataID);
        feature.addChildData(dataID, d.props.bubbleIDs as string);
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
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        // Start with default style, and apply adjustments
        const style: Partial<MatchedStyle> = structuredClone(MARKERSTYLE);

        if (feature.hasClass('selectphoto')) {  // selected photo style
          const viewer = streetside.viewer;
          const yaw = viewer?.getYaw() ?? 0;
          const fov = viewer?.getHfov() ?? 45;

          style.viewfield!.angles = [(d.props.ca as number) + yaw];
          style.viewfield!.image = 'viewfield';
          style.viewfield!.opacity = 1;
          style.viewfield!.color = SELECTED;
          style.marker!.color = SELECTED;
          const s = 2.0;
          const fw = fovWidthInterp(fov);
          const fl = fovLengthInterp(fov);
          style.viewfield!.scale = [s * fw, s * fl];

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
    const streetside = this.context.services.streetside;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !streetside?.started || viewZoom < MINZOOM) return;

    streetside.loadTiles();
    this.renderMarkers(frame, viewport);
  }

}

