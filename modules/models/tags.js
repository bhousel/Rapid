// Tags that imply that a closed way should be treated as an area
export let osmAreaKeys = {};
export function osmSetAreaKeys(value) {
  osmAreaKeys = value;
}

// Tags that indicate a node can be a standalone point
// e.g. { amenity: { bar: true, parking: true, ... } ... }
export let osmPointTags = {};
export function osmSetPointTags(value) {
  osmPointTags = value;
}

// Tags that indicate a node can be part of a way
// e.g. { amenity: { parking: true, ... }, highway: { stop: true ... } ... }
export let osmVertexTags = {};
export function osmSetVertexTags(value) {
  osmVertexTags = value;
}

// Tags that are deprecated, some offer replacement/upgrade
export let osmDeprecatedTags = [];
export function osmSetDeprecatedTags(value) {
  osmDeprecatedTags = value;
}

export function osmIsInterestingTag(key) {
  return key !== 'attribution' &&
    key !== 'created_by' &&
    key !== 'source' &&
    key !== 'odbl' &&
    key.indexOf('source:') !== 0 &&
    key.indexOf('source_ref') !== 0 && // purposely exclude colon
    key.indexOf('tiger:') !== 0;
}

export const osmLifecyclePrefixes = {
  abandoned: true,
  construction: true,
  demolished: true,
  destroyed: true,
  dismantled: true,
  disused: true,
  intermittent: true,
  obliterated: true,
  planned: true,
  proposed: true,
  razed: true,
  removed: true,
  was: true
};

/** @param {string} key */
export function osmRemoveLifecyclePrefix(key) {
  const keySegments = key.split(':');
  if (keySegments.length === 1) return key;

  if (keySegments[0] in osmLifecyclePrefixes) {
    return key.slice(keySegments[0].length + 1);
  }

  return key;
}


export const osmAreaKeysExceptions = {
  amenity: {
    bicycle_parking: true
  },
  highway: {
    elevator: true,
    rest_area: true,
    services: true
  },
  public_transport: {
    platform: true
  },
  railway: {
    platform: true,
    roundhouse: true,
    station: true,
    traverser: true,
    turntable: true,
    ventilation_shaft: true,
    wash: true
  },
  traffic_calming: {
    island: true
  },
  waterway: {
    dam: true
  }
};

// returns an object with the tag from `tags` that implies an area geometry, if any
export function osmTagSuggestingArea(tags) {
  if (tags.area === 'yes') return { area: 'yes' };
  if (tags.area === 'no') return null;

  var returnTags = {};
  for (var realKey in tags) {
    const key = osmRemoveLifecyclePrefix(realKey);
    if (key in osmAreaKeys && !(tags[realKey] in osmAreaKeys[key])) {
      returnTags[realKey] = tags[realKey];
      return returnTags;
    }
    if (key in osmAreaKeysExceptions && tags[realKey] in osmAreaKeysExceptions[key]) {
      returnTags[realKey] = tags[realKey];
      return returnTags;
    }
  }
  return null;
}

// returns the node geometries that are supported by the given tags
// for example, { point: true, vertex: true }
export function osmNodeGeometriesForTags(tags) {
  const geometries = {};
  for (var key in tags) {
    if (osmPointTags[key] &&
      (osmPointTags[key]['*'] || osmPointTags[key][tags[key]])) {
      geometries.point = true;
    }
    if (osmVertexTags[key] &&
      (osmVertexTags[key]['*'] || osmVertexTags[key][tags[key]])) {
      geometries.vertex = true;
    }
    // break early if both are already supported
    if (geometries.point && geometries.vertex) break;
  }
  return geometries;
}

// returns the any tag deprecations for the given tags.
// This is implemented like osmAreaKeys and other functions that must first load
// the tagging data at startup.  Consider: move some of this over to the PresetSystem.
// Moved from OsmEntity
export function getDeprecatedTags(tags) {
  const results = [];

  // if there are no tags, none can be deprecated
  if (Object.keys(tags).length === 0) return results;

  for (const d of osmDeprecatedTags) {
    const oldKeys = Object.keys(d.old);
    if (d.replace) {
      const hasExistingValues = Object.keys(d.replace).some(replaceKey => {
        if (!tags[replaceKey] || d.old[replaceKey]) return false;
        const replaceValue = d.replace[replaceKey];
        if (replaceValue === '*') return false;
        if (replaceValue === tags[replaceKey]) return false;
        return true;
      });
      // don't flag deprecated tags if the upgrade path would overwrite existing data - iD#7843
      if (hasExistingValues) continue;
    }
    const matchesDeprecatedTags = oldKeys.every(oldKey => {
      if (!tags[oldKey]) return false;
      if (d.old[oldKey] === '*') return true;
      if (d.old[oldKey] === tags[oldKey]) return true;

      const vals = tags[oldKey].split(';').filter(Boolean);
      if (vals.length === 0) {
        return false;
      } else if (vals.length > 1) {
        return vals.indexOf(d.old[oldKey]) !== -1;
      } else {
        if (tags[oldKey] === d.old[oldKey]) {
          if (d.replace && d.old[oldKey] === d.replace[oldKey]) {
            const replaceKeys = Object.keys(d.replace);
            return !replaceKeys.every(replaceKey => tags[replaceKey] === d.replace[replaceKey]);
          } else {
            return true;
          }
        }
      }
      return false;
    });

    if (matchesDeprecatedTags) {
      results.push(d);
    }
  }

  return results;
}


