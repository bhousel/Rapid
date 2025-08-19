import LocationConflation from '@rapideditor/location-conflation';
import whichPolygon from 'which-polygon';
import calcArea from '@mapbox/geojson-area';

import { AbstractSystem } from './AbstractSystem.js';
import { GeoJSON } from '../models/GeoJSON.js';


/**
 * `LocationSystem` maintains an internal index of all the boundaries/geofences.
 * It's used by presets, community index, background imagery, to know where in the world these things are valid.
 * These geofences should be defined by `locationSet` objects:
 *
 * let locationSet = {
 *   include: [ Array of locations ],
 *   exclude: [ Array of locations ]
 * };
 *
 * For more info see the location-conflation and country-coder projects, see:
 * https://github.com/ideditor/location-conflation
 * https://github.com/ideditor/country-coder
 *
 * Events available:
 *   `locationchange`  Fires on any change in the location index
 */
export class LocationSystem extends AbstractSystem {

/**
 * @typedef {Object} LocationSet
 * @property {Array.<string>} include a list of location names
 */

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'locations';
    this.dependencies = new Set();

    this._loco = new LocationConflation();  // A location-conflation resolver
    this._wp = null;                        // A which-polygon index

    this._resolved = new Map();             // Map<locationSetID|locationID, GeoJSON>
    this._knownLocationSets = new Map();    // Map<locationSetID, Number area>
    this._locationIncludedIn = new Map();   // Map<locationID, Set<locationSetID>>
    this._locationExcludedIn = new Map();   // Map<locationID, Set<locationSetID>>

    // BLOCKED REGIONS
    this._blocks = [{
      type: 'block',
      locationSet: { include: ['Q7835', 'ua'] },
      text: 'Editing has been blocked in this region per request of the OSM Ukrainian community.',
      url: 'https://wiki.openstreetmap.org/wiki/Russian%E2%80%93Ukrainian_war'
    }];
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    for (const id of this.dependencies) {
      if (!this.context.systems[id]) {
        return Promise.reject(`Cannot init:  ${this.id} requires ${id}`);
      }
    }

    // Pre-resolve the worldwide locationSet
    const world = { locationSet: { include: ['Q2'] } };
    this._resolveLocationSet(world);

    // Pre-resolve any blocked region locationSets
    const blockedFeatures = this._blocks.map(block => {
      const data = this._resolveLocationSet(block);
      Object.assign(data.props, block);   // Update props in-place to include the block information.
      return data.asGeoJSON();
    });

    // Make a separate which-polygon just for these (static, very few features, very frequent lookups)
    this._wpblocks = whichPolygon({ type: 'FeatureCollection', features: blockedFeatures });

    this._rebuildIndex();

