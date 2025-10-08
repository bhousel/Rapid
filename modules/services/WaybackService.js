import { Tiler, Viewport } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { FetchError, utilFetchResponse } from '../util/index.js';

const WAYBACK_SERVICE_BASE_PROD = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
//const WAYBACK_SERVICE_BASE_DEV = 'https://waybackdev.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';

/**
 * `WaybackService`
 * This service runs queries against the ArcGIS Wayback imagery service.
 * @see https://livingatlas.arcgis.com/wayback
 *
 * Collections are available to lookup the Wayback data by release number or by date.
 * The release numbers are numeric strings.  They are not in order and don't mean anything.
 * The release dates are YYYY-MM-DD strings.
 *
 * Properties you can access:
 *   `allDates`         `Array<releaseDate>` sorted ascending
 *   `byReleaseNumber`  `Map<releaseNumber, Object>`
 *   `byReleaseDate`    `Map<releaseDate, Object>`
 */
export class WaybackService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'wayback';
    this.requiredDependencies = new Set(['assets' /*,'spatial'*/]);
    this.optionalDependencies = new Set([]);

    this.allDates = [];                 // Array<releaseDate> ascending
    this.byReleaseNumber = new Map();   // Map<releaseNumber, Object>
    this.byReleaseDate = new Map();     // Map<releaseDate, Object>

    this._tiler = new Tiler();
    this._cache = {};
    this._metadata = new Map();     // Map<key, Object>  where `key` like 'tileID_YYYY-MM-DD'
    this._localDates = new Map();   // Map<tileID, Array<releaseDate>>
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

          // Convert placeholder tokens in the URL template from Esri's format to ours.
          release.template = release.itemURL
            .replaceAll('{level}', '{zoom}')
            .replaceAll('{row}', '{y}')
            .replaceAll('{col}', '{x}');

          this.byReleaseNumber.set(k, release);
          this.byReleaseDate.set(yyyymmdd, release);
        }

        // All dates in order
        this.allDates = [...this.byReleaseDate.keys()].sort();  // sort as strings ascending

        // Add previous/next links so we can easily know which releases came before and after.
        let previous = null;
        for (const d of this.allDates) {
          const curr = this.byReleaseDate.get(d);
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
      inflight: new Map()  // Map<tileID, {Promise, AbortController}>
    };

