import { select as d3_select } from 'd3-selection';
import { Tiler, geoSphericalDistance } from '@rapid-sdk/math';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Marker, GeoJSON } from '../data/index.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { GeoJSONProps } from '../data/GeoJSON.ts';
import type { MarkerProps } from '../data/Marker.ts';
import type {
  ComponentSize as MlyComponentSize, FilterExpression, Image as MlyImage, NavigationDirection,
  OutlineTag, OutlineTagOptions, PolygonGeometry, SequenceComponent, TagComponent, Viewer,
  ViewerBearingEvent, ViewerImageEvent, ViewerOptions, ViewerStateEvent
} from 'mapillary-js';
import type { Tile, Vec2 } from '@rapid-sdk/math';

/** Mapillary API access token */
const accessToken = 'MLY|3376030635833192|f13ab0bdf6b2f7b99e0d8bd5868e1d88';
/** Base URL for the Mapillary Graph API */
const apiUrl = 'https://graph.mapillary.com/';
/** Base URL for Mapillary vector tile endpoints */
const baseTileUrl = 'https://tiles.mapillary.com/maps/vtp';

// see Rapid#1582 for discussion on computed vs original geometries.
/** Vector tile URL template for fetching street-level image data */
const imageTileUrl = `${baseTileUrl}/mly1_public/2/{z}/{x}/{y}?access_token=${accessToken}`;              // original
//const imageTileUrl = `${baseTileUrl}/mly1_computed_public/2/{z}/{x}/{y}?access_token=${accessToken}`;   // computed
/** Vector tile URL template for fetching map feature detection data */
const detectionTileUrl = `${baseTileUrl}/mly_map_feature_point/2/{z}/{x}/{y}?access_token=${accessToken}`;
/** Vector tile URL template for fetching traffic sign detection data */
const trafficSignTileUrl = `${baseTileUrl}/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=${accessToken}`;

/** Zoom level used by the Tiler for fetching Mapillary vector tiles */
const TILEZOOM = 14;


/** Inflight request tracking */
interface InflightEntry {
  /** Tile identifier this request is for */
  tileID: string;
  /** The fetch promise for this request */
  promise?: Promise<void>;
  /** AbortController to cancel the request if no longer needed */
  controller: AbortController;
}

/** Valid dataset identifiers for Mapillary tile data */
type MapillaryDatasetID = 'images' | 'signs' | 'detections';

/** Dataset-level cache entry */
interface DatasetCache {
  /** Last viewport version when tiles were loaded, used to skip redundant fetches */
  lastv: number | null;
}

/** Segmentation cache */
interface SegmentationCache {
  /** Map of segmentation ID to its decoded data */
  data: Map<string, SegmentationData>;
}

/** Internal cache for Mapillary tile data */
interface MapillaryCache {
  /** Cache state for image tiles */
  images: DatasetCache;
  /** Cache state for detection tiles */
  detections: DatasetCache;
  /** Cache state for traffic sign tiles */
  signs: DatasetCache;
  /** Decoded segmentation geometries keyed by segmentation ID */
  segmentations: SegmentationCache;
  /** Requests currently in flight, keyed by URL */
  inflight: Map<string, InflightEntry>;
  /** URLs that have already been fetched */
  loaded: Set<string>;
}

/** Properties passed to `_cacheImage` to create or update an image */
interface ImageSource {
  /** Mapillary image identifier */
  id: PhotoID;
  /** `[lon, lat]` coordinate of the image */
  loc: Vec2;
  /** ID of the sequence this image belongs to */
  sequenceID?: SequenceID;
  /** Unix timestamp when the image was captured */
  captured_at?: number;
  /** Username of the person who captured the image */
  captured_by?: string;
  /** Compass angle (heading) in degrees */
  ca?: number;
  /** Whether this is a panoramic (360°) image */
  isPano?: boolean;
}

/** Properties passed to `_cacheDetection` to create or update a detection */
interface DetectionSource {
  /** Mapillary detection identifier */
  id: DetectionID;
  /** `[lon, lat]` coordinate of the detection */
  loc?: Vec2;
  /** Array of nearby images from the Graph API */
  images?: any[];
  /** Unix timestamp when the detection was first seen */
  first_seen_at?: number;
  /** Unix timestamp when the detection was last seen */
  last_seen_at?: number;
  /** Detection class value (e.g. 'object--manhole') */
  value?: string;
  /** Direction the detection is facing, in degrees */
  aligned_direction?: number;
  /** Detection layer type: 'point' or 'traffic_sign' */
  object_type: string;
}

/** Properties passed to `_cacheSegmentation` */
interface SegmentationSource {
  /** Mapillary segmentation identifier */
  id: string;
  /** ID of the image this segmentation appears in */
  imageID: PhotoID;
  /** ID of the detection this segmentation belongs to, if known */
  detectionID?: DetectionID;
  /** Base64-encoded vector tile geometry */
  geometry: string;
  /** ISO 8601 timestamp when the segmentation was created */
  created_at?: string;
  /** Detection class value (e.g. 'object--manhole') */
  value: string;
}

/** Segmentation data stored in cache */
interface SegmentationData {
  /** Mapillary segmentation identifier */
  id: string;
  /** ID of the image this segmentation appears in */
  imageID: PhotoID;
  /** Decoded polygon geometry for the Mapillary viewer */
  geometry: PolygonGeometry;
  /** Detection class value (e.g. 'object--manhole') */
  value: string;
  /** ISO 8601 timestamp when the segmentation was created */
  created_at?: string;
  /** ID of the detection this segmentation belongs to, if known */
  detectionID?: DetectionID;
}


/** Properties for Mapillary photo markers */
export interface MapillaryImageProps extends MarkerProps {
  /** ID of the sequence this image belongs to */
  sequenceID?: SequenceID;
  /** Timestamp when the image was captured */
  captured_at?: number;
  /** Username of the person who captured the image */
  captured_by?: string;
  /** Compass angle (heading) in degrees */
  ca?: number;
  /** Whether this is a panoramic image */
  isPano?: boolean;
  /** IDs of segmentations associated with this image */
  segmentationIDs?: Set<string>;
}

