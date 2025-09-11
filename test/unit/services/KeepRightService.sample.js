// data near [10°, 0°]
export const data10 = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0001, 0]
      },
      properties: {
        error_id: '1',
        error_type: '300',
        object_type: 'way',
        object_id: '1',  // i.e. 'w1'
        comment: null,
        schema: '56',
        description: 'missing maxspeed tag',
        title: 'missing maxspeed'
      }
    }, {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0002, 0]
      },
      properties: {
        error_id: '2',
        error_type: '390',
        object_type: 'way',
        object_id: '2',  // i.e. 'w2'
        comment: null,
        schema: '56',
        description: 'This track doesn\'t have a tracktype',
        title: 'missing tracktype'
      }
    }, {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0003, 0]
      },
      properties: {
        error_id: '3',
        error_type: '50',
        object_type: 'node',
        object_id: '1',  // i.e. 'n1'
        comment: null,
        schema: '56',
        description: 'This node is very close but not connected to way #1',
        title: 'almost-junctions'
      }
    }
  ]
};