//    const spatial = this.context.systems.spatial;
//    spatial.clearCache('wayback');

    return Promise.resolve();
  }


  /**
   * chooseClosestDate
   * This compares the requested date value against the supported dates in the Wayback archive and finds
   * the closest supported date without going over.  All dates are strings in YYYY-MM-DD format.
   * @param   {string}  val - Requested date, as YYYY-MM-DD
   * @return  {string}  Closest supported date, as YYYY-MM-DD
   */
  chooseClosestDate(val) {
    let chooseDate = this.allDates[0];  // start with earliest date

    const requestDate = this._localeDateString(val);
    if (!requestDate) return chooseDate;

    for (let i = 1; i < this.allDates.length; i++) {   // can skip earliest, it is already in chooseDate
      const date = this.allDates[i];
      const cmp = date.localeCompare(requestDate);
      if (cmp > 0) break;   // went over, stop looking
      chooseDate = date;    // this date works
    }
    return chooseDate;
  }


  /**
   * getLocalDatesAsync
   * Return a Promise to get the list of wayback imagery dates that appear changed in the current view.
   * @return  {Promise}  Promise resolved with an `Array<releaseDate>` for the current view
   */
  getLocalDatesAsync() {
    const context = this.context;
    // const spatial = context.systems.spatial;
    const viewport = context.viewport;
    const cache = this._cache;

    // Get a single center tile at this location. (Use a viewport that's just 1 pixel)
    const t = viewport.transform.props;
    const v = new Viewport({ x: t.x, y: t.y, z: t.z }, [1, 1]);
    const tile = this._tiler.getTiles(v).tiles[0];
    if (!tile) {
      return Promise.resolve(this.allDates);  // no tile here?
    }

    // Done already..
    const tileID = tile.id;
    const localDates = this._localDates.get(tileID);
    if (localDates) {
      return Promise.resolve(localDates);
    }
    //if (spatial.hasTile('wayback', tileID))
    // const dates = cache.localDates.get(tileID);
    // if (dates) {
    //   return Promise.resolve(dates);
    // }

    // Inflight..
    const inflight = cache.inflight.get(tileID);
    if (inflight) {
      return inflight.promise;
    }
    // Any other inflight requests are no longer needed..
    for (const controller of cache.inflight.values()) {
      controller.abort();
    }

    const controller = new AbortController();
    const opts = { signal: controller.signal };
    const prom = Promise.resolve()
      .then(() => this.checkTilemapsAsync(tile, opts))
      .then(releases => this.checkImagesAsync(releases, tile, opts))
      .then(releases => {
        const localDates = [...releases.keys()];
        this._localDates.set(tileID, localDates);
        return localDates;
      })
      .catch(err => {
        if (err.name === 'AbortError') return;          // ok
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      })
      .finally(() => {
        cache.inflight.delete(tileID);
      });

    cache.inflight.set(tileID, { promise: prom, controller: controller });
    return prom;
  }


  /**
   * checkTilemapsAsync
   * This is used to implement the change detector from the Wayback library.
   * @see https://github.com/lovexiaowei/wayback-core/blob/main/src/change-detector/index.ts
   *
   * In this step we gather which releases have valid imagery on the given tile.
   * Starting with the most recent release, we will work backwards and fetch the tilemap.
   * The response may contain
   *   `data: [0]` - imagery is not valid here,
   *   `data: [1]` - imagery is valid here in this release number,
   *   `select: [other]` - imagery is valid, but look at the other release number to get it
   * We continue fetching until we're back at the initial release (2014 release number '10')
   *
   * @param   {Tile}     tile - the Tile to check
   * @param   {Object}   opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with a `Map<releaseDate, release>` candidate releases for the given tile
   */
  checkTilemapsAsync(tile, opts) {
    const latestDate = this.allDates.at(-1);
    const latestRelease = this.byReleaseDate.get(latestDate);
    const [x, y, z] = tile.xyz;
    const keepReleases = new Map();  // Map<releaseDate, release>

    // Starting with latest release, fetch the tilemaps until we have them all..
    return new Promise((resolve, reject) => {
      const getTilemap = (release) => {
        const releaseNumber = release.releaseNumber;
        const releaseDate = release.releaseDate;
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
              keepReleases.set(releaseDate, release);  // keep this one
            }

            if (!nextNumber) {  // continue to previous release, by date
              nextNumber = release.previous?.releaseNumber;
            }

            const nextRelease = nextNumber && this.byReleaseNumber.get(nextNumber);
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
   * This is used to implement the change detector from the Wayback library.
   * @see https://github.com/lovexiaowei/wayback-core/blob/main/src/change-detector/index.ts
   *
   * In this step we take the release candidates from `checkTileMapsAsync`
   *  and request an image from each one to guess which ones actually have changed.
   * The Wayback library actually fetches images and compares their imageData.
   * This is slow, so instead we'll try doing HEAD requests and just look at their content length.
   * @see https://github.com/rapideditor/wayback-core/issues/1
   *
   * @param   {Map<releaseDate, release>}  releases - Map of candidate releases to check
   * @param   {Object}                     opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with a `Map<releaseDate, release>` candidate releases for the given tile
   */
  checkImagesAsync(releases, tile, opts) {
    const dates = [...releases.keys()].sort();  // sort as strings ascending
    const [x, y, z] = tile.xyz;

    // Generate promises for Promise.all, it can happen in parallel.
    const promises = dates.map(date => {
      const release = releases.get(date);
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
            release:       release,
            releaseNumber: release.releaseNumber,
            releaseDate:   release.releaseDate,
            xyz:           tile.xyz,
            size:          response.headers.get('content-length') || 0
          };
        });

    }).filter(Boolean);

    return Promise.all(promises)
      .then(results => {
        const keepReleases = new Map();  // Map<releaseDate, release>
        let lastSize = -1;

        for (const result of results) {
          if (result.size > 0 && result.size !== lastSize) {
            keepReleases.set(result.releaseDate, result.release);
          }
          lastSize = result.size;
        }
        return keepReleases;
      });
  }


  /**
   * getMetadataAsync
   * Get the metadata for the given tile and release date.
   * @param   {Tile}     tile - the Tile to check
   * @param   {string}   releaseNumber - the releaseNumber to check
   * @param   {Object}   opts - fetch options (use to pass an AbortController)
   * @return  {Promise}  Promise resolved with imagery metadata
   */
  getMetadataAsync(tile, releaseDate, opts) {
    const [lon, lat] = tile.wgs84Extent.center();
    const z = tile.xyz[2];
    const layerID = getLayerID(z);
    const release = this.byReleaseDate.get(releaseDate);
    if (!release) {
      return Promise.reject(new Error(`Unknown release date: ${releaseDate}`));
    }

    const key = `${tile.id}_${releaseDate}`;
    const metadata = this._metadata.get(key);
    if (metadata) {
      return Promise.resolve(metadata);
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
        if (!attr) {
          throw new Error(`Metadata not found for ${tile.id} release ${releaseDate}`);
        }

        const captureDate = new Date(attr.SRC_DATE2).toISOString().split('T')[0];  // convert timestamp to string
        const metadata = {
          captureDate:  captureDate,     // '2024-02-14'
          provider:     attr.NICE_DESC,  // 'Maxar'
          source:       attr.SRC_DESC,   // 'WV03'
          resolution:   attr.SAMP_RES,   // 0.3  (meters / px)
          accuracy:     attr.SRC_ACC     // 5    (meters within true location)
        };
        this._metadata.set(key, metadata);
        return metadata;
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


  _localeDateString(s) {
    if (!s) return null;
    const d = new Date(s + 'Z');  // Add 'Z' to create the date in UTC
    if (isNaN(d.getTime())) return null;

    return d.toISOString().split('T')[0];  // Return the date part of the ISO string
  }

}
