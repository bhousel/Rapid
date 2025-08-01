import RBush from 'rbush';

import { AbstractSystem } from './AbstractSystem.js';
import { utilIterable } from '../util/iterable.js';


/**
 * `SpatialSystem` maintains common spatial indexes of all data known to Rapid.
 *  It is used to compute which data is visible and to perform conflation across data layers.
 *  All data should be stored in "world coordinates", (projected to Mercator but unscaled).
 *
 *  Each index must be identified by a unique `indexID` string.
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

    this._indexes = new Map();  // Map<indexID, Object>
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
    for (const indexID of this._indexes.keys()) {
      this.clear(indexID);
    }
    return Promise.resolve();
  }

  /**
   * getData
   * Get already loaded and indexed data that appears in the current map view
   * @param   {string}      indexID  - the index to search
   * @return  {Array<Box>}  Array of results in the current map view
   */
  getData(indexID) {
    const { data } = this.getIndex(indexID);
    const extent = this.context.viewport.visibleWorldExtent();   // world extent!
    return data.search(extent.bbox());
  }


  /**
   * getAllData
   * Get all data for all indexes
   * @return  {Array<Box>}  Array of results in the current map view
   */
  getAllData() {
    const results = [];
    for (const indexID of this._indexes.keys()) {
      results.push(...this.getData(indexID));
    }
    return results;
  }


  /**
   * getIndex
   * Get a spatial index identified by the given ID.
   * Create it if it doesn't exist yet.
   * @param   {string}  indexID  - the index to get (or create)
   * @return  {Object}  index data
   */
  getIndex(indexID) {
    let index = this._indexes.get(indexID);
    if (!index) {
      index = {
        boxes:  new Map(),    // Map<dataID, Box>
        tiles:  new RBush(),
        data:   new RBush()
      };
      this._indexes.set(indexID, index);
    }
    return index;
  }


  /**
   * replace
   * Insert or update data in the index
   * @param  {string}                   indexID - the index to insert into
   * @param  {OneOrMore<AbstractData>}  items   - items to replace
   */
  replace(indexID, items) {
    const { boxes, data } = this.getIndex(indexID);

    const toInsert = [];
    for (const d of utilIterable(items)) {
      if (!d) continue;
      const dataID = d.id;

      // remove existing..
      const existing = boxes.get(dataID);
      if (existing) {
        data.remove(existing);
        boxes.delete(existing);
      }

      // insert new..
      const extent = d.geoms?.world?.extent;
      if (!extent) continue;
      const box = extent.bbox();
      box.indexID = indexID;
      box.dataID = dataID;
      box.data = d;
      boxes.set(dataID, box);
      toInsert.push(box);
    }

    if (toInsert.length > 1) {
      data.load(toInsert);
    } else if (toInsert.length === 1) {
      data.insert(toInsert[0]);
    }
  }


  /**
   * remove
   * Remove data from the index
   * @param  {string}             indexID  - the index to remove from
   * @param  {OneOrMore<string>}  itemIDs  - itemIDs to remove
   */
  remove(indexID, itemIDs) {
   const { boxes, data } = this.getIndex(indexID);

    for (const itemID of utilIterable(itemIDs)) {
      if (!itemID) continue;

      // remove existing
      const existing = boxes.get(itemID);
      if (existing) {
        data.remove(existing);
        boxes.delete(existing);
      }
    }
  }


  /**
   * insertTiles
   * Insert tiles into the index.  This is how we mark data as loaded.
   * @param  {string}           indexID  - the index to insert into
   * @param  {OneOrMore<Tile>}  items    - tiles to insert
   */
  insertTiles(indexID, items) {
    const { boxes, tiles } = this.getIndex(indexID);

    const toInsert = [];
    for (const d of utilIterable(items)) {
      if (!d) continue;
      const dataID = d.id;

      // skip if tile is already indexed
      if (boxes.has(dataID)) continue;

      // insert new.. (we are assuming dataIDs will never look like tileIDs.)
      const extent = d.tileExtent;  // these are in world coordinates now
      if (!extent) continue;
      const box = extent.bbox();
      box.indexID = indexID;
      box.dataID = dataID;
      box.data = d;
      boxes.set(dataID, box);
      toInsert.push(box);
    }

    if (toInsert.length > 1) {
      tiles.load(toInsert);
    } else if (toInsert.length === 1) {
      tiles.insert(toInsert[0]);
    }
  }


  /**
   * clear
   * Clear (remove all items from) a single index
   * @param  {string}  indexID - the index to clear
   */
  clear(indexID) {
    const { boxes, data, tiles } = this.getIndex(indexID);
    boxes.clear();
    data.clear();
    tiles.clear();
  }


  /**
   * search
   * Search for items within the given index and search box
   * @param   {string}  indexID   - the index to search
   * @param   {Box}     box       - the search box
   * @return  {Array<Box>}  Array of boxes found
   */
  search(indexID, box) {
    const { data } = this.getIndex(indexID);
    return data.search(box);
  }


  /**
   * collides
   * Test if anything exists in the given index and search box
   * @param   {string}   indexID   - the index to search
   * @param   {Box}      box       - the search box
   * @return  {boolean}  `true` if something exists, `false` if not
   */
  collides(indexID, box) {
    const { data } = this.getIndex(indexID);
    return data.collides(box);
  }
}


/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  @typedef  {string}  indexID
 *
 *  @typedef  {Object}        Box
 *  @property {number}        minX
 *  @property {number}        minY
 *  @property {number}        maxX
 *  @property {number}        maxY
 *  @property {string}        indexID
 *  @property {string}        dataID
 *  @property {AbstractData}  data
 */

