import { actionDeleteMultiple } from './delete_multiple.ts';
import { actionRevert } from './revert.ts';
import { createOsmEntity } from '../data/index.ts';
import deepEqual from 'fast-deep-equal';
import { diff3Merge, MergeRegion } from 'node-diff3';
import { utilArrayUnion, utilArrayUniq } from '@rapid-sdk/util';
import { vecEqual } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';


/** Options for merge remote changes action */
export interface MergeRemoteChangesOptions {
  localGraph: Graph;
  remoteGraph: Graph;
  discardTags?: Record<string, boolean>;
  formatUser?: (user: string) => string;
  localize?: (key: string, params?: Record<string, string | number | undefined>) => string;
  strategy?: 'safe' | 'force_local' | 'force_remote';
  /** Entities with a conflict of their own: a way's merge leaves its child nodes in here to their own choice */
  ownChoiceIDs?: Set<EntityID>;
}

/** Updates to apply to child nodes */
interface ChildUpdates {
  replacements: OsmEntity[];
  removeIDs: EntityID[];
}

/** Action with conflicts method */
export interface MergeRemoteChangesAction extends Action {
  conflicts(): string[];
}


/**
 * Merges remote changes from the OSM API with local edits.
 * Handles conflicts in location, tags, nodes, and members.
 * Uses diff3 algorithm for tag merging when possible.
 * For a way, the remote way's child nodes must be in the graph already: merge them into the base
 * first (`editor.merge`), as `UploaderSystem` does.
 *
 * @param   id       - EntityID of the entity to merge
 * @param   options  - Merge options including local/remote graphs and strategy
 * @return  An Action function that merges changes and tracks conflicts
 */
