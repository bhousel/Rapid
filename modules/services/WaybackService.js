import { Tiler, Viewport } from '@rapid-sdk/math';
import { utilObjectOmit, utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { FetchError, utilFetchResponse } from '../util/index.js';


const WAYBACK_SERVICE_BASE_PROD = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
const WAYBACK_SERVICE_BASE_DEV = 'https://waybackdev.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
const TILEZOOM = 14;

/**
 * `WaybackService`
 * This service runs queries against the ArcGIS Wayback imagery service.
 * @see https://livingatlas.arcgis.com/wayback
 */
export class WaybackService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'wayback';
    this.requiredDependencies = new Set(['assets', 'spatial']);
    this.optionalDependencies = new Set(['gfx', 'l10n']);

    // These let us lookup the Wayback data by release number or by date.
    // The release numbers are not in order and don't mean anything.
    // The release dates will be YYYY-MM-DD strings.
    this._byReleaseNumber = new Map();   // Map<releaseNumber, Object>
    this._byReleaseDate = new Map();     // Map<releaseDate, Object>
    this._allDates = [];                 // Set<releaseDate>

    this._tiler = new Tiler();//.zoomRange(TILEZOOM);
    this._cache = {};
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const gfx = context.systems.gfx;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync())
      .then(() => assets.loadAssetAsync('wayback'))
      .then(data => {
        // example wayback release data:
        //    "10": {
        //      "itemID": "903f0abe9c3b452dafe1ca5b8dd858b9",
        //      "itemTitle": "World Imagery (Wayback 2014-02-20)",
        //      "itemURL": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{level}/{row}/{col}",
        //      "metadataLayerUrl": "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2014_r01/MapServer",
        //      "metadataLayerItemID": "78e801fab4d24ab9a6053c7a461479be",
        //      "layerIdentifier": "WB_2014_R01"
        //    },
        const releases = data?.wayback || {};

        for (const [k, release] of Object.entries(releases)) {
          // Gather date from release title
          const match = release.itemTitle.match(/\d{4}-\d{2}-\d{2}/);
          if (!match) continue;   // no date?

          const yyyymmdd = match[0];  // YYYY-MM-DD
          release.releaseNumber = k;
          release.releaseDate = yyyymmdd;

          this._byReleaseNumber.set(k, release);
          this._byReleaseDate.set(yyyymmdd, release);
        }

        // All dates in order
        this._allDates = [...this._byReleaseDate.keys()].sort();  // sort as strings ascending

        // Add previous/next links so we can easily know which releases came before and after.
        let previous = null;
        for (const d of this._allDates) {
          const curr = this._byReleaseDate.get(d);
          curr.previous = previous;
          curr.next = null;

          if (previous) {
            previous.next = curr;
          }
          previous = curr;
        }

      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    if (this._cache.inflight) {
      for (const request of this._cache.inflight.values()) {
        request.controller.abort();
      }
    }
    this._cache = {
      inflight:   new Map(),  // Map<tileID, {Promise, AbortController}>
      localDates: new Map()   // Map<tileID, Array<string>>
    };

    const spatial = this.context.systems.spatial;
    spatial.clearCache('wayback');

    return Promise.resolve();
  }


  /**
   * getLocalDatesAsync
   * Return a Promise to get the list of wayback imagery dates that appear changed in the current view.
   * @return  {Promise}  Promise resolved with an array of local dates like 'YYYY-MM-DD'
   */
  getLocalDatesAsync() {
    const context = this.context;
    const spatial = context.systems.spatial;
    const viewport = context.viewport;
    const cache = this._cache;

    // Get a single center tile at this location. (Use a viewport that's just 1 pixel)
    const t = viewport.transform.props;
    const v = new Viewport({ x: t.x, y: t.y, z: t.z }, [1, 1]);
    const tile = this._tiler.getTiles(v).tiles[0];
    if (!tile) {
      return Promise.resolve(this._allDates);  // no tile here?
    }

    // Done already..
    const tileID = tile.id;
    //if (spatial.hasTile('wayback', tileID))
    const dates = cache.localDates.get(tileID);
    if (dates) {
      return Promise.resolve(dates);
    }

    // Inflight..
    const inflight = cache.inflight.get(tileID);
    if (inflight) {
      return inflight.promise;
    }
    // Any other inflight requests are no longer needed..
    for (const controller of cache.inflight.values()) {
      controller.abort();
    }

    console.log(`center tile is ${tileID}`);

    const controller = new AbortController();
    const opts = { signal: controller.signal };

    return Promise.resolve()
      .then(() => this.checkTilemapsAsync(tile, opts))
      // .then(() => this._byReleaseNumber)
      .then(releases => this.checkImagesAsync(releases, tile, opts))
//      .then(releases => {
//        console.log(`got ${releases.size} candidates`);
//        const releaseNumbers = [...releases.keys()];
//        return Promise.all( releaseNumbers.map(num => this.getMetadataAsync(tile, num, opts)) );
//      })
      .then(metadata => {
        console.log(`got ${metadata.size} metadata`);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;          // ok
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      })
      .finally(() => {
        cache.inflight.delete(tileID);
      });
  }


  /**
   * checkTilemapsAsync
   * Implement the change detector from the wayback library.
   * @see https://github.com/lovexiaowei/wayback-core/blob/main/src/change-detector/index.ts
   *
   * This is complicated, so I'm just going to copy the description from the Wayback library:
   *
   * Sending tilemap requests to retrieve information about a specific wayback release.
   * It performs a recursive operation to track wayback releases with local changes and builds an array of corresponding release numbers.
   *
   * Whenever we encounter a value in the 'data' property of the tilemap request response equal to `[1]`, we proceed to check for a release number in the 'select' property.
   * If a release number exists in the 'select' property, we add that release number to an array used for tracking releases with local changes. Otherwise, we add the release number
   * used for the current tilemap request to the same array. Afterward, to determine the release number for the subsequent tilemap request, we retrieve the release number preceding
   * the last one added to the array. We then initiate the tilemap request with this new release number and continue this process iteratively until reaching the earliest release
   * (i.e., the 2014 release with the release number 10).
   *
   * @param   {Tile}     tile - the Tile to check
   * @param   {Object}   opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with a Map of candidate releases for the given tile
   */
  checkTilemapsAsync(tile, opts) {
    const latestDate = this._allDates.at(-1);
    const latestRelease = this._byReleaseDate.get(latestDate);
    const [x, y, z] = tile.xyz;
    const keepReleases = new Map();  // Map<releaseNumber, release>

    // Starting with latest release, fetch the tilemaps until we have them all..
    return new Promise((resolve, reject) => {
      const getTilemap = (release) => {
        const releaseNumber = release.releaseNumber;
        const url = `${WAYBACK_SERVICE_BASE_PROD}/tilemap/${releaseNumber}/${z}/${y}/${x}`;

        fetch(url, opts)
          .then(utilFetchResponse)
          .then(response => {
            const data = (response.data || [])[0];
            const select = (response.select || [])[0]?.toString();
            let nextNumber;

            if (select && (select !== releaseNumber) && !keepReleases.has(select)) {
              nextNumber = select;   // look here instead
            } else if (data === 1) {
              keepReleases.set(releaseNumber, release);  // keep this one
            }

            if (!nextNumber) {  // continue to previous release, by date
              nextNumber = release.previous?.releaseNumber;
            }

            const nextRelease = nextNumber && this._byReleaseNumber.get(nextNumber);
            if (nextRelease) {
              getTilemap(nextRelease);
            } else {
              resolve(keepReleases);
            }
          })
          .catch(err => {
            reject(err);
          });
      };

      if (latestRelease) {
        getTilemap(latestRelease);
      } else {
        resolve(keepReleases);
      }
    });
  }


  /**
   * checkImagesAsync
   * Implement the change detector from the wayback library.
   * @see https://github.com/lovexiaowei/wayback-core/blob/main/src/change-detector/index.ts
   *
   * The wayback library actually fetches images and compares their imageData.
   * This is slow, so instead we'll try doing HEAD requests and just look at their content length.
   * @see https://github.com/rapideditor/wayback-core/issues/1
   *
   * @param   {Map<releaseNumber, release>}  releases - Map of releases to check
   * @param   {Object}                       opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with a Map of candidate releases for the given tile
   */
  checkImagesAsync(releases, tile, opts) {
    const dates = [];
    for (const release of releases.values()) {
      dates.push(release.releaseDate);
    }
    dates.sort();  // sort as strings ascending

    const [x, y, z] = tile.xyz;
    const keepReleases = new Map();  // Map<releaseNumber, release>

    const promises = dates.map(date => {
      const release = this._byReleaseDate.get(date);
      if (!release) return null;  // shouldn't happen

      const url = release.itemURL
        .replaceAll('{level}', z.toString())
        .replaceAll('{row}', y.toString())
        .replaceAll('{col}', x.toString());

      const options = Object.assign({ method: 'HEAD' }, opts);

      return fetch(url, options)
        // Note: we are not using utilFetchResponse here because we need the content-length header
        .then(response => {
          if (!response.ok) {
            throw new FetchError(response);
          }

          // get some information about the image
          return {
            releaseNumber: release.releaseNumber,
            releaseDate:   release.releaseDate,
            xyz:           tile.xyz,
            size:          response.headers.get('content-length') || 0
          };
        });

    }).filter(Boolean);

    return Promise.all(promises)
      .then(results => {
        for (const result of results) {
          console.log(`${tile.id} ${result.releaseDate} ${result.releaseNumber} size=${result.size}`);
        }
      });
  }


  /**
   * getMetadataAsync
   * Get the metadata for the given tile and release number.
   * @param   {Tile}     tile - the Tile to check
   * @param   {string}   releaseNumber - the releaseNumber to check
   * @param   {Object}   opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with imagery metadata
   */
  getMetadataAsync(tile, releaseNumber, opts) {
    const [lon, lat] = tile.wgs84Extent.center();
    const z = tile.xyz[2];
    const layerID = getLayerID(z);
    const release = this._byReleaseNumber.get(releaseNumber);
    if (!release) {
      return Promise.reject(new Error(`Unknown release number: ${releaseNumber}`));
    }

    const params = {
      f: 'json',
      where: '1=1',
      outFields: [
        'SRC_DATE2',  // source date
        'NICE_DESC',  // source provider
        'SRC_DESC',   // source name
        'SAMP_RES',   // resolution
        'SRC_ACC'     // accuracy
      ].join(','),
      geometry: JSON.stringify({ spatialReference: { wkid: 4326 }, x: lon, y: lat }),
      returnGeometry: 'false',
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects'
    };

    const url = `${release.metadataLayerUrl}/${layerID}/query?` + utilQsString(params);

    return fetch(url, opts)
      .then(utilFetchResponse)
      .then(response => {
        if (response.error) {
          throw new Error(response.error);
        }

        const attr = (response.features || [])[0]?.attributes;
        if (attr) {
          const captureDate = new Date(attr.SRC_DATE2).toISOString().split('T')[0];  // no time
          return {
            capture_date:  captureDate,     // '2024-02-14'
            provider:      attr.NICE_DESC,  // 'Maxar'
            source_name:   attr.SRC_DESC,   // 'WV03'
            resolution:    attr.SAMP_RES,   // 0.3  (meters / px)
            accuracy:      attr.SRC_ACC     // 5    (meters within true location)
          };
        } else {
          return null;
        }
      });


    function getLayerID(zoom) {
      const MAX_ZOOM = 23;
      const MIN_ZOOM = 10;

      // the metadata service has 14 sub layers (0-13) that provide metadata for
      // imagery tiles from zoom level 23 (layer 0) up to zoom level 10 (layer 13)
      const layerID = MAX_ZOOM - zoom;

      // id of the metadata layer for the imagery tiles at zoom level 10,
      // in other words, the imagery tile that is with the biggest resolution (e.g., 150m resolution)
      const layerIdForMinZoom = MAX_ZOOM - MIN_ZOOM;

      if (layerID > layerIdForMinZoom) {
        return layerIdForMinZoom;
      } else {
        return layerID;
      }
    }
  }


//  /**
//   * loadTile
//   * Lookup the imagery here to determine the release dates
//   * @param  {Tile}  tile - Tile data
//   */
//  loadTile(tile) {
//    const spatial = this.context.systems.spatial;
//    const cache = this._cache;
//    const tileID = tile.id;
//
////    const [x, y, z] = tile.xyz;
////    const params = { item: this._osmoseData.types };   // Only request the types that we support
////    const url = `${OSMOSE_API}/issues/${z}/${x}/${y}.geojson?` + utilQsString(params);
//
//    const controller = new AbortController();
//    cache.inflight.set(tileID, controller);
//
//    fetch(url, { signal: controller.signal })
//      .then(utilFetchResponse)
//      .then(response => this._gotTile(tile, response))
//      .catch(err => {
//        if (err.name === 'AbortError') return;          // ok
//        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
//        spatial.addTiles('wayback', [tile]);            // don't retry
//      })
//      .finally(() => {
//        cache.inflight.delete(tileID);
//      });
//  }
//
//
//  /**
//   * _gotTile
//   * Parse the response from the tile fetch
//   * @param  {Tile}  tile - Tile data
//   * @param  {Object}  response - Response data
//   */
//  _gotTile(tile, response) {
//    const context = this.context;
//    const gfx = context.systems.gfx;
//    const spatial = context.systems.spatial;
//
//    spatial.addTiles('wayback', [tile]);   // mark as loaded
//
////    for (const feature of (response.features ?? [])) {
////      // Osmose issues are uniquely identified by a unique
////      // `item` and `class` combination (both integer values)
////      const { item, class: cl, uuid: id } = feature.properties;
////      const itemType = `${item}-${cl}`;
////      const iconID = this._osmoseData.icons[itemType];
////
////      // Filter out unsupported issue types (some are too specific or advanced)
////      if (!iconID) continue;
////
////      const loc = spatial.preventCoincidentLoc('osmose', feature.geometry.coordinates);
////      const props = {
////        id:        id,
////        class:     cl,
////        item:      item,
////        type:      itemType,
////        iconID:    iconID,
////        serviceID: this.id,
////        loc:       loc
////      };
////
////      // Assigning `elems` here prevents UI detail requests
////      if (item === 8300 || item === 8360) {
////        props.elems = [];
////      }
////
////      spatial.addData('osmose', new Marker(context, props));
////    }
//
//    gfx?.deferredRedraw();
//  }
//
//
//  /**
//   * refreshLocalReleaseDates
//   * Refresh the list of localReleaseDates that appear changed in the current view.
//   * Because this is expensive, we cache the result for a given zoomed out tile.
//   * Do this sometimes but not too often.
//   * @return  {Promise}  Promise resolved when the localReleaseDates have been loaded
//   */
//  refreshLocalReleaseDates() {
////
////
////
////    // If we have already fetched the release dates for this box, resolve immediately
////    const [lon, lat] = this.context.viewport.centerLoc();
////    const hit = this._releaseDateCache.search({ minX: lon, minY: lat, maxX: lon, maxY: lat });
////    if (hit.length) {
////      return Promise.resolve(hit[0].releaseDates);
////    }
////
////    // If a refresh is in progress, return that instead
////    if (this._refreshPromise) {
////      return this._refreshPromise;
////    }
////
////    // Get a single tile at this location
//////worldcoordinates
////    // const k = geoZoomToScale(TILEZOOM);
////    // const [x, y] = new Viewport({ k: k }).project([lon, lat]);
////    // const viewport = new Viewport({ k: k, x: -x, y: -y });
////    // const tile = this._tiler.zoomRange(TILEZOOM).getTiles(viewport).tiles[0];
////     const [x, y] = new Viewport({ z: TILEZOOM }).project([lon, lat]);
////     const viewport = new Viewport({ x: -x, y: -y, z: TILEZOOM  });
////     const tile = this._tiler.getTiles(viewport).tiles[0];
////
////    return this._refreshPromise = new Promise(resolve => {
////      Wayback.getWaybackItemsWithLocalChanges({ latitude: lat, longitude: lon }, TILEZOOM)
////        .then(data => {
////          if (!Array.isArray(data) || !data.length) throw new Error('No locally changed Wayback data');
////
////          const box = tile.wgs84Extent.bbox();
////          box.id = tile.id;
////          box.releaseDates = new Set(data.map(d => d.releaseDateLabel));
////          this._releaseDateCache.insert(box);
////          return box.releaseDates;
////        })
////        .catch(e => {
////          console.error(e);  // eslint-disable-line no-console
////          return new Set();
////        })
////        .then(val => {
////          this._refreshPromise = null;
////          resolve(val);
////        });
////    });
//  }
//
//
//  /**
//   * getMetadata
//   * The wayback-core library has a helpful function to get the metadata for us
//   */
//  getMetadata(loc, tileCoord, callback) {
//    const point = { longitude: loc[0], latitude: loc[1] };
//    const zoom = Math.min(tileCoord[2], this.zoomExtent[1]);
//    const current = this._waybackData.get(this.startDate);
//    if (!current) {
//      callback(null, {});
//      return;
//    }
//
//    Wayback.getMetadata(point, zoom, current.releaseNum)
//      .then(data => {
//        const context = this.context;
//        const l10n = context.systems.l10n;
//        const unknown = l10n?.t('inspector.unknown') || 'Unknown';
//
//        const captureDate = new Date(data.date).toISOString().split('T')[0];
//        const vintage = {
//          start: captureDate,
//          end: captureDate,
//          range: captureDate
//        };
//        const metadata = {
//          vintage: vintage,
//          source: clean(data.source),
//          description: clean(data.provider),
//          resolution: clean(+parseFloat(data.resolution).toFixed(4)),
//          accuracy: clean(+parseFloat(data.accuracy).toFixed(4))
//        };
//
//        // append units - meters
//        if (isFinite(metadata.resolution)) {
//          metadata.resolution += ' m';
//        }
//        if (isFinite(metadata.accuracy)) {
//          metadata.accuracy += ' m';
//        }
//
//        callback(null, metadata);
//
//        function clean(val) {
//          return String(val).trim() || unknown;
//        }
//      })
//      .catch(e => {
//        console.error(e);  // eslint-disable-line no-console
//        callback(e);
//      });
//  }

}
