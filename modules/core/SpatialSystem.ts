import RBush, { type BBox } from 'rbush';

import { Graph } from '../lib/Graph.ts';
import { AbstractSystem } from './AbstractSystem.ts';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from '../Context.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


/**
 * A spatial index box with associated cache and data references.
 * Extends the RBush BBox with additional metadata.
 */
export interface Box extends BBox {
  /** The dataset cache this box belongs to */
  datasetID: DatasetID;
  /** The data or tile ID (note: it is assumed that DataIDs and TileIDs will not clash) */
  boxID: DataID | TileID;
  /** The associated data or tile object */
  contents: AbstractData | Tile;
}

/**
 * Internal cache structure for spatial data.
 */
interface SpatialCache {
  /** Graph of entities */
  graph: Graph;
  /** Map of dataID or tileID to Box */
  boxes: Map<DataID | TileID, Box>;
  /** Map of tileID to Tile */
  tiles: Map<TileID, Tile>;
  /** Map of dataID to AbstractData */
  data: Map<DataID, AbstractData>;
  /** RBush index for tiles */
  tileRBush: RBush<Box>;
  /** RBush index for data */
  dataRBush: RBush<Box>;
}


/**
 * `SpatialSystem` maintains spatial caches of all data known to Rapid.
 *  It is used to compute which data is visible and to perform conflation across data layers.
 *  All data should be stored in "world coordinates", (projected to Mercator but unscaled).
 *
 *  Each spatial cache must be identified by a unique `datasetID` string.
 *  For example: 'osm', 'fbRoads', 'msBuildings', 'mapillary-images'
 *  The contents of each cache may contain:
 *  - data, derived from the `AbstractData` class.
 *  - tiles, to indicate where data has been loaded.
 *
 *  This code is a wrapper around the RBush library
 *  @see https://github.com/mourner/rbush
 *
 *  It replaces older code from:
 *  - `Tree.js` which only indexed the OSM data
 *  - Various rbushes scattered around the service code
 */
