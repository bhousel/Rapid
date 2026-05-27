import {
  geomPathIntersections, geomPathLength, projWgs84ToWorld, projWorldToWgs84, RAD2DEG,
  vecAdd, vecAngle, vecEqual, vecInterp, vecProject, vecSubtract
} from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';
import { utilArrayIntersection } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation, OsmWay } from '../data/types.ts';
import type { Closest, Vec2 } from '@rapid-sdk/math';


/** Data Structure for an intersection entry in the move cache */
interface MoveIntersection {
  /** ID of the node at the intersection */
  nodeID: EntityID;
  /** ID of the way being moved */
  movedID: EntityID;
  /** ID of the stationary way */
  unmovedID: EntityID;
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
  /** Map of starting positions (local space, relative to `origin`) by NodeID */
  startLocal: Record<EntityID, Vec2>;
  /** World-space origin of the local coordinate frame (chosen for FP stability) */
  origin: Vec2;
  /** Array of node IDs being moved */
  nodes: EntityID[];
  /** Array of way IDs being moved */
  ways: EntityID[];
  /** Whether the cache has been initialized */
  ok: boolean;
}


/** Interface for the move action with delta accessor */
export interface MoveAction extends Action {
  /** Returns the current delta being applied (world-space) */
  delta(): Vec2;
}


/**
 * Moves the specified entities by the given delta.
 * All math happens in world coordinate space (EPSG:3857-style), with a local
 * origin subtracted off for floating-point stability.  The caller is responsible
 * for supplying `tryDelta` in world coordinate units.
 *
 * @param   moveIDs  - Array of EntityIDs to move
 * @param   tryDelta - The delta `[dx, dy]` to move by, in world coordinates
 * @param   cache    - Optional cache object for efficiency across multiple calls
 * @return  An Action function that moves the given entities
 */
