// Sample data for StyleSystem tests

// Initial style data to add
export const addStyleData = {
  assetID: 'add-style-data',
  assetVersion: '2026-01-01',

  scopes: [{
    scope: '*',
    styles: {
      'DEFAULTS': {
        fill: { width: 2, color: 0xaaaaaa, opacity: 0.3 },
        casing: { width: 5, color: 0x444444, opacity: 1, cap: 'round', join: 'round' },
        stroke: { width: 3, color: 0xcccccc, opacity: 1, cap: 'round', join: 'round' }
      },
    }
  }, {
    scope: 'osm',
    styles: {
      'LIFECYCLE': {
        stroke: { dash: [7, 3], cap: 'butt' }
      },
      'motorway': {
        casing: { width: 10, color: 0x70372f },
        stroke: { width: 8, color: 0xcf2081 }
      },
      'trunk': {
        casing: { width: 10, color: 0x316C32 },
        stroke: { width: 8, color: 0x7FC97F }
      },
      'primary': {
        casing: { width: 10, color: 0x8D5A2C },
        stroke: { width: 8, color: 0xE46D71 }
      },
      'secondary': {
        casing: { width: 10, color: 0x8D5A2C },
        stroke: { width: 8, color: 0xF4CF58 }
      },
      'building_red': {
        fill: { color: 0xE06050, opacity: 0.3 }
      },
      'building_rapid': {
        fill: { color: 0xDA26D3, opacity: 0.3 }
      },
      'green': {
        fill: { color: 0x8cd05f, opacity: 0.3 }
      },
      'pattern-forest': {
        fill: { pattern: 'forest' }
      },
      'pattern-grass': {
        fill: { pattern: 'grass' }
      },
      'blue': {
        fill: { color: 0x77DDDD, opacity: 0.3 }
      },
      'footway': {
        casing: { width: 5, color: 0xffffff },
        stroke: { width: 3, color: 0x998888, dash: [6, 6], cap: 'butt' }
      },
      'foo-style1': {
        stroke: { width: 2, color: 0x111111 }
      },
      'foo-style2': {
        stroke: { width: 2, color: 0x222222 }
      },
      'bar-style': {
        stroke: { width: 2, color: 0x333333 }
      }
    },

    selectors: {
      'highway-motorway': {
        styleIDs: ['motorway'],
        match: { tags: [{ key: 'highway', value: 'motorway' }] }
      },
      'highway-trunk': {
        styleIDs: ['trunk'],
        match: { tags: [{ key: 'highway', value: 'trunk' }] }
      },
      'highway-primary': {
        styleIDs: ['primary'],
        match: { tags: [{ key: 'highway', value: 'primary' }] }
      },
      'highway-secondary': {
        styleIDs: ['secondary'],
        match: { tags: [{ key: 'highway', value: 'secondary' }] }
      },
      'building-default': {
        styleIDs: ['building_red'],
        match: { tags: [{ key: 'building' }] }
      },
      'landuse-forest': {
        styleIDs: ['green', 'pattern-forest'],
        match: { tags: [{ key: 'landuse', value: 'forest' }] }
      },
      'landuse-grass': {
        styleIDs: ['green', 'pattern-grass'],
        match: { tags: [{ key: 'landuse', value: 'grass' }] }
      },
      'natural-water': {
        styleIDs: ['blue'],
        match: { tags: [{ key: 'natural', value: 'water' }] }
      },
      'highway-footway': {
        styleIDs: ['footway'],
        match: { tags: [{ key: 'highway', value: 'footway' }] }
      },
      'foo-selector1': {
        styleIDs: ['foo-style1'],
        match: { tags: [{ key: 'test', value: 'foo1' }] }
      },
      'foo-selector2': {
        styleIDs: ['foo-style2'],
        match: { tags: [{ key: 'test', value: 'foo2' }] }
      },
      'bar-selector': {
        styleIDs: ['bar-style'],
        match: { tags: [{ key: 'test', value: 'bar' }] }
      }
    }
  }]
};


// Update some existing styles and selectors
export const updateStyleData = {
  assetID: 'update-style-data',
  assetVersion: '2026-01-02',

  scopes: [{
    scope: 'osm',
    styles: {
      'motorway': {
        casing: { width: 12, color: 0x70372f },
        stroke: { width: 10, color: 0xff0000 }
      },
      'new-style': {
        fill: { color: 0x123456, opacity: 0.5 }
      }
    },
    selectors: {
      'highway-motorway': {
        styleIDs: ['motorway'],
        match: { tags: [{ key: 'highway', value: 'motorway' }] }
      },
      'new-selector': {
        styleIDs: ['new-style'],
        match: { tags: [{ key: 'amenity', value: 'new_thing' }] }
      }
    }
  }]
};


