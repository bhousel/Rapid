import { compareEntities, completeFrom } from './Difference.ts';
import { utilIterable } from '../util/iterable.ts';
import { vectorDiff, vectorEmpty, vectorForEach, vectorGet, vectorSet } from './PersistentVector.ts';

import type { Context } from '../Context.ts';
import type { DifferenceChange } from './Difference.ts';
import type { Extent } from '@rapid-sdk/math';
import type { Geometry } from './Geometry.ts';
import type { Iterable, OneOrMore } from '../util/iterable.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmWay } from '../data/types.ts';
import type { PersistentVector, VectorOwner } from './PersistentVector.ts';


/** Marks a journaled ID that had no local entry, so its value came from base */
const NOT_LOCAL = Symbol('not-local');

/** What a journaled ID held before a write: a local entity, a local deletion, or nothing local */
type Before = OsmEntity | undefined | typeof NOT_LOCAL;

/** What a base Graph and every Graph derived from it share */
interface GraphLineage {
  /** The base Graph: the only one that writes the geometry stored on base objects */
  baseGraph: Graph;
  /** IDs whose topology some Graph has changed, so answers about them can differ between Graphs */
  topologyChanged: Set<EntityID>;
  /** Counts the base changes that other Graphs may need to catch up with (`syncWithBase`) */
  changeCount: number;
  /** IDs whose base shape changed near something a Graph has written, with the last `changeCount` that did */
  baseChanged: Map<EntityID, number>;
  /** The `changeCount` of the last schema change that changed what counts as an area */
  areaCheckCount: number;
  /** The slot of each ID that some Graph has a record for, given out on its first write */
  slots: Map<EntityID, number>;
  /** The ID of each slot */
  slotIDs: EntityID[];
}

/**
 * What one Graph says differently from base about one ID. Records are never changed once stored:
 * a write stores a new one.
 */
interface GraphRecord {
  /** Whether this Graph has its own version of the entity (written, deleted or loaded) */
  isLocal: boolean;
  /** This Graph's version of the entity, `undefined` if it deleted it (only when `isLocal`) */
  entity: OsmEntity | undefined;
  /** Ways that this Graph has its own version of, which contain this ID */
  parentWays: EntityID[] | null;
  /** Relations that this Graph has its own version of, which have this ID as a member */
  parentRels: EntityID[] | null;
  /** This Graph's shape of the way or relation, stored by its commits (else it's the base object's) */
  geometry: Geometry | null;
}


/**
 * What a `rebase` changed besides the entities it was given
 */
export interface RebaseResult {
  /** The IDs restored in each Graph of the stack (iD#2085), only for Graphs that restored any */
  restored: Map<Graph, Set<EntityID>>;
  /** Base ways and relations whose shape changed because they contain what arrived */
  reshapedIDs: Set<EntityID>;
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
 * The base is shared by every Graph derived from it (a "lineage"). Each Graph keeps what it says
 * differently from base in records, stored in a persistent vector indexed by a slot per ID: deriving
 * a Graph shares the vector (O(1)), a write copies only the path to its slot, and comparing two
 * Graphs skips what they share. A Graph's parent ways (and relations) of an ID are base's, except
 * those it has its own version of, plus its own that contain the ID.
 *
 * Shapes follow the same rule: a commit stores the shapes of what it changed (and of the ways and
 * relations that contain it) in this Graph's records, and only the base Graph stores shapes on the
 * base objects. So every Graph answers `geometry()` for itself, and undo needs nothing recomputed.
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

  /** What this Graph says differently from base, by slot (shared with the Graph it derives from) */
  protected _records: PersistentVector<GraphRecord>;
  /** This Graph's owner token: the vector nodes it made, and still owns, it changes in place */
  protected _owner: VectorOwner;

  /** What each ID written since the last commit held before its first write */
  protected _pending: Map<EntityID, Before>;
  /** IDs written since this Graph was derived */
  protected _journal: Set<EntityID>;
  /** The records when the savepoint began, while one is active */
  protected _savepoint: PersistentVector<GraphRecord> | null;
  /** The `_syncedCount` when the savepoint began: a rollback goes back to shapes that old */
  protected _savepointSyncedCount: number;
  /** Whether this Graph is in the edit history, so it may no longer change */
  protected _frozen: boolean;
  /** Shared by a base Graph and every Graph derived from it */
  protected _lineage: GraphLineage;
  /** The lineage's `changeCount` when this Graph last caught up with the base */
  protected _syncedCount: number;


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

