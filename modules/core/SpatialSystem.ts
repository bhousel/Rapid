import { AbstractSystem } from './AbstractSystem.ts';
import { projWgs84ToWorld, projWorldToWgs84, WORLD_SCALE } from '@rapid-sdk/math';
import RBush from 'rbush';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { Extent, Tile, Vec2 } from '@rapid-sdk/math';


/**
 * A spatial index box with associated cache and data references.
 * Extends the RBush BBox with additional metadata.
 */
export interface SpatialBox extends BBox {
  /** Unique identifier for this item within its spatial index */
  boxID: BoxID;
  /** The object to store (meaning known only to the calling code) */
  contents: unknown;
}

/**
 * An item to insert into a generic named index.
 * The caller supplies the id, a world-coordinate extent, and the contents to store.
 * (Used by `replaceItems` - the SpatialSystem has no knowledge of what `contents` means.)
 */
export interface SpatialItem {
  /** Unique identifier for this item within its spatial index */
  id: BoxID;
  /** Bounding extent, in world coordinates */
  extent: Extent;
  /** The object to store (meaning known only to the calling code) */
  contents: unknown;
}

/**
 * A spatial index: a box map paired with an RBush over the same boxes.
 */
interface SpatialCache {
  /** The identifier of this spatial index */
  id: SpatialID;
  /** Boxes tracked by the spatial index */
  boxes: Map<BoxID, SpatialBox>;
  /** RBush index over the boxes */
  rbush: RBush<SpatialBox>;
}


