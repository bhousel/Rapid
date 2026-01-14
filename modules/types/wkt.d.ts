declare module 'wkt' {
  /**
   * Parse a WKT string into a GeoJSON geometry
   * @param wktString - The WKT string to parse
   * @returns A GeoJSON geometry object, or null if parsing failed
   */
  export function parse(wktString: string): GeoJSON.Geometry | null;

  /**
   * Convert a GeoJSON geometry to a WKT string
   * @param geojson - A GeoJSON geometry object
   * @returns The WKT string representation
   */
  export function stringify(geojson: GeoJSON.Geometry): string;
}
