import { utilArrayUniq } from '@rapid-sdk/util';

import { AbstractSystem } from './AbstractSystem.js';
import { osmNodeGeometriesForTags, osmSetAreaKeys, osmSetDeprecatedTags, osmSetPointTags, osmSetVertexTags } from '../data/lib/tags.js';
import { Category, Collection, Field, Preset } from './lib/index.js';
import { uiFields } from '../ui/fields/index.js';

const VERBOSE = true;        // warn about 'id-tagging-schema' features we don't support currently
const MAXRECENTS = 30;       // how many recents to store in localstorage
const MAXRECENTS_SHOW = 6;   // how many recents to show on the preset list


/**
 * `SchemaSystem` maintains indexes of all the Categories, Presets, and Fields.
 *
 * Properties you can access:
 *   `geometries`  {Set<string>}                The geometry types ('point', 'vertex', 'line', 'area', 'relation')
 *   `categories`  {Map<categoryID, Category>}  The categories
 *   `presets`     {Map<presetID, Preset>}      The presets
 *   `fields`      {Map<fieldID,  Field>}       The fields
 *   `universal`   {Map<fieldID,  Field>}       The "universal" fields (fields that can go with any Preset)
 *   `defaults`    {Map<string, Array<string>>}    Default items that are suggested for each geometry
 */
