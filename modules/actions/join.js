import { geomPathIntersections } from '@rapid-sdk/math';
import { utilArrayGroupBy, utilArrayIdentical, utilArrayIntersection } from '@rapid-sdk/util';

import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';
import { osmIsInterestingTag } from '../data/lib/tags.js';
import { osmJoinWays } from '../data/lib/multipolygon.js';


// Join ways at the end node they share.
//
// This is the inverse of `actionSplit`.
//
export function actionJoin(ids, options = {}) {

  function groupEntitiesByGeometry(graph) {
    const ways = ids.map(id => graph.entity(id));
    const grouped = utilArrayGroupBy(ways, way => way.geometry(graph));
    return Object.assign({ line: [] }, grouped);
  }


  const action = graph => {
    const ways = ids.map(id => graph.entity(id));

    // if any of the ways are sided (e.g. coastline, cliff, kerb)
    // sort them first so they establish the overall order - iD#6033
    ways.sort(function(a, b) {
      const aSided = a.isSided();
      const bSided = b.isSided();
      return (aSided && !bSided) ? -1 : (bSided && !aSided) ? 1 : 0;
    });

    // Prefer to keep an existing way.
    // if there are multiple existing ways, keep the oldest one
    // the oldest way is determined by the ID of the way
    const survivorID = (
      ways
        .filter((way) => !way.isNew())
        .sort((a, b) => +a.osmId() - +b.osmId())[0] || ways[0]
    ).id;


    const sequences = osmJoinWays(ways, graph);
    const joined = sequences[0];

    // We might need to reverse some of these ways before joining them.  iD#4688
    // `joined.actions` property will contain any actions we need to apply.
    for (const fn of sequences.actions) {
      graph = fn(graph);
    }

    let survivor = graph.entity(survivorID);
    survivor = survivor.update({ nodes: joined.nodes.map(n => n.id) });
    graph.replace(survivor);

    for (const way of joined) {
      if (way.id === survivorID) continue;

      for (const parent of graph.parentRelations(way)) {
        graph.replace(parent.replaceMember(way, survivor));
      }

      survivor = survivor.mergeTags(way.tags);
      graph.replace(survivor);
      graph = actionDeleteWay(way.id)(graph);
    }

    // Rapid tagnosticRoadCombine - allow combining highways with conflicting tags
    if (options.tagnosticRoadCombine && ways.length && ways[0].tags.highway) {
      const newTags = Object.assign({}, survivor.tags);
      newTags.highway = ways[0].tags.highway;
      survivor = survivor.update({ tags: newTags });
      graph.replace(survivor);
    }

    // Did the join create a single-member multipolygon?
    // If so turn it into a basic area instead..
    checkForSimpleMultipolygon();
    return graph.commit();


    function checkForSimpleMultipolygon() {
      if (!survivor.isClosed()) return;

      // parent multipolygons where this survivor is the only remaining member
      const multipolygons = graph.parentRelations(survivor)
        .filter(relation => relation.isMultipolygon() && relation.members.length === 1);

      // skip if there are multiple parent multipolygons
      if (multipolygons.length !== 1) return;

      const multipolygon = multipolygons[0];
      for (var key in survivor.tags) {
        if (multipolygon.tags[key] &&
          // don't collapse if tags cannot be cleanly merged
          multipolygon.tags[key] !== survivor.tags[key]) return;
      }

      survivor = survivor.mergeTags(multipolygon.tags);
      graph.replace(survivor);
      graph = actionDeleteRelation(multipolygon.id, true, true /* allow untagged members */)(graph);

      const tags = Object.assign({}, survivor.tags);
      if (survivor.geometry(graph) !== 'area') {
        // ensure the feature persists as an area
        tags.area = 'yes';
      }
      delete tags.type; // remove type=multipolygon
      survivor = survivor.update({ tags: tags });
      graph.replace(survivor);
    }
  };

  // Returns the number of nodes the resultant way is expected to have
  action.resultingWayNodesLength = function(graph) {
    return ids.reduce(function(count, id) {
      return count + graph.entity(id).nodes.length;
    }, 0) - ids.length - 1;
  };


  action.disabled = function(graph) {
    const geometries = groupEntitiesByGeometry(graph);
    if (ids.length < 2 || ids.length !== geometries.line.length) {
      return 'not_eligible';
    }

    const joined = osmJoinWays(ids.map(graph.entity, graph), graph);
    if (joined.length > 1) {
      return 'not_adjacent';
    }

    let i;

    // All joined ways must belong to the same set of (non-restriction) relations.
    // Restriction relations have different logic, below, which allows some cases
    // this prohibits, and prohibits some cases this allows.
    // Important: compare sorted parentIDs, not sorted parents, see iD#10089 et al
    function _sortedParentIDs(id) {
      return graph.parentRelations(graph.entity(id))
        .filter((rel) => !rel.isRestriction() && !rel.isConnectivity())
        .map(rel => rel.id)
        .sort();   // sort as strings
    }

    const aParentIDs = _sortedParentIDs(ids[0]);
    for (i = 1; i < ids.length; i++) {
      const bParentIDs = _sortedParentIDs(ids[i]);
      if (!utilArrayIdentical(aParentIDs, bParentIDs)) {
        return 'conflicting_relations';
      }
    }

    // Loop through all combinations of path-pairs
    // to check potential intersections between all pairs
    for (i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const path1 = graph.childNodes(graph.entity(ids[i])).map(n => n.loc);
        const path2 = graph.childNodes(graph.entity(ids[j])).map(n => n.loc);
        const intersections = geomPathIntersections(path1, path2);

        // Check if intersections are just nodes lying on top of
        // each other/the line, as opposed to crossing it
        const common = utilArrayIntersection(
          joined[0].nodes.map(n => n.loc.toString()),
          intersections.map(n => n.toString())
        );
        if (common.length !== intersections.length) {
          return 'paths_intersect';
        }
      }
    }

    const nodeIDs = joined[0].nodes.map(n => n.id).slice(1, -1);
    let relation;
    let tags = {};
    let conflicting = false;

    joined[0].forEach(way => {
      const parents = graph.parentRelations(way);
      parents.forEach(parent => {
        if ((parent.isRestriction() || parent.isConnectivity()) && parent.members.some(function(m) { return nodeIDs.indexOf(m.id) >= 0; })) {
          relation = parent;
        }
      });

      for (var k in way.tags) {
        if (!(k in tags)) {
          tags[k] = way.tags[k];
        } else if (tags[k] && osmIsInterestingTag(k) && tags[k] !== way.tags[k]) {
          conflicting = true;

          // Rapid tagnosticRoadCombine - allow combining highways with conflicting tags
          if (k === 'highway' && options.tagnosticRoadCombine && !window.mocha) {
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
  };


  return action;
}
