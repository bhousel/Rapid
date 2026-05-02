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
interface SummaryEntry {
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
  private _base: Graph | null;
  private _head: Graph;
  private _changes: Map<EntityID, DifferenceChange>;
  private _summary: Map<EntityID, SummaryEntry> | null;
  private _complete: Map<EntityID, OsmEntity | undefined> | null;

  /** Flags indicating what types of changes occurred */
  didChange: DifferenceFlags;

  /**
   * @constructor
   * @param  base - Base Graph (null for fresh head graph)
   * @param  head - Head Graph
   */
  constructor(base: Graph | null, head: Graph) {
    this._base = base;
    this._head = head;
    this._changes = new Map();
    this.didChange = {};
    this._summary = null;
    this._complete = null;

    if (!head) return;           // no head graph, no difference
    if (base === head) return;   // same Graph, no difference

    // Gather affected ids
    let ids = new Set(head.local.entities.keys());
    if (base) {                               // Note:  Maps are "Set-like"
      ids = ids.union(base.local.entities);   // keys() will be invoked automatially
    }

    // Check each id to determine whether it has changed from base -> head..
    for (const id of ids) {
      const h = head.hasEntity(id);
      const b = base?.hasEntity(id);
      if (h === b) continue;  // no change

      const type = h?.type || b?.type;

      if (b && !h) {
        this._changes.set(id, { base: b, head: h });
        this.didChange.deletion = true;
        continue;
      }
      if (!b && h) {
        this._changes.set(id, { base: b, head: h });
        this.didChange.addition = true;
        continue;
      }

      if (h && b) {
        if (type === 'relation') {
          if (!deepEqual((h as OsmRelation).members, (b as OsmRelation).members)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
            this.didChange.properties = true;
            continue;
          }
        } else if (type === 'way') {
          if (!deepEqual((h as OsmWay).nodes, (b as OsmWay).nodes)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
          }
        } else if (type === 'node') {
          if (!deepEqual((h as OsmNode).loc, (b as OsmNode).loc)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
          }
        }

        if (!deepEqual(h.tags, b.tags)) {
          this._changes.set(id, { base: b, head: h });
          this.didChange.properties = true;
        }
      }
    }
  }


  /**
   * @readonly
   * @return  The change details
   */
  get changes(): Map<EntityID, DifferenceChange> {
    return this._changes;
  }


  /**
   * @return  Array of Entities modified
   */
  modified(): OsmEntity[] {
    const result: OsmEntity[] = [];
    for (const change of this._changes.values()) {
      if (change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * @return  Array of Entities created
   */
  created(): OsmEntity[] {
    const result: OsmEntity[] = [];
    for (const change of this._changes.values()) {
      if (!change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * @return  Array of Entities deleted
   */
  deleted(): OsmEntity[] {
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
  summary(): Map<EntityID, SummaryEntry> {
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
  complete(): Map<EntityID, OsmEntity | undefined> {
    if (this._complete) return this._complete;  // done already

    const head = this._head;
    const result = new Map<EntityID, OsmEntity | undefined>();

    for (const [entityID, change] of this._changes) {
      const h = change.head;
      const b = change.base;
      const entity = h ?? b;

      result.set(entityID, h);

      if (entity?.type === 'way') {
        const headNodes = new Set((h as OsmWay | undefined)?.nodes);
        const baseNodes = new Set((b as OsmWay | undefined)?.nodes);
        for (const nodeID of headNodes.union(baseNodes)) {
          result.set(nodeID as EntityID, head.hasEntity(nodeID as EntityID));
        }
      }

      if (entity?.type === 'relation' && (entity as OsmRelation).isMultipolygon()) {
        const headMembers = new Set((h as OsmRelation | undefined)?.members?.map((m: OsmRelationMember) => m.id));
        const baseMembers = new Set((b as OsmRelation | undefined)?.members?.map((m: OsmRelationMember) => m.id));
        for (const memberID of headMembers.union(baseMembers)) {
          const member = head.hasEntity(memberID as EntityID);
          if (!member) continue;   // not downloaded
          result.set(memberID as EntityID, member);
        }
      }

      _gatherParents(head.parentWays(entity!), result);
      _gatherParents(head.parentRelations(entity!), result);
    }

    this._complete = result;
    return result;


    function _gatherParents(parents: Iterable<OsmEntity>, result: Map<EntityID, OsmEntity | undefined>): void {
      for (const parent of parents) {
        if (result.has(parent.id)) continue;
        result.set(parent.id, parent);
        _gatherParents(head.parentRelations(parent), result);  // recurse up to parent relations
      }
    }
  }

}
