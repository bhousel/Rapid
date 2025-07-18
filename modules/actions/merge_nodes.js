import { vecEqual, vecAdd, vecScale } from '@rapid-sdk/math';

import { actionConnect } from './connect.js';


// `actionMergeNodes` is just a combination of:
//
// 1. move all the nodes to a common location
// 2. `actionConnect` them

export function actionMergeNodes(nodeIDs, loc) {

  // If there are "interesting" nodes, average those only.
  // Otherwise average whatever nodes we are passed.
  function _chooseLoc(graph) {
    if (!nodeIDs.length) return null;

    let boringSum = [0,0];
    let boringCount = 0;
    let interestingSum = [0,0];
    let interestingCount = 0;

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID);
      if (node.hasInterestingTags()) {
        interestingSum = vecAdd(interestingSum, node.loc);
        interestingCount++;
      } else {
        boringSum = vecAdd(boringSum, node.loc);
        boringCount++;
      }
    }

    if (interestingCount) {
      return vecScale(interestingSum, 1 / interestingCount);
    } else {
      return vecScale(boringSum, 1 / boringCount);
    }
  }


  const action = graph => {
    if (nodeIDs.length < 2) return graph;

    let toLoc = loc;
    if (!toLoc) {
      toLoc = _chooseLoc(graph);
    }

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID);
      if (!vecEqual(node.loc, toLoc)) {
        graph.replace(node.move(toLoc));
      }
    }

    graph = graph.commit();
    return actionConnect(nodeIDs)(graph);
  };


  action.disabled = function(graph) {
    if (nodeIDs.length < 2) return 'not_eligible';

    for (const nodeID of nodeIDs) {
      const entity = graph.entity(nodeID);
      if (entity.type !== 'node') return 'not_eligible';
    }

    return actionConnect(nodeIDs).disabled(graph);
  };

  return action;
}
