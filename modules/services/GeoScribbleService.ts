import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';

import type { Context } from '../Context.ts';
import type { Tile } from '@rapid-sdk/math';


/** Zoom level used for tiling GeoScribble data requests */
const TILEZOOM = 14;
/** Base URL for the GeoScribble GeoJSONData API endpoint */
const GEOSCRIBBLE_API = 'https://geoscribble.osmz.ru/geojson';


/** Internal cache for GeoScribble tile data */
interface GeoScribbleCache {
  /** Viewport version number from the last data fetch, used to skip redundant loads */
  lastv: number | null;
}


/**
 * `GeoScribbleService`
 * GeoScribble is a service that allows users to collaboratively draw on the map.
 * This service connects to the GeoScribble API to fetch public 'scribbles'.
 * @see https://wiki.openstreetmap.org/wiki/GeoScribble
 * @see https://geoscribble.osmz.ru/docs
 * @see https://github.com/Zverik/geoscribble
 */
export class GeoScribbleService extends AbstractSystem {
  /** Internal cache holding in-flight requests and viewport version tracking */
  _cache: GeoScribbleCache;
  /** Tiler instance used to compute which tiles cover the current viewport */
  _tiler: Tiler;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'geoscribble';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx']);
    this.autoStart = false;

    this._cache = {} as GeoScribbleCache;
    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    network.abortMatching(id => /^geoscribble-/.test(id));
    spatial.clearCache('geoscribble');

    this._cache = {
      lastv:  null  // viewport version last time we fetched data
    };

    return Promise.resolve();
  }


  /**
   * Get already loaded data that appears in the current map view
   * @return  Array of data
   */
  getData(): any[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleData('geoscribble').map(hit => hit.contents);
  }


  /**
   * Schedule any data requests needed to cover the current map view
   */
  loadTiles(): void {
    const cache = this._cache;
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const viewport = context.viewport;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(tiles.map(t => `geoscribble-${t.id}`));
    network.abortMatching(id => /^geoscribble-/.test(id) && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      const requestID = `geoscribble-${tileID}`;
      if (spatial.hasTile('geoscribble', tileID) || network.isInflight(requestID)) continue;

      const rect = tile.wgs84Extent.rectangle().join(',');
      const url = GEOSCRIBBLE_API + '?' + utilQsString({ bbox: rect }, false);

      network.fetch<any>(url, { requestID })
        .then(response => this._gotTile(tile, response))
        .catch(err => {
          if (err.name === 'AbortError') return;  // ok
          spatial.addTiles('geoscribble', [tile]);   // don't retry
          if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        });
    }
  }


  /**
   * Parse the response from the tile fetch
   * @param tile - Tile data
   * @param response - Response data
   */
  _gotTile(tile: Tile, response: any): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;

    spatial.addTiles('geoscribble', [tile]);   // mark as loaded

    if (!Array.isArray(response?.features)) {
      throw new Error('Invalid response');
    }

    const toLoad: GeoJSONData[] = [];
    for (const feature of response.features) {
      toLoad.push(new GeoJSONData(context, { serviceID: this.id, geojson: feature }));
    }

    spatial.addData('geoscribble', toLoad);

    gfx?.deferredRedraw();
  }

}
