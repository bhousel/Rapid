import RBush from 'rbush';

import { Graph } from '../models/Graph.js';
import { AbstractSystem } from './AbstractSystem.js';
import { utilIterable } from '../util/iterable.js';


/**
 * `SpatialSystem` maintains common spatial caches of all data known to Rapid.
 *  It is used to compute which data is visible and to perform conflation across data layers.
 *  All data should be stored in "world coordinates", (projected to Mercator but unscaled).
 *
 *  Each cache must be identified by a unique `cacheID` string.
 *
 *  This code is a wrapper around the RBush library
 *  @see https://github.com/mourner/rbush
 *
 *  It replaces older code from:
 *  - `Tree.js` which only indexed the OSM data
 *  - Various rbushes scattered around the service code
 */
export class SpatialSystem extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'spatial';
    this.dependencies = new Set();

    this._caches = new Map();  // Map<cacheID, Object>
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    for (const id of this.dependencies) {
      if (!this.context.systems[id]) {
        return Promise.reject(`Cannot init:  ${this.id} requires ${id}`);
      }
    }
    return Promise.resolve();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    for (const cacheID of this._caches.keys()) {
      this.clearCache(cacheID);
    }
    return Promise.resolve();
  }


  /**
   * getCache
   * Get a cache identified by the given ID.
   * Create it if it doesn't exist yet.
   * @param   {string}  cacheID  - the cache to get (or create)
   * @return  {Object}  cache data
   */
  getCache(cacheID) {
    let cache = this._caches.get(cacheID);
    if (!cache) {
      cache = {
        graph:      new Graph(this.context),
        boxes:      new Map(),    // Map<dataID|tileID, Box>
        tiles:      new Map(),    // Map<tileID, Tile>
        data:       new Map(),    // Map<dataID, AbstractData>
        tileRBush:  new RBush(),
        dataRBush:  new RBush()
      };
      this._caches.set(cacheID, cache);
    }
    return cache;
  }


  /**
   * clearCache
   * Clear (remove all items from) the given cache
   * @param  {string}  cacheID - the cache to clear
   */
  clearCache(cacheID) {
    const cache = this.getCache(cacheID);
    cache.graph = new Graph(this.context);
    cache.boxes.clear();
    cache.tiles.clear();
    cache.data.clear();
    cache.tileRBush.clear();
    cache.dataRBush.clear();
  }


  /**
   * addData
   * Insert data into the given cache.
   * (addData and replaceData are the same)
   * @param  {string}                   cacheID - the cache to insert into
   * @param  {OneOrMore<AbstractData>}  items   - items to add
   */
  addData(cacheID, items) {
    this.replaceData(cacheID, items);
  }


  /**
   * replaceData
   * Insert or update data in the cache
   * @param  {string}                   cacheID - the cache to insert into
   * @param  {OneOrMore<AbstractData>}  items   - items to replace
   */
  replaceData(cacheID, items) {
    const cache = this.getCache(cacheID);

    const toInsert = [];
    for (const data of utilIterable(items)) {
      if (!data) continue;
      const dataID = data.id;

      // remove existing..
      const existing = cache.boxes.get(dataID);
      if (existing) {
        cache.boxes.delete(dataID);
        cache.data.delete(dataID);
        cache.dataRBush.remove(existing);
      }

      // insert new..
      const extent = data.geoms?.world?.extent;
      if (!extent) continue;

      const box = extent.bbox();
      box.cacheID = cacheID;
      box.dataID = dataID;
      box.data = data;

      cache.boxes.set(dataID, box);
      cache.data.set(dataID, data);
      toInsert.push(box);
    }

    if (toInsert.length > 1) {
      cache.dataRBush.load(toInsert);
    } else if (toInsert.length === 1) {
      cache.dataRBush.insert(toInsert[0]);
    }
  }


  /**
   * removeData
   * Remove data from the cache.
   * Can pass either data or dataIDs for removal.
   * @param  {string}                           cacheID    - the cache to remove from
   * @param  {OneOrMore<AbstractData|dataID>}   itemsOrIDs - items to remove
   */
  removeData(cacheID, itemsOrIDs) {
   const cache = this.getCache(cacheID);

    for (const item of utilIterable(itemsOrIDs)) {
      const dataID = (typeof item === 'string') ? item : item?.id;
      if (!dataID) continue;

      // remove existing
      const existing = cache.boxes.get(dataID);
      if (existing) {
        cache.boxes.delete(dataID);
        cache.data.delete(dataID);
        cache.dataRBush.remove(existing);
      }
    }
  }


  /**
   * addTiles
   * Insert tiles into the cache.  This is how we mark data as loaded.
   * @param  {string}           cacheID  - the cache to insert into
   * @param  {OneOrMore<Tile>}  items    - tiles to insert
   */
  addTiles(cacheID, items) {
    const cache = this.getCache(cacheID);

    const toInsert = [];
    for (const tile of utilIterable(items)) {
      if (!tile) continue;
      const tileID = tile.id;

      // skip if tile is already indexed
      if (cache.boxes.has(tileID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = tile.tileExtent;  // these are in world coordinates now
      if (!extent) continue;

      const box = extent.bbox();
      box.cacheID = cacheID;
      box.dataID = tileID;
      box.data = tile;

      cache.boxes.set(tileID, box);
      cache.tiles.set(tileID, tile);
      toInsert.push(box);
    }

    if (toInsert.length > 1) {
      cache.tileRBush.load(toInsert);
    } else if (toInsert.length === 1) {
      cache.tileRBush.insert(toInsert[0]);
    }
  }


  /**
   * removeTiles
   * Remove tiles from the cache.
   * Can pass either tiles or tileIDs for removal.
   * @param  {string}                   cacheID    - the cache to remove from
   * @param  {OneOrMore<Tile|tileID>}   itemsOrIDs - items to remove
   */
  removeTiles(cacheID, itemsOrIDs) {
   const cache = this.getCache(cacheID);

    for (const item of utilIterable(itemsOrIDs)) {
      const tileID = (typeof item === 'string') ? item : item?.id;
      if (!tileID) continue;

      // remove existing
      const existing = cache.boxes.get(tileID);
      if (existing) {
        cache.boxes.delete(tileID);
        cache.tiles.delete(tileID);
        cache.tileRBush.remove(existing);
      }
    }
  }


  /**
   * getVisibleData
   * Get already loaded and cached data that appears in the current map view
   * @param   {string}      cacheID  - the cache to search
   * @return  {Array<Box>}  Array of data in the current map view
   */
  getVisibleData(cacheID) {
    const cache = this.getCache(cacheID);
    const extent = this.context.viewport.visibleWorldExtent();   // world extent!
    return cache.dataRBush.search(extent.bbox());
  }

  /**
   * getAllVisibleData
   * Get all visible data for all caches.
   * This would only really be used for debugging purposes, it might return a lot.
   * @return  {Array<Box>}  Array of data in the current map view
   */
  getAllVisibleData() {
    const results = [];
    for (const cacheID of this._caches.keys()) {
      results.push(...this.getData(cacheID));
    }
    return results;
  }

  /**
   * getData
   * Return the requested data.
   * @param   {string}         cacheID - the cache to search
   * @param   {string}         dataID  - the dataID to lookup
   * @return  {AbstractData?}  The data if found, or `undefined` if not found
   */
  getData(cacheID, dataID) {
    const cache = this.getCache(cacheID);
    return cache.data.get(dataID);
  }

  /**
   * hasData
   * Is the given dataID one we know about?
   * @param   {string}         cacheID - the cache to search
   * @param   {string}         dataID  - the dataID to lookup
   * @return  {AbstractData?}  The data if found, or `undefined` if not found
   */
  hasData(cacheID, dataID) {
    const cache = this.getCache(cacheID);
    return cache.data.has(dataID);
  }

  /**
   * getDataAtBox
   * Search for data within the given cache and search box.
   * @param   {string}  cacheID   - the cache to search
   * @param   {Box}     box       - the search box (make sure to use world coordinates here)
   * @return  {Array<Box>}  Array of data in the given search box
   */
  getDataAtBox(cacheID, box) {
    const cache = this.getCache(cacheID);
    return cache.dataRBush.search(box);
  }

  /**
   * hasDataAtBox
   * Does data exist in the given search box?
   * @param   {string}   cacheID   - the cache to search
   * @param   {Box}      box       - the search box (make sure to use world coordinates here)
   * @return  {boolean}  `true` if something exists, `false` if not
   */
  hasDataAtBox(cacheID, box) {
    const cache = this.getCache(cacheID);
    return cache.dataRBush.collides(box);
  }

  /**
   * getDataAtLoc
   * Search for data at the given [lon,lat] coordinate.
   * @param   {string}         cacheID  - the cache to search
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @return  {Array<Box>}  Array of data at the given location
   */
  getDataAtLoc(cacheID, loc) {
    const cache = this.getCache(cacheID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.search(test);
  }

  /**
   * hasDataAtLoc
   * Does data exist at the given [lon,lat] coordinate?
   * @param   {string}         cacheID  - the cache to search
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @return  {boolean}  `true` if data exists there, `false` if not
   */
  hasDataAtLoc(cacheID, loc) {
    const cache = this.getCache(cacheID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.collides(test);
  }


  /**
   * preventCoincidentLoc
   * This checks if the cache already has something at that location, and if so,
   *  moves the location down slightly to a location that doesn't conflict.
   * Used for Markers in situations where you don't want them covering each other.
   * @param   {string}         cacheID  - the cache to search
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @return  {Array<number>}  Adjusted [lon,lat] coordinate
   */
  preventCoincidentLoc(cacheID, loc) {
    const viewport = this.context.viewport;
    const cache = this.getCache(cacheID);
    let [x, y] = viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;

    while (true) {
      const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
      const didCollide = cache.dataRBush.collides(test);
      if (!didCollide) {
        return viewport.worldToWgs84([x, y]);
      } else {
        // These are in "world coordinates", so we are moving `y` south in "world pixels":
        // 6356752 (polar radius in meters) * 0.9 (because ±85°) / 256 px * this number = meters moved?
        y += 0.00001;   // roughly 0.22 meters?
      }
    }
  }


  /**
   * getTile
   * Return the reqested tile.
   * @param   {string}   cacheID - the cache to search
   * @param   {string}   tileID  - the tileID to lookup
   * @return  {Tile?}    The tile if found, or `undefined` if not found
   */
  getTile(cacheID, tileID) {
    const cache = this.getCache(cacheID);
    return cache.tiles.get(tileID);
  }

  /**
   * hasTile
   * Is the given tileID one we know about?
   * @param   {string}   cacheID - the cache to search
   * @param   {string}   tileID  - the tileID to lookup
   * @return  {boolean}  `true` if the tile is loaded, `false` if not
   */
  hasTile(cacheID, tileID) {
    const cache = this.getCache(cacheID);
    return cache.tiles.has(tileID);
  }

  /**
   * hasDataAtBox
   * Does data exist in the given search box?
   * @param   {string}   cacheID   - the cache to search
   * @param   {Box}      box       - the search box (make sure to use world coordinates here)
   * @return  {boolean}  `true` if something exists, `false` if not
   */
  hasTileAtBox(cacheID, box) {
    const cache = this.getCache(cacheID);
    return cache.tileRBush.collides(box);
  }

  /**
   * hasTileAtLoc
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param   {string}         cacheID  - the cache to search
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @return  {boolean}  `true` if a tile has been loaded there, `false` if not
   */
  hasTileAtLoc(cacheID, loc) {
    const cache = this.getCache(cacheID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.tileRBush.collides(test);
  }

}


/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  @typedef  {string}  cacheID
 *
 *  @typedef  {Object}  Box
 *   @property {string}   cacheID
 *   @property {string}   dataID
 *   @property {*}        data
 *   @property {number}   minX
 *   @property {number}   minY
 *   @property {number}   maxX
 *   @property {number}   maxY
 *
 *  @typedef  {Object}   Tile
 *   @property {string}         id          - Tile identifier string ex. '0,0,0'
 *   @property {Array<number>}  xyz         - Tile coordinate array ex. [0,0,0]
 *   @property {Extent}         tileExtent  - Extent in world coordinates [x,y]
 *   @property {Extent}         wgs84Extent - Extent in WGS84 coordinates [lon,lat]
 *   @property {boolean}        isVisible   - `true` if the tile in view, `false` if not
 */