// Delete some styles and selectors using wildcards
export const deleteStyleData = {
  assetID: 'delete-style-data',
  assetVersion: '2026-01-03',

  scopes: [{
    scope: 'osm',
    styles: {
      'foo-*': null,       // delete all foo-* styles
      'bar-style': null    // delete specific style
    },
    selectors: {
      'foo-*': null,       // delete all foo-* selectors
      'bar-selector': null // delete specific selector
    }
  }]
};


// Data for testing styleMatch
export const styleMatchData = {
  assetID: 'style-match-data',
  assetVersion: '2026-02-01',

  scopes: [{
    scope: '*',
    styles: {
      'DEFAULTS': {
        fill: { width: 2, color: 0xaaaaaa, opacity: 0.3 },
        casing: { width: 5, color: 0x444444, opacity: 1, cap: 'round', join: 'round' },
        stroke: { width: 3, color: 0xcccccc, opacity: 1, cap: 'round', join: 'round' },
        lineMarker: { image: 'oneway', color: 0xffffff },
        sidedMarker: { color: 0xffffff },
        marker: { image: 'smallCircle', color: 0xffffff, opacity: 1 },
        label: { color: 0xeeeeee }
      }
    }
  }, {
    scope: 'osm',
    styles: {
      'LIFECYCLE': {
        stroke: { dash: [7, 3], cap: 'butt' }
      },
      'motorway': {
        casing: { width: 10, color: 0x70372f },
        stroke: { width: 8, color: 0xcf2081 }
      },
      'building_red': {
        fill: { color: 0xE06050, opacity: 0.3 }
      },
      'building_rapid': {
        fill: { color: 0xDA26D3, opacity: 0.3 }
      },
      'green': {
        fill: { color: 0x8cd05f, opacity: 0.3 }
      },
      'pattern-forest': {
        fill: { pattern: 'forest' }
      },
      'blue': {
        fill: { color: 0x77DDDD, opacity: 0.3 }
      },
      'track_style': {
        casing: { width: 4, color: 0xaa9944 },
        stroke: { width: 2, color: 0xaa9944 }
      },
      'residential': {
        casing: { width: 8, color: 0x888888 },
        stroke: { width: 6, color: 0xffffff }
      },
      'footway': {
        casing: { width: 5, color: 0xffffff },
        stroke: { width: 3, color: 0x998888, dash: [6, 6], cap: 'butt' }
      },
      'poi_pin': {
        marker: { image: 'pin', color: 0xff0000 },
        icon: { image: 'maki-cafe', color: 0x333333, size: 15 },
        label: { color: 0xdddddd }
      },
      'cliff_style': {
        sidedMarker: { image: 'cliff', color: 0x888888 }
      },
      'invalid_pattern': {
        fill: { color: 0xff0000, pattern: 'nonexistent_pattern_xyz' }
      }
    },

    selectors: {
      'highway-motorway': {
        styleIDs: ['motorway'],
        match: { tags: [{ key: 'highway', value: 'motorway' }] }
      },
      'highway-residential': {
        styleIDs: ['residential'],
        match: { tags: [{ key: 'highway', value: 'residential' }] }
      },
      'highway-track': {
        styleIDs: ['track_style'],
        match: { tags: [{ key: 'highway', value: 'track' }] }
      },
      'highway-footway': {
        styleIDs: ['footway'],
        match: { tags: [{ key: 'highway', value: 'footway' }] }
      },
      'building-default': {
        styleIDs: ['building_red'],
        match: { tags: [{ key: 'building' }] }
      },
      'landuse-forest': {
        styleIDs: ['green', 'pattern-forest'],
        match: { tags: [{ key: 'landuse', value: 'forest' }] }
      },
      'natural-water': {
        styleIDs: ['blue'],
        match: { tags: [{ key: 'natural', value: 'water' }] }
      },
      'amenity-cafe': {
        styleIDs: ['poi_pin'],
        match: { tags: [{ key: 'amenity', value: 'cafe' }] }
      },
      'natural-cliff': {
        styleIDs: ['cliff_style'],
        match: { tags: [{ key: 'natural', value: 'cliff' }] }
      },
      'landuse-invalid': {
        styleIDs: ['invalid_pattern'],
        match: { tags: [{ key: 'landuse', value: 'invalid_test' }] }
      }
    }
  }]
};
