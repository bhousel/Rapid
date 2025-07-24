import { osmNodeGeometriesForTags } from '../models/tags.js';
import { actionDeleteRelation } from './delete_relation.js';


export function actionDeleteWay(wayID) {
  return graph => {
    const way = graph.entity(wayID);

    graph.parentRelations(way)
      .forEach(parent => {
        parent = parent.removeMembersWithID(wayID);
        graph.replace(parent);

        if (parent.isDegenerate()) {
          graph = actionDeleteRelation(parent.id)(graph);
        }
      });

    (new Set(way.nodes)).forEach(nodeID => {
        graph.replace(way.removeNode(nodeID));

        const node = graph.entity(nodeID);
        if (canDeleteNode(node, graph)) {
          graph.remove(node);
        }
    });

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
