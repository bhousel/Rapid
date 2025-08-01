import { Extent } from '@rapid-sdk/math';
//import RBush from 'rbush';

import { Difference } from './Difference.js';


/**
 *  Tree
 *  A wrapper class around the `RBush` spatial index, for tracking the position of OSM Entities.
 *  Internally RBush indexes rectangular bounding boxes.
 *  The tree also must keep track of which Graph is considered "current", and will update the
 *  positions of all it's tracked Entities automatically to match the current Graph.
 *
 *  (Tree is not a good name for this thing)
 */
export class Tree {

  /**
   * @constructor
   * @param  {Graph}  graph - The "current" Graph of entities that this tree is tracking
   */
  constructor(graph, indexID) {
    this._currentKey = graph.key;
    this._currentSnapshot = graph.snapshot();
    this._indexID = indexID;

//    this._entityRBush = new RBush();
//    this._entityBoxes = new Map();     // Map<entityID, Box Object>
//    this._entitySegments = new Map();  // Map<entityID, Array[segments]>
//
//    this._segmentRBush = new RBush();
//    this._segmentBoxes = new Map();    // Map<segmentID, Box Object>
  }


  /**
   * _removeEntity
   * Remove an Entity from all internal indexes.
   * @param  {string}  entityID
   */
  _removeEntity(entityID) {
    const graph = this._currentSnapshot;
    const context = graph.context;
    const spatial = context.systems.spatial;

    spatial.remove(this._indexID, entityID);

//    const ebox = this._entityBoxes.get(entityID);
//    if (ebox) {
//      this._entityRBush.remove(ebox);
//      this._entityBoxes.delete(entityID);
//    }
//
//    const segments = this._entitySegments.get(entityID) ?? [];
//    for (const segment of segments) {
//      const segmentID = segment.id;
//      const sbox = this._segmentBoxes.get(segmentID);
//      if (sbox) {
//        this._segmentRBush.remove(sbox);
//        this._segmentBoxes.delete(segmentID);
//      }
//    }
//    this._entitySegments.delete(entityID);
  }


  /**
   * _loadEntities
   * Add or update multiple Entities in the internal indexes.
   * @param  {Map<entityID, Entity>}  toUpdate - Entities to load into the tree
   */
  _loadEntities(toUpdate) {
    const graph = this._currentSnapshot;
    const context = graph.context;
    const spatial = context.systems.spatial;

    spatial.replace(this._indexID, [...toUpdate.values()]);

//    let eboxes = [];
//    let sboxes = [];
//
//    for (const [entityID, entity] of toUpdate) {
//      // Gather a bounding box for the Entity..
//      const extent = entity.extent(graph);
//      if (!extent) continue;
//
//      const ebox = extent.bbox();
//      ebox.id = entityID;
//      this._entityBoxes.set(entityID, ebox);
//      eboxes.push(ebox);
//
//      // Gather bounding boxes for the Entity's segments (if it's a line)..
//      if (typeof entity.segments !== 'function') continue;
//
//      const segments = entity.segments(graph) ?? [];
//      this._entitySegments.set(entityID, segments);
//
//      for (const segment of segments) {
//        const segmentID = segment.id;
//        const segmentExtent = segment.extent(graph);
//        if (!segmentExtent) continue;
//
//        const sbox = segmentExtent.bbox();
//        sbox.id = segmentID;
//        sbox.segment = segment;
//        this._segmentBoxes.set(segmentID, sbox);
//        sboxes.push(sbox);
//      }
//    }
//
//    // bulk load
//    if (eboxes.length) this._entityRBush.load(eboxes);
//    if (sboxes.length) this._segmentRBush.load(sboxes);
  }


  /**
   * _includeParents
   * When updating an Entity's position in the tree, we must also update
   * the positions of that Entity's parent ways and relations.
   *
   * @param  {Entity}                 entity - Entity to check
   * @param  {Map<entityID, Entity>}  toUpdate - gathered Entities that need updating
   * @param  {Set<entityID>?}         seen - to avoid infinite recursion
   */
  _includeParents(entity, toUpdate, seen) {
    const graph = this._currentSnapshot;
    const entityID = entity.id;
    if (!seen) seen = new Set();

    if (seen.has(entityID)) return;
    seen.add(entityID);

    for (const way of graph.parentWays(entity)) {
//      if (this._entityBoxes.has(way.id)) {
//        this._removeEntity(way.id);
//      }
      toUpdate.set(way.id, way);
      this._includeParents(way, toUpdate, seen);
    }

    for (const relation of graph.parentRelations(entity)) {
//      if (this._entityBoxes.has(relation.id)) {
//        this._removeEntity(relation.id);
//      }
      toUpdate.set(relation.id, relation);
      this._includeParents(relation, toUpdate, seen);
    }
  }


