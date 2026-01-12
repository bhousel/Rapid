import { utilArrayUniq } from '@rapid-sdk/util';
import MiniSearch from 'minisearch';

import { AbstractSystem } from './AbstractSystem.ts';
import { osmNodeGeometriesForTags, osmSetAreaKeys, osmSetDeprecatedTags, osmSetPointTags, osmSetVertexTags } from '../lib/tags.ts';
import { Category, Field, Preset } from '../lib/index.ts';
import { utilIterable } from '../util/iterable.ts';
import { utilWildcard } from '../util/string.ts';

import type { Context, SystemID } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { CategoryProps } from '../lib/Category.ts';
import type { FieldProps } from '../lib/Field.ts';
import type { PresetProps } from '../lib/Preset.ts';
import type { Tags } from '../data/types.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';


// Make very sure this resolves to Rapid's `package.json`
// If you mess up the `../`s, the resolver may import another random package.json from somewhere else.
import {
  version as rapidVersion,
  dependencies as rapidDependencies
} from '../../package.json' with { type: 'json' };

const VERBOSE = true;        // warn about 'id-tagging-schema' features we don't support currently
const MAXRECENTS = 30;       // how many recents to store in localstorage
const MAXRECENTS_SHOW = 6;   // how many recents to show on the preset list


/** Geometry types supported by the schema system */
export type GeometryType = 'point' | 'vertex' | 'line' | 'area' | 'relation';

/** Field types supported by Rapid's UI */
export type FieldType =
  | 'access' | 'address' | 'check' | 'combo' | 'cycleway' | 'defaultCheck' | 'email'
  | 'identifier' | 'lanes' | 'localized' | 'roadspeed' | 'roadheight' | 'manyCombo'
  | 'multiCombo' | 'networkCombo' | 'number' | 'onewayCheck' | 'radio' | 'restrictions'
  | 'semiCombo' | 'structureRadio' | 'tel' | 'text' | 'textarea' | 'typeCombo' | 'url'
  | 'wikidata' | 'wikipedia';


/** Raw field data as it comes from the schema files (before processing) */
type RawFieldData = Partial<FieldProps> & Record<string, unknown>;

/** Raw preset data as it comes from the schema files (before processing) */
type RawPresetData = Partial<PresetProps> & Record<string, unknown>;

/** Raw category data as it comes from the schema files (before processing) */
type RawCategoryData = Partial<CategoryProps> & { icon?: string } & Record<string, unknown>;

/**
 * Schema bundle data to merge into the system.
 * Contains categories, presets, fields, and defaults.
 */
export interface SchemaBundle {
  /** A string bundle identifier, e.g. 'id-tagging-schema@6.13.0' (required) */
  bundleID: string;
  /** Object mapping fieldID to field data (or null to delete) */
  fields?: Record<string, RawFieldData | null>;
  /** Object mapping presetID to preset data (or null to delete) */
  presets?: Record<string, RawPresetData | null>;
  /** Object mapping categoryID to category data (or null to delete) */
  categories?: Record<string, RawCategoryData | null>;
  /** Object mapping geometry type to array of default preset/category IDs */
  defaults?: Record<string, string[]>;
  /** Custom GeoJSON features for locationSets */
  featureCollection?: GeoJSON.FeatureCollection;
}


/** MiniSearch search result */
interface SearchResult {
  id: string;
  match: Record<string, string[]>;
  queryTerms: string[];
  score: number;
  terms: string[];
  [key: string]: any;
}


/**
 * `SchemaSystem` maintains data and indexes of all the Categories, Presets, and Fields.
 * (This used to be called 'presets' or 'PresetSystem')
 *
 * This system is used to identify features in OpenStreetMap based on their tagging,
 * and to support user interface functions like searching for feature types and editing attributes.
 *
 * - A `Field` represents a user interface component for displaying/editing a tag or tags.
 * - A `Preset` represents a bundle of tags that identify a feature type. A Preset can reference multiple Fields.
 * - A `Category` is a collection of Presets (e.g. "Major Roads", "Buildings", etc).
 *
 * In this case, "schemas" are the files containing these rules about tagging.
 * At init time, Rapid will load the default schema data from the `id-tagging-schema` project
 * but additional preset data can be merged in to supplement or override the defaults,
 *
 * For the schema definition, see: https://github.com/ideditor/schema-builder
 * For the default schema data, see: https://github.com/openstreetmap/id-tagging-schema
 *
 * Properties available:
 *   `geometryTypes`  The supported geometry types ('point', 'vertex', 'line', 'area', 'relation')
 *   `fieldTypes`     The supported field types (see also `ui/fields/index.js`)
 *   `bundles`        Names of schema bundles that have been merged in
 *   `fields`         The Fields
 *   `presets`        The Presets
 *   `categories`     The Categories
 *   `universal`      The "universal" fields (fields that can go with any Preset)
 *   `defaults`       Default items that are suggested for each geometry
 *
 * Events available:
 *   `schemachange`    Fires on any change in the available schemas
 */
