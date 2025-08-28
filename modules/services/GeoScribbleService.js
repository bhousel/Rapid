import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { GeoJSON } from '../models/GeoJSON.js';
import { utilFetchResponse } from '../util/index.js';


const TILEZOOM = 16.5;
const GEOSCRIBBLE_API = 'https://geoscribble.osmz.ru/geojson';


/**
 * `GeoScribbleService`
 * GeoScribble is a service that allows users to collaboratively draw on the map.
 * This service connects to the GeoScribble API to fetch public 'scribbles'.
 * @see https://wiki.openstreetmap.org/wiki/GeoScribble
 * @see https://geoscribble.osmz.ru/docs
 * @see https://github.com/Zverik/geoscribble
 *
 * Events available:
 *   'loadedData'
 */
export class GeoScribbleService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'geoscribble';
    this.requiredDependencies = new Set(['spatial']);
    this.optionalDependencies = new Set(['gfx']);
    this.autoStart = false;

    this._cache = {};
    this._tiler = new Tiler().zoomRange(TILEZOOM).skipNullIsland(true);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
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
      for (const controller of this._cache.inflight.values()) {
        controller.abort();
      }
    }

    this._cache = {
      inflight:  new Map(),   // Map<tileID, AbortController>
      lastv:     null         // viewport version last time we fetched data
    };

    const spatial = this.context.systems.spatial;
    spatial.clearCache('geoscribble');

    return Promise.resolve();
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @return  {Array<GeoJSON>}  Array of data
   */
  getData() {
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('geoscribble').map(d => d.data);
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   */
  loadTiles() {
    const cache = this._cache;
    const context = this.context;
    const spatial = context.systems.spatial;
    const viewport = context.viewport;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const [tileID, controller] of cache.inflight) {
      const isNeeded = tiles.some(tile => tile.id === tileID);
      if (!isNeeded) {
        controller.abort();
      }
    }

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      if (spatial.hasTile('geoscribble', tileID) || cache.inflight.has(tileID)) continue;

      const rect = tile.wgs84Extent.rectangle().join(',');
      const url = GEOSCRIBBLE_API + '?' + utilQsString({ bbox: rect });

      const controller = new AbortController();
      cache.inflight.set(tileID, controller);

      fetch(url, { signal: controller.signal })
        .then(utilFetchResponse)
        .then(response => this._gotTile(tile, response))
        .catch(err => {
          if (err.name === 'AbortError') return;  // ok
          spatial.addTiles('geoscribble', [tile]);   // don't retry
          if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        })
        .finally(() => {
          cache.inflight.delete(tileID);
        });
    }
  }


  /**
   * _gotTile
   * Parse the response from the tile fetch
   * @param  {Tile}    tile - Tile data
   * @param  {Object}  response - Response data
   */
  _gotTile(tile, response) {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;

    spatial.addTiles('geoscribble', [tile]);   // mark as loaded

    if (!Array.isArray(response?.features)) {
      throw new Error('Invalid response');
    }

    const toLoad = [];
    for (const feature of response.features) {
      toLoad.push(new GeoJSON(context, { serviceID: this.id, geojson: feature }));
    }

    spatial.addData('geoscribble', toLoad);

    gfx?.deferredRedraw();
    this.emit('loadedData');
  }

}
