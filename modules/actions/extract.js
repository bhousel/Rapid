import { OsmNode } from '../models/OsmNode.js';


export function actionExtract(entityID, viewport) {
  let _extractedNodeID;

  let action = function(graph) {
    const entity = graph.entity(entityID);
    if (entity.type === 'node') {
      return _extractFromNode(entity, graph);
    } else {
      return _extractFromWayOrRelation(entity, graph);
    }
  };


  function _extractFromNode(node, graph) {
    _extractedNodeID = node.id;

    // Create a new node to replace the one we will detach
    const replacement = new OsmNode(node.context, { loc: node.loc });
    graph = graph.replace(replacement);

    for (const parentWay of graph.parentWays(node)) {
      graph = graph.replace(parentWay.replaceNode(entityID, replacement.id));
    }
    for (const parentRelation of graph.parentRelations(node)) {
      graph = graph.replace(parentRelation.replaceMember(node, replacement));
    }
    return graph;
  }


  function _extractFromWayOrRelation(entity, graph) {
    const keysToCopyAndRetain = ['source', 'wheelchair'];
    const keysToRetain = ['area'];
    const buildingKeysToRetain = /architect|building|height|layer|nycdoitt:bin|roof/i;

    const poi = entity.geom.poi;  // Pole of Inaccessability (in world coords)
    if (!poi) return graph;

    const extractLoc = viewport.worldToWgs84(poi);

    const indoorAreaValues = {
      area: true,
      corridor: true,
      elevator: true,
      level: true,
      room: true
    };

    const isArea = (entity.geometry(graph) === 'area');
    const isIndoorArea = isArea && entity.tags.indoor && indoorAreaValues[entity.tags.indoor];
    const isBuilding = (entity.tags.building && entity.tags.building !== 'no') ||
      (entity.tags['building:part'] && entity.tags['building:part'] !== 'no');

    const entityTags = Object.assign({}, entity.tags);  // shallow copy
    const extractTags = {};

    for (const key in entityTags) {
      if (entity.type === 'relation' && key === 'type') continue;
      if (keysToRetain.indexOf(key) !== -1) continue;
      if (isIndoorArea && key === 'indoor') continue;   // leave `indoor` tag on the area
      if (isBuilding && buildingKeysToRetain.test(key)) continue;

      // Copy the tag from the entity to the extracted point
      extractTags[key] = entityTags[key];

      // Keep addresses, level, and some other tags on both features
      if (keysToCopyAndRetain.indexOf(key) !== -1 || key.match(/^addr:.{1,}/)) continue;
      if (isIndoorArea && key === 'level') continue;

      // Remove the tag from the entity
      delete entityTags[key];
    }

    if (isArea && !isBuilding && !isIndoorArea) {
      entityTags.area = 'yes';  // ensure that areas keep area geometry
    }

    const replacement = new OsmNode(entity.context, { loc: extractLoc, tags: extractTags });
    graph = graph.replace(replacement);
    _extractedNodeID = replacement.id;

    return graph.replace(entity.update({ tags: entityTags }));
  }


  action.getExtractedNodeID = function() {
    return _extractedNodeID;
  };

  return action;
}
