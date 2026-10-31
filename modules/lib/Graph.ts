import { compareEntities, completeFrom } from './Difference.ts';
import { utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';
import type { DifferenceChange } from './Difference.ts';
import type { Extent } from '@rapid-sdk/math';
import type { Geometry } from './Geometry.ts';
import type { Iterable, OneOrMore } from '../util/iterable.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmWay } from '../data/types.ts';


/** Marks a journaled ID that had no local entry, so its value came from base */
const NOT_LOCAL = Symbol('not-local');

/** What a journaled ID held before a write: a local entity, a local deletion, or nothing local */
type Before = OsmEntity | undefined | typeof NOT_LOCAL;

/** What a base Graph and every Graph derived from it share */
interface GraphLineage {
  /** The Graph that recomputed geometry last */
  geometryWriter: Graph | null;
  /** IDs whose topology some Graph has changed, so answers about them can differ between Graphs */
  topologyChanged: Set<EntityID>;
}


/**
 * Properties object for a Graph
 */
export interface GraphProps {
  /** Unique string to identify this Graph */
  id: GraphID;
  /** Internal version of the Graph, can be used to detect changes */
  v: number;
}


/**
 * Internal cache structure used to store entities and their relationships
 */
export interface GraphCache {
  /** Map<entityID, OsmEntity> - stores all entities */
  entities: Map<EntityID, OsmEntity | undefined>;
  /** Map<entityID, Set<entityIDs>> - maps child IDs to parent Way IDs */
  parentWays: Map<EntityID, Set<EntityID>>;
  /** Map<entityID, Set<entityIDs>> - maps child IDs to parent Relation IDs */
  parentRels: Map<EntityID, Set<EntityID>>;
}


/**
 * A `Graph` is a special collection of OSM Entities.
 * Each graph contains a "base" state (uneditied) and "local" state (edited).
 * The graph also contains all the caches and methods needed to manage OSM topology.
 *
 * In previous versions of the code, `Graph` was written in an immutable style,
 * so that calls to `replace`/`remove`/`revert` would return a new `Graph`.
 * This became a performance concern, so now `Graphs` are transactional.
 * You can call these methods anytme to make modifications to the `Graph`,
 * but then you must call `commit` to update any Entities that rely on the `Graph`.
 *
 * Each Graph keeps a journal of the IDs it writes, so `commit` and `EditSystem` work from
 * what changed, not from everything the Graph has changed from base.
 * Graphs in the edit history are frozen: only a rebase's iD#2085 restores may change them.
 * @see design/graph-geometry.md
 *
 * Properties available:
 * - `id`    - Unique string to identify this Graph
 * - `v`     - Internal version of the Graph, can be used to detect changes
 * - `props` - Properties object
 */
export class Graph {

  /** Unique string identifier for this Graph */
  public id: GraphID;
  /** Global shared application context */
  public context: Context;
  /** Properties object (id, v) */
  public props: GraphProps;
  /** Whether this is the initial base Graph (vs a derived/edited Graph) */
  public isBaseGraph: boolean;
  /** Shared base cache for unedited entities (shared with all descendant Graphs) */
  public base: GraphCache;
  /** Local (edited) entity cache, cloned from the predecessor Graph on construction */
  public local: GraphCache;

  /** What each ID written since the last commit held before its first write */
  protected _pending: Map<EntityID, Before>;
  /** IDs written since this Graph was derived */
  protected _journal: Set<EntityID>;
  /** What each ID written since the savepoint began held before its first write, while one is active */
  protected _savepoint: Map<EntityID, Before> | null;
  /** Whether this Graph is in the edit history, so it may no longer change */
  protected _frozen: boolean;
  /** Shared by a base Graph and every Graph derived from it */
  protected _lineage: GraphLineage;


  /**
   * @param  otherOrContext  - copy another Graph, or pass application context
   * @param  propsOrEntities - optional properties or base Entities to include in the graph.
   */
  public constructor(otherOrContext: Graph | Context, propsOrEntities: OsmEntity[] | Partial<GraphProps> = {}) {
    this.id = '';  // put this first so debug inspect shows it first

    // A Graph derived from a predecessor Graph
    if (otherOrContext instanceof Graph) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this.props = {} as GraphProps;
      this.isBaseGraph = false;

      this.base = other.base;     // Base cache is shared among the chain of Graphs
      this.local = {              // Local data is a clone of the predecessor data
        entities:    new Map<EntityID, OsmEntity | undefined>(other.local.entities),  // shallow clone
        parentWays:  new Map<EntityID, Set<EntityID>>(other.local.parentWays),        // shallow clone
        parentRels:  new Map<EntityID, Set<EntityID>>(other.local.parentRels)         // shallow clone
      };

      // Uncommitted writes come along, so this Graph's first commit recomputes them.
      this._pending = new Map<EntityID, Before>(other._pending);
      this._lineage = other._lineage;

    // A fresh Graph
    } else {
      const context = otherOrContext as Context;
      this.context = context;
      this.props = {} as GraphProps;
      this.isBaseGraph = true;
      this._pending = new Map<EntityID, Before>();
      this._lineage = { geometryWriter: null, topologyChanged: new Set<EntityID>() };

      this.base = {
        entities:    new Map<EntityID, OsmEntity | undefined>(),
        parentWays:  new Map<EntityID, Set<EntityID>>(),
        parentRels:  new Map<EntityID, Set<EntityID>>()
      };
      this.local = {
        entities:    new Map<EntityID, OsmEntity | undefined>(),
        parentWays:  new Map<EntityID, Set<EntityID>>(),
        parentRels:  new Map<EntityID, Set<EntityID>>()
      };
    }

    this._journal = new Set<EntityID>();
    this._savepoint = null;
    this._frozen = false;

    // Deal with extra argument
    if (Array.isArray(propsOrEntities)) {
      const toRebase = propsOrEntities;
      this.rebase(toRebase);   // seed with base Entities, if provided

    } else {
      const props = propsOrEntities;
      Object.assign(this.props, structuredClone(props));  // override with passed in props
    }

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'g-' + this.context.next('graph');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;
  }


  /**
   * Remove all saved state and free memory.
   * Do not use the Graph after calling `destroy()`.
   */
  public destroy(): void {
    this.base = null!;
    this.local = null!;
    this._pending = null!;
    this._journal = null!;
    this._savepoint = null;
    this._lineage = null!;
    this.props = null!;
    this.context = null!;
  }


  /**
   * Unique string to identify this Graph.
   * @return  This graph's unique ID
   * @readonly
   */
  public get graphID(): string {
    return this.id;
  }

  /**
   * Internal version of the Graph, can be used to detect changes.
   * @return  Version counter
   * @readonly
   */
  public get v(): number {
    return this.props.v || 0;
  }

  /**
   * The 'key' includes both the id and the version
   * @return  Combined `id + version` key string
   * @readonly
   */
  public get key(): string {
    return `${this.id}v${this.v}`;
  }

  /**
   * Bump internal version number in place (typically, forcing a rerender)
   * Note that this version number always increases and is shared by all data elements.
   * We did it this way to avoid situations where you undo to a previous version
   *  you don't want it to increment it back to the same version and appear unchanged.
   * @see Rapid@9ac2776a
   * @return   this Graph
   */
  public touch(): Graph {
    this.props.v = this.context.next('v');
    return this;
  }

  /**
   * The IDs this Graph has written since it was derived (its journal).
   * It may hold IDs whose entity ended up unchanged.
   * @return  The journaled entity IDs
   * @readonly
   */
  public get changedIDs(): ReadonlySet<EntityID> {
    return this._journal;
  }

  /**
   * Whether this Graph has writes that `commit` hasn't processed yet.
   * @return  `true` if there are uncommitted writes
   * @readonly
   */
  public get hasPendingChanges(): boolean {
    return this._pending.size > 0;
  }

  /**
   * Whether this Graph is frozen (it's in the edit history, so it may no longer change).
   * @return  `true` if frozen
   * @readonly
   */
  public get isFrozen(): boolean {
    return this._frozen;
  }

  /**
   * The Graph of this lineage that recomputed geometry last. Geometry still lives on the entity
   * objects that every Graph shares, so their shapes are that Graph's (until step 4 of the design).
   * @return  The Graph, or `null` if none has yet
   * @readonly
   */
  public get geometryWriter(): Graph | null {
    return this._lineage.geometryWriter;
  }

  /**
   * Whether answers about an entity that depend on the Graph (its parents, its shape) are the same
   * in this Graph as in every other Graph of its lineage, so they may be memoized on the entity.
   * They aren't once any Graph has changed the entity's topology, or while this Graph has
   * uncommitted writes. (Step 4 of the design stores them per Graph instead.)
   * @param entityID - The entity's ID
   * @return `true` if answers about it may be memoized on the entity
   */
  public canShareAnswers(entityID: EntityID): boolean {
    return !this._pending.size && !this._lineage.topologyChanged.has(entityID);
  }


  /**
   * Gets an OsmEntity, searches the local cache first, then the base cache.
   * @param   entityID - The entityID to lookup
   * @return  OsmEntity from either local or base cache, or `undefined` if not found.
   */
  public hasEntity(entityID: EntityID): OsmEntity | undefined {
    const base = this.base.entities;
    const local = this.local.entities;
    return local.has(entityID) ? local.get(entityID) : base.get(entityID);
  }


  /**
   * Gets an OsmEntity, searches the local cache first, then the base cache.
   * (same as `hasEntity` but throws if not found)
   * @param   entityID - The entityID to lookup
   * @return  OsmEntity from either local or base cache
   * @throws  Will throw if the entity is not found
   */
  public entity(entityID: EntityID): OsmEntity {
    const entity = this.hasEntity(entityID);
    if (!entity) {
      throw new Error(`OsmEntity ${entityID} not found`);
    }
    return entity;
  }


  /**
   * Returns the geometry of an entity, as it is in this Graph.
   * Like `parentWays` and `childNodes`, it takes the entity, not its ID: callers with an ID use
   * `graph.geometry(graph.entity(id))`.
   * For now it returns the geometry stored on the entity, which every Graph holding that object
   * shares; step 4 of design/graph-geometry.md gives each Graph its own. Read geometry through this
   * method, so that change won't need the callers to change.
   * @param   entity - The entity to get the geometry of
   * @return  Its Geometry
   */
  public geometry(entity: OsmEntity): Geometry {
    return entity.geoms;
  }


  /**
   * Returns the extent (in WGS84 lon/lat) of an entity, as it is in this Graph.
   * Like `entity.extent()`, it may be `undefined` (a way without nodes, a relation without members).
   * @param   entity - The entity to get the extent of
   * @return  Its Extent, or `undefined`
   */
  public extent(entity: OsmEntity): Extent | undefined {
    return this.geometry(entity).orig?.extent;
  }


  /**
   * Makes an Array containing parent Ways for the given OsmEntity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The OsmEntity to get parentWays for
   * @return  Array of parent Ways
   * @throws  Will throw if any parent Way is not found
   */
  public parentWays(entity: OsmEntity): OsmWay[] {
    const base = this.base.parentWays;
    const local = this.local.parentWays;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set<EntityID>();
    return Array.from(parentIDs).map(parentID => this.entity(parentID) as OsmWay);
  }


  /**
   * Makes an Array containing parent Relations for the given OsmEntity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The OsmEntity to get parentRelations for
   * @return  Array of parent Relations
   * @throws  Will throw if any parent Relation is not found
   */
  public parentRelations(entity: OsmEntity): OsmRelation[] {
    const base = this.base.parentRels;
    const local = this.local.parentRels;
    const parentIDs = local.get(entity.id) ?? base.get(entity.id) ?? new Set<EntityID>();
    return Array.from(parentIDs).map(parentID => this.entity(parentID) as OsmRelation);
  }


  /**
   * Makes an Array containing child Nodes for the given OsmEntity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The OsmEntity to get childNodes for
   * @return  Array of child Nodes
   */
  public childNodes(entity: OsmWay): OsmNode[] {
    if (!entity.nodes) return [];  // not a way?
    return entity.nodes.map(nodeID => this.entity(nodeID) as OsmNode);
  }


  /**
   * Replace an OsmEntity in this Graph
   * @param   entities - entities to replace
   * @return  this Graph
   * @throws  Will throw if called on a base graph or a frozen graph
   */
  public replace(entities: OneOrMore<OsmEntity>): Graph {
    this._assertWritable('replace');

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (current === entity) continue;  // no change

      this._record(entityID);
      this.local.entities.set(entityID, entity);
      this._updateCaches(current, entity);
    }
    return this.touch();
  }


  /**
   * Remove an OsmEntity from this Graph
   * @param   entities - entities to remove
   * @return  this Graph
   * @throws  Will throw if called on a base graph or a frozen graph
   */
  public remove(entities: OneOrMore<OsmEntity>): Graph {
    this._assertWritable('remove');

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      const entityID = entity.id;
      const current = this.hasEntity(entityID);
      if (!current) continue;  // not in the graph

      this._record(entityID);
      this.local.entities.set(entityID, undefined);
      this._updateCaches(current, undefined);
    }
    return this.touch();
  }


  /**
   * Revert an OsmEntity back to whatever state it had in the base graph
   * @param   entityIDs - the entityIDs of the Entities to revert
   * @return  this Graph
   * @throws  Will throw if called on a base graph or a frozen graph
   */
  public revert(entityIDs: OneOrMore<EntityID>): Graph {
    this._assertWritable('revert');

    for (const entityID of utilIterable(entityIDs) as EntityID[]) {
      const original = this.base.entities.get(entityID);
      const current = this.hasEntity(entityID);
      if (current === original) continue;   // no change

      this._record(entityID);
      this.local.entities.delete(entityID);
      this._updateCaches(current, original);
    }
    return this.touch();
  }


  /**
   * Updates any Entities affected by the work in progress.
   * It works from the IDs written since the last commit, compared by value, so a write
   * of an equal copy changes nothing.
   * @return  this Graph
   */
  public commit(): Graph {
    if (!this._pending.size) return this;

    const changes = new Map<EntityID, DifferenceChange>();
    for (const [entityID, before] of this._pending) {
      const b = (before === NOT_LOCAL) ? this.base.entities.get(entityID) : before;
      const h = this.hasEntity(entityID);
      if (compareEntities(b, h)) {
        changes.set(entityID, { base: b, head: h });
      }
    }
    this._pending.clear();

    const closure = completeFrom(this, changes, true);   // true = only what needs new geometry
    const closureIDs = new Set<EntityID>(closure.keys());
    this._markTopologyChanged(closureIDs);
    this.recomputeGeometry(closureIDs);
    return this;
  }


  /**
   * Begins a savepoint: `rollbackToSavepoint` returns the Graph to how it is now.
   * `EditSystem` uses this around the actions of a perform, which may commit midway.
   * @throws  Will throw if the Graph has uncommitted writes, or is frozen
   */
  public beginSavepoint(): void {
    if (this._pending.size) {
      throw new Error(`Do not begin a savepoint on a graph with uncommitted writes`);
    }
    this._assertWritable('beginSavepoint');
    this._savepoint = new Map<EntityID, Before>();
  }


  /**
   * Returns the Graph to how it was when the savepoint began, and recomputes what that changes.
   * Only the Graph's entities are restored; the IDs stay in the journal.
   * @throws  Will throw if no savepoint is active
   */
  public rollbackToSavepoint(): void {
    const savepoint = this._savepoint;
    if (!savepoint) {
      throw new Error(`No savepoint to roll back to`);
    }

    const changes = new Map<EntityID, DifferenceChange>();
    for (const [entityID, before] of savepoint) {
      const current = this.hasEntity(entityID);
      let restored: OsmEntity | undefined;
      if (before === NOT_LOCAL) {
        restored = this.base.entities.get(entityID);
        this.local.entities.delete(entityID);
      } else {
        restored = before;
        this.local.entities.set(entityID, before);
      }
      if (current === restored) continue;   // e.g. created and removed again

      this._updateCaches(current, restored);
      changes.set(entityID, { base: current, head: restored });
    }

    this._pending.clear();
    savepoint.clear();
    const closureIDs = new Set<EntityID>(completeFrom(this, changes, true).keys());
    this._markTopologyChanged(closureIDs);
    this.recomputeGeometry(closureIDs);
    this.touch();
  }


  /**
   * Ends the savepoint, keeping the Graph as it is.
   */
  public endSavepoint(): void {
    this._savepoint = null;
  }


  /**
   * Freezes the Graph when it goes into the edit history: after this, `replace`, `remove`,
   * `revert` and `load` throw. Uncommitted writes are committed first.
   */
  public freeze(): void {
    this.commit();
    this._savepoint = null;
    this._frozen = true;
  }


  /**
   * Adds another Graph's journal to this one's.
   * Used when this Graph replaces the other one in the history (`commitAppend`).
   * @param other - The Graph whose journal to add
   */
  public absorbJournal(other: Graph): void {
    for (const entityID of other._journal) {
      this._journal.add(entityID);
    }
  }


  /**
   * Loads new Entities into the local Graph, obliterating any existing Entities.
   * Used when restoring history or entering/leaving walkthrough.
   * This is just a shortcut for doing a bunch of `replace`/`remove` calls.
   * (The Entities passed in may be undefined, in the case of deletion)
   * @param   entities - Entities to load into the Graph
   * @return  this Graph
   * @throws  Will throw if called on a base graph or a frozen graph
   */
  public load(entities: Record<EntityID, OsmEntity | undefined> = {}): Graph {
    this._assertWritable('load');

    const _loadOne = (entityID: EntityID, entity: OsmEntity | undefined): void => {
      const current = this.hasEntity(entityID);
      const replacement = entity || undefined;
      this._record(entityID);
      this.local.entities.set(entityID, replacement);
      this._updateCaches(current, replacement);
    };

    // we want to process the nodes first..
    for (const [entityID, entity] of Object.entries(entities)) {
      if ((entity as OsmEntity | undefined)?.type === 'node') {
        _loadOne(entityID, entity);
      }
    }
    for (const [entityID, entity] of Object.entries(entities)) {
      if ((entity as OsmEntity | undefined)?.type !== 'node') {
        _loadOne(entityID, entity);
      }
    }

    return this.commit().touch();
  }


  /**
   * Loads new Entities into the base graph.
   * This is used to merge newly-downloaded data into an existing stack of edits.
   * To external observers, it should appear as if these Graphs always contained the newly downloaded data.
   * Important: `rebase` should be called on the base graph
   * @param  entities - Entities to add to the base Graph
   * @param  stack - Stack of graphs that need updates after this rebase
   * @param  force - If `true`, always update, if `false` skip Entities that we've seen already
   * @return The IDs restored in each Graph of the stack (iD#2085), only for Graphs that restored any
   * @throws  Will throw if _not_ called on a base graph
   */
  public rebase(entities: OneOrMore<OsmEntity>, stack: Graph[] = [], force: boolean = false): Map<Graph, Set<EntityID>> {
//    if (!this.isBaseGraph) {
//      throw new Error(`Must call 'rebase' on a base graph`);
//    }

    const base = this.base;
    const head = stack.at(-1)?.local?.entities;
    const restoreIDs = new Set<EntityID>();
    const newIDs = new Set<EntityID>();
    const replaced: OsmEntity[] = [];   // older copies a forced rebase replaced

    const arr = [...utilIterable(entities)].sort(this._nodesFirst);
    for (const entity of arr) {
      if (!entity.visible || (!force && base.entities.has(entity.id))) continue;

      // Merge data into the base graph
      // (When forced, this may replace an older copy, so its caches need to be updated too)
      const previous = base.entities.get(entity.id);
      base.entities.set(entity.id, entity);
      this._updateCaches(previous, entity, base);  // note 'base' here
      newIDs.add(entity.id);
      if (previous) {
        replaced.push(previous);
      }

      // A weird thing we have to watch out for.. iD#2085
      // Sometimes an edit can remove a node, then we download more information and realize that
      // that Node was shared with another way.  If we detect this condition, restore the node.
      // (A "delete" is stored as: setting that entity = `undefined`)
      // This doesn't apply to a way the user deleted: its nodes were deleted along with it.
      const wayDeleted = head?.has(entity.id) && head.get(entity.id) === undefined;
      if (head && entity.type === 'way' && !wayDeleted) {
        for (const id of (entity as OsmWay).nodes) {
          if (head.has(id) && head.get(id) === undefined) {  // was deleted
            restoreIDs.add(id);
          }
        }
      }
    }

    const restored = new Map<Graph, Set<EntityID>>();
    for (const graph of stack) {
      const ids = graph._updateRebased(restoreIDs);
      if (ids.size) {
        restored.set(graph, ids);
      }
    }

    this._clearStaleAnswers(newIDs, replaced);
    this.recomputeGeometry(newIDs);
    return restored;
  }


  /**
   * Internal function, clears the answers memoized on base entities whose topology a rebase changed:
   * the children and members of what arrived (and of the older copies it replaced), and the ways and
   * relations that contain it.
   * An arrived way or relation with a child or member whose topology a graph changed (a node the
   * user moved) can differ between graphs too, so it joins the lineage's `topologyChanged` set.
   * @param arrivedIDs - IDs of the entities the rebase added to the base
   * @param replaced - The older copies that a forced rebase replaced
   */
  protected _clearStaleAnswers(arrivedIDs: Set<EntityID>, replaced: OsmEntity[]): void {
    const base = this.base;
    const topologyChanged = this._lineage.topologyChanged;
    const stale = new Set<EntityID>();

    const addChildren = (entity: OsmEntity | undefined): boolean => {
      let touchesChanged = false;
      const childIDs = [
        ...((entity as OsmWay | undefined)?.nodes ?? []),
        ...((entity as OsmRelation | undefined)?.members ?? []).map(member => member.id)
      ];
      for (const childID of childIDs) {
        stale.add(childID);
        if (topologyChanged.has(childID)) {
          touchesChanged = true;
        }
      }
      return touchesChanged;
    };

    const addParents = (entityID: EntityID): void => {
      for (const wayID of base.parentWays.get(entityID) ?? []) {
        if (stale.has(wayID)) continue;
        stale.add(wayID);
        addParents(wayID);   // a way's parent relations include its shape
      }
      for (const relationID of base.parentRels.get(entityID) ?? []) {
        if (stale.has(relationID)) continue;
        stale.add(relationID);
        addParents(relationID);   // a relation's shape includes its member relations'
      }
    };

    for (const entity of replaced) {
      addChildren(entity);
    }
    for (const entityID of arrivedIDs) {
      if (addChildren(base.entities.get(entityID))) {
        topologyChanged.add(entityID);
      }
      addParents(entityID);
    }

    for (const entityID of stale) {
      base.entities.get(entityID)?.clearMemos();
    }
  }


  /**
   * Internal function, records that a commit changed the topology of these IDs, for every Graph
   * of the lineage: answers about them aren't memoized on the shared entities any more.
   * @param entityIDs - The IDs in a commit's closure
   */
  protected _markTopologyChanged(entityIDs: Set<EntityID>): void {
    const topologyChanged = this._lineage.topologyChanged;
    for (const entityID of entityIDs) {
      topologyChanged.add(entityID);
    }
  }


  /**
   * Internal function, used to update internal caches after an OsmEntity update.
   * @param  previous  - The previous OsmEntity, may be undefined if new
   * @param  current   - The current OsmEntity, may be undefined if delete
   * @param  caches    - which caches to update, defaults to the local caches
   */
  protected _updateCaches(previous: OsmEntity | undefined, current: OsmEntity | undefined, caches?: GraphCache): void {
    const base = this.base;
    const local = this.local;
    const which = caches ?? local;
    const parentWays = which.parentWays;
    const parentRels = which.parentRels;

    const entity = current ?? previous;
    if (!entity) return;   // Either current or previous must be set

    if (entity.type === 'way') {  // update parentWays
      const prevNodes = new Set<EntityID>((previous as OsmWay | undefined)?.nodes);
      const currNodes = new Set<EntityID>((current as OsmWay | undefined)?.nodes);
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
      const prevMembers = new Set<EntityID>((previous as OsmRelation | undefined)?.members?.map(m => m.id));
      const currMembers = new Set<EntityID>((current as OsmRelation | undefined)?.members?.map(m => m.id));
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
   * Internal function, used to update a graph following a `rebase` (base graph has changed).
   * Check local `parentWays` and `parentRels` caches and make sure they are consistent
   *  with the data in the base caches.
   * A restore is the one write a frozen Graph accepts. Other Graphs journal it, so their
   *  next commit and `EditSystem`'s next emit include it.
   * @param restoreIDs - IDs of deleted nodes to restore, if this Graph deleted them
   * @return The IDs this Graph restored
   */
  protected _updateRebased(restoreIDs: Set<EntityID> | EntityID[] = []): Set<EntityID> {
    const base = this.base;
    const local = this.local;

    const restored = new Set<EntityID>();
    // Restore deleted nodes that were discovered to belong to a parentWay.
    for (const id of restoreIDs) {
      if (local.entities.has(id) && local.entities.get(id) === undefined) {  // was deleted
        if (!this._frozen) {
          this._record(id);
        }
        local.entities.delete(id);  // "delete the delete", aka restore.
        restored.add(id);
      }
    }
    if (restored.size) {
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

    return restored;
  }


  /**
   * Recomputes the geometry of the given ways and relations (nodes keep their own).
   * Ways go first, then relations with their member relations before them,
   * so a relation is never built from a member's stale shape.
   * This needs to be called after all `_updateCaches` calls have finished.
   * @param entityIDs - IDs of the entities to recompute
   */
  public recomputeGeometry(entityIDs: Iterable<EntityID>): void {
    this._lineage.geometryWriter = this;
    const relations = new Map<EntityID, OsmRelation>();
    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (!entity) continue;                  // entity was deleted
      if (entity.type === 'node') continue;   // nodes don't need this
      if (entity.type === 'relation') {
        relations.set(entityID, entity as OsmRelation);
      } else {
        entity.updateGeometry(this);
      }
    }

    // Multipolygons first: their shape comes only from their member ways, and other relations
    // (even in a cycle with them) take their parts.
    // Then members first. Marking a relation done before its members stops at cycles.
    // (Relations other than multipolygons gather their leaf members' parts, so for them
    // the order matters less.)
    const done = new Set<EntityID>();
    for (const relation of relations.values()) {
      if (relation.isMultipolygon()) {
        relation.updateGeometry(this);
        done.add(relation.id);
      }
    }

    const visit = (relation: OsmRelation): void => {
      if (done.has(relation.id)) return;
      done.add(relation.id);
      for (const member of relation.members) {
        const child = relations.get(member.id);
        if (child) visit(child);
      }
      relation.updateGeometry(this);
    };

    for (const relation of relations.values()) {
      visit(relation);
    }
  }


  /**
   * Internal function, records a write to an ID before it happens:
   * what it held before, for the next commit and the savepoint, and the ID in the journal.
   * @param entityID - The ID about to be written
   */
  protected _record(entityID: EntityID): void {
    const local = this.local.entities;
    const before: Before = local.has(entityID) ? local.get(entityID) : NOT_LOCAL;

    if (!this._pending.has(entityID)) {
      this._pending.set(entityID, before);
    }
    if (this._savepoint && !this._savepoint.has(entityID)) {
      this._savepoint.set(entityID, before);
    }
    this._journal.add(entityID);
  }


  /**
   * Internal function, throws if this Graph may not be written to.
   * @param method - The name of the method being called, for the error message
   * @throws  Will throw if this is a base graph or a frozen graph
   */
  protected _assertWritable(method: string): void {
    if (this.isBaseGraph) {
      throw new Error(`Do not call '${method}' on a base graph`);
    }
    if (this._frozen) {
      throw new Error(`Do not call '${method}' on a frozen graph`);
    }
  }


  /**
   * Internal function, compare function to sort nodes first.
   * @param a - First entity to compare
   * @param b - Second entity to compare
   * @return  Negative, zero, or positive per standard sort comparator semantics
   */
  protected _nodesFirst(a: OsmEntity, b: OsmEntity): number {
    const aIsNode = (a.type === 'node');
    const bIsNode = (b.type === 'node');
    return (aIsNode && !bIsNode) ? -1 : (!aIsNode && bIsNode) ? 1 : 0;
  }

}
