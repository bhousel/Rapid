import type { OsmTags, OsmWay } from '../data/types.ts';

/**
 * Valid turn lane values per OSM tagging.
 */
type TurnLaneValue =
  | 'left' | 'slight_left' | 'sharp_left'
  | 'through'
  | 'right' | 'slight_right' | 'sharp_right'
  | 'reverse'
  | 'merge_to_left' | 'merge_to_right'
  | 'none' | 'unknown';

/**
 * Valid misc lane values (psv, bus, taxi, hov, hgv).
 */
type MiscLaneValue = 'yes' | 'no' | 'designated' | 'unknown';

/**
 * Valid bicycleway lane values.
 */
type BicyclewayLaneValue = 'yes' | 'no' | 'designated' | 'lane' | 'unknown';

/**
 * Directional lane data structure with forward/backward/unspecified.
 */
interface DirectionalLaneData<T> {
  forward?: T[];
  backward?: T[];
  unspecified?: T[];
}

/**
 * Individual lane properties.
 */
interface LaneProperties {
  turnLane?: TurnLaneValue[];
  maxspeed?: number | string | null;
  psv?: MiscLaneValue;
  bus?: MiscLaneValue;
  taxi?: MiscLaneValue;
  hov?: MiscLaneValue;
  hgv?: MiscLaneValue;
  bicycleway?: BicyclewayLaneValue;
}

/**
 * Lane direction counts.
 */
interface LaneDirections {
  forward: number;
  backward: number;
  bothways: number;
}

/**
 * Complete lanes metadata and parsed lane objects.
 */
export interface LanesInfo {
  metadata: {
    count: number;
    oneway: boolean;
    forward: number;
    backward: number;
    bothways: number;
    turnLanes: DirectionalLaneData<TurnLaneValue[]>;
    maxspeed: number | undefined;
    maxspeedLanes: DirectionalLaneData<number | string | null>;
    psvLanes: DirectionalLaneData<MiscLaneValue>;
    busLanes: DirectionalLaneData<MiscLaneValue>;
    taxiLanes: DirectionalLaneData<MiscLaneValue>;
    hovLanes: DirectionalLaneData<MiscLaneValue>;
    hgvLanes: DirectionalLaneData<MiscLaneValue>;
    bicyclewayLanes: DirectionalLaneData<BicyclewayLaneValue>;
  };
  lanes: {
    forward: LaneProperties[];
    backward: LaneProperties[];
    unspecified: LaneProperties[];
  };
}


/**
 * Parse lane information from an OSM way entity.
 * @param entity - The way entity to parse lanes from
 * @returns Parsed lane information, or null if not applicable
 */
