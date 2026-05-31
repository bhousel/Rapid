import { geomLineIntersection, vecEqual } from '@rapid-sdk/math';

import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


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
