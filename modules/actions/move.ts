import { geoChooseEdge } from '../geo/geom.ts';
import { geomPathIntersections, geomPathLength, vecAdd, vecAngle, vecEqual, vecInterp, vecSubtract } from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';
import { utilArrayIntersection } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { ChooseEdgeResult } from '../geo/geom.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation, OsmWay } from '../data/types.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/** Structure for an intersection entry in the move cache */
interface MoveIntersection {
  /** ID of the node at the intersection */
  nodeID: EntityID;
  /** ID of the way being moved */
  movedId: EntityID;
  /** ID of the stationary way */
  unmovedId: EntityID;
  /** Whether the node is an endpoint of the moved way */
  movedIsEP: boolean;
  /** Whether the node is an endpoint of the unmoved way */
  unmovedIsEP: boolean;
}


/** Cache object used during move operations */
export interface MoveCache {
  /** Map of entity IDs that are moving */
  moving: Record<EntityID, boolean>;
  /** Intersections between moved and unmoved ways */
  intersections: MoveIntersection[];
  /** Map of replaced vertices by wayID:nodeID key */
  replacedVertex: Record<string, OsmNode>;
  /** Map of starting locations by node ID */
  startLoc: Record<EntityID, Vec2>;
  /** Array of node IDs being moved */
  nodes: EntityID[];
  /** Array of way IDs being moved */
  ways: EntityID[];
  /** Whether the cache has been initialized */
  ok: boolean;
}


/** Interface for the move action with delta accessor */
export interface MoveAction extends Action {
  /** Returns the current delta being applied */
  delta(): Vec2;
}


/**
 * actionMove
 * Moves the specified entities by the given delta.
 *
 * @param   moveIDs   - Array of EntityIDs to move
 * @param   tryDelta  - The delta [dx, dy] to move by
 * @param   viewport  - The Viewport for coordinate conversion
 * @param   cache     - Optional cache object for efficiency across multiple calls
 * @return  A MoveAction that moves the entities in the graph
 */
export function actionMove(
  moveIDs: EntityID[],
  tryDelta: Vec2,
  viewport: Viewport,
  cache?: Partial<MoveCache>
): MoveAction {
  let _delta: Vec2 = tryDelta;
  let _cache: MoveCache = cache as MoveCache;

  function setupCache(graph: Graph): void {
    function canMove(nodeID: EntityID): boolean {
      // Allow movement of any node that is in the moveIDs list..
      if (moveIDs.includes(nodeID)) return true;

      // Allow movement of a vertex where 2 ways meet..
      const parents = graph.parentWays(graph.entity(nodeID) as OsmNode);
      if (parents.length < 3) return true;

      // Restrict movement of a vertex where >2 ways meet, unless all parentWays are moving too..
      const areParentsMoving = parents.every(way => _cache.moving[way.id]);
      if (!areParentsMoving) delete _cache.moving[nodeID];

      return areParentsMoving;
    }

    function cacheEntities(ids: EntityID[]): void {
      for (const id of ids) {
        if (_cache.moving[id]) continue;
        _cache.moving[id] = true;

        const entity = graph.hasEntity(id);
        if (!entity) continue;

        if (entity.type === 'node') {
          _cache.nodes.push(id);
          _cache.startLoc[id] = (entity as OsmNode).loc!;
        } else if (entity.type === 'way') {
          _cache.ways.push(id);
          cacheEntities((entity as OsmWay).nodes);
        } else {
          cacheEntities((entity as OsmRelation).members.map(m => m.id));
        }
      }
    }

    function cacheIntersections(ids: EntityID[]): void {
      function isEndpoint(way: OsmWay, id: EntityID): boolean {
        return !way.isClosed() && !!way.affix(id);
      }

      for (const id of ids) {
        // consider only intersections with 1 moved and 1 unmoved way.
        const childNodes = graph.childNodes(graph.entity(id) as OsmWay);
        for (const node of childNodes) {
          const parents = graph.parentWays(node);
          if (parents.length !== 2) continue;

          const moved = graph.entity(id) as OsmWay;
          let unmoved: OsmWay | null = null;
          for (const way of parents) {
            if (!_cache.moving[way.id]) {
              unmoved = way;
              break;
            }
          }
          if (!unmoved) continue;

          // exclude ways that are overly connected..
          if (utilArrayIntersection(moved.nodes, unmoved.nodes).length > 2) continue;
          if (moved.isArea() || unmoved.isArea()) continue;

          _cache.intersections.push({
            nodeID: node.id,
            movedId: moved.id,
            unmovedId: unmoved.id,
            movedIsEP: isEndpoint(moved, node.id),
            unmovedIsEP: isEndpoint(unmoved, node.id)
          });
        }
      }
    }


    if (!_cache) {
      _cache = {} as MoveCache;
    }
    if (!_cache.ok) {
      _cache.moving = {};
      _cache.intersections = [];
      _cache.replacedVertex = {};
      _cache.startLoc = {};
      _cache.nodes = [];
      _cache.ways = [];

      cacheEntities(moveIDs);
      cacheIntersections(_cache.ways);
      _cache.nodes = _cache.nodes.filter(canMove);

      _cache.ok = true;
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
  function replaceMovedVertex(nodeID: EntityID, wayID: EntityID, graph: Graph, delta: Vec2 | null): Graph {
    let way = graph.entity(wayID) as OsmWay;
    const moved = graph.entity(nodeID) as OsmNode;
    const movedIndex = way.nodes.indexOf(nodeID);
    let len: number;
    let prevIndex: number;
    let nextIndex: number;

    if (way.isClosed()) {
      len = way.nodes.length - 1;
      prevIndex = (movedIndex + len - 1) % len;
      nextIndex = (movedIndex + len + 1) % len;
    } else {
      len = way.nodes.length;
      prevIndex = movedIndex - 1;
      nextIndex = movedIndex + 1;
    }

    const prev = graph.hasEntity(way.nodes[prevIndex]) as OsmNode | undefined;
    const next = graph.hasEntity(way.nodes[nextIndex]) as OsmNode | undefined;

    // Don't add orig vertex at endpoint..
    if (!prev || !next) return graph;

    const key = `${wayID}:${nodeID}`;
    let orig = _cache.replacedVertex[key];
    if (!orig) {
      orig = new OsmNode(way.context);
      _cache.replacedVertex[key] = orig;
      _cache.startLoc[orig.id] = _cache.startLoc[nodeID];
    }

    let start: Vec2;
    let end: Vec2;
    if (delta) {
      start = viewport.project(_cache.startLoc[nodeID]);
      end = viewport.unproject(vecAdd(start, delta));
    } else {
      end = _cache.startLoc[nodeID];
    }
    orig = orig.move(end);

    const o = viewport.project(orig.loc!);
    const a = viewport.project(prev.loc!);
    const b = viewport.project(next.loc!);
    const angle = Math.abs(vecAngle(o, a) - vecAngle(o, b)) * (180 / Math.PI);

    // Don't add orig vertex if it would just make a straight line..
    if (angle > 175 && angle < 185) return graph;

    // moving forward or backward along way?
    const p1: Vec2[] = [prev.loc!, orig.loc!, moved.loc!, next.loc!].map((loc: Vec2) => viewport.project(loc));
    const p2: Vec2[] = [prev.loc!, moved.loc!, orig.loc!, next.loc!].map((loc: Vec2) => viewport.project(loc));
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
  function removeDuplicateVertices(wayID: EntityID, graph: Graph): Graph {
    let way = graph.entity(wayID) as OsmWay;
    const epsilon = 1e-6;
    let prev: OsmNode | undefined;
    let curr: OsmNode;

    function isInteresting(node: OsmNode, graph: Graph): boolean {
      return graph.parentWays(node).length > 1 ||
        graph.parentRelations(node).length > 0 ||
        node.hasInterestingTags();
    }

    for (const nodeID of way.nodes) {
      curr = graph.entity(nodeID) as OsmNode;

      if (prev && curr && vecEqual(prev.loc!, curr.loc!, epsilon)) {
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
  function unZorroIntersection(intersection: MoveIntersection, graph: Graph): Graph {
    const vertex = graph.entity(intersection.nodeID) as OsmNode;
    let way1 = graph.entity(intersection.movedId) as OsmWay;
    let way2 = graph.entity(intersection.unmovedId) as OsmWay;
    const isEP1 = intersection.movedIsEP;
    const isEP2 = intersection.unmovedIsEP;

    // don't move the vertex if it is the endpoint of both ways.
    if (isEP1 && isEP2) return graph;

    const nodes1 = graph.childNodes(way1).filter(n => n !== vertex);
    const nodes2 = graph.childNodes(way2).filter(n => n !== vertex);

    if (way1.isClosed() && way1.first() === vertex.id) nodes1.push(nodes1[0]);
    if (way2.isClosed() && way2.first() === vertex.id) nodes2.push(nodes2[0]);

    let edge1: ChooseEdgeResult | null = !isEP1 ? geoChooseEdge(nodes1, viewport.project(vertex.loc!), viewport) : null;
    let edge2: ChooseEdgeResult | null = !isEP2 ? geoChooseEdge(nodes2, viewport.project(vertex.loc!), viewport) : null;
    let loc: Vec2 = vertex.loc!;  // Default to current vertex location

    // snap vertex to nearest edge (or some point between them)..
    if (!isEP1 && !isEP2 && edge1 && edge2) {
      const epsilon = 1e-6, maxIter = 10;
      for (let i = 0; i < maxIter; i++) {
        loc = vecInterp(edge1.loc, edge2.loc, 0.5);
        edge1 = geoChooseEdge(nodes1, viewport.project(loc), viewport);
        edge2 = geoChooseEdge(nodes2, viewport.project(loc), viewport);
        if (!edge1 || !edge2 || Math.abs(edge1.distance - edge2.distance) < epsilon) break;
      }
    } else if (!isEP1 && edge1) {
      loc = edge1.loc;
    } else if (edge2) {
      loc = edge2.loc;
    } else {
      return graph;  // No valid edge found
    }

    graph.replace(vertex.move(loc));

    // if zorro happened, reorder nodes..
    if (!isEP1 && edge1 && edge1.index !== way1.nodes.indexOf(vertex.id)) {
      way1 = way1.removeNode(vertex.id).addNode(vertex.id, edge1.index);
      graph.replace(way1);
    }
    if (!isEP2 && edge2 && edge2.index !== way2.nodes.indexOf(vertex.id)) {
      way2 = way2.removeNode(vertex.id).addNode(vertex.id, edge2.index);
      graph.replace(way2);
    }

    return graph.commit();
  }


  function cleanupIntersections(graph: Graph): Graph {
    for (const obj of _cache.intersections) {
      graph = replaceMovedVertex(obj.nodeID, obj.movedId, graph, _delta);
      graph = replaceMovedVertex(obj.nodeID, obj.unmovedId, graph, null);
      graph = unZorroIntersection(obj, graph);
      graph = removeDuplicateVertices(obj.movedId, graph);
      graph = removeDuplicateVertices(obj.unmovedId, graph);
    }

    return graph;
  }


  // check if moving way endpoint can cross an unmoved way, if so limit delta..
  function limitDelta(graph: Graph): void {
    function moveNode(loc: Vec2): Vec2 {
      return vecAdd(viewport.project(loc), _delta);
    }

    for (const obj of _cache.intersections) {
      // Don't limit movement if this is vertex joins 2 endpoints..
      if (obj.movedIsEP && obj.unmovedIsEP) continue;
      // Don't limit movement if this vertex is not an endpoint anyway..
      if (!obj.movedIsEP) continue;

      const node = graph.entity(obj.nodeID) as OsmNode;
      const start = viewport.project(node.loc!);
      const end = vecAdd(start, _delta);
      const movedNodes = graph.childNodes(graph.entity(obj.movedId) as OsmWay);
      const movedPath = movedNodes.map(n => moveNode(n.loc!));
      const unmovedNodes = graph.childNodes(graph.entity(obj.unmovedId) as OsmWay);
      const unmovedPath = unmovedNodes.map(n => viewport.project(n.loc!));
      const hits = geomPathIntersections(movedPath, unmovedPath);

      for (const hit of hits) {
        if (vecEqual(hit, end)) continue;
        const edge = geoChooseEdge(unmovedNodes, end, viewport);
        if (edge) {
          _delta = vecSubtract(viewport.project(edge.loc), start);
        }
      }
    }
  }


  const action = ((graph: Graph): Graph => {
    if (vecEqual(_delta, [0, 0])) return graph;

    setupCache(graph);

    if (_cache.intersections.length) {
      limitDelta(graph);
    }

    for (const nodeID of _cache.nodes) {
      const node = graph.entity(nodeID) as OsmNode;
      const start = viewport.project(node.loc!);
      const end = vecAdd(start, _delta);
      graph = graph.replace(node.move(viewport.unproject(end)));
    }

    if (_cache.intersections.length) {
      graph = cleanupIntersections(graph);
    }

    return graph;
  }) as MoveAction;


  action.delta = function(): Vec2 {
    return _delta;
  };


  return action;
}
