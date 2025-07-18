import { OsmNode } from '../models/OsmNode.js';


// Disconnect the ways at the given node.
//
// Optionally, disconnect only the given ways.
//
// For testing convenience, accepts an `newNodeID` to assign to the (first) new node.
// (Normally, new entities are automatically assigned the next available number).
//
// This is the inverse of `actionConnect`.
//
export function actionDisconnect(nodeID, newNodeID) {
  let _wayIDs;

  const action = graph => {
    const node = graph.entity(nodeID);
    const connections = action.connections(graph);

    connections.forEach(connection => {
      var way = graph.entity(connection.wayID);
      var newNode = new OsmNode(way.context, { id: newNodeID, loc: node.loc, tags: node.tags });

      graph.replace(newNode);
      if (connection.index === 0 && way.isArea()) {
        // replace shared node with shared node..
        graph.replace(way.replaceNode(way.nodes[0], newNode.id));
      } else if (way.isClosed() && connection.index === way.nodes.length - 1) {
        // replace closing node with new new node..
        graph.replace(way.unclose().addNode(newNode.id));
      } else {
        // replace shared node with multiple new nodes..
        graph.replace(way.updateNode(newNode.id, connection.index));
      }
    });

    return graph.commit();
  };


  action.connections = function(graph) {
    let candidates = [];
    let keeping = false;
    let parentWays = graph.parentWays(graph.entity(nodeID));
    let way, waynode;
    for (let i = 0; i < parentWays.length; i++) {
      way = parentWays[i];
      if (_wayIDs && _wayIDs.indexOf(way.id) === -1) {
        keeping = true;
        continue;
      }
      if (way.isArea() && (way.nodes[0] === nodeID)) {
        candidates.push({ wayID: way.id, index: 0 });
      } else {
        for (let j = 0; j < way.nodes.length; j++) {
          waynode = way.nodes[j];
          if (waynode === nodeID) {
            if (way.isClosed() &&
              parentWays.length > 1 &&
              _wayIDs &&
              _wayIDs.indexOf(way.id) !== -1 &&
              j === way.nodes.length - 1
            ) {
              continue;
            }
            candidates.push({ wayID: way.id, index: j });
          }
        }
      }
    }

    if (keeping) {
      return candidates;
    } else {
      // if nodeID is positive, make sure a positive way retains it
      if (nodeID[1] !== '-' && candidates.length > 1 &&
        candidates[0].wayID[1] === '-') {
        for (let pos = 1; pos < candidates.length; pos++) {
          if (candidates[pos].wayID[1] !== '-') {
            candidates.splice(pos, 1);
            return candidates;
          }
        }
      }
      return candidates.slice(1);
    }
  };


  action.disabled = function(graph) {
    const connections = action.connections(graph);
    if (connections.length === 0) return 'not_connected';

    const node = graph.entity(nodeID);
    const seenRelationIDs = new Map();  // Map<relationID, wayID>
    let sharedRelation;

    for (const way of graph.parentWays(node)) {
      for (const relation of graph.parentRelations(way)) {

        const seenWayID = seenRelationIDs.get(relation.id);
        if (seenWayID) {
          if (_wayIDs) {
            if (_wayIDs.includes(way.id) || _wayIDs.includes(seenWayID)) {
              sharedRelation = relation;
              break;
            }
          } else {
            sharedRelation = relation;
            break;
          }
        } else {
          seenRelationIDs.set(relation.id, way.id);
        }
      }
    }

    if (sharedRelation) return 'relation';
  };


  action.limitWays = function(val) {
    if (!arguments.length) return _wayIDs;
    _wayIDs = val;
    return action;
  };


  return action;
}
