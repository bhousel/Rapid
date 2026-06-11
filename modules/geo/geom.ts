import { geomLineIntersection, vecAdd, vecAngle, vecEqual, vecInterp, vecLength } from '@rapid-sdk/math';

import type { BBox } from 'rbush';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * A box that covers a portion of a geometry, used for spatial coverage / buffering.
 * The `minX`/`minY`/`maxX`/`maxY` fields are structurally compatible with rbush's `BBox`,
 * so coverage boxes can be inserted into or queried against an `RBush` directly.
 */
export interface CoverageBox extends BBox {
  /** Center point of the box */
  coord: Vec2;
  /** Heading angle (radians) of the geometry at this point; `0` for a single point */
  angle: number;
}


/**
 * Covers a geometry (point or polyline) with a chain of square boxes — a fast,
 * quantized approximation of a buffer.  This is the building block for conflation
 * coverage (e.g. "which parts of this sidewalk already exist in OSM") and is also
 * used for rope-label placement along lines.
 *
 * Behavior by input:
 * - **Single point** (`coords.length === 1`): one box centered on the point.
 * - **Polyline** (`coords.length >= 2`): boxes placed every `step` units along each
 *   segment (including segment endpoints), each carrying that segment's heading angle.
 *   Shared vertices between consecutive segments are not double-covered.
 *
 * The function is unit-agnostic: `radius` and `step` are interpreted in the same planar
 * units as `coords`.  For metric conflation in world coordinates, the caller converts a
 * meters radius to world units first; for pixel-space label placement, callers pass pixel
 * sizes directly.
 *
 * Coverage guarantee: a box of half-size `radius` centered at points spaced `step` apart
 * fully covers the line between centers when `step <= 2 * radius`.  The default `step`
 * (= `radius`) overlaps generously; pass a larger `step` for sparser (touching) boxes.
 *
 * @param  coords - The point (1 coord) or polyline (2+ coords) to cover
 * @param  radius - Half-size of each square box, in the same units as `coords`
 * @param  step   - Spacing between box centers along the line (defaults to `radius`)
 * @return An array of coverage boxes (empty if `coords` is empty or `radius <= 0`)
 */
export function geomCoverageBoxes(coords: Vec2[], radius: number, step: number = radius): CoverageBox[] {
  const boxes: CoverageBox[] = [];
  if (!coords.length || radius <= 0) return boxes;

  const makeBox = (p: Vec2, angle: number): CoverageBox => {
    return {
      minX: p[0] - radius,
      minY: p[1] - radius,
      maxX: p[0] + radius,
      maxY: p[1] + radius,
      coord: p,
      angle: angle
    };
  };

  // Single point - just one box.
  if (coords.length === 1) {
    boxes.push(makeBox([coords[0][0], coords[0][1]], 0));
    return boxes;
  }

  const stepLen = step > 0 ? step : radius;

  // Walk each segment, placing box centers every `stepLen` units (including endpoints).
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const len = vecLength(a, b);
    if (len === 0) continue;   // skip zero-length segments (covered by neighbors)

    const angle = vecAngle(a, b);
    const n = Math.max(1, Math.ceil(len / stepLen));
    for (let k = 0; k <= n; k++) {
      if (i > 0 && k === 0) continue;   // shared vertex already covered by the previous segment
      boxes.push(makeBox(vecInterp(a, b, k / n), angle));
    }
  }

  // Degenerate polyline (all coincident points) - fall back to a single box.
  if (!boxes.length) {
    boxes.push(makeBox([coords[0][0], coords[0][1]], 0));
  }

  return boxes;
}


/** A run of evenly-spaced positions along a line that share a common heading. */
export interface LineSegment {
  /** Array of [x,y] coordinates along the segment */
  coords: Vec2[];
  /** Heading angle in radians */
  angle: number;
}


/**
 * Walks a line and breaks it up into segments containing evenly-spaced positions
 * that share a heading.  Used to position things along a line — oneway arrows,
 * sided markers, or (historically) rope-label placement boxes.
 * For example:
 * ```
 *   a --- b       [{ coords: [>,>,>,>], angle: 0     },
 *         |   ->   { coords: [v,v],     angle: -PI/2 },
 *   d --- c        { coords: [<,<,<,<], angle: PI    }]
 * ```
 *
 * The function is unit-agnostic: `spacing` is interpreted in the same planar units as `points`.
 *
 * @param   points      - Array of [x,y] coordinates that make up the line.
 * @param   spacing     - Distance between positions (in the same units as `points`)
 * @param   isSided     - If applying a 'sided' style to the line, arrows will be drawn perpendicular to the line segments.
 * @param   isLimited   - Whether to limit the number (temporary, see below)
 * @param   sidedOffset - Perpendicular offset used for sided markers (in the same units as `points`). Default 7.
 * @return  Array of segment Objects in the format `{ coords: Array<Vec2>, angle: number }`
 */
export function geomLineSegments(
  points: Vec2[],
  spacing: number,
  isSided: boolean = false,
  isLimited: boolean = false,
  sidedOffset: number = 7
): LineSegment[] {
  let offset = spacing;
  let a: Vec2 | undefined;

  const segments: LineSegment[] = [];
  for (const b of points) {
    if (a) {
      let span = vecLength(a, b) - offset;

      if (span >= 0) {
        const heading = vecAngle(a, b);

        // temporary, see https://github.com/facebook/Rapid/issues/544
        // If we would generate more than 100 markers on this segment, widen the spacing
        // so exactly 100 fit instead.  Use a segment-local variable so the adjusted
        // spacing doesn't bleed into subsequent point-pairs on the same line.
        // Note: when the condition holds, span/100 >= spacing > 0 (no risk of zero-step).
        let segSpacing = spacing;
        if (isLimited && (span >= spacing * 100)) {
          segSpacing = span / 100;
        }

        const dx = segSpacing * Math.cos(heading);
        const dy = segSpacing * Math.sin(heading);

        let sided_dx = 0;
        let sided_dy = 0;
        // For 'sided' segments, we want to offset the arrows so that they are not centered on the line segment's path
        if (isSided) {
          sided_dx = sidedOffset * Math.cos(heading + Math.PI / 2);
          sided_dy = sidedOffset * Math.sin(heading + Math.PI / 2);
        }

        let p: Vec2 = [
          a[0] + offset * Math.cos(heading) + sided_dx,
          a[1] + offset * Math.sin(heading) + sided_dy
        ];

        // generate coordinates between `a` and `b`, spaced `segSpacing` apart
        const coords: Vec2[] = [a, p];

        for (span -= segSpacing; span >= 0; span -= segSpacing) {
          p = vecAdd(p, [dx, dy]);
          coords.push(p);
        }
        coords.push(b);

        segments.push({
          coords: coords.slice(1, -1),   // skip first and last
          angle: heading + (isSided ? Math.PI / 2 : 0)
        });
      }

      offset = -span;
    }
    a = b;
  }

  return segments;
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
