import { OsmNode } from '../data/OsmNode.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/** Connection info returned by actionDisconnect.connections */
export interface DisconnectConnection {
  wayID: EntityID;
  index: number;
}

/** Interface for disconnect action with limitWays and connections methods */
export interface DisconnectAction extends Action {
  connections(graph: Graph): DisconnectConnection[];
  limitWays(): EntityID[] | undefined;
  limitWays(val: EntityID[]): DisconnectAction;
}


/**
 * Disconnects the ways at the given node.
 * Optionally, disconnect only the given ways.
 *
 * For testing convenience, accepts a `newNodeID` to assign to the (first) new node.
 * (Normally, new entities are automatically assigned the next available number).
 *
 * This is the inverse of `actionConnect`.
 *
 * @param   nodeID     - EntityID of the node to disconnect
 * @param   newNodeID  - Optional EntityID for the new node
 * @return  An Action function that disconnects the given ways
 */
export function actionDisconnect(nodeID: EntityID, newNodeID?: EntityID): DisconnectAction {
  let _wayIDs: EntityID[] | undefined;

  const action = ((graph: Graph): Graph => {
    const node = graph.entity(nodeID) as OsmNode;
    const connections = action.connections(graph);

    connections.forEach(connection => {
      const way = graph.entity(connection.wayID) as OsmWay;
      const newNode = new OsmNode(way.context, { id: newNodeID, loc: node.loc, tags: node.tags });

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
  }) as DisconnectAction;


  /**
   * Returns the list of way/index pairs where the node should be replaced by a
   * new duplicate node in order to disconnect it from the other ways.
   * If `limitWays` has been set, only those ways are included; all others keep
   * the original node.
   * @param   graph - The current graph
   * @return  Array of connection descriptors (way ID and node index)
   */
  action.connections = function(graph: Graph): DisconnectConnection[] {
    const candidates: DisconnectConnection[] = [];
    let keeping = false;
    const parentWays = graph.parentWays(graph.entity(nodeID));

    for (const way of parentWays) {
      if (_wayIDs && _wayIDs.indexOf(way.id) === -1) {
        keeping = true;
        continue;
      }
      if (way.isArea() && (way.nodes[0] === nodeID)) {
        candidates.push({ wayID: way.id, index: 0 });
      } else {
        for (let j = 0; j < way.nodes.length; j++) {
          const waynode = way.nodes[j];
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


  /**
   * Returns a reason string if the disconnect operation cannot be performed,
   * or `false` if it is allowed.
   * Disconnecting is disabled when there are no connections to split, or when
   * the affected ways share a relation (which would be broken by the split).
   * @param   graph - The current graph
   * @return  A string key describing the problem, or `false` if enabled
   */
  action.disabled = function(graph: Graph): string | false {
    const connections = action.connections(graph);
    if (connections.length === 0) return 'not_connected';

    const node = graph.entity(nodeID);
    const seenRelationIDs = new Map<EntityID, EntityID>();  // Map<RelationID, WayID>
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
    return false;
  };


  /**
   * Gets or sets the list of way IDs that the disconnect should be limited to.
   * When called with no argument, returns the current filter.
   * When called with an array, stores it and returns the action for chaining.
   * @param   val - Optional array of way IDs to limit the disconnect to
   * @return  Current way IDs when called as getter, or the action when called as setter
   */
  action.limitWays = function(val?: EntityID[]): any {
    if (!arguments.length) return _wayIDs;
    _wayIDs = val;
    return action;
  };


  return action;
}