export function osmLanes(entity: OsmWay): LanesInfo | null {
  if (entity.type !== 'way') return null;
  if (!entity.tags.highway) return null;

  const tags = entity.tags;
  const isOneWay = entity.isOneWay();
  const laneCount = getLaneCount(tags, isOneWay);
  const maxspeed = parseMaxspeed(tags);

  const laneDirections = parseLaneDirections(tags, isOneWay, laneCount);
  const forward = laneDirections.forward;
  const backward = laneDirections.backward;
  const bothways = laneDirections.bothways;

  // parse the piped string 'x|y|z' format
  const turnLanes: DirectionalLaneData<TurnLaneValue[]> = {
    unspecified: parseTurnLanes(tags['turn:lanes']),
    forward: parseTurnLanes(tags['turn:lanes:forward']),
    backward: parseTurnLanes(tags['turn:lanes:backward'])
  };

  const maxspeedLanes: DirectionalLaneData<number | string | null> = {
    unspecified: parseMaxspeedLanes(tags['maxspeed:lanes'], maxspeed),
    forward: parseMaxspeedLanes(tags['maxspeed:lanes:forward'], maxspeed),
    backward: parseMaxspeedLanes(tags['maxspeed:lanes:backward'], maxspeed)
  };

  const psvLanes: DirectionalLaneData<MiscLaneValue> = {
    unspecified: parseMiscLanes(tags['psv:lanes']),
    forward: parseMiscLanes(tags['psv:lanes:forward']),
    backward: parseMiscLanes(tags['psv:lanes:backward'])
  };

  const busLanes: DirectionalLaneData<MiscLaneValue> = {
    unspecified: parseMiscLanes(tags['bus:lanes']),
    forward: parseMiscLanes(tags['bus:lanes:forward']),
    backward: parseMiscLanes(tags['bus:lanes:backward'])
  };

  const taxiLanes: DirectionalLaneData<MiscLaneValue> = {
    unspecified: parseMiscLanes(tags['taxi:lanes']),
    forward: parseMiscLanes(tags['taxi:lanes:forward']),
    backward: parseMiscLanes(tags['taxi:lanes:backward'])
  };

  const hovLanes: DirectionalLaneData<MiscLaneValue> = {
    unspecified: parseMiscLanes(tags['hov:lanes']),
    forward: parseMiscLanes(tags['hov:lanes:forward']),
    backward: parseMiscLanes(tags['hov:lanes:backward'])
  };

  const hgvLanes: DirectionalLaneData<MiscLaneValue> = {
    unspecified: parseMiscLanes(tags['hgv:lanes']),
    forward: parseMiscLanes(tags['hgv:lanes:forward']),
    backward: parseMiscLanes(tags['hgv:lanes:backward'])
  };

  const bicyclewayLanes: DirectionalLaneData<BicyclewayLaneValue> = {
    unspecified: parseBicycleWay(tags['bicycleway:lanes']),
    forward: parseBicycleWay(tags['bicycleway:lanes:forward']),
    backward: parseBicycleWay(tags['bicycleway:lanes:backward'])
  };

  const lanesObj: { forward: LaneProperties[]; backward: LaneProperties[]; unspecified: LaneProperties[] } = {
    forward: [],
    backward: [],
    unspecified: []
  };

  // map forward/backward/unspecified of each lane type to lanesObj
  mapToLanesObj(lanesObj, turnLanes, 'turnLane');
  mapToLanesObj(lanesObj, maxspeedLanes, 'maxspeed');
  mapToLanesObj(lanesObj, psvLanes, 'psv');
  mapToLanesObj(lanesObj, busLanes, 'bus');
  mapToLanesObj(lanesObj, taxiLanes, 'taxi');
  mapToLanesObj(lanesObj, hovLanes, 'hov');
  mapToLanesObj(lanesObj, hgvLanes, 'hgv');
  mapToLanesObj(lanesObj, bicyclewayLanes, 'bicycleway');

  return {
    metadata: {
      count: laneCount,
      oneway: isOneWay,
      forward: forward,
      backward: backward,
      bothways: bothways,
      turnLanes: turnLanes,
      maxspeed: maxspeed,
      maxspeedLanes: maxspeedLanes,
      psvLanes: psvLanes,
      busLanes: busLanes,
      taxiLanes: taxiLanes,
      hovLanes: hovLanes,
      hgvLanes: hgvLanes,
      bicyclewayLanes: bicyclewayLanes
    },
    lanes: lanesObj
  };
}


function getLaneCount(tags: OsmTags, isOneWay: boolean): number {
  let count: number;
  if (tags.lanes) {
    count = parseInt(tags.lanes, 10);
    if (count > 0) {
      return count;
    }
  }

  switch (tags.highway) {
    case 'trunk':
    case 'motorway':
      count = isOneWay ? 2 : 4;
      break;
    default:
      count = isOneWay ? 1 : 2;
      break;
  }

  return count;
}


function parseMaxspeed(tags: OsmTags): number | undefined {
  const maxspeed = tags.maxspeed;
  if (!maxspeed) return;

  const maxspeedRegex = /^([0-9][\.0-9]+?)(?:[ ]?(?:km\/h|kmh|kph|mph|knots))?$/;
  if (!maxspeedRegex.test(maxspeed)) return;

  return parseInt(maxspeed, 10);
}


