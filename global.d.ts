/**
 * Global type declarations for Rapid
 *
 * This file contains:
 * - Global variable declarations (for test environment)
 * - Type augmentations for external libraries with incorrect types
 *
 * Note: Ambient module declarations for libraries without types
 * (like @mapbox/polylabel) live in modules/types/*.d.ts files.
 */

// Global variable declarations
declare const expect: Chai.ExpectStatic;
declare const Rapid: typeof import("./modules/index.js");

// Type augmentations for external libraries with incorrect types
// The `export {}` makes this file a module, enabling augmentation
export {};

declare module 'd3-geo' {
  /**
   * Raw Mercator projection function.
   * @types/d3-geo incorrectly types this as a factory function,
   * but it's actually the raw projection function itself.
   * @param lambda - Longitude in radians
   * @param phi - Latitude in radians
   * @returns Projected [x, y] coordinates
   */
  export function geoMercatorRaw(lambda: number, phi: number): [number, number];
}