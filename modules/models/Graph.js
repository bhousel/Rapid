import { Difference } from './Difference.js';
import { utilIterable } from '../util/iterable.js';


/**
 *  Graph
 *  A `Graph` is a special collection of OSM Entities.
 *  Each graph contains a base state (uneditied) and local state (edited).
 *  The graph also contains all the caches and methods needed to manage OSM topology.
 *  (parentWays, childNodes, parentRels)
 *
 *  In previous versions of the code, Graph was written in an immutable style,
 *  so that calls to `replace`/`remove`/`revert` would return a new Graph.
 *  This became a performance concern, so now Graphs are transactional.
 *  You can call these methods to update the topology, and then you should call `commit`
 *  once finished, to update any entities that rely on the graph.
 */
export class Graph {

  /**
   * @constructor
   * @param  {Graph|Context}   otherOrContext - copy another Graph, or pass application context
   * @param  {Array<Entity>?}  toRebase       - optional base Entities to include in the new Graph.
   */
  constructor(otherOrContext, toRebase) {
    this.id = '';  // put this first so debug inspect shows it first

    // A Graph derived from a predecessor Graph
    if (otherOrContext instanceof Graph) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this._previous = other;

      this._base = other._base;     // Base data is shared among the chain of Graphs
      this._local = {               // Local data is a clone of the predecessor data
        entities:   new Map(other._local.entities),    // shallow clone
        parentWays: new Map(other._local.parentWays),  // shallow clone
        parentRels: new Map(other._local.parentRels)   // shallow clone
      };

    // A fresh Graph
    } else {
      const context = otherOrContext;
      this.context = context;
      this._previous = null;

      this._base = {
        entities:   new Map(),  // Map<entityID, Entity>
        parentWays: new Map(),  // Map<entityID, Set<entityIDs>>
        parentRels: new Map()   // Map<entityID, Set<entityIDs>>
      };
      this._local = {
        entities:   new Map(),  // Map<entityID, Entity>
        parentWays: new Map(),  // Map<entityID, Set<entityIDs>>
        parentRels: new Map()   // Map<entityID, Set<entityIDs>>
      };

      if (toRebase) {
        this.rebase(toRebase, [this]);   // seed with base Entities, if provided
      }
    }

    this.id = 'g-' + this.context.next('graph');   // generate an ID
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
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   {Entity}       entity - The Entity to get childNodes for
   * @return  {Array<Node>}  Array of child Nodes
   */
  childNodes(entity) {
    if (!entity.nodes) return [];  // not a way?
    return entity.nodes.map(nodeID => this.entity(nodeID));
  }


