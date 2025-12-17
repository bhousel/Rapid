
export const surfCityNJ = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'surf-city-nj.geojson',   // Surf City, New Jersey
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-74.163, 39.680], [-74.190, 39.655], [-74.168, 39.646], [-74.149, 39.675], [-74.163, 39.680]]
      ]
    }
  }]
};

export const surfCityNC = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'surf-city-nc.geojson',  // Surf City, North Carolina
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-77.626, 34.390], [-77.611, 34.377], [-77.522, 34.437], [-77.534, 34.449], [-77.626, 34.390]]
      ]
    }
  }]
};

export const addSurfData = {
  schemaID: 'add-surf-data',
  fields: {
    'field/foo1':  { key: 'foo1', type: 'text' },
    'field/foo2':  { key: 'foo2', type: 'text' },
    'field/ban':   { key: 'ban', type: 'text' },
    'field/bun':   { key: 'bun', type: 'text' },

    'name':    { key: 'name', type: 'localized', universal: true },
    'weather': { key: 'weather', type: 'weather', universal: true },

    'surf/type': {
      label: 'Surf Type',
      key: 'surf:type',
      type: 'combo',
      locationSet: { include: ['surf-city-nj.geojson'] }
    },
    'board/type': {
      label: 'Board Type',
      key: 'board:type',
      type: 'combo',
      locationSet: { include: ['surf-city-nj.geojson'] }
    }
  },

  presets: {
    'preset/foo1':  { fields: ['field/foo1'] },
    'preset/foo2':  { fields: ['field/foo2'] },
    'preset/ban':   { fields: ['field/ban'] },
    'preset/bun':   { fields: ['field/bun'] },

    'amenity/shop/surf': {
      name: 'Surf Shop',
      icon: 'iD-surfing',
      locationSet: { include: ['surf-city-nj.geojson'] },
      fields: [ 'name', 'surf/type' ],
      moreFields: [ 'weather', 'board/type' ],
      tags: { amenity: 'shop', 'surf:type': 'surf' },
      geometry: ['point', 'area']
    }
  },

  categories: {
    'category-foo1':  { members: ['preset/foo1'] },
    'category-foo2':  { members: ['preset/foo2'] },
    'category-ban':   { members: ['preset/ban'] },
    'category-bun':   { members: ['preset/bun'] },

    'category-surfing': {
      name: 'Surf Features',
      icon: 'iD-surfing',
      locationSet: { include: ['surf-city-nj.geojson'] },
      members: ['amenity/shop/surf', 'club/surf']
    }
  },
  defaults: {
    point: ['amenity/shop/surf', 'club/surf'],
    area: ['amenity/shop/surf', 'club/surf'],
    dummy: ['amenity/shop/surf', 'club/surf']
  },
  featureCollection: surfCityNJ
};


export const updateSurfData = {
  schemaID: 'update-surf-data',
  fields: {
    'surf/type': {
      label: 'Surfing Type',
      key: 'surf:type',
      type: 'combo',
      locationSet: { include: ['surf-city-nc.geojson', 'surf-city-nj.geojson'] }
    },
    'board/type': {
      label: 'Board Type',
      key: 'board:type',
      type: 'combo',
      locationSet: { include: ['surf-city-nc.geojson', 'surf-city-nj.geojson'] }
    }
  },
  presets: {
    'amenity/shop/surf': {
      name: 'Surfing Shop',
      icon: 'iD-surfing',
      locationSet: { include: ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
      fields: [ 'name', 'surf/type' ],
      moreFields: [ 'weather', 'board/type' ],
      tags: { amenity: 'shop', 'surf:type': 'surf' },
      geometry: ['point', 'area']
    },
    'club/surf': {
      name: 'Surfing Club',
      icon: 'iD-surfing',
      locationSet: { include: ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
      fields: [ 'name', 'surf/type' ],
      moreFields: [ 'weather', 'board/type' ],
      tags: { club: 'surfing', 'surf:type': 'surf' },
      geometry: ['point', 'area']
    }
  },
  categories: {
    'category-surfing': {
      name: 'Surfing Features',
      icon: 'iD-surfing',
      locationSet: { include: ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
      members: ['amenity/shop/surf', 'club/surf']
    },
    'category-shopping': {
      name: 'Shopping Features',
      icon: 'iD-shopping',
      members: ['amenity/shop/surf']
    }
  },
  featureCollection: surfCityNC
};


export const deleteSurfData = {
  schemaID: 'delete-surf-data',
  fields: {
    'field/foo?': null,
    'field/b*n': null,
    'board/type': null,
  },
  presets: {
    'preset/foo?': null,
    'preset/b*n': null,
    'club/surf': null,
  },
  categories: {
    'category-foo?': null,
    'category-b*n': null,
    'category-shopping': null
  }
};


export const searchData = {
  schemaID: 'search-data',
  presets: {
    'amenity/bbq': {
      name: 'Grill', tags: { amenity: 'bbq' }, geometry: ['point'], terms: []
    },
    'amenity/grit_bin': {
      name: 'Sandpit', tags: { amenity: 'grit_bin' }, geometry: ['point'], terms: []
    },
    'highway/residential': {
      name: 'Residential Area', tags: { highway: 'residential' }, geometry: ['point', 'area'], terms: []
    },
    'landuse/grass1': {
      name: 'Grass', tags: { landuse: 'grass' }, geometry: ['point', 'area'], terms: []
    },
    'landuse/grass2': {
      name: 'Ğṝȁß', tags: { landuse: 'ğṝȁß' }, geometry: ['point', 'area'], terms: []
    },
    'leisure/park': {
      name: 'Park', tags: { leisure: 'park' }, geometry: ['point', 'area'], terms: [ 'grass' ], matchScore: 0.5
    },
    'amenity/parking': {
      name: 'Parking', tags: { amenity: 'parking' }, geometry: ['point', 'area'], terms: [ 'cars' ]
    },
    'leisure/pitch/soccer': {
      name: 'Soccer Field', tags: { leisure: 'pitch', sport: 'soccer' }, geometry: ['point', 'area'], terms: ['fußball']
    },
    'leisure/pitch/american_football': {
      name: 'Football Field', tags: { leisure: 'pitch', sport: 'american_football' }, geometry: ['point', 'area'], terms: ['gridiron']
    },
    'amenity/excluded': {
      name: 'Excluded', tags: { amenity: 'excluded' }, geometry: ['point'], terms: [], searchable: false
    }
  }
};
