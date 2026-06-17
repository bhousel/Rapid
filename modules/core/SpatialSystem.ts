import { AbstractSystem } from './AbstractSystem.ts';
import { projWgs84ToWorld, projWorldToWgs84, vecAdd, vecEqual, vecScale, WORLD_SCALE } from '@rapid-sdk/math';
import RBush from 'rbush';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


/**
 * An item tracked by the spatial cache.
 * Extends the RBush BBox with additional metadata.
 * Items must have:
 * - an identifier unique within the spatial cache,
 * - contents which can be anything
 * - rbush extent properties (minX, minY, maxX, maxY)
 */
export interface SpatialItem extends BBox {
  /** Unique identifier for this item within its spatial index */
  id: BoxID;
  /** The object to store (meaning known only to the calling code) */
  contents: unknown;
}

/**
 * A spatial cache: a unique identifier, an RBush index, and a collection of tracked items.
 */
interface SpatialCache {
  /** The identifier of this spatial cache */
  id: SpatialID;
  /** Items tracked by the spatial index */
  items: Map<BoxID, SpatialItem>;
  /** RBush index over the boxes */
  rbush: RBush<SpatialItem>;
}


/**
 * `SpatialSystem` maintains spatial caches used by other parts of the Rapid codebase.
 * Each spatial cache contains a unique identifier, an RBush index, and a collection of tracked items.
 *
 * The `SpatialSystem` is data-agnostic: it has no specialized knowledge about the items that it stores.
 *  - data, derived from the `AbstractData` class.
 *  - tiles, to indicate where data has been loaded.
 *  - anything!
 *
 * Because RBush works with axis-aligned bounding boxes, data indexed by the `SpatialSystem` should
 * be represented in a planar coordinate system (such as "world" or "screen" coordinates).
 *
 * Each spatial cache must be identified by a unique `spatialID` string.
 * For example: 'osm-data', 'osm-data-tiles', etc.
 *
 * Note that because the spatial system has no specialized knowledge about its contents, we don't
 * clear the caches on reset - calling code is responsible for managing any objects that it has stored!
 *
 * This code is a wrapper around the RBush library
 * @see https://github.com/mourner/rbush
 *
 * This system replaces older code from:
 * - `Tree.js` which only indexed the OSM data
 * - Various rbushes scattered around the service code
 */
export class SpatialSystem extends AbstractSystem {

