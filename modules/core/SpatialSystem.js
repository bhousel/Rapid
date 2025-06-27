import RBush from 'rbush';

import { AbstractSystem } from './AbstractSystem.js';


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

    this._indexes = new Map();    // Map<indexID, RBush>
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return {Promise} Promise resolved when this component has completed initialization
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
   * @return {Promise} Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return {Promise} Promise resolved when this component has completed resetting
   */
  resetAsync() {
    for (const rbush of this._indexes.values()) {
      rbush.clear();
    }
    return Promise.resolve();
  }


  //
  getIndex(indexID) {
    let rbush = this._indexes.get(indexID);
    if (!rbush) {
      rbush = new RBush();
      this._indexes.set(indexID, rbush);
    }
    return rbush;
  }

  /**
   * insert
   * Insert a single box into the given index
   * @param  {string}  indexID - the index to insert into
   * @param  {Box}     box     - data to insert
   */
  insert(indexID, box) {
    return this.getIndex(indexID).insert(box);
  }

  /**
   * load
   * Bulk load multiple boxes into the given index
   * @param  {string}      indexID - the index to insert into
   * @param  {Array<Box>}  boxes   - data to insert
   */
  load(indexID, boxes) {
    return this.getIndex(indexID).load(boxes);
  }

  /**
   * remove
   * Remove a single box from the index
   * @param  {string}  indexID - the index to remove from
   * @param  {Box}     box     - the box to remove
   */
  remove(indexID, box) {
    return this.getIndex(indexID).remove(box);
  }

  /**
   * clear
   * Clear (remove all items from) a single index
   * @param  {string}  indexID - the index to clear
   */
  clear(indexID) {
    return this.getIndex(indexID).clear();
  }

  /**
   * search
   * Search for items within the given index and search box
   * @param  {string}  indexID   - the index to search
   * @param  {Box}     box       - the search box
   * @return {Array<Box>}  Array of boxes found
   */
  search(indexID, box) {
    return this.getIndex(indexID).search(box);
  }

  /**
   * collides
   * Test if anything exists in the given index and search box
   * @param  {string}  indexID   - the index to search
   * @param  {Box}     box       - the search box
   * @return {boolean} `true` if something exists, `false` if not
   */
  collides(indexID, box) {
    return this.getIndex(indexID).collides(box);
  }

}
