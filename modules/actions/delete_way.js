import { osmNodeGeometriesForTags } from '../data/lib/tags.js';
import { actionDeleteRelation } from './delete_relation.js';


export function actionDeleteWay(wayID, doDeleteDegenerate = true) {
  return graph => {
    let way = graph.entity(wayID);

    // remove way from parent relations
    for (let parent of graph.parentRelations(way)) {
      parent = parent.removeMembersWithID(wayID);
      graph.replace(parent);
      if (doDeleteDegenerate && parent.isDegenerate()) {
        actionDeleteRelation(parent.id, doDeleteDegenerate)(graph);
      }
    }

    // remove child nodes from this way
    const nodeIDs = new Set(way.nodes);
    way = way.update({ nodes: [] });
    graph.replace(way);

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID);
      if (canDeleteNode(node, graph)) {
        graph.remove(node);
      }
    }

    // remove way
    return graph.remove(way).commit();
  };


  function canDeleteNode(node, graph) {
    // Don't delete nodes still attached to ways or relations
    if (graph.parentWays(node).length || graph.parentRelations(node).length) return false;

    const geometries = osmNodeGeometriesForTags(node.tags);
    if (geometries.point) return false;    // don't delete if this node can be a standalone point
    if (geometries.vertex) return true;    // do delete if this node can only be a vertex

    // If not sure, only delete if there are no interesting tags
    return !node.hasInterestingTags();
  }

}
