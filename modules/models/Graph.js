import { Difference } from './Difference.js';


/**
 *  Graph
 *  A `Graph` is a special collection of OSM Entities.
 *  Each graph contains a base state (uneditied) and local state (edited).
 *  The graph also contains all the caches and methods needed to manage OSM topology.
 *  (parentWays, childNodes, parentRels)
 */
export class Graph {

  /**
   * @constructor
   * @param  {Graph|Context}   otherOrContext - copy another Graph, or pass application context
   * @param  {Array<Entity>?}  toLoad         - optional Array of entities to load into the new Graph.
   */
  constructor(otherOrContext, toLoad) {
    this._childNodes = new Map();   // Map<entityID, Array<Entity>>

    // A Graph derived from a predecessor Graph
    if (otherOrContext instanceof Graph) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this._previous = other;
      this._base = other._base;     // Base data is shared among the chain of Graphs
      this._local = {               // Local data is a clone of the predecessor data
        entities: new Map(other._local.entities),       // shallow clone
        parentWays: new Map(other._local.parentWays),   // shallow clone
        parentRels: new Map(other._local.parentRels)    // shallow clone
      };

    // A fresh Graph
    } else {
      const context = otherOrContext;
      this.context = context;
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
    }

    // generate an ID
    this.id = 'g-' + this.context.next('graph');

    if (toLoad) {
      this.rebase(toLoad, [this]);   // seed with Entities, if provided
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
   * Gets an Entity, searches the local cache first, then the base cache.
   * @param   {string}   entityID - The entityID to lookup
   * @return  {Entity?}  Entity from either local or base cache, or `undefined` if not found.
   */
  hasEntity(entityID) {
    const base = this._base.entities;
    const local = this._local.entities;
    return local.has(entityID) ? local.get(entityID) : base.get(entityID);
  }


  /**
   * entity
   * Gets an Entity, searches the local cache first, then the base cache.
   * (same as `hasEntity` but throws if not found)
   * @param   {string}  entityID - The entityID to lookup
   * @return  {Entity}  Entity from either local or base cache
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
    this._updateGeometries(ids);
    return new Graph(this);
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
// what changed?
const diff = new Difference(this._previous, this);
const ids = [...diff.complete().keys()];
this._updateGeometries(ids);

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
      graph._updateGeometries(newIDs);
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
   * _updateGeometries
   * Internal function, used to update Entity geometries affected by recent graph changes.
   * This needs to be called after all `_updateCaches` calls have finished.
   */
  _updateGeometries(entityIDs) {
    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (!entity) continue;                  // entity was deleted
      if (entity.type === 'node') continue;   // nodes don't need this
      entity.updateGeometry(this);
    }
  }

}
