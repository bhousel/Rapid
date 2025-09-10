import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

// photos near [10°, 0°]
const images10 = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      id: 1,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [10.001, 0]
    }
  }, {
    type: 'Feature',
    properties: {
      id: 2,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [10.002, 0]
    }
  }, {
    type: 'Feature',
    properties: {
      id: 3,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [10.003, 0]
    }
  }]
};

const sequences10 = {
  type: 'Feature',
  properties: {
    id: 100,
    image_id: 1,
    captured_at: 1735689600000,
    creator_id: 1,
    is_pano: false
  },
  geometry: {
    type: 'LineString',
    coordinates: [[10.001, 0], [10.002, 0], [10.003, 0]]
  }
};

export const pbf10 = vtpbf.fromGeojsonVt({
  image:    geojsonvt(images10).getTile(14, 8647, 8192),    // z,x,y
  sequence: geojsonvt(sequences10).getTile(14, 8647, 8192)  // z,x,y
});


// photos near [0°, 0°]
const images0 = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      id: 1,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [0.001, 0]
    }
  }, {
    type: 'Feature',
    properties: {
      id: 2,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [0.002, 0]
    }
  }, {
    type: 'Feature',
    properties: {
      id: 3,
      sequence_id: 100,
      captured_at: 1735689600000,
      creator_id: 1,
      compass_angle: 0,
      is_pano: false
    },
    geometry: {
      type: 'Point',
      coordinates: [0.003, 0]
    }
  }]
};

const sequences0 = {
  type: 'Feature',
  properties: {
    id: 100,
    image_id: 1,
    captured_at: 1735689600000,
    creator_id: 1,
    is_pano: false
  },
  geometry: {
    type: 'LineString',
    coordinates: [[0.001, 0], [0.002, 0], [0.003, 0]]
  }
};

export const pbf0 = vtpbf.fromGeojsonVt({
 image:    geojsonvt(images0).getTile(14, 8192, 8192),    // z,x,y
 sequence: geojsonvt(sequences0).getTile(14, 8192, 8192)  // z,x,y
});

