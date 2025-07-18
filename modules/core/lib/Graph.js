import { Difference } from './Difference.js';


/**
 *  Graph
 *  A `Graph` is a special collection of OSM Entities.
 *  Each graph contains a base state (uneditied) and local state (edited).
 *  The graph also contains all the caches and methods needed to manage OSM topology.
 *  (parentWays, childNodes, parentRels)
 *  Graphs are intended to be immutable - the `update()` method will return a new Graph.
 */
export class Graph {

  /**
   * @constructor
   * @param  {Graph|Array<Entity>}  other?   - Predecessor Graph, or Array of entities to load into new Graph.
   */
  constructor(other) {
    this._childNodes = new Map();   // Map<entityID, Array<Entity>>
//    this._affectedIDs = new Set();  // Set<entityID> affected by recent graph updates

    // A Graph derived from a predecessor Graph
    if (other instanceof Graph) {
      this._previous = other;
      this._base = other._base;     // Base data is shared among the chain of Graphs
      this._local = {               // Local data is a clone of the predecessor data
        entities: new Map(other._local.entities),       // shallow clone
        parentWays: new Map(other._local.parentWays),   // shallow clone
        parentRels: new Map(other._local.parentRels)    // shallow clone
      };

     // A fresh Graph
     } else {
      this._previous = null;
      this._base = {
        entities: new Map(),    // Map<entityID, Entity>
        parentWays: new Map(),  // Map<entityID, Set<entityIDs>>
        parentRels: new Map()   // Map<entityID, Set<entityIDs>>
      };
      this._local = {
        entities: new Map(),    // Map<entityID, Entity>
        parentWays: new Map(),  // Map<entityID, Set<entityIDs>>
        parentRels: new Map()   // Map<entityID, Set<entityIDs>>
      };

      this.rebase(other || [], [this]);   // seed with Entities, if provided
    }
  }


  /**
   * base
   * @return  {Object}  Access to `_base` caches.
   * @readonly
   */
  get base() {
    return this._base;
  }

  /**
   * local
   * @return  {Object}  Access to `_local` caches.
   * @readonly
   */
  get local() {
    return this._local;
  }


  /**
   * hasEntity
   * Gets an Entity, searches the local graph first, then the base graph.
   * @param   {string}   entityID - The entityID to lookup
   * @return  {Entity?}  Entity from either local or base graph, or `undefined` if not found.
   */
  hasEntity(entityID) {
    const base = this._base.entities;
    const local = this._local.entities;
    return local.has(entityID) ? local.get(entityID) : base.get(entityID);
  }


  /**
   * entity
   * Gets an Entity, searches the local graph first, then the base graph.
   * (same as `hasEntity` but throws if not found)
   * @param   {string}  entityID - The entityID to lookup
   * @return  {Entity}  Entity from either local or base graph
   * @throws  Will throw if the entity is not found
   */
  entity(entityID) {
    const entity = this.hasEntity(entityID);
    if (!entity) {
      throw new Error(`Entity ${entityID} not found`);
    }
    return entity;
  }


  /**
   * parentWays
   * Makes an Array containing parent Ways for the given Entity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   {Entity}      entity - The Entity to get parentWays for
   * @return  {Array<Way>}  Array of parent Ways
   * @throws  Will throw if any parent Way is not found
   */
  parentWays(entity) {
    const base = this._base.parentWays;
    const local = this._local.parentWays;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    return Array.from(parentIDs).map(parentID => this.entity(parentID));
  }


  /**
   * parentRelations
   * Makes an Array containing parent Relations for the given Entity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   {Entity}           entity - The Entity to get parentRelations for
   * @return  {Array<Relation>}  Array of parent Relations
   * @throws  Will throw if any parent Relation is not found
   */
  parentRelations(entity) {
    const base = this._base.parentRels;
    const local = this._local.parentRels;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    return Array.from(parentIDs).map(parentID => this.entity(parentID));
  }


