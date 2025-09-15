import { utilArrayGroupBy, utilArrayUniq } from '@rapid-sdk/util';

import { osmTagSuggestingArea } from '../data/lib/tags.js';


export function actionMerge(ids) {

  function groupEntitiesByGeometry(graph) {
    const entities = ids.map(id => graph.entity(id));
    const grouped = utilArrayGroupBy(entities, entity => entity.geometry(graph));
    return Object.assign(
      { point: [], area: [], line: [], relation: [] },
      grouped
    );
  }


  const action = graph => {
    const geometries = groupEntitiesByGeometry(graph);
    const points = geometries.point;
    let target = geometries.area[0] || geometries.line[0];

    points.forEach(point => {
      target = target.mergeTags(point.tags);
      graph.replace(target);

      graph.parentRelations(point).forEach(parent => {
        graph.replace(parent.replaceMember(point, target));
      });

      const nodes = utilArrayUniq(graph.childNodes(target));
      let removeNode = point;

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (graph.parentWays(node).length > 1 ||
          graph.parentRelations(node).length ||
          node.hasInterestingTags()) {
          continue;
        }

        // Found an uninteresting child node on the target way.
        // Move orig point into its place to preserve point's history. iD#3683
        graph.replace(point.update({ tags: {}, loc: node.loc }));
        target = target.replaceNode(node.id, point.id);
        graph.replace(target);
        removeNode = node;
        break;
      }

      graph.remove(removeNode);
    });

    if (target.tags.area === 'yes') {
      const tags = Object.assign({}, target.tags);  // shallow copy
      delete tags.area;
      if (osmTagSuggestingArea(tags)) {
        // remove the `area` tag if area geometry is now implied - iD#3851
        target = target.update({ tags: tags });
        graph.replace(target);
      }
    }

    return graph.commit();
  };


  action.disabled = function(graph) {
    const geometries = groupEntitiesByGeometry(graph);
    if (geometries.point.length === 0 ||
      (geometries.area.length + geometries.line.length) !== 1 ||
      geometries.relation.length !== 0) {
      return 'not_eligible';
    }
  };


  return action;
}
