

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
   * @param {Graph|Array<Entity>} other?   - Predecessor Graph, or Array of entities to load into new Graph.
   * @param {boolean}             mutable? - Do updates affect this Graph or return a new Graph
   */
  constructor(other, mutable) {
    this._transients = new Map();   // Map<entityID, Map<k,v>>
    this._childNodes = new Map();   // Map<entityID, Array<Entity>>

    // A Graph derived from a predecessor Graph
    if (other instanceof Graph) {
      this._base = other._base;     // Base data is shared among the chain of Graphs
      this._local = {               // Local data is a clone of the predecessor data
        entities: new Map(other._local.entities),       // shallow clone
        parentWays: new Map(other._local.parentWays),   // shallow clone
        parentRels: new Map(other._local.parentRels)    // shallow clone
      };

     // A fresh Graph
     } else {
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

    this._frozen = !mutable;
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
   * transient
   * Stores a computed property for the given Entity in the graph itself,
   * to avoid frequent and expensive recomputation.  We're essentially
   * implementating "memoization" for the provided function.
   * @param   {Entity}    entity - The Entity to compute a value for
   * @param   {string}    key - String cache key to lookup the computed value (e.g. 'extent')
   * @param   {function}  fn  - Function that performs the computation, will be passed `entity`
   * @return  {*}         The result of the function call
   */
  transient(entity, key, fn) {
    const entityID = entity.id;
    let cache = this._transients.get(entityID);
    if (!cache) {
      cache = new Map();
      this._transients.set(entityID, cache);
    }

    let val = cache.get(key);
    if (val !== undefined) return val;  // return cached

    val = fn.call(entity);   // compute value
    cache.set(key, val);
    return val;
  }


  /**
   * isPoi
   * Returns `true` if the Entity is a Node with no parents
   * @param   {Entity}   entity - The Entity to test
   * @return  {boolean}  `true` if a Node with no parents
   */
  isPoi(entity) {
    if (entity.type !== 'node') return false;

    const base = this._base.parentWays;
    const local = this._local.parentWays;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    return parentIDs.size === 0;
  }


  /**
   * isShared
   * Returns `true` if the Entity has multiple connections:
   *  - a Node with multiple parents, OR
   *  - a Node connected to a single parent in multiple places.
   * @param   {Entity}   entity - The Entity to test
   * @return  {boolean}  `true` if a Node has multiple connections
   */
  isShared(entity) {
    if (entity.type !== 'node') return false;

    const base = this._base.parentWays;
    const local = this._local.parentWays;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    if (parentIDs.size === 0) return false;  // no parents
    if (parentIDs.size > 1) return true;     // multiple parents

    // single parent
    const parentID = [...parentIDs][0];
    const parent = this.entity(parentID);

    // If parent is a closed loop, don't count the last node in the nodelist as doubly connected
    const end = parent.isClosed() ? parent.nodes.length - 1 : parent.nodes.length;
    for (let i = 0, count = 0; i < end; i++) {
      if (entity.id === parent.nodes[i]) count++;
      if (count > 1) return true;
    }
    return false;
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
   * rebase
   * Rebase merges new Entities into the base graph.
   * Unlike other Graph methods that return a new Graph, rebase mutates in place.
   * This is because it is used during to merge newly downloaded data into an existing stack of edits.
   * To external consumers of the Graph, it should appear as if the Graph always contained the newly downloaded data.
   * NOTE: It is probably important to call this ordered: Nodes, Ways, Relations
   * @param  {Array<Entity>}  entities - Entities to add to the base Graph
   * @param  {Array<Graph>}   stack - Stack of graphs that need updates after this rebase
   * @param  {boolean}        force - If `true`, always update, if `false` skip entities that we've seen already
   */
  rebase(entities, stack, force) {
    const base = this._base;
    const head = stack[stack.length - 1]._local.entities;
    const restoreIDs = new Set();

// need to force update any parent geometry when new children appear?
const newEntities = new Set();

    for (const entity of entities) {
      if (!entity.visible || (!force && base.entities.has(entity.id))) continue;

      // Merge data into the base graph
      base.entities.set(entity.id, entity);
      this._updateCalculated(undefined, entity, base.parentWays, base.parentRels);
newEntities.add(entity);

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
          local.delete(id);
        }
      }
      graph._updateRebased(newEntities);
    }
  }


  /**
   * _updateRebased
   * Internal function - Update a graph following a `rebase` (base graph has changed).
   * Check local `parentWays` and `parentRels` caches and make sure they
   * are consistent with the data in the base caches.
   * @param {Array<Entity>}  newEntities - the new Entities  If they have parents the parents need their geometry updated.
   */
  _updateRebased(newEntities) {
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

// Note that clearing the transients used to fix the "newEntities" problem,
// because this is where the calculated extents used to live.
    this._transients = new Map();

// force update the geometries?
const toUpdate = new Map();
for (const entity of newEntities) {
  this._getParents(entity, toUpdate);
}
for (const entity of toUpdate.values()) {
  entity.updateGeometry(this);
}

    // this._childNodes is not updated, under the assumption that
    // ways are always downloaded with their child nodes.
  }



// borrowed from Tree._includeParents, we may need it here.
_getParents(entity, toUpdate, seen) {
  const entityID = entity.id;
  if (!seen) seen = new Set();

  if (seen.has(entityID)) return;
  seen.add(entityID);

  for (const way of this.parentWays(entity)) {
    toUpdate.set(way.id, way);
    this._getParents(way, toUpdate, seen);
  }

  for (const relation of this.parentRelations(entity)) {
    toUpdate.set(relation.id, relation);
    this._getParents(relation, toUpdate, seen);
  }
}


  /**
   * _updateCalculated
   * Internal function, used to update internal caches after an Entity update
   * @param  {Entity}                previous?     The previous Entity
   * @param  {Entity}                current?      The current Entity
   * @param  {Map<entityID,Entity>}  parentWays?   parentWays Map() to update (defaults to `this._local.parentWays`)
   * @param  {Map<entityID,Entity>}  parentRels?   parentRels Map() to update (defaults to `this._local.parentRels`)
   */
  _updateCalculated(previous, current, parentWays, parentRels) {
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

    // Caches for the new Entity should be consistent, so we can compute its geometry.
    // Don't need to do this for nodes, because their geometry is just stored in `loc`
    // which was set in their constructor.
    if (current && (current.type === 'way' || current.type === 'relation')) {
      current.updateGeometry(this);
    }
  }


  /**
   * replace
   * Replace an Entity in this Graph
   * @param   {Entity}  entity - The Entity to replace
   * @return  {Graph}   A new Graph
   */
  replace(replacement) {
    const entityID = replacement.id;
    const current = this.hasEntity(entityID);
    if (current === replacement) return this;  // no change

    return this.update(function() {
      this._updateCalculated(current, replacement);
      this._local.entities.set(entityID, replacement);
    });
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

    return this.update(function() {
      this._updateCalculated(current, undefined);
      this._local.entities.set(entityID, undefined);
    });
  }


  /**
   * revert
   * Revert an Entity back to whatever state it had in the base graph
   * @param   {Entity}  entityID - The entityID of the Entity to revert
   * @return  {Graph}   A new Graph
   */
  revert(entityID) {
    const original = this._base.entities.get(entityID);
    const current = this.hasEntity(entityID);
    if (current === original) return this;   // no change

    return this.update(function() {
      this._updateCalculated(current, original);
      this._local.entities.delete(entityID);
    });
  }


  /**
   * update
   * Applies the given list of function arguments to the Graph, and returns a new Graph
   * @param   {...function}  args - Functions to apply to the graph to update it
   * @return  {Graph}        A new Graph
   */
  update(...args) {
    const graph = this._frozen ? new Graph(this, true) : this;

    for (const fn of args) {
      fn.call(graph, graph);
    }

    if (this._frozen) {
      graph._frozen = true;
    }

    return graph;
  }


  /**
   * load
   * Loads new Entities into the local Graph, obliterating any existing Entities.
   * Used when restoring history or entering/leaving walkthrough.
   * This basically does the same thing as `replace`/`remove`, but without creating a new Graph.
   * @param   {Object<entityID, Entity>} entities -  Entities to load into the Graph
   * @return  {Graph}  this Graph
   */
  load(entities) {
    for (const [entityID, entity] of Object.entries(entities)) {
      const current = this.hasEntity(entityID);
      const replacement = entity || undefined;
      this._updateCalculated(current, replacement);
      this._local.entities.set(entityID, replacement);
    }

    return this;
  }

}
