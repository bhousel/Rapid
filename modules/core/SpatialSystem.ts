import { AbstractSystem } from './AbstractSystem.ts';
import { projWgs84ToWorld, projWorldToWgs84, WORLD_SCALE } from '@rapid-sdk/math';
import RBush from 'rbush';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { Extent, Tile, Vec2 } from '@rapid-sdk/math';


/** Convenience type - boxes are identified by either a data or tile ID */
type BoxID = DataID | TileID;

/** Names of the standard indexes within a spatial cache */
const DATA = 'data';
const TILES = 'tiles';

/**
 * A spatial index box with associated cache and data references.
 * Extends the RBush BBox with additional metadata.
 */
export interface SpatialBox extends BBox {
  /**
   * A unique Box identifier, should be a DataID or a TileID (the id of the box's contents).
   * (note: we are assuming that DataIDs and TileIDs will not clash)
   */
  boxID: BoxID;
  /** The name of the index this box belongs to (e.g. 'data', 'tiles', 'segments') */
  kind: string;
  /**
   * The associated object (data, tile, segment, buffer, …).
   * Its meaning is known only to the calling code, not to the SpatialSystem.
   */
  contents: unknown;
}

/**
 * An item to insert into a generic named index.
 * The caller supplies the id, a world-coordinate extent, and the contents to store.
 * (Used by `replaceItems` - the SpatialSystem has no knowledge of what `contents` means.)
 */
export interface SpatialItem {
  /** Unique identifier for this item within its index */
  id: BoxID;
  /** Bounding extent, in world coordinates */
  extent: Extent;
  /** The object to store (meaning known only to the calling code) */
  contents: unknown;
}

/**
 * A named spatial index within a cache: a box map paired with an RBush over the same boxes.
 * A cache may hold any number of these (e.g. 'data', 'tiles', and later 'segments', 'buffers').
 */
interface SpatialIndex {
  /** The identifier for this index (e.g. 'data', 'tiles') */
  id: string;
  /** Map of boxID to Box */
  boxes: Map<BoxID, SpatialBox>;
  /** RBush index over the boxes */
  rbush: RBush<SpatialBox>;
}

/**
 * Internal cache structure for spatial data.
 * Holds an open-ended set of named indexes; the SpatialSystem has no knowledge
 * of what any particular index contains - that meaning belongs to the calling code.
 */
interface SpatialCache {
  /** The identifier for this spatial cache */
  id: SpatialID;
  /** Map of indexID to named SpatialIndex (e.g. 'data', 'tiles') */
  indexes: Map<string, SpatialIndex>;
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
   * Get a spatial cache identified by the given spatialID.
   * Create it if it doesn't exist yet.
   * @param spatialID - the spatial cache to get (or create)
   * @return spacial cache data
   */
  public getCache(spatialID: SpatialID): SpatialCache {
    let cache = this._caches.get(spatialID);
    if (!cache) {
      cache = {
        id:       spatialID,
        indexes:  new Map<string, SpatialIndex>()
      };
      this._caches.set(spatialID, cache);
    }
    return cache;
  }


  /**
   * Get a named index within a spatial cache.
   * Create both the cache and the index if they don't exist yet.
   * @param spatialID - the spatial cache to get (or create)
   * @param indexID - the named index to get (or create), e.g. 'data', 'tiles'
   * @return the named SpatialIndex
   */
  public getIndex(spatialID: SpatialID, indexID: string): SpatialIndex {
    const cache = this.getCache(spatialID);
    let index = cache.indexes.get(indexID);
    if (!index) {
      index = {
        id:     indexID,
        boxes:  new Map<BoxID, SpatialBox>(),
        rbush:  new RBush<SpatialBox>()
      };
      cache.indexes.set(indexID, index);
    }
    return index;
  }


  /**
   * Clear (remove all items from) the given spatial cache.
   * Keeps the cache and its indexes, but empties them.
   * @param spatialID - the spatial cache to clear
   */
  public clearCache(spatialID: SpatialID): void {
    const cache = this.getCache(spatialID);
    for (const index of cache.indexes.values()) {
      index.boxes.clear();
      index.rbush.clear();
    }
  }


  /**
   * Internal helper - bulk insert the given boxes into the given index's RBush.
   * (callers are responsible for updating `index.boxes` and removing any existing boxes first)
   * @param index - the index to insert into
   * @param boxes - the boxes to insert
   */
  protected _insertBoxes(index: SpatialIndex, boxes: SpatialBox[]): void {
    if (boxes.length > 1) {
      index.rbush.load(boxes);
    } else if (boxes.length === 1) {
      index.rbush.insert(boxes[0]);
    }
  }


