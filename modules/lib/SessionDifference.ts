import { changedChildIDs, compareEntities, Difference } from './Difference.ts';

import type { DifferenceChange } from './Difference.ts';
import type { Graph } from './Graph.ts';
import type { Iterable } from '../util/iterable.ts';
import type { OsmRelation, OsmWay } from '../data/types.ts';


/**
 * The `SessionDifference` is the difference between `base` and `stable`: all of the user's edits.
 * `EditSystem` keeps one and updates it as `stable` changes, from the IDs that may have changed,
 * instead of comparing every edited entity again.
 * Its `changes` are exact, and so is `affects()`, which answers whether `complete()` would have an
 * entity without building it. `complete()` and `summary()` are built when asked for, and kept until
 * the next update or merge.
 * @see design/graph-geometry.md
 */
export class SessionDifference extends Difference {
  /** The nodes of changed ways (before and after), with how many changes count each */
  protected _wayNodes: Map<EntityID, number>;
  /** The members of changed relations that `complete()` counts, with how many changes count each */
  protected _members: Map<EntityID, number>;
  /** Ways and relations known to contain a changed entity (or not), until the next update or merge */
  protected _contains: Map<EntityID, boolean>;

  /**
   * @param  base - The base Graph
   * @param  head - The stable Graph
   */
  public constructor(base: Graph, head: Graph) {
    super(base, head);
    this._wayNodes = new Map<EntityID, number>();
    this._members = new Map<EntityID, number>();
    this._contains = new Map<EntityID, boolean>();

    for (const change of this._changes.values()) {
      this._countChildren(change, 1);
    }
  }


  /**
   * Updates the difference for a new `stable` graph.
   * @param head - The new stable Graph
   * @param candidateIDs - Every ID that may differ between the previous stable Graph and this one
   */
  public update(head: Graph, candidateIDs: Iterable<EntityID> | ReadonlySet<EntityID>): void {
    const base = this._base!;
    this._head = head;

    for (const entityID of candidateIDs) {
      const previous = this._changes.get(entityID);
      if (previous) {
        this._countChildren(previous, -1);
      }

      const b = base.hasEntity(entityID);
      const h = head.hasEntity(entityID);
      const flags = compareEntities(b, h);
      if (flags) {
        const change = { base: b, head: h };
        this._changes.set(entityID, change);
        this._countChildren(change, 1);
        Object.assign(this.didChange, flags);
      } else {
        this._changes.delete(entityID);
      }
    }

    this.invalidate();
  }


  /**
   * Forgets `complete()` and `summary()`, so they're built again when asked for.
   * Downloaded data can change both without changing the edits: a new way can make an edited node
   * a vertex, or a new relation can contain an edited way.
   */
  public invalidate(): void {
    this._complete = null;
    this._summary = null;
    this._contains.clear();
  }


  /**
   * Returns whether `complete()` has an entity, without building it: the entity changed, or it's a
   * child of a change (a node of a changed way, a changed member of a changed relation), or it
   * contains a change (a way with a changed node, a relation with a changed member, recursively).
   * `ValidationSystem` asks this about the entities of each issue, to tell which ones the user made.
   * @param  entityID - The entity ID
   * @return `true` if the user's edits affect the entity
   */
  public affects(entityID: EntityID): boolean {
    if (this._changes.has(entityID) || this._wayNodes.has(entityID)) return true;
    if (this._members.has(entityID) && this._head.hasEntity(entityID)) return true;   // `complete()` skips members not downloaded
    return this._containsChange(entityID, new Set<EntityID>());
  }


  /**
   * Returns whether an entity contains a changed entity in `head`: a way with a changed node, or a
   * relation with a member that changed or contains one. These are the ancestors `complete()` adds.
   * A relation already being visited counts as `false` (a cycle), so a relation's `false` is
   * certain only for the entity first asked about, and only that one is kept.
   * @param  entityID - The entity ID
   * @param  visiting - The relations being visited, to stop at cycles
   * @return `true` if the entity contains a changed entity
   */
  protected _containsChange(entityID: EntityID, visiting: Set<EntityID>): boolean {
    const known = this._contains.get(entityID);
    if (known !== undefined) return known;

    const entity = this._head.hasEntity(entityID);
    let result = false;
    if (entity?.type === 'way') {
      result = (entity as OsmWay).nodes.some(nodeID => this._changes.has(nodeID));
    } else if (entity?.type === 'relation') {
      if (visiting.has(entityID)) return false;
      visiting.add(entityID);
      result = (entity as OsmRelation).members
        .some(member => this._changes.has(member.id) || this._containsChange(member.id, visiting));
      visiting.delete(entityID);
    }

    if (result || entity?.type !== 'relation' || !visiting.size) {
      this._contains.set(entityID, result);
    }
    return result;
  }


  /**
   * Counts (or stops counting) the children that a change brings into `complete()`.
   * @param  change - The change
   * @param  delta - `1` to count them, `-1` to stop
   */
  protected _countChildren(change: DifferenceChange, delta: number): void {
    const entity = change.head ?? change.base;
    let counts: Map<EntityID, number>;
    if (entity?.type === 'way') {
      counts = this._wayNodes;
    } else if (entity?.type === 'relation') {
      counts = this._members;
    } else {
      return;
    }

    for (const childID of changedChildIDs(change)) {
      const count = (counts.get(childID) ?? 0) + delta;
      if (count > 0) {
        counts.set(childID, count);
      } else {
        counts.delete(childID);
      }
    }
  }

}