export function actionMergeRemoteChanges(id: EntityID, options: MergeRemoteChangesOptions): MergeRemoteChangesAction {
  const localGraph = options.localGraph;
  const remoteGraph = options.remoteGraph;
  const discardTags = options.discardTags ?? {};
  const formatUser = options.formatUser ?? ((d: string) => d);
  const localize = options.localize ?? ((d: string) => d);
  const strategy = options.strategy ?? 'safe';   // 'safe', 'force_local', 'force_remote'
  const ownChoiceIDs = options.ownChoiceIDs ?? new Set<EntityID>();

  const _conflicts: string[] = [];


  /**
   * Three-way merges the node location from the remote version into the target.
   * With `'force_remote'` strategy the remote location always wins.
   * With `'force_local'` or when locations are equal the target is unchanged.
   * Otherwise, a move on only one side is kept: the remote one if the user didn't move it,
   * the user's if the other mapper didn't. If both moved it, a conflict is recorded and the
   * target is left as-is.
   * @param   base   - The common ancestor version of the node
   * @param   remote - The remote version of the node
   * @param   target - The local version of the node being built
   * @return  Updated target node
   */
  function mergeLocation(base: OsmNode | undefined, remote: OsmNode, target: OsmNode): OsmNode {
    const EPSILON = 1e-6;
    if (strategy === 'force_local' || vecEqual(target.loc!, remote.loc!, EPSILON)) {
      return target;
    }
    if (strategy === 'force_remote' || (base && vecEqual(base.loc!, target.loc!, EPSILON))) {   // only moved remotely
      return target.update({ loc: remote.loc });
    }
    if (base && vecEqual(base.loc!, remote.loc!, EPSILON)) {   // only moved locally
      return target;
    }

    _conflicts.push(
      localize('merge_remote_changes.conflict.location', { user: formatUser(remote.props.user ?? 'unknown') })
    );
    return target;
  }


  /**
   * Three-way merges the node list of a way using diff3.
   * Non-conflicting remote additions/removals are accepted automatically.
   * True conflicts (changed independently on both sides) are recorded and the
   * target's existing node list is preserved.
   * @param   base   - The common ancestor version of the way
   * @param   remote - The remote version of the way
   * @param   target - The local version of the way being built
   * @return  Updated target way
   */
  function mergeNodes(base: OsmWay, remote: OsmWay, target: OsmWay): OsmWay {
    if (strategy === 'force_local' || deepEqual(target.nodes, remote.nodes)) {
      return target;
    }
    if (strategy === 'force_remote') {
      return target.update({ nodes: remote.nodes });
    }

    const origLength = _conflicts.length;
    const o: EntityID[] = base.nodes || [];
    const a: EntityID[] = target.nodes || [];
    const b: EntityID[] = remote.nodes || [];
    const hunks: MergeRegion<EntityID>[] = diff3Merge(a, o, b, { excludeFalseConflicts: true });
    const nodes: EntityID[] = [];

    for (const hunk of hunks) {
      if (hunk.ok) {
        Array.prototype.push.apply(nodes, hunk.ok);
      } else if (hunk.conflict) {
        // for all conflicts, we can assume c.a !== c.b
        // because `diff3Merge` called with `true` option to exclude false conflicts..
        const c = hunk.conflict;
        if (deepEqual(c.o, c.a)) {  // only changed remotely
          Array.prototype.push.apply(nodes, c.b);
        } else if (deepEqual(c.o, c.b)) {  // only changed locally
          Array.prototype.push.apply(nodes, c.a);
        } else {       // changed both locally and remotely
          _conflicts.push(
            localize('merge_remote_changes.conflict.nodelist', { user: formatUser(remote.props.user ?? 'unknown') })
          );
          break;
        }
      }
    }

    return (_conflicts.length === origLength) ? target.update({ nodes: nodes }) : target;
  }


  /**
   * Reconciles the child nodes of a way after a remote node-list merge.
   * For nodes no longer referenced by `targetWay`, unused ones are queued for
   * deletion.  For nodes that are still referenced, the best available version
   * is determined according to the merge strategy and queued for replacement.
   * @param   targetWay - The way whose child nodes are being reconciled
   * @param   children  - Full list of node IDs from the pre-merge way
   * @param   updates   - Accumulator for replacement nodes and IDs to delete
   * @param   graph     - The current graph
   * @return  The (unchanged) target way
   */
  function mergeChildren(targetWay: OsmWay, children: EntityID[], updates: ChildUpdates, graph: Graph): OsmWay {
    /**
     * Returns `true` if `node` should be kept even though it is no longer
     * referenced by `targetWay`: it has interesting tags, appears in another
     * way, or belongs to a relation.
     * @param   node      - The node to test
     * @param   targetWay - The way being merged (excluded from the parent-way check)
     * @return  `true` if the node is still in use
     */
    function isUsed(node: OsmNode, targetWay: OsmWay): boolean {
      const hasInterestingParent = graph.parentWays(node).some((way: OsmWay) => way.id !== targetWay.id);
      return node.hasInterestingTags() || hasInterestingParent || graph.parentRelations(node).length > 0;
    }

    for (const nodeID of children) {
      const node = graph.hasEntity(nodeID) as OsmNode | null;

      // remove unused childNodes..
      if (targetWay.nodes.indexOf(nodeID) === -1) {
        if (node && !isUsed(node, targetWay)) {
          updates.removeIDs.push(nodeID);
        }
        continue;
      }

      // restore used childNodes..
      const local = localGraph.hasEntity(nodeID) as OsmNode | null;
      const remote = remoteGraph.hasEntity(nodeID) as OsmNode | null;
      const baseNode = graph.base.entities.get(nodeID);
      let target: OsmNode;

      // A node with its own conflict follows its own choice, whatever is chosen for the way.
      if (ownChoiceIDs.has(nodeID)) continue;

      if (strategy === 'force_remote' && remote && remote.visible) {
        // A node another way uses keeps the user's change, unless the other mapper changed it too:
        // "use theirs" is about this way, and the change is an edit of that other way as well.
        const isShared = !!node && graph.parentWays(node).some(way => way.id !== targetWay.id);
        if (isShared && baseNode && remote.version === baseNode.version) continue;
        updates.replacements.push(remote);

      } else if (strategy === 'force_local' && local) {
        target = createOsmEntity(local) as OsmNode;
        if (remote) {
          target = target.update({ version: remote.version });
        }
        updates.replacements.push(target);

      } else if (strategy === 'safe' && local && remote && local.version !== remote.version) {
        // A node the user changed is checked on its own (everything modified is), so its own merge decides it.
        if (local !== baseNode) continue;

        // The user didn't change it, so it takes the other mapper's version, unless they deleted it
        if (remote.visible) {
          updates.replacements.push(remote);
        } else {
          _conflicts.push(
            localize('merge_remote_changes.conflict.deleted', { user: formatUser(remote.props.user ?? 'unknown') })
          );
          break;
        }
      }
    }

    return targetWay;
  }


  /**
   * Applies the queued child-node updates to the graph: replaces updated nodes
   * and deletes nodes that are no longer needed.
   * @param   updates - The accumulated replacements and node IDs to remove
   * @param   graph   - The current graph
   * @return  Updated graph
   */
  function updateChildren(updates: ChildUpdates, graph: Graph): Graph {
    if (updates.replacements.length) {
      graph.replace(updates.replacements);
      graph = graph.commit();
    }

    if (updates.removeIDs.length) {
      graph = actionDeleteMultiple(updates.removeIDs, false /* do not delete degenerate ways */)(graph);
    }

    return graph;
  }


  /**
   * Merges the member list of a relation from the remote version.
   * With `'force_remote'` the remote list always wins; with `'force_local'` or
   * when lists are identical the target is unchanged.  Divergent lists record a
   * conflict and leave the target unchanged.
   * @param   remote - The remote version of the relation
   * @param   target - The local version of the relation being built
   * @return  Updated target relation
   */
  function mergeMembers(remote: OsmRelation, target: OsmRelation): OsmRelation {
    if (strategy === 'force_local' || deepEqual(target.members, remote.members)) {
      return target;
    }
    if (strategy === 'force_remote') {
      return target.update({ members: remote.members });
    }

    _conflicts.push(
      localize('merge_remote_changes.conflict.memberlist', { user: formatUser(remote.props.user ?? 'unknown') })
    );

    return target;
  }


  /**
   * Three-way merges the tags of an entity using diff3.  Remote-only changes
   * are accepted automatically; local-only changes are kept; simultaneous
   * independent changes on both sides are recorded as conflicts and the local
   * value is preserved.
   * @param   base   - The common ancestor version of the entity
   * @param   remote - The remote version of the entity
   * @param   target - The local version of the entity being built
   * @return  Updated target entity
   */
  function mergeTags(base: OsmEntity, remote: OsmEntity, target: OsmEntity): OsmEntity {
    if (strategy === 'force_local' || deepEqual(target.tags, remote.tags)) {
      return target;
    }
    if (strategy === 'force_remote') {
      return target.update({tags: remote.tags});
    }

    const origLength = _conflicts.length;
    const o: OsmTags = base.tags ?? {};
    const a: OsmTags = target.tags ?? {};
    const b: OsmTags = remote.tags ?? {};
    const keys = utilArrayUnion(utilArrayUnion(Object.keys(o), Object.keys(a)), Object.keys(b))
        .filter((k: string) => { return !discardTags[k]; });
    const tags: OsmTags = { ...a };   // shallow copy
    let changed = false;

    for (const k of keys) {
      if (o[k] !== b[k] && a[k] !== b[k]) {    // changed remotely..
        if (o[k] !== a[k]) {      // changed locally..
          _conflicts.push(
            localize('merge_remote_changes.conflict.tags', {
              tag: k, local: a[k], remote: b[k], user: formatUser(remote.props.user ?? 'unknown')
            })
          );

        } else {                  // unchanged locally, accept remote change..
          if (b.hasOwnProperty(k)) {
            tags[k] = b[k];
          } else {
            delete tags[k];
          }
          changed = true;
        }
      }
    }

    return (changed && _conflicts.length === origLength) ? target.update({ tags: tags }) : target;
  }


  //  `graph.base()` is the common ancestor of the two graphs.
  //  `localGraph` contains user's edits up to saving
  //  `remoteGraph` contains remote edits to modified nodes
  //  `graph` must be a descendant of `localGraph` and may include
  //      some conflict resolution actions performed on it.
  //
  //                  --> … --> `localGraph` --> … --> `graph`
  //                 /
  //  `graph.base()` --> … --> `remoteGraph`
  //
  const action: MergeRemoteChangesAction = ((graph: Graph): Graph => {
    const updates: ChildUpdates = { replacements: [], removeIDs: [] };
    const base = graph.base.entities.get(id) as OsmEntity;
    const local = localGraph.hasEntity(id);
    const remote = remoteGraph.entity(id);

    // deleted locally
    if (!local) {
      // Deleted by both: keep our deletion, and what was deleted along with it. (The uploader leaves
      // out what's deleted on both sides. Taking back our deletion would bring back the way's nodes too.)
      if (!remote.visible) {
        return graph;
      }
      if (strategy === 'force_local') {    // keep our deletion
        // (It uploads against the base version, so the uploader replaces that with the remote version first)
        // It may have been restored by choosing the other option first, so delete it again.
        return graph.hasEntity(id) ? actionDeleteMultiple([id])(graph) : graph;
      }
      if (strategy === 'force_remote') {   // restore it (and anything deleted along with it)
        return actionRevert(id)(graph);
      }
      _conflicts.push(
        localize('merge_remote_changes.conflict.deleted_locally', { user: formatUser(remote.props.user ?? 'unknown') })
      );
      return graph;  // do nothing
    }

    let target: OsmEntity = createOsmEntity(local, { version: remote.version });

    // delete/undelete
    if (!remote.visible) {
      if (strategy === 'force_remote') {
        return actionDeleteMultiple([id], false /* do not delete degenerate ways */)(graph);

      } else if (strategy === 'force_local') {
        if (target.type === 'way') {
          target = mergeChildren(target as OsmWay, utilArrayUniq((local as OsmWay).nodes), updates, graph);
          graph = updateChildren(updates, graph);
        }
        return graph.replace(target).commit();

      } else {
        _conflicts.push(
          localize('merge_remote_changes.conflict.deleted', { user: formatUser(remote.props.user ?? 'unknown') })
        );
        return graph;  // do nothing
      }
    }

    // merge
    if (target.type === 'node') {
      target = mergeLocation(base as OsmNode | undefined, remote as OsmNode, target as OsmNode);

    } else if (target.type === 'way') {
      // (Child nodes that aren't present locally were merged into the base before this runs.)
      target = mergeNodes(base as OsmWay, remote as OsmWay, target as OsmWay);
      target = mergeChildren(target as OsmWay, utilArrayUnion((local as OsmWay).nodes, (remote as OsmWay).nodes), updates, graph);

    } else if (target.type === 'relation') {
      target = mergeMembers(remote as OsmRelation, target as OsmRelation);
    }

    target = mergeTags(base, remote, target);

    if (!_conflicts.length) {
      graph = updateChildren(updates, graph).replace(target);
    }

    return graph;
  }) as MergeRemoteChangesAction;


  /**
   * Returns the list of human-readable conflict messages accumulated during the
   * last run of this action.
   * @return  Array of conflict description strings
   */
  action.conflicts = function(): string[] {
    return _conflicts;
  };


  return action;
}
