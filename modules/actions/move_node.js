import { vecInterp } from '@rapid-sdk/math';

export function actionMoveNode(nodeID, toLoc) {

  const action = (graph, t) => {
    if (t === null || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    let node = graph.entity(nodeID);
    node = node.move(vecInterp(node.loc, toLoc, t));

    return graph.replace(node).commit();
  };

  action.transitionable = true;

  return action;
}
