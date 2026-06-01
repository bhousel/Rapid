import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Tiler, Viewport } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';
import { utilDateString } from '../util/date.ts';

import type { Context } from '../Context.ts';
import type { DateLike } from '../util/date.ts';
import type { Tile } from '@rapid-sdk/math';


/** Base URL for the ArcGIS Wayback imagery production service */
const WAYBACK_SERVICE_BASE_PROD = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
//const WAYBACK_SERVICE_BASE_DEV = 'https://waybackdev.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';


/** Data for a single Wayback imagery release */
interface WaybackRelease {
  /** Unique ArcGIS item identifier */
  itemID: string;
  /** Human-readable title, e.g. "World Imagery (Wayback 2014-02-20)" */
  itemTitle: string;
  /** URL template for fetching imagery tiles */
  itemURL: string;
  /** URL for the metadata service layer */
  metadataLayerUrl: string;
  /** ArcGIS item ID for the metadata layer */
  metadataLayerItemID: string;
  /** Layer identifier string, e.g. "WB_2014_R01" */
  layerIdentifier: string;
  /** Numeric release number (as a string), e.g. "10" */
  releaseNumber: string;
  /** Release date in YYYY-MM-DD format */
  releaseDate: string;
  /** URL template with `{zoom}`, `{x}`, `{y}` placeholders for tile requests */
  template: string;
  /** Link to the chronologically previous release, or null if this is the earliest */
  previous: WaybackRelease | null;
  /** Link to the chronologically next release, or null if this is the latest */
  next: WaybackRelease | null;
}

/** Imagery metadata returned by getMetadataAsync */
interface WaybackMetadata {
  /** Date when the imagery was captured, in YYYY-MM-DD format */
  captureDate: string;
  /** Imagery provider name, e.g. "Maxar" */
  provider: string;
  /** Imagery source identifier, e.g. "WV03" */
  source: string;
  /** Spatial resolution in meters per pixel */
  resolution: number;
  /** Positional accuracy in meters */
  accuracy: number;
}

/** Inflight request entry */
interface InflightEntry {
  /** The pending promise for the overall tile analysis */
  promise: Promise<string[] | void>;
}

/** Internal cache structure */
interface WaybackCache {
  /** Map of in-progress tile requests keyed by tile ID */
  inflight: Map<TileID, InflightEntry>;
}