export class SchemaSystem extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'schema';
    this.requiredDependencies = new Set(['assets', 'l10n']);
    this.optionalDependencies = new Set(['locations', 'storage', 'urlhash']);

    this.geometries = new Set(['point', 'vertex', 'line', 'area', 'relation']);
    this.presets = new Map();
    this.fields = new Map();
    this.categories = new Map();
    this.universal = new Map();

    // Defaults are the Presets and Categories offered to the user when adding a new feature.
    // A fallback preset is appended to the list automatically so they dont need to be included here.
    this.defaults = new Map();
    for (const geometry of this.geometries) {
      this.defaults.set(geometry, []);
    }

    this.collection = null;

    this._recentIDs = null;

    // Set of presetIDs that the user can add (if null, all are normally addable)
    this.addablePresetIDs = null;

    // Index of presets by (geometry, tag key).
    this._geometryIndex = { point: {}, vertex: {}, line: {}, area: {}, relation: {} };

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.resetCaches = this.resetCaches.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const l10n = context.systems.l10n;
    const locations = context.systems.locations;
    const urlhash = context.systems.urlhash;

    // Create geometry fallback presets
    const point = new Preset(context, { id: 'point', name: 'Point', tags: {}, geometry: ['point', 'vertex'], matchScore: 0.1 } );
    const line = new Preset(context, { id: 'line', name: 'Line', tags: {}, geometry: ['line'], matchScore: 0.1 } );
    const area = new Preset(context, { id: 'area', name: 'Area', tags: { area: 'yes' }, geometry: ['area'], matchScore: 0.1 } );
    const relation = new Preset(context, { id: 'relation', name: 'Relation', tags: {}, geometry: ['relation'], matchScore: 0.1 } );

    this.presets.set('point', point);
    this.presets.set('vertex', point);  // use point for 'vertex' too.
    this.presets.set('line', line);
    this.presets.set('area', area);
    this.presets.set('relation', relation);
    this.collection = new Collection(context, [point, line, area, relation]);

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          l10n?.initAsync(),
          locations?.initAsync(),
          urlhash?.initAsync(),
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup Event Handlers..
        // When changing localization, we need to reset all of the preset and field caches.
        l10n?.on('localechange', this.resetCaches);

        // If we received a subset of addable presetIDs specified in the url hash, save them.
        const presetIDs = urlhash?.initialHashParams.get('presets');
        if (presetIDs) {
          const arr = presetIDs.split(',').map(s => s.trim()).filter(Boolean);
          this.addablePresetIDs = new Set(arr);
        }

        // Fetch the preset data
        return Promise.all([
          assets.loadAssetAsync('tagging_preset_categories'),
          assets.loadAssetAsync('tagging_preset_defaults'),
          assets.loadAssetAsync('tagging_preset_presets'),
          assets.loadAssetAsync('tagging_preset_fields'),
          assets.loadAssetAsync('tagging_preset_overrides'),   // customizations to merge in after the id-tagging-schema
          assets.loadAssetAsync('tagging_deprecated')
        ]);
      })
      .then(vals => {
        this.merge({ categories: vals[0], defaults: vals[1], presets: vals[2], fields: vals[3] });
        this.merge(vals[4]);
        osmSetDeprecatedTags(vals[5]);
        osmSetAreaKeys(this.areaKeys());
        osmSetPointTags(this.pointTags());
        osmSetVertexTags(this.vertexTags());
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    return super.startAsync();
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
   * resetCaches
   * This resets the caches in the Fields, Presets, and Categories.
   * The caches are used to speed up localization and searching.
   * This should be done after new data is merged in, or whenever the locale changes.
   */
  resetCaches() {
    this.universal.clear();
    for (const field of this.fields.values()) {
      field.resetCache();
      if (field.props.universal) {
        this.universal.set(field.id, field);
      }
    }
    for (const preset of this.presets.values()) {
      preset.resetCache();
    }
    for (const category of this.categories.values()) {
      category.resetCache();
    }
  }


  /**
   * merge
   * Accepts an object containing new preset data (all properties optional):
   * {
   *   fields: {},               // fieldID -> fieldData
   *   presets: {},              // presetID -> presetData
   *   categories: {},           // categoryID -> categoryData
   *   defaults: {},             // geometry -> Array(presetIDs)
   *   featureCollection: {}     // GeoJSON
   * }
   * @param  {Object}  src - preset data to merge into the caches
   */
  merge(src) {
    const checkLocationSets = [];
    const context = this.context;
    const locations = context.systems.locations;

    // Merge Fields
    if (src.fields) {
      for (const [fieldID, f] of Object.entries(src.fields)) {
        if (f) {   // add or replace
          if (!uiFields[f.type]) {
            if (VERBOSE) console.warn(`"${f.type}" type not supported for ${fieldID}`);  // eslint-disable-line no-console
            continue;
          }
          const field = new Field(context, { id: fieldID, ...f });
          if (field.props.locationSet) {
            checkLocationSets.push(field.props);
          }
          this.fields.set(fieldID, field);

        } else {   // remove
          this.fields.delete(fieldID);
        }
      }
    }

    // Merge Presets
    if (src.presets) {
      for (const [presetID, p] of Object.entries(src.presets)) {
        const existing = this.presets.get(presetID);
        if (existing?.isFallback()) continue;  // never override these

        if (p) {   // add or replace
// Rename icon identifiers to match the rapid spritesheet
if (p.icon) p.icon = p.icon.replace(/^iD-/, 'rapid-');

// A few overrides to use better icons than the ones provided by the id-tagging-schema project
if (presetID === 'address')                         p.icon = 'maki-circle-stroked';
if (presetID === 'highway/turning_loop')            p.icon = 'maki-circle';
if (p.icon === 'roentgen-needleleaved_tree')        p.icon = 'temaki-tree_needleleaved';
if (p.icon === 'roentgen-tree')                     p.icon = 'temaki-tree_broadleaved';
// fix: FontAwesome v7 no longer has 'fas-vector-square'
// see https://github.com/openstreetmap/id-tagging-schema/pull/1707 and previous
if (p.icon === 'fas-vector-square')                 p.icon = 'temaki-portrait_framed';

          const preset = new Preset(context, { id: presetID, ...p });
          if (preset.props.locationSet) {
            checkLocationSets.push(preset.props);
          }
          this.presets.set(presetID, preset);

        } else {   // remove
          this.presets.delete(presetID);
        }
      }
    }

    // Merge Categories
    if (src.categories) {
      for (const [categoryID, c] of Object.entries(src.categories)) {
        if (c) {   // add or replace
// Rename icon identifiers to match the rapid spritesheet
if (c.icon) c.icon = c.icon.replace(/^iD-/, 'rapid-');
          const category = new Category(context, { id: categoryID, ...c });
          if (category.props.locationSet) {
            checkLocationSets.push(category.props);
          }
          this.categories.set(categoryID, category);

        } else {   // remove
          this.categories.delete(categoryID);
        }
      }
    }

    // Merge Defaults
    if (src.defaults) {
      for (const [geometry, itemIDs] of Object.entries(src.defaults)) {
        let vals;
        if (Array.isArray(itemIDs)) {   // add or replace
          vals = itemIDs
            .map(id => this.item(id))
            .filter(item => item && !item.isFallback());
        } else {   // remove
          vals = [];
        }
        this.defaults.set(geometry, vals);
      }
    }

    this.resetCaches();

    // Replace `this.collection` after changing Presets and Categories
    const all = [...this.presets.values(), ...this.categories.values()];
    this.collection = new Collection(context, all);

    // Rebuild geometry index
    this._geometryIndex = { point: {}, vertex: {}, line: {}, area: {}, relation: {} };
    for (const item of all) {
      for (const geometry of item.geometries) {
        const g = this._geometryIndex[geometry];
        const tags = item.tags || {};
        for (const [key, val] of Object.entries(tags)) {
          g[key] = g[key] || {};
          (g[key][val] = g[key][val] || []).push(item);
        }
      }
    }

    if (locations) {
      // Merge Custom Features
      if (src.featureCollection && Array.isArray(src.featureCollection.features)) {
        locations.mergeCustomGeoJSON(src.featureCollection);
      }

      // Resolve all locationSet features.
      if (checkLocationSets.length) {
        locations.mergeLocationSets(checkLocationSets);
      }
    }

    return this;
  }


  /**
   * item
   * Returns the Preset or Catetory with the given id.
   * @param   {string}           id - a Preset or Category id
   * @return  {Preset|Category}  The Preset or Catetory, or `undefined` if not found
   */
  item(id) {
    return this.presets.get(id) || this.categories.get(id);
  }


  /**
   * field
   * Returns the Field with the given id.
   * @param   {string}  id - a Field id
   * @return  {Field}   The Field, or `undefined` if not found
   */
  field(id) {
    return this.fields.get(id);
  }


  /**
   * search
   * Performs a search across all Presets and Categories
   */
  search(value, geometry, loc)  {
    return this.collection.search(value, geometry, loc);
  }


  /**
   * match
   * @param   {Entity}  entity  - the Entity to test
   * @param   {Graph}   graph   - the Graph containing this Entity
   * @return  {Preset}  Preset that best matches
   */
  match(entity, graph) {
    return entity.transient('presetMatch', () => {
      let geometry = entity.geometry(graph);
      // Treat entities on addr:interpolation lines as points, not vertices - iD#3241
      if (geometry === 'vertex' && entity.isOnAddressLine(graph)) {
        geometry = 'point';
      }
      const entityExtent = entity.extent(graph);
      return this.matchTags(entity.tags, geometry, entityExtent?.center());
    });
  }


  /**
   * matchTags
   * @param   {Object}         tags
   * @param   {string}         geometry
   * @param   {Array<number>}  loc
   * @return  {Preset}         Preset that best matches
   */
  matchTags(tags, geometry, loc) {
    const context = this.context;
    const locations = context.systems.locations;

    const keyIndex = this._geometryIndex[geometry];

    // If we care about location, gather the locationSets allowed at this location
    const validHere = Array.isArray(loc) ? locations?.locationSetsAt(loc) : null;

    let bestScore = -1;
    let bestMatch = null;
    let matchCandidates = [];

    for (let k in tags) {
      const valueIndex = keyIndex[k];
      if (!valueIndex) continue;

      const indexMatches = [];
      const keyValueMatches = valueIndex[tags[k]];
      if (keyValueMatches) indexMatches.push(...keyValueMatches);
      const keyStarMatches = valueIndex['*'];
      if (keyStarMatches) indexMatches.push(...keyStarMatches);

      if (indexMatches.length === 0) continue;

      for (const candidate of indexMatches) {
        const score = candidate.matchScore(tags);
        if (score === -1) continue;

        // Exclude candidate if it is scoped to a location not valid here
        const locID = candidate.props.locationSetID;
        if (validHere && locID && !validHere[locID]) continue;

        matchCandidates.push({ score, candidate });

        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
    }

    // If any part of an address is present, allow fallback to "Address" preset - iD#4353
    if (!bestMatch || bestMatch.isFallback()) {
      for (let k in tags) {
        if (/^addr:/.test(k) && keyIndex['addr:*'] && keyIndex['addr:*']['*']) {
          bestMatch = keyIndex['addr:*']['*'][0];
          break;
        }
      }
    }

    return bestMatch || this.presets.get(geometry);
  }


  /**
   * allowsVertex
   * @param   {Entity}  entity  - the Entity to test
   * @param   {Graph}   graph   - the Graph containing this Entity
   * @return  {boolean} `true` if this entity can be a vertex, `false` if not
   */
  allowsVertex(entity, graph) {
    if (entity.type !== 'node') return false;
    if (Object.keys(entity.tags).length === 0) return true;

    return entity.transient('vertexMatch', () => {
      // address lines allow vertices to act as standalone points
      if (entity.isOnAddressLine(graph)) return true;

      const geometries = osmNodeGeometriesForTags(entity.tags);
      if (geometries.vertex) return true;
      if (geometries.point) return false;
      // allow vertices for unspecified points
      return true;
    });
  }


  /**
   * areaKeys
   * Because of the open nature of tagging, we will never have a complete
   * list of tags used in OSM, so we want it to have logic like "assume
   * that a closed way with an amenity tag is an area, unless the amenity
   * is one of these specific types". This function computes a structure
   * that allows testing of such conditions, based on the presets designated
   * as as supporting (or not supporting) the area geometry.
   *
   * The returned object L is a keeplist/discardlist of tags. A closed way
   * with a tag (k, v) is considered to be an area if `k in L && !(v in L[k])`
   * (see `Way#isArea()`). In other words, the keys of L form the keeplist,
   * and the subkeys form the discardlist.
   *
   * @returns {Object}  areaKeys Object
   */
  areaKeys() {
    // The ignore list is for keys that imply lines. (We always add `area=yes` for exceptions)
    const ignore = new Set(['barrier', 'highway', 'footway', 'railway', 'junction', 'type']);
    let areaKeys = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...this.presets.values()]
      .filter(p => !p.props.suggestion && !p.props.replacement);

    // keeplist
    for (const p of presets) {
      const k = Object.keys(p.tags)[0];  // pick the first tag
      if (!k) continue;
      if (ignore.has(k)) continue;

      if (p.geometries.has('area')) {    // probably an area..
        areaKeys[k] = areaKeys[k] || {};
      }
    }

    // discardlist
    for (const p of presets) {
      if (!p.geometries.has('line')) continue;
      for (const [k, v] of Object.entries(p.addTags)) {
        // examine all addTags to get a better sense of what can be tagged on lines - iD#6800
        // probably an area... but sometimes a line.
        if (k in areaKeys && v !== '*') {
          areaKeys[k][v] = true;
        }
      }
    }

    return areaKeys;
  }


  pointTags() {
    let pointTags = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...this.presets.values()]
      .filter(p => !p.props.suggestion && !p.props.replacement && p.props.searchable);

    for (const p of presets) {
      if (!p.geometries.has('point')) continue;

      const k = Object.keys(p.tags)[0];    // pick the first tag
      const v = Object.values(p.tags)[0];  // pick the first tag
      if (!k || !v) continue;

      pointTags[k] = pointTags[k] || {};
      pointTags[k][v] = true;
    }

    return pointTags;
  }


  vertexTags() {
    let vertexTags = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...this.presets.values()]
      .filter(p => !p.props.suggestion && !p.props.replacement && p.props.searchable);

    for (const p of presets) {
      if (!p.geometries.has('vertex')) continue;

      const k = Object.keys(p.tags)[0];    // pick the first tag
      const v = Object.values(p.tags)[0];  // pick the first tag
      if (!k || !v) continue;

      vertexTags[k] = vertexTags[k] || {};
      vertexTags[k][v] = true;
    }

    return vertexTags;
  }


  /**
   * getDefaults
   * Defaults are the Presets and Categories offered to the user when adding a new feature.
   * Each geometry type has its own set of defaults.
   * The fallback preset for the given geometry is appended to the list automatically.
   * @param   {string}          geometry
   * @param   {number}          limit - max number of results to return
   * @param   {boolean}         includeRecents - `true` to start with recently used presets
   * @param   {Array<number>}   loc - WGS84 [lon,lat] where we are editing
   * @return  {Collection}      Collection
   */
  getDefaults(geometry, limit = 10, includeRecents = true, loc = null) {
    const context = this.context;
    const locations = context.systems.locations;

    const results = new Map();   // Map<itemID, item>  (may be a Preset or a Category)

    if (includeRecents) {
      for (const preset of this.getRecents()) {
        if (results.size < MAXRECENTS_SHOW && preset.geometries.has(geometry)) {
          results.set(preset.id, preset);
        }
      }
    }

    // If there is a set of addable presetIDs, use that instead of defaults
    if (this.addablePresetIDs instanceof Set) {
      for (const itemID of this.addablePresetIDs) {
        const item = this.item(itemID);
        if (item?.geometries.has(geometry)) {
          results.set(itemID, item);
        }
      }
    } else {
      const items = this.defaults.get(geometry);
      for (const item of items) {
        if (item.geometries.has(geometry)) {
          results.set(item.id, item);
        }
      }
    }

    const fallback = this.presets.get(geometry);
    if (fallback && !results.has(fallback.id)) {
      results.set(fallback.id, fallback);
    }

    let arr = [...results.values()];

    // If a location was provided, filter results to only those valid here.
    if (locations && Array.isArray(loc)) {
      const validHere = locations.locationSetsAt(loc);
      arr = arr.filter(item => {
        const locID = item.props.locationSetID;
        return !locID || validHere[locID];   // if !locID, item is valid everywhere
      });
    }

    return new Collection(context, arr.slice(0, limit - 1));
  }


  /**
   * getRecents
   * Returns the recently used presets
   * If this._recentIDs is unset, try to load them from localStorage
   * @return  {Array<Preset>}  An Array of recent presets
   */
  getRecents() {
    const context = this.context;
    const storage = context.systems.storage;

    let presetIDs = this._recentIDs;
    if (storage && !presetIDs) {  // first time, try to get them from localStorage
      presetIDs = JSON.parse(storage.getItem('preset_recents')) || [];
    }

    const presets = presetIDs
      .map(item => {
        const id = item?.id || item;  // previously we stored preset, now we just store presetID
        return this.presets.get(id);
      })
      .filter(Boolean);

    if (!this._recentIDs) {
      this._recentIDs = presets.map(item => item.id);
    }

    return presets;
  }


  /**
   * setMostRecent
   * Prepends a preset to the recently used presets array
   * @param  {Preset}  A preset to add
   */
  setMostRecent(preset) {
    if (preset.searchable === false) return;

    const storage = this.context.systems.storage;

    this._recentIDs.unshift(preset.id);   // prepend array
    this._recentIDs = utilArrayUniq(this._recentIDs).slice(0, MAXRECENTS);

    storage?.setItem('preset_recents', JSON.stringify(this._recentIDs));
  }

}


/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  (I don't know whether this really matters much - we don't actually parse the JSDoc.)
 *  @typedef  {string}  categoryID
 *  @typedef  {string}  presetID
 *  @typedef  {string}  fieldID
 */