export class SpatialSystem extends AbstractSystem {
  /** Map of datasetID to SpatialCache */
  private _caches: Map<DatasetID, SpatialCache>;

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
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    for (const datasetID of this._caches.keys()) {
      this.clearCache(datasetID);
    }
    return Promise.resolve();
  }


  /**
   * Get a cache identified by the given ID.
   * Create it if it doesn't exist yet.
   * @param datasetID - the cache to get (or create)
   * @return cache data
   */
  getCache(datasetID: DatasetID): SpatialCache {
    let cache = this._caches.get(datasetID);
    if (!cache) {
      cache = {
        graph:      new Graph(this.context),
        boxes:      new Map(),
        tiles:      new Map(),
        data:       new Map(),
        tileRBush:  new RBush<Box>(),
        dataRBush:  new RBush<Box>()
      };
      this._caches.set(datasetID, cache);
    }
    return cache;
  }


  /**
   * Clear (remove all items from) the given cache
   * @param datasetID - the cache to clear
   */
  clearCache(datasetID: DatasetID): void {
    const cache = this.getCache(datasetID);
    cache.graph = new Graph(this.context);
    cache.boxes.clear();
    cache.tiles.clear();
    cache.data.clear();
    cache.tileRBush.clear();
    cache.dataRBush.clear();
  }


  /**
   * Insert data into the given cache.
   * (addData and replaceData are the same)
   * @param datasetID - the cache to insert into
   * @param items - items to add
   */
  addData(datasetID: DatasetID, items: OneOrMore<AbstractData>): void {
    this.replaceData(datasetID, items);
  }


  /**
   * Insert or update data in the cache
   * @param datasetID - the cache to insert into
   * @param items - items to replace
   */
  replaceData(datasetID: DatasetID, items: OneOrMore<AbstractData>): void {
    const cache = this.getCache(datasetID);

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
      box.datasetID = datasetID;
      box.boxID = dataID;
      box.contents = data;

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
   * Remove data from the cache.
   * Can pass either data or dataIDs for removal.
   * @param datasetID - the cache to remove from
   * @param itemsOrIDs - items to remove
   */
  removeData(datasetID: DatasetID, itemsOrIDs: OneOrMore<AbstractData | DataID>): void {
    const cache = this.getCache(datasetID);

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
   * Insert tiles into the cache. This is how we mark data as loaded.
   * @param datasetID - the cache to insert into
   * @param items - tiles to insert
   */
  addTiles(datasetID: DatasetID, items: OneOrMore<Tile>): void {
    const cache = this.getCache(datasetID);

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
      box.datasetID = datasetID;
      box.boxID = tileID;
      box.contents = tile;

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
   * Remove tiles from the cache.
   * Can pass either tiles or tileIDs for removal.
   * @param datasetID - the cache to remove from
   * @param itemsOrIDs - items to remove
   */
  removeTiles(datasetID: DatasetID, itemsOrIDs: OneOrMore<Tile | TileID>): void {
    const cache = this.getCache(datasetID);

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
   * Get already loaded and cached data that appears in the current map view
   * @param datasetID - the cache to search
   * @return Array of boxes in the current map view
   */
  getVisibleData(datasetID: DatasetID): Box[] {
    const cache = this.getCache(datasetID);
    const extent = this.context.viewport.visibleWorldExtent();   // world extent!
    return cache.dataRBush.search(extent.bbox());
  }

  /**
   * Get all visible data for all caches.
   * This would only really be used for debugging purposes, it might return a lot.
   * @return Array of boxes in the current map view
   */
  getAllVisibleData(): Box[] {
    const results: Box[] = [];
    for (const datasetID of this._caches.keys()) {
      results.push(...this.getVisibleData(datasetID));
    }
    return results;
  }

  /**
   * Return the requested data.
   * @param datasetID - the cache to search
   * @param dataID - the dataID to lookup
   * @return The data if found, or `undefined` if not found
   */
  getData<T extends AbstractData = AbstractData>(datasetID: Nullable<DatasetID>, dataID: Nullable<DataID>): T | undefined {
    if (!datasetID || !dataID) return undefined;
    const cache = this.getCache(datasetID);
    return cache.data.get(dataID) as T | undefined;
  }

  /**
   * Is the given dataID one we know about?
   * @param datasetID - the cache to search
   * @param dataID - the dataID to lookup
   * @return `true` if data exists, `false` if not
   */
  hasData(datasetID: DatasetID, dataID: DataID): boolean {
    const cache = this.getCache(datasetID);
    return cache.data.has(dataID);
  }

  /**
   * Search for data within the given cache and search box.
   * @param datasetID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   */
  getDataAtBox(datasetID: DatasetID, box: BBox): Box[] {
    const cache = this.getCache(datasetID);
    return cache.dataRBush.search(box);
  }

  /**
   * Does data exist in the given search box?
   * @param datasetID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  hasDataAtBox(datasetID: DatasetID, box: BBox): boolean {
    const cache = this.getCache(datasetID);
    return cache.dataRBush.collides(box);
  }

  /**
   * Search for data at the given [lon,lat] coordinate.
   * @param datasetID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   */
  getDataAtLoc(datasetID: DatasetID, loc: Vec2): Box[] {
    const cache = this.getCache(datasetID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.search(test);
  }

  /**
   * Does data exist at the given [lon,lat] coordinate?
   * @param datasetID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if data exists there, `false` if not
   */
  hasDataAtLoc(datasetID: DatasetID, loc: Vec2): boolean {
    const cache = this.getCache(datasetID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.collides(test);
  }

  /**
   * This checks if the cache already has something at that location, and if so,
   *  moves the location down slightly to a location that doesn't conflict.
   * Used for Markers in situations where you don't want them covering each other.
   * @param datasetID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Adjusted [lon,lat] coordinate
   */
  preventCoincidentLoc(datasetID: DatasetID, loc: Vec2): Vec2 {
    const viewport = this.context.viewport;
    const cache = this.getCache(datasetID);
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
   * Return the requested tile.
   * @param datasetID - the cache to search
   * @param tileID - the tileID to lookup
   * @return The tile if found, or `undefined` if not found
   */
  getTile(datasetID: DatasetID, tileID: TileID): Tile | undefined {
    const cache = this.getCache(datasetID);
    return cache.tiles.get(tileID);
  }

  /**
   * Is the given tileID one we know about?
   * @param datasetID - the cache to search
   * @param tileID - the tileID to lookup
   * @return `true` if the tile is loaded, `false` if not
   */
  hasTile(datasetID: DatasetID, tileID: TileID): boolean {
    const cache = this.getCache(datasetID);
    return cache.tiles.has(tileID);
  }

  /**
   * Does a tile exist in the given search box?
   * @param datasetID - the cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  hasTileAtBox(datasetID: DatasetID, box: BBox): boolean {
    const cache = this.getCache(datasetID);
    return cache.tileRBush.collides(box);
  }

  /**
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param datasetID - the cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if a tile has been loaded there, `false` if not
   */
  hasTileAtLoc(datasetID: DatasetID, loc: Vec2): boolean {
    const cache = this.getCache(datasetID);
    const [x, y] = this.context.viewport.wgs84ToWorld(loc);
    const epsilon = 1e-7;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.tileRBush.collides(test);
  }

}
