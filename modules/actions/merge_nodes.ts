import { actionConnect } from './connect.js';
import { vecAdd, vecEqual, vecScale } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Merges multiple nodes into a single location.
 * This is a combination of:
 * 1. move all the nodes to a common location
 * 2. `actionConnect` them
 *
 * @param   nodeIDs  - Array of EntityIDs of nodes to merge
 * @param   loc      - Optional target location [lon, lat]
 * @return  An Action function that merges the nodes
 */
export function actionMergeNodes(nodeIDs: EntityID[], loc?: Vec2): Action {

  /**
   * Chooses the target location for the merged node.  If any of the nodes carry
   * interesting tags, the average of only those nodes is returned.  Otherwise the
   * average of all nodes is returned.  Returns `null` if there are no nodes.
   * @param   graph - The current graph
   * @return  Averaged [lon, lat] coordinate, or `null`
   */
  function _chooseLoc(graph: Graph): Vec2 | null {
    if (!nodeIDs.length) return null;

    let boringSum: Vec2 = [0, 0];
    let boringCount = 0;
    let interestingSum: Vec2 = [0, 0];
    let interestingCount = 0;

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID) as OsmNode;
      if (node.hasInterestingTags()) {
        interestingSum = vecAdd(interestingSum, node.loc!);
        interestingCount++;
      } else {
        boringSum = vecAdd(boringSum, node.loc!);
        boringCount++;
      }
    }

    if (interestingCount) {
      return vecScale(interestingSum, 1 / interestingCount);
    } else {
      return vecScale(boringSum, 1 / boringCount);
    }
  }


  const action = ((graph: Graph): Graph => {
    if (nodeIDs.length < 2) return graph;

    let toLoc = loc;
    if (!toLoc) {
      toLoc = _chooseLoc(graph)!;
    }

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID) as OsmNode;
      if (!vecEqual(node.loc!, toLoc)) {
        graph.replace(node.move(toLoc));
      }
    }

    graph = graph.commit();
    return actionConnect(nodeIDs)(graph);
  }) as Action;


  /**
   * Returns a reason string if the merge-nodes operation cannot be performed,
   * or `false` if it is allowed.
   * Also delegates to `actionConnect.disabled`, which may return its own reason keys.
   * @param   graph - The current graph
   * @return  `'not_eligible'` if fewer than two nodes are selected or any selected ID is not a node;
   *          `false` if the action is enabled
   */
  action.disabled = function(graph: Graph): string | false {
    if (nodeIDs.length < 2) return 'not_eligible';

    for (const nodeID of nodeIDs) {
      const entity = graph.entity(nodeID);
      if (entity.type !== 'node') return 'not_eligible';
    }

    return actionConnect(nodeIDs).disabled?.(graph) ?? false;
  };

  return action;
}
