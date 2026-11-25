// The band along the inside of an area's edge: what a partial fill fills.
// See "The line builder" in `design/graphics-system.md`.
import { ClipType, EndType, FillRule, JoinType, PolyTree64, booleanOpWithPolyTree, difference, inflatePaths } from 'clipper2-ts';

import type { Path64, Paths64, PolyPath64 } from 'clipper2-ts';


/** A ring as `[x, y, x, y, …]` */
type FlatRing = number[] | Float32Array | Float64Array;

/**
 * One piece of an area's band: a ring, and the rings cut out of it.
 * Each is `[x, y, x, y, …]`, without its first point again at the end.
 */
export interface BandPolygon {
  outer: number[];
  holes: number[][];
}

// Clipper works in whole numbers: a unit of the coordinates is this many of them.
// (For a pixel at zoom 16 that's finer than a pixel at zoom 22. Clipper takes numbers up to 2^53,
// and world coordinates at zoom 16 are under 2^25.)
const SCALE = 256;

// The band's inside edge is an arc around a corner that points into the area. The arc is drawn
// in straight pieces that stray from it by no more than this share of the band's width (a quarter
// of a pixel, for a band of 32).
const ARC_TOLERANCE = 1 / 128;


/**
 * Turns rings into Clipper's paths, in whole numbers.
 * @param rings - The rings, each as `[x, y, x, y, …]` (the last point may repeat the first)
 * @param first - The first of them to take
 * @param end - Where to stop (the ring before this one is the last)
 * @param scale - How many whole numbers a unit of the coordinates is
 * @return The paths. A ring of fewer than three points has none, and a point that isn't a number is left out.
 */
function toPaths(rings: FlatRing[], first: number, end: number, scale: number): Paths64 {
  const paths: Paths64 = [];
  for (let r = first; r < end; r++) {
    const ring = rings[r];
    let numPoints = ring.length >> 1;
    if (numPoints > 1 && ring[0] === ring[numPoints * 2 - 2] && ring[1] === ring[numPoints * 2 - 1]) {
      numPoints--;
    }
    const path: Path64 = [];
    for (let i = 0; i < numPoints; i++) {
      const x = Math.round(ring[i * 2] * scale);
      const y = Math.round(ring[i * 2 + 1] * scale);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        path.push({ x: x, y: y });
      }
    }
    if (path.length >= 3) {
      paths.push(path);
    }
  }
  return paths;
}


/**
 * Turns one of Clipper's paths back into a ring.
 * @param path - The path
 * @param scale - How many whole numbers a unit of the coordinates is
 * @return The ring as `[x, y, x, y, …]`
 */
function toRing(path: Path64, scale: number): number[] {
  const ring: number[] = new Array(path.length * 2);
  for (let i = 0; i < path.length; i++) {
    ring[i * 2] = path[i].x / scale;
    ring[i * 2 + 1] = path[i].y / scale;
  }
  return ring;
}


/**
 * Gathers the polygons of a result of Clipper's: a ring with its holes, then whatever is inside
 * those holes, and so on down.
 * @param node - A ring that has area inside it. Its children are its holes.
 * @param scale - How many whole numbers a unit of the coordinates is
 * @param polygons - Where to add the polygons
 */
function gatherPolygons(node: PolyPath64, scale: number, polygons: BandPolygon[]): void {
  const outer = node.poly;
  if (!outer) return;

  const holes: number[][] = [];
  for (let i = 0; i < node.count; i++) {
    const hole = node.child(i);
    if (hole.poly) {
      holes.push(toRing(hole.poly, scale));
    }
  }
  polygons.push({ outer: toRing(outer, scale), holes: holes });

  for (let i = 0; i < node.count; i++) {
    const hole = node.child(i);
    for (let k = 0; k < hole.count; k++) {
      gatherPolygons(hole.child(k), scale, polygons);
    }
  }
}


/**
 * Works out the band along the inside of an area's edge: the part of the area that's within a
 * distance of its outline, holes' outlines included. It's the area without its middle, where
 * the middle is the area shrunk by that distance (Clipper does the shrinking, and cleans up
 * what folds over). So the band never leaves the area, and nothing in it is covered twice.
 *
 * Most areas have no middle at that distance: a building 60 across has none at 32. Then the
 * band is the whole area, and the answer is `null`. A caller that knows the widest circle that
 * fits in the area (`GeometryPart`'s `inradius`) knows that without asking.
 *
 * Around a corner that points into the area, the band's inside edge is an arc: it's everywhere
 * the distance from the edge. Coordinates are rounded to 1/256 of a unit.
 *
 * @param rings - The area's rings, each as `[x, y, x, y, …]`: the outer ring, then its holes.
 *   A ring's last point may repeat its first, and it may go around either way. A hole counts
 *   only where it's inside the outer ring.
 * @param width - How wide the band is, in the units of the coordinates
 * @return The band's polygons, or `null` if the band is the whole area. No polygons if there's
 *   no area, or no width.
 */
export function geomAreaBand(rings: FlatRing[], width: number): BandPolygon[] | null {
  if (!rings.length || !(width > 0)) return [];

  const scale = SCALE;

  // The area is what's inside the outer ring and in none of the holes, whichever way the rings
  // go around, and wherever the holes are (in OSM they're not always inside their outer ring).
  let area = toPaths(rings, 0, 1, scale);
  if (rings.length > 1) {
    area = difference(area, toPaths(rings, 1, rings.length, scale), FillRule.NonZero);
  }
  if (!area.length) return [];

  const middle = inflatePaths(area, -width * scale, JoinType.Round, EndType.Polygon, 2, width * scale * ARC_TOLERANCE);
  if (!middle.length) return null;

  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Difference, area, middle, tree, FillRule.NonZero);

  const polygons: BandPolygon[] = [];
  for (let i = 0; i < tree.count; i++) {
    gatherPolygons(tree.child(i), scale, polygons);
  }
  return polygons;
}