/**
 * `WaybackService` runs queries against Esri's ArcGIS Wayback imagery service.
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

  /** All supported release dates, sorted ascending (YYYY-MM-DD strings) */
  public allDates: string[];
  /** Lookup of releases keyed by release number */
  public byReleaseNumber: Map<string, WaybackRelease>;
  /** Lookup of releases keyed by release date (YYYY-MM-DD) */
  public byReleaseDate: Map<string, WaybackRelease>;

  /** Tiler used to compute the center tile for the current viewport */
  protected _tiler: Tiler;
  /** Internal cache for inflight tile requests */
  protected _cache: WaybackCache;
  /** Cached metadata results, keyed by `"tileID_YYYY-MM-DD"` */
  protected _metadata: Map<string, WaybackMetadata>;
  /** Cached per-tile lists of release dates with detected imagery changes */
  protected _localDates: Map<TileID, string[]>;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'wayback';
    this.requiredDependencies = new Set<SystemID>(['assets', 'network' /*,'spatial'*/]);
    this.optionalDependencies = new Set<SystemID>([]);

    this.allDates = [];                 // Array<releaseDate> ascending
    this.byReleaseNumber = new Map();   // Map<releaseNumber, WaybackRelease>
    this.byReleaseDate = new Map();     // Map<releaseDate, WaybackRelease>

    this._tiler = new Tiler();
    this._cache = { inflight: new Map() };
    this._metadata = new Map();     // Map<key, WaybackMetadata>  where `key` like 'tileID_YYYY-MM-DD'
    this._localDates = new Map();   // Map<tileID, Array<releaseDate>>
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets!;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync())
      .then(() => {
        // Tell the AssetSystem what to load..
        assets.registerAsset('wayback', { preferred: 'data/wayback.min.json' });
        return assets.loadAssetAsync('wayback');
      })
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
        const releases = (data as any)?.wayback || {};

        for (const [k, release] of Object.entries(releases) as [string, any][]) {
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
        let previous: WaybackRelease | null = null;
        for (const d of this.allDates) {
          const curr = this.byReleaseDate.get(d)!;
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
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const network = this.context.systems.network!;
    network.abortMatching(id => /^wayback-/.test(id));

    this._cache = {
      inflight: new Map()  // Map<TileID, InflightEntry>
    };

//    const spatial = this.context.systems.spatial;
//    spatial.clearCache('wayback');

    return Promise.resolve();
  }


  /**
   * This compares the requested date value against the supported dates in the Wayback archive and finds
   * the closest supported date without going over.  All dates are strings in YYYY-MM-DD format.
   * @param val - Requested date, as YYYY-MM-DD
   * @return Closest supported date, as YYYY-MM-DD
   */
  public chooseClosestDate(val: Nullable<DateLike>): string {
    let chooseDate = this.allDates[0];  // start with earliest date

    const requestDate = utilDateString(val);
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
   * Return a Promise to get the list of wayback imagery dates that appear changed in the current view.
   * @return Promise resolved with an `Array<releaseDate>` for the current view
   */
  public getLocalDatesAsync(): Promise<string[] | void> {
    const context = this.context;
    const network = context.systems.network!;
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
    network.abortMatching(id => /^wayback-/.test(id));
    cache.inflight.clear();

    const prom = Promise.resolve()
      .then(() => this.checkTilemapsAsync(tile))
      .then(releases => this.checkImagesAsync(releases, tile))
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

    cache.inflight.set(tileID, { promise: prom });
    return prom;
  }


  /**
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
   * @param tile - the Tile to check
   * @return Promise resolved with a `Map<releaseDate, release>` candidate releases for the given tile
   */
  public checkTilemapsAsync(tile: Tile): Promise<Map<string, WaybackRelease>> {
    const latestDate = this.allDates.at(-1);
    const latestRelease = latestDate ? this.byReleaseDate.get(latestDate) : undefined;
    const [x, y, z] = tile.xyz;
    const keepReleases = new Map<string, WaybackRelease>();  // Map<releaseDate, release>
    const network = this.context.systems.network!;

    // Starting with latest release, fetch the tilemaps until we have them all..
    return new Promise<Map<string, WaybackRelease>>((resolve, reject) => {
      const getTilemap = (release: WaybackRelease): void => {
        const releaseNumber = release.releaseNumber;
        const releaseDate = release.releaseDate;
        const url = `${WAYBACK_SERVICE_BASE_PROD}/tilemap/${releaseNumber}/${z}/${y}/${x}`;
        const requestID = `wayback-tilemap-${tile.id}-${releaseNumber}`;

        network.fetch<any>(url, { requestID })
          .then(response => {
            const data = (response.data || [])[0];
            const select = (response.select || [])[0]?.toString();
            let nextNumber: string | undefined;

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
   * This is used to implement the change detector from the Wayback library.
   * @see https://github.com/lovexiaowei/wayback-core/blob/main/src/change-detector/index.ts
   *
   * In this step we take the release candidates from `checkTileMapsAsync`
   *  and request an image from each one to guess which ones actually have changed.
   * The Wayback library actually fetches images and compares their imageData.
   * This is slow, so instead we'll try doing HEAD requests and just look at their content length.
   * @see https://github.com/rapideditor/wayback-core/issues/1
   *
   * @param releases - Map of candidate releases to check
   * @param tile - the Tile to check
   * @return Promise resolved with a `Map<releaseDate, release>` candidate releases for the given tile
   */
  public checkImagesAsync(releases: Map<string, WaybackRelease>, tile: Tile): Promise<Map<string, WaybackRelease>> {
    const dates = [...releases.keys()].sort();  // sort as strings ascending
    const [x, y, z] = tile.xyz;
    const network = this.context.systems.network!;

    // Generate promises for Promise.all, it can happen in parallel.
    const promises = dates.map(date => {
      const release = releases.get(date)!;
      const url = release.itemURL
        .replaceAll('{level}', z.toString())
        .replaceAll('{row}', y.toString())
        .replaceAll('{col}', x.toString());

      const requestID = `wayback-image-${tile.id}-${date}`;

      // Note: we use fertchRaw here because we're really looking at the content-length header
      // This doesn't call `utilFetchResponse`, so we need to check `response.ok` ourselves.
      return network.fetchRaw(url, { method: 'HEAD', requestID })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          // get some information about the image
          return {
            release:       release,
            releaseNumber: release.releaseNumber,
            releaseDate:   release.releaseDate,
            xyz:           tile.xyz,
            size:          Number(response.headers.get('content-length')) || 0
          };
        });

    }).filter(Boolean);

    return Promise.all(promises)
      .then(results => {
        const keepReleases = new Map<string, WaybackRelease>();  // Map<releaseDate, release>
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
   * Get the metadata for the given tile and release date.
   * @param tile - the Tile to check
   * @param releaseDate - the releaseDate to check
   * @return Promise resolved with imagery metadata
   */
  public getMetadataAsync(tile: Tile, releaseDate: string): Promise<WaybackMetadata> {
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

    const url = `${release.metadataLayerUrl}/${layerID}/query?` + utilQsString(params, false);
    const network = this.context.systems.network!;

    return network.fetch<any>(url, { requestID: `wayback-meta-${key}` })
      .then(response => {
        if (response.error) {
          throw new Error(response.error);
        }

        const attr = (response.features || [])[0]?.attributes;
        if (!attr) {
          throw new Error(`Metadata not found for ${tile.id} release ${releaseDate}`);
        }

        const metadata: WaybackMetadata = {
          captureDate:  utilDateString(attr.SRC_DATE2),   // '2024-02-14'
          provider:     attr.NICE_DESC,  // 'Maxar'
          source:       attr.SRC_DESC,   // 'WV03'
          resolution:   attr.SAMP_RES,   // 0.3  (meters / px)
          accuracy:     attr.SRC_ACC     // 5    (meters within true location)
        };
        this._metadata.set(key, metadata);
        return metadata;
      });


    function getLayerID(zoom: number): number {
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

}
