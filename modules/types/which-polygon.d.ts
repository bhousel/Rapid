declare module 'which-polygon' {
  export interface WhichPolygonResult {
    id: string;
    [key: string]: unknown;
  }

  export interface WhichPolygonQuery {
    (point: [number, number], multi?: false): WhichPolygonResult | null;
    (point: [number, number], multi: true): WhichPolygonResult[];
    bbox(bbox: [number, number, number, number], multi?: boolean): WhichPolygonResult[];
  }

  // Use a loose type for FeatureCollection to accept both internal GeoJSONObject types
  // and external GeoJSON.FeatureCollection types. The internal types have `geometry?: ...`
  // (optional) while the standard types require `geometry: ... | null`.
  interface FeatureCollectionLike {
    type?: 'FeatureCollection';
    features: unknown[];
  }

  function whichPolygon(geojson: FeatureCollectionLike): WhichPolygonQuery;

  export = whichPolygon;
}
