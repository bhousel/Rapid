/**
 * Type declarations for @mapbox/polylabel
 * This library has no @types package available.
 */
declare module '@mapbox/polylabel' {
  /**
   * Polylabel finds the pole of inaccessibility of a polygon.
   * @param polygon - Polygon coordinates as [outer, ...holes]
   * @param precision - Precision (defaults to 1.0)
   * @returns The pole of inaccessibility as [x, y]
   */
  function polylabel(polygon: number[][][], precision?: number): [number, number];
  export = polylabel;
}