  /**
   * childNodes
   * Makes an Array containing child Nodes for the given Entity.
   * This function is memoized, so that repeated calls return the same Array.
   * @param   {Entity}       entity - The Entity to get childNodes for
   * @return  {Array<Node>}  Array of child Nodes
   * @throws  Will throw if any child Node is not found
   */
  childNodes(entity) {
    if (!entity.nodes) return [];  // not a way?

    let children = this._childNodes.get(entity.id);
    if (children) return children;  // return cached

    // compute
    children = new Array(entity.nodes.length);
    for (let i = 0; i < entity.nodes.length; ++i) {
      children[i] = this.entity(entity.nodes[i]);
    }
    this._childNodes.set(entity.id, children);  // set cache
    return children;
  }


  /**
   * replace
   * Replace an Entity in this Graph
   * @param   {Entity}  entity - The Entity to replace
   * @return  {Graph}   A new Graph
   */
  replace(entity) {
    const entityID = entity.id;
    const current = this.hasEntity(entityID);
    if (current === entity) return this;  // no change

    this._local.entities.set(entityID, entity);
    this._updateCaches(current, entity);
    return this;

//    return this.update(function() {
//      this._local.entities.set(entityID, replacement);
//      this._updateCaches(current, replacement);
//    });
  }


  /**
   * replaceSelf
   * Replace an Entity in this Graph
   * @param   {Entity}  entity - The Entity to replace
   * @return  {Graph}   This same Graph
   */
  replaceSelf(entity) {
    return this.replace(entity);
//    const entityID = replacement.id;
//    const current = this.hasEntity(entityID);
//    if (current === replacement) return this;  // no change
//
//    return this.updateSelf(function() {
//      this._local.entities.set(entityID, replacement);
//      this._updateCaches(current, replacement);
//    });
  }


  /**
   * remove
   * Remove an Entity from this Graph
   * @param   {Entity}  entity - The Entity to remove
   * @return  {Graph}   A new Graph
   */
  remove(entity) {
    const entityID = entity.id;
    const current = this.hasEntity(entityID);
    if (!current) return this;  // not in the graph

    this._local.entities.set(entityID, undefined);
    this._updateCaches(current, undefined);
    return this;

//    return this.update(function() {
//      this._local.entities.set(entityID, undefined);
//      this._updateCaches(current, undefined);
//    });
  }


  /**
   * revert
   * Revert an Entity back to whatever state it had in the base graph
   * @param   {string}  entityID - The entityID of the Entity to revert
   * @return  {Graph}   A new Graph
   */
  revert(entityID) {
    const original = this._base.entities.get(entityID);
    const current = this.hasEntity(entityID);
    if (current === original) return this;   // no change

    this._local.entities.delete(entityID);
    this._updateCaches(current, original);
    return this;

//    return this.update(function() {
//      this._local.entities.delete(entityID);
//      this._updateCaches(current, original);
//    });
  }


  /**
   * commit
   * Updates any Entities affected by the work in progress, and returns a new Graph.
   * @return  {Graph}  A new Graph
   */
  commit() {
    const prev = this._previous;
    const diff = new Difference(prev, this);
    const ids = [...diff.complete().keys()];
    this._updateAffected(ids);
    return new Graph(this);
  }


  /**
   * update
   * Creates a new Graph, applies the given functions, and returns the new Graph.
   * Graphs are intended to be immutable.
   * @param   {...function}  args - Functions to apply to the Graph to update it
   * @return  {Graph}        A new Graph
   */
  update(...args) {
    if (this._mutate) {
      return this.updateSelf(...args);

    } else {
      const graph = new Graph(this);
      graph._mutate = true;

      for (const fn of args) {
        fn.call(graph, graph);
      }

// what changed?
const diff = new Difference(graph._previous, graph);  // graph._previous === this ?
const ids = [...diff.complete().keys()];
graph._updateAffected(ids);

      graph._mutate = false;
      return graph;
    }
  }


  /**
   * updateSelf
   * Applies the given functions to the Graph, and returns this same Graph.
   * Like `update` but it modifies the current Graph in-place.
   * `updateSelf` is slightly more performant for situations where you don't need
   * immutability and don't mind mutating the Graph.
   * @param   {...function}  args - Functions to apply to the graph to update it
   * @return  {Graph}        this same Graph
   */
  updateSelf(...args) {
    const was = this._mutate;
    this._mutate = true;

    for (const fn of args) {
      fn.call(this, this);
    }
//    this._updateAffected();

    this._mutate = was;
    return this;
  }


  /**
   * load
   * Loads new Entities into the local Graph, obliterating any existing Entities.
   * Unlike other Graph methods that return a new Graph, `load` mutates in-place.
   * Used when restoring history or entering/leaving walkthrough.
   * This basically does the same thing as `replace`/`remove`, but without creating a new Graph.
   * @param   {Object<entityID, Entity>}  entities -  Entities to load into the Graph
   * @return  {Graph}  this Graph
   */
  load(entities) {
    for (const [entityID, entity] of Object.entries(entities)) {
      const current = this.hasEntity(entityID);
      const replacement = entity || undefined;
      this._local.entities.set(entityID, replacement);
      this._updateCaches(current, replacement);
    }
//    this._updateAffected();
// what changed?
const diff = new Difference(this._previous, this);
const ids = [...diff.complete().keys()];
this._updateAffected(ids);

    return this;
  }


  /**
   * rebase
   * Loads new Entities into the base graph.
   * Unlike other Graph methods that return a new Graph, `rebase` mutates in-place.
   * Used during to merge newly downloaded data into an existing stack of edits.
   * To external observers, it should appear as if the Graph always contained the newly downloaded data.
   * NOTE: It is probably important to call this ordered: Nodes, Ways, Relations
   * @param  {Array<Entity>}  entities - Entities to add to the base Graph
   * @param  {Array<Graph>}   stack - Stack of graphs that need updates after this rebase
   * @param  {boolean}        force - If `true`, always update, if `false` skip Entities that we've seen already
   */
  rebase(entities, stack, force) {
    const base = this._base;
    const head = stack[stack.length - 1]._local.entities;
    const restoreIDs = new Set();
    const newIDs = new Set();

    for (const entity of entities) {
      if (!entity.visible || (!force && base.entities.has(entity.id))) continue;

      // Merge data into the base graph
      base.entities.set(entity.id, entity);
      this._updateCaches(undefined, entity, base.parentWays, base.parentRels);
      newIDs.add(entity.id);

      // A weird thing we have to watch out for..
      // Sometimes an edit can remove a node, then we download more information and realize
      // that that Node belonged to a parentWay.  If we detect this condition, restore the node.
      // (A "delete" is stored as: setting that entity = `undefined`)
      if (entity.type === 'way') {
        for (const id of entity.nodes) {
          if (head.has(id) && head.get(id) === undefined) {  // was deleted
            restoreIDs.add(id);
          }
        }
      }
    }

    for (const graph of stack) {
      const local = graph._local.entities;
      // Restore deleted nodes that were discovered to belong to a parentWay.
      for (const id of restoreIDs) {
        if (local.has(id) && local.get(id) === undefined) {  // was deleted
          local.delete(id);  // "delete the delete", aka restore.
        }
      }

      graph._updateRebased();

//      // update geometries for new IDs
//      graph._affectedIDs = new Set(newIDs);
      graph._updateAffected(newIDs);
    }
  }


  /**
   * _updateCaches
   * Internal function, used to update internal caches after an Entity update
   * @param  {Entity}                previous?     The previous Entity
   * @param  {Entity}                current?      The current Entity
   * @param  {Map<entityID,Entity>}  parentWays?   parentWays Map() to update (defaults to `this._local.parentWays`)
   * @param  {Map<entityID,Entity>}  parentRels?   parentRels Map() to update (defaults to `this._local.parentRels`)
   */
  _updateCaches(previous, current, parentWays, parentRels) {
    const base = this._base;
    const local = this._local;
    parentWays = parentWays || local.parentWays;
    parentRels = parentRels || local.parentRels;

    const entity = current ?? previous;
    if (!entity) return;   // Either current or previous must be set

    // This entity and any of its parents might need a geometry update.
//    this._affectedIDs.add(entity.id);

    if (entity.type === 'way') {  // Update parentWays
      const prevNodes = new Set(previous?.nodes);
      const currNodes = new Set(current?.nodes);
      const removed = prevNodes.difference(currNodes);
      const added = currNodes.difference(prevNodes);

      // shallow copy whatever parentWays had in it before, and perform deletes/adds as needed
      for (const childID of removed) {
        const parentIDs = new Set( local.parentWays.get(childID) ?? base.parentWays.get(childID) ?? [] );
        parentIDs.delete(entity.id);
        parentWays.set(childID, parentIDs);
      }
      for (const childID of added) {
        const parentIDs = new Set( local.parentWays.get(childID) ?? base.parentWays.get(childID) ?? [] );
        parentIDs.add(entity.id);
        parentWays.set(childID, parentIDs);
      }

    } else if (entity.type === 'relation') {   // Update parentRels
      // diff only on the IDs since the same entity can be a member multiple times with different roles
      const prevMembers = new Set(previous?.members?.map(m => m.id));
      const currMembers = new Set(current?.members?.map(m => m.id));
      const removed = prevMembers.difference(currMembers);
      const added = currMembers.difference(prevMembers);

      // shallow copy whatever parentRels had in it before, and perform deletes/adds as needed
      for (const childID of removed) {
        const parentIDs = new Set( local.parentRels.get(childID) ?? base.parentRels.get(childID) ?? [] );
        parentIDs.delete(entity.id);
        parentRels.set(childID, parentIDs);
      }
      for (const childID of added) {
        const parentIDs = new Set( local.parentRels.get(childID) ?? base.parentRels.get(childID) ?? [] );
        parentIDs.add(entity.id);
        parentRels.set(childID, parentIDs);
      }
    }
  }