// I guess we build a cache for this? - also move to PresetSystem or something
let _deprecatedTagValuesByKey;
export function deprecatedTagValuesByKey() {
  if (!_deprecatedTagValuesByKey) {
    _deprecatedTagValuesByKey = {};

    for (const d of osmDeprecatedTags) {
      const oldKeys = Object.keys(d.old);
      if (oldKeys.length === 1) {
        const oldKey = oldKeys[0];
        const oldValue = d.old[oldKey];
        if (oldValue !== '*') {
          if (!_deprecatedTagValuesByKey[oldKey]) {
            _deprecatedTagValuesByKey[oldKey] = [oldValue];
          } else {
            _deprecatedTagValuesByKey[oldKey].push(oldValue);
          }
        }
      }
    }
  }
  return _deprecatedTagValuesByKey;
}


export const osmOneWayTags = {
  'aerialway': {
    'chair_lift': true,
    'drag_lift': true,
    'j-bar': true,
    'magic_carpet': true,
    'mixed_lift': true,
    'platter': true,
    'rope_tow': true,
    't-bar': true,
    'zip_line': true
  },
  'highway': {
    'motorway': true
  },
  'junction': {
    'circular': true,
    'roundabout': true
  },
  'man_made': {
    'goods_conveyor': true,
    'piste:halfpipe': true
  },
  'piste:type': {
    'downhill': true,
    'sled': true,
    'yes': true
  },
  'roller_coaster': {
    'track': true
  },
  'seamark:type': {
    'two-way_route': true,
    'recommended_traffic_lane': true,
    'separation_lane': true,
    'separation_roundabout': true
  },
  'waterway': {
    'canal': true,
    'ditch': true,
    'drain': true,
    'fish_pass': true,
    'flowline': true,
    'pressurised': true,
    'river': true,
    'spillway': true,
    'stream': true,
    'tidal_channel': true
  }
};

// solid and smooth surfaces akin to the assumed default road surface in OSM
export const osmPavedTags = {
  'surface': {
    'paved': true,
    'asphalt': true,
    'concrete': true,
    'chipseal': true,
    'concrete:lanes': true,
    'concrete:plates': true
  },
  'tracktype': {
    'grade1': true
  }
};

// solid, if somewhat uncommon surfaces with a high range of smoothness
export const osmSemipavedTags = {
  'surface': {
    'cobblestone': true,
    'cobblestone:flattened': true,
    'unhewn_cobblestone': true,
    'sett': true,
    'paving_stones': true,
    'metal': true,
    'wood': true
  }
};

export const osmRightSideIsInsideTags = {
  'natural': {
    'cliff': true,
    'coastline': 'coastline',
  },
  'barrier': {
    'retaining_wall': true,
    'kerb': true,
    'guard_rail': true,
    'city_wall': true,
  },
  'man_made': {
    'embankment': true
  },
  'waterway': {
    'weir': true
  }
};

// "highway" tag values for pedestrian or vehicle right-of-ways that make up the routable network
// (does not include `raceway`)
export const osmRoutableHighwayTagValues = {
  motorway: true,
  trunk: true,
  primary: true,
  secondary: true,
  tertiary: true,
  residential: true,
  motorway_link: true,
  trunk_link: true,
  primary_link: true,
  secondary_link: true,
  tertiary_link: true,
  unclassified: true,
  road: true,
  service: true,
  track: true,
  living_street: true,
  bus_guideway: true,
  busway: true,
  path: true,
  footway: true,
  cycleway: true,
  bridleway: true,
  pedestrian: true,
  corridor: true,
  steps: true
};

/** aeroway tags that are treated as routable for aircraft */
export const osmRoutableAerowayTags = {
  runway: true,
  taxiway: true
};

// "highway" tag values that generally do not allow motor vehicles
export const osmPathHighwayTagValues = {
  path: true,
  footway: true,
  cycleway: true,
  bridleway: true,
  pedestrian: true,
  corridor: true,
  steps: true
};

// "railway" tag values representing existing railroad tracks (purposely does not include 'abandoned')
export const osmRailwayTrackTagValues = {
  rail: true,
  light_rail: true,
  tram: true,
  subway: true,
  monorail: true,
  funicular: true,
  miniature: true,
  narrow_gauge: true,
  disused: true,
  preserved: true
};

// "waterway" tag values for line features representing water flow
export const osmFlowingWaterwayTagValues = {
  canal: true,
  ditch: true,
  drain: true,
  fish_pass: true,
  flowline: true,
  river: true,
  stream: true,
  tidal_channel: true
};
