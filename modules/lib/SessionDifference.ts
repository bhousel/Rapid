import { compareEntities, Difference } from './Difference.ts';

import type { Graph } from './Graph.ts';
import type { Iterable } from '../util/iterable.ts';


/**
 * The `SessionDifference` is the difference between `base` and `stable`: all of the user's edits.
 * `EditSystem` keeps one and updates it as `stable` changes, from the IDs that may have changed,
 * instead of comparing every edited entity again.
 * Its `changes` are exact. `complete()` and `summary()` are built when asked for, and kept until
 * the next update or merge.
 * @see design/graph-geometry.md
 */
export class SessionDifference extends Difference {

  /**
   * @param  base - The base Graph
   * @param  head - The stable Graph
   */
  public constructor(base: Graph, head: Graph) {
    super(base, head);
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
      const b = base.hasEntity(entityID);
      const h = head.hasEntity(entityID);
      const flags = compareEntities(b, h);
      if (flags) {
        this._changes.set(entityID, { base: b, head: h });
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
  }

}