  /**
   * Internal helper - remove a single box from both the index's box map and RBush.
   * @param index - the index to remove from
   * @param boxID - the boxID to remove
   */
  protected _removeBox(index: SpatialIndex, boxID: BoxID): void {
    const existing = index.boxes.get(boxID);
    if (existing) {
      index.boxes.delete(boxID);
      index.rbush.remove(existing);
    }
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
   * Insert or update items in an arbitrary named index.
   * This is the generic, domain-agnostic way to index things (e.g. way segments, buffers)
   *  that aren't `AbstractData` or `Tile`.  The caller supplies the world-coordinate extent.
   * @param spatialID - the spatial cache to insert into
   * @param indexID - the named index to insert into (e.g. 'segments')
   * @param items - items to insert or replace
   */
  public replaceItems(spatialID: SpatialID, indexID: string, items: OneOrMore<SpatialItem>): void {
    const index = this.getIndex(spatialID, indexID);

    const toInsert: SpatialBox[] = [];
    for (const item of utilIterable(items)) {
      if (!item) continue;

      // remove existing..
      this._removeBox(index, item.id);

      // insert new..
      const box = item.extent.bbox() as SpatialBox;
      box.boxID = item.id;
      box.kind = indexID;
      box.contents = item.contents;

      index.boxes.set(item.id, box);
      toInsert.push(box);
    }

    this._insertBoxes(index, toInsert);
  }


  /**
   * Remove items from an arbitrary named index.
   * @param spatialID - the spatial cache to remove from
   * @param indexID - the named index to remove from (e.g. 'segments')
   * @param ids - the item ids to remove
   */
  public removeItems(spatialID: SpatialID, indexID: string, ids: OneOrMore<BoxID>): void {
    const index = this.getIndex(spatialID, indexID);

    for (const id of utilIterable(ids)) {
      if (!id) continue;
      this._removeBox(index, id);
    }
  }


  /**
   * Search for items in an arbitrary named index within the given search box.
   * @param spatialID - the spatial cache to search
   * @param indexID - the named index to search (e.g. 'segments')
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   */
  public getItemsAtBox(spatialID: SpatialID, indexID: string, box: BBox): SpatialBox[] {
    const index = this.getIndex(spatialID, indexID);
    return index.rbush.search(box);
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
    const index = this.getIndex(spatialID, DATA);

    const toInsert: SpatialBox[] = [];
    for (const data of utilIterable(items)) {
      if (!data) continue;
      const dataID = data.id;

      // remove existing..
      this._removeBox(index, dataID);

      // insert new..
      const extent = data.geoms?.world?.extent;
      if (!extent) continue;

      const box = extent.bbox() as SpatialBox;
      box.boxID = dataID;
      box.kind = DATA;
      box.contents = data;

      index.boxes.set(dataID, box);
      toInsert.push(box);
    }

    this._insertBoxes(index, toInsert);
  }


  /**
   * Remove data from the spatial cache.
   * Can pass either data or dataIDs for removal.
   * @param spatialID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   */
  public removeData(spatialID: SpatialID, itemsOrIDs: OneOrMore<AbstractData | DataID>): void {
    const index = this.getIndex(spatialID, DATA);

    for (const item of utilIterable(itemsOrIDs)) {
      const dataID = (typeof item === 'string') ? item : item?.id;
      if (!dataID) continue;

      this._removeBox(index, dataID);
    }
  }


  /**
   * Insert tiles into the spatial cache. This is how we mark data as loaded.
   * @param spatialID - the spatial cache to insert into
   * @param items - tiles to insert
   */
  public addTiles(spatialID: SpatialID, items: OneOrMore<Tile>): void {
    const index = this.getIndex(spatialID, TILES);

    const toInsert: SpatialBox[] = [];
    for (const tile of utilIterable(items)) {
      if (!tile) continue;
      const tileID = tile.id;

      // skip if tile is already indexed
      if (index.boxes.has(tileID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = tile.worldExtent;  // already in world (z16) coordinates
      if (!extent) continue;

      const box = extent.bbox() as SpatialBox;
      box.boxID = tileID;
      box.kind = TILES;
      box.contents = tile;

      index.boxes.set(tileID, box);
      toInsert.push(box);
    }

    this._insertBoxes(index, toInsert);
  }


  /**
   * Remove tiles from the spatial cache.
   * Can pass either tiles or tileIDs for removal.
   * @param spatialID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   */
  public removeTiles(spatialID: SpatialID, itemsOrIDs: OneOrMore<Tile | TileID>): void {
    const index = this.getIndex(spatialID, TILES);

    for (const item of utilIterable(itemsOrIDs)) {
      const tileID = (typeof item === 'string') ? item : item?.id;
      if (!tileID) continue;

      this._removeBox(index, tileID);
    }
  }


  /**
   * Get already loaded and cached data that appears in the current map view
   * @param spatialID - the spatial cache to search
   * @return Array of boxes in the current map view
   */
  public getVisibleData(spatialID: SpatialID): SpatialBox[] {
    const index = this.getIndex(spatialID, DATA);
    const viewport = this.context.viewport;
    return index.rbush.search(viewport.visibleWorldExtent().bbox());
  }

  /**
   * Get all visible data for all spatial caches.
   * This would only really be used for debugging purposes, it might return a lot.
   * @return Array of boxes in the current map view
   */
  public getAllVisibleData(): SpatialBox[] {
    const results: SpatialBox[] = [];
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
    const index = this.getIndex(spatialID, DATA);
    return index.boxes.get(dataID)?.contents as T | undefined;
  }

  /**
   * Return all data in the given spatial cache, regardless of visibility.
   * @param spatialID - the spatial cache to search
   * @return Array of all data contents in the cache
   */
  public getAllData<T extends AbstractData = AbstractData>(spatialID: SpatialID): T[] {
    const index = this.getIndex(spatialID, DATA);
    const results: T[] = [];
    for (const box of index.boxes.values()) {
      results.push(box.contents as T);
    }
    return results;
  }

  /**
   * Is the given dataID one we know about?
   * @param spatialID - the spatial cache to search
   * @param dataID - the dataID to lookup
   * @return `true` if data exists, `false` if not
   */
  public hasData(spatialID: SpatialID, dataID: DataID): boolean {
    const index = this.getIndex(spatialID, DATA);
    return index.boxes.has(dataID);
  }

  /**
   * Search for data within the given spatial cache and search box.
   * @param spatialID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   */
  public getDataAtBox(spatialID: SpatialID, box: BBox): SpatialBox[] {
    const index = this.getIndex(spatialID, DATA);
    return index.rbush.search(box);
  }

  /**
   * Does data exist in the given search box?
   * @param spatialID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   */
  public hasDataAtBox(spatialID: SpatialID, box: BBox): boolean {
    const index = this.getIndex(spatialID, DATA);
    return index.rbush.collides(box);
  }

  /**
   * Search for data at the given [lon,lat] coordinate.
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   */
  public getDataAtLoc(spatialID: SpatialID, loc: Vec2): SpatialBox[] {
    const index = this.getIndex(spatialID, DATA);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return index.rbush.search(test);
  }

  /**
   * Does data exist at the given [lon,lat] coordinate?
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if data exists there, `false` if not
   */
  public hasDataAtLoc(spatialID: SpatialID, loc: Vec2): boolean {
    const index = this.getIndex(spatialID, DATA);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return index.rbush.collides(test);
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
    const index = this.getIndex(spatialID, DATA);
    const [x, startY] = projWgs84ToWorld(loc);
    let y = startY;
    const epsilon = 1e-7 * WORLD_SCALE;

    while (true) {
      const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
      const didCollide = index.rbush.collides(test);
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
    const index = this.getIndex(spatialID, TILES);
    return index.boxes.get(tileID)?.contents as Tile | undefined;
  }

  /**
   * Is the given tileID one we know about?
   * @param spatialID - the spatial cache to search
   * @param tileID - the tileID to lookup
   * @return `true` if the tile is loaded, `false` if not
   */
  public hasTile(spatialID: SpatialID, tileID: TileID): boolean {
    const index = this.getIndex(spatialID, TILES);
    return index.boxes.has(tileID);
  }

  /**
   * Does a tile exist in the given search box?
   * @param spatialID - the spatial cache to search
    * @param box - the search box (world coordinates, z16)
   * @return `true` if something exists, `false` if not
   */
  public hasTileAtBox(spatialID: SpatialID, box: BBox): boolean {
    const index = this.getIndex(spatialID, TILES);
    return index.rbush.collides(box);
  }

  /**
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param spatialID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if a tile has been loaded there, `false` if not
   */
  public hasTileAtLoc(spatialID: SpatialID, loc: Vec2): boolean {
    const index = this.getIndex(spatialID, TILES);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return index.rbush.collides(test);
  }

}
