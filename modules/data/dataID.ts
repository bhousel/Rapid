/**
 * Helpers for data IDs, a datum's ID across all of Rapid: `${namespace}:${localID}`.
 * The namespace is the ID of the `SpatialSystem` cache that holds the data, and never contains a colon.
 * A data ID with no colon is in the `osm` namespace, so an OSM entity's data ID is its entity ID.
 * See `design/data-ids.md`.
 * @module
 */


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