export class SchemaSystem extends AbstractSystem {
  /** The supported geometry types */
  readonly geometryTypes: Set<GeometryType>;
  /** The supported field types */
  readonly fieldTypes: Set<FieldType>;

  /** Set of presetIDs that the user can add (if `null`, all are normally addable) */
  addablePresetIDs: Set<string> | null;

  /** Names of schema bundles that have been merged in */
  bundles: Set<string>;
  /** The Categories, keyed by categoryID */
  categories: Map<string, Category>;
  /** The Presets, keyed by presetID */
  presets: Map<string, Preset>;
  /** The Fields, keyed by fieldID */
  fields: Map<string, Field>;
  /** The "universal" fields that can go with any Preset */
  universal: Map<string, Field>;
  /** Default preset/category IDs for each geometry type */
  defaults: Map<GeometryType, Set<string>>;

  private _matchIndex: Map<string, Record<string, Record<string, Preset[]>>>;
  private _recentIDs: string[] | null;

  // MiniSearch fulltext search indexes, one per locale
  private _searchIndexes: Map<string, MiniSearch>;
  private _currLocaleCode: string | null;
  private _currSearchIndex: MiniSearch | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'schema';
    this.requiredDependencies = new Set(['assets']);
    this.optionalDependencies = new Set(['gfx', 'l10n', 'locations', 'storage', 'urlhash']);

    this.geometryTypes = new Set(['point', 'vertex', 'line', 'area', 'relation'] as GeometryType[]);

    // The field types here must match the field types listed in `ui/fields/index.js`.
    // Other field types may be found in a tagging schema, but these are the ones Rapid currently supports.
    // Do not add a new field type without also adding a user interface component to support that field type.
    this.fieldTypes = new Set([
      'access', 'address', 'check', 'combo', 'cycleway', 'defaultCheck', 'email',
      'identifier', 'lanes', 'localized', 'roadspeed', 'roadheight', 'manyCombo',
      'multiCombo', 'networkCombo', 'number', 'onewayCheck', 'radio', 'restrictions',
      'semiCombo', 'structureRadio', 'tel', 'text', 'textarea', 'typeCombo', 'url',
      'wikidata', 'wikipedia'
    ] as FieldType[]);

    // Set of presetIDs that the user can add (if `null`, all are normally addable)
    this.addablePresetIDs = null;

    this.bundles = new Set();      // Set<bundleID> - track merged schema bundles
    this.categories = new Map();   // Map<categoryID, Category>
    this.presets = new Map();      // Map<presetID, Preset>
    this.fields = new Map();       // Map<fieldID, Field>
    this.universal = new Map();    // Map<fieldID, Field>  (for universal fields)
    this.defaults = new Map();     // Map<geometryType, Set<presetID|categoryID>>

    this._matchIndex = new Map();  // Map<geometryType, Object>
    this._recentIDs = null;