function parseLaneDirections(tags: OsmTags, isOneWay: boolean, laneCount: number): LaneDirections {
  let forward = parseInt(tags['lanes:forward'] ?? '', 10);
  let backward = parseInt(tags['lanes:backward'] ?? '', 10);
  const bothways = parseInt(tags['lanes:both_ways'] ?? '', 10) > 0 ? 1 : 0;

  if (parseInt(tags.oneway ?? '', 10) === -1) {
    forward = 0;
    backward = laneCount;
  } else if (isOneWay) {
    forward = laneCount;
    backward = 0;
  } else if (isNaN(forward) && isNaN(backward)) {
    backward = Math.floor((laneCount - bothways) / 2);
    forward = laneCount - bothways - backward;
  } else if (isNaN(forward)) {
    if (backward > laneCount - bothways) {
      backward = laneCount - bothways;
    }
    forward = laneCount - bothways - backward;
  } else if (isNaN(backward)) {
    if (forward > laneCount - bothways) {
      forward = laneCount - bothways;
    }
    backward = laneCount - bothways - forward;
  }
  return {
    forward: forward,
    backward: backward,
    bothways: bothways
  };
}


function parseTurnLanes(tag: string | undefined): TurnLaneValue[][] | undefined {
  if (!tag) return;

  const validValues: TurnLaneValue[] = [
    'left', 'slight_left', 'sharp_left', 'through', 'right', 'slight_right',
    'sharp_right', 'reverse', 'merge_to_left', 'merge_to_right', 'none'
  ];

  return tag.split('|')
    .map(function (s) {
      if (s === '') s = 'none';
      return s.split(';')
        .map(function (d): TurnLaneValue {
          return !validValues.includes(d as TurnLaneValue) ? 'unknown' : d as TurnLaneValue;
        });
    });
}


function parseMaxspeedLanes(tag: string | undefined, maxspeed: number | undefined): (number | string | null)[] | undefined {
  if (!tag) return;

  return tag.split('|')
    .map(function (s): number | string | null {
      if (s === 'none') return s;
      const m = parseInt(s, 10);
      if (s === '' || m === maxspeed) return null;
      return isNaN(m) ? 'unknown' : m;
    });
}


function parseMiscLanes(tag: string | undefined): MiscLaneValue[] | undefined {
  if (!tag) return;

  const validValues: MiscLaneValue[] = [
    'yes', 'no', 'designated'
  ];

  return tag.split('|')
    .map(function (s): MiscLaneValue {
      if (s === '') s = 'no';
      return !validValues.includes(s as MiscLaneValue) ? 'unknown' : s as MiscLaneValue;
    });
}


function parseBicycleWay(tag: string | undefined): BicyclewayLaneValue[] | undefined {
  if (!tag) return;

  const validValues: BicyclewayLaneValue[] = [
    'yes', 'no', 'designated', 'lane'
  ];

  return tag.split('|')
    .map(function (s): BicyclewayLaneValue {
      if (s === '') s = 'no';
      return !validValues.includes(s as BicyclewayLaneValue) ? 'unknown' : s as BicyclewayLaneValue;
    });
}


function mapToLanesObj(
  lanesObj: { forward: LaneProperties[]; backward: LaneProperties[]; unspecified: LaneProperties[] },
  data: DirectionalLaneData<unknown>,
  key: keyof LaneProperties
): void {
  if (data.forward) {
    data.forward.forEach(function(l, i) {
      if (!lanesObj.forward[i]) lanesObj.forward[i] = {};
      (lanesObj.forward[i] as Record<string, unknown>)[key] = l;
    });
  }
  if (data.backward) {
    data.backward.forEach(function(l, i) {
      if (!lanesObj.backward[i]) lanesObj.backward[i] = {};
      (lanesObj.backward[i] as Record<string, unknown>)[key] = l;
    });
  }
  if (data.unspecified) {
    data.unspecified.forEach(function(l, i) {
      if (!lanesObj.unspecified[i]) lanesObj.unspecified[i] = {};
      (lanesObj.unspecified[i] as Record<string, unknown>)[key] = l;
    });
  }
}
