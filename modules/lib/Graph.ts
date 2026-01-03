import { Difference } from './Difference.ts';
import { type Iterable, type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { Context, Entity, EntityID, NodeEntity, RelationEntity, WayEntity } from './types.ts';


/**
 * GraphProps
 * Properties object for a Graph
 */
export interface GraphProps {
  /** Unique string to identify this Graph */
  id: string;
  /** Internal version of the Graph, can be used to detect changes */
  v: number;
}


/**
 * GraphCache
 * Internal cache structure used to store entities and their relationships
 */
export interface GraphCache {
  /** Map<entityID, Entity> - stores all entities */
  entities: Map<EntityID, Entity | undefined>;
  /** Map<entityID, Set<entityIDs>> - maps child IDs to parent Way IDs */
  parentWays: Map<EntityID, Set<EntityID>>;
  /** Map<entityID, Set<entityIDs>> - maps child IDs to parent Relation IDs */
  parentRels: Map<EntityID, Set<EntityID>>;
}


/**
 * Graph
 * A `Graph` is a special collection of OSM Entities.
 * Each graph contains a "base" state (uneditied) and "local" state (edited).
 * The graph also contains all the caches and methods needed to manage OSM topology.
 *
 * In previous versions of the code, Graph was written in an immutable style,
 * so that calls to `replace`/`remove`/`revert` would return a new Graph.
 * This became a performance concern, so now Graphs are transactional.
 * You can call these methods anytme to make modifications to the Graph,
 * but then you must call `commit` to update any Entities that rely on the Graph.
 *
 * Properties you can access:
 *   `id`      Unique string to identify this Graph
 *   `v`       Internal version of the Graph, can be used to detect changes
 *   `props`   Properties object
 */
export class Graph {
  id: string;
  context: Context;
  props: GraphProps;
  isBaseGraph: boolean;
  previous: Graph | null;
  base: GraphCache;
  local: GraphCache;

  /**
   * @constructor
   * @param  otherOrContext  - copy another Graph, or pass application context
   * @param  propsOrEntities - optional properties or base Entities to include in the graph.
   */
  constructor(otherOrContext: Graph | Context, propsOrEntities: Entity[] | Partial<GraphProps> = {}) {
    this.id = '';  // put this first so debug inspect shows it first

    // A Graph derived from a predecessor Graph
    if (otherOrContext instanceof Graph) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this.props = {} as GraphProps;
      this.isBaseGraph = false;
      this.previous = other;

      this.base = other.base;     // Base cache is shared among the chain of Graphs
      this.local = {              // Local data is a clone of the predecessor data
        entities:   new Map(other.local.entities),    // shallow clone
        parentWays: new Map(other.local.parentWays),  // shallow clone
        parentRels: new Map(other.local.parentRels)   // shallow clone
      };

    // A fresh Graph
    } else {
      const context = otherOrContext as Context;
      this.context = context;
      this.props = {} as GraphProps;
      this.isBaseGraph = true;
      this.previous = null;

      this.base = {
        entities:   new Map(),
        parentWays: new Map(),
        parentRels: new Map()
      };
      this.local = {
        entities:   new Map(),
        parentWays: new Map(),
        parentRels: new Map()
      };
    }

    // Deal with extra argument
    if (Array.isArray(propsOrEntities)) {
      const toRebase = propsOrEntities;
      this.rebase(toRebase);   // seed with base Entities, if provided

    } else {
      const props = propsOrEntities;
      Object.assign(this.props, globalThis.structuredClone(props));  // override with passed in props
    }

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'g-' + this.context.next('graph');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;
  }


  /**
   * destroy
   * Remove all saved state and free memory.
   * Do not use the Graph after calling `destroy()`.
   */
  destroy(): void {
    this.base = null!;
    this.local = null!;
    this.previous = null;
    this.props = null!;
    this.context = null!;
  }


  /**
   * id
   * Unique string to identify this Graph.
   * @readonly
   */
  get graphID(): string {
    return this.id;
  }

  /**
   * v
   * Internal version of the Graph, can be used to detect changes.
   * @readonly
   */
  get v(): number {
    return this.props.v || 0;
  }

  /**
   * key
   * The 'key' includes both the id and the version
   * @readonly
   */
  get key(): string {
    return `${this.id}v${this.v}`;
  }

  /**
   * touch
   * Bump internal version number in place (typically, forcing a rerender)
   * Note that this version number always increases and is shared by all data elements.
   * We did it this way to avoid situations where you undo to a previous version
   *  you don't want it to increment it back to the same version and appear unchanged.
   * @see Rapid@9ac2776a
   * @return   this Graph
   */
  touch(): Graph {
    this.props.v = this.context.next('v');
    return this;
  }


  /**
   * hasEntity
   * Gets an Entity, searches the local cache first, then the base cache.
   * @param   entityID - The entityID to lookup
   * @return  Entity from either local or base cache, or `undefined` if not found.
   */
  hasEntity(entityID: EntityID): Entity | undefined {
    const base = this.base.entities;
    const local = this.local.entities;
    return local.has(entityID) ? local.get(entityID) : base.get(entityID);
  }


  /**
   * entity
   * Gets an Entity, searches the local cache first, then the base cache.
   * (same as `hasEntity` but throws if not found)
   * @param   entityID - The entityID to lookup
   * @return  Entity from either local or base cache
   * @throws  Will throw if the entity is not found
   */
  entity(entityID: EntityID): Entity {
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
   * @param   entity - The Entity to get parentWays for
   * @return  Array of parent Ways
   * @throws  Will throw if any parent Way is not found
   */
  parentWays(entity: Entity): WayEntity[] {
    const base = this.base.parentWays;
    const local = this.local.parentWays;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    return Array.from(parentIDs).map(parentID => this.entity(parentID) as WayEntity);
  }


  /**
   * parentRelations
   * Makes an Array containing parent Relations for the given Entity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The Entity to get parentRelations for
   * @return  Array of parent Relations
   * @throws  Will throw if any parent Relation is not found
   */
  parentRelations(entity: Entity): RelationEntity[] {
    const base = this.base.parentRels;
    const local = this.local.parentRels;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set();
    return Array.from(parentIDs).map(parentID => this.entity(parentID) as RelationEntity);
  }


  /**
   * childNodes
   * Makes an Array containing child Nodes for the given Entity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The Entity to get childNodes for
   * @return  Array of child Nodes
   */
  childNodes(entity: WayEntity): NodeEntity[] {
    if (!entity.nodes) return [];  // not a way?
    return entity.nodes.map(nodeID => this.entity(nodeID) as NodeEntity);
  }


  /**
   * replace
   * Replace an Entity in this Graph
   * @param   entities - entities to replace
   * @return  this Graph
   * @throws  Will throw if called on a base graph
   */
  replace(entities: OneOrMore<Entity>): Graph {
    if (this.isBaseGraph) {
      throw new Error(`Do not call 'replace' on a base graph`);
    }

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (current === entity) continue;  // no change

      this.local.entities.set(entityID, entity);
      this._updateCaches(current, entity);
    }
    return this.touch();
  }


  /**
   * remove
   * Remove an Entity from this Graph
   * @param   entities - entities to remove
   * @return  this Graph
   * @throws  Will throw if called on a base graph
   */
  remove(entities: OneOrMore<Entity>): Graph {
    if (this.isBaseGraph) {
      throw new Error(`Do not call 'remove' on a base graph`);
    }

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (!current) continue;  // not in the graph

      this.local.entities.set(entityID, undefined);
      this._updateCaches(current, undefined);
    }
    return this.touch();
  }


  /**
   * revert
   * Revert an Entity back to whatever state it had in the base graph
   * @param   entityIDs - the entityIDs of the Entities to revert
   * @return  this Graph
   * @throws  Will throw if called on a base graph
   */
  revert(entityIDs: OneOrMore<EntityID>): Graph {
    if (this.isBaseGraph) {
      throw new Error(`Do not call 'revert' on a base graph`);
    }

    for (const entityID of utilIterable(entityIDs) as EntityID[]) {
      const original = this.base.entities.get(entityID);
      const current = this.hasEntity(entityID);
      if (current === original) continue;   // no change

      this.local.entities.delete(entityID);
      this._updateCaches(current, original);
    }
    return this.touch();
  }


  /**
   * commit
   * Updates any Entities affected by the work in progress
   * @return  this Graph
   */
  commit(): Graph {
    // What changed between 'previous' and 'current'?
    const diff = new Difference(this.previous, this);
    const ids = [...diff.complete().keys()];
    this._updateGeometries(ids);

    // Replace 'previous' with a copy of the current graph.
    // More changes can happen to this graph and `commit()` will detect them.
    // This also allows the previous Graph to be garbage collected if it was temporary.
    this.previous = this.snapshot();
    return this;
  }


  /**
   * snapshot
   * A Graph "snapshot" is a copy of the Graph that can be used to compute Differences.
   * It's just a copy with a special `id` and with no `previous`.
   * (The `previous = null` helps avoid leaking memory, we don't need to reference the previous Graph).
   * @return  A new Graph
   */
  snapshot(): Graph {
    const id = this.id + '-snapshot';
    const snapshot = new Graph(this, { id: id });
    snapshot.previous = null;
    return snapshot;
  }


  /**
   * load
   * Loads new Entities into the local Graph, obliterating any existing Entities.
   * Used when restoring history or entering/leaving walkthrough.
   * This is just a shortcut for doing a bunch of `replace`/`remove` calls.
   * (The Entities passed in may be undefined, in the case of deletion)
   * @param   entities - Entities to load into the Graph
   * @return  this Graph
   * @throws  Will throw if called on a base graph
   */
  load(entities: Record<EntityID, Entity | undefined> = {}): Graph {
    if (this.isBaseGraph) {
      throw new Error(`Do not call 'load' on a base graph`);
    }

    const _loadOne = (entityID: EntityID, entity: Entity | undefined): void => {
      const current = this.hasEntity(entityID);
      const replacement = entity || undefined;
      this.local.entities.set(entityID, replacement);
      this._updateCaches(current, replacement);
    };

    // we want to process the nodes first..
    for (const [entityID, entity] of Object.entries(entities)) {
      if ((entity as Entity | undefined)?.type === 'node') {
        _loadOne(entityID, entity);
      }
    }
    for (const [entityID, entity] of Object.entries(entities)) {
      if ((entity as Entity | undefined)?.type !== 'node') {
        _loadOne(entityID, entity);
      }
    }

    return this.commit().touch();
  }


  /**
   * rebase
   * Loads new Entities into the base graph.
   * This is used to merge newly-downloaded data into an existing stack of edits.
   * To external observers, it should appear as if these Graphs always contained the newly downloaded data.
   * Important: `rebase` should be called on the base graph
   * @param  entities - Entities to add to the base Graph
   * @param  stack - Stack of graphs that need updates after this rebase
   * @param  force - If `true`, always update, if `false` skip Entities that we've seen already
   * @throws  Will throw if _not_ called on a base graph
   */
  rebase(entities: OneOrMore<Entity>, stack: Graph[] = [], force: boolean = false): void {
//    if (!this.isBaseGraph) {
//      throw new Error(`Must call 'rebase' on a base graph`);
//    }

    const base = this.base;
    const head = stack.at(-1)?.local?.entities;
    const restoreIDs = new Set<EntityID>();
    const newIDs = new Set<EntityID>();

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      if (!entity.visible || (!force && base.entities.has(entity.id))) continue;

      // Merge data into the base graph
      base.entities.set(entity.id, entity);
      this._updateCaches(undefined, entity, base);  // note 'base' here
      newIDs.add(entity.id);

      // A weird thing we have to watch out for.. iD#2085
      // Sometimes an edit can remove a node, then we download more information and realize that
      // that Node was shared with another way.  If we detect this condition, restore the node.
      // (A "delete" is stored as: setting that entity = `undefined`)
      if (head && entity.type === 'way') {
        for (const id of (entity as WayEntity).nodes) {
          if (head.has(id) && head.get(id) === undefined) {  // was deleted
            restoreIDs.add(id);
          }
        }
      }
    }

    for (const graph of stack) {
      graph._updateRebased(restoreIDs);
    }

    this._updateGeometries(newIDs);
  }


  /**
   * _updateCaches
   * Internal function, used to update internal caches after an Entity update.
   * @param  previous  - The previous Entity, may be undefined if new
   * @param  current   - The current Entity, may be undefined if delete
   * @param  caches    - which caches to update, defaults to the local caches
   */
  _updateCaches(previous: Entity | undefined, current: Entity | undefined, caches?: GraphCache): void {
    const base = this.base;
    const local = this.local;
    const which = caches ?? local;
    const parentWays = which.parentWays;
    const parentRels = which.parentRels;

    const entity = current ?? previous;
    if (!entity) return;   // Either current or previous must be set

    if (entity.type === 'way') {  // update parentWays
      const prevNodes = new Set<EntityID>((previous as WayEntity | undefined)?.nodes);
      const currNodes = new Set<EntityID>((current as WayEntity | undefined)?.nodes);
      const removed = prevNodes.difference(currNodes);
      const added = currNodes.difference(prevNodes);

      // shallow copy whatever parentWays had in it before, and perform deletes/adds as needed
      for (const childID of removed) {
        const parentIDs = new Set<EntityID>( local.parentWays.get(childID) ?? base.parentWays.get(childID) ?? [] );
        parentIDs.delete(entity.id);
        parentWays.set(childID, parentIDs);
      }
      for (const childID of added) {
        const parentIDs = new Set<EntityID>( local.parentWays.get(childID) ?? base.parentWays.get(childID) ?? [] );
        parentIDs.add(entity.id);
        parentWays.set(childID, parentIDs);
      }

    } else if (entity.type === 'relation') {  // Update parentRels
      // diff only on the IDs since the same entity can be a member multiple times with different roles
      const prevMembers = new Set<EntityID>((previous as RelationEntity | undefined)?.members?.map(m => m.id));
      const currMembers = new Set<EntityID>((current as RelationEntity | undefined)?.members?.map(m => m.id));
      const removed = prevMembers.difference(currMembers);
      const added = currMembers.difference(prevMembers);

      // shallow copy whatever parentRels had in it before, and perform deletes/adds as needed
      for (const childID of removed) {
        const parentIDs = new Set<EntityID>( local.parentRels.get(childID) ?? base.parentRels.get(childID) ?? [] );
        parentIDs.delete(entity.id);
        parentRels.set(childID, parentIDs);
      }
      for (const childID of added) {
        const parentIDs = new Set<EntityID>( local.parentRels.get(childID) ?? base.parentRels.get(childID) ?? [] );
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
  _updateRebased(restoreIDs: Set<EntityID> | EntityID[] = []): void {
    const base = this.base;
    const local = this.local;

    let didChange = false;
    // Restore deleted nodes that were discovered to belong to a parentWay.
    for (const id of restoreIDs) {
      if (local.entities.has(id) && local.entities.get(id) === undefined) {  // was deleted
        local.entities.delete(id);  // "delete the delete", aka restore.
        didChange = true;
      }
    }
    if (didChange) {
      this.touch();
    }

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
  _updateGeometries(entityIDs: Iterable<EntityID>): void {
    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (!entity) continue;                  // entity was deleted
      if (entity.type === 'node') continue;   // nodes don't need this
      (entity as WayEntity | RelationEntity).updateGeometry(this);
    }
  }


  /**
   * _nodesFirst
   * Internal function, compare function to sort nodes first.
   */
  _nodesFirst(a: Entity, b: Entity): number {
    const aIsNode = (a.type === 'node');
    const bIsNode = (b.type === 'node');
    return (aIsNode && !bIsNode) ? -1 : (!aIsNode && bIsNode) ? 1 : 0;
  }

}
