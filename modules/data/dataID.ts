/**
 * Helpers for data IDs, a datum's ID across all of Rapid: `${namespace}:${localID}`.
 * The namespace is the ID of the `SpatialSystem` cache that holds the data, and never contains a colon.
 * A data ID with no colon is in the `osm` namespace, so an OSM entity's data ID is its entity ID.
 * See `design/data-ids.md`.
 * @module
 */
import { utilHash53, utilStableStringify } from '../util/string.ts';


/**
 * Builds a data ID from a namespace and a local ID.
 * OSM data IDs are bare: `osm` (or no namespace) returns the local ID as it is.
 * @param namespace - The namespace (a `SpatialSystem` cache ID), or `osm`
 * @param localID - The datum's ID within its namespace
 * @return The data ID
 */
export function makeDataID(namespace: Nullable<SpatialID>, localID: string): DataID {
  return (!namespace || namespace === 'osm') ? localID : `${namespace}:${localID}`;
}


/**
 * Splits a data ID into its namespace and local ID, on the first colon only.
 * A data ID with no colon is in the `osm` namespace, and `osm:w123` is read as `w123`.
 * @param dataID - The data ID to split
 * @return The namespace and the local ID
 */
export function splitDataID(dataID: DataID): [SpatialID, string] {
  const i = dataID.indexOf(':');
  if (i === -1) return ['osm', dataID];
  return [dataID.slice(0, i), dataID.slice(i + 1)];
}


/**
 * Returns the OSM entity ID for a data ID, for code that only works with OSM entities.
 * @param dataID - The data ID
 * @return The entity ID, or `undefined` if the data ID is in another namespace
 */
export function osmEntityID(dataID: DataID): EntityID | undefined {
  const [namespace, localID] = splitDataID(dataID);
  return namespace === 'osm' ? localID : undefined;
}


/**
 * Returns a stable local ID for a GeoJSON feature in a namespace (see `design/data-ids.md`).
 * A Multi* feature that's split into parts adds a part number to it (`${key}:${part}`). Keys stay the
 * same when the same data is loaded again, in any order, so what the user accepted or ignored still
 * matches after a restart, and a data ID in a link still finds its data.
 * - If the data names an ID field (e.g. a dataset's `isID` mapping), the key is that field's value,
 *   with `:` and `,` replaced by `_` (a `:` would look like a part number, and `,` separates data
 *   IDs in the URL).
 * - Otherwise, the key is a hash of the feature's geometry and properties.
 * - If two features would get the same key (a repeated ID value, or identical features),
 *   the later ones get the hash (and then a counter) added, so keys are never shared.
 * @param feature - The GeoJSON feature
 * @param idField - The property that identifies features, if the data names one
 * @param usedKeys - The keys given so far in this namespace (added to)
 * @return The key
 */
export function featureKey(feature: GeoJSON.Feature, idField: string | undefined, usedKeys: Set<string>): string {
  const properties = feature.properties ?? {};
  const hash = utilHash53(utilStableStringify({ geometry: feature.geometry, properties: properties }));

  const idVal = idField ? properties[idField] : undefined;
  const hasID = (idVal !== undefined && idVal !== null && idVal !== '');
  let key = hasID ? String(idVal).replace(/[:,]/g, '_') : hash;

  if (usedKeys.has(key) && hasID) {
    key = `${key}.${hash}`;
  }
  const base = key;
  for (let n = 1; usedKeys.has(key); n++) {
    key = `${base}.${n}`;
  }

  usedKeys.add(key);
  return key;
}