    // We will keep a MiniSearch fulltext search index for each needed locale code.
    // Most of the time people would just use Rapid in one language.
    // But this allows users to switch their locale/language while Rapid is running.
    this._searchIndexes = new Map();  // Map<localeCode, MiniSearch>
    this._currLocaleCode = null;      // The current locale code
    this._currSearchIndex = null;     // The current search index

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._localeChanged = this._localeChanged.bind(this);
    this._schemaChanged = this._schemaChanged.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  override initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const l10n = context.systems.l10n;
    const locations = context.systems.locations;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          l10n?.initAsync(),
          locations?.initAsync(),
          urlhash?.initAsync(),
        ];
        return Promise.all(prerequisites.filter(Boolean) as Promise<void>[]);
      })
      .then(() => {
        // Setup Event Handlers..
        l10n?.on('localechange', this._localeChanged);

        // Clear data and create the fallback Presets..
        this._resetAll();

        // If we received a subset of addable presetIDs specified in the url hash, save them.
        const presetIDs = urlhash?.initialHashParams.get('presets');
        if (presetIDs) {
          const arr = presetIDs.split(',').map(s => s.trim()).filter(Boolean);
          this.addablePresetIDs = new Set(arr);
        }

        return this._loadDefaultSchemaAsync();
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  override startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  override resetAsync(): Promise<void> {
    // Note: We don't reset the SchemaSystem here.
    // This method is called when the user starts a new session.
    return Promise.resolve();
  }


  /**
   * item
   * Returns the Preset or Catetory with the given id.
   * @param   id - a Preset or Category id
   * @return  The Preset or Catetory, or `undefined` if not found
   */
  item(id: string): Preset | Category | undefined {
    return this.presets.get(id) || this.categories.get(id);
  }


  /**
   * field
   * Returns the Field with the given id.
   * @param   id - a Field id
   * @return  The Field, or `undefined` if not found
   */
  field(id: string): Field | undefined {
    return this.fields.get(id);
  }


  /**
   * merge
   * Accepts an object containing new schema data (all properties except 'id' are optional):
   * {
   *   bundleID: '',           // A string bundle identifier, e.g. 'id-tagging-schema@6.13.0'
   *   fields: {},             // Object<fieldID, fieldData>
   *   presets: {},            // Object<presetID, presetData>
   *   categories: {},         // Object<categoryID, categoryData>
   *   defaults: {},           // Object<geometry, Array<presetIDs>>
   *   featureCollection: {}   // Custom GeoJSON, possibly referenced by locationSets
   * }
   *
   * When merging:
   *  - Items are processed in the order they appear.
   *  - You can't replace the fallback presets.
   *     `"point": { name: 'My Point', … },`            <-- silently ignored
   *  - New items will replace existing items that have the same `id`.
   *     `"barrier/fence": { name: 'My Fence', … },`    <-- `barrier/fence` preset replaced
   *  - If no new data supplied, this is treated as a delete.
   *     `"barrier/fence": null,`                       <-- `barrier/fence` preset deleted
   *  - Wildcard characters '*' and '?' are allowed when deleting.
   *     `"barrier/*": null,`                           <-- all `barrier/*` presets deleted
   *
   * @param  src - preset data to merge into the caches
   * @throws  Will throw if given data does not contain a `bundleID`, or if the `bundleID` has already been merged
   */
  merge(src: SchemaBundle): void {
    const bundleID = src.bundleID;

    if (!bundleID) {
      throw new Error('Schema missing bundleID property');
    }
    if (this.bundles.has(bundleID)) {
      throw new Error(`Schema "${bundleID}" already merged`);
    }

    this.bundles.add(bundleID);

    const checkLocationSets: Array<{ locationSet?: object; locationSetID?: string }> = [];
    const context = this.context;
    const locations = context.systems.locations;

    // Merge Fields
    if (src.fields) {
      for (const [fieldID, f] of Object.entries(src.fields)) {
        const existing = this.fields.get(fieldID);
        if (existing?.isBuiltin()) continue;  // don't override a builtin Field

        if (f) {   // add or replace
          if (!this.fieldTypes.has(f.type as FieldType)) {
            if (VERBOSE) console.warn(`"${f.type}" type not supported for ${fieldID}`);  // eslint-disable-line no-console
            continue;
          }
          const field = new Field(context, { id: fieldID, bundleID: bundleID, ...f });
          if (field.props.locationSet) {
            checkLocationSets.push(field.props);
          }
          this.fields.set(fieldID, field);

        } else {   // remove
          const wildcard = utilWildcard(fieldID);
          if (wildcard) {
            for (const k of this.fields.keys()) {
              if (wildcard.test(k)) {
                this.fields.delete(k);
              }
            }
          } else {
            this.fields.delete(fieldID);
          }
        }
      }
    }

    // Merge Presets
    if (src.presets) {
      for (const [presetID, p] of Object.entries(src.presets)) {
        const existing = this.presets.get(presetID);
        if (existing?.isBuiltin()) continue;  // don't override a builtin Preset

        if (p) {   // add or replace
          // Rename icon identifiers to match the rapid spritesheet
          if (p.icon) p.icon = p.icon.replace(/^iD-/, 'rapid-');

          // A few overrides to use better icons than the ones provided by the id-tagging-schema project
          if (presetID === 'address')                    p.icon = 'maki-circle-stroked';
          if (presetID === 'highway/turning_loop')       p.icon = 'maki-circle';
          if (p.icon === 'roentgen-needleleaved_tree')   p.icon = 'temaki-tree_needleleaved';
          if (p.icon === 'roentgen-tree')                p.icon = 'temaki-tree_broadleaved';
          // fix: FontAwesome v7 no longer has 'fas-vector-square'
          // see https://github.com/openstreetmap/id-tagging-schema/pull/1707 and previous
          if (p.icon === 'fas-vector-square')            p.icon = 'temaki-portrait_framed';

          const preset = new Preset(context, { id: presetID, bundleID: bundleID, ...p });
          if (preset.props.locationSet) {
            checkLocationSets.push(preset.props);
          }
          this.presets.set(presetID, preset);

        } else {   // remove
          const wildcard = utilWildcard(presetID);
          if (wildcard) {
            for (const k of this.presets.keys()) {
              if (wildcard.test(k)) {
                this.presets.delete(k);
              }
            }
          } else {
            this.presets.delete(presetID);
          }
        }
      }
    }

    // Merge Categories
    if (src.categories) {
      for (const [categoryID, c] of Object.entries(src.categories)) {
        const existing = this.categories.get(categoryID);
        if (existing?.isBuiltin()) continue;  // don't override a builtin Category

        if (c) {   // add or replace
          // Rename icon identifiers to match the rapid spritesheet
          if (c.icon) c.icon = c.icon.replace(/^iD-/, 'rapid-');

          const category = new Category(context, { id: categoryID, bundleID: bundleID, ...c });
          if (category.props.locationSet) {
            checkLocationSets.push(category.props);
          }
          this.categories.set(categoryID, category);

        } else {   // remove
          const wildcard = utilWildcard(categoryID);
          if (wildcard) {
            for (const k of this.categories.keys()) {
              if (wildcard.test(k)) {
                this.categories.delete(k);
              }
            }
          } else {
            this.categories.delete(categoryID);
          }
        }
      }
    }

    // Merge Defaults
    if (src.defaults) {
      for (const [geometry, itemIDs] of Object.entries(src.defaults)) {
        const currIDs = this.defaults.get(geometry as GeometryType);
        if (!currIDs) continue;   // not a valid geometry type?

        const newIDs = Array.isArray(itemIDs) ? itemIDs : [];
        for (const newID of newIDs) {
          if (!newID || this.geometryTypes.has(newID as GeometryType)) continue;  // skip if empty or fallback
          currIDs.add(newID);
        }
        this.defaults.set(geometry as GeometryType, currIDs);
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

    this._schemaChanged();
  }


  /**
   * search
   * Performs a full-text search across all Presets and Categories.
   * This is powered by the Minisearch library and returns a result like:
   *  {
   *    id: string;
   *    match: MatchInfo;
   *    queryTerms: string[];
   *    score: number;
   *    terms: string[];
   *    [key: string]: any;
   *  }
   * @see https://lucaong.github.io/minisearch/index.html
   *
   * @param   query - the value to search
   * @param   geometries - geometries to include in the results
   * @param   loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return  A Minisearch `SearchResult`, containing the score and information about the match
   * @throws  Will throw if the search index is not ready
   */
  search(query: string = '', geometries: GeometryType | GeometryType[] = [], loc: [number, number] | null = null): SearchResult[] {
    if (!this._currSearchIndex) {   // shouldn't happen
      throw new Error('Search index not ready');
    }

    if (!query || !geometries.length) return [];

    // Get diacritic marks into a consistent format, perfer them combined into fewer characters.
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
    query = query.normalize('NFKC');

    const context = this.context;
    const locations = context.systems.locations;

    const filterGeometries = new Set(utilIterable(geometries));
    const filterLocationSets = Array.isArray(loc) ? locations?.locationSetsAt(loc) : null;

    const _filter = (result: SearchResult): boolean => {
      const item = this.item(result.id);
      if (!item) return false;
      if (!filterGeometries.isSubsetOf(item.geometries)) return false;

      if (filterLocationSets) {
        const locID = (item.props as any).locationSetID as string | undefined;
        if (locID && !filterLocationSets[locID]) return false;   // if !locID, item is valid everywhere
      }
      return true;
    };

    const _boostDocument = (documentID: any, term: string, stored?: Record<string, unknown>): number => {
      if (stored?.suggestion) return 0.5;            // rank suggestion presets lower than normal presets
      if (stored?.type === 'category') return 0.5;   // rank categories lower than presets
      return 1;
    };

    // Perform the search twice - once with exact matching and once with fuzzy matching.
    // We do this because:  we want exact matches to *always* beat fuzzy matches.
    // We don't want additional fuzzy matches to bump a result above an exact match.
    // For example:   query = "shop"
    //   "Shop" should be the top result.  "Shoe Shop" should never outrank it.
    //
    const exactResults = this._currSearchIndex.search(query, {
      boost: { primary: 20, alternate: 10 },
      boostDocument: _boostDocument,
      combineWith: 'AND',
      filter: _filter,
      fuzzy: false,   // no fuzzy (match strings with nearby edit distance)
      prefix: false   // no prefix (partial match beginning of a string)
    }) as SearchResult[];

    const fuzzyResults = this._currSearchIndex.search(query, {
      boost: { primary: 2, alternate: 1 },
      boostDocument: _boostDocument,
      combineWith: 'AND',
      filter: _filter,
      fuzzy: true,    // allow fuzzy (match strings with nearby edit distance)
      prefix: true,   // allow prefix (partial match beginning of a string)
      weights: {
        fuzzy: 0.2,
        prefix: 0.3
      }
    }) as SearchResult[];

    const results = new Map<string, SearchResult>();   // Map<docID, SearchResult>

    for (const hit of exactResults) {
      results.set(hit.id, hit);
    }
    for (const hit of fuzzyResults) {
      if (!results.has(hit.id)) {
        results.set(hit.id, hit);
      }
    }

    return [...results.values()];
  }


  /**
   * match
   * @param   entity  - the Entity to test
   * @param   graph   - the Graph containing this Entity
   * @return  Preset that best matches
   */
  match(entity: OsmEntity, graph: Graph): Preset | null {
    return entity.transient('presetMatch', () => {
      let geometry = entity.geometry(graph) as GeometryType;
      // Treat entities on addr:interpolation lines as points, not vertices - iD#3241
      if (geometry === 'vertex' && (entity as any).isOnAddressLine?.(graph)) {
        geometry = 'point';
      }
      const entityExtent = (entity as any).extent?.(graph);
      return this.matchTags(entity.tags, geometry, entityExtent?.center());
    });
  }


  /**
   * matchTags
   * @param   tags
   * @param   geometry
   * @param   loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @return  Preset that best matches
   */
  matchTags(tags: Tags, geometry: GeometryType, loc?: [number, number]): Preset | null {
    const context = this.context;
    const locations = context.systems.locations;

    const keyIndex = this._matchIndex.get(geometry);
    if (!keyIndex) return null;  // invalid geometry option?

    // If we care about location, gather the locationSets allowed at this location
    const validHere = Array.isArray(loc) ? locations?.locationSetsAt(loc) : null;

    let bestScore = -1;
    let bestMatch: Preset | null = null;
    const matchCandidates: Array<{ score: number; candidate: Preset }> = [];

    for (const k in tags) {
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
      for (const k in tags) {
        if (/^addr:/.test(k) && keyIndex['addr:*'] && keyIndex['addr:*']['*']) {
          bestMatch = keyIndex['addr:*']['*'][0];
          break;
        }
      }
    }

    return bestMatch || this.getFallback(geometry) || null;
  }


  /**
   * allowsVertex
   * @param   entity  - the Entity to test
   * @param   graph   - the Graph containing this Entity
   * @return  `true` if this entity can be a vertex, `false` if not
   */
  allowsVertex(entity: OsmEntity, graph: Graph): boolean {
    if (entity.type !== 'node') return false;
    if (Object.keys(entity.tags).length === 0) return true;

    return entity.transient('vertexMatch', () => {
      // address lines allow vertices to act as standalone points
      if ((entity as any).isOnAddressLine?.(graph)) return true;

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
   * @returns  areaKeys Object
   */
  areaKeys(): Record<string, Record<string, boolean>> {
    // The ignore list is for keys that imply lines. (We always add `area=yes` for exceptions)
    const ignore = new Set(['barrier', 'highway', 'footway', 'railway', 'junction', 'type']);
    const areaKeys: Record<string, Record<string, boolean>> = {};

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


  pointTags(): Record<string, Record<string, boolean>> {
    const pointTags: Record<string, Record<string, boolean>> = {};

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


  vertexTags(): Record<string, Record<string, boolean>> {
    const vertexTags: Record<string, Record<string, boolean>> = {};

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
   * getFallback
   * Gets the fallback preset for the given geometry.
   * For most geometries we just return the Preset with that `id`, but for `vertex' we return 'point'.
   * @param   geometry - 'point', 'vertex', 'line', 'area', or 'relation'
   * @return  The fallback preset, or `undefined` if not found
   */
  getFallback(geometry: GeometryType): Preset | undefined {
    if (geometry === 'vertex')  geometry = 'point';
    return this.presets.get(geometry);
  }


  /**
   * getDefaults
   * Defaults are the Presets and Categories offered to the user when adding a new feature.
   * Each geometry type has its own set of defaults.
   * The fallback preset for the given geometry is appended to the list automatically.
   * @param   geometry
   * @param   includeRecents - `true` to start with recently used presets
   * @param   loc - WGS84 [lon,lat] where we are editing
   * @return  Array of Categories and Presets
   */
  getDefaults(geometry: GeometryType, includeRecents: boolean = true, loc: [number, number] | null = null): Array<Category | Preset> {
    if (!geometry) return [];

    const context = this.context;
    const locations = context.systems.locations;

    const results = new Map<string, Category | Preset>();   // Map<itemID, item>  (may be a Preset or a Category)

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
      const itemIDs = this.defaults.get(geometry);
      if (itemIDs) {
        for (const itemID of itemIDs) {
          const item = this.item(itemID);
          if (item?.geometries.has(geometry)) {
            results.set(itemID, item);
          }
        }
      }
    }

    const fallback = this.getFallback(geometry);
    if (fallback && !results.has(fallback.id)) {
      results.set(fallback.id, fallback);
    }

    let arr = [...results.values()];

    // If a location was provided, filter results to only those valid here.
    if (locations && Array.isArray(loc)) {
      const validHere = locations.locationSetsAt(loc);
      arr = arr.filter(item => {
        const locID = (item.props as any).locationSetID as string | undefined;
        return !locID || validHere[locID];   // if !locID, item is valid everywhere
      });
    }

    return arr;
  }


  /**
   * getRecents
   * Returns the recently used presets.
   * If this._recentIDs is unset, try to load them from localStorage
   * @return  An Array of recent presets
   */
  getRecents(): Preset[] {
    const context = this.context;
    const storage = context.systems.storage;

    let itemIDs = this._recentIDs;
    if (!Array.isArray(itemIDs)) {  // first time, try to get them from localStorage
      if (storage) {
        itemIDs = JSON.parse(storage.getItem('preset_recents') ?? '[]') || [];
      } else {
        itemIDs = [];
      }
    }

    const presets = (itemIDs ?? [])
      .map(item => {
        const id = (item as any)?.id || item;  // previously we stored preset, now we just store presetID
        return this.presets.get(id);
      })
      .filter(Boolean) as Preset[];

    if (!this._recentIDs) {
      this._recentIDs = presets.map(item => item.id);
    }

    return presets;
  }


  /**
   * setMostRecent
   * Prepends a preset to the recently used Presets array.
   * @param  preset - A preset to add
   */
  setMostRecent(preset: Preset): void {
    if (!preset?.props?.searchable) return;

    const storage = this.context.systems.storage;

    if (!Array.isArray(this._recentIDs)) {
      this._recentIDs = [];
    }

    this._recentIDs.unshift(preset.id);   // prepend array
    this._recentIDs = utilArrayUniq(this._recentIDs).slice(0, MAXRECENTS);

    storage?.setItem('preset_recents', JSON.stringify(this._recentIDs));
  }


  /**
   * _loadDefaultSchemaAsync
   * This loads the default schema for Rapid:
   *  - iD-tagging-schema
   *  - rapid schema overrides
   * @return  Promise fulfilled when the default schema has been downloaded and merged into Rapid.
   */
  private _loadDefaultSchemaAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets;

    if (!assets) {
      return Promise.reject(new Error('AssetSystem not available'));
    }

    // Tell the AssetSystem what to load..
    const latestPath = 'https://cdn.jsdelivr.net/npm/@openstreetmap/id-tagging-schema@6.6/dist';
    assets.setAsset('iD_schema_deprecated', `${latestPath}/deprecated.min.json`, 'latest');
    assets.setAsset('iD_schema_discarded', `${latestPath}/discarded.min.json`, 'latest');
    assets.setAsset('iD_schema_categories', `${latestPath}/preset_categories.min.json`, 'latest');
    assets.setAsset('iD_schema_defaults', `${latestPath}/preset_defaults.min.json`, 'latest');
    assets.setAsset('iD_schema_presets', `${latestPath}/presets.min.json`, 'latest');
    assets.setAsset('iD_schema_fields', `${latestPath}/fields.min.json`, 'latest');

    const localPath = 'data/modules/id-tagging-schema';
    assets.setAsset('iD_schema_deprecated', `${localPath}/deprecated.min.json`, 'local');
    assets.setAsset('iD_schema_discarded', `${localPath}/discarded.min.json`, 'local');
    assets.setAsset('iD_schema_categories', `${localPath}/preset_categories.min.json`, 'local');
    assets.setAsset('iD_schema_defaults', `${localPath}/preset_defaults.min.json`, 'local');
    assets.setAsset('iD_schema_presets', `${localPath}/presets.min.json`, 'local');
    assets.setAsset('iD_schema_fields', `${localPath}/fields.min.json`, 'local');

    // 'rapid_schema_overrides' = customizations to merge in after the id-tagging-schema
    assets.setAsset('rapid_schema_overrides', 'data/schema_overrides.min.json');

    // Fetch the schema data
    return Promise.all([
      assets.loadAssetAsync('iD_schema_deprecated'),
      assets.loadAssetAsync('iD_schema_discarded'),
      assets.loadAssetAsync('iD_schema_categories'),
      assets.loadAssetAsync('iD_schema_defaults'),
      assets.loadAssetAsync('iD_schema_presets'),
      assets.loadAssetAsync('iD_schema_fields'),
      assets.loadAssetAsync('rapid_schema_overrides')
    ])
    .then(vals => {
      osmSetDeprecatedTags(vals[0] as any);
      // osmSetDiscardedTags(vals[1]);  // TODO: should be here, but it isn't yet

      // Determine the version of id-tagging-schema
      // This might not be exact because the CDN can return a newer semver patch.
      // But it's close enough, and this string is informational only.
      // (It would be better if these files included some metadata like my other projects do).
      let idSchemaVersion = 'unknown';
      for (const [k, v] of Object.entries(rapidDependencies)) {
        if (/id-tagging-schema$/.test(k)) {
          idSchemaVersion = v.replaceAll(/[\^~]/g, '');  // no carat/tilde
          break;
        }
      }

      // Merge id-tagging-schema...
      this.merge({
        bundleID: `id-tagging-schema@${idSchemaVersion}`,
        categories: vals[2] as any,
        defaults: vals[3] as any,
        presets: vals[4] as any,
        fields: vals[5] as any
      });

      // Merge rapid_schema_overrides...
      const rapidSchemaVersion = rapidVersion || 'unknown';
      const overrides = vals[6] as Partial<SchemaBundle>;
      this.merge({
        bundleID: `rapid-schema-overrides@${rapidSchemaVersion}`,
        ...overrides
      });
    });
  }


  /**
   * _localeChanged
   * Call this whenever the locale changes.
   * It will lock in the new locale and prepare a search index for that locale.
   * These are cached, so switching back to an already-seen locale should be fast.
   * @param  localeCode - optional new locale code (fallback to getting it from LocalizationSystem, or en-US)
   */
  private _localeChanged(localeCode?: string): void {
    const l10n = this.context.systems.l10n;

    // Ensure that we have a current locale code.
    localeCode ||= l10n?.localeCode || 'en-US';
    this._currLocaleCode = localeCode;

    // Re-localize the Category, Preset, Field strings, if needed.
    for (const field of this.fields.values()) {
      field.setLocale(localeCode);
    }
    for (const preset of this.presets.values()) {
      preset.setLocale(localeCode);
    }
    for (const category of this.categories.values()) {
      category.setLocale(localeCode);
    }

    this._prepareSearchIndex();
  }


  /**
   * _prepareSearchIndex
   * This prepares a MiniSearch index for the current locale code.
   * These are cached, so switching back to an already-seen locale should be fast.
   */
  private _prepareSearchIndex(): void {
    const l10n = this.context.systems.l10n;

    // Ensure that we have a current locale code.
    this._currLocaleCode ||= l10n?.localeCode || 'en-US';

    // Switch the search index, create a new one if needed.
    this._currSearchIndex = this._searchIndexes.get(this._currLocaleCode) ?? null;

    if (!this._currSearchIndex) {
      this._currSearchIndex = new MiniSearch({
        autoVacuum: false,
        idField: 'id',
        fields: ['primary', 'alternate'],
        storeFields: ['type', 'suggestion'],
        extractField: (item: any, fieldName: string) => item._currStrings[fieldName]
      });

      this._searchIndexes.set(this._currLocaleCode, this._currSearchIndex);
      this._rebuildSearchIndex();
    }
  }


  /**
   * _rebuildSearchIndex
   * Rebuild the current MiniSearch full-text search index.
   * This happens when we switch to a new search index for the first time.
   * This may be a bit slow, so consider making this async.
   */
  private _rebuildSearchIndex(): void {
    // Ensure that we have a current serach index.
    if (!this._currSearchIndex) {
      this._prepareSearchIndex();
    }

    // Gather "searchable" Presets and Categories..
    this._currSearchIndex!.removeAll();

    for (const preset of this.presets.values()) {
      if (!preset.props.searchable) continue;
      this._currSearchIndex!.add(preset);
    }
    for (const category of this.categories.values()) {
      if (!category.props.searchable) continue;
      this._currSearchIndex!.add(category);
    }
  }


  /**
   * _schemaChanged
   * Called whenever the available schemas has changed.
   * This should happen after new schema data has been merged in.
   * Remove all cached data and cached fulltext search index.
   * (The new schema may have different presets with different strings)
   * This will trigger a redraw, and emit a 'schemachange' event.
   */
  private _schemaChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx as any;

    // Reset the Category, Preset, Field cached data
    for (const field of this.fields.values()) {
      field.reset();
    }
    for (const preset of this.presets.values()) {
      preset.reset();
    }
    for (const category of this.categories.values()) {
      category.reset();
    }

    // Reset and rebuild the search index
    this._searchIndexes.clear();
    this._prepareSearchIndex();


    // Gather "universal" fields..
    this.universal.clear();
    for (const field of this.fields.values()) {
      if (field.props.universal) {
        this.universal.set(field.id, field);
      }
    }

    // Rebuild geometry match index..
    this._matchIndex.clear();
    for (const geometry of this.geometryTypes) {
      this._matchIndex.set(geometry, {});
    }
    for (const preset of this.presets.values()) {
      if (preset.isFallback()) continue;   // skip these ones

      for (const geometry of preset.geometries) {
        const obj = this._matchIndex.get(geometry);
        if (!obj) continue;
        const tags = preset.tags || {};
        for (const [k, v] of Object.entries(tags)) {
          obj[k] ||= {};
          (obj[k][v] = obj[k][v] || []).push(preset);
        }
      }
    }

    osmSetAreaKeys(this.areaKeys());
    osmSetPointTags(this.pointTags());
    osmSetVertexTags(this.vertexTags());

    gfx?.immediateRedraw();
    this.emit('schemachange');
  }


  /**
   * _resetAll
   * This puts SchemaSystem internal data back to its initial state.
   * i.e. nothing loaded, only fallback presets.
   * This would probably only be useful for testing, or setting up a special non-OSM Rapid.
   */
  private _resetAll(): void {
    const context = this.context;

    this.bundles.clear();
    this.presets.clear();
    this.fields.clear();
    this.categories.clear();
    this.universal.clear();
    this.defaults.clear();

    // Defaults are the Presets and Categories offered to the user when adding a new feature.
    // A fallback preset is appended to the list automatically so they dont need to be included here.
    for (const geometry of this.geometryTypes) {
      this.defaults.set(geometry, new Set());
    }

    // Create geometry fallback presets
    const point = new Preset(context, { id: 'point', name: 'Point', tags: {}, geometry: ['point', 'vertex'], matchScore: 0.1 } );
    const line = new Preset(context, { id: 'line', name: 'Line', tags: {}, geometry: ['line'], matchScore: 0.1 } );
    const area = new Preset(context, { id: 'area', name: 'Area', tags: { area: 'yes' }, geometry: ['area'], matchScore: 0.1 } );
    const relation = new Preset(context, { id: 'relation', name: 'Relation', tags: {}, geometry: ['relation'], matchScore: 0.1 } );

    this.presets.set('point', point);
    this.presets.set('line', line);
    this.presets.set('area', area);
    this.presets.set('relation', relation);

    this._schemaChanged();  // this will reset the search index too
  }

}
