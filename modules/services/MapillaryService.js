import { select as d3_select } from 'd3-selection';
import { Tiler, geoSphericalDistance } from '@rapid-sdk/math';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Marker, GeoJSON } from '../models/index.js';
import { utilFetchResponse } from '../util/index.js';

const accessToken = 'MLY|3376030635833192|f13ab0bdf6b2f7b99e0d8bd5868e1d88';
const apiUrl = 'https://graph.mapillary.com/';
const baseTileUrl = 'https://tiles.mapillary.com/maps/vtp';

// see Rapid#1582 for discussion on computed vs original geometries.
const imageTileUrl = `${baseTileUrl}/mly1_public/2/{z}/{x}/{y}?access_token=${accessToken}`;              // original
//const imageTileUrl = `${baseTileUrl}/mly1_computed_public/2/{z}/{x}/{y}?access_token=${accessToken}`;   // computed
const detectionTileUrl = `${baseTileUrl}/mly_map_feature_point/2/{z}/{x}/{y}?access_token=${accessToken}`;
const trafficSignTileUrl = `${baseTileUrl}/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=${accessToken}`;

const TILEZOOM = 14;


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

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'mapillary';
    this.autoStart = false;

    this._loadPromise = null;
    this._startPromise = null;

    this._cache = {};
    this._selectedImageID = null;
    this._viewer = null;
    this._viewerFilter = ['all'];
    this._tiler = new Tiler().zoomRange(TILEZOOM).skipNullIsland(true);

    // Make sure the event handlers have `this` bound correctly
    this._keydown = this._keydown.bind(this);
    this.navigateForward = this.navigateForward.bind(this);
    this.navigateBackward = this.navigateBackward.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    return this.resetAsync();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const eventManager = context.systems.gfx.events;

    // add mly-wrapper
    const $$wrapper = context.container().select('.photoviewer .middle-middle')
      .selectAll('.mly-wrapper')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'photo-wrapper mly-wrapper')
      .attr('id', 'rapideditor-mly')
      .classed('hide', true);

    // add .photo-footer
    const $$footer = $$wrapper
      .append('div')
      .attr('class', 'photo-footer');

    $$footer
      .append('div')
      .attr('class', 'photo-options');

    $$footer
      .append('div')
      .attr('class', 'photo-attribution');


    eventManager.on('keydown', this._keydown);

    return this._startPromise = this._loadAssetsAsync()
      .then(() => this._initViewer())
      .then(() => this._started = true)
      .catch(err => {
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        this._startPromise = null;
      });
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    if (this._cache.inflight) {
      for (const req of this._cache.inflight.values()) {
        req.controller.abort();
      }
    }

    this._cache = {
      images:        { lastv: null },
      detections:    { lastv: null },
      signs:         { lastv: null },
      segmentations: { data: new Map() },   // Map<segmentationID, Object>
      inflight: new Map(),  // Map<url, {tileID, promise, controller}>
      loaded:   new Set()   // Set<url>
    };

    const spatial = this.context.systems.spatial;
    spatial.clearCache('mapillary-images');
    spatial.clearCache('mapillary-sequences');
    spatial.clearCache('mapillary-detections');

    return Promise.resolve();
  }


  /**
   * imageURL
   * Returns the url to view an image on Mapillary
   * @param   {string}  imageID - the imageID to link to
   * @return  {string}  The url
   */
  imageURL(imageID) {
    const gfx = this.context.systems.gfx;
    const layers = gfx.scene.layers;

    // are either of these layers enabled?
    const detectionsLayer = layers.get('mapillary-detections');
    const signsLayer = layers.get('mapillary-signs');

    let extras = '';
    if (detectionsLayer?.enabled)  extras += '&mapFeature=all';
    if (signsLayer?.enabled)       extras += '&trafficSign=all';

    return `https://www.mapillary.com/app/?pKey=${imageID}&focus=photo${extras}`;
  }


  /**
   * getImage
   * Return an image from the cache.
   * @param   {string}   imageID - imageID to get
   * @return  {Marker?}  The image, or `undefined` if not found
   */
  getImage(imageID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('mapillary-images', imageID);
  }


  /**
   * getSequence
   * Return a sequence from the cache.
   * @param   {string}    sequenceID - sequenceID to get
   * @return  {GeoJSON?}  The sequence, or `undefined` if not found
   */
  getSequence(sequenceID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('mapillary-sequences', sequenceID);
  }


  /**
   * getDetection
   * Return a detection from the cache.
   * @param   {string}   detectionID - detectionID to get
   * @return  {Marker?}  The detection, or `undefined` if not found
   */
  getDetection(detectionID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('mapillary-detections', detectionID);
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param   {string}  datasetID - one of 'images', 'signs', or 'detections'
   * @return  {Array<Marker>}
   */
  getData(datasetID) {
    if (!['images', 'signs', 'detections'].includes(datasetID)) return [];

    const spatial = this.context.systems.spatial;

    if (datasetID === 'images') {
      return spatial.getVisibleData('mapillary-images').map(d => d.data);

    } else {  // both signs and detections are now stored in the `detections` cache
      const type = (datasetID === 'signs') ? 'traffic_sign' : 'point';
      return spatial.getVisibleData('mapillary-detections')
        .map(d => d.data)
        .filter(d => d.props.object_type === type);
    }
  }


  /**
   * getSequences
   * Get already loaded sequence data that appears in the current map view
   * @return  {Array<GeoJSON>}
   */
  getSequences() {
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('mapillary-sequences').map(d => d.data);
  }


  /**
   * getDetectionPresetID
   * Convert a detection type to a preset id.  This is just a big lookup for now.
   * @param   {string}  detectionType - the type of detection  (e.g. 'object--manhole')
   * @return  {string}  the presetID to use for this detection type (e.g. 'man_made/manhole')
   */
  getDetectionPresetID(detectionType) {
    const lookup = {
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
   * @param   {string}  datasetID - one of 'images', 'signs', or 'detections'
   */
  loadTiles(datasetID) {
    if (!['images', 'signs', 'detections'].includes(datasetID)) return;

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
  filterViewer() {
    const photos = this.context.systems.photos;
    const showsPano = photos.showsPanoramic;
    const showsFlat = photos.showsFlat;
    const fromDate = photos.fromDate;
    const toDate = photos.toDate;
    const filter = ['all'];

    if (!showsPano) filter.push([ '!=', 'cameraType', 'spherical' ]);
    if (!showsFlat && showsPano) filter.push(['==', 'pano', true]);
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


  navigateForward() {
    const next = window.mapillary.NavigationDirection.Next;
    this._navigate(next);
  }

  navigateBackward() {
    const prev = window.mapillary.NavigationDirection.Prev;
    this._navigate(prev);
  }

  _navigate(dir) {
    this._viewer.moveDir(dir).catch(
      error => { //errs out if end of sequence reached, just don't print anything
      },
    );
  }


  /**
   * showViewer
   * Shows the photo viewer, and hides all other photo viewers
   */
  showViewer() {
    const $viewer = this.context.container().select('.photoviewer')
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
  hideViewer() {
    const context = this.context;
    context.systems.photos.selectPhoto(null);

    if (this._viewer) {
      this._viewer.getComponent('sequence').stop();
    }

    const $viewer = context.container().select('.photoviewer');
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
   * @param  {string} imageID - the id of the image to select
   * @return {Promise} Promise that resolves to the image after it has been selected
   */
  selectImageAsync(imageID) {
    this._clearSegmentations();

    if (!imageID) {
      this._updatePhotoFooter(null);  // reset
      return Promise.resolve();  // do nothing
    }

    // We are already showing this image, this means we won't get events like imagechanged or moveend.
    // This means we will need to update segmentations here..
    if (this._selectedImageID === imageID) {
      const context = this.context;
      const spatial = context.systems.spatial;
      const image = spatial.getData('mapillary-images', imageID);

      if (this._shouldShowSegmentations()) {
        return this._loadImageSegmentationsAsync(image)
          .then(segmentationIDs => this._showSegmentations(segmentationIDs))
          .catch(err => console.error('mly3', err))   // eslint-disable-line no-console
          .then(() => Promise.resolve(image));
      } else {
        return Promise.resolve(image);
      }

    } else {  // switch image

      return this.startAsync()
        .then(() => this._viewer.moveTo(imageID))
        .then(mlyImage => {
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
   * @param  {string} detectionID - the id of the detection to select
   * @return {Promise} Promise that resolves to the detection after it has been selected
   */
  selectDetectionAsync(detectionID) {
    this._clearSegmentations();
    if (!detectionID) {
      return Promise.resolve();  // do nothing
    }

    return this.startAsync()
      .then(() => this._loadDetectionAsync(detectionID))
      .then(detection => {
        // optionally, load segmentations..
        if (this._shouldShowSegmentations()) {
          return this._loadDetectionSegmentationsAsync(detection)
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
   * @param  {KeyboardEvent}  e - A DOM KeyboardEvent
   */
  _keydown(e) {
    const context = this.context;
    const eventManager = context.systems.gfx.events;
    const photos = context.systems.photos;

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
   * @param  {string} imageID - the new imageID
   */
  _updatePhotoFooter(imageID) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const $wrapper = context.container().select('.photoviewer .mly-wrapper');
    const $attribution = $wrapper.selectAll('.photo-attribution').html('&nbsp;');  // clear DOM content

    const image = spatial.getData('mapillary-images', imageID);
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
        .text(_localeDateString(image.props.captured_at));

      $attribution
        .append('span')
        .text('|');
    }

    $attribution
      .append('a')
      .attr('class', 'image-link')
      .attr('target', '_blank')
      .attr('href', this.imageURL(imageID))
      .text('mapillary.com');


    function _localeDateString(s) {
      if (!s) return null;
      const options = { day: 'numeric', month: 'short', year: 'numeric' };
      const d = new Date(s);
      if (isNaN(d.getTime())) return null;

      const localeCode = context.systems.l10n.localeCode();
      return d.toLocaleDateString(localeCode, options);
    }
  }


  /**
   * _shouldShowSegmentations
   * Determine whether segmentations should be shown in the mapillary viewer.
   * @return {Boolean}  `true` if they should be shown, `false` if not
   */
  _shouldShowSegmentations() {
    const gfx = this.context.systems.gfx;
    const layers = gfx.scene.layers;

    // are either of these layers enabled?
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
  _clearSegmentations() {
    if (!this._viewer) return;   // called too early?
    this._viewer.getComponent('tag').removeAll();
  }


  /**
   * _showSegmentations
   * Segmentations are called "tags" in the Mapillary viewer.
   * Here we are create a tag for each segmentationID found in the current image.
   * @param  {Set<string>}  segmentationIDs - the segmentation ids to show
   */
  _showSegmentations(segmentationIDs) {
    if (!this._viewer) return;  // called too early?

    this._clearSegmentations();

    const tagComponent = this._viewer.getComponent('tag');
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
   * @param  {Object} segmentation - the segmentation to make a tag for
   */
  _makeTag(segmentation) {
    const valueParts = segmentation.value.split('--');
    if (!valueParts.length) return;

    let text;
    let color = 0x05cb63;  // mapillary green
    // let color = 0xffffff;

    const context = this.context;
    const photos = context.systems.photos;
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

    const tag = new window.mapillary.OutlineTag(
      segmentation.id,
      segmentation.geometry,
      {
        text: text,
        textColor: color,
        lineColor: color,
        lineWidth: 3,
        fillColor: color,
        fillOpacity: 0.4
      }
    );

    return tag;
  }


  /**
   * _loadTileAsync
   * Load a vector tile of data for the given dataset.
   * This uses `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=XXX`
   * @see    https://www.mapillary.com/developer/api-documentation#vector-tiles
   * @param  {string} datasetID - one of 'images', 'signs', or 'detections'
   * @param  {Tile}   tile - a tile object
   * @return {Promise}  Promise settled when the request is completed
   */
  _loadTileAsync(datasetID, tile) {
    if (!['images', 'signs', 'detections'].includes(datasetID)) {
      return Promise.resolve();  // nothing to do
    }

    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;

    let url = {
      images: imageTileUrl,
      signs: trafficSignTileUrl,
      detections: detectionTileUrl
    }[datasetID];

    url = url
      .replace('{x}', tile.xyz[0])
      .replace('{y}', tile.xyz[1])
      .replace('{z}', tile.xyz[2]);

    const cache = this._cache;

    if (cache.loaded.has(url)) {
      return Promise.resolve();  // already done
    }

    let req = cache.inflight.get(url);
    if (req) {
      return req.promise;
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

        gfx.deferredRedraw();

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
   * @param  {ArrayBuffer}  buffer
   * @param  {Tile}         tile - a tile object
   */
  _gotTile(buffer, tile) {
    const context = this.context;
    const spatial = context.systems.spatial;

    const vectorTile = new VectorTile(new Protobuf(buffer));

    if (vectorTile.layers.hasOwnProperty('image')) {
      const layer = vectorTile.layers.image;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(tile.xyz[0], tile.xyz[1], tile.xyz[2]);
        if (!feature) continue;

        this._cacheImage({
          id:          feature.properties.id.toString(),
          loc:         feature.geometry.coordinates,
          sequenceID:  feature.properties.sequence_id.toString(),
          captured_at: feature.properties.captured_at,
          ca:          feature.properties.compass_angle,
          isPano:      feature.properties.is_pano,
        });
      }
    }

    if (vectorTile.layers.hasOwnProperty('sequence')) {
      const layer = vectorTile.layers.sequence;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(tile.xyz[0], tile.xyz[1], tile.xyz[2]);
        if (!feature) continue;

        const sequenceID = feature.properties.id.toString();
        let sequence = spatial.getData('mapillary-sequences', sequenceID);
        if (!sequence) {
          const props = {
            id:         sequenceID,
            serviceID:  this.id,
            geojson: {
              type:      'FeatureCollection',
              features:  []
            }
          };
          sequence = new GeoJSON(context, props);
        }
        sequence.props.geojson.features.push(feature);  // updating it in-place, hope this is ok.
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
          id:            feature.properties.id.toString(),
          loc:           feature.geometry.coordinates,
          first_seen_at: feature.properties.first_seen_at,
          last_seen_at:  feature.properties.last_seen_at,
          value:         feature.properties.value,
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
   * @param  {string}   detectionID - the detection to load
   * @return {Promise}  Promise settled with the detection details
   */
  _loadDetectionAsync(detectionID) {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;

    // Is data is cached already and includes the `images` Array?  If so, resolve immediately.
    const detection = spatial.getData('mapillary-detections', detectionID);
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

        gfx.immediateRedraw();
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
   * @param  {Object}   image - the image to get segmentation data for
   * @return {Promise}  Promise settled with the segmentation details
   */
  _loadImageSegmentationsAsync(image) {
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

        const segmentationIDs = new Set();
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

          image.props.segmentationIDs = segmentationIDs;
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
   * @param  {Object}   detection - the detection to get segmentation data for
   * @return {Promise}  Promise settled with the segmentation details
   */
  _loadDetectionSegmentationsAsync(detection) {
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

        const segmentationIDs = new Set();
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

        detection.props.segmentationIDs = segmentationIDs;
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
   * @return {Promise} Promise resolved when both files have been loaded
   */
  _loadAssetsAsync() {
    if (this._loadPromise) return this._loadPromise;

    return this._loadPromise = new Promise((resolve, reject) => {
      const assets = this.context.systems.assets;

      let count = 0;
      const loaded = () => {
        if (++count === 2) resolve();
      };

      const $head = d3_select('head');

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


  // Initialize image viewer (Mapillary JS)
  _initViewer() {
    const mapillary = window.mapillary;
    if (!mapillary) throw new Error('mapillary not loaded');
    if (!mapillary.isSupported()) throw new Error('mapillary not supported');

    const context = this.context;
    const photos = context.systems.photos;
    const spatial = context.systems.spatial;
    const ui = context.systems.ui;

    const opts = {
      accessToken: accessToken,
      component: {
        attribution: false,  // we will manage this ourselves
        cover: false,
        keyboard: false,
        tag: true,
        bearing: { size: mapillary.ComponentSize.Automatic },
        zoom: { size: mapillary.ComponentSize.Automatic }
      },
      container: 'rapideditor-mly'
    };


    // imageChanged: called after the viewer has changed images and is ready.
    const imageChanged = (node) => {
      // Tell the PhotoSystem about the new selected image, if necessary.
      // This will happen if something in the viewer triggered the change,
      // for example if the user clicked an arrow or navigation button in the viewer.
      const imageID = node.image.id.toString();
      if (photos.currPhotoID !== imageID) {
        photos.selectPhoto('mapillary', imageID);
      }
      this.emit('imageChanged');
    };

    const bearingChanged = (e) => {
      this.emit('bearingChanged', e.bearing);
    };

    const fovChanged = () => {
      this._viewer.getFieldOfView().then(fov => {
        this.emit('fovChanged', fov);
      });
    };

    const moveEnd = (e) => {
      const imageID = photos.currPhotoID;
      const image = spatial.getData('mapillary-images', imageID);

      // If we update the segmentations before the viewer is finished moving,
      // they end up drawn in the wrong place!
      if (image && this._shouldShowSegmentations()) {
        this._loadImageSegmentationsAsync(image)
          .then(segmentationIDs => this._showSegmentations(segmentationIDs))
          .catch(err => console.error('mly3', err));   // eslint-disable-line no-console
      }
    };

    this._viewer = new mapillary.Viewer(opts);
    this._viewer.on('image', imageChanged);
    this._viewer.on('bearing', bearingChanged);
    this._viewer.on('fov', fovChanged);
    this._viewer.on('moveend', moveEnd);

    if (this._viewerFilter) {
      this._viewer.setFilter(this._viewerFilter);
    }

    // Register viewer resize handler
    ui.PhotoViewer.on('resize', () => {
      if (this._viewer) this._viewer.resize();
    });
  }


  /**
   * _cacheImage
   * Store the given image in the caches
   * @param   {Object}  source - the image properties
   * @return  {Marker}  The image
   */
  _cacheImage(source) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const imageID = source.id;

    let image = spatial.getData('mapillary-images', imageID);
    if (!image) {
      const loc = spatial.preventCoincidentLoc('mapillary-images', source.loc);
      image = new Marker(this.context, {
        type:       'photo',
        serviceID:  this.id,
        id:         imageID,
        loc:        loc
      });
    }

    // Allow 0, but not things like NaN, null, Infinity
    const caIsNumber = (!isNaN(source.ca) && isFinite(source.ca));

    // Update whatever additional props we were passed..
    const props = image.props;
    if (source.sequenceID)   props.sequenceID  = source.sequenceID;
    if (source.captured_at)  props.captured_at = source.captured_at;
    if (source.captured_by)  props.captured_by = source.captured_by;
    if (caIsNumber)          props.ca          = source.ca;
    if (source.isPano)       props.isPano      = source.isPano;

    spatial.replaceData('mapillary-images', image);
    return image.touch();
  }


  /**
   * _cacheDetection
   * Store the given detection in the caches
   * @param  {Object}  source - the detection properties
   * @return {Marker}  The detection
   */
  _cacheDetection(source) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const detectionID = source.id;

    let detection = spatial.getData('mapillary-detections', detectionID);
    if (!detection) {
      detection = new Marker(this.context, {
        type:         'detection',
        serviceID:    this.id,
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
    const dirIsNumber = (!isNaN(source.aligned_direction) && isFinite(source.aligned_direction));

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
   * @param  {Object}  source - the segmentation properties
   * @return {Object?} The segmentation data, or `null` if we are skipping it (see below)
   */
  _cacheSegmentation(source) {
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
      let arr = new Uint8Array(decodedGeometry.length);
      for (let i = 0; i < decodedGeometry.length; i++) {
        arr[i] = decodedGeometry.charCodeAt(i);
      }
      const tile = new VectorTile(new Protobuf(arr.buffer));
      const layer = tile.layers['mpy-or'];
      const geometries = layer.feature(0).loadGeometry();
      const polygon = geometries
        .map(ring => ring.map(point => [point.x / layer.extent, point.y / layer.extent]));
      const geometry = new window.mapillary.PolygonGeometry(polygon[0]);

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
