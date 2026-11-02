import deepEqual from 'fast-deep-equal';

import type { Iterable } from '../util/iterable.ts';
import type { OsmEntity, OsmRelationMember, OsmNode, OsmWay, OsmRelation } from '../data/types.ts';
import type { Graph } from './Graph.ts';


/**
 * Represents a change to a single entity between two graphs.
 */
export interface DifferenceChange {
  /** The entity in the base graph (undefined if added) */
  base: OsmEntity | undefined;
  /** The entity in the head graph (undefined if deleted) */
  head: OsmEntity | undefined;
}

/**
 * Flags indicating what types of changes occurred.
 */
export interface DifferenceFlags {
  /** An entity was added */
  addition?: boolean;
  /** An entity was deleted */
  deletion?: boolean;
  /** An entity's geometry changed */
  geometry?: boolean;
  /** An entity's properties/tags changed */
  properties?: boolean;
}


/**
 * Summary entry describing a change to an entity.
 */
export interface SummaryEntry {
  /** The entity that changed */
  entity: OsmEntity;
  /** The Graph where the entity can be found (head or base) */
  graph: Graph;
  /** The type of change: 'created', 'modified', or 'deleted' */
  changeType: 'created' | 'modified' | 'deleted';
}


/**
 *  `Difference` represents the difference between two Graphs.
 *  It knows how to calculate the set of entities that were
 *  created, modified, or deleted, and also contains the logic
 *  for recursively extending a difference to the complete set
 *  of entities that will require a redraw, taking into account
 *  child and parent relationships.
 */
export class Difference {

  /** Flags indicating what types of changes occurred */
  public didChange: DifferenceFlags;

  /** The base Graph (before the edit), or null for a fresh graph */
  protected _base: Graph | null;
  /** The head Graph (after the edit) */
  protected _head: Graph;
  /** Map of EntityID to the before/after entity pair for each changed entity */
  protected _changes: Map<EntityID, DifferenceChange>;
  /** Lazily computed summary of changes (created/modified/deleted), cached after first call */
  protected _summary: Map<EntityID, SummaryEntry> | null;
  /** Lazily computed complete set of entities affected by the diff (including parents/children), cached after first call */
  protected _complete: Map<EntityID, OsmEntity | undefined> | null;


  /**
   * Without `candidates`, every ID either graph has changed from base is checked.
   * With `candidates`, only those IDs are checked: they must include every ID whose entity
   * differs between "before" and `head`. Extra IDs are harmless, because values are compared.
   * @param  base - Base Graph (null for fresh head graph)
   * @param  head - Head Graph
   * @param  candidates - Optional IDs to check, instead of scanning both graphs
   * @param  before - Optional entities to compare against instead of `base`'s, for the IDs it has
   */
  public constructor(
    base: Graph | null,
    head: Graph,
    candidates?: Iterable<EntityID> | ReadonlySet<EntityID>,
    before?: ReadonlyMap<EntityID, OsmEntity | undefined>
  ) {
    this._base = base;
    this._head = head;
    this._changes = new Map<EntityID, DifferenceChange>();
    this._summary = null;
    this._complete = null;
    this.didChange = {};

    if (!head) return;           // no head graph, no difference
    if (base === head && !before) return;   // same Graph, no difference

    // Gather affected ids
    let ids: Iterable<EntityID> | ReadonlySet<EntityID>;
    if (candidates) {
      ids = candidates;
    } else {
      ids = head.diffIDs(base);   // O(changes) for graphs that share structure
    }

    // Check each id to determine whether it has changed from base -> head..
    for (const id of ids) {
      const h = head.hasEntity(id);
      const b = before?.has(id) ? before.get(id) : base?.hasEntity(id);
      const flags = compareEntities(b, h);
      if (!flags) continue;  // no change

      this._changes.set(id, { base: b, head: h });
      Object.assign(this.didChange, flags);
    }
  }


  /**
   * The map of per-entity changes captured by this difference.
   * @readonly
   * @return  The change details
   */
  public get changes(): Map<EntityID, DifferenceChange> {
    return this._changes;
  }