/** Properties for Mapillary detection markers */
export interface MapillaryDetectionProps extends MarkerProps {
  /** Type of detection: 'point' or 'traffic_sign' */
  object_type: string;
  /** Array of nearby images from the API */
  images?: any[];
  /** Timestamp when the detection was first seen */
  first_seen_at?: number;
  /** Timestamp when the detection was last seen */
  last_seen_at?: number;
  /** Detection value from the API (e.g. 'object--manhole') */
  value?: string;
  /** Direction the detection is facing */
  aligned_direction?: number;
  /** ID of the closest image to this detection */
  bestImageID?: PhotoID;
  /** IDs of segmentations associated with this detection */
  segmentationIDs?: Set<string>;
}

/** A Mapillary image Marker with typed props */
export type MapillaryImage = Marker<MapillaryImageProps>;

/** A Mapillary detection Marker with typed props */
export type MapillaryDetection = Marker<MapillaryDetectionProps>;


/**
 * `MapillaryService`
 * This service loads photos, sequences, and detected items from the Mapillary API.
 * @see https://www.mapillary.com/developer/api-documentation
 *
 * It also manages the embedded Mapillary-JS photo viewer.
 * @see https://mapillary.github.io/mapillary-js/api
 *
 * Events available:
 *   `imageChanged`   - fired when a new image is visible in the viewer
 *   `bearingChanged` - fired when the viewer has been panned, receives the bearing value in degrees.
 *   `fovChanged`     - fired when the viewer has been zoomed, receives the fov value in degrees.
 *   `loadedImages`
 *   `loadedSigns`
 *   `loadedDetections`
 */
export class MapillaryService extends AbstractSystem {

  /** Promise tracking the load state of mapillary-js assets */
  _loadPromise: Promise<void> | null;
  /** Internal cache for tile data, inflight requests, and segmentations */
  _cache: MapillaryCache;
  /** ID of the currently selected image in the viewer */
  _selectedImageID: PhotoID | null;
  /** The embedded Mapillary JS photo viewer instance */
  _viewer: Viewer | null;
  /** Current filter expression applied to the viewer */
  _viewerFilter: FilterExpression;
  /** Tiler instance configured for Mapillary vector tile requests */
  _tiler: Tiler;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'mapillary';
    this.requiredDependencies = new Set(['l10n', 'photos', 'spatial']);
    this.optionalDependencies = new Set(['gfx', 'ui']);
    this.autoStart = false;

    this._loadPromise = null;

    this._cache = {} as MapillaryCache;
    this._selectedImageID = null;
    this._viewer = null;
    this._viewerFilter = ['all'] as FilterExpression;
    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;

    // Make sure the event handlers have `this` bound correctly
    this._keydown = this._keydown.bind(this);
    this.navigateForward = this.navigateForward.bind(this);
    this.navigateBackward = this.navigateBackward.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const eventManager = context.systems.gfx?.eventManager;

    // add mly-wrapper
    const $$wrapper: D3EnterSelection = context.container().select('.photoviewer .middle-middle')
      .selectAll('.mly-wrapper')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'photo-wrapper mly-wrapper')
      .attr('id', 'rapideditor-mly')
      .classed('hide', true);

    // add .photo-footer
    const $$footer: D3EnterSelection = $$wrapper
      .append('div')
      .attr('class', 'photo-footer');

    $$footer
      .append('div')
      .attr('class', 'photo-options');

    $$footer
      .append('div')
      .attr('class', 'photo-attribution');


    eventManager?.on('keydown', this._keydown);

    return this._startPromise = this._loadAssetsAsync()
      .then(() => this._initViewer())
      .then(() => { this._started = true; });