    return Promise.resolve();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    return Promise.resolve();
  }


  /**
   * _validateLocationSet
   * Pass an Object with a `locationSet` property.
   * Validates the `locationSet` and sets a `locationSetID` property on the object.
   * To avoid so much computation we only resolve the include and exclude regions, but not the locationSet itself.
   * If the given Object does not have a valid `locationSet` property, we'll assign it a worldwide `locationSet`.
   *
   * Use `_resolveLocationSet()` instead if you need to resolve geojson of locationSet, for example to render it.
   * Note: You need to call `_rebuildIndex()` after you're all finished validating the locationSets.
   *
   * @param  {Object}  obj - Object to check, it should have `locationSet` property
   */
  _validateLocationSet(obj) {
    if (obj.locationSetID) return;  // work was done already
    const context = this.context;
    const loco = this._loco;

    try {
      let locationSet = obj.locationSet;
      if (!locationSet) {
        throw new Error('object missing locationSet property');
      }
      if (!locationSet.include) {      // Missing `include`, default to worldwide include
        locationSet.include = ['Q2'];  // https://github.com/openstreetmap/iD/pull/8305#discussion_r662344647
      }

      // Validate the locationSet only
      // Resolve the include/excludes
      const locationSetID = loco.validateLocationSet(locationSet).id;
      obj.locationSetID = locationSetID;
      if (this._knownLocationSets.has(locationSetID)) return;   // seen one like this before

      let area = 0;

      // Resolve and index the 'includes'
      for (const location of (locationSet.include || [])) {
        const locationID = loco.validateLocation(location).id;
        let data = this._resolved.get(locationID);

        if (!data) {    // first time seeing a location like this
          const feature = loco.resolveLocation(location).feature;
          data = new GeoJSON(context, { geojson: feature });
          this._resolved.set(locationID, data);
        }
        area += data.properties.area;

        let s = this._locationIncludedIn.get(locationID);
        if (!s) {
          s = new Set();
          this._locationIncludedIn.set(locationID, s);
        }
        s.add(locationSetID);
      }

      // Resolve and index the 'excludes'
      for (const location of (locationSet.exclude || [])) {
        const locationID = loco.validateLocation(location).id;
        let data = this._resolved.get(locationID);

        if (!data) {    // first time seeing a location like this
          const feature = loco.resolveLocation(location).feature;
          data = new GeoJSON(context, { geojson: feature });
          this._resolved.set(locationID, data);
        }
        area -= data.properties.area;

        let s = this._locationExcludedIn.get(locationID);
        if (!s) {
          s = new Set();
          this._locationExcludedIn.set(locationID, s);
        }
        s.add(locationSetID);
      }

      this._knownLocationSets.set(locationSetID, area);

    } catch (err) {
      obj.locationSet = { include: ['Q2'] };  // default worldwide
      obj.locationSetID = '+[Q2]';
    }
  }


  /**
   * _resolveLocationSet
   * Does everything that `_validateLocationSet()` does, but then "resolves" the locationSet into GeoJSON.
   * This step is a bit more computationally expensive, so really only needed if you intend to render the shape.
   * If the given Object does not have a valid `locationSet` property, we'll assign it a worldwide `locationSet`.
   *
   * Note: You need to call `_rebuildIndex()` after you're all finished validating the locationSets.
   *
   * @param   {Object}   obj - Object to resolve, it should have `locationSet` property
   * @return  {GeoJSON}  GeoJSON data feature (fallback to the world feature)
   */
  _resolveLocationSet(obj) {
    this._validateLocationSet(obj);

    let data = this._resolved.get(obj.locationSetID);
    if (data) return data;  // work was done already

    try {
      const result = this._loco.resolveLocationSet(obj.locationSet);
      const locationSetID = result.id;
      obj.locationSetID = locationSetID;

      if (!result.feature.geometry.coordinates.length || !result.feature.properties.area) {
        throw new Error(`locationSet ${locationSetID} resolves to an empty feature.`);
      }

      // Important: here we use the locationSet `id` (`+[Q30]`), not the feature `id` (`Q30`)
      const feature = JSON.parse(JSON.stringify(result.feature));   // deep clone the GeoJSON feature
      feature.id = locationSetID;
      feature.properties.id = locationSetID;

      data = new GeoJSON(this.context, { geojson: feature });
      this._resolved.set(locationSetID, data);
      return data;

    } catch (err) {
      console.error(err);   // eslint-disable-line no-console
      obj.locationSet = { include: ['Q2'] };  // default worldwide
      obj.locationSetID = '+[Q2]';
      return this._resolved.get('+[Q2]');  // was resolved in the constructor so it should return something.
    }
  }


  /**
   * _rebuildIndex
   * Rebuilds the whichPolygon index with whatever features have been resolved into GeoJSON.
   */
  _rebuildIndex() {
    const features = [...this._resolved.values()].map(d => d.props.geojson);
    this._wp = whichPolygon({ features: features });
    this.emit('locationchange');
  }


  /**
   * mergeCustomGeoJSON
   * Accepts a FeatureCollection-like object containing custom locations
   * Each feature must have a filename-like `id`, for example: `something.geojson`
   * {
   *   "type": "FeatureCollection"
   *   "features": [
   *     {
   *       "type": "Feature",
   *       "id": "philly_metro.geojson",
   *       "properties": { … },
   *       "geometry": { … }
   *     }
   *   ]
   * }
   *
   * @param  {Object}  fc - FeatureCollection-like Object containing custom locations
   */
  mergeCustomGeoJSON(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return;

    for (const feature of fc.features) {
      feature.properties = feature.properties || {};
      let props = feature.properties;

      // Get `id` from either `id` or `properties`
      let id = feature.id || props.id;
      if (!id || !/^\S+\.geojson$/i.test(id)) continue;

      // Ensure `id` exists and is lowercase
      id = id.toLowerCase();
      feature.id = id;
      props.id = id;

      // Ensure `area` property exists
      if (!props.area) {
        const area = calcArea.geometry(feature.geometry) / 1e6;  // m² to km²
        props.area = Number(area.toFixed(2));
      }

      this._loco._cache[id] = feature;   // insert directly into LocationConflations internal cache
    }
  }


  /**
   * mergeLocationSets
   * Accepts an Array of Objects containing `locationSet` properties:
   * [
   *  { id: 'preset1', locationSet: {…} },
   *  { id: 'preset2', locationSet: {…} },
   *  …
   * ]
   * After validating, the Objects will be decorated with a `locationSetID` property:
   * [
   *  { id: 'preset1', locationSet: {…}, locationSetID: '+[Q2]' },
   *  { id: 'preset2', locationSet: {…}, locationSetID: '+[Q30]' },
   *  …
   * ]
   *
   * @param   {Array<Object>}  objects - Objects to check - they should have `locationSet` property
   * @return  {Promise}        Promise resolved true  (this function used to be slow/async, now it's faster and sync)
   */
  mergeLocationSets(objects) {
    if (!Array.isArray(objects)) return Promise.reject('nothing to do');

    for (const obj of objects) {
      this._validateLocationSet(obj);
    }
    this._rebuildIndex();
    return Promise.resolve(objects);
  }


  /**
   * locationSetID
   * Returns a locationSetID for a given locationSet (fallback to `+[Q2]`, world)
   * (The locationSet doesn't necessarily need to be resolved to compute its `id`)
   *
   * @param   {LocationSet}  locationSet - A {LocationSet} Object, e.g. `{ include: ['us'] }`
   * @return  {string}       String locationSetID, e.g. `+[Q30]`
   */
  locationSetID(locationSet) {
    let locationSetID;
    try {
      locationSetID = this._loco.validateLocationSet(locationSet).id;
    } catch (err) {
      locationSetID = '+[Q2]';  // the world
    }
    return locationSetID;
  }


  /**
   * locationSetsAt
   * Find all the locationSets valid at the given location.
   * Results include the area (in km²) to facilitate sorting.
   *
   * Object of locationSetIDs to areas (in km²)
   * {
   *   "+[Q2]": 511207893.3958111,
   *   "+[Q30]": 21817019.17,
   *   "+[new_jersey.geojson]": 22390.77,
   *   …
   * }
   *
   * @param  {Array<number>}  loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return {Object}         Result Object of locationSetIDs valid at given location
   */
  locationSetsAt(loc) {
    const result = {};
    const hits = this._wp(loc, true) || [];  // what's here?

    // locationSets
    for (const prop of hits) {
      if (prop.id[0] !== '+') continue;  // skip - it's a location
      const locationSetID = prop.id;
      const area = this._knownLocationSets.get(locationSetID);
      if (area) {
        result[locationSetID] = area;
      }
    }

    // locations included
    for (const prop of hits) {
      if (prop.id[0] === '+') continue;   // skip - it's a locationset
      const locationID = prop.id;
      const included = this._locationIncludedIn.get(locationID) || [];
      for (const locationSetID of included) {
        const area = this._knownLocationSets.get(locationSetID);
        if (area) {
          result[locationSetID] = area;
        }
      }
    }

    // locations excluded
    for (const prop of hits) {
      if (prop.id[0] === '+') continue;   // skip - it's a locationset
      const locationID = prop.id;
      const excluded = this._locationExcludedIn.get(locationID) || [];
      for (const locationSetID of excluded) {
        delete result[locationSetID];
      }
    }

    return result;
  }


  /**
   * isBlockedAt
   * Is editing blocked at the given location?
   * @param   {Array<number>}  loc -  `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return  {boolean}  `true` if a block exists there, `false` if not
   */
  isBlockedAt(loc) {
    if (!this._blocks.length) return false;
    return !!this._wpblocks(loc);
  }


  /**
   * getBlocks
   * Returns any blocked regions that exist within the given extent.
   * @param   {Extent}          extent -  the extent to query
   * @return  {Array<GeoJSON>}  Array of GeoJSON data objects
   */
  getBlocks(extent) {
    if (!this._blocks.length) return [];

    const hits = this._wpblocks.bbox(extent.rectangle());
    const results = new Set();

    // whichPolygon returns properties objects, we need to lookup the original GeoJSON data features.
    for (const hit of hits) {
      const data = this._resolved.get(hit.id);
      if (data) {
        results.add(data);
      }
    }

    return [...results];
  }


  /**
   * getFeature
   * Returns the resolved GeoJSON feature for a given locationSetID or locationID (fallback to 'world')
   * @param  {string}   dataID - locationSetID or locationID to retrieve
   * @return {GeoJSON}  GeoJSON data object (fallback to world)
   */
  getFeature(dataID = '+[Q2]') {
    // should we actually resolve it if it hasn't been?
    // (note that this isn't used currently, so it doesn't matter)
    return this._resolved.get(dataID) || this._resolved.get('+[Q2]');
  }

}
