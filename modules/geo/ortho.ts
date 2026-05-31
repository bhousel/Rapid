import { DEG2RAD, RAD2DEG, vecEqual, vecNormalizedDot } from '@rapid-sdk/math';

import type { Vec2 } from '@rapid-sdk/math';


/** Point with coordinate for orthogonalization */
interface OrthoPoint {
  coord: Vec2;
}


/**
 * Calculate the normalized dot product for orthogonalization.
 * @param a - First point
 * @param b - Second point
 * @param origin - Origin point
 * @returns Normalized dot product, or 1 if points are coincident
 */
export function geoOrthoNormalizedDotProduct(a: Vec2, b: Vec2, origin: Vec2): number {
  if (vecEqual(origin, a) || vecEqual(origin, b)) {
    return 1;  // coincident points, treat as straight and try to remove
  }
  return vecNormalizedDot(a, b, origin);
}


/**
 * Filter dot product for orthogonalization.
 * @param dotp - Dot product value
 * @param epsilon - Epsilon for comparing to orthogonal/straight
 * @param lowerThreshold - Lower threshold for adjustable range
 * @param upperThreshold - Upper threshold for adjustable range
 * @param allowStraightAngles - Whether to allow straight angles
 * @returns 0 if already orthogonal, dotp if adjustable, or null to ignore
 */
function geoOrthoFilterDotProduct(
  dotp: number,
  epsilon: number,
  lowerThreshold: number,
  upperThreshold: number,
  allowStraightAngles?: boolean
): number | null {
  const val = Math.abs(dotp);
  if (val < epsilon) {
    return 0;      // already orthogonal
  } else if (allowStraightAngles && Math.abs(val - 1) < epsilon) {
    return 0;      // straight angle, which is okay in this case
  } else if (val < lowerThreshold || val > upperThreshold) {
    return dotp;   // can be adjusted
  } else {
    return null;   // ignore vertex
  }
}


/**
 * Calculate the orthogonalization score for a set of points.
 * @param points - Array of points with coordinates
 * @param isClosed - Whether the shape is closed
 * @param epsilon - Epsilon for orthogonal comparison
 * @param threshold - Angle threshold in degrees
 * @returns Score indicating how far from orthogonal the shape is
 */
export function geoOrthoCalcScore(points: OrthoPoint[], isClosed: boolean, epsilon: number, threshold: number): number {
  let score = 0;
  const first = isClosed ? 0 : 1;
  const last = isClosed ? points.length : points.length - 1;
  const coords = points.map(p => p.coord);

  const lowerThreshold = Math.cos((90 - threshold) * DEG2RAD);
  const upperThreshold = Math.cos(threshold * DEG2RAD);

  for (let i = first; i < last; i++) {
    const a = coords[(i - 1 + coords.length) % coords.length];
    const origin = coords[i];
    const b = coords[(i + 1) % coords.length];

    const dotp = geoOrthoFilterDotProduct(geoOrthoNormalizedDotProduct(a, b, origin), epsilon, lowerThreshold, upperThreshold);
    if (dotp === null) continue;    // ignore vertex
    score = score + 2.0 * Math.min(Math.abs(dotp - 1.0), Math.min(Math.abs(dotp), Math.abs(dotp + 1)));
  }

  return score;
}


/**
 * Returns the maximum angle less than `lessThan` between the actual corner and a 0° or 90° corner.
 * @param coords - Array of coordinates
 * @param isClosed - Whether the shape is closed
 * @param lessThan - Maximum angle threshold
 * @returns Maximum offset angle, or null if none found
 */
export function geoOrthoMaxOffsetAngle(coords: Vec2[], isClosed: boolean, lessThan: number): number | null {
  let max = -Infinity;

  const first = isClosed ? 0 : 1;
  const last = isClosed ? coords.length : coords.length - 1;

  for (let i = first; i < last; i++) {
    const a = coords[(i - 1 + coords.length) % coords.length];
    const origin = coords[i];
    const b = coords[(i + 1) % coords.length];
    const normalizedDotP = geoOrthoNormalizedDotProduct(a, b, origin);

    let angle = Math.acos(Math.abs(normalizedDotP)) * RAD2DEG;

    if (angle > 45) angle = 90 - angle;

    if (angle >= lessThan) continue;

    if (angle > max) max = angle;
  }

  if (max === -Infinity) return null;

  return max;
}


/**
 * Similar to geoOrthoCalcScore, but returns quickly if there is something to do.
 * @param coords - Array of coordinates
 * @param isClosed - Whether the shape is closed
 * @param epsilon - Epsilon for orthogonal comparison
 * @param threshold - Angle threshold in degrees
 * @param allowStraightAngles - Whether to allow straight angles
 * @returns 1 if something to do, 0 if already square, null if nothing can be done
 */
export function geoOrthoCanOrthogonalize(
  coords: Vec2[],
  isClosed: boolean,
  epsilon: number,
  threshold: number,
  allowStraightAngles?: boolean
): number | null {
  let score: number | null = null;
  const first = isClosed ? 0 : 1;
  const last = isClosed ? coords.length : coords.length - 1;

  const lowerThreshold = Math.cos((90 - threshold) * DEG2RAD);
  const upperThreshold = Math.cos(threshold * DEG2RAD);

  for (let i = first; i < last; i++) {
    const a = coords[(i - 1 + coords.length) % coords.length];
    const origin = coords[i];
    const b = coords[(i + 1) % coords.length];

    const dotp = geoOrthoFilterDotProduct(geoOrthoNormalizedDotProduct(a, b, origin), epsilon, lowerThreshold, upperThreshold, allowStraightAngles);
    if (dotp === null) continue;        // ignore vertex
    if (Math.abs(dotp) > 0) return 1;   // something to do
    score = 0;                          // already square
  }

  return score;
}