  /**
   * replace
   * Replace an Entity in this Graph
   * @param   {OneOrMore<Entity>}  entities - entities to replace
   * @return  {Graph}              this Graph
   */
  replace(entities) {
    const arr = utilIterable(entities).sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (current === entity) continue;  // no change

      this._local.entities.set(entityID, entity);
      this._updateCaches(current, entity);
    }
    return this;
  }


  /**
   * remove
   * Remove an Entity from this Graph
   * @param   {OneOrMore<Entity>}  entities - entities to replace
   * @return  {Graph}              this Graph
   */
  remove(entities) {
    const arr = utilIterable(entities).sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (!current) continue;  // not in the graph

      this._local.entities.set(entityID, undefined);
      this._updateCaches(current, undefined);
    }
    return this;
  }


  /**
   * revert
   * Revert an Entity back to whatever state it had in the base graph
   * @param   {OneOrMore<string>}  entityIDs - the entityIDs of the Entities to revert
   * @return  {Graph}              this Graph
   */
  revert(entityIDs) {
    for (const entityID of utilIterable(entityIDs)) {
      const original = this._base.entities.get(entityID);
      const current = this.hasEntity(entityID);
      if (current === original) continue;   // no change

      this._local.entities.delete(entityID);
      this._updateCaches(current, original);
    }
    return this;
  }


  /**
   * commit
   * Updates any Entities affected by the work in progress, and returns a new Graph.
   * @return  {Graph}  A new Graph
   */
  commit() {
    // What changed between 'previous' and 'current'?
    const diff = new Difference(this._previous, this);
    const ids = [...diff.complete().keys()];
    this._updateGeometries(ids);

    // Replace 'previous' with a copy of the current graph.
    // More changes can happen to this graph and `commit()` will detect them.
    // This also allows the previous Graph to be garbage collected if it was temporary.
    const snapshot = new Graph(this);
    snapshot.id = this.id + '-snapshot';
    snapshot._previous = null;
    this._previous = snapshot;

    return this;
  }


  /**
   * load
   * Loads new Entities into the local Graph, obliterating any existing Entities.
   * Used when restoring history or entering/leaving walkthrough.
   * This is just a shortcut for doing a bunch of `replace`/`remove` calls.
   * @param   {Object<entityID, Entity>}  entities -  Entities to load into the Graph
   * @return  {Graph}  this Graph
   */
  load(entities) {
    // we want to process the nodes first..
    for (const [entityID, entity] of Object.entries(entities)) {
      if (entity?.type === 'node') {
        _loadOne(entityID, entity);
      }
    }
    for (const [entityID, entity] of Object.entries(entities)) {
      if (entity?.type !== 'node') {
        _loadOne(entityID, entity);
      }
    }

    this.commit();
    return this;

    function _loadOne(entityID, entity) {
      const current = this.hasEntity(entityID);
      const replacement = entity || undefined;
      this._local.entities.set(entityID, replacement);
      this._updateCaches(current, replacement);
    }
  }


  /**
   * rebase
   * Loads new Entities into the base graph.
   * Used during to merge newly downloaded data into an existing stack of edits.
   * To external observers, it should appear as if the Graph always contained the newly downloaded data.
   * Important: `rebase` should be called on the base graph
   * @param  {OneOrMore<Entity>}  entities - Entities to add to the base Graph
   * @param  {Array<Graph>}       stack - Stack of graphs that need updates after this rebase
   * @param  {boolean}            force - If `true`, always update, if `false` skip Entities that we've seen already
   */
  rebase(entities, stack, force) {
    const base = this._base;
    const head = stack[stack.length - 1]._local.entities;
    const restoreIDs = new Set();
    const newIDs = new Set();

    const arr = utilIterable(entities).sort(this._nodesFirst);
    for (const entity of arr) {
      if (!entity.visible || (!force && base.entities.has(entity.id))) continue;

      // Merge data into the base graph
      base.entities.set(entity.id, entity);
      this._updateCaches(undefined, entity, base);  // note 'base' here
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
    }

    this._updateGeometries(newIDs);
  }


  /**
   * _updateCaches
   * Internal function, used to update internal caches after an Entity update.
   * @param  {Entity}  previous?  - The previous Entity, may be undefined if new
   * @param  {Entity}  current?   - The current Entity, may be undefined if delete
   * @parem  {Object}  caches?    - which caches to update, defaults to the local caches
   */
  _updateCaches(previous, current, caches) {
    const base = this._base;
    const local = this._local;
    const which = caches ?? local;
    const parentWays = which.parentWays;
    const parentRels = which.parentRels;

    const entity = current ?? previous;
    if (!entity) return;   // Either current or previous must be set

    if (entity.type === 'way') {  // update parentWays
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

    } else if (entity.type === 'relation') {  // Update parentRels
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


  /**
   * _nodesFirst
   * Internal function, compare function to sort nodes first.
   */
  _nodesFirst(a, b) {
    const aIsNode = (a.type === 'node');
    const bIsNode = (b.type === 'node');
    return (aIsNode && !bIsNode) ? -1 : (!aIsNode && bIsNode) ? 1 : 0;
  }

}
