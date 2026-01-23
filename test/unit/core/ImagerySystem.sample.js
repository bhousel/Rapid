// Sample data for ImagerySystem tests

export const njPolygon = {
  type: 'Feature',
  id: 'nj-polygon',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-74.897, 38.835], [-74.088, 39.649], [-73.860, 40.479], [-74.078, 40.535], [-73.828, 40.989],
      [-74.769, 41.413], [-75.410, 40.716], [-74.891, 40.175], [-75.789, 39.597], [-74.897, 38.835]
    ]]
  }
};

export const caPolygon = {
  type: 'Feature',
  id: 'ca-polygon',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-124.5, 38.8], [-119.5, 32.2], [-114.3, 32.6], [-114, 34.6],
      [-119.9, 39], [-119.9, 42.1], [-124.5, 42.1], [-124.5, 38.8]
    ]]
  }
};


// Initial imagery data to add
export const addImageryData = {
  assetID: 'add-imagery-data',
  imagery: {
    'nj-2015': {
      id: 'nj-2015',
      name: 'NJ 2015 Aerial Imagery',
      type: 'wms',
      template: 'https://img.nj.gov/imagerywms/Natural2015?LAYERS=Natural2015&FORMAT=image/png&SRS={proj}&WIDTH={width}&HEIGHT={height}&BBOX={bbox}',
      projection: 'EPSG:3857',
      endDate: '2015-05-03T00:00:00.000Z',
      startDate: '2015-03-29T00:00:00.000Z',
      zoomExtent: [3, 20],
      terms_url: 'https://njgin.state.nj.us/',
      terms_text: 'NJ OGIS',
      description: 'Digital orthophotography of New Jersey',
      feature: {
        type: 'Feature',
        properties: { id: 'nj-2015' },
        geometry: njPolygon.geometry
      }
    },
    'nj-2020': {
      id: 'nj-2020',
      name: 'NJ 2020 Aerial Imagery',
      type: 'wms',
      template: 'https://img.nj.gov/imagerywms/Natural2020?LAYERS=Natural2020&FORMAT=image/png&SRS={proj}&WIDTH={width}&HEIGHT={height}&BBOX={bbox}',
      projection: 'EPSG:3857',
      zoomExtent: [3, 20],
      description: 'Digital orthophotography of New Jersey 2020',
      feature: {
        type: 'Feature',
        properties: { id: 'nj-2020' },
        geometry: njPolygon.geometry
      }
    },
    'ca-imagery': {
      id: 'ca-imagery',
      name: 'California Imagery',
      type: 'tms',
      template: 'https://example.com/ca/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 20],
      description: 'California aerial imagery',
      feature: {
        type: 'Feature',
        properties: { id: 'ca-imagery' },
        geometry: caPolygon.geometry
      }
    },
    'test-overlay': {
      id: 'test-overlay',
      name: 'Test Overlay',
      type: 'tms',
      template: 'https://example.com/overlay/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 18],
      overlay: true,
      description: 'A test overlay layer'
    },
    'foo-source1': {
      id: 'foo-source1',
      name: 'Foo Source 1',
      type: 'tms',
      template: 'https://example.com/foo1/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 18]
    },
    'foo-source2': {
      id: 'foo-source2',
      name: 'Foo Source 2',
      type: 'tms',
      template: 'https://example.com/foo2/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 18]
    },
    'bar-source': {
      id: 'bar-source',
      name: 'Bar Source',
      type: 'tms',
      template: 'https://example.com/bar/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 18]
    },
    'TestBing': {
      id: 'TestBing',
      name: 'Test Bing Imagery',
      type: 'bing',
      template: 'https://www.bing.com/maps',
      zoomExtent: [1, 22],
      description: 'Test Bing satellite and aerial imagery.'
    },
    'EsriWorldImageryTest': {
      id: 'EsriWorldImageryTest',
      name: 'Test Esri World Imagery',
      type: 'tms',
      template: 'https://{switch:services,server}.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}',
      zoomExtent: [0, 22],
      terms_url: 'https://wiki.openstreetmap.org/wiki/Esri',
      terms_text: 'Terms & Feedback',
      description: 'Test Esri World Imagery'
    },
    'EsriWayback': {
      id: 'EsriWayback',
      name: 'Esri Wayback',
      type: 'tms',
      template: '',
      zoomExtent: [0, 22],
      terms_url: 'https://wiki.openstreetmap.org/wiki/Esri',
      terms_text: 'Terms & Feedback',
      description: 'Esri Wayback contains archived snapshots of Esri World Imagery created over time.'
    }
  }
};


// Update some existing imagery
export const updateImageryData = {
  assetID: 'update-imagery-data',
  imagery: {
    'nj-2015': {
      id: 'nj-2015',
      name: 'NJ 2015 Aerial Imagery (Updated)',
      type: 'wms',
      template: 'https://img.nj.gov/imagerywms/Natural2015?LAYERS=Natural2015&FORMAT=image/png&SRS={proj}&WIDTH={width}&HEIGHT={height}&BBOX={bbox}',
      projection: 'EPSG:3857',
      zoomExtent: [3, 21],  // increased max zoom
      description: 'Updated Digital orthophotography of New Jersey',
      best: true,  // mark as best
      feature: {
        type: 'Feature',
        properties: { id: 'nj-2015' },
        geometry: njPolygon.geometry
      }
    },
    'new-source': {
      id: 'new-source',
      name: 'New Source',
      type: 'tms',
      template: 'https://example.com/new/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 19]
    }
  }
};


// Delete some imagery using wildcards
export const deleteImageryData = {
  assetID: 'delete-imagery-data',
  imagery: {
    'foo-*': null,      // delete all foo-* sources
    'bar-source': null  // delete specific source
  }
};


// Imagery with blocklist-matching template (for testing blocklist)
export const blocklistedImageryData = {
  assetID: 'blocklisted-imagery-data',
  imagery: {
    'blocked-source': {
      id: 'blocked-source',
      name: 'Blocked Source',
      type: 'tms',
      template: 'https://blocked.example.com/{zoom}/{x}/{y}.png',
      zoomExtent: [1, 18]
    }
  }
};
