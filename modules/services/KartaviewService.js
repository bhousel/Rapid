import { zoom as d3_zoom, zoomIdentity as d3_zoomIdentity } from 'd3-zoom';
import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';
// import RBush from 'rbush';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Marker, GeoJSON } from '../models/index.js';
import { uiIcon } from '../ui/icon.js';
import { utilFetchResponse, utilSetTransform } from '../util/index.js';


const KARTAVIEW_API = 'https://kartaview.org';
const OPENSTREETCAM_API = 'https://api.openstreetcam.org';
const MAXRESULTS = 1000;
const TILEZOOM = 14;


/**
 * `KartaviewService`
 * This service loads photos and sequences from the Kartaview/OpenStreetCam APIs.
 * ('Kartaview' used to be named 'OpenStreetCam', and this code uses a mix of APIs to work.)
 * @see https://doc.kartaview.org/
 * @see https://api.openstreetcam.org/api/doc.html
 *
 * It also manages a simple embedded photo viewer,
 * allowing the user to zoom, pan, and rotate the photos.
 *
 * Events available:
 *   `imageChanged`
 *   `loadedData`
 */
export class KartaviewService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'kartaview';
    this.autoStart = false;

    this._imgZoom = d3_zoom()
      .extent([[0, 0], [320, 240]])
      .translateExtent([[0, 0], [320, 240]])
      .scaleExtent([1, 15]);

    this._cache = {};
    this._hires = false;
    this._startPromise = null;
    this._tiler = new Tiler().zoomRange(TILEZOOM).skipNullIsland(true);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._keydown = this._keydown.bind(this);
    this._rotate = this._rotate.bind(this);
    this._step = this._step.bind(this);
    this._zoomPan = this._zoomPan.bind(this);
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
    const ui = context.systems.ui;

    // add osc-wrapper
    const $wrapper = context.container().select('.photoviewer .middle-middle')
      .selectAll('.osc-wrapper')
      .data([0]);

    const $$wrapper = $wrapper.enter()
      .append('div')
      .attr('class', 'photo-wrapper osc-wrapper')
      .classed('hide', true)
      .call(this._imgZoom.on('zoom', this._zoomPan))
      .on('dblclick.zoom', null);

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


    // add .photo-controls
    const $$controls = $$wrapper
      .append('div')
      .attr('class', 'photo-controls-wrap')
      .append('div')
      .attr('class', 'photo-controls');

    $$controls
      .append('button')
      .on('click.back', () => this._step(-1))
      .call(uiIcon('#fas-backward-step'));

    $$controls
      .append('button')
      .on('click.rotate-ccw', () => this._rotate(-90))
      .call(uiIcon('#fas-arrow-rotate-left'));

    $$controls
      .append('button')
      .on('click.rotate-cw', () => this._rotate(90))
      .call(uiIcon('#fas-arrow-rotate-right'));

    $$controls
      .append('button')
      .on('click.forward', () => this._step(1))
      .call(uiIcon('#fas-forward-step'));

    $$wrapper
      .append('div')
      .attr('class', 'osc-image-wrap');


    // Register viewer resize handler
    ui.PhotoViewer.on('resize', dimensions => {
      this._imgZoom = d3_zoom()
        .extent([[0, 0], dimensions])
        .translateExtent([[0, 0], dimensions])
        .scaleExtent([1, 15])
        .on('zoom', this._zoomPan);
    });

    eventManager.on('keydown', this._keydown);

    // don't need any async loading so resolve immediately
    this._started = true;
    return this._startPromise = Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    if (this._cache.inflight) {
      for (const inflight of this._cache.inflight.values()) {
        inflight.controller.abort();
      }
    }

    this._cache = {
      inflight:  new Map(),   // Map<k, {Promise, AbortController}>
//      loaded:    new Set(),   // Set<k>  (where k is like `${tile.id},${nextPage}`)
      nextPage:  new Map(),   // Map<tileID, Number>
//      images:    new Map(),   // Map<imageID, Marker>
//      sequences: new Map(),   // Map<sequenceID, GeoJSON>
//      rbush:     new RBush(),
      lastv:     null
    };

    const spatial = this.context.systems.spatial;
    spatial.clearCache('kartaview-images');
    spatial.clearCache('kartaview-sequences');

    return Promise.resolve();
  }


  /**
   * getImages
   * Get already loaded image data that appears in the current map view
   * @return  {Array<Marker>}  Array of image data
   */
  getImages() {
//    const extent = this.context.viewport.visibleExtent();
//    return this._cache.rbush.search(extent.bbox()).map(d => d.data);
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('kartaview-images').map(d => d.data);
  }


  /**
   * getSequences
   * Get already loaded sequence data that appears in the current map view
   * @return  {Array<GeoJSON>}
   */
  getSequences() {
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('kartaview-sequences').map(d => d.data);
//    const cache = this._cache;
//    const extent = this.context.viewport.visibleExtent();
//    const results = new Map();  // Map<sequenceID, GeoJSON>
//
//    for (const box of cache.rbush.search(extent.bbox())) {
//      const sequenceID = box.data.props.sequenceID;
//      if (!sequenceID) continue;  // no sequence for this image
//
//      const sequence = cache.sequences.get(sequenceID);
//      if (!sequence) continue;  // sequence not ready
//
//      if (!results.has(sequenceID)) {
//        results.set(sequenceID, sequence);
//      }
//    }
//
//    return [...results.values()];
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   */
  loadTiles() {
    const cache = this._cache;

    const viewport = this.context.viewport;
    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const needTiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const [k, inflight] of cache.inflight) {
      const needed = needTiles.some(tile => k.indexOf(tile.id) === 0);
      if (!needed) {
        inflight.controller.abort();
      }
    }

    // Fetch files that are needed
    for (const tile of needTiles) {
      this._loadNextTilePageAsync(tile);
    }
  }


  /**
   * showViewer
   * Shows the photo viewer, and hides all other photo viewers
   */
  showViewer() {
    const $viewer = this.context.container().select('.photoviewer')
      .classed('hide', false);

    const isHidden = $viewer.selectAll('.photo-wrapper.osc-wrapper.hide').size();

    if (isHidden) {
      $viewer
        .selectAll('.photo-wrapper:not(.osc-wrapper)')
        .classed('hide', true);

      $viewer
        .selectAll('.photo-wrapper.osc-wrapper')
        .classed('hide', false);
    }
  }


  /**
   * hideViewer
   * Hides the photo viewer and clears the currently selected image
   */
  hideViewer() {
    const context = this.context;
    context.systems.photos.selectPhoto(null);

    const $viewer = context.container().select('.photoviewer');
    $viewer
      .classed('hide', true)
      .selectAll('.photo-wrapper')
      .classed('hide', true);

    this.emit('imageChanged');
  }


  /**
   * selectImageAsync
   * Note:  most code should call `PhotoSystem.selectPhoto(layerID, photoID)` instead.
   * That will manage the state of what the user clicked on, and then call this function.
   * @param   {string}   imageID - the id of the image to select
   * @return  {Promise}  Promise that resolves to the image after it has been selected
   */
  selectImageAsync(imageID) {
    if (!imageID) {
      this._updatePhotoFooter(null);  // reset
      return Promise.resolve();  // do nothing
    }

    const context = this.context;
    const spatial = context.systems.spatial;
    const cache = this._cache;

    return this.startAsync()
      .then(() => this._loadImageAsync(imageID))
      .then(image => {
        const $wrapper = context.container().select('.photoviewer .osc-wrapper');
        const $imageWrap = $wrapper.selectAll('.osc-image-wrap');

        $wrapper
          .transition()
          .duration(100)
          .call(this._imgZoom.transform, d3_zoomIdentity);

        $imageWrap
          .selectAll('.osc-image')
          .remove();

//        const sequence = cache.sequences.get(image.props.sequenceID);
        const sequence = spatial.getData('kartaview-sequences', image.props.sequenceID);
        const r = sequence?.props?.rotation ?? 0;

        $imageWrap
          .append('img')
          .attr('class', 'osc-image')
          .attr('src', this._hires ? image.props.imageHighUrl : image.props.imageMedUrl)
          .style('transform', `rotate(${r}deg)`);

        this._updatePhotoFooter(image.id);

        return image;  // pass the image to anything that chains off this Promise
      });
  }


  /**
   * _updatePhotoFooter
   * Update the photo attribution section of the image viewer
   * @param  {string}  imageID - the new imageID
   */
  _updatePhotoFooter(imageID) {
    const context = this.context;
    const l10n = context.systems.l10n;
    const photos = context.systems.photos;
    const spatial = context.systems.spatial;
    const $wrapper = context.container().select('.photoviewer .osc-wrapper');

    // Options Section
    const $options = $wrapper.selectAll('.photo-options');

    // .hires checkbox
    let $label = $options.selectAll('.hires')
      .data([0]);

    // enter
    const $$label = $label.enter()
      .append('label')
      .attr('for', 'osc-hires-input')
      .attr('class', 'hires');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .attr('id', 'osc-hires-input')
      .on('click', e => {
        e.stopPropagation();

        this._hires = !this._hires;
        this.selectImageAsync(photos.currPhotoID);  // reselect
      });

    $$label
      .append('span');

    // update
    $label = $label.merge($$label);
    $label.selectAll('#osc-hires-input')
      .property('checked', this._hires);

    $label.selectAll('span')
      .text(l10n.t('photos.hires'));


    // Attribution Section
    const $attribution = $wrapper.selectAll('.photo-attribution').html('&nbsp;');  // clear DOM content

//    const image = this._cache.images.get(imageID);
    const image = spatial.getData('kartaview-images', imageID);
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
      .attr('href', `https://kartaview.org/details/${image.sequenceID}/${image.sequenceIndex}/track-info`)
      .text('kartaview.org');


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
   * _maxPageAtZoom
   * How many pages of data should we fetch at different zooms?
   * The idea is that the user can zoom in more to see more images.
   * @param   {Number}  z - zoom level
   * @return  {Number}  max pages of data to fetch
   */
  _maxPageAtZoom(z) {
    if (z < 15) return 2;
    if (z < 16) return 5;
    if (z < 17) return 10;
    if (z < 18) return 20;
    if (z < 19) return 40;
    return 80;
  }


  /**
   * _loadNextTilePageAsync
   * Load the next page of image data for the given tile.
   * This uses `https://kartaview.org/1.0/list/nearby-photos/`
   * @param   {Tile}     tile - tile object
   * @return  {Promise}  Promise resolved when there is nothing more to do
   */
  _loadNextTilePageAsync(tile) {
    // preserve the original tile.id - we will add append a page number to tile.id
    tile.origID ??= tile.id;

    const context = this.context;
    const spatial = context.systems.spatial;

    const cache = this._cache;
    const bbox = tile.wgs84Extent.bbox();
    const currZoom = context.viewport.transform.zoom;
    const maxPages = this._maxPageAtZoom(currZoom);
    const nextPage = cache.nextPage.get(tile.origID) ?? 1;

    if (nextPage > maxPages) return Promise.resolve();

    // Modify the tile.id to include the page number.
    // This is the tile id that the spatial system will keep track of.
    const tileID = tile.id = `${tile.origID},${nextPage}`;
    if (spatial.hasTile('kartaview-images', tileID) || cache.inflight.has(tileID)) {
      return Promise.resolve();
    }

    const params = utilQsString({
      ipp: MAXRESULTS,
      page: nextPage,
      bbTopLeft: [bbox.maxY, bbox.minX].join(','),
      bbBottomRight: [bbox.minY, bbox.maxX].join(','),
    }, true);

    const controller = new AbortController();
    const url = `${KARTAVIEW_API}/1.0/list/nearby-photos/`;
    const options = {
      method: 'POST',
      signal: controller.signal,
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };

    const prom = fetch(url, options)
      .then(utilFetchResponse)
      .then(response => {
        spatial.addTiles('kartaview-images', [tile]);   // mark as loaded
        const data = response?.currentPageItems || [];
        if (!data.length) return;

        const seenSequences = new Set();

        // Process and cache the images
        for (const d of data) {
          const imageID = d.id.toString();
          const sequenceID = d.sequence_id.toString();

          // Note that this API call gives us the `username`, but not the image urls.
          // It also uses 'snake_case' instead of 'camelCase'.
          const image = this._cacheImage({
            id:             imageID,
            sequenceID:     sequenceID,
            loc:            [+d.lng, +d.lat],
            ca:             parseFloat(d.heading ?? d.headers),
            isPano:         (d.field_of_view === '360'),
            captured_by:    d.username,
            captured_at:    (d.shot_date ?? d.date_added),
            sequenceIndex:  parseInt(d.sequence_index, 10)
          });

          // Update the sequence to include this image, create if needed..
          const sequence = this._cacheSequence(image);
          seenSequences.add(sequence);
        }

        // Rebuild the geometry for the the seen sequences.
        // Update geometry in-place.. hope this is ok.
        for (const sequence of seenSequences) {
          const geojson = sequence.props.geojson;
          const imageIDs = sequence.props.imageIDs;
          geojson.geometry.coordinates = imageIDs.map(imageID => {
            const image = spatial.getData('kartaview-images', imageID);
            // const image = cache.images.get(imageID);
            return image?.loc;
          }).filter(Boolean);
          sequence.updateGeometry().touch();
        }

        const gfx = context.systems.gfx;
        gfx.deferredRedraw();
        this.emit('loadedData');

        if (data.length === MAXRESULTS) {
          cache.nextPage.set(tile.origID, nextPage + 1);
          this._loadNextTilePageAsync(tile);
        } else {
          cache.nextPage.set(tile.origID, Infinity);   // loaded all available pages for this tile
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (err instanceof Error) console.error(err);  // eslint-disable-line no-console
      })
      .finally(() => {
        cache.inflight.delete(tileID);
      });

    cache.inflight.set(tileID, { promise: prom, controller: controller });
    return prom;
  }


  /**
   * _loadImageAsync
   * Load a single image.
   * This uses `https://api.openstreetcam.org/2.0/photo/<imageID>`
   * If the image has not yet been fetched (for example if we are loading an image
   *  specified in the urlhash and we haven't loaded tiles yet) we will cache the image data also.
   * @param   {string}   imageID - the imageID to load
   * @return  {Promise}  Promise resolved with the image Object
   */
  _loadImageAsync(imageID) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const cache = this._cache;

    // If the image is already cached with an imageUrl, we can just resolve.
    // const image = cache.images.get(imageID);
    const image = spatial.getData('kartaview-images', imageID);
    if (image?.props?.imageLowUrl) return Promise.resolve(image);  // fetched it already

    const url = `${OPENSTREETCAM_API}/2.0/photo/${imageID}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(response => {
        const d = response?.result?.data;
        if (!d) throw new Error(`Image ${imageID} not found`);

        const sequenceID = d.sequenceId.toString();

        // Note that this API call gives us the image urls, but not the `username`.
        // It also uses 'camelCase' instead of 'snake_case'.
        const image = this._cacheImage({
          id:             imageID,
          sequenceID:     sequenceID,
          loc:            [+d.lng, +d.lat],
          ca:             parseFloat(d.heading ?? d.headers),
          isPano:         (d.fieldOfView === '360'),
          captured_at:    (d.shotDate ?? d.dateAdded),
          sequenceIndex:  parseInt(d.sequenceIndex, 10),
          imageLowUrl:    d.imageThUrl,     // thumbnail
          imageMedUrl:    d.imageLthUrl,    // large thumbnail
          imageHighUrl:   d.imageProcUrl    // full resolution
        });

        // Update the sequence to include this image, create if needed..
        const sequence = this._cacheSequence(image);

        // Rebuild the geometry for the the seen sequence.
        // Update geometry in-place.. hope this is ok.
        const geojson = sequence.props.geojson;
        const imageIDs = sequence.props.imageIDs;
        geojson.geometry.coordinates = imageIDs.map(imageID => {
          const image = spatial.getData('kartaview-images', imageID);
          // const image = cache.images.get(imageID);
          return image?.loc;
        }).filter(Boolean);
        sequence.updateGeometry().touch();

        const gfx = context.systems.gfx;
        gfx.deferredRedraw();
        this.emit('loadedData');

        return image;
      })
      .catch(err => {
        if (err instanceof Error) console.error(err);  // eslint-disable-line no-console
      });
  }


  /**
   * _zoomPan
   * Handler for zoom/pan events in the viewer.
   * The user can drag and zoom in on the image.
   * @param  {Event}  d3_event
   */
  _zoomPan(d3_event) {
    const t = d3_event.transform;
    const $container = this.context.container();
    const $imageWrap = $container.select('.photoviewer .osc-image-wrap');

    if ($imageWrap.size()) {
      utilSetTransform($imageWrap.node(), t.x, t.y, t.k);
    }
  }


  /**
   * _rotate
   * Rotate the sequence in the viewer.
   * The user can press buttons to rotate the image if it has been recorded sideways.
   * @param  {number}  deg - degrees to rotate
   */
  _rotate(deg) {
    const context = this.context;
    const photos = context.systems.photos;
    const spatial = context.systems.spatial;

//    const image = this._cache.images.get(photos.currPhotoID);
    const image = spatial.getData('kartaview-images', photos.currPhotoID);
    if (!image) return;

//    const sequence = this._cache.sequences.get(image.props.sequenceID);
    const sequence = spatial.getData('kartaview-sequences', image.props.sequenceID);
    if (!sequence) return;

    let r = sequence.props?.rotation || 0;
    r += deg;

    if (r > 180) r -= 360;
    if (r < -180) r += 360;
    sequence.props.rotation = r;  // Update properties in-place.. hope this is ok.

    const $wrapper = context.container().select('.photoviewer .osc-wrapper');

    $wrapper
      .transition()
      .duration(100)
      .call(this._imgZoom.transform, d3_zoomIdentity);

    $wrapper.selectAll('.osc-image')
      .transition()
      .duration(100)
      .style('transform', `rotate(${r}deg)`);
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
    if (!photos.isViewerShowing() || photos.currPhotoLayerID !== 'kartaview') return;
    // Ignore modified keypresses (user might be panning or rotating)
    if (eventManager.modifierKeys.size) return;

    // Only allow key navigation if the user doesn't have something
    // more important focused - like a input, textarea, menu, etc.
    const activeElement = document.activeElement?.tagName ?? 'BODY';
    if (activeElement !== 'BODY') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      this._step(-1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      this._step(1);
    }
  }


  /**
   * _step
   * Step forward/backward along the sequence in the viewer.
   * @param  {number}  stepBy - number to step by, either +1 or -1
   */
  _step(stepBy) {
    const context = this.context;
    const photos = context.systems.photos;
    const spatial = context.systems.spatial;

//    const image = this._cache.images.get(photos.currPhotoID);
    const image = spatial.getData('kartaview-images', photos.currPhotoID);
    if (!image) return;

//    const sequence = this._cache.sequences.get(image.props.sequenceID);
    const sequence = spatial.getData('kartaview-sequences', image.props.sequenceID);
    if (!sequence) return;

    const nextIndex = image.props.sequenceIndex + stepBy;
    const nextImageID = sequence.props.imageIDs[nextIndex];
    if (!nextImageID) return;

    photos.selectPhoto('kartaview', nextImageID);

    this.emit('imageChanged');
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

    let image = spatial.getData('kartaview-images', imageID);
//    let image = cache.images.get(source.id);
    if (!image) {
      image = new Marker(context, {
        type:       'photo',
        serviceID:  this.id,
        id:         imageID,
        loc:        source.loc
      });

//      cache.images.set(image.id, image);
//
//      const [x, y] = source.loc;
//      cache.rbush.insert({ minX: x, minY: y, maxX: x, maxY: y, data: image });
    }

    // Allow 0, but not things like NaN, null, Infinity
    const caIsNumber = (!isNaN(source.ca) && isFinite(source.ca));

    // Update whatever additional props we were passed..
    const props = image.props;
    if (source.sequenceID)     props.sequenceID     = source.sequenceID;
    if (source.sequenceIndex)  props.sequenceIndex  = source.sequenceIndex;
    if (source.captured_at)    props.captured_at    = source.captured_at;
    if (source.captured_by)    props.captured_by    = source.captured_by;
    if (caIsNumber)            props.ca             = source.ca;
    if (source.isPano)         props.isPano         = source.isPano;
    if (source.imageLowUrl)    props.imageLowUrl    = source.imageLowUrl;   // thumbnail
    if (source.imageMedUrl)    props.imageMedUrl    = source.imageMedUrl;   // large thumbnail
    if (source.imageHighUrl)   props.imageHighUrl   = source.imageHighUrl;  // full resolution

    spatial.replaceData('kartaview-images', image);

    return image.touch();
  }


  /**
   * _cacheSequence
   * Store the given sequence in the caches.
   * Sequence data is always derived from the image data.
   * @param   {Marker}   image - the image that belongs to this sequence
   * @return  {GeoJSON}  The sequence
   */
  _cacheSequence(image) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const sequenceID = image.props.sequenceID;
    const sequenceIndex = image.props.sequenceIndex;

    // Create if needed
//    let sequence = cache.sequences.get(sequenceID);
    let sequence = spatial.getData('kartaview-sequences', sequenceID);

    if (!sequence) {
      sequence = new GeoJSON(context, {
        id:         sequenceID,
        type:       'sequence',
        serviceID:  this.id,
        imageIDs:   [],
        rotation:   0,
        firstIndex: Infinity,
        geojson: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      // cache.sequences.set(sequenceID, sequence);
    }

    // Update sequence properties as needed.
    const props = sequence.props;

    // Insert image into sequence - note that `imageIDs` may be a sparse array.
    props.imageIDs[sequenceIndex] = image.id;

    // Set metadata for this sequence according to the earliest image.
    if (sequenceIndex < props.firstIndex) {
      props.firstIndex  = sequenceIndex;
      props.isPano      = image.props.isPano;
      props.captured_at = image.props.captured_at;
      props.captured_by = image.props.captured_by;
    }

    spatial.replaceData('kartaview-sequences', sequence);

    return sequence.touch();
  }

}