      // The records are shared too. Neither Graph may change them in place any more:
      // both get new owner tokens, so their next writes copy what they change.
      this._records = other._records;
      this._owner = {};
      other._owner = {};

      // Uncommitted writes come along, so this Graph's first commit recomputes them.
      this._pending = new Map<EntityID, Before>(other._pending);
      this._lineage = other._lineage;
      this._syncedCount = other._syncedCount;   // its shapes are as up to date as the other's

    // A fresh Graph
    } else {
      const context = otherOrContext as Context;
      this.context = context;
      this.props = {} as GraphProps;
      this.isBaseGraph = true;
      this._pending = new Map<EntityID, Before>();
      this._lineage = {
        baseGraph: this,
        topologyChanged: new Set<EntityID>(),
        changeCount: 0,
        baseChanged: new Map<EntityID, number>(),
        areaCheckCount: 0,
        slots: new Map<EntityID, number>(),
        slotIDs: []
      };

      this.base = {
        entities:    new Map<EntityID, OsmEntity | undefined>(),
        parentWays:  new Map<EntityID, Set<EntityID>>(),
        parentRels:  new Map<EntityID, Set<EntityID>>()
      };
      this._records = vectorEmpty<GraphRecord>();
      this._owner = {};
      this._syncedCount = 0;
    }

    this._journal = new Set<EntityID>();
    this._savepoint = null;
    this._savepointSyncedCount = 0;
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
    this._records = null!;
    this._owner = null!;
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
   * Whether answers about an entity that depend on the Graph (its parents, its shape) are the same
   * in this Graph as in every other Graph of its lineage, so they may be memoized on the entity.
   * They aren't once any Graph has changed the entity's topology, or while this Graph has
   * uncommitted writes. (Step 7 of the design stores them per Graph instead.)
   * @param entityID - The entity's ID
   * @return `true` if answers about it may be memoized on the entity
   */
  public canShareAnswers(entityID: EntityID): boolean {
    return !this._pending.size && !this._lineage.topologyChanged.has(entityID);
  }


  /**
   * Gets an OsmEntity: this Graph's own version if it has one, else the base's.
   * @param   entityID - The entityID to lookup
   * @return  OsmEntity from this Graph's records or the base, or `undefined` if not found.
   */
  public hasEntity(entityID: EntityID): OsmEntity | undefined {
    const record = this._getRecord(entityID);
    return record?.isLocal ? record.entity : this.base.entities.get(entityID);
  }


  /**
   * Whether this Graph has its own version of an entity (written, deleted or loaded), instead of
   * the base's.
   * @param   entityID - The entityID to check
   * @return  `true` if this Graph has its own version
   */
  public isLocal(entityID: EntityID): boolean {
    return this._getRecord(entityID)?.isLocal ?? false;
  }


  /**
   * Makes a Map of the entities this Graph has its own version of (`undefined` where it deleted
   * one). It walks every record: O(edits), so don't call it in a hot path.
   * @return  Map of entityID to this Graph's version
   */
  public localEntities(): Map<EntityID, OsmEntity | undefined> {
    const slotIDs = this._lineage.slotIDs;
    const result = new Map<EntityID, OsmEntity | undefined>();
    vectorForEach(this._records, (slot, record) => {
      if (record.isLocal) {
        result.set(slotIDs[slot], record.entity);
      }
    });
    return result;
  }


  /**
   * Returns the IDs whose entity may differ between this Graph and another one: those where
   * either has its own version that the other doesn't share. For Graphs of the same lineage this
   * compares their records, skipping what they share: O(changes). Otherwise it lists both
   * Graphs' own versions.
   * @param   other - The other Graph, or `null` to list this Graph's own versions
   * @return  The IDs
   */
  public diffIDs(other: Graph | null): Set<EntityID> {
    const result = new Set<EntityID>();
    if (other && other._lineage === this._lineage) {
      const slotIDs = this._lineage.slotIDs;
      vectorDiff(other._records, this._records, (slot, a, b) => {
        if ((a?.isLocal ?? false) !== (b?.isLocal ?? false) || a?.entity !== b?.entity) {
          result.add(slotIDs[slot]);
        }
      });
      return result;
    }

    for (const entityID of this.localEntities().keys()) {
      result.add(entityID);
    }
    for (const entityID of other?.localEntities().keys() ?? []) {
      result.add(entityID);
    }
    return result;
  }


  /**
   * Gets an OsmEntity: this Graph's own version if it has one, else the base's.
   * (same as `hasEntity` but throws if not found)
   * @param   entityID - The entityID to lookup
   * @return  OsmEntity from this Graph's records or the base
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
   * A node's geometry is its own. A way or a relation has this Graph's shape if one of its commits
   * stored one (it changed the entity, or something in it), else the shape the base built.
   * (This Graph's own copy that equals the base's, by value, changed nothing: it has the base's shape.)
   * Uncommitted writes are committed first, so the answer is always current.
   * @param   entity - The entity to get the geometry of (this Graph's version of it)
   * @return  Its Geometry
   */
  public geometry(entity: OsmEntity): Geometry {
    if (entity.type === 'node') return entity.geoms;

    if (this._pending.size) {
      this.commit();
    }
    const record = this._getRecord(entity.id);
    if (record?.geometry) return record.geometry;
    const baseEntity = record?.isLocal ? this.base.entities.get(entity.id) : entity;
    return (baseEntity ?? entity).baseGeometry;
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
    return this._parents(this.base.parentWays.get(entity.id), this._getRecord(entity.id)?.parentWays) as OsmWay[];
  }


  /**
   * Makes an Array containing parent Relations for the given OsmEntity.
   * Makes a shallow copy (i.e. the Array is new, but the Entities in it are references)
   * @param   entity - The OsmEntity to get parentRelations for
   * @return  Array of parent Relations
   * @throws  Will throw if any parent Relation is not found
   */
  public parentRelations(entity: OsmEntity): OsmRelation[] {
    return this._parents(this.base.parentRels.get(entity.id), this._getRecord(entity.id)?.parentRels) as OsmRelation[];
  }


  /**
   * Internal function, gathers parents: base's, where this Graph's own version of a parent counts
   * instead of base's (so it stays in base's order), then this Graph's own new parents.
   * Keeping base's order matters: some callers depend on it (e.g. the first multipolygon parent).
   * @param   baseIDs - The base's parent IDs
   * @param   localIDs - This Graph's own parents that contain the child
   * @return  The parent entities
   * @throws  Will throw if any parent is not found
   */
  protected _parents(baseIDs: Set<EntityID> | undefined, localIDs: EntityID[] | null | undefined): OsmEntity[] {
    const result: OsmEntity[] = [];
    if (baseIDs) {
      const baseEntities = this.base.entities;
      const hasRecords = this._records.root !== null;
      for (const parentID of baseIDs) {
        const record = hasRecords ? this._getRecord(parentID) : undefined;
        let parent: OsmEntity | undefined;
        if (record?.isLocal) {
          // this Graph's own version of the parent counts instead, if it still contains the child
          if (!localIDs?.includes(parentID)) continue;
          parent = record.entity;
        } else {
          parent = baseEntities.get(parentID);
        }
        if (!parent) {
          throw new Error(`OsmEntity ${parentID} not found`);
        }
        result.push(parent);
      }
    }
    if (localIDs) {
      for (const parentID of localIDs) {
        if (baseIDs?.has(parentID)) continue;   // already in base's order
        result.push(this.entity(parentID));
      }
    }
    return result;
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

      this._setLocal(entityID, true, entity);
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

      this._setLocal(entityID, true, undefined);
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
      if (!this.isLocal(entityID)) continue;   // no change

      this._setLocal(entityID, false, undefined);
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

    // Keep the records as they are. A new owner token makes the writes after this copy what they
    // change, so nothing changes the kept records in place.
    this._savepoint = this._records;
    this._savepointSyncedCount = this._syncedCount;
    this._owner = {};
  }


  /**
   * Returns the Graph to how it was when the savepoint began: its entities, parent lists and
   * shapes, all from the records kept then. The IDs stay in the journal.
   * The savepoint stays active, at the Graph as it is now.
   * @throws  Will throw if no savepoint is active
   */
  public rollbackToSavepoint(): void {
    const savepoint = this._savepoint;
    if (!savepoint) {
      throw new Error(`No savepoint to roll back to`);
    }

    this._records = savepoint;
    this._syncedCount = this._savepointSyncedCount;   // so it catches up again, if the base changed since
    this._owner = {};
    this._pending.clear();
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
      this._setLocal(entityID, true, entity || undefined);
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
   * @return What the rebase changed besides the entities themselves (see `RebaseResult`)
   * @throws  Will throw if _not_ called on a base graph
   */
  public rebase(entities: OneOrMore<OsmEntity>, stack: Graph[] = [], force: boolean = false): RebaseResult {
//    if (!this.isBaseGraph) {
//      throw new Error(`Must call 'rebase' on a base graph`);
//    }

    const base = this.base;
    const head = stack.at(-1);
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
      this._updateBaseCaches(previous, entity);
      newIDs.add(entity.id);
      if (previous) {
        replaced.push(previous);
      }

      // A weird thing we have to watch out for.. iD#2085
      // Sometimes an edit can remove a node, then we download more information and realize that
      // that Node was shared with another way.  If we detect this condition, restore the node.
      // (A "delete" is stored as: setting that entity = `undefined`)
      // This doesn't apply to a way the user deleted: its nodes were deleted along with it.
      const wayDeleted = head?._isDeleted(entity.id);
      if (head && entity.type === 'way' && !wayDeleted) {
        for (const id of (entity as OsmWay).nodes) {
          if (head._isDeleted(id)) {
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

    // The ways and relations that contain what arrived change shape too
    // (e.g. a relation whose members arrive in a later tile).
    const containers = this._clearStaleAnswers(newIDs, replaced);
    const reshapedIDs = containers.difference(newIDs);
    const rebasedIDs = newIDs.union(containers);
    this._noteBaseChange(rebasedIDs, false);   // first: it decides which answers may be memoized
    this._lineage.baseGraph.recomputeGeometry(rebasedIDs);   // shapes on base objects are the base's

    // A frozen graph doesn't journal its restores, so nothing would rebuild the shapes that contain
    // the restored nodes: it does that now, with the base's shapes current.
    for (const [graph, restoredIDs] of restored) {
      if (graph._frozen) {
        graph._recomputeWithContainers(restoredIDs);
      }
    }
    return { restored: restored, reshapedIDs: reshapedIDs };
  }


  /**
   * Rebuilds the base shape of every way that flipped between line and area, after a schema change
   * changed what counts as an area, and of the relations that contain it. Other Graphs check their
   * own shapes when they catch up (`syncWithBase`).
   * Important: call it on the base graph
   * @return The IDs whose base shape was rebuilt
   */
  public checkAreas(): Set<EntityID> {
    const flipped = new Set<EntityID>();
    for (const [entityID, entity] of this.base.entities) {
      if (entity?.type === 'way' && this._isFlipped(entity as OsmWay, entity.baseGeometry)) {
        flipped.add(entityID);
      }
    }

    const reshapedIDs = flipped.union(this._baseContainers(flipped));
    this._noteBaseChange(reshapedIDs, true);   // first: it decides which answers may be memoized
    this._lineage.baseGraph.recomputeGeometry(reshapedIDs);
    return reshapedIDs;
  }


  /**
   * Brings this Graph's shapes up to date with what changed in the base since it last did: the shapes
   * it keeps of its own that depend on what a rebase brought (a downloaded way through a node the
   * user moved, an edited relation gaining members), and its ways that flipped between line and area
   * after a schema change. Shapes it doesn't keep are the base's, which are up to date already.
   * `EditSystem` calls it for stable and staging after a merge or a schema change, and for any other
   * Graph it keeps when that Graph becomes current (see "Rebase" in `design/graph-geometry.md`).
   * @return The IDs whose shape this Graph rebuilt
   */
  public syncWithBase(): Set<EntityID> {
    const lineage = this._lineage;
    const synced = this._syncedCount;
    if (this.isBaseGraph || synced === lineage.changeCount) return new Set<EntityID>();

    const ids = new Set<EntityID>();
    for (const [entityID, count] of lineage.baseChanged) {
      if (count > synced && this._keepsShapeNear(entityID)) {
        ids.add(entityID);
      }
    }
    if (synced < lineage.areaCheckCount) {
      const slotIDs = lineage.slotIDs;
      vectorForEach(this._records, (slot, record) => {
        const entity = this.hasEntity(slotIDs[slot]);
        if (record.geometry && entity?.type === 'way' && this._isFlipped(entity as OsmWay, record.geometry)) {
          ids.add(entity.id);
        }
      });
    }
    this._syncedCount = lineage.changeCount;
    return ids.size ? this._recomputeWithContainers(ids) : ids;
  }


  /**
   * Internal function, rebuilds the shapes of these IDs and of this Graph's ways and relations that
   * contain them, recursively.
   * @param entityIDs - The IDs
   * @return The IDs whose shape was rebuilt (and nodes among `entityIDs`, which keep their own)
   */
  protected _recomputeWithContainers(entityIDs: Set<EntityID>): Set<EntityID> {
    const result = new Set<EntityID>(entityIDs);
    const addParents = (entity: OsmEntity): void => {
      for (const parent of [...this.parentWays(entity), ...this.parentRelations(entity)]) {
        if (result.has(parent.id)) continue;
        result.add(parent.id);
        addParents(parent);
      }
    };
    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (entity) addParents(entity);
    }

    this.recomputeGeometry(result);
    return result;
  }


  /**
   * Internal function, records that the base changed the shapes of these IDs, for the Graphs that
   * keep shapes of their own near them. Only IDs near something a Graph has written count (it or a
   * child or member has a slot); usually there are none, and nothing needs to catch up.
   * Answers about those IDs can differ between Graphs now (e.g. a node arrives that a Graph had
   * deleted, so that Graph's way through it differs from the base's), so they join the lineage's
   * `topologyChanged` set. Call this before the base rebuilds its shapes, which memoizes answers.
   * @param entityIDs - The IDs whose base shape changed
   * @param areasChanged - `true` after a schema change: every Graph checks its own shapes for flips
   */
  protected _noteBaseChange(entityIDs: Set<EntityID>, areasChanged: boolean): void {
    const lineage = this._lineage;
    const slots = lineage.slots;
    const count = lineage.changeCount + 1;

    let isNear = false;
    for (const entityID of entityIDs) {
      const entity = this.base.entities.get(entityID);
      if (slots.has(entityID) || this._childIDs(entity).some(childID => slots.has(childID))) {
        lineage.baseChanged.set(entityID, count);
        lineage.topologyChanged.add(entityID);
        isNear = true;
      }
    }
    if (!isNear && !areasChanged) return;

    lineage.changeCount = count;
    lineage.baseGraph._syncedCount = count;   // the base's shapes are always current
    if (areasChanged) {
      lineage.areaCheckCount = count;
    }
  }


  /**
   * Internal function, whether this Graph keeps something of its own that an ID's shape depends on:
   * a record for the ID itself, or for one of its children or members.
   * @param entityID - The ID
   * @return `true` if this Graph's shape of it may differ from the base's
   */
  protected _keepsShapeNear(entityID: EntityID): boolean {
    if (this._getRecord(entityID)) return true;
    return this._childIDs(this.hasEntity(entityID)).some(childID => !!this._getRecord(childID));
  }


  /**
   * Internal function, whether a way's stored shape is a line where it should be an area, or the other
   * way around (what counts as an area comes from the schema).
   * @param way - The way
   * @param geometry - Its stored shape
   * @return `true` if the shape is the wrong kind
   */
  protected _isFlipped(way: OsmWay, geometry: Geometry): boolean {
    const type = geometry.parts[0]?.type;
    if (!type) return false;   // no shape, e.g. a way whose nodes aren't loaded
    return (type === 'Polygon') !== (way.isArea() && way.isClosed());
  }


  /**
   * Internal function, the IDs of an entity's nodes (a way) or members (a relation).
   * @param entity - The entity, or `undefined`
   * @return The child IDs
   */
  protected _childIDs(entity: OsmEntity | undefined): EntityID[] {
    if (entity?.type === 'way') return (entity as OsmWay).nodes;
    if (entity?.type === 'relation') return (entity as OsmRelation).members.map(member => member.id);
    return [];
  }


  /**
   * Internal function, the base's ways and relations that contain these IDs, recursively.
   * @param entityIDs - The IDs
   * @return The IDs of what contains them (not the IDs themselves, unless they contain each other)
   */
  protected _baseContainers(entityIDs: Iterable<EntityID>): Set<EntityID> {
    const base = this.base;
    const result = new Set<EntityID>();
    const addParents = (entityID: EntityID): void => {
      for (const wayID of base.parentWays.get(entityID) ?? []) {
        if (result.has(wayID)) continue;
        result.add(wayID);
        addParents(wayID);   // a way's parent relations include its shape
      }
      for (const relationID of base.parentRels.get(entityID) ?? []) {
        if (result.has(relationID)) continue;
        result.add(relationID);
        addParents(relationID);   // a relation's shape includes its member relations'
      }
    };
    for (const entityID of entityIDs) {
      addParents(entityID);
    }
    return result;
  }


  /**
   * Internal function, clears the answers memoized on base entities whose topology a rebase changed:
   * the children and members of what arrived (and of the older copies it replaced), and the ways and
   * relations that contain it.
   * An arrived way or relation with a child or member whose topology a graph changed (a node the
   * user moved) can differ between graphs too, so it joins the lineage's `topologyChanged` set.
   * @param arrivedIDs - IDs of the entities the rebase added to the base
   * @param replaced - The older copies that a forced rebase replaced
   * @return The IDs of the ways and relations that contain what arrived
   */
  protected _clearStaleAnswers(arrivedIDs: Set<EntityID>, replaced: OsmEntity[]): Set<EntityID> {
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

    for (const entity of replaced) {
      addChildren(entity);
    }
    for (const entityID of arrivedIDs) {
      if (addChildren(base.entities.get(entityID))) {
        topologyChanged.add(entityID);
      }
    }
    const containers = this._baseContainers(arrivedIDs);

    for (const entityID of stale.union(containers)) {
      base.entities.get(entityID)?.clearMemos();
    }
    return containers;
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
   * Internal function, used to update the base caches (parent ways and relations) after a base
   * entity changed in a rebase.
   * @param  previous  - The previous OsmEntity, may be undefined if new
   * @param  current   - The current OsmEntity
   */
  protected _updateBaseCaches(previous: OsmEntity | undefined, current: OsmEntity): void {
    const base = this.base;

    if (current.type === 'way') {  // update parentWays
      const prevNodes = new Set<EntityID>((previous as OsmWay | undefined)?.nodes);
      const currNodes = new Set<EntityID>((current as OsmWay).nodes);
      for (const childID of prevNodes.difference(currNodes)) {
        base.parentWays.get(childID)?.delete(current.id);
      }
      for (const childID of currNodes.difference(prevNodes)) {
        let parentIDs = base.parentWays.get(childID);
        if (!parentIDs) {
          parentIDs = new Set<EntityID>();
          base.parentWays.set(childID, parentIDs);
        }
        parentIDs.add(current.id);
      }

    } else if (current.type === 'relation') {  // Update parentRels
      // diff only on the IDs since the same entity can be a member multiple times with different roles
      const prevMembers = new Set<EntityID>((previous as OsmRelation | undefined)?.members?.map(m => m.id));
      const currMembers = new Set<EntityID>((current as OsmRelation).members.map(m => m.id));
      for (const childID of prevMembers.difference(currMembers)) {
        base.parentRels.get(childID)?.delete(current.id);
      }
      for (const childID of currMembers.difference(prevMembers)) {
        let parentIDs = base.parentRels.get(childID);
        if (!parentIDs) {
          parentIDs = new Set<EntityID>();
          base.parentRels.set(childID, parentIDs);
        }
        parentIDs.add(current.id);
      }
    }
  }


  /**
   * Internal function, used to update a graph following a `rebase` (base graph has changed).
   * Parent ways and relations need nothing: they're base's plus this Graph's own, so they follow
   * the base. Only iD#2085 restores change this Graph.
   * A restore is the one write a frozen Graph accepts. Other Graphs journal it, so their
   *  next commit and `EditSystem`'s next emit include it.
   * @param restoreIDs - IDs of deleted nodes to restore, if this Graph deleted them
   * @return The IDs this Graph restored
   */
  protected _updateRebased(restoreIDs: Set<EntityID> | EntityID[] = []): Set<EntityID> {
    const restored = new Set<EntityID>();
    // Restore deleted nodes that were discovered to belong to a parentWay.
    for (const id of restoreIDs) {
      if (this._isDeleted(id)) {
        this._setLocal(id, false, undefined, !this._frozen);  // "delete the delete", aka restore.
        restored.add(id);
      }
    }
    if (restored.size) {
      this.touch();
    }
    return restored;
  }


  /**
   * Internal function, sets whether this Graph has its own version of an entity, and which,
   * and keeps its own parent lists in step.
   * @param entityID - The entity's ID
   * @param isLocal - `true` for this Graph's own version, `false` to go back to the base's
   * @param entity - This Graph's version, `undefined` if it deletes the entity (only when `isLocal`)
   * @param journal - `false` to skip recording the write (for a rollback)
   */
  protected _setLocal(entityID: EntityID, isLocal: boolean, entity: OsmEntity | undefined, journal: boolean = true): void {
    if (journal) {
      this._noteWrite(entityID);
    }

    const record = this._getRecord(entityID);
    const prevLocal = record?.isLocal ? record.entity : undefined;
    const nextLocal = isLocal ? entity : undefined;
    this._writeRecord(entityID, { isLocal: isLocal, entity: nextLocal });

    // This Graph's own parents: the ways and relations it has its own version of.
    // (Once it has its own version of a way, base's record of that way's nodes doesn't count.)
    const type = (prevLocal ?? nextLocal)?.type;
    if (type === 'way') {
      const prevNodes = new Set<EntityID>((prevLocal as OsmWay | undefined)?.nodes);
      const nextNodes = new Set<EntityID>((nextLocal as OsmWay | undefined)?.nodes);
      for (const childID of prevNodes.difference(nextNodes)) {
        this._removeLocalParent(childID, 'parentWays', entityID);
      }
      for (const childID of nextNodes.difference(prevNodes)) {
        this._addLocalParent(childID, 'parentWays', entityID);
      }

    } else if (type === 'relation') {
      // diff only on the IDs since the same entity can be a member multiple times with different roles
      const prevMembers = new Set<EntityID>((prevLocal as OsmRelation | undefined)?.members.map(m => m.id));
      const nextMembers = new Set<EntityID>((nextLocal as OsmRelation | undefined)?.members.map(m => m.id));
      for (const childID of prevMembers.difference(nextMembers)) {
        this._removeLocalParent(childID, 'parentRels', entityID);
      }
      for (const childID of nextMembers.difference(prevMembers)) {
        this._addLocalParent(childID, 'parentRels', entityID);
      }
    }
  }


  /**
   * Internal function, adds one of this Graph's own parents to a child's record.
   * @param childID - The child's ID
   * @param which - `'parentWays'` or `'parentRels'`
   * @param parentID - The parent's ID
   */
  protected _addLocalParent(childID: EntityID, which: 'parentWays' | 'parentRels', parentID: EntityID): void {
    const parentIDs = this._getRecord(childID)?.[which] ?? [];
    if (parentIDs.includes(parentID)) return;
    this._writeRecord(childID, { [which]: [...parentIDs, parentID] });
  }


  /**
   * Internal function, removes one of this Graph's own parents from a child's record.
   * @param childID - The child's ID
   * @param which - `'parentWays'` or `'parentRels'`
   * @param parentID - The parent's ID
   */
  protected _removeLocalParent(childID: EntityID, which: 'parentWays' | 'parentRels', parentID: EntityID): void {
    const parentIDs = this._getRecord(childID)?.[which];
    if (!parentIDs?.includes(parentID)) return;
    const remaining = parentIDs.filter(id => id !== parentID);
    this._writeRecord(childID, { [which]: remaining.length ? remaining : null });
  }


  /**
   * Internal function, gets this Graph's record for an ID.
   * @param entityID - The ID
   * @return The record, or `undefined` if this Graph says nothing different from base about it
   */
  protected _getRecord(entityID: EntityID): GraphRecord | undefined {
    if (this._records.root === null) return undefined;
    const slot = this._lineage.slots.get(entityID);
    return (slot === undefined) ? undefined : vectorGet(this._records, slot);
  }


  /**
   * Internal function, stores a new record for an ID, copied from the current one with changes.
   * Gives the ID a slot if it doesn't have one yet.
   * @param entityID - The ID
   * @param changes - The fields to change
   */
  protected _writeRecord(entityID: EntityID, changes: Partial<GraphRecord>): void {
    const lineage = this._lineage;
    let slot = lineage.slots.get(entityID);
    if (slot === undefined) {
      slot = lineage.slotIDs.length;
      lineage.slots.set(entityID, slot);
      lineage.slotIDs.push(entityID);
    }

    const prev = vectorGet(this._records, slot);
    const next: GraphRecord = {
      isLocal: prev?.isLocal ?? false,
      entity: prev?.entity,
      parentWays: prev?.parentWays ?? null,
      parentRels: prev?.parentRels ?? null,
      geometry: prev?.geometry ?? null,
      ...changes
    };
    const isEmpty = !next.isLocal && !next.parentWays && !next.parentRels && !next.geometry;   // says nothing different from base
    this._records = vectorSet(this._records, slot, isEmpty ? undefined : next, this._owner);
  }


  /**
   * Internal function, whether this Graph deleted an entity (its own version is a deletion).
   * @param entityID - The ID
   * @return `true` if this Graph deleted it
   */
  protected _isDeleted(entityID: EntityID): boolean {
    const record = this._getRecord(entityID);
    return !!record?.isLocal && record.entity === undefined;
  }


  /**
   * Recomputes the geometry of the given ways and relations (nodes keep their own), as they are in
   * this Graph: a base Graph stores it on the base objects, any other Graph in its own records.
   * Ways go first, then relations with their member relations before them,
   * so a relation is never built from a member's stale shape.
   * This needs to be called after all `_updateCaches` calls have finished.
   * @param entityIDs - IDs of the entities to recompute
   */
  public recomputeGeometry(entityIDs: Iterable<EntityID>): void {
    const relations = new Map<EntityID, OsmRelation>();
    for (const entityID of entityIDs) {
      const entity = this.hasEntity(entityID);
      if (!entity) continue;                  // entity was deleted
      if (entity.type === 'node') continue;   // nodes don't need this
      if (entity.type === 'relation') {
        relations.set(entityID, entity as OsmRelation);
      } else {
        this._storeGeometry(entity);
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
        this._storeGeometry(relation);
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
      this._storeGeometry(relation);
    };

    for (const relation of relations.values()) {
      visit(relation);
    }
  }


  /**
   * Internal function, builds an entity's geometry as it is in this Graph and stores it: on the
   * object for a base Graph, in this Graph's record otherwise.
   * @param entity - The way or relation
   */
  protected _storeGeometry(entity: OsmEntity): void {
    if (this.isBaseGraph) {
      entity.updateGeometry(this);
    } else {
      entity.clearMemos();
      this._writeRecord(entity.id, { geometry: entity.buildGeometry(this) });
    }
  }


  /**
   * Checks this Graph's shapes against shapes built from scratch, for tests and debugging.
   * Each way and relation that `ids` lists (by default every one this Graph or its base has) is built
   * again, and compared with `geometry()` by its world coordinates.
   * @param ids - The IDs to check, or all of them
   * @return A description of each shape that differs (empty if they all match)
   */
  public verify(ids?: Iterable<EntityID>): string[] {
    const problems: string[] = [];
    const toCheck = ids ?? new Set<EntityID>([...this.base.entities.keys(), ...this.localEntities().keys()]);
    for (const entityID of toCheck) {
      const entity = this.hasEntity(entityID);
      if (!entity || entity.type === 'node') continue;

      const stored = JSON.stringify(this.geometry(entity).parts.map(part => part.world?.coords));
      const built = JSON.stringify(entity.buildGeometry(this).parts.map(part => part.world?.coords));
      if (stored !== built) {
        problems.push(`${this.id}: ${entityID} has a stale shape`);
      }
    }
    return problems;
  }


  /**
   * Internal function, records a write to an ID before it happens:
   * what it held before, for the next commit, and the ID in the journal.
   * @param entityID - The ID about to be written
   */
  protected _noteWrite(entityID: EntityID): void {
    if (!this._pending.has(entityID)) {
      const record = this._getRecord(entityID);
      this._pending.set(entityID, record?.isLocal ? record.entity : NOT_LOCAL);
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
