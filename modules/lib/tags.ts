import type { Tags } from '../data/types.ts';


// ============================================================================
// Tag Lookup Types
// ============================================================================

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

/**
 * A deprecated tag entry describing an old tag pattern and its replacement.
 */
export interface DeprecatedTagEntry {
  /** The old tag pattern to match. Value of '*' matches any value. */
  old: Tags;
  /** Optional replacement tags */
  replace?: Tags;
}


// ============================================================================
// Mutable Tag Data (set at runtime by SchemaSystem)
// ============================================================================

/** Tags that imply that a closed way should be treated as an area */
export let osmAreaKeys: TagKeyValueLookup = {};

/**
 * Sets the area keys lookup table.
 * Called by SchemaSystem at startup.
 * @param value - The area keys lookup table
 */
export function osmSetAreaKeys(value: TagKeyValueLookup): void {
  osmAreaKeys = value;
}

/** Tags that indicate a feature is typically linear (used to avoid false "connect the ends" suggestions) */
export let osmLineTags: TagKeyValueLookup = {};

/**
 * Sets the line tags lookup table.
 * Called by SchemaSystem at startup.
 * @param value - The line tags lookup table
 */
export function osmSetLineTags(value: TagKeyValueLookup): void {
  osmLineTags = value;
}

/** Tags that indicate a node can be a standalone point, e.g. `{ amenity: { bar: true, parking: true, ... } ... }` */
export let osmPointTags: TagKeyValueLookup = {};

/**
 * Sets the point tags lookup table.
 * Called by SchemaSystem at startup.
 * @param value - The point tags lookup table
 */
export function osmSetPointTags(value: TagKeyValueLookup): void {
  osmPointTags = value;
}

/** Tags that indicate a node can be part of a way, e.g. `{ amenity: { parking: true, ... }, highway: { stop: true ... } ... }` */
export let osmVertexTags: TagKeyValueLookup = {};

/**
 * Sets the vertex tags lookup table.
 * Called by SchemaSystem at startup.
 * @param value - The vertex tags lookup table
 */
export function osmSetVertexTags(value: TagKeyValueLookup): void {
  osmVertexTags = value;
}

/** Tags that are deprecated, some offer replacement/upgrade */
export let osmDeprecatedTags: DeprecatedTagEntry[] = [];

/**
 * Sets the deprecated tags list.
 * Called by SchemaSystem at startup.
 * @param value - The deprecated tags list
 */
export function osmSetDeprecatedTags(value: DeprecatedTagEntry[]): void {
  osmDeprecatedTags = value;
}


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
 * Checks against `osmAreaKeys` and `osmAreaKeysExceptions`.
 *
 * @param tags - The tags to check
 * @returns An object with the tag suggesting area, or null if none found
 */
export function osmTagSuggestingArea(tags: Tags): Tags | null {
  if (tags.area === 'yes') return { area: 'yes' };
  if (tags.area === 'no') return null;

  const returnTags: Tags = {};
  for (const realKey in tags) {
    const key = osmRemoveLifecyclePrefix(realKey);
    // Skip tags whose exception value is explicitly `false` (e.g. `emergency=yes` on a road)
    if (key in osmAreaKeysExceptions && osmAreaKeysExceptions[key][tags[realKey]] === false) {
      continue;
    }
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

/**
 * Node geometry capabilities.
 */
export interface NodeGeometries {
  point?: boolean;
  vertex?: boolean;
}

/**
 * Returns the node geometries supported by the given tags.
 * A node can be a standalone `point` or a `vertex` (part of a way).
 *
 * @param tags - The tags to check
 * @returns Object with `point` and/or `vertex` set to true if supported
 */
export function osmNodeGeometriesForTags(tags: Tags): NodeGeometries {
  const geometries: NodeGeometries = {};
  for (const key in tags) {
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

/**
 * Returns any tag deprecations for the given tags.
 * This is implemented like osmAreaKeys and other functions that must first load
 * the tagging data at startup. Consider: move some of this over to the SchemaSystem.
 *
 * @param tags - The tags to check for deprecations
 * @returns Array of deprecated tag entries that match the given tags
 */
export function getDeprecatedTags(tags: Tags): DeprecatedTagEntry[] {
  const results: DeprecatedTagEntry[] = [];

  // if there are no tags, none can be deprecated
  if (Object.keys(tags).length === 0) return results;

  for (const d of osmDeprecatedTags) {
    const oldKeys = Object.keys(d.old);
    if (d.replace) {
      const replace = d.replace;  // capture for callback
      const hasExistingValues = Object.keys(replace).some(replaceKey => {
        if (!tags[replaceKey] || d.old[replaceKey]) return false;
        const replaceValue = replace[replaceKey];
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
        return vals.includes(d.old[oldKey]);
      } else {
        if (tags[oldKey] === d.old[oldKey]) {
          if (d.replace && d.old[oldKey] === d.replace[oldKey]) {
            const replaceKeys = Object.keys(d.replace);
            return !replaceKeys.every(replaceKey => tags[replaceKey] === d.replace![replaceKey]);
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


/**
 * Returns a cached lookup of deprecated tag values grouped by key.
 * Only includes single-key deprecations with non-wildcard values.
 * (consider - move to SchemaSystem)
 *
 * @returns Record mapping tag keys to arrays of deprecated values
 */
let _deprecatedTagValuesByKey: Record<string, string[]> | undefined;
export function deprecatedTagValuesByKey(): Record<string, string[]> {
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