  /** Spatial caches that the SpatialSystem is managing */
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
   * Called after completing an edit session to reset any internal state.
   * Note that because the spatial system has no specialized knowledge about its contents, we don't
   * clear the caches on reset - calling code is responsible for whatever objects it has stored!
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
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
        items: new Map<BoxID, SpatialItem>(),
        rbush: new RBush<SpatialItem>()
      };
      this._caches.set(spatialID, cache);
    }
    return cache;
  }


  /**
   * Clear (remove all items from) the given spatial cache.
   * @param spatialID - the spatialID of the cache to clear
   */
  public clearCache(spatialID: SpatialID): void {
    const cache = this._caches.get(spatialID);
    if (cache) {
      cache.items.clear();
      cache.rbush.clear();
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
   * Internal helper - remove a single box from the given spatial cache
   * @param cache - the spatial cache to remove from
   * @param boxID - the boxID to remove
   */
  protected _removeItem(cache: SpatialCache, boxID: BoxID): void {
    const existing = cache.items.get(boxID);
    if (existing) {
      cache.items.delete(boxID);
      cache.rbush.remove(existing);
    }
  }


  /**
   * Add or replace items in the given spatial cache.
   * @param spatialID - spatialID of the cache to insert into
   * @param items - items to insert or replace
   */
  public replaceItems(spatialID: SpatialID, items: OneOrMore<SpatialItem>): void {
    const cache = this.getCache(spatialID);

    const toInsert: SpatialItem[] = [];
    for (const item of utilIterable(items)) {
      if (!item) continue;
      this._removeItem(cache, item.id);
      cache.items.set(item.id, item);
      toInsert.push(item);
    }

    if (toInsert.length > 1) {
      cache.rbush.load(toInsert);
    } else if (toInsert.length === 1) {
      cache.rbush.insert(toInsert[0]);
    }
  }


  /**
   * Add or replace data in the given spatial cache.
   * This is a convenience method to call `replaceItems()`, but with `OneOrMore<AbstractData>`.
   * We use the AbstractData's computed world.extent to get the box properties.
   * @param spatialID - spatialID of the cache to add items.
   * @param items - items to insert or replace
   */
  public replaceData(spatialID: SpatialID, data: OneOrMore<AbstractData>): void {
    const items: SpatialItem[] = [];
    for (const d of utilIterable(data)) {
      if (!d) continue;

      const extent = d.geoms.world?.extent;
      if (!extent) continue;

      const item = Object.assign({ id: d.id, contents: d }, extent.bbox()) as SpatialItem;
      items.push(item);
    }

    this.replaceItems(spatialID, items);
  }


  /**
   * Add or replace tiles in the given spatial cache.
   * This is a convenience method to call `replaceItems()`, but with `OneOrMore<Tile>`.
   * We use the Tile's computed `worldExtent` to get the box properties.
   * @param spatialID - spatialID of the cache to add items.
   * @param items - items to insert or replace
   */
  public replaceTiles(spatialID: SpatialID, tiles: OneOrMore<Tile>): void {
    const items: SpatialItem[] = [];
    for (const tile of utilIterable(tiles)) {
      if (!tile) continue;

      const item = Object.assign({ id: tile.id, contents: tile }, tile.worldExtent.bbox()) as SpatialItem;
      items.push(item);
    }

    this.replaceItems(spatialID, items);
  }

  // aliases:
  public addItems = this.replaceItems;
  public addData = this.replaceData;
  public addTiles = this.replaceTiles;

  /**
   * Remove items from the given spatial cache.
   * @param spatialID - spatialID of the cache to insert into
   * @param ids - the item ids to remove
   */
  public removeItems(spatialID: SpatialID, ids: OneOrMore<BoxID>): void {
    const cache = this.getCache(spatialID);

    for (const id of utilIterable(ids)) {
      if (!id) continue;
      this._removeItem(cache, id);
    }
  }


  /**
   * Return the requested item from the given spatial cache.
   * @param spatialID - spatialID of the cache to search
   * @param boxID - item id to lookup
   * @return The item if found, or `undefined` if not found
   */
  public getItem<T = unknown>(spatialID: Nullable<SpatialID>, boxID: Nullable<BoxID>): T | undefined {
    if (!spatialID || !boxID) return undefined;
    const cache = this.getCache(spatialID);
    return cache.items.get(boxID)?.contents as T | undefined;
  }


  /**
   * Is the given item id stored in the given spatial cache?
   * @param spatialID - spatialID of the cache to search
   * @param boxID - the item id to lookup
   * @return `true` if item exists, `false` if not
   */
  public hasItem(spatialID: SpatialID, boxID: BoxID): boolean {
    const cache = this.getCache(spatialID);
    return cache.items.has(boxID);
  }


  /**
   * Return all items in the given spatial cache.
   * @param spatialID - spatialID of the cache to search
   * @return Array of all items tracked by the spatial cache.
   */
  public getAllItems<T = unknown>(spatialID: SpatialID): T[] {
    const index = this.getCache(spatialID);
    const results: T[] = [];
    for (const box of index.items.values()) {
      results.push(box.contents as T);
    }
    return results;
  }


  /**
   * Search for items in a spatial index within the given search box.
   * @param  spatialID - spatialID of the cache to search
   * @param  box - the search box
   * @return Array of boxes found the given search box
   */
  public getItemsAtBox(spatialID: SpatialID, box: BBox): SpatialItem[] {
    const cache = this.getCache(spatialID);
    return cache.rbush.search(box);
  }


  /**
   * Does an item exist in the given search box?
   * @param spatialID - spatialID of the cache to search
   * @param box - search box (world coordinates)
   * @return `true` if something exists, `false` if not
   */
  public hasItemsAtBox(spatialID: SpatialID, box: BBox): boolean {
    const index = this.getCache(spatialID);
    return index.rbush.collides(box);
  }


  /**
   * Searches the index across one or more search boxes,
   * then returns all search results, deduplicated by `boxID`.
   * @param  spatialID - spatialID of the cache to search
   * @param  boxes - one or more search boxes (world coordinates)
   * @return Array of unique boxes overlapping any of the search boxes
   */
  public getItemsAtBoxes(spatialID: SpatialID, boxes: OneOrMore<BBox>): SpatialItem[] {
    const cache = this.getCache(spatialID);

    const seen = new Set<BoxID>();
    const results: SpatialItem[] = [];
    for (const box of utilIterable(boxes)) {
      if (!box) continue;
      for (const hit of cache.rbush.search(box)) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        results.push(hit);
      }
    }
    return results;
  }


  /**
   * Search for items at the given [x,y] coordinate.
   * Coord must be supplied in the coordinate system used by the items that were inserted.
   * @param  spatialID - spatialID of the cache to search
   * @param  coord - search coordinate
   * @param  epsilon - optional epsilon for fuzzy search
   * @return Array of boxes at the given location
   */
  public getItemsAtCoord(spatialID: SpatialID, coord: Vec2, epsilon: number = 1e-7): SpatialItem[] {
    const index = this.getCache(spatialID);
    const test = {
      minX: coord[0] - epsilon,
      minY: coord[1] - epsilon,
      maxX: coord[0] + epsilon,
      maxY: coord[1] + epsilon
    };
    return index.rbush.search(test);
  }


  /**
   * Does an item exist at the given [x,y] coordinate?
   * Coord must be supplied in the coordinate system used by the items that were inserted.
   * @param  spatialID - spatialID of the cache to search
   * @param  coord - search coordinate
   * @param  epsilon - optional epsilon for fuzzy search
   * @return Array of boxes at the given location
   */
  public hasItemsAtCoord(spatialID: SpatialID, coord: Vec2, epsilon: number = 1e-7): boolean {
    const index = this.getCache(spatialID);
    const test = {
      minX: coord[0] - epsilon,
      minY: coord[1] - epsilon,
      maxX: coord[0] + epsilon,
      maxY: coord[1] + epsilon
    };
    return index.rbush.collides(test);
  }


  /**
   * Does an item exist at the given [lon,lat] location?
   * This is the WGS84 convenience for `hasItemsAtCoord`, projecting the location to
   * world coordinates (and scaling the epsilon to match) before searching.
   * Note that this assumes that the items in the given spatialID cache are stored in world coordinates.
   * @param  spatialID - spatialID of the cache to search
   * @param  loc - search location (WGS84 lon/lat)
   * @param  epsilon - optional epsilon (in WGS84 degrees) for fuzzy search
   * @return `true` if an item exists there, `false` if not
   */
  public hasItemAtLoc(spatialID: SpatialID, loc: Vec2, epsilon: number = 1e-7): boolean {
    const coord = projWgs84ToWorld(loc);
    const scaledEpsilon = epsilon * WORLD_SCALE;
    return this.hasItemsAtCoord(spatialID, coord, scaledEpsilon);
  }


  /**
   * Returns all items in the current viewport.
   * Note that this assumes that the items in the given spatialID cache are stored in world coordinates.
   * @param  spatialID - spatialID of the cache to search
   * @return Array of boxes at the given location
   */
  public getVisibleItems(spatialID: SpatialID): SpatialItem[] {
    const context = this.context;
    const box = context.viewport.visibleWorldExtent().bbox();
    return this.getItemsAtBox(spatialID, box);
  }


  /**
   * Get a nearby coordinate that doesn't collide with anything already stored in the cache.
   * For example, this may be used to stack markers so that they don't overlap.
   * @param  spatialID - spatialID of the cache to search
   * @param  coord - desired coordinate
   * @param  delta - delta to move until we find a collision-free coordinate
   * @param  epsilon - optional epsilon for fuzzy search
   * @return Adjusted [x,y] coordinate
   */
  public getFreeCoord(spatialID: SpatialID, coord: Vec2, delta: Vec2 = [0, -1e-6], epsilon: number = 1e-7): Vec2 {
    // Avoid infinite looping - delta needs to move somewhere, default to small -y
    if (vecEqual(delta, [0, 0])) {
      delta[1] = -1e-6;
    }

    let [x, y] = coord;
    while (true) {
      const didCollide = this.hasItemsAtCoord(spatialID, [x, y], epsilon);
      if (!didCollide) {
        return [x, y];
      } else {
        [x, y] = vecAdd([x, y], delta);
      }
    }
  }


  /**
   * This is the WGS84 convenience for `getFreeCoord`, projecting the location to
   * world coordinates (and scaling the epsilon to match) before searching.
   * Note that this assumes that the items in the given spatialID cache are stored in world coordinates.
   * @param  spatialID - spatialID of the cache to search
   * @param  loc - desired lon/lat
   * @param  delta - delta to move until we find a collision-free coordinate
   * @param  epsilon - optional epsilon for fuzzy search
   * @return Adjusted [lon,lat] coordinate
   */
  public getFreeLoc(spatialID: SpatialID, loc: Vec2, delta: Vec2 = [0, -1e-6], epsilon: number = 1e-7): Vec2 {
    const coord = projWgs84ToWorld(loc);
    const scaledEpsilon = epsilon * WORLD_SCALE;
    const scaledDelta = vecScale(delta, WORLD_SCALE);
    const result = this.getFreeCoord(spatialID, coord, scaledDelta, scaledEpsilon);
    return projWorldToWgs84(result);
  }
}
