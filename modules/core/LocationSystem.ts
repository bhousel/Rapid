import LocationConflation from '@rapideditor/location-conflation';
import whichPolygon from 'which-polygon';

import { AbstractSystem } from './AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';

import type { Extent } from '@rapid-sdk/math';
import type { HasLocationSet, HasLocationSetID } from '@rapideditor/location-conflation';
import type { Context } from '../Context.ts';
import type { Vec2, Vec4 } from '../data/types.ts';

/**
 * A blocked region definition.
 */
interface BlockedRegion extends HasLocationSet {
  type: 'block';
  text: string;
  url: string;
}


/**
 * `LocationSystem` maintains an internal index of all the boundaries/geofences.
 * It's used by presets, community index, background imagery, to know where in the world these things are valid.
 * These geofences should be defined by `locationSet` objects:
 * ```ts
 * let locationSet = {
 *   include: [ Array of locations ],
 *   exclude: [ Array of locations ]
 * };
 * ```
 *
 * Most of the heavy lifting (resolving locations, validating locationSets, spatial indexing)
 * is delegated to the `LocationConflation` instance (`this._resolver`). This system is a thin
 * wrapper that tracks Rapid-specific state such as the blocked regions overlay.
 *
 * For more info see the location-conflation and country-coder projects, see:
 * https://github.com/ideditor/location-conflation
 * https://github.com/ideditor/country-coder
 *
 * Events available:
 *   `locationchange`  Fires on any change in the location index
 */
export class LocationSystem extends AbstractSystem {
  /** A location-conflation resolver (owns the locationSet registry + spatial index) */
  private _resolver: LocationConflation;

  /** A which-polygon index for blocked regions only */
  private _wpblocks: ReturnType<typeof whichPolygon>;
  /** Map of locationSetID to resolved GeoJSONData for blocked regions */
  private _blockFeatures: Map<LocationSetID, GeoJSONData>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'locations';

    this._resolver = new LocationConflation();
    this._blockFeatures = new Map();

    // BLOCKED REGIONS
    // These are static and don't depend on any custom GeoJSON, so we can resolve them synchronously here.
    const blocks: BlockedRegion[] = [{
      type: 'block',
      locationSet: { include: ['Q7835', 'ua'] },
      text: 'Editing has been blocked in this region per request of the OSM Ukrainian community.',
      url: 'https://wiki.openstreetmap.org/wiki/Russian%E2%80%93Ukrainian_war'
    }];

    const blockedFeatures: GeoJSON.Feature[] = [];
    for (const block of blocks) {
      const data = this._resolveBlock(block);
      if (!data) continue;
      this._blockFeatures.set(block.locationSetID!, data);
      blockedFeatures.push(data.asGeoJSON() as GeoJSON.Feature);
    }
    this._wpblocks = whichPolygon({ type: 'FeatureCollection', features: blockedFeatures });
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Resolves a blocked region's locationSet into a GeoJSONData feature, assigning
   * `locationSetID` on the block in place. Returns `undefined` if resolution fails.
   */
  private _resolveBlock(block: BlockedRegion): GeoJSONData | undefined {
    try {
      const result = this._resolver.resolveLocationSet(block.locationSet);
      if (!result.feature.geometry.coordinates.length || !result.feature.properties?.area) {
        throw new Error(`locationSet ${result.id} resolves to an empty feature.`);
      }
      block.locationSetID = result.id;

      // Use the locationSet id (e.g. `+[Q7835]`) and copy block metadata into properties.
      const feature = structuredClone(result.feature);
      feature.id = result.id;
      feature.properties.id = result.id;
      Object.assign(feature.properties, block);

      return new GeoJSONData(this.context, { geojson: feature });
    } catch (err) {
      console.error(err);   // eslint-disable-line no-console
      return undefined;
    }
  }


  /**
   * The underlying `LocationConflation` instance.
   * Exposed so other systems (e.g. NSI's `Matcher.buildLocationIndex`) can share
   * the same resolver/registry/spatial index.
   */
  resolver(): LocationConflation {
    return this._resolver;
  }


  /**
   * Accepts a FeatureCollection-like object containing custom locations.
   * Each feature must have a filename-like `id`, for example: `something.geojson`.
   * Delegates to `LocationConflation.addFeatures`.
   *
   * @param fc - FeatureCollection-like Object containing custom locations
   */
  mergeCustomGeoJSON(fc: GeoJSON.FeatureCollection): void {
    this._resolver.addFeatures(fc);
  }


  /**
   * Accepts an Array of Objects containing `locationSet` properties:
   * ```ts
   * [
   *  { id: 'preset1', locationSet: {…} },
   *  { id: 'preset2', locationSet: {…} },
   *  …
   * ]
   * ```
   * After validating, the Objects will be decorated with a `locationSetID` property:
   * ```ts
   * [
   *  { id: 'preset1', locationSet: {…}, locationSetID: '+[Q2]' },
   *  { id: 'preset2', locationSet: {…}, locationSetID: '+[Q30]' },
   *  …
   * ]
   * ```
   *
   * @param objects - Objects to check - they should have `locationSet` property
   * @return Promise resolved with the objects (this function used to be slow/async, now it's faster and sync)
   */
  mergeLocationSets(objects: HasLocationSet[]): Promise<HasLocationSetID[]> {
    if (!Array.isArray(objects)) return Promise.reject('nothing to do');

    const registered = this._resolver.registerLocationSets(objects);
    this.emit('locationchange');
    return Promise.resolve(registered);
  }


  /**
   * Find all the locationSets valid at the given location.
   * Results include the area (in km²) to facilitate sorting.
   *
   * Map of valid locationSetIDs to areas (in km²)
   * ```ts
   * {
   *   "+[Q2]": 511207893.3958111,
   *   "+[Q30]": 21817019.17,
   *   "+[new_jersey.geojson]": 22390.77,
   *   …
   * }
   * ```
   *
   * @param loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return Result locationSetIDs valid at given location
   */
  locationSetsAt(loc: Vec2): Map<LocationSetID, number> {
    return this._resolver.locationSetsAt(loc);
  }


  /**
   * Is editing blocked at the given location?
   * @param loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return `true` if a block exists there, `false` if not
   */
  isBlockedAt(loc: Vec2): boolean {
    return !!this._wpblocks(loc);
  }


  /**
   * Returns any blocked regions that exist within the given extent.
   * @param extent - the extent to query
   * @return Array of GeoJSONData data objects
   */
  getBlocks(extent: Extent): GeoJSONData[] {
    const hits = this._wpblocks.bbox(extent.rectangle() as Vec4);
    const results = new Set<GeoJSONData>();

    for (const hit of hits) {
      const data = this._blockFeatures.get(hit.id);
      if (data) {
        results.add(data);
      }
    }

    return [...results];
  }

}