  /**
   * _updateRebased
   * Internal function, used to update a graph following a `rebase` (base graph has changed).
   * Check local `parentWays` and `parentRels` caches and make sure they are consistent
   *  with the data in the base caches.
   */
  _updateRebased() {
    const base = this._base;
    const local = this._local;

    for (const [childID, parentWayIDs] of local.parentWays) {  // for all this.parentWays we've cached
      const baseWayIDs = base.parentWays.get(childID);         // compare to base.parentWays
      if (!baseWayIDs) continue;
      for (const wayID of baseWayIDs) {
        if (!local.entities.has(wayID)) {  // if the Way hasn't been edited
          parentWayIDs.add(wayID);         // update `this.parentWays` cache
        }
      }
    }

    for (const [childID, parentRelIDs] of local.parentRels) {  // for all this.parentRels we've cached
      const baseRelIDs = base.parentRels.get(childID);         // compare to base.parentRels
      if (!baseRelIDs) continue;
      for (const relID of baseRelIDs) {
        if (!local.entities.has(relID)) {  // if the Relation hasn't been edited
          parentRelIDs.add(relID);         // update `this.parentRels` cache
        }
      }
    }

    // this._childNodes is not updated, under the assumption that
    // ways are always downloaded with their child nodes.
  }


  /**
   * _updateAffected
   * Internal function, used to update Entity geometries affected by recent graph changes.
   * This needs to be called after all `_updateCaches` calls have finished.
   */
  _updateAffected(entityIDs) {

    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (!entity) continue;                  // entity was deleted
      if (entity.type === 'node') continue;   // nodes don't need this
      entity.updateGeometry(this);
    }

//    const toUpdate = new Set();
//    const seenIDs = new Set();
//
//    // Include any affected Entities, and their parent Entities.
//    for (const affectedID of this._affectedIDs) {
//      const entity = this.hasEntity(affectedID);
//      if (!entity) continue;
//
//      toUpdate.add(entity);
//      this._getParents(entity, toUpdate, seenIDs);
//    }
//
//    // Update geometry
//    for (const entity of toUpdate.values()) {
//      if (!entity) continue;                  // entity was deleted
//      if (entity.type === 'node') continue;   // nodes don't need this
//      entity.updateGeometry(this);
//    }
//
//    this._affectedIDs.clear();
  }


//  // borrowed from Tree._includeParents
//  _getParents(entity, toUpdate, seenIDs) {
//    const entityID = entity.id;
//    if (!seenIDs) seenIDs = new Set();
//
//    if (seenIDs.has(entityID)) return;
//    seenIDs.add(entityID);
//
//    for (const way of this.parentWays(entity)) {
//      toUpdate.add(way);
//      this._getParents(way, toUpdate, seenIDs);
//    }
//
//    for (const relation of this.parentRelations(entity)) {
//      toUpdate.add(relation);
//      this._getParents(relation, toUpdate, seenIDs);
//    }
//  }


}
