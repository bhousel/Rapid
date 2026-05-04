import { Extent } from '@rapid-sdk/math';

import type { GeometryPartWorldData, GeometryPartWorldScaledData, SSRData, Vec2 } from './types.ts';
import type { Viewport } from '@rapid-sdk/math';


/**
 * Reference zoom level for scaled world coordinates.
 *
 * Scaled world coordinates = world coordinates × 2^REF_Z.
 * - World (z0) range: 0..256
 * - Scaled world (z16) range: 0..16,777,216
 *
 * This gives Pixi's tessellator comfortable numbers to work with:
 * - Vertex deltas (after anchor subtraction): hundreds to thousands of units
 * - Stroke width at z=20: 2 × 2^(16-20) = 0.125 local units (vs 1.9e-6 with z0)
 *
 * The Pixi group scale for a world-scaled group is `2^(currentZoom - REF_Z)`.
 */
export const REF_Z = 16;

/** Multiplier from world (z0) to worldScaled (z16) space */
const REF_SCALE = Math.pow(2, REF_Z);


/**
 * Converts a single world coordinate (0..256) to scaled world (0..16,777,216).
 */
export function worldToScaled(coord: Vec2): Vec2 {
  return [coord[0] * REF_SCALE, coord[1] * REF_SCALE];
}


/**
 * Converts a single scaled world coordinate (0..16,777,216) back to world (0..256).
 */
export function scaledToWorld(coord: Vec2): Vec2 {
  return [coord[0] / REF_SCALE, coord[1] / REF_SCALE];
}


/**
 * Converts a scaled world coordinate to a screen coordinate using the viewport transform.
 * Equivalent to `viewport.worldToScreen(scaledToWorld(coord))`.
 */
export function scaledWorldToScreen(viewport: Viewport, coord: Vec2): Vec2 {
  return viewport.worldToScreen(scaledToWorld(coord));
}


/**
 * Converts a screen coordinate to a scaled world coordinate using the viewport transform.
 * Equivalent to `worldToScaled(viewport.screenToWorld(screen))`.
 */
export function screenToScaledWorld(viewport: Viewport, screen: Vec2): Vec2 {
  return worldToScaled(viewport.screenToWorld(screen));
}


/**
 * Builds a `GeometryPartWorldScaledData` object from an existing `GeometryPartWorldData`.
 * Called once when geometry is set; the result is cached on `GeometryPart.worldScaled`.
 */
export function buildWorldScaled(world: GeometryPartWorldData, type: 'Point' | 'LineString' | 'Polygon'): GeometryPartWorldScaledData {
  // Scale coords
  let scaledCoords: Vec2 | Vec2[] | Vec2[][];

  if (type === 'Point') {
    scaledCoords = worldToScaled(world.coords as Vec2);
  } else if (type === 'LineString') {
    const ring = world.coords as Vec2[];
    scaledCoords = ring.map(worldToScaled);
  } else {  // Polygon
    const rings = world.coords as Vec2[][];
    scaledCoords = rings.map(ring => ring.map(worldToScaled));
  }

  // Scale extent
  const scaledExtent = new Extent(
    worldToScaled(world.extent.min as Vec2),
    worldToScaled(world.extent.max as Vec2)
  );

  // Anchor = extent center (pre-computed for per-feature container positioning)
  const anchor = worldToScaled(world.extent.center() as Vec2);

  const result: GeometryPartWorldScaledData = {
    coords: scaledCoords,
    extent: scaledExtent,
    anchor,
  };

  if (world.outer) result.outer = world.outer.map(worldToScaled);
  if (world.hull)  result.hull  = world.hull.map(worldToScaled);
  if (world.centroid) result.centroid = worldToScaled(world.centroid);
  if (world.poi)   result.poi   = worldToScaled(world.poi);
  if (world.ssr) {
    result.ssr = {
      angle: world.ssr.angle,
      poly: world.ssr.poly.map(worldToScaled),
    } as SSRData;
  }

  return result;
}
