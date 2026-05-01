import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';
import { geomPathIntersections } from '@rapid-sdk/math';
import { osmJoinWays } from '../lib/multipolygon.ts';
import { utilArrayGroupBy, utilArrayIdentical, utilArrayIntersection } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { EntityType, OsmNode, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { JoinedWaysResult } from '../lib/multipolygon.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Options for the actionJoin function.
 */
export interface JoinOptions {
  /** If true, allow combining highways with conflicting tags (Rapid feature) */
  tagnosticRoadCombine?: boolean;
}


/**
 * Extended Action for join operations that includes additional methods.
 */
interface JoinAction extends Action {
  /** Returns the number of nodes the resultant way is expected to have */
  resultingWayNodesLength(graph: Graph): number;
}


/** Geometry type returned from groupEntitiesByGeometry */
interface GroupedGeometries {
  line: OsmWay[];
  [key: string]: OsmWay[];
}


/**
 * Joins ways at their shared end nodes.
 * Sided ways (coastlines, cliffs, kerbs) are processed first to establish order.
 * The oldest existing way is preserved, and others are merged into it.
 *
 * This is the inverse of `actionSplit`.
 *
 * @param   ids      - Array of EntityIDs of ways to join
 * @param   options  - Optional JoinOptions
 * @return  A JoinAction that joins the ways
 */
export function actionJoin(ids: EntityID[], options: JoinOptions = {}): JoinAction {

  function groupEntitiesByGeometry(graph: Graph): GroupedGeometries {
    const ways: OsmWay[] = ids.map(id => graph.entity(id) as OsmWay);
    const grouped = utilArrayGroupBy(ways, (way: OsmWay) => way.geometry(graph));
    return Object.assign({ line: [] as OsmWay[] }, grouped) as GroupedGeometries;
  }


  const action = ((graph: Graph): Graph => {
    const ways: OsmWay[] = ids.map(id => graph.entity(id) as OsmWay);

    // if any of the ways are sided (e.g. coastline, cliff, kerb)
    // sort them first so they establish the overall order - iD#6033
    ways.sort((a: OsmWay, b: OsmWay): number => {
      const aSided = a.isSided();
      const bSided = b.isSided();
      return (aSided && !bSided) ? -1 : (bSided && !aSided) ? 1 : 0;
    });

    // Prefer to keep an existing way.
    // if there are multiple existing ways, keep the oldest one
    // the oldest way is determined by the ID of the way
    const survivorID: EntityID = (
      ways
        .filter((way: OsmWay) => !way.isNew())
        .sort((a: OsmWay, b: OsmWay) => +a.osmId() - +b.osmId())[0] || ways[0]
    ).id;


    const sequences: JoinedWaysResult = osmJoinWays(ways, graph);
    const joined = sequences[0];

    // We might need to reverse some of these ways before joining them.  iD#4688
    // `joined.actions` property will contain any actions we need to apply.
    for (const fn of sequences.actions) {
      graph = fn(graph);
    }

    let survivor: OsmWay = graph.entity(survivorID) as OsmWay;
    survivor = survivor.update({ nodes: joined.nodes.map((n: OsmNode) => n.id) });
    graph.replace(survivor);

    for (const way of joined) {
      if (way.id === survivorID) continue;

      // Use way directly since it has the correct (possibly reversed) tags from osmJoinWays
      const wayEntity = way as OsmWay;
      for (const parent of graph.parentRelations(graph.entity(way.id))) {
        graph.replace(parent.replaceMember({ id: way.id }, { id: survivor.id, type: survivor.type as EntityType }));
      }

      survivor = survivor.mergeTags(wayEntity.tags);
      graph.replace(survivor);
      graph = actionDeleteWay(way.id)(graph);
    }

    // Rapid tagnosticRoadCombine - allow combining highways with conflicting tags
    if (options.tagnosticRoadCombine && ways.length && ways[0].tags.highway) {
      const newTags: OsmTags = { ...survivor.tags };  // shallow copy
      newTags.highway = ways[0].tags.highway;
      survivor = survivor.update({ tags: newTags });
      graph.replace(survivor);
    }

    // Did the join create a single-member multipolygon?
    // If so turn it into a basic area instead..
    checkForSimpleMultipolygon();
    return graph.commit();


    function checkForSimpleMultipolygon(): void {
      if (!survivor.isClosed()) return;

      // parent multipolygons where this survivor is the only remaining member
      const multipolygons: OsmRelation[] = graph.parentRelations(survivor)
        .filter((relation: OsmRelation) => relation.isMultipolygon() && relation.members.length === 1);

      // skip if there are multiple parent multipolygons
      if (multipolygons.length !== 1) return;

      const multipolygon: OsmRelation = multipolygons[0];
      for (const key in survivor.tags) {
        if (multipolygon.tags[key] &&
          // don't collapse if tags cannot be cleanly merged
          multipolygon.tags[key] !== survivor.tags[key]) return;
      }

      survivor = survivor.mergeTags(multipolygon.tags);
      graph.replace(survivor);
      graph = actionDeleteRelation(multipolygon.id, true, true /* allow untagged members */)(graph);

      const tags: OsmTags = { ...survivor.tags };  // shallow copy
      if (survivor.geometry(graph) !== 'area') {
        // ensure the feature persists as an area
        tags.area = 'yes';
      }
      delete tags.type; // remove type=multipolygon
      survivor = survivor.update({ tags: tags });
      graph.replace(survivor);
    }
  }) as JoinAction;

  // Returns the number of nodes the resultant way is expected to have
  action.resultingWayNodesLength = function(graph: Graph): number {
    return ids.reduce(function(count: number, id: EntityID): number {
      return count + (graph.entity(id) as OsmWay).nodes.length;
    }, 0) - ids.length - 1;
  };


  action.disabled = function(graph: Graph): string | false {
    const geometries: GroupedGeometries = groupEntitiesByGeometry(graph);
    if (ids.length < 2 || ids.length !== geometries.line.length) {
      return 'not_eligible';
    }

    const joined: JoinedWaysResult = osmJoinWays(ids.map((id: EntityID) => graph.entity(id) as OsmWay), graph);
    if (joined.length > 1) {
      return 'not_adjacent';
    }

    let i: number;

    // All joined ways must belong to the same set of (non-restriction) relations.
    // Restriction relations have different logic, below, which allows some cases
    // this prohibits, and prohibits some cases this allows.
    // Important: compare sorted parentIDs, not sorted parents, see iD#10089 et al
    function _sortedParentIDs(id: EntityID): EntityID[] {
      return graph.parentRelations(graph.entity(id) as OsmWay)
        .filter((rel: OsmRelation) => !rel.isRestriction() && !rel.isConnectivity())
        .map((rel: OsmRelation) => rel.id)
        .sort();   // sort as strings
    }

    const aParentIDs: EntityID[] = _sortedParentIDs(ids[0]);
    for (i = 1; i < ids.length; i++) {
      const bParentIDs: EntityID[] = _sortedParentIDs(ids[i]);
      if (!utilArrayIdentical(aParentIDs, bParentIDs)) {
        return 'conflicting_relations';
      }
    }

    // Loop through all combinations of path-pairs
    // to check potential intersections between all pairs
    for (i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const path1 = graph.childNodes(graph.entity(ids[i]) as OsmWay).map(n => n.loc!);
        const path2 = graph.childNodes(graph.entity(ids[j]) as OsmWay).map(n => n.loc!);
        const intersections = geomPathIntersections(path1, path2);

        // Check if intersections are just nodes lying on top of
        // each other/the line, as opposed to crossing it
        const common = utilArrayIntersection(
          joined[0].nodes.map((n: OsmNode) => n.loc!.toString()),
          intersections.map((n: Vec2) => n.toString())
        );
        if (common.length !== intersections.length) {
          return 'paths_intersect';
        }
      }
    }

    const nodeIDs: EntityID[] = joined[0].nodes.map((n: OsmNode) => n.id).slice(1, -1);
    let relation: OsmRelation | undefined;
    const tags: OsmTags = {};
    let conflicting = false;

    joined[0].forEach((item) => {
      const way: OsmWay = graph.entity(item.id) as OsmWay;
      const parents: OsmRelation[] = graph.parentRelations(way);
      parents.forEach((parent: OsmRelation) => {
        if ((parent.isRestriction() || parent.isConnectivity()) && parent.members.some(function(m) { return nodeIDs.indexOf(m.id) >= 0; })) {
          relation = parent;
        }
      });

      for (const k in way.tags) {
        if (!(k in tags)) {
          tags[k] = way.tags[k];
        } else if (tags[k] && way.isInterestingTag(k) && tags[k] !== way.tags[k]) {
          conflicting = true;

          // Rapid tagnosticRoadCombine - allow combining highways with conflicting tags
          if (k === 'highway' && options.tagnosticRoadCombine) {
            conflicting = false;
          }
        }
    }
    });

    if (relation) {
      return relation.isRestriction() ? 'restriction' : 'connectivity';
    }

    if (conflicting) {
      return 'conflicting_tags';
    }

    return false;
  };


  return action;
}
