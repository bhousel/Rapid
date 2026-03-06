import type { Tags } from '../data/types.ts';


/**
 * A lookup table mapping tag values to boolean flags.
 * Used for checking if a specific value is valid for a tag key.
 * The special key '*' matches any value.
 */
export type TagValueLookup = Record<string, boolean>;

/**
 * A two-level lookup table: key → value → boolean.
 * Used for osmAreaKeys, osmPointTags, osmVertexTags, etc.
 */
export type TagKeyValueLookup = Record<string, TagValueLookup>;

// ============================================================================
// Tag Utility Functions
// ============================================================================

/** Lifecycle prefixes that can be applied to tag keys (e.g., 'disused:', 'abandoned:') */
export const osmLifecyclePrefixes: Record<string, boolean> = {
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

/**
 * Removes a lifecycle prefix from a tag key if present.
 * Lifecycle prefixes include: abandoned, construction, demolished, disused, planned, proposed, etc.
 *
 * @example
 * osmRemoveLifecyclePrefix('disused:railway') // returns 'railway'
 * osmRemoveLifecyclePrefix('highway') // returns 'highway'
 *
 * @param key - The tag key, possibly with a lifecycle prefix
 * @returns The key with lifecycle prefix removed, or the original key
 */
export function osmRemoveLifecyclePrefix(key: string): string {
  const keySegments = key.split(':');
  if (keySegments.length === 1) return key;

  if (keySegments[0] in osmLifecyclePrefixes) {
    return key.slice(keySegments[0].length + 1);
  }

  return key;
}

/**
 * Exceptions to osmAreaKeys - tags that should be treated as areas even if their
 * primary key is typically linear (value `true`), OR tags that should NOT be treated
 * as areas even though their primary key is typically an area key (value `false`).
 *
 * For example, `highway=elevator` is an area exception (`true`), while
 * `emergency=yes` on a road is NOT an area (`false`) even though `emergency`
 * is an area key in the schema.
 */
export const osmAreaKeysExceptions: Record<string, Record<string, boolean>> = {
  amenity: {
    bicycle_parking: true
  },
  emergency: {
    yes: false,
    no: false,
    private: false,
    designated: false,
    destination: false,
    official: false
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

/**
 * Returns a tag from the given tags that implies an area geometry, if any.
 * Checks against the provided `areaKeys` and the hardcoded `osmAreaKeysExceptions`.
 *
 * @param tags - The tags to check
 * @param areaKeys - Tag key→value lookup for area-implying tags (from SchemaScope)
 * @returns An object with the tag suggesting area, or null if none found
 */
export function osmTagSuggestingArea(tags: Tags, areaKeys: TagKeyValueLookup): Tags | null {
  if (tags.area === 'yes') return { area: 'yes' };
  if (tags.area === 'no') return null;

  const returnTags: Tags = {};
  for (const realKey in tags) {
    const key = osmRemoveLifecyclePrefix(realKey);
    // Skip tags whose exception value is explicitly `false` (e.g. `emergency=yes` on a road)
    if (key in osmAreaKeysExceptions && osmAreaKeysExceptions[key][tags[realKey]] === false) {
      continue;
    }
    if (key in areaKeys && !(tags[realKey] in areaKeys[key])) {
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


