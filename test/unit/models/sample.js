
export const point = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'Point',
    coordinates: [0, 0]
  }
};

export const multipoint = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'MultiPoint',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  }
};

export const linestring = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [-1, 0], [0, 0], [1, 0]
    ]
  }
};

export const multilinestring = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [[-1, 0], [0, 0], [1, 0]],
      [[-1, 2], [0, 2], [1, 2]]
    ]
  }
};

export const polygon = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [[-5, -5], [5, -5], [5, -1], [-5, -1], [-5, -5]],  // outer, counterclockwise
      [[-4, -4], [-4, -2], [4, -2], [4, -4], [-4, -4]]   // hole, clockwise
    ]
  }
};

export const multipolygon = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [[-5, -5], [5, -5], [5, -1], [-5, -1], [-5, -5]],  // outer, counterclockwise
        [[-4, -4], [-4, -2], [4, -2], [4, -4], [-4, -4]]   // hole, clockwise
      ], [
        [[-5, 1], [5, 1], [5, 5], [-5, 5], [-5, 1]],  // outer, counterclockwise
        [[-4, 2], [4, 2], [4, 4], [-4, 4], [-4, 2]]   // hole, clockwise
      ]
    ]
  }
};

export const featurecollection = {
  type: 'FeatureCollection',
  properties: { foo: 'bar' },
  features: [
    point,
    linestring,
    polygon
  ]
};

export const geometrycollection = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'GeometryCollection',
    geometries: [
      point.geometry,
      linestring.geometry,
      polygon.geometry
    ]
  }
};


// degenerate stuff
export const nullfeature = {
  type: 'Feature',
  properties: null,
  geometry: null
};

export const emptyfeaturecollection = {
  type: 'FeatureCollection',
  properties: { foo: 'bar' },
  features: []
};

export const nullpoint = {
  type: 'Feature',
  properties: { foo: 'bar' },
  geometry: {
    type: 'Point',
    coordinates: null
  }
};
