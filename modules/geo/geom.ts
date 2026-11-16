import { geoMetersToLon, geomLineIntersection, vecAdd, vecAngle, vecEqual, vecInterp, vecLength, WORLD_SIZE } from '@rapid-sdk/math';

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
  /** Index of the line segment the center lies on (from `coords[index]` to `coords[index + 1]`); `0` for a single point */
  index: number;
  /** Position of the center along that segment, from `0` (start) to `1` (end); `0` for a single point */
  t: number;
}


/**
 * Covers a geometry (point or polyline) with a chain of square boxes — a fast,
 * quantized approximation of a buffer.  This is the building block for conflation
 * coverage (e.g. "which parts of this sidewalk already exist in OSM").
 *
 * Behavior by input:
 * - **Single point** (`coords.length === 1`): one box centered on the point.
 * - **Polyline** (`coords.length >= 2`): box centers evenly spaced along the whole line,
 *   at most `step` apart, including both ends. The spacing doesn't depend on where the
 *   vertices are, so a curve drawn with many short segments gets no more boxes than a
 *   straight line of the same length. (Like `geomLineSegments`, which is for markers
 *   along a line, but this one includes the ends and records where each box is.)
 *
 * Each box's `angle` is the heading of the line over a window about one `step` long,
 * centered on the box (shifted to stay on the line at its ends). That smooths out the
 * noise of short segments on a curve, and follows the line around real turns. Right at a
 * sharp corner, the heading is in between the two directions.
 *
 * The function is unit-agnostic: `radius` and `step` are interpreted in the same planar
 * units as `coords`.  For metric conflation in world coordinates, the caller converts a
 * meters radius to world units first.
 *
 * Coverage guarantee: a box of half-size `radius` centered at points spaced `step` apart
 * fully covers the line between centers when `step <= 2 * radius`.  The default `step`
 * (= `radius`) overlaps generously; pass a larger `step` for sparser (touching) boxes.
 *
 * @param  coords - The point (1 coord) or polyline (2+ coords) to cover
 * @param  radius - Half-size of each square box, in the same units as `coords`
 * @param  step   - Most spacing between box centers along the line (defaults to `radius`)
 * @return An array of coverage boxes (empty if `coords` is empty or `radius <= 0`)
 */
export function geomCoverageBoxes(coords: Vec2[], radius: number, step: number = radius): CoverageBox[] {
  const boxes: CoverageBox[] = [];
  if (!coords.length || radius <= 0) return boxes;

  const makeBox = (p: Vec2, angle: number, index: number, t: number): CoverageBox => {
    return {
      minX: p[0] - radius,
      minY: p[1] - radius,
      maxX: p[0] + radius,
      maxY: p[1] + radius,
      coord: p,
      angle: angle,
      index: index,
      t: t
    };
  };

  // Single point - just one box.
  if (coords.length === 1) {
    boxes.push(makeBox([coords[0][0], coords[0][1]], 0, 0, 0));
    return boxes;
  }

  const dist = geomLineDistances(coords);
  const total = dist.at(-1)!;

  // Degenerate polyline (all coincident points) - fall back to a single box.
  if (total === 0) {
    boxes.push(makeBox([coords[0][0], coords[0][1]], 0, 0, 0));
    return boxes;
  }

  // Evenly spaced along the whole line, at most `stepLen` apart, including both ends.
  const stepLen = step > 0 ? step : radius;
  const n = Math.max(1, Math.ceil(total / stepLen));

  for (let k = 0; k <= n; k++) {
    const d = (k === n) ? total : total * k / n;
    const pos = geomPositionAlong(coords, dist, d);
    const angle = geomHeadingAlong(coords, dist, d, stepLen);
    boxes.push(makeBox(pos.coord, angle, pos.index, pos.t));
  }

  return boxes;
}


/** A position along a line. */
export interface LinePosition {
  /** Index of the segment the position is on (from `coords[index]` to `coords[index + 1]`) */
  index: number;
  /** How far along that segment, from `0` (start) to `1` (end) */
  t: number;
  /** The point itself */
  coord: Vec2;
}


/**
 * Returns the distance along a line to each of its vertices.
 * Pass the result to `geomPositionAlong` and `geomHeadingAlong`.
 * @param  coords - The line
 * @return Distances, one per vertex, starting at `0`
 */
export function geomLineDistances(coords: Vec2[]): number[] {
  const dist: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    dist.push(dist[i - 1] + vecLength(coords[i - 1], coords[i]));
  }
  return dist;
}


/**
 * Finds the position at a distance along a line. It is never on a zero-length segment, and a
 * position right on a vertex is at the start of the segment that follows it (or at the end of the
 * last segment).
 * @param  coords - The line (2 or more coords, not all the same point)
 * @param  dist - The distance to each vertex, from `geomLineDistances(coords)`
 * @param  d - The distance along the line (clamped to the line)
 * @return The position
 */
export function geomPositionAlong(coords: Vec2[], dist: number[], d: number): LinePosition {
  const lastSegment = coords.length - 2;
  let lo = 0;
  let hi = lastSegment;
  while (lo < hi) {   // the last segment that starts at or before `d`
    const mid = (lo + hi + 1) >> 1;
    if (dist[mid] <= d) lo = mid; else hi = mid - 1;
  }
  let index = lo;
  while (index > 0 && dist[index + 1] === dist[index]) index--;
  while (index < lastSegment && dist[index + 1] === dist[index]) index++;

  const len = dist[index + 1] - dist[index];
  const t = (len > 0) ? Math.min(1, Math.max(0, (d - dist[index]) / len)) : 0;

  const a = coords[index];
  const b = coords[index + 1];
  const coord: Vec2 = (t === 0) ? [a[0], a[1]] : (t === 1) ? [b[0], b[1]] : vecInterp(a, b, t);
  return { index: index, t: t, coord: coord };
}


/**
 * Returns the heading of a line around a distance along it: the direction from the point half a
 * window behind to the point half a window ahead. Near an end of the line, the window is shifted to
 * stay on the line. Measuring over a window smooths out the noise of short segments on a curve.
 * @param  coords - The line (2 or more coords, not all the same point)
 * @param  dist - The distance to each vertex, from `geomLineDistances(coords)`
 * @param  d - The distance along the line
 * @param  window - The length of the window, in the same units as `coords`
 * @return Heading angle, in radians
 */
export function geomHeadingAlong(coords: Vec2[], dist: number[], d: number, window: number): number {
  const total = dist.at(-1)!;
  let lo = d - window / 2;
  let hi = d + window / 2;
  if (lo < 0) {
    hi = Math.min(total, hi - lo);
    lo = 0;
  }
  if (hi > total) {
    lo = Math.max(0, lo - (hi - total));
    hi = total;
  }
  const a = geomPositionAlong(coords, dist, lo).coord;
  const b = geomPositionAlong(coords, dist, hi).coord;
  return vecAngle(a, b);
}


/**
 * Converts a distance in meters to world units (z16 pre-scaled Mercator) at a given latitude.
 * Web Mercator is conformal, so the scale is the same along x and y. It grows with latitude
 * (by `1/cos(lat)`), so the result is only valid near `atLat`. That is accurate enough for
 * the short distances used in conflation, such as a buffer of a few meters around one feature.
 * @param  m - Distance in meters
 * @param  atLat - Latitude (degrees) where the distance is measured
 * @return Distance in world units (`0` at the poles)
 */
export function geoMetersToWorld(m: number, atLat: number): number {
  return geoMetersToLon(m, atLat) / 360 * WORLD_SIZE;
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