  /**
   * _setCurrentGraph
   * This will change the "current" Graph of this tree, performing whatever
   * operations are needed to add/update/remove tracked entities.
   * @param  {Graph}  graph - the Graph to set "current"
   */
  _setCurrentGraph(graph) {
    if (graph.key === this._currentKey) return;

    // gather changes needed
    const diff = new Difference(this._currentSnapshot, graph);
    this._currentKey = graph.key;
    this._currentSnapshot = graph.snapshot();

    const changed = diff.didChange;
    if (!changed.addition && !changed.deletion && !changed.geometry) return;

    const toUpdate = new Map();

    if (changed.deletion) {
      for (const entity of diff.deleted()) {
        this._removeEntity(entity.id);
      }
    }

    if (changed.geometry) {
      for (const entity of diff.modified()) {
//        this._removeEntity(entity.id);
        toUpdate.set(entity.id, entity);
        this._includeParents(entity, toUpdate);
      }
    }

    if (changed.addition) {
      for (const entity of diff.created()) {
        toUpdate.set(entity.id, entity);
      }
    }

    this._loadEntities(toUpdate);
  }


  /**
   * rebase
   * This is used to load new Entities into the tree, but without adjusting which Graph is current.
   * It's called when fetching new data from the OSM API, restoring saved history, etc.
   * @param  {Array<Entity>}  entities - entities to load into the Tree
   * @param  {boolean?}       force - If `true`, replace an Entity, even if we've seen it already
   */
  rebase(entities, force) {
    const graph = this._currentSnapshot;
    const context = graph.context;
    const spatial = context.systems.spatial;
    const { boxes } = spatial.getIndex(this._indexID);

    const local = graph.local;
    const toUpdate = new Map();

    for (const entity of entities) {
      if (!entity.visible) continue;

      const entityID = entity.id;

      // Entity is deleted in current graph, leave it out of the tree..
      const isDeleted = local.entities.has(entityID) && (local.entities.get(entityID) === undefined);
      if (isDeleted) continue;

      // Entity is already in the tree, skip (unless force = true)
      if (boxes.has(entityID) && !force) continue;
//      if (this._entityBoxes.has(entityID) && !force) continue;

      // Add or Replace the Entity
//      this._removeEntity(entityID);
      toUpdate.set(entityID, entity);
      this._includeParents(entity, toUpdate);
    }

    this._loadEntities(toUpdate);
  }


  /**
   * intersects
   * Returns a result of Entities that intersect the given map extent.
   * We first update the current graph if needed, to make sure the results are fresh.
   * @param   {Extent}  extent - Extent to check   (WGS84 for now)
   * @param   {Graph}   graph - The current graph
   * @return  {Array<Entity>}  Entities with bounding boxes that intersect the given Extent
   */
  intersects(extent, graph) {
    this._setCurrentGraph(graph);

    const context = graph.context;
    const spatial = context.systems.spatial;
    const viewport = context.viewport;

// need world coords now
const min = viewport.wgs84ToWorld([extent.min[0], extent.max[1]]);  // top left
const max = viewport.wgs84ToWorld([extent.max[0], extent.min[1]]);  // bottom right
const world = new Extent(min, max);

    return spatial.search(this._indexID, world.bbox()).map(box => graph.entity(box.dataID));
//    return this._entityRBush.search(extent.bbox()).map(ebox => graph.entity(ebox.id));
  }

  /**
   * waySegments
   * Returns the result of Segments that intersect the given map extent.
   * We first update the current graph if needed, to make sure the results are fresh.
   * @param   {Extent}  extent - Extent to check
   * @param   {Graph}   graph - The current graph
   * @return  {Array<Object>}  Segments with bounding boxes that intersect the given Extent
   */
  waySegments(extent, graph) {
return [];  // not now
//    this._setCurrentGraph(graph);
//    return this._segmentRBush.search(extent.bbox()).map(sbox => sbox.segment);
  }

}
