import { geomPathIntersections, geomPathLength, vecAdd, vecAngle, vecEqual, vecInterp, vecSubtract } from '@rapid-sdk/math';
import { utilArrayIntersection } from '@rapid-sdk/util';

import { geoChooseEdge } from '../geo/index.js';
import { OsmNode } from '../data/OsmNode.js';


export function actionMove(moveIDs, tryDelta, viewport, cache) {
  let _delta = tryDelta;

  function setupCache(graph) {
    function canMove(nodeID) {
      // Allow movement of any node that is in the moveIDs list..
      if (moveIDs.includes(nodeID)) return true;

      // Allow movement of a vertex where 2 ways meet..
      const parents = graph.parentWays(graph.entity(nodeID));
      if (parents.length < 3) return true;

      // Restrict movement of a vertex where >2 ways meet, unless all parentWays are moving too..
      const areParentsMoving = parents.every(way => cache.moving[way.id]);
      if (!areParentsMoving) delete cache.moving[nodeID];

      return areParentsMoving;
    }

    function cacheEntities(ids) {
      for (const id of ids) {
        if (cache.moving[id]) continue;
        cache.moving[id] = true;

        const entity = graph.hasEntity(id);
        if (!entity) continue;

        if (entity.type === 'node') {
          cache.nodes.push(id);
          cache.startLoc[id] = entity.loc;
        } else if (entity.type === 'way') {
          cache.ways.push(id);
          cacheEntities(entity.nodes);
        } else {
          cacheEntities(entity.members.map(m => m.id));
        }
      }
    }

    function cacheIntersections(ids) {
      function isEndpoint(way, id) {
        return !way.isClosed() && !!way.affix(id);
      }

      for (const id of ids) {
        // consider only intersections with 1 moved and 1 unmoved way.
        const childNodes = graph.childNodes(graph.entity(id));
        for (const node of childNodes) {
          const parents = graph.parentWays(node);
          if (parents.length !== 2) continue;

          const moved = graph.entity(id);
          let unmoved = null;
          for (const way of parents) {
            if (!cache.moving[way.id]) {
              unmoved = way;
              break;
            }
          }
          if (!unmoved) continue;

          // exclude ways that are overly connected..
          if (utilArrayIntersection(moved.nodes, unmoved.nodes).length > 2) continue;
          if (moved.isArea() || unmoved.isArea()) continue;

          cache.intersections.push({
            nodeID: node.id,
            movedId: moved.id,
            unmovedId: unmoved.id,
            movedIsEP: isEndpoint(moved, node.id),
            unmovedIsEP: isEndpoint(unmoved, node.id)
          });
        }
      }
    }


    if (!cache) {
      cache = {};
    }
    if (!cache.ok) {
      cache.moving = {};
      cache.intersections = [];
      cache.replacedVertex = {};
      cache.startLoc = {};
      cache.nodes = [];
      cache.ways = [];

      cacheEntities(moveIDs);
      cacheIntersections(cache.ways);
      cache.nodes = cache.nodes.filter(canMove);

      cache.ok = true;
    }
  }


  // Place a vertex where the moved vertex used to be, to preserve way shape..
  //
  //  Start:
  //      b ---- e
  //     / \
  //    /   \
  //   /     \
  //  a       c
  //
  //      *               node '*' added to preserve shape
  //     / \
  //    /   b ---- e      way `b,e` moved here:
  //   /     \
  //  a       c
  //
  //
  function replaceMovedVertex(nodeID, wayID, graph, delta) {
    let way = graph.entity(wayID);
    const moved = graph.entity(nodeID);
    const movedIndex = way.nodes.indexOf(nodeID);
    let len, prevIndex, nextIndex;

    if (way.isClosed()) {
      len = way.nodes.length - 1;
      prevIndex = (movedIndex + len - 1) % len;
      nextIndex = (movedIndex + len + 1) % len;
    } else {
      len = way.nodes.length;
      prevIndex = movedIndex - 1;
      nextIndex = movedIndex + 1;
    }

    const prev = graph.hasEntity(way.nodes[prevIndex]);
    const next = graph.hasEntity(way.nodes[nextIndex]);

    // Don't add orig vertex at endpoint..
    if (!prev || !next) return graph;

    const key = `${wayID}:${nodeID}`;
    let orig = cache.replacedVertex[key];
    if (!orig) {
      orig = new OsmNode(way.context);
      cache.replacedVertex[key] = orig;
      cache.startLoc[orig.id] = cache.startLoc[nodeID];
    }

    let start, end;
    if (delta) {
      start = viewport.project(cache.startLoc[nodeID]);
      end = viewport.unproject(vecAdd(start, delta));
    } else {
      end = cache.startLoc[nodeID];
    }
    orig = orig.move(end);

    const o = viewport.project(orig.loc);
    const a = viewport.project(prev.loc);
    const b = viewport.project(next.loc);
    const angle = Math.abs(vecAngle(o, a) - vecAngle(o, b)) * (180 / Math.PI);

    // Don't add orig vertex if it would just make a straight line..
    if (angle > 175 && angle < 185) return graph;

    // moving forward or backward along way?
    const p1 = [prev.loc, orig.loc, moved.loc, next.loc].map(loc => viewport.project(loc));
    const p2 = [prev.loc, moved.loc, orig.loc, next.loc].map(loc => viewport.project(loc));
    const d1 = geomPathLength(p1);
    const d2 = geomPathLength(p2);
    let insertAt = (d1 <= d2) ? movedIndex : nextIndex;

    // moving around closed loop?
    if (way.isClosed() && insertAt === 0) insertAt = len;

    way = way.addNode(orig.id, insertAt);
    return graph.replace(orig).replace(way).commit();
  }


  // Remove duplicate vertex that might have been added by
  // replaceMovedVertex.  This is done after the unzorro checks.
  function removeDuplicateVertices(wayID, graph) {
    let way = graph.entity(wayID);
    let epsilon = 1e-6;
    let prev, curr;

    function isInteresting(node, graph) {
      return graph.parentWays(node).length > 1 ||
        graph.parentRelations(node).length ||
        node.hasInterestingTags();
    }

    for (const nodeID of way.nodes) {
      curr = graph.entity(nodeID);

      if (prev && curr && vecEqual(prev.loc, curr.loc, epsilon)) {
        if (!isInteresting(prev, graph)) {
          way = way.removeNode(prev.id);
          graph.replace(way).remove(prev);
        } else if (!isInteresting(curr, graph)) {
          way = way.removeNode(curr.id);
          graph.replace(way).remove(curr);
        }
      }

      prev = curr;
    }

    return graph.commit();
  }


  // Reorder nodes around intersections that have moved..
  //
  //  Start:                way1.nodes: b,e         (moving)
  //  a - b - c ----- d     way2.nodes: a,b,c,d     (static)
  //      |                 vertex: b
  //      e                 isEP1: true,  isEP2, false
  //
  //  way1 `b,e` moved here:
  //  a ----- c = b - d
  //              |
  //              e
  //
  //  reorder nodes         way1.nodes: b,e
  //  a ----- c - b - d     way2.nodes: a,c,b,d
  //              |
  //              e
  //
  function unZorroIntersection(intersection, graph) {
    const vertex = graph.entity(intersection.nodeID);
    let way1 = graph.entity(intersection.movedId);
    let way2 = graph.entity(intersection.unmovedId);
    const isEP1 = intersection.movedIsEP;
    const isEP2 = intersection.unmovedIsEP;

    // don't move the vertex if it is the endpoint of both ways.
    if (isEP1 && isEP2) return graph;

    const nodes1 = graph.childNodes(way1).filter(n => n !== vertex);
    const nodes2 = graph.childNodes(way2).filter(n => n !== vertex);

    if (way1.isClosed() && way1.first() === vertex.id) nodes1.push(nodes1[0]);
    if (way2.isClosed() && way2.first() === vertex.id) nodes2.push(nodes2[0]);

    let edge1 = !isEP1 && geoChooseEdge(nodes1, viewport.project(vertex.loc), viewport);
    let edge2 = !isEP2 && geoChooseEdge(nodes2, viewport.project(vertex.loc), viewport);
    let loc;

    // snap vertex to nearest edge (or some point between them)..
    if (!isEP1 && !isEP2) {
      const epsilon = 1e-6, maxIter = 10;
      for (let i = 0; i < maxIter; i++) {
        loc = vecInterp(edge1.loc, edge2.loc, 0.5);
        edge1 = geoChooseEdge(nodes1, viewport.project(loc), viewport);
        edge2 = geoChooseEdge(nodes2, viewport.project(loc), viewport);
        if (Math.abs(edge1.distance - edge2.distance) < epsilon) break;
      }
    } else if (!isEP1) {
      loc = edge1.loc;
    } else {
      loc = edge2.loc;
    }

    graph.replace(vertex.move(loc));

    // if zorro happened, reorder nodes..
    if (!isEP1 && edge1.index !== way1.nodes.indexOf(vertex.id)) {
      way1 = way1.removeNode(vertex.id).addNode(vertex.id, edge1.index);
      graph.replace(way1);
    }
    if (!isEP2 && edge2.index !== way2.nodes.indexOf(vertex.id)) {
      way2 = way2.removeNode(vertex.id).addNode(vertex.id, edge2.index);
      graph.replace(way2);
    }

    return graph.commit();
  }


  function cleanupIntersections(graph) {
    for (let i = 0; i < cache.intersections.length; i++) {
      const obj = cache.intersections[i];
      graph = replaceMovedVertex(obj.nodeID, obj.movedId, graph, _delta);
      graph = replaceMovedVertex(obj.nodeID, obj.unmovedId, graph, null);
      graph = unZorroIntersection(obj, graph);
      graph = removeDuplicateVertices(obj.movedId, graph);
      graph = removeDuplicateVertices(obj.unmovedId, graph);
    }

    return graph;
  }


  // check if moving way endpoint can cross an unmoved way, if so limit delta..
  function limitDelta(graph) {
    function moveNode(loc) {
      return vecAdd(viewport.project(loc), _delta);
    }

    for (var i = 0; i < cache.intersections.length; i++) {
      var obj = cache.intersections[i];

      // Don't limit movement if this is vertex joins 2 endpoints..
      if (obj.movedIsEP && obj.unmovedIsEP) continue;
      // Don't limit movement if this vertex is not an endpoint anyway..
      if (!obj.movedIsEP) continue;

      var node = graph.entity(obj.nodeID);
      var start = viewport.project(node.loc);
      var end = vecAdd(start, _delta);
      var movedNodes = graph.childNodes(graph.entity(obj.movedId));
      var movedPath = movedNodes.map(function(n) { return moveNode(n.loc); });
      var unmovedNodes = graph.childNodes(graph.entity(obj.unmovedId));
      var unmovedPath = unmovedNodes.map(function(n) { return viewport.project(n.loc); });
      var hits = geomPathIntersections(movedPath, unmovedPath);

      for (var j = 0; i < hits.length; i++) {
        if (vecEqual(hits[j], end)) continue;
        var edge = geoChooseEdge(unmovedNodes, end, viewport);
        _delta = vecSubtract(viewport.project(edge.loc), start);
      }
    }
  }


  const action = graph => {
    if (vecEqual(_delta, [0, 0])) return graph;

    setupCache(graph);

    if (cache.intersections.length) {
      limitDelta(graph);
    }

    for (var i = 0; i < cache.nodes.length; i++) {
      var node = graph.entity(cache.nodes[i]);
      var start = viewport.project(node.loc);
      var end = vecAdd(start, _delta);
      graph = graph.replace(node.move(viewport.unproject(end)));
    }

    if (cache.intersections.length) {
      graph = cleanupIntersections(graph);
    }

    return graph;
  };


  action.delta = function() {
    return _delta;
  };


  return action;
}
