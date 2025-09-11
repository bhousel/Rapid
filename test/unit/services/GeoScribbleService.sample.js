// scribbles near [10°, 0°]
export const scribbles10 = {
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [ 10.0001, 0 ],
          [ 10.0002, 0 ],
          [ 10.0003, 0 ],
        ]
      },
      properties: {
        type: 'scribble',
        id: 1,
        style: 'scribble',
        color: '#ffffff',
        dashed: false,
        thin: true,
        userName: 'bhousel',
        userId: 1,
        editor: 'Every Door 6.0',
        created: '2025-09-01T00:00:00.0000-04:00'
      }
    }, {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0001, 0]
      },
      properties: {
        type: 'label',
        id: 2,
        color: null,
        text: 'sample',
        username: 'bhousel',
        userId: 1,
        editor: 'Every Door 6.0',
        created: '2025-09-01T00:00:00.0000-04:00'
      }
    }
  ]
};
