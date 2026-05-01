import { OsmRelation, OsmRelationMember } from '../data/OsmRelation.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Turn } from '../lib/intersection.ts';


/**
 * Creates a turn restriction relation.
 *
 * `turn` must be an object conforming to `Turn`
 * see lib/intersection.ts, pathToTurn()
 *
 * This specifies a restriction of type `restriction` when traveling from
 * `turn.from.way` toward `turn.to.way` via `turn.via.node` OR `turn.via.ways`.
 * (The action does not check that these entities form a valid intersection.)
 *
 * From, to, and via ways should be split before calling this action.
 * (old versions of the code would split the ways here, but we no longer do it)
 *
 * @param   turn            - Turn object describing the turn to restrict
 * @param   restrictionType - The type of restriction (e.g. 'no_left_turn')
 * @param   restrictionID   - Optional ID for the new relation (for testing)
 * @return  An Action function that creates the restriction in the graph
 */
export function actionRestrictTurn(turn: Turn, restrictionType: string, restrictionID?: EntityID): Action {

  return (graph: Graph): Graph => {
    const fromWay = graph.entity(turn.from.way);
    const toWay = graph.entity(turn.to.way);
    const viaNode = turn.via.node && graph.entity(turn.via.node);
    const viaWays = turn.via.ways && turn.via.ways.map(id => graph.entity(id));
    const members: OsmRelationMember[] = [];

    // FROM
    members.push({ id: fromWay.id, type: 'way',  role: 'from' });

    // VIA
    if (viaNode) {
      members.push({ id: viaNode.id,  type: 'node', role: 'via' });
    } else if (viaWays) {
      for (const viaWay of viaWays) {
        members.push({ id: viaWay.id,  type: 'way', role: 'via' });
      }
    }

    // TO
    members.push({ id: toWay.id, type: 'way',  role: 'to' });

    const relation = new OsmRelation(fromWay.context, {
      id: restrictionID,
      tags: {
        type: 'restriction',
        restriction: restrictionType
      },
      members: members
    });

    return graph.replace(relation).commit();
  };
}