//      .catch(err => {
//        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
//        this._startPromise = null;
//      });
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    if (this._cache.inflight) {
      for (const req of this._cache.inflight.values()) {
        req.controller.abort();
      }
    }

    this._cache = {
      images:        { lastv: null },
      detections:    { lastv: null },
      signs:         { lastv: null },
      segmentations: { data: new Map() },   // Map<segmentationID, SegmentationData>
      inflight: new Map(),  // Map<url, InflightEntry>
      loaded:   new Set()   // Set<url>
    };

    const spatial = this.context.systems.spatial!;
    spatial.clearCache('mapillary-images');
    spatial.clearCache('mapillary-sequences');
    spatial.clearCache('mapillary-detections');

    return Promise.resolve();
  }


  /**
   * imageURL
   * Returns the url to view an image on Mapillary
   * @param  imageID - the imageID to link to
   * @return  The url
   */
  imageURL(imageID: PhotoID): string {
    const context = this.context;
    const gfx = context.systems.gfx;

    let extras = '';
    if (gfx?.scene) {
      // are either of these layers enabled?
      const layers = gfx.scene.layers;
      const detectionsLayer = layers.get('mapillary-detections');
      const signsLayer = layers.get('mapillary-signs');

      if (detectionsLayer?.enabled)  extras += '&mapFeature=all';
      if (signsLayer?.enabled)       extras += '&trafficSign=all';
    }

    return `https://www.mapillary.com/app/?pKey=${imageID}&focus=photo${extras}`;
  }


  /**
   * getImage
   * Return an image from the cache.
   * @param  imageID - imageID to get
   * @return  The image, or `undefined` if not found
   */
  getImage(imageID: PhotoID): MapillaryImage | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getData<MapillaryImage>('mapillary-images', imageID);
  }


  /**
   * getSequence
   * Return a sequence from the cache.
   * @param  sequenceID - sequenceID to get
   * @return  The sequence, or `undefined` if not found
   */
  getSequence(sequenceID: SequenceID): GeoJSON | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getData<GeoJSON>('mapillary-sequences', sequenceID);
  }


  /**
   * getDetection
   * Return a detection from the cache.
   * @param  detectionID - detectionID to get
   * @return  The detection, or `undefined` if not found
   */
  getDetection(detectionID: DetectionID): MapillaryDetection | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getData<MapillaryDetection>('mapillary-detections', detectionID);
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param  datasetID - one of 'images', 'signs', or 'detections'
   * @return  Array of Markers
   */
  getData(datasetID: MapillaryDatasetID): Marker[] {

    const spatial = this.context.systems.spatial!;

    if (datasetID === 'images') {
      return spatial.getVisibleData('mapillary-images')
        .map(hit => hit.contents) as Marker[];

    } else {  // both signs and detections are currently stored in the `detections` cache
      const type = (datasetID === 'signs') ? 'traffic_sign' : 'point';
      return spatial.getVisibleData('mapillary-detections')
        .map(hit => (hit.contents as Marker))
        .filter(d => d.props.object_type === type);
    }
  }


  /**
   * getSequences
   * Get already loaded sequence data that appears in the current map view
   * @return  Array of GeoJSON sequences
   */
  getSequences(): GeoJSON[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleData('mapillary-sequences')
      .map(hit => hit.contents) as GeoJSON[];
  }


  /**
   * getDetectionPresetID
   * Convert a detection type to a preset id.  This is just a big lookup for now.
   * @param  detectionType - the type of detection  (e.g. 'object--manhole')
   * @return  the presetID to use for this detection type (e.g. 'man_made/manhole')
   */
  getDetectionPresetID(detectionType: string): PresetID | undefined {
    const lookup: Record<string, string> = {
      'construction--barrier--temporary':                  'highway/construction',          // Temporary Barrier
      'construction--flat--crosswalk-plain':               'highway/footway',               // Crosswalk - Plain
      'construction--flat--driveway':                      'amenity/parking/street-side',   // Driveway
      'marking--discrete--arrow--left':                    'traffic_sign',                  // Lane Marking - Arrow (Left)
      'marking--discrete--arrow--right':                   'traffic_sign',                  // Lane Marking - Arrow (Right)
      'marking--discrete--arrow--split-left-or-straight':  'traffic_sign',                  // Lane Marking - Arrow (Split Left or Straight)
      'marking--discrete--arrow--split-right-or-straight': 'traffic_sign',                  // Lane Marking - Arrow (Split Right or Straight)
      'marking--discrete--arrow--straight':                'traffic_sign',                  // Lane Marking - Arrow (Straight)
      'marking--discrete--crosswalk-zebra':                'highway/footway',               // Lane Marking - Crosswalk
      'marking--discrete--give-way-row':                   'highway/give_way',              // Lane Marking - Give Way (Row)
      'marking--discrete--give-way-single':                'highway/give_way',              // Lane Marking - Give Way (Single)
      'marking--discrete--other-marking':                  'traffic_sign',                  // Lane Marking - Other
      'marking--discrete--stop-line':                      'highway/stop',                  // Lane Marking - Stop Line
      'marking--discrete--symbol--bicycle':                'cycleway/asl',                  // Lane Marking - Symbol (Bicycle)
      'marking--discrete--text':                           'tourism/information',           // Lane Marking - Text
      'object--banner':                                    'advertising',                   // Banner
      'object--bench':                                     'amenity/bench',                 // Bench
      'object--bike-rack':                                 'amenity/bicycle_parking',       // Bike Rack
      'object--catch-basin':                               'man_made/manhole/drain',        // Catch Basin
      'object--cctv-camera':                               'man_made/surveillance/camera',  // CCTV Camera
      'object--fire-hydrant':                              'emergency/fire_hydrant',        // Fire Hydrant
      'object--junction-box':                              'man_made/street_cabinet',       // Junction Box
      'object--mailbox':                                   'amenity/letter_box',            // Mailbox
      'object--manhole':                                   'man_made/manhole',              // Manhole
      'object--parking-meter':                             'amenity/parking/street-side',   // Parking Meter
      'object--phone-booth':                               'amenity/telephone',             // Phone Booth
      'object--sign--advertisement':                       'advertising/billboard',         // Signage - Advertisement
      'object--sign--information':                         'tourism/information/board',     // Signage - Information
      'object--sign--store':                               'advertising',                   // Signage - Store
      'object--street-light':                              'highway/street_lamp',           // Street Light
      'object--support--pole':                             'man_made/mast',                 // Pole
      'object--support--traffic-sign-frame':               'man_made/mast',                 // Traffic Sign Frame
      'object--support--utility-pole':                     'man_made/utility_pole',         // Utility Pole
      'object--traffic-cone':                              'highway/construction',          // Traffic Cone
      'object--traffic-light--cyclists':                   'cycleway/asl',                  // Traffic Light - Cyclists
      'object--traffic-light--general-horizontal':         'highway/traffic_signals',       // Traffic Light - General (Horizontal)
      'object--traffic-light--general-single':             'highway/traffic_signals',       // Traffic Light - General (Single)
      'object--traffic-light--general-upright':            'highway/traffic_signals',       // Traffic Light - General (Upright)
      'object--traffic-light--other':                      'highway/traffic_signals',       // Traffic Light - Other
      'object--traffic-light--pedestrians':                'highway/traffic_signals',       // Traffic Light - Pedestrians
      'object--trash-can':                                 'amenity/waste_basket',          // Trash Can
      'object--water-valve':                               'man_made/water_tap'             // Water Valve
    };

    return lookup[detectionType];
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param  datasetID - one of 'images', 'signs', or 'detections'
   */
  loadTiles(datasetID: MapillaryDatasetID): void {
    // exit early if the view is unchanged since the last time we loaded tiles
    const viewport = this.context.viewport;
    if (this._cache[datasetID].lastv === viewport.v) return;
    this._cache[datasetID].lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const req of this._cache.inflight.values()) {
      if (!req.tileID) continue;
      const needed = tiles.find(tile => tile.id === req.tileID);
      if (!needed) {
        req.controller.abort();
      }
    }

    for (const tile of tiles) {
      this._loadTileAsync(datasetID, tile);
    }
  }


  /**
   * filterViewer
   * Apply filters to the Mapillary viewer
   * The filters settings are stored in the PhotoSystem
   */
  filterViewer(): FilterExpression {
    const photos = this.context.systems.photos!;
    const showsPano = photos.showsPanoramic();
    const showsFlat = photos.showsFlat();
    const fromDate = photos.fromDate;
    const toDate = photos.toDate;
    const filter: FilterExpression = ['all'];

    if (!showsPano) filter.push([ '!=', 'cameraType', 'spherical' ]);
    if (!showsFlat && showsPano) filter.push(['==', 'pano' as any, true]);
    if (fromDate) {
      filter.push(['>=', 'capturedAt', new Date(fromDate).getTime()]);
    }
    if (toDate) {
      filter.push(['>=', 'capturedAt', new Date(toDate).getTime()]);
    }

    if (this._viewer) {
      this._viewer.setFilter(filter);
    }
    this._viewerFilter = filter;

    return filter;
  }


  /** Navigate the viewer to the next image in the sequence */
  navigateForward(): void {
    const mapillary = (window as any).mapillary;
    this._navigate(mapillary.NavigationDirection.Next);
  }

  /** Navigate the viewer to the previous image in the sequence */
  navigateBackward(): void {
    const mapillary = (window as any).mapillary;
    this._navigate(mapillary.NavigationDirection.Prev);
  }

  /**
   * _navigate
   * Move the viewer in the given navigation direction.
   * Silently catches errors when the end of a sequence is reached.
   * @param  dir - The navigation direction (Next or Prev)
   */
  _navigate(dir: NavigationDirection): void {
    this._viewer?.moveDir(dir).catch(
      () => { // errs out if end of sequence reached, just don't print anything
      },
    );
  }


  /**
   * showViewer
   * Shows the photo viewer, and hides all other photo viewers
   */
  showViewer(): void {
    const $viewer: D3Selection = this.context.container().select('.photoviewer')
      .classed('hide', false);

    const isHidden = $viewer.selectAll('.photo-wrapper.mly-wrapper.hide').size();

    if (isHidden && this._viewer) {
      $viewer
        .selectAll('.photo-wrapper:not(.mly-wrapper)')
        .classed('hide', true);

      $viewer
        .selectAll('.photo-wrapper.mly-wrapper')
        .classed('hide', false);

      this._viewer.resize();
    }
  }


  /**
   * hideViewer
   * Hides the photo viewer and clears the currently selected image
   */
  hideViewer(): void {
    const context = this.context;
    context.systems.photos!.selectPhoto(null);

    if (this._viewer) {
      this._viewer.getComponent<SequenceComponent>('sequence').stop();
    }

    const $viewer: D3Selection = context.container().select('.photoviewer');
    $viewer
      .classed('hide', true)
      .selectAll('.photo-wrapper')
      .classed('hide', true);

    this._selectedImageID = null;
    this.emit('imageChanged');
  }


  /**
   * selectImageAsync
   * Note:  most code should call `PhotoSystem.selectPhoto(layerID, photoID)` instead.
   * PhotoSystem will manage the state of what the user clicked on, and then call this function.
   *
   * @param  imageID - the id of the image to select
   * @return Promise that resolves to the image after it has been selected
   */
  selectImageAsync(imageID: PhotoID | null): Promise<Marker | void> {
    this._clearSegmentations();

    if (!imageID) {
      this._updatePhotoFooter(null);  // reset
      return Promise.resolve();  // do nothing
    }

    // We are already showing this image, this means we won't get events like imagechanged or moveend.
    // This means we will need to update segmentations here..
    if (this._selectedImageID === imageID) {
      const context = this.context;
      const spatial = context.systems.spatial!;
      const image = spatial.getData<MapillaryImage>('mapillary-images', imageID);

      if (this._shouldShowSegmentations()) {
        return this._loadImageSegmentationsAsync(image!)
          .then(segmentationIDs => this._showSegmentations(segmentationIDs as Set<string>))
          .catch(err => console.error('mly3', err))   // eslint-disable-line no-console
          .then(() => Promise.resolve(image));
      } else {
        return Promise.resolve(image);
      }

    } else {  // switch image

      return this.startAsync()
        .then(() => this._viewer!.moveTo(imageID))
        .then((mlyImage: MlyImage) => {
          // see Rapid#1582 for discussion on computed vs original geometries.
          const image = this._cacheImage({
            id:          mlyImage.id.toString(),
            loc:        [mlyImage.originalLngLat.lng, mlyImage.originalLngLat.lat],        // original
            // loc:        [mlyImage.computedLngLat.lng, mlyImage.computedLngLat.lat],     // computed
            sequenceID:  mlyImage.sequenceId.toString(),
            captured_at: mlyImage.capturedAt,
            captured_by: mlyImage.creatorUsername,
            ca:          mlyImage.originalCompassAngle         // original
            // ca:          mlyImage.computedCompassAngle      // computed
          });

          this._selectedImageID = imageID;
          this._updatePhotoFooter(imageID);

          return Promise.resolve(image);  // pass the image to anything that chains off this Promise
        })
        .catch(err => {
          if (err.name === 'CancelMapillaryError') return;  // we tried to move to the same image twice, ignore
          console.error('mly3', err);   // eslint-disable-line no-console
        });
      }
  }


  /**
   * selectDetectionAsync
   * Note:  most code should call `PhotoSystem.selectDetection(layerID, photoID)` instead.
   * PhotoSystem will manage the state of what the user clicked on, and then call this function.
   *
   * `selectPhotoAsync` will probably happen immediately after this resolves,
   *  as the PhotoSystem attempts to select the photo that best shows this detection.
   *
   * @param  detectionID - the id of the detection to select
   * @return Promise that resolves to the detection after it has been selected
   */
  selectDetectionAsync(detectionID: DetectionID | null): Promise<Marker | void> {
    this._clearSegmentations();
    if (!detectionID) {
      return Promise.resolve();  // do nothing
    }

    return this.startAsync()
      .then(() => this._loadDetectionAsync(detectionID))
      .then(detection => {
        if (!detection) return;
        // optionally, load segmentations..
        if (this._shouldShowSegmentations()) {
          return this._loadDetectionSegmentationsAsync(detection as MapillaryDetection)
            .catch(err => console.error('mly3', err))   // eslint-disable-line no-console
            .then(() => Promise.resolve(detection));
        } else {
          return Promise.resolve(detection);  // pass the detection to anything that chains off this Promise
        }
      })
      .catch(err => console.error('mly3', err));   // eslint-disable-line no-console
  }


  /**
   * _keydown
   * Handler for keydown events on the window, but only if the photo viewer is visible.
   * @param  e - A DOM KeyboardEvent
   */
  _keydown(e: KeyboardEvent): void {
    const context = this.context;
    const eventManager = context.systems.gfx?.eventManager;
    const photos = context.systems.photos!;

    // Test environment?
    if (!eventManager) return;
    // Ignore keypresses unless we actually have a Mapillary photo showing
    if (!photos.isViewerShowing() || photos.currPhotoLayerID !== 'mapillary') return;
    // Ignore modified keypresses (user might be panning or rotating)
    if (eventManager.modifierKeys.size) return;

    // Only allow key navigation if the user doesn't have something
    // more important focused - like a input, textarea, menu, etc.
    // and only allow key nav if we're showing the viewer and have the body or the map clicked
    const activeElement = document.activeElement?.tagName ?? 'BODY';
    const mapillaryViewerClass = document.activeElement?.className.startsWith('mapillary');
    if (activeElement !== 'BODY' && !mapillaryViewerClass) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      this.navigateBackward();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      this.navigateForward();
    }
  }


  /**
   * _updatePhotoFooter
   * Update the photo attribution section of the image viewer
   * @param  imageID - the new imageID
   */
  _updatePhotoFooter(imageID: PhotoID | null): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const spatial = context.systems.spatial!;
    const $wrapper: D3Selection = context.container().select('.photoviewer .mly-wrapper');
    const $attribution: D3Selection = $wrapper.selectAll('.photo-attribution').html('&nbsp;');  // clear DOM content

    if (!imageID) return;
    const image = spatial.getData<MapillaryImage>('mapillary-images', imageID);
    if (!image) return;

    if (image.props.captured_by) {
      $attribution
        .append('span')
        .attr('class', 'captured_by')
        .text(image.props.captured_by);

      $attribution
        .append('span')
        .text('|');
    }

    if (image.props.captured_at) {
      $attribution
        .append('span')
        .attr('class', 'captured_at')
        .text(l10n.displayShortDate(image.props.captured_at));

      $attribution
        .append('span')
        .text('|');
    }

    $attribution
      .append('a')
      .attr('class', 'image-link')
      .attr('target', '_blank')
      .attr('href', this.imageURL(imageID!))
      .text('mapillary.com');
  }


  /**
   * _shouldShowSegmentations
   * Determine whether segmentations should be shown in the mapillary viewer.
   * @return  `true` if they should be shown, `false` if not
   */
  _shouldShowSegmentations(): boolean {
    const gfx = this.context.systems.gfx;
    if (!gfx?.scene) return false;

    // are either of these layers enabled?
    const layers = gfx.scene.layers;
    const layerIDs = ['mapillary-detections', 'mapillary-signs'];
    return layerIDs.some(layerID => {
      const layer = layers.get(layerID);
      return layer && layer.enabled;
    });
  }


  /**
   * _clearSegmentations
   * Remove all segmentations (aka "tags") from Mapillary viewer.
   */
  _clearSegmentations(): void {
    if (!this._viewer) return;   // called too early?
    this._viewer.getComponent<TagComponent>('tag').removeAll();
  }


  /**
   * _showSegmentations
   * Segmentations are called "tags" in the Mapillary viewer.
   * Here we are create a tag for each segmentationID found in the current image.
   * @param  segmentationIDs - the segmentation ids to show
   */
  _showSegmentations(segmentationIDs: Set<string>): void {
    if (!this._viewer) return;  // called too early?

    this._clearSegmentations();

    const tagComponent = this._viewer.getComponent<TagComponent>('tag');
    for (const segmentationID of segmentationIDs) {
      const data = this._cache.segmentations.data.get(segmentationID);
      if (!data) continue;
      const tag = this._makeTag(data);
      if (tag) {
        tagComponent.add([tag]);
      }
    }
  }


  /**
   * _makeTag
   * Segmentations are called "tags" in the Mapillary viewer.
   * Here we create a single tag for the given segmentation.
   * @param  segmentation - the segmentation to make a tag for
   */
  _makeTag(segmentation: SegmentationData): OutlineTag | undefined {
    const valueParts = segmentation.value.split('--');
    if (!valueParts.length) return;

    let text: string | undefined;
    let color = 0x05cb63;  // mapillary green
    // let color = 0xffffff;

    const context = this.context;
    const photos = context.systems.photos!;
    const currDetectionID = photos.currDetectionID;

    if (currDetectionID === segmentation.detectionID) {
      color = 0xffff00;
      text = valueParts[1];
      if (text === 'flat' || text === 'discrete' || text === 'sign') {
        text = valueParts[2];
      }
      text = text.replace(/-/g, ' ');
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    const mapillary = (window as any).mapillary;
    const options: OutlineTagOptions = {
      text: text,
      textColor: color,
      lineColor: color,
      lineWidth: 3,
      fillColor: color,
      fillOpacity: 0.4
    };
    const tag: OutlineTag = new mapillary.OutlineTag(
      segmentation.id,
      segmentation.geometry,
      options
    );

    return tag;
  }


  /**
   * _loadTileAsync
   * Load a vector tile of data for the given dataset.
   * This uses `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=XXX`
   * @see    https://www.mapillary.com/developer/api-documentation#vector-tiles
   * @param  datasetID - one of 'images', 'signs', or 'detections'
   * @param  tile - a tile object
   * @return  Promise settled when the request is completed
   */
  _loadTileAsync(datasetID: MapillaryDatasetID, tile: Tile): Promise<void> {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;

    const tileUrls: Record<MapillaryDatasetID, string> = {
      images: imageTileUrl,
      signs: trafficSignTileUrl,
      detections: detectionTileUrl
    };
    let url: string = tileUrls[datasetID];

    url = url
      .replace('{x}', tile.xyz[0].toString())
      .replace('{y}', tile.xyz[1].toString())
      .replace('{z}', tile.xyz[2].toString());

    const cache = this._cache;

    if (cache.loaded.has(url)) {
      return Promise.resolve();  // already done
    }

    let req: InflightEntry | undefined = cache.inflight.get(url);
    if (req) {
      return req.promise!;
    } else {
      req = {
        tileID: tile.id,
        controller: new AbortController()
      };
    }

    const prom = fetch(url, { signal: req.controller.signal })
      .then(utilFetchResponse)
      .then(buffer => {
        cache.loaded.add(url);
        if (!buffer) {
          throw new Error('No Data');
        }

        this._gotTile(buffer, tile);

        gfx?.deferredRedraw();

        if (datasetID === 'images') {
          spatial.addTiles('mapillary-images', [tile]);
          this.emit('loadedImages');
        } else if (datasetID === 'signs') {
          this.emit('loadedSigns');
        } else if (datasetID === 'detections') {
          // spatial.addTiles('mapillary-detections', [tile]);  /// detections and signs are currently shared, so idk.
          this.emit('loadedDetections');
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return;          // ok
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        cache.loaded.add(url);  // don't retry
      })
      .finally(() => {
        cache.inflight.delete(url);
      });

    req.promise = prom;
    cache.inflight.set(url, req);
    return prom;
  }


  /**
   * _gotTile
   * Process vector tile data
   * @see    https://www.mapillary.com/developer/api-documentation#vector-tiles
   * @param  buffer - the tile data
   * @param  tile - a tile object
   */
  _gotTile(buffer: ArrayBuffer, tile: Tile): void {
    const context = this.context;
    const spatial = context.systems.spatial!;

    const vectorTile = new VectorTile(new Protobuf(buffer));

    if (vectorTile.layers.hasOwnProperty('image')) {
      const layer = vectorTile.layers.image;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(tile.xyz[0], tile.xyz[1], tile.xyz[2]);
        if (!feature) continue;

        this._cacheImage({
          id:          feature.properties!.id.toString(),
          loc:         (feature.geometry as any).coordinates,
          sequenceID:  feature.properties!.sequence_id.toString(),
          captured_at: feature.properties!.captured_at,
          ca:          feature.properties!.compass_angle,
          isPano:      feature.properties!.is_pano,
        });
      }
    }

    if (vectorTile.layers.hasOwnProperty('sequence')) {
      const layer = vectorTile.layers.sequence;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(tile.xyz[0], tile.xyz[1], tile.xyz[2]);
        if (!feature) continue;

        const sequenceID = feature.properties!.id.toString();
        let sequence = spatial.getData<GeoJSON>('mapillary-sequences', sequenceID);
        if (!sequence) {
          const props = {
            id:         sequenceID,
            serviceID:  this.id as ServiceID,
            type:       'sequence',
            geojson: {
              type:      'FeatureCollection',
              features:  []
            }
          };
          sequence = new GeoJSON(context, props as Partial<GeoJSONProps>);
        }
        (sequence.props.geojson as GeoJSON.FeatureCollection).features.push(feature);  // updating it in-place, hope this is ok.
        sequence.updateGeometry().touch();
        spatial.replaceData('mapillary-sequences', sequence);
      }
    }

    // 'point' and 'traffic_sign' are both detection layers.
    // Both of these are stored in the `detections` cache.
    for (const type of ['point', 'traffic_sign']) {
      if (!vectorTile.layers.hasOwnProperty(type)) continue;

      const layer = vectorTile.layers[type];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(tile.xyz[0], tile.xyz[1], tile.xyz[2]);
        if (!feature) continue;

        // Note that the tile API _does not_ give us `images` or `aligned_direction`
        this._cacheDetection({
          id:            feature.properties!.id.toString(),
          loc:           (feature.geometry as any).coordinates,
          first_seen_at: feature.properties!.first_seen_at,
          last_seen_at:  feature.properties!.last_seen_at,
          value:         feature.properties!.value,
          object_type:   type
        });
      }
    }
  }


  /**
   * _loadDetectionAsync
   * Get the details for a given detected feature (object or sign)
   * This uses `https://graph.mapillary.com/<map_feature_id>`
   * This API call gives us 2 things the tile API does not: `images` and `aligned_direction`
   * @see    https://www.mapillary.com/developer/api-documentation#map-feature
   * @param  detectionID - the detection to load
   * @return  Promise settled with the detection details
   */
  _loadDetectionAsync(detectionID: DetectionID): Promise<MapillaryDetection | void> {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;

    // Is data is cached already and includes the `images` Array?  If so, resolve immediately.
    const detection = spatial.getData<MapillaryDetection>('mapillary-detections', detectionID);
    if (Array.isArray(detection?.props?.images)) {
      return Promise.resolve(detection);
    }

    // Not cached, load it..
    const fields = 'id,geometry,aligned_direction,first_seen_at,last_seen_at,object_value,object_type,images';
    const url = `${apiUrl}/${detectionID}?access_token=${accessToken}&fields=${fields}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(response => {
        if (!response) {
          throw new Error('No Data');
        }

        // `response.object_type` seems to be 'mvd_fast' or 'trafficsign' ??
        const type = (response.object_type === 'trafficsign') ? 'traffic_sign' : 'point';

        // Note that the graph API _does_ give us `images` and `aligned_direction`
        // (but sometimes not `geometry`!? see Rapid#1557)
        const detection = this._cacheDetection({
          id:                 response.id.toString(),
          loc:                response.geometry?.coordinates,
          images:             response.images?.data,
          first_seen_at:      response.first_seen_at,
          last_seen_at:       response.last_seen_at,
          value:              response.object_value,
          aligned_direction:  response.aligned_direction,
          object_type:        type
        });

        gfx?.immediateRedraw();
        return detection;
      })
      .catch(err => {
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      });
  }


  /**
   * _loadImageSegmentationsAsync
   * Get all segmentation data for the given image.
   * It is nuts to me that we can not get the actual detected object ID from this API.
   * To workaround that limitation, we will just call the same api from `selectDetectionAsync` too.
   * This uses `https://graph.mapillary.com/<image_id>/detections`
   * @see    https://www.mapillary.com/developer/api-documentation#detection
   * @param  image - the image to get segmentation data for
   * @return  Promise settled with the segmentation details
   */
  _loadImageSegmentationsAsync(image: MapillaryImage): Promise<Set<string> | void> {
    if (image.props.segmentationIDs) {
      return Promise.resolve(image.props.segmentationIDs);
    }

    // Not cached, load it..
    const imageID = image.id;
    const fields = 'id,created_at,geometry,image,value';
    const url = `${apiUrl}/${imageID}/detections?access_token=${accessToken}&fields=${fields}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(response => {
        if (!response) {
          throw new Error('No Data');
        }

        const segmentationIDs = new Set<string>();
        for (const d of response.data || []) {
          const segmentationID = d.id.toString();
          const segmentation = this._cacheSegmentation({
            id:          segmentationID,
            imageID:     imageID,
            // detectionID:    can't be done!?
            geometry:    d.geometry,
            created_at:  d.created_at,
            value:       d.value
          });

          // Add segmentation to image..
          if (segmentation) {
            segmentationIDs.add(segmentationID);
          }

          (image.props as Partial<MapillaryImageProps>).segmentationIDs = segmentationIDs;
          image.touch();
        }

        return segmentationIDs;
      })
      .catch(err => {
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      });
  }


  /**
   * _loadDetectionSegmentationsAsync
   * Get all segmentation data for the given detection.
   * Basically it's the same as `_loadImageSegmentationsAsync`, but using the detectionID instead.
   * because for some reason the API doesn't give the detectionID when called with the imageID.
   * This uses `https://graph.mapillary.com/<image_id>/detections`
   * @see    https://www.mapillary.com/developer/api-documentation#detection
   * @param  detection - the detection to get segmentation data for
   * @return  Promise settled with the segmentation details
   */
  _loadDetectionSegmentationsAsync(detection: MapillaryDetection): Promise<Set<string> | void> {
    if (detection.props.segmentationIDs) {
      return Promise.resolve(detection.props.segmentationIDs);
    }

    // Not cached, load it..
    const detectionID = detection.id;
    const fields = 'id,created_at,geometry,image,value';
    const url = `${apiUrl}/${detectionID}/detections?access_token=${accessToken}&fields=${fields}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(response => {
        if (!response) {
          throw new Error('No Data');
        }

        const segmentationIDs = new Set<string>();
        for (const d of response.data || []) {
          const segmentationID = d.id.toString();
          const segmentation = this._cacheSegmentation({
            id:           segmentationID,
            detectionID:  detectionID,
            imageID:      d.image.id.toString(),
            geometry:     d.geometry,
            created_at:   d.created_at,
            value:        d.value
          });

          // Add segmentation to detection..
          if (segmentation) {
            segmentationIDs.add(segmentationID);
          }
        }

        (detection.props as Partial<MapillaryDetectionProps>).segmentationIDs = segmentationIDs;
        detection.touch();

        return segmentationIDs;
      })
      .catch(err => {
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      });
  }


  /**
   * _loadAssetsAsync
   * Load the Mapillary JS and CSS files into the document head
   * @return Promise resolved when both files have been loaded
   */
  _loadAssetsAsync(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;

    const assets = this.context.systems.assets!;

    // Tell the AssetSystem what to load..
    const latestPath = 'https://cdn.jsdelivr.net/npm/mapillary-js@4/dist';
    const localPath = 'data/modules/mapillary-js';

    assets.registerAsset('mapillary_css', {
      latest: `${latestPath}/mapillary.min.css`,
      local:  `${localPath}/mapillary.css`  // note no .min
    });
    assets.registerAsset('mapillary_js', {
      latest: `${latestPath}/mapillary.min.js`,
      local:  `${localPath}/mapillary.js`  // note no .min
    });

    return this._loadPromise = new Promise((resolve, reject) => {
      let count = 0;
      const loaded = () => {
        if (++count === 2) resolve();
      };

      const $head: D3Selection = d3_select('head');

      $head.selectAll('#rapideditor-mapillary-css')
        .data([0])
        .enter()
        .append('link')
        .attr('id', 'rapideditor-mapillary-css')
        .attr('rel', 'stylesheet')
        .attr('crossorigin', 'anonymous')
        .attr('href', assets.getAssetURL('mapillary_css'))
        .on('load', loaded)
        .on('error', reject);

      $head.selectAll('#rapideditor-mapillary-js')
        .data([0])
        .enter()
        .append('script')
        .attr('id', 'rapideditor-mapillary-js')
        .attr('crossorigin', 'anonymous')
        .attr('src', assets.getAssetURL('mapillary_js'))
        .on('load', loaded)
        .on('error', reject);
    });
  }


  /**
   * _initViewer
   * Initialize the embedded Mapillary JS photo viewer and wire up event listeners.
   */
  _initViewer(): void {
    const mapillary = (window as any).mapillary;
    if (!mapillary) throw new Error('mapillary not loaded');
    if (!mapillary.isSupported()) throw new Error('mapillary not supported');

    const context = this.context;
    const photos = context.systems.photos!;
    const spatial = context.systems.spatial!;
    const ui = context.systems.ui;

    const opts: ViewerOptions = {
      accessToken: accessToken,
      component: {
        attribution: false,  // we will manage this ourselves
        cover: false,
        keyboard: false,
        tag: true,
        bearing: { size: mapillary.ComponentSize.Automatic as MlyComponentSize },
        zoom: { size: mapillary.ComponentSize.Automatic as MlyComponentSize }
      },
      container: 'rapideditor-mly'
    };


    // imageChanged: called after the viewer has changed images and is ready.
    const imageChanged = (e: ViewerImageEvent): void => {
      // Tell the PhotoSystem about the new selected image, if necessary.
      // This will happen if something in the viewer triggered the change,
      // for example if the user clicked an arrow or navigation button in the viewer.
      const imageID = e.image.id.toString();
      if (photos.currPhotoID !== imageID) {
        photos.selectPhoto('mapillary', imageID);
      }
      this.emit('imageChanged');
    };

    const bearingChanged = (e: ViewerBearingEvent): void => {
      this.emit('bearingChanged', e.bearing);
    };

    const fovChanged = (): void => {
      this._viewer?.getFieldOfView().then((fov: number) => {
        this.emit('fovChanged', fov);
      });
    };

    const moveEnd = (_e: ViewerStateEvent): void => {
      const imageID = photos.currPhotoID;
      if (!imageID) return;
      const image = spatial.getData<MapillaryImage>('mapillary-images', imageID);

      // If we update the segmentations before the viewer is finished moving,
      // they end up drawn in the wrong place!
      if (image && this._shouldShowSegmentations()) {
        this._loadImageSegmentationsAsync(image)
          .then(segmentationIDs => this._showSegmentations(segmentationIDs as Set<string>))
          .catch(err => console.error('mly3', err));   // eslint-disable-line no-console
      }
    };

    const viewer: Viewer = new mapillary.Viewer(opts);
    this._viewer = viewer;
    viewer.on('image', imageChanged);
    viewer.on('bearing', bearingChanged);
    viewer.on('fov', fovChanged);
    viewer.on('moveend', moveEnd);

    if (this._viewerFilter) {
      viewer.setFilter(this._viewerFilter);
    }

    // Register viewer resize handler
    ui?.PhotoViewer.on('resize', () => {
      if (this._viewer) this._viewer.resize();
    });
  }


  /**
   * _cacheImage
   * Store the given image in the caches
   * @param  source - the image properties
   * @return  The image
   */
  _cacheImage(source: ImageSource): MapillaryImage {
    const context = this.context;
    const spatial = context.systems.spatial!;
    const imageID = source.id;

    let image = spatial.getData<MapillaryImage>('mapillary-images', imageID);
    if (!image) {
      const loc = spatial.preventCoincidentLoc('mapillary-images', source.loc);
      image = new Marker(this.context, {
        type:       'photo',
        serviceID:  this.id as ServiceID,
        id:         imageID,
        loc:        loc
      });
    }

    // Allow 0, but not things like NaN, null, Infinity
    const caIsNumber = Number.isFinite(source.ca);

    // Update whatever additional props we were passed..
    const props = image.props;
    if (source.sequenceID)   props.sequenceID  = source.sequenceID;
    if (source.captured_at)  props.captured_at = source.captured_at;
    if (source.captured_by)  props.captured_by = source.captured_by;
    if (caIsNumber)          props.ca          = source.ca;
    if (source.isPano)       props.isPano      = source.isPano;

    if (!props.isPano)  props.isPano = false;
    spatial.replaceData('mapillary-images', image);

    return image.touch();
  }


  /**
   * _cacheDetection
   * Store the given detection in the caches
   * @param  source - the detection properties
   * @return  The detection
   */
  _cacheDetection(source: DetectionSource): MapillaryDetection {
    const context = this.context;
    const spatial = context.systems.spatial!;
    const detectionID = source.id;

    let detection = spatial.getData<MapillaryDetection>('mapillary-detections', detectionID);
    if (!detection) {
      detection = new Marker<MapillaryDetectionProps>(this.context, {
        type:         'detection',
        serviceID:    this.id as ServiceID,
        id:           detectionID,
        object_type:  source.object_type   // 'point' or 'traffic_sign'
      });
    }

    // If we haven't locked in the location yet, try here..
    // (see Rapid#1557 - sometimes we don't have this!)
    if (!detection.loc && source.loc) {
      // Marker `loc` should really have been set at construction time, but unfortunately we need to redo it
      const loc = spatial.preventCoincidentLoc('mapillary-detections', source.loc);
      detection.props.loc = loc;
      detection.updateGeometry();
    }

    // Update whatever additional props we were passed..
    // Allow 0, but not things like NaN, null, Infinity
    const dirIsNumber = Number.isFinite(source.aligned_direction);

    const props = detection.props;
    if (source.images)         props.images             = source.images;
    if (source.first_seen_at)  props.first_seen_at      = source.first_seen_at;
    if (source.last_seen_at)   props.last_seen_at       = source.last_seen_at;
    if (source.value)          props.value              = source.value;
    if (dirIsNumber)           props.aligned_direction  = source.aligned_direction;

    // If we haven't locked in the bestImageID yet, try here..
    // This requires a location and an Array of images..
    const nearImages = props.images || source.images;
    if (!props.bestImageID && detection.loc && Array.isArray(nearImages)) {
      let minDist = Infinity;
      let bestImageID = null;

      for (const image of nearImages) {
        const dist = geoSphericalDistance(detection.loc, image.geometry.coordinates);
        if (dist < minDist) {
          minDist = dist;
          bestImageID = image.id;
        }
      }
      if (bestImageID) {
        props.bestImageID = bestImageID;
      }
    }

    spatial.replaceData('mapillary-detections', detection);
    return detection.touch();
  }


  /**
   * _cacheSegmentation
   * Store the given segmentation in the caches
   * @param  source - the segmentation properties
   * @return  The segmentation data, or `null` if we are skipping it (see below)
   */
  _cacheSegmentation(source: SegmentationSource): SegmentationData | null {
    const cache = this._cache.segmentations;

    // Note: not all segmentations are ones we can work with.
    // For now, we'll only keep the ones that correspond to the known object detections and traffic_signs.
    const isDetection = this.getDetectionPresetID(source.value);
    const isTrafficSign = /^(regulatory|information|warning|complementary)/.test(source.value);
    if (!isDetection && !isTrafficSign) return null;

    let segmentation = cache.data.get(source.id);
    if (!segmentation) {
      // Convert encoded geometry into a polygon..
      const decodedGeometry = window.atob(source.geometry);
      const arr = new Uint8Array(decodedGeometry.length);
      for (let i = 0; i < decodedGeometry.length; i++) {
        arr[i] = decodedGeometry.charCodeAt(i);
      }
      const tile = new VectorTile(new Protobuf(arr.buffer));
      const layer = tile.layers['mpy-or'];
      const geometries = layer.feature(0).loadGeometry();
      const polygon = geometries
        .map(ring => ring.map(point => [point.x / layer.extent, point.y / layer.extent]));
      const mapillary = (window as any).mapillary;
      const geometry: PolygonGeometry = new mapillary.PolygonGeometry(polygon[0]);

      segmentation = {
        id:        source.id,
        imageID:   source.imageID,
        geometry:  geometry,
        value:     source.value
      };

      cache.data.set(segmentation.id, segmentation);
    }

    // Update whatever additional props we were passed..
    if (source.created_at)   segmentation.created_at   = source.created_at;
    if (source.detectionID)  segmentation.detectionID  = source.detectionID;

    return segmentation;
  }

}
