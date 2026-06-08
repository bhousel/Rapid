import { AbstractSystem } from './AbstractSystem.ts';
import { Graph } from '../lib/Graph.ts';
import { projWgs84ToWorld, projWorldToWgs84, WORLD_SCALE } from '@rapid-sdk/math';
import RBush from 'rbush';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


/**
 * A spatial index box with associated cache and data references.
 * Extends the RBush BBox with additional metadata.
 */
export interface Box extends BBox {
  /** The spatial index this box belongs to */
  spatialID: SpatialID;
  /** The data or tile ID (note: it is assumed that DataIDs and TileIDs will not clash) */
  boxID: DataID | TileID;
  /** The associated data or tile object */
  contents: AbstractData | Tile;
}

/**
 * Internal cache structure for spatial data.
 */
interface SpatialCache {
  /** The identifier for this spatial cache */
  id: SpatialID,
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
 *  All data should be stored in "world coordinates", (projected to Mercator and prescaled).
 *
 *  Each spatial cache must be identified by a unique `spatialID` string.
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

  /** Map of spatialID to spatial cache */
  protected _caches: Map<SpatialID, SpatialCache>;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'spatial';

    this._caches = new Map<SpatialID, SpatialCache>();
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
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
    for (const spatialID of this._caches.keys()) {
      this.clearCache(spatialID);
    }
    return Promise.resolve();
  }


  /**
   * Get a spatial cache identified by the given spatial ID.
   * Create it if it doesn't exist yet.
   * @param spatialID - the spatial cache to get (or create)
   * @return spacial cache data
   */
  public getCache(spatialID: SpatialID): SpatialCache {
    let cache = this._caches.get(spatialID);
    if (!cache) {
      cache = {
        id:         spatialID,
        graph:      new Graph(this.context),
        boxes:      new Map<DataID | TileID, Box>(),
        tiles:      new Map<TileID, Tile>(),
        data:       new Map<DataID, AbstractData>(),
        tileRBush:  new RBush<Box>(),
        dataRBush:  new RBush<Box>()
      };
      this._caches.set(spatialID, cache);
    }
    return cache;
  }


  /**
   * Clear (remove all items from) the given spatial cache
   * @param spatialID - the spatial cache to clear
   */
  public clearCache(spatialID: SpatialID): void {
    const cache = this.getCache(spatialID);
    cache.graph = new Graph(this.context);
    cache.boxes.clear();
    cache.tiles.clear();
    cache.data.clear();
    cache.tileRBush.clear();
    cache.dataRBush.clear();
  }


  /**
   * Clear all spatial caches whose spatialID matches a predicate.
   * @param predicate - Function that returns true for spatialIDs to clear
   */
  public clearMatching(predicate: (spatialID: SpatialID) => boolean): void {
    for (const spatialID of this._caches.keys()) {
      if (predicate(spatialID)) {
        this.clearCache(spatialID);
      }
    }
  }


  /**
   * Insert data into the given spatial cache.
   * (addData and replaceData are the same)
   * @param spatialID - the spatial cache to insert into
   * @param items - items to add
   */
  public addData(spatialID: SpatialID, items: OneOrMore<AbstractData>): void {
    this.replaceData(spatialID, items);
  }


  /**
   * Insert or update data in the spatial cache.
   * @param spatialID - the spatial cache to insert into
   * @param items - items to replace
   */
  public replaceData(spatialID: SpatialID, items: OneOrMore<AbstractData>): void {
    const cache = this.getCache(spatialID);

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
      box.spatialID = spatialID;
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
   * Remove data from the spatial cache.
   * Can pass either data or dataIDs for removal.
   * @param spatialID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   */
  public removeData(spatialID: SpatialID, itemsOrIDs: OneOrMore<AbstractData | DataID>): void {
    const cache = this.getCache(spatialID);

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
   * Insert tiles into the spatial cache. This is how we mark data as loaded.
   * @param spatialID - the spatial cache to insert into
   * @param items - tiles to insert
   */
  public addTiles(spatialID: SpatialID, items: OneOrMore<Tile>): void {
    const cache = this.getCache(spatialID);

    const toInsert: Box[] = [];
    for (const tile of utilIterable(items)) {
      if (!tile) continue;
      const tileID = tile.id;

      // skip if tile is already indexed
      if (cache.boxes.has(tileID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = tile.worldExtent;  // already in world (z16) coordinates
      if (!extent) continue;

      const box = extent.bbox() as Box;
      box.spatialID = spatialID;
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
   * Remove tiles from the spatial cache.
   * Can pass either tiles or tileIDs for removal.
   * @param spatialID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   */
  public removeTiles(spatialID: SpatialID, itemsOrIDs: OneOrMore<Tile | TileID>): void {
    const cache = this.getCache(spatialID);

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
   * @param spatialID - the spatial cache to search
   * @return Array of boxes in the current map view
   */
  public getVisibleData(spatialID: SpatialID): Box[] {
    const cache = this.getCache(spatialID);
    const viewport = this.context.viewport;
    return cache.dataRBush.search(viewport.visibleWorldExtent().bbox());
  }

  /**
   * Get all visible data for all spatial caches.
   * This would only really be used for debugging purposes, it might return a lot.
   * @return Array of boxes in the current map view
   */
  public getAllVisibleData(): Box[] {
    const results: Box[] = [];
    for (const spatialID of this._caches.keys()) {
      results.push(...this.getVisibleData(spatialID));
    }
    return results;
  }

  /**
   * Return the requested data.
   * @param spatialID - the spatial cache to search
   * @param dataID - the dataID to lookup
   * @return The data if found, or `undefined` if not found
   */
  public getData<T extends AbstractData = AbstractData>(spatialID: Nullable<SpatialID>, dataID: Nullable<DataID>): T | undefined {
    if (!spatialID || !dataID) return undefined;
    const cache = this.getCache(spatialID);
    return cache.data.get(dataID) as T | undefined;
  }

  /**
   * Is the given dataID one we know about?
   * @param spatialID - the spatial cache to search
   * @param dataID - the dataID to lookup
   * @return `true` if data exists, `false` if not
   */
  public hasData(spatialID: SpatialID, dataID: DataID): boolean {
    const cache = this.getCache(spatialID);
    return cache.data.has(dataID);
  }

  /**
   * Search for data within the given spatial cache and search box.
   * @param spatialID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   */
  public getDataAtBox(spatialID: SpatialID, box: BBox): Box[] {
    const cache = this.getCache(spatialID);
    return cache.dataRBush.search(box);
  }

  /**
   * Does data exist in the given search box?
   * @param spatialID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  public hasDataAtBox(spatialID: SpatialID, box: BBox): boolean {
    const cache = this.getCache(spatialID);
    return cache.dataRBush.collides(box);
  }

  /**
   * Search for data at the given [lon,lat] coordinate.
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   */
  public getDataAtLoc(spatialID: SpatialID, loc: Vec2): Box[] {
    const cache = this.getCache(spatialID);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.search(test);
  }

  /**
   * Does data exist at the given [lon,lat] coordinate?
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if data exists there, `false` if not
   */
  public hasDataAtLoc(spatialID: SpatialID, loc: Vec2): boolean {
    const cache = this.getCache(spatialID);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.dataRBush.collides(test);
  }

  /**
   * This checks if the spatial cache already has something at that location, and if so,
   *  moves the location down slightly to a location that doesn't conflict.
   * Used for Markers in situations where you don't want them covering each other.
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Adjusted [lon,lat] coordinate
   */
  public preventCoincidentLoc(spatialID: SpatialID, loc: Vec2): Vec2 {
    const cache = this.getCache(spatialID);
    const [x, startY] = projWgs84ToWorld(loc);
    let y = startY;
    const epsilon = 1e-7 * WORLD_SCALE;

    while (true) {
      const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
      const didCollide = cache.dataRBush.collides(test);
      if (!didCollide) {
        return projWorldToWgs84([x, y]);
      } else {
        // These are in world coordinates, so we are moving `y` south:
        // 6356752 (polar radius in meters) * 0.9 (because ±85°) / 256 px * this number / WORLD_SCALE = meters moved?
        y += 0.00001 * WORLD_SCALE;   // roughly 0.22 meters?
      }
    }
  }


  /**
   * Return the requested tile.
   * @param spatialID - the spatial cache to search
   * @param tileID - the tileID to lookup
   * @return The tile if found, or `undefined` if not found
   */
  public getTile(spatialID: SpatialID, tileID: TileID): Tile | undefined {
    const cache = this.getCache(spatialID);
    return cache.tiles.get(tileID);
  }

  /**
   * Is the given tileID one we know about?
   * @param spatialID - the spatial cache to search
   * @param tileID - the tileID to lookup
   * @return `true` if the tile is loaded, `false` if not
   */
  public hasTile(spatialID: SpatialID, tileID: TileID): boolean {
    const cache = this.getCache(spatialID);
    return cache.tiles.has(tileID);
  }

  /**
   * Does a tile exist in the given search box?
   * @param spatialID - the spatial cache to search
    * @param box - the search box (world coordinates, z16)
   * @return `true` if something exists, `false` if not
   */
  public hasTileAtBox(spatialID: SpatialID, box: BBox): boolean {
    const cache = this.getCache(spatialID);
    return cache.tileRBush.collides(box);
  }

  /**
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if a tile has been loaded there, `false` if not
   */
  public hasTileAtLoc(spatialID: SpatialID, loc: Vec2): boolean {
    const cache = this.getCache(spatialID);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return cache.tileRBush.collides(test);
  }

}