export function actionMove(moveIDs: EntityID[], tryDelta: Vec2, cache?: Partial<MoveCache>): MoveAction {
  let _delta: Vec2 = tryDelta;
  let _cache: MoveCache = cache as MoveCache;


  /**
   * Returns a node's position in the local coordinate frame (`world − _cache.origin`).
   * Prefers the pre-computed world coords from the node's geometry cache when available,
   * falling back to `projWgs84ToWorld(node.loc)`.
   * @param node - the node to look up
   * @return local-space coordinate
   */
  function nodeLocal(node: OsmNode): Vec2 {
    const world = (node.geoms.parts[0]?.world?.coords as Vec2 | undefined)
      ?? projWgs84ToWorld(node.loc!);
    return vecSubtract(world, _cache.origin);
  }


  /**
   * Returns a node's ORIGINAL (pre-move) position in the local coordinate frame.
   * For nodes that are part of the move set, this is the cached start position.
   * For all other nodes, this is identical to `nodeLocal(node)`.
   * Use this when reasoning about the unmoved way's original shape — e.g. when
   * deciding whether a shape-preserving vertex needs to be inserted.
   * @param node - the node to look up
   * @return original local-space coordinate
   */
  function nodeOriginalLocal(node: OsmNode): Vec2 {
    return _cache.startLocal[node.id] ?? nodeLocal(node);
  }


  /**
   * Initializes `_cache` on the first call (`!_cache.ok`).
   * Walks the entity tree to record every moving node's starting local-space position,
   * collects `nodes` and `ways` lists, and finds all intersections between moving
   * ways and unmoved ways.
   * @param graph - the current graph state
   */
  function setupCache(graph: Graph): void {
    /**
     * Returns `true` when the node at `nodeID` is permitted to move.
     * Nodes where more than two ways meet are only movable when every parent way
     * is also moving; otherwise the node is removed from `_cache.moving`.
     * @param nodeID - the node to test
     * @return whether the node may be moved
     */
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

    /**
     * Recursively walks the entity tree, recording every node's starting position
     * in local space and populating `_cache.nodes`, `_cache.ways`, and `_cache.origin`.
     * @param ids - entity IDs to process (nodes, ways, or relations)
     */
    function cacheEntities(ids: EntityID[]): void {
      for (const id of ids) {
        if (_cache.moving[id]) continue;
        _cache.moving[id] = true;

        const entity = graph.hasEntity(id);
        if (!entity) continue;

        if (entity.type === 'node') {
          const node = entity as OsmNode;
          const world = (node.geoms.parts[0]?.world?.coords as Vec2 | undefined)
            ?? projWgs84ToWorld(node.loc!);
          if (!_cache.origin) _cache.origin = world;  // first node sets local frame
          _cache.nodes.push(id);
          _cache.startLocal[id] = vecSubtract(world, _cache.origin);
        } else if (entity.type === 'way') {
          _cache.ways.push(id);
          cacheEntities((entity as OsmWay).nodes);
        } else {
          cacheEntities((entity as OsmRelation).members.map(m => m.id));
        }
      }
    }

    /**
     * Finds all intersections between moving ways and unmoved ways and pushes
     * each into `_cache.intersections`. Skips area ways and overly-connected pairs.
     * @param ids - way IDs to examine
     */
    function cacheIntersections(ids: EntityID[]): void {
      /**
       * Returns `true` when `id` is a non-closed-loop endpoint of `way`.
       * @param  way - the way to check
       * @param  nodeID - the nodeID to test
       * @return whether the node is an endpoint
       */
      function isEndpoint(way: OsmWay, nodeID: EntityID): boolean {
        return !way.isClosed() && !!way.affix(nodeID);
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
            movedID: moved.id,
            unmovedID: unmoved.id,
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
      _cache.startLocal = {};
      _cache.origin = null!;  // populated by first node visited in cacheEntities
      _cache.nodes = [];
      _cache.ways = [];

      cacheEntities(moveIDs);
      cacheIntersections(_cache.ways);
      _cache.nodes = _cache.nodes.filter(canMove);

      _cache.ok = true;
    }
  }


  /**
   * Inserts a new node at the original position of a moved vertex so that the
   * shape of affected ways is preserved after the move.  Skips insertion when
   * the resulting angle would be nearly straight (within 5° of 180°).
   *
   * ```
   *  Start:
   *      b ---- e
   *     / \
   *    /   \
   *   /     \
   *  a       c
   *
   *      *               node '*' added to preserve shape
   *     / \
   *    /   b ---- e      way `b,e` moved here
   *   /     \
   *  a       c
   * ```
   *
   * @param nodeID - ID of the moved vertex
   * @param wayID  - ID of the way whose shape should be preserved
   * @param graph  - current graph state
   * @param delta  - world-space delta applied to moved entities (`null` for the unmoved way)
   * @return the updated graph
   */
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
      _cache.startLocal[orig.id] = _cache.startLocal[nodeID];
    }

    // Compute orig's target position in local space.
    const startLocal = _cache.startLocal[nodeID];
    const endLocal: Vec2 = delta ? vecAdd(startLocal, delta) : startLocal;
    orig = orig.move(projWorldToWgs84(vecAdd(endLocal, _cache.origin)));

    // Angle at orig vertex between prev and next — if ~180° (nearly straight),
    // skip inserting it because it wouldn't change the way's shape.
    // Use the ORIGINAL positions of prev/next here: when the moved way is
    // connected to the unmoved way at more than one node (e.g. a U-shaped
    // driveway joining a road at both endpoints), prev or next may itself be
    // one of those shared moving endpoints whose current position no longer
    // reflects the unmoved way's original geometry.
    const o = endLocal;
    const aOrig = nodeOriginalLocal(prev);
    const bOrig = nodeOriginalLocal(next);
    const angle = Math.abs(vecAngle(o, aOrig) - vecAngle(o, bOrig)) * RAD2DEG;

    // Don't add orig vertex if it would just make a straight line..
    if (angle > 175 && angle < 185) return graph;

    // Moving forward or backward along way? Use whichever insertion order
    // produces the shorter path through prev / moved / orig / next.
    // Use the current positions of prev/next here since this is about the
    // way's resulting geometry after insertion.
    const a = nodeLocal(prev);
    const b = nodeLocal(next);
    const movedLocal = nodeLocal(moved);
    const p1: Vec2[] = [a, o, movedLocal, b];
    const p2: Vec2[] = [a, movedLocal, o, b];
    const d1 = geomPathLength(p1);
    const d2 = geomPathLength(p2);
    let insertAt = (d1 <= d2) ? movedIndex : nextIndex;

    // moving around closed loop?
    if (way.isClosed() && insertAt === 0) insertAt = len;

    way = way.addNode(orig.id, insertAt);
    return graph.replace(orig).replace(way).commit();
  }


  /**
   * Removes consecutive duplicate vertices (within epsilon) along a way, preferring
   * to drop uninteresting nodes.  Duplicate nodes can arise when `replaceMovedVertex`
   * inserts a vertex very close to an existing one after movement.
   * @param wayID - ID of the way to clean up
   * @param graph - current graph state
   * @return the updated graph
   */
  function removeDuplicateVertices(wayID: EntityID, graph: Graph): Graph {
    let way = graph.entity(wayID) as OsmWay;
    const epsilon = 1e-6;
    let prev: OsmNode | undefined;
    let curr: OsmNode;

    for (const nodeID of way.nodes) {
      curr = graph.entity(nodeID) as OsmNode;

      if (prev && curr && vecEqual(nodeLocal(prev), nodeLocal(curr), epsilon)) {
        if (!prev.isInteresting(graph)) {
          way = way.removeNode(prev.id);
          graph.replace(way).remove(prev);
        } else if (!curr.isInteresting(graph)) {
          way = way.removeNode(curr.id);
          graph.replace(way).remove(curr);
        }
      }

      prev = curr;
    }

    return graph.commit();
  }


  /**
   * Snaps a shared vertex back onto the nearest edge(s) and reorders the way's
   * node list when the vertex has slid past a neighbour node (the "zorro" pattern).
   * Uses `vecProject` for edge picking and iterates to find the equidistant
   * midpoint when the vertex is a non-endpoint of both ways.
   *
   * ```
   *  Start:                way1.nodes: b,e         (moving)
   *  a - b - c ----- d     way2.nodes: a,b,c,d     (static)
   *      |                 vertex: b
   *      e                 isEP1: true,  isEP2: false
   *
   *  way1 `b,e` moved here:
   *  a ----- c = b - d
   *              |
   *              e
   *
   *  reorder nodes         way1.nodes: b,e
   *  a ----- c - b - d     way2.nodes: a,c,b,d
   *              |
   *              e
   * ```
   *
   * @param intersection - the intersection descriptor from `_cache.intersections`
   * @param graph        - current graph state
   * @return the updated graph
   */
  function unZorroIntersection(intersection: MoveIntersection, graph: Graph): Graph {
    const vertex = graph.entity(intersection.nodeID) as OsmNode;
    let way1 = graph.entity(intersection.movedID) as OsmWay;
    let way2 = graph.entity(intersection.unmovedID) as OsmWay;
    const isEP1 = intersection.movedIsEP;
    const isEP2 = intersection.unmovedIsEP;

    // don't move the vertex if it is the endpoint of both ways.
    if (isEP1 && isEP2) return graph;

    const nodes1 = graph.childNodes(way1).filter(n => n !== vertex);
    const nodes2 = graph.childNodes(way2).filter(n => n !== vertex);

    if (way1.isClosed() && way1.first() === vertex.id) nodes1.push(nodes1[0]);
    if (way2.isClosed() && way2.first() === vertex.id) nodes2.push(nodes2[0]);

    const coords1: Vec2[] = nodes1.map(nodeLocal);
    const coords2: Vec2[] = nodes2.map(nodeLocal);
    const target: Vec2 = nodeLocal(vertex);

    let edge1: Closest | null = !isEP1 ? vecProject(target, coords1) : null;
    let edge2: Closest | null = !isEP2 ? vecProject(target, coords2) : null;
    let loc: Vec2 = target;  // Default to current vertex location (local)

    // snap vertex to nearest edge (or some point between them)..
    if (!isEP1 && !isEP2 && edge1 && edge2) {
      const epsilon = 1e-6, maxIter = 10;
      for (let i = 0; i < maxIter; i++) {
        loc = vecInterp(edge1.point, edge2.point, 0.5);
        edge1 = vecProject(loc, coords1);
        edge2 = vecProject(loc, coords2);
        if (!edge1 || !edge2 || Math.abs(edge1.distance - edge2.distance) < epsilon) break;
      }
    } else if (!isEP1 && edge1) {
      loc = edge1.point;
    } else if (edge2) {
      loc = edge2.point;
    } else {
      return graph;  // No valid edge found
    }

    graph.replace(vertex.move(projWorldToWgs84(vecAdd(loc, _cache.origin))));

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


  /**
   * Runs the full intersection cleanup pipeline for every recorded intersection:
   * replaces the moved vertex on both ways, snaps and reorders via `unZorroIntersection`,
   * then removes any duplicate vertices that were introduced.
   * @param graph - current graph state
   * @return the updated graph
   */
  function cleanupIntersections(graph: Graph): Graph {
    for (const obj of _cache.intersections) {
      graph = replaceMovedVertex(obj.nodeID, obj.movedID, graph, _delta);
      graph = replaceMovedVertex(obj.nodeID, obj.unmovedID, graph, null);
      graph = unZorroIntersection(obj, graph);
      graph = removeDuplicateVertices(obj.movedID, graph);
      graph = removeDuplicateVertices(obj.unmovedID, graph);
    }

    return graph;
  }


  /**
   * Clamps `_delta` so that a moving way endpoint cannot cross an unmoved way.
   * If the projected move path intersects an unmoved way, `_delta` is reduced
   * to place the endpoint exactly on that edge.
   * @param graph - current graph state (used to read node positions)
   */
  function limitDelta(graph: Graph): void {
    for (const obj of _cache.intersections) {
      // Don't limit movement if this is vertex joins 2 endpoints..
      if (obj.movedIsEP && obj.unmovedIsEP) continue;
      // Don't limit movement if this vertex is not an endpoint anyway..
      if (!obj.movedIsEP) continue;

      const node = graph.entity(obj.nodeID) as OsmNode;
      const delta = _delta;  // local copy so the closure below doesn't capture the outer `let`
      const start = nodeLocal(node);
      const end = vecAdd(start, delta);
      const movedNodes = graph.childNodes(graph.entity(obj.movedID) as OsmWay);
      const movedPath = movedNodes.map(n => vecAdd(nodeLocal(n), delta));
      const unmovedNodes = graph.childNodes(graph.entity(obj.unmovedID) as OsmWay);
      const unmovedPath = unmovedNodes.map(nodeLocal);
      const hits = geomPathIntersections(movedPath, unmovedPath);

      for (const hit of hits) {
        if (vecEqual(hit, end)) continue;
        const edge = vecProject(end, unmovedPath);
        if (edge) {
          _delta = vecSubtract(edge.point, start);
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
      const endLocal = vecAdd(_cache.startLocal[nodeID], _delta);
      graph = graph.replace(node.move(projWorldToWgs84(vecAdd(endLocal, _cache.origin))));
    }

    if (_cache.intersections.length) {
      graph = cleanupIntersections(graph);
    }

    return graph;
  }) as MoveAction;


  /**
   * Returns the current (possibly clamped) world-space delta being applied by this action.
   * @return the effective delta `[dx, dy]` in world coordinates
   */
  action.delta = function(): Vec2 {
    return _delta;
  };


  return action;
}
