import RBush, { type BBox } from 'rbush';

import { Graph } from '../lib/Graph.ts';
import { AbstractSystem } from './AbstractSystem.ts';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { Extent } from '@rapid-sdk/math';
import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from './types.ts';
import type { Vec2, Vec3 } from '../data/types.ts';


/**
 * A spatial index box with associated cache and data references.
 * Extends the RBush BBox with additional metadata.
 */
export interface Box extends BBox {
  /** The cache this box belongs to */
  cacheID: string;
  /** The data or tile ID */
  dataID: string;
  /** The associated data or tile object */
  data: AbstractData | Tile;
}


/**
 * A tile representing a loaded spatial region.
 */
export interface Tile {
  /** Tile identifier string, e.g. '0,0,0' */
  id: string;
  /** Tile coordinate array [x, y, z] */
  xyz: Vec3;
  /** Extent in world coordinates */
  tileExtent: Extent;
  /** Extent in WGS84 coordinates [lon,lat] */
  wgs84Extent: Extent;
  /** `true` if the tile is in view, `false` if not */
  isVisible: boolean;
}


/**
 * Internal cache structure for spatial data.
 */
interface SpatialCache {
  /** Graph of entities */
  graph: Graph;
  /** Map of dataID or tileID to Box */
  boxes: Map<string, Box>;
  /** Map of tileID to Tile */
  tiles: Map<string, Tile>;
  /** Map of dataID to AbstractData */
  data: Map<string, AbstractData>;
  /** RBush index for tiles */
  tileRBush: RBush<Box>;
  /** RBush index for data */
  dataRBush: RBush<Box>;
}


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
  /** Map of cacheID to SpatialCache */
  private _caches: Map<string, SpatialCache>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'spatial';

    this._caches = new Map();
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    for (const cacheID of this._caches.keys()) {
      this.clearCache(cacheID);
    }
    return Promise.resolve();
  }


  /**
   * getCache
   * Get a cache identified by the given ID.
   * Create it if it doesn't exist yet.
   * @param cacheID - the cache to get (or create)
   * @return cache data
   */
  getCache(cacheID: string): SpatialCache {
    let cache = this._caches.get(cacheID);
    if (!cache) {
      cache = {
        graph:      new Graph(this.context),
        boxes:      new Map(),
        tiles:      new Map(),
        data:       new Map(),
        tileRBush:  new RBush<Box>(),
        dataRBush:  new RBush<Box>()
      };
      this._caches.set(cacheID, cache);
    }
    return cache;
  }


  /**
   * clearCache
   * Clear (remove all items from) the given cache
   * @param cacheID - the cache to clear
   */
  clearCache(cacheID: string): void {
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
   * @param cacheID - the cache to insert into
   * @param items - items to add
   */
  addData(cacheID: string, items: OneOrMore<AbstractData>): void {
    this.replaceData(cacheID, items);
  }


  /**
   * replaceData
   * Insert or update data in the cache
   * @param cacheID - the cache to insert into
   * @param items - items to replace
   */
  replaceData(cacheID: string, items: OneOrMore<AbstractData>): void {
    const cache = this.getCache(cacheID);

    const toInsert: Box[] = [];
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

      const box = extent.bbox() as Box;
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
   * @param cacheID - the cache to remove from
   * @param itemsOrIDs - items to remove
   */
  removeData(cacheID: string, itemsOrIDs: OneOrMore<AbstractData | string>): void {
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
   * Insert tiles into the cache. This is how we mark data as loaded.
   * @param cacheID - the cache to insert into
   * @param items - tiles to insert
   */
  addTiles(cacheID: string, items: OneOrMore<Tile>): void {
    const cache = this.getCache(cacheID);

    const toInsert: Box[] = [];
    for (const tile of utilIterable(items)) {
      if (!tile) continue;
      const tileID = tile.id;

      // skip if tile is already indexed
      if (cache.boxes.has(tileID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = tile.tileExtent;  // these are in world coordinates now
      if (!extent) continue;

      const box = extent.bbox() as Box;
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
   * @param cacheID - the cache to remove from
   * @param itemsOrIDs - items to remove
   */
  removeTiles(cacheID: string, itemsOrIDs: OneOrMore<Tile | string>): void {
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
   * @param cacheID - the cache to search
   * @return Array of boxes in the current map view
   */
  getVisibleData(cacheID: string): Box[] {
    const cache = this.getCache(cacheID);
    const extent = (this.context as any).viewport.visibleWorldExtent();   // world extent!
    return cache.dataRBush.search(extent.bbox());
  }

  /**
   * getAllVisibleData
   * Get all visible data for all caches.
   * This would only really be used for debugging purposes, it might return a lot.
   * @return Array of boxes in the current map view
   */
  getAllVisibleData(): Box[] {
    const results: Box[] = [];
    for (const cacheID of this._caches.keys()) {
      results.push(...this.getVisibleData(cacheID));
    }
    return results;
  }

  /**
   * getData
   * Return the requested data.
   * @param cacheID - the cache to search
   * @param dataID - the dataID to lookup
   * @return The data if found, or `undefined` if not found
   */
  getData(cacheID: string, dataID: string): AbstractData | undefined {
    const cache = this.getCache(cacheID);
    return cache.data.get(dataID);
  }

  /**
   * hasData
   * Is the given dataID one we know about?
   * @param cacheID - the cache to search
   * @param dataID - the dataID to lookup
   * @return `true` if data exists, `false` if not
   */
  hasData(cacheID: string, dataID: string): boolean {
    const cache = this.getCache(cacheID);
    return cache.data.has(dataID);
  }

  /**
   * getDataAtBox
   * Search for data within the given cache and search box.
   * @param cacheID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   */
  getDataAtBox(cacheID: string, box: BBox): Box[] {
    const cache = this.getCache(cacheID);
    return cache.dataRBush.search(box);
  }

  /**
   * hasDataAtBox
   * Does data exist in the given search box?
   * @param cacheID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  hasDataAtBox(cacheID: string, box: BBox): boolean {
    const cache = this.getCache(cacheID);
    return cache.dataRBush.collides(box);
  }

  /**
   * getDataAtLoc
   * Search for data at the given [lon,lat] coordinate.
   * @param cacheID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   */
  getDataAtLoc(cacheID: string, loc: Vec2): Box[] {
    const cache = this.getCache(cacheID);
    const [x, y] = (this.context as any).viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.search(test);
  }

  /**
   * hasDataAtLoc
   * Does data exist at the given [lon,lat] coordinate?
   * @param cacheID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if data exists there, `false` if not
   */
  hasDataAtLoc(cacheID: string, loc: Vec2): boolean {
    const cache = this.getCache(cacheID);
    const [x, y] = (this.context as any).viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.collides(test);
  }


  /**
   * preventCoincidentLoc
   * This checks if the cache already has something at that location, and if so,
   *  moves the location down slightly to a location that doesn't conflict.
   * Used for Markers in situations where you don't want them covering each other.
   * @param cacheID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Adjusted [lon,lat] coordinate
   */
  preventCoincidentLoc(cacheID: string, loc: Vec2): Vec2 {
    const viewport = (this.context as any).viewport;
    const cache = this.getCache(cacheID);
    const [x, startY] = viewport.wgs84ToWorld(loc);
    let y = startY;
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
   * Return the requested tile.
   * @param cacheID - the cache to search
   * @param tileID - the tileID to lookup
   * @return The tile if found, or `undefined` if not found
   */
  getTile(cacheID: string, tileID: string): Tile | undefined {
    const cache = this.getCache(cacheID);
    return cache.tiles.get(tileID);
  }

  /**
   * hasTile
   * Is the given tileID one we know about?
   * @param cacheID - the cache to search
   * @param tileID - the tileID to lookup
   * @return `true` if the tile is loaded, `false` if not
   */
  hasTile(cacheID: string, tileID: string): boolean {
    const cache = this.getCache(cacheID);
    return cache.tiles.has(tileID);
  }

  /**
   * hasTileAtBox
   * Does a tile exist in the given search box?
   * @param cacheID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  hasTileAtBox(cacheID: string, box: BBox): boolean {
    const cache = this.getCache(cacheID);
    return cache.tileRBush.collides(box);
  }

  /**
   * hasTileAtLoc
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param cacheID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if a tile has been loaded there, `false` if not
   */
  hasTileAtLoc(cacheID: string, loc: Vec2): boolean {
    const cache = this.getCache(cacheID);
    const [x, y] = (this.context as any).viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.tileRBush.collides(test);
  }

}
