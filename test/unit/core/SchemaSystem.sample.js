
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
    name: { 'key': 'name', 'type': 'localized', 'universal': true },
    weather: { 'key': 'weather', 'type': 'weather', 'universal': true },
    'surf/type': {
      label: 'Surf Type',
      key: 'surf:type',
      type: 'combo',
      locationSet: { 'include': ['surf-city-nj.geojson'] }
    },
    'board/type': {
      label: 'Board Type',
      key: 'board:type',
      type: 'combo',
      locationSet: { 'include': ['surf-city-nj.geojson'] }
    }
  },
  presets: {
    'amenity/shop/surf': {
      name: 'Surf Shop',
      icon: 'iD-surfing',
      locationSet: { 'include': ['surf-city-nj.geojson'] },
      fields: [ 'name', 'surf/type' ],
      moreFields: [ 'weather', 'board/type' ],
      tags: { amenity: 'shop', 'surf:type': 'surf' },
      geometry: ['point', 'area']
    }
  },
  categories: {
    'category-surfing': {
      name: 'Surf Features',
      icon: 'iD-surfing',
      locationSet: { 'include': ['surf-city-nj.geojson'] },
      members: [
        'amenity/shop/surf',
        'club/surf'
      ]
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
      locationSet: { 'include': ['surf-city-nc.geojson', 'surf-city-nj.geojson'] }
    },
    'board/type': {
      label: 'Board Type',
      key: 'board:type',
      type: 'combo',
      locationSet: { 'include': ['surf-city-nc.geojson', 'surf-city-nj.geojson'] }
    }
  },
  presets: {
    'amenity/shop/surf': {
      name: 'Surfing Shop',
      icon: 'iD-surfing',
      locationSet: { 'include': ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
      fields: [ 'name', 'surf/type' ],
      moreFields: [ 'weather', 'board/type' ],
      tags: { amenity: 'shop', 'surf:type': 'surf' },
      geometry: ['point', 'area']
    },
    'club/surf': {
      name: 'Surfing Club',
      icon: 'iD-surfing',
      locationSet: { 'include': ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
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
      locationSet: { 'include': ['surf-city-nc.geojson', 'surf-city-nj.geojson'] },
      members: [
        'amenity/shop/surf',
        'club/surf'
      ]
    },
    'category-shopping': {
      name: 'Shopping Features',
      icon: 'iD-shopping',
      members: [
        'amenity/shop/surf'
      ]
    }
  },
  featureCollection: surfCityNC
};


export const deleteSurfData = {
  schemaID: 'delete-surf-data',
  fields: {
    'board/type': null,
  },
  presets: {
    'club/surf': null,
  },
  categories: {
    'category-shopping': null
  }
};