/**
 * `SpatialSystem` maintains spatial caches.
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

  /** map of spatialID to spatial index */
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
   * @param   spatialID - spatialID
   * @return  the SpatialCache
   */
  public getCache(spatialID: SpatialID): SpatialCache {
    let cache = this._caches.get(spatialID);
    if (!cache) {
      cache = {
        id:    spatialID,
        boxes: new Map<BoxID, SpatialBox>(),
        rbush: new RBush<SpatialBox>()
      };
      this._caches.set(spatialID, cache);
    }
    return cache;
  }

  /**
   * Clear (remove all items from) the given spatial index.
   * @param spatialID - the spatialID of the cache to clear
   */
  public clearCache(spatialID: SpatialID): void {
    const cache = this._caches.get(spatialID);
    if (cache) {
      cache.boxes.clear();
      cache.rbush.clear();
    }
  }

  /**
   * Clear all spatial indexes whose spatialID matches a predicate.
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
   * Internal helper - bulk insert the given boxes into the given index's RBush.
   * (callers are responsible for updating `index.boxes` and removing any existing boxes first)
   * @param index - the index to insert into
   * @param boxes - the boxes to insert
   */
  protected _insertBoxes(index: SpatialCache, boxes: SpatialBox[]): void {
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
  protected _removeBox(index: SpatialCache, boxID: BoxID): void {
    const existing = index.boxes.get(boxID);
    if (existing) {
      index.boxes.delete(boxID);
      index.rbush.remove(existing);
    }
  }


  /**
   * Insert or update items in a spatial index.
   * This is the generic, domain-agnostic way to index things (e.g. way segments, buffers)
   * that aren't `AbstractData` or `Tile`. The caller supplies world-coordinate extents.
   * @param spatialID - spatialID to insert into
   * @param items - items to insert or replace
   */
  public replaceItems(spatialID: SpatialID, items: OneOrMore<SpatialItem>): void {
    const index = this.getCache(spatialID);

    const toInsert: SpatialBox[] = [];
    for (const item of utilIterable(items)) {
      if (!item) continue;

      // remove existing..
      this._removeBox(index, item.id);

      // insert new..
      const box = item.extent.bbox() as SpatialBox;
      box.boxID = item.id;
      box.contents = item.contents;

      index.boxes.set(item.id, box);
      toInsert.push(box);
    }

    this._insertBoxes(index, toInsert);
  }


  /**
   * Remove items from a spatial index.
   * @param spatialID - spatialID to remove from
   * @param ids - the item ids to remove
   */
  public removeItems(spatialID: SpatialID, ids: OneOrMore<BoxID>): void {
    const index = this.getCache(spatialID);

    for (const id of utilIterable(ids)) {
      if (!id) continue;
      this._removeBox(index, id);
    }
  }


  /**
   * Search for items in a spatial index within the given search box.
   * @param spatialID - spatialID to search
   * @param box - the search box (world coordinates)
   * @return Array of boxes in the given search box
   */
  public getItemsAtBox(spatialID: SpatialID, box: BBox): SpatialBox[] {
    const index = this.getCache(spatialID);
    return index.rbush.search(box);
  }


  /**
   * Phase 1 of a two-phase spatial query: a bbox prefilter over many search boxes.
   * Searches the index for each box and returns the union of hits, deduplicated by `boxID`.
   * @param spatialID - spatialID to search
   * @param boxes - one or more search boxes (world coordinates)
   * @return Array of unique boxes overlapping any of the search boxes
   */
  public getItemsAtBoxes(spatialID: SpatialID, boxes: OneOrMore<BBox>): SpatialBox[] {
    const index = this.getCache(spatialID);

    const seen = new Set<BoxID>();
    const results: SpatialBox[] = [];
    for (const box of utilIterable(boxes)) {
      if (!box) continue;
      for (const hit of index.rbush.search(box)) {
        if (seen.has(hit.boxID)) continue;
        seen.add(hit.boxID);
        results.push(hit);
      }
    }
    return results;
  }


  /**
   * Return the requested item.
   * @param spatialID - spatialID to search
   * @param boxID - item id to lookup
   * @return The item if found, or `undefined` if not found
   */
  public getItem<T = unknown>(spatialID: Nullable<SpatialID>, boxID: Nullable<BoxID>): T | undefined {
    if (!spatialID || !boxID) return undefined;
    const index = this.getCache(spatialID);
    return index.boxes.get(boxID)?.contents as T | undefined;
  }

  /**
   * Return all items in the given spatial index.
   * @param spatialID - spatialID to search
   * @return Array of all item contents in the index
   */
  public getAllItems<T = unknown>(spatialID: SpatialID): T[] {
    const index = this.getCache(spatialID);
    const results: T[] = [];
    for (const box of index.boxes.values()) {
      results.push(box.contents as T);
    }
    return results;
  }

  /**
   * Is the given item id one we know about?
   * @param spatialID - spatialID to search
   * @param boxID - item id to lookup
   * @return `true` if item exists, `false` if not
   */
  public hasItem(spatialID: SpatialID, boxID: BoxID): boolean {
    const index = this.getCache(spatialID);
    return index.boxes.has(boxID);
  }

  /**
   * Does an item exist in the given search box?
   * @param spatialID - spatialID to search
   * @param box - search box (world coordinates)
   * @return `true` if something exists, `false` if not
   */
  public hasItemsAtBox(spatialID: SpatialID, box: BBox): boolean {
    const index = this.getCache(spatialID);
    return index.rbush.collides(box);
  }

  /**
   * Search for items at the given [lon,lat] coordinate.
   * @param spatialID - spatialID to search
   * @param loc - search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   */
  public getItemsAtLoc(spatialID: SpatialID, loc: Vec2): SpatialBox[] {
    const index = this.getCache(spatialID);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return index.rbush.search(test);
  }

  /**
   * Does an item exist at the given [lon,lat] coordinate?
   * @param spatialID - spatialID to search
   * @param loc - search location (WGS84 [lon,lat])
   * @return `true` if an item exists there, `false` if not
   */
  public hasItemsAtLoc(spatialID: SpatialID, loc: Vec2): boolean {
    const index = this.getCache(spatialID);
    const [x, y] = projWgs84ToWorld(loc);
    const epsilon = 1e-7 * WORLD_SCALE;
    const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
    return index.rbush.collides(test);
  }

  /**
   * Move a location south until no item collides there.
   * Used for marker-like data when overlap should be avoided.
   * @param spatialID - spatialID to search
   * @param loc - search location (WGS84 [lon,lat])
   * @return Adjusted [lon,lat] coordinate
   */
  public preventCoincidentItemLoc(spatialID: SpatialID, loc: Vec2): Vec2 {
    const index = this.getCache(spatialID);
    const [x, startY] = projWgs84ToWorld(loc);
    let y = startY;
    const epsilon = 1e-7 * WORLD_SCALE;

    while (true) {
      const test = { minX: x - epsilon, minY: y - epsilon, maxX: x + epsilon, maxY: y + epsilon };
      const didCollide = index.rbush.collides(test);
      if (!didCollide) {
        return projWorldToWgs84([x, y]);
      } else {
        y += 0.00001 * WORLD_SCALE;
      }
    }
  }


  /**
   * Phase 2 of a two-phase spatial query: a precise refine.
   * Filters phase-1 candidates (from `getItemsAtBox` / `getItemsAtBoxes`) with a
   * caller-supplied predicate.  Because `RBush` only indexes bounding boxes, phase 1 may
   * return false positives; the predicate applies the exact test (distance, polygon
   * overlap, …) the caller cares about.
   *
   * `SpatialSystem` never learns what "match" means — the predicate owns that semantic,
   * keeping the spatial engine domain-agnostic.
   *
   * @param candidates - phase-1 candidate boxes to refine
   * @param predicate - returns `true` to keep a candidate, `false` to drop it
   * @return The candidates for which `predicate` returned `true`
   */
  public refineItems(candidates: SpatialBox[], predicate: (box: SpatialBox) => boolean): SpatialBox[] {
    const results: SpatialBox[] = [];
    for (const box of candidates) {
      if (predicate(box)) {
        results.push(box);
      }
    }
    return results;
  }


  /**
   * Insert data into the given spatial cache.
   * (addData and replaceData are the same)
   * @param legacyID - the spatial cache to insert into
   * @param items - items to add
   * @deprecated
   */
  public addData(legacyID: SpatialID, items: OneOrMore<AbstractData>): void {
    this.replaceData(legacyID, items);
  }


  /**
   * Insert or update data in the spatial cache.
   * @param legacyID - the spatial cache to insert into
   * @param items - items to replace
   * @deprecated
   */
  public replaceData(legacyID: SpatialID, items: OneOrMore<AbstractData>): void {
    const dataSpatialID = `${legacyID}-data`;

    const toInsert: SpatialItem[] = [];
    for (const data of utilIterable(items)) {
      if (!data) continue;
      const dataID = data.id;

      // remove existing.. (also handles entries that now lack an extent)
      this.removeItems(dataSpatialID, dataID);

      // insert new..
      const extent = data.geoms?.world?.extent;
      if (!extent) continue;

      toInsert.push({ id: dataID, extent, contents: data });
    }

    if (toInsert.length) {
      this.replaceItems(dataSpatialID, toInsert);
    }
  }


  /**
   * Remove data from the spatial cache.
   * Can pass either data or dataIDs for removal.
   * @param legacyID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   * @deprecated
   */
  public removeData(legacyID: SpatialID, itemsOrIDs: OneOrMore<AbstractData | DataID>): void {
    const dataSpatialID = `${legacyID}-data`;
    const toRemove: BoxID[] = [];

    for (const item of utilIterable(itemsOrIDs)) {
      const dataID = (typeof item === 'string') ? item : item?.id;
      if (!dataID) continue;
      toRemove.push(dataID);
    }

    if (toRemove.length) {
      this.removeItems(dataSpatialID, toRemove);
    }
  }


  /**
   * Insert tiles into the spatial cache. This is how we mark data as loaded.
   * @param legacyID - the spatial cache to insert into
   * @param items - tiles to insert
   * @deprecated
   */
  public addTiles(legacyID: SpatialID, items: OneOrMore<Tile>): void {
    const tileSpatialID = `${legacyID}-tiles`;

    const toInsert: SpatialItem[] = [];
    for (const tile of utilIterable(items)) {
      if (!tile) continue;
      const tileID = tile.id;

      // skip if tile is already indexed
      if (this.hasItem(tileSpatialID, tileID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = tile.worldExtent;  // already in world (z16) coordinates
      if (!extent) continue;

      toInsert.push({ id: tileID, extent, contents: tile });
    }

    if (toInsert.length) {
      this.replaceItems(tileSpatialID, toInsert);
    }
  }


  /**
   * Remove tiles from the spatial cache.
   * Can pass either tiles or tileIDs for removal.
   * @param legacyID - the spatial cache to remove from
   * @param itemsOrIDs - items to remove
   * @deprecated
   */
  public removeTiles(legacyID: SpatialID, itemsOrIDs: OneOrMore<Tile | TileID>): void {
    const tileSpatialID = `${legacyID}-tiles`;
    const toRemove: BoxID[] = [];

    for (const item of utilIterable(itemsOrIDs)) {
      const tileID = (typeof item === 'string') ? item : item?.id;
      if (!tileID) continue;
      toRemove.push(tileID);
    }

    if (toRemove.length) {
      this.removeItems(tileSpatialID, toRemove);
    }
  }


  /**
   * Get already loaded and cached data that appears in the current map view
   * @param legacyID - the spatial cache to search
   * @return Array of boxes in the current map view
   * @deprecated
   */
  public getVisibleData(legacyID: SpatialID): SpatialBox[] {
    const index = this.getCache(`${legacyID}-data`);
    const viewport = this.context.viewport;
    return index.rbush.search(viewport.visibleWorldExtent().bbox());
  }

  /**
   * Return the requested data.
   * @param legacyID - the spatial cache to search
   * @param dataID - the dataID to lookup
   * @return The data if found, or `undefined` if not found
   * @deprecated
   */
  public getData<T extends AbstractData = AbstractData>(legacyID: Nullable<SpatialID>, dataID: Nullable<DataID>): T | undefined {
    return this.getItem<T>(legacyID ? `${legacyID}-data` as SpatialID : null, dataID);
  }

  /**
   * Return all data in the given spatial cache, regardless of visibility.
   * @param legacyID - the spatial cache to search
   * @return Array of all data contents in the cache
   * @deprecated
   */
  public getAllData<T extends AbstractData = AbstractData>(legacyID: SpatialID): T[] {
    return this.getAllItems<T>(`${legacyID}-data` as SpatialID);
  }

  /**
   * Is the given dataID one we know about?
   * @param legacyID - the spatial cache to search
   * @param dataID - the dataID to lookup
   * @return `true` if data exists, `false` if not
   * @deprecated
   */
  public hasData(legacyID: SpatialID, dataID: DataID): boolean {
    return this.hasItem(`${legacyID}-data` as SpatialID, dataID);
  }

  /**
   * Search for data within the given spatial cache and search box.
   * @param legacyID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return Array of boxes in the given search box
   * @deprecated
   */
  public getDataAtBox(legacyID: SpatialID, box: BBox): SpatialBox[] {
    const index = this.getCache(`${legacyID}-data`);
    return index.rbush.search(box);
  }

  /**
   * Does data exist in the given search box?
   * @param legacyID - the spatial cache to search
   * @param box - the search box (make sure to use world coordinates here)
   * @return `true` if something exists, `false` if not
   * @deprecated
   */
  public hasDataAtBox(legacyID: SpatialID, box: BBox): boolean {
    return this.hasItemsAtBox(`${legacyID}-data` as SpatialID, box);
  }

  /**
   * Search for data at the given [lon,lat] coordinate.
   * @param legacyID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Array of boxes at the given location
   * @deprecated
   */
  public getDataAtLoc(legacyID: SpatialID, loc: Vec2): SpatialBox[] {
    return this.getItemsAtLoc(`${legacyID}-data` as SpatialID, loc);
  }

  /**
   * Does data exist at the given [lon,lat] coordinate?
   * @param legacyID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if data exists there, `false` if not
   * @deprecated
   */
  public hasDataAtLoc(legacyID: SpatialID, loc: Vec2): boolean {
    return this.hasItemsAtLoc(`${legacyID}-data` as SpatialID, loc);
  }

  /**
   * This checks if the spatial cache already has something at that location, and if so,
   *  moves the location down slightly to a location that doesn't conflict.
   * Used for Markers in situations where you don't want them covering each other.
   * @param legacyID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return Adjusted [lon,lat] coordinate
   * @deprecated
   */
  public preventCoincidentLoc(legacyID: SpatialID, loc: Vec2): Vec2 {
    return this.preventCoincidentItemLoc(`${legacyID}-data` as SpatialID, loc);
  }


  /**
   * Return the requested tile.
   * @param legacyID - the spatial cache to search
   * @param tileID - the tileID to lookup
   * @return The tile if found, or `undefined` if not found
   * @deprecated
   */
  public getTile(legacyID: SpatialID, tileID: TileID): Tile | undefined {
    return this.getItem<Tile>(`${legacyID}-tiles` as SpatialID, tileID);
  }

  /**
   * Is the given tileID one we know about?
   * @param legacyID - the spatial cache to search
   * @param tileID - the tileID to lookup
   * @return `true` if the tile is loaded, `false` if not
   * @deprecated
   */
  public hasTile(legacyID: SpatialID, tileID: TileID): boolean {
    return this.hasItem(`${legacyID}-tiles` as SpatialID, tileID);
  }

  /**
   * Does a tile exist in the given search box?
   * @param legacyID - the spatial cache to search
   * @param box - the search box (world coordinates, z16)
   * @return `true` if something exists, `false` if not
   * @deprecated
   */
  public hasTileAtBox(legacyID: SpatialID, box: BBox): boolean {
    return this.hasItemsAtBox(`${legacyID}-tiles` as SpatialID, box);
  }

  /**
   * Is a tile loaded at the given [lon,lat] coordinate?
   * @param legacyID - the spatial cache to search
   * @param loc - the search location (WGS84 [lon,lat])
   * @return `true` if a tile has been loaded there, `false` if not
   * @deprecated
   */
  public hasTileAtLoc(legacyID: SpatialID, loc: Vec2): boolean {
    return this.hasItemsAtLoc(`${legacyID}-tiles` as SpatialID, loc);
  }

}