  /**
   * Returns the entities that exist in both base and head graphs (i.e. modified).
   * @return  Array of Entities modified
   */
  public modified(): OsmEntity[] {
    const result: OsmEntity[] = [];
    for (const change of this._changes.values()) {
      if (change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * Returns the entities that exist only in the head graph (i.e. created).
   * @return  Array of Entities created
   */
  public created(): OsmEntity[] {
    const result: OsmEntity[] = [];
    for (const change of this._changes.values()) {
      if (!change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * Returns the entities that exist only in the base graph (i.e. deleted).
   * @return  Array of Entities deleted
   */
  public deleted(): OsmEntity[] {
    const result: OsmEntity[] = [];
    for (const change of this._changes.values()) {
      if (change.base && !change.head) {
        result.push(change.base);
      }
    }
    return result;
  }


  /**
   * Generates a difference "summary" in a format like what is presented on the
   *  pre-save commit component, with list items like "created", "modified", "deleted".
   *
   * The difference summary is used to present a more "human" difference regarding verticies.
   * For exmaple, when changing a way, the user might add/delete/move uninteresting child nodes,
   *  but the summary difference presents it as only the way being modified.
   *
   * Returns a result about the Entities that changed:
   * ```ts
   *  {
   *    entityID: {
   *      entity:      The OsmEntity that changed
   *      graph:       The Graph it can be found in (head or base)
   *      changeType:  String, one of 'created', 'modified', or 'deleted'
   *    }
   *  }
   * ```
   * @return  Returns a summary of changes
   */
  public summary(): Map<EntityID, SummaryEntry> {
    if (this._summary) return this._summary;  // done already

    const base = this._base!;
    const head = this._head;
    const result = new Map<EntityID, SummaryEntry>();

    for (const change of this._changes.values()) {
      const h = change.head;
      const b = change.base;

      if (h && h.geometry(head) !== 'vertex') {
        result.set(h.id, { entity: h, graph: head, changeType: (b ? 'modified' : 'created') });

      } else if (b && b.geometry(base) !== 'vertex') {
        result.set(b.id, { entity: b, graph: base, changeType: 'deleted' });

      } else if (b && h) {  // modified vertex
        const moved = !deepEqual((b as OsmNode).loc, (h as OsmNode).loc);
        const retagged = !deepEqual(b.tags, h.tags);
        if (moved) {
          for (const parent of head.parentWays(h)) {
            if (result.has(parent.id)) continue;
            result.set(parent.id, { entity: parent, graph: head, changeType: 'modified' });
          }
        }
        if (retagged || (moved && h.hasInterestingTags())) {
          result.set(h.id, { entity: h, graph: head, changeType: 'modified' });
        }

      } else if (h && h.hasInterestingTags()) {  // created vertex
        result.set(h.id, { entity: h, graph: head, changeType: 'created' });

      } else if (b && b.hasInterestingTags()) {  // deleted vertex
        result.set(b.id, { entity: b, graph: base, changeType: 'deleted' });
      }
    }

    this._summary = result;
    return result;
  }


  /**
   * Returns complete set of Entities affected by the changes in this difference.
   * This is used to know which Entities need redraw or revalidation.
   * Recurses up to include all ancestor Entities in the result, parentWays and parentRelations.
   * @return  Returns the complete set of entities affected by the change
   */
  public complete(): Map<EntityID, OsmEntity | undefined> {
    if (this._complete) return this._complete;  // done already

    this._complete = completeFrom(this._head, this._changes);
    return this._complete;
  }

}


/**
 * Compares an entity before and after a change, by value: a node's `loc`, a way's `nodes`,
 * a relation's `members`, and tags.
 * @param  b - The entity before (undefined if added)
 * @param  h - The entity after (undefined if deleted)
 * @return The kinds of change, or `null` if nothing changed
 */
export function compareEntities(b: OsmEntity | undefined, h: OsmEntity | undefined): DifferenceFlags | null {
  if (h === b) return null;  // no change

  if (b && !h) return { deletion: true };
  if (!b && h) return { addition: true };

  const flags: DifferenceFlags = {};
  if (h && b) {
    const type = h.type;
    if (type === 'relation') {
      if (!deepEqual((h as OsmRelation).members, (b as OsmRelation).members)) {
        return { geometry: true, properties: true };
      }
    } else if (type === 'way') {
      if (!deepEqual((h as OsmWay).nodes, (b as OsmWay).nodes)) {
        flags.geometry = true;
      }
    } else if (type === 'node') {
      if (!deepEqual((h as OsmNode).loc, (b as OsmNode).loc)) {
        flags.geometry = true;
      }
    }

    if (!deepEqual(h.tags, b.tags)) {
      flags.properties = true;
    }
  }

  return (flags.geometry || flags.properties) ? flags : null;
}


/**
 * Returns the complete set of Entities affected by some changes: what changed, the old and new nodes
 * of changed ways, the members of changed relations, and all parent ways and relations, recursively.
 * A changed relation brings its added and removed members, or all of them (before and after) when
 * its tags changed or it is or was a multipolygon.
 * @param  head - The Graph after the changes
 * @param  changes - The changes, keyed by entity ID
 * @param  forGeometry - `true` to leave out the members of changed relations that aren't
 *   multipolygons: their own geometry doesn't depend on the relation.
 * @return The affected entities, as they are in `head` (undefined if deleted)
 */
export function completeFrom(
  head: Graph,
  changes: ReadonlyMap<EntityID, DifferenceChange>,
  forGeometry: boolean = false
): Map<EntityID, OsmEntity | undefined> {
  const result = new Map<EntityID, OsmEntity | undefined>();
  const gathered = new Set<EntityID>();   // IDs whose parent relations have been gathered

  for (const [entityID, change] of changes) {
    const h = change.head;
    const b = change.base;
    const entity = h ?? b;
    if (!entity) continue;   // created and removed again

    result.set(entityID, h);

    if (entity.type === 'way') {
      for (const nodeID of changedChildIDs(change)) {
        result.set(nodeID, head.hasEntity(nodeID));
      }

    } else if (entity.type === 'relation') {
      for (const memberID of changedChildIDs(change, forGeometry)) {
        const member = head.hasEntity(memberID);
        if (!member) continue;   // not downloaded
        result.set(memberID, member);
      }
    }

    gathered.add(entityID);
    _gatherParents(head.parentWays(entity));
    _gatherParents(head.parentRelations(entity));
  }

  return result;


  /**
   * Adds parents to the result, and recurses up to their parent relations.
   * @param parents - The parent ways or relations to add
   */
  function _gatherParents(parents: Iterable<OsmEntity>): void {
    for (const parent of parents) {
      result.set(parent.id, parent);
      if (gathered.has(parent.id)) continue;
      gathered.add(parent.id);
      _gatherParents(head.parentRelations(parent));  // recurse up to parent relations
    }
  }
}


/**
 * Returns the IDs of the children a change affects, as `completeFrom` counts them: the old and new
 * nodes of a changed way, or the changed members of a changed relation (all of them, before and
 * after, when its tags changed or it is or was a multipolygon).
 * @param  change - The change
 * @param  forGeometry - `true` to leave out the members of relations that aren't multipolygons
 * @return The IDs of the children (none for a node)
 */
export function changedChildIDs(change: DifferenceChange, forGeometry: boolean = false): Set<EntityID> {
  const h = change.head;
  const b = change.base;
  const entity = h ?? b;

  if (entity?.type === 'way') {
    const headNodes = new Set<EntityID>((h as OsmWay | undefined)?.nodes);
    const baseNodes = new Set<EntityID>((b as OsmWay | undefined)?.nodes);
    return headNodes.union(baseNodes);

  } else if (entity?.type === 'relation') {
    const hr = h as OsmRelation | undefined;
    const br = b as OsmRelation | undefined;
    const isMultipolygon = !!(hr?.isMultipolygon() || br?.isMultipolygon());
    const takeAll = isMultipolygon || !hr || !br || !deepEqual(hr.tags, br.tags);
    if (isMultipolygon || !forGeometry) {
      return _changedMembers(br?.members ?? [], hr?.members ?? [], takeAll);
    }
  }

  return new Set<EntityID>();
}


/**
 * Returns the IDs of the members that differ between two member lists: added, removed, or with a
 * changed role. Or every member of both, if `takeAll` is set.
 * @param  before - The members before the change
 * @param  after - The members after the change
 * @param  takeAll - `true` to return every member of both lists
 * @return Member IDs
 */
function _changedMembers(before: OsmRelationMember[], after: OsmRelationMember[], takeAll: boolean): Set<EntityID> {
  const result = new Set<EntityID>();
  if (takeAll) {
    for (const m of before) result.add(m.id);
    for (const m of after) result.add(m.id);
    return result;
  }

  const beforeKeys = new Set<string>(before.map(m => `${m.id} ${m.role}`));
  const afterKeys = new Set<string>(after.map(m => `${m.id} ${m.role}`));
  for (const m of before) {
    if (!afterKeys.has(`${m.id} ${m.role}`)) result.add(m.id);
  }
  for (const m of after) {
    if (!beforeKeys.has(`${m.id} ${m.role}`)) result.add(m.id);
  }
  return result;
}
