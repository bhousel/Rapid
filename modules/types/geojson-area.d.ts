declare module '@mapbox/geojson-area' {
  interface GeoJSONArea {
    geometry(geometry: GeoJSON.Geometry): number;
    ring(coordinates: number[][]): number;
  }

  const calcArea: GeoJSONArea;
  export = calcArea;
}
