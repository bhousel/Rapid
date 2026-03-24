import { actionDeleteMultiple } from './delete_multiple.js';
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
 * actionMergeRemoteChanges
 * Merges remote changes from the OSM API with local edits.
 * Handles conflicts in location, tags, nodes, and members.
 * Uses diff3 algorithm for tag merging when possible.
 *
 * @param   id       - EntityID of the entity to merge
 * @param   options  - Merge options including local/remote graphs and strategy
 * @return  A MergeRemoteChangesAction that merges changes and tracks conflicts
 */
export function actionMergeRemoteChanges(id: EntityID, options: MergeRemoteChangesOptions): MergeRemoteChangesAction {
  const localGraph = options.localGraph;
  const remoteGraph = options.remoteGraph;
  const discardTags = options.discardTags ?? {};
  const formatUser = options.formatUser ?? ((d: string) => d);
  const localize = options.localize ?? ((d: string) => d);
  const strategy = options.strategy ?? 'safe';   // 'safe', 'force_local', 'force_remote'

  const _conflicts: string[] = [];


  function mergeLocation(remote: OsmNode, target: OsmNode): OsmNode {
    const EPSILON = 1e-6;
    if (strategy === 'force_local' || vecEqual(target.loc!, remote.loc!, EPSILON)) {
      return target;
    }
    if (strategy === 'force_remote') {
      return target.update({ loc: remote.loc });
    }

    _conflicts.push(
      localize('merge_remote_changes.conflict.location', { user: formatUser(remote.props.user ?? 'unknown') })
    );
    return target;
  }


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


  function mergeChildren(targetWay: OsmWay, children: EntityID[], updates: ChildUpdates, graph: Graph): OsmWay {
    function isUsed(node: OsmNode, targetWay: OsmWay): boolean {
      const hasInterestingParent = graph.parentWays(node).some((way: OsmWay) => way.id !== targetWay.id);
      return node.hasInterestingTags() || hasInterestingParent || graph.parentRelations(node).length > 0;
    }

    const origLength = _conflicts.length;

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
      let target: OsmNode;

      if (strategy === 'force_remote' && remote && remote.visible) {
        updates.replacements.push(remote);

      } else if (strategy === 'force_local' && local) {
        target = createOsmEntity(local) as OsmNode;
        if (remote) {
          target = target.update({ version: remote.version });
        }
        updates.replacements.push(target);

      } else if (strategy === 'safe' && local && remote && local.version !== remote.version) {
        target = createOsmEntity(local, { version: remote.version }) as OsmNode;
        if (remote.visible) {
          target = mergeLocation(remote, target);
        } else {
          _conflicts.push(
            localize('merge_remote_changes.conflict.deleted', { user: formatUser(remote.props.user ?? 'unknown') })
          );
        }

        if (_conflicts.length !== origLength) break;
        updates.replacements.push(target);
      }
    }

    return targetWay;
  }


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
    const tags: OsmTags = Object.assign({}, a);   // shallow copy
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
    const local = localGraph.entity(id);
    const remote = remoteGraph.entity(id);
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
      target = mergeLocation(remote as OsmNode, target as OsmNode);

    } else if (target.type === 'way') {
      // pull in any child nodes that may not be present locally..
      graph.rebase(remoteGraph.childNodes(remote as OsmWay), [graph], false);
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


  action.conflicts = function(): string[] {
    return _conflicts;
  };


  return action;
}
