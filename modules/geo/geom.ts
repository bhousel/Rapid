import { geomLineIntersection, vecDot, vecEqual, vecLength, vecSubtract, Viewport } from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';

import type { Vec2 } from '@rapid-sdk/math';


/** Result from geoChooseEdge */
export interface ChooseEdgeResult {
  /** Index of the chosen edge */
  index: number;
  /** Distance to the edge */
  distance: number;
  /** Location on the edge */
  loc: Vec2;
}


/**
 * Choose the edge with the minimal distance from `coord` to its orthogonal
 * projection onto that edge, if such a projection exists, or the distance to
 * the closest vertex on that edge.
 * @param nodes - Array of nodes forming the edges
 * @param coord - Coordinate to find nearest edge to
 * @param viewport - Viewport for projecting coordinates
 * @param activeID - ID of active node to skip
 * @returns Object with index, distance, and loc, or null if no edge found
 */
export function geoChooseEdge(nodes: OsmNode[], coord: Vec2, viewport: Viewport, activeID?: EntityID): ChooseEdgeResult | null {
  const dist = vecLength;
  const coords = nodes.map(n => viewport.project(n.loc!));
  const ids = nodes.map(n => n.id);
  let min = Infinity;
  let idx: number | undefined;
  let loc: Vec2 | undefined;

  for (let i = 0; i < coords.length - 1; i++) {
    if (ids[i] === activeID || ids[i + 1] === activeID) continue;

    const o = coords[i];
    const s = vecSubtract(coords[i + 1], o);
    const v = vecSubtract(coord, o);
    const proj = vecDot(v, s) / vecDot(s, s);
    let p: Vec2;

    if (proj < 0) {
      p = o;
    } else if (proj > 1) {
      p = coords[i + 1];
    } else {
      p = [o[0] + proj * s[0], o[1] + proj * s[1]];
    }

    const d = dist(p, coord);
    if (d < min) {
      min = d;
      idx = i + 1;
      loc = viewport.unproject(p);
    }
  }

  if (idx !== undefined && loc !== undefined) {
    return { index: idx, distance: min, loc: loc };
  } else {
    return null;
  }
}


/**
 * Test active (dragged or drawing) segments against inactive segments.
 * This is used to test e.g. multipolygon rings that cross.
 * @param activeNodes - The ring containing the activeID being dragged
 * @param inactiveNodes - The other ring to test against
 * @param activeID - The ID of the node being dragged
 * @returns true if there are intersections, false otherwise
 */
export function geoHasLineIntersections(activeNodes: OsmNode[], inactiveNodes: OsmNode[], activeID: EntityID): boolean {
  const actives: Vec2[][] = [];
  const inactives: Vec2[][] = [];

  // gather active segments (only segments in activeNodes that contain the activeID)
  for (let j = 0; j < activeNodes.length - 1; j++) {
    const n1 = activeNodes[j];
    const n2 = activeNodes[j + 1];
    const segment: Vec2[] = [n1.loc!, n2.loc!];
    if (n1.id === activeID || n2.id === activeID) {
      actives.push(segment);
    }
  }

  // gather inactive segments
  for (let j = 0; j < inactiveNodes.length - 1; j++) {
    const n1 = inactiveNodes[j];
    const n2 = inactiveNodes[j + 1];
    const segment: Vec2[] = [n1.loc!, n2.loc!];
    inactives.push(segment);
  }

  // test
  for (const p of actives) {
    for (const q of inactives) {
      const hit = geomLineIntersection(p, q);
      if (hit) {
        return true;
      }
    }
  }

  return false;
}


/**
 * Test active (dragged or drawing) segments against inactive segments.
 * This is used to test whether a way intersects with itself.
 * @param nodes - All nodes of the way
 * @param activeID - The ID of the node being dragged
 * @returns true if the way has self-intersections, false otherwise
 */
export function geoHasSelfIntersections(nodes: OsmNode[], activeID: EntityID): boolean {
  const actives: Vec2[][] = [];
  const inactives: Vec2[][] = [];

  // group active and passive segments along the nodes
  for (let j = 0; j < nodes.length - 1; j++) {
    const n1 = nodes[j];
    const n2 = nodes[j + 1];
    const segment: Vec2[] = [n1.loc!, n2.loc!];
    if (n1.id === activeID || n2.id === activeID) {
      actives.push(segment);
    } else {
      inactives.push(segment);
    }
  }

  // test
  for (const p of actives) {
    for (const q of inactives) {
      // skip if segments share an endpoint
      if (vecEqual(p[1], q[0]) || vecEqual(p[0], q[1]) ||
          vecEqual(p[0], q[0]) || vecEqual(p[1], q[1])) {
        continue;
      }

      const hit = geomLineIntersection(p, q);
      if (hit) {
        const epsilon = 1e-8;
        // skip if the hit is at the segment's endpoint
        if (vecEqual(p[1], hit, epsilon) || vecEqual(p[0], hit, epsilon) ||
            vecEqual(q[1], hit, epsilon) || vecEqual(q[0], hit, epsilon)) {
          continue;
        } else {
          return true;
        }
      }
    }
  }

  return false;
}
