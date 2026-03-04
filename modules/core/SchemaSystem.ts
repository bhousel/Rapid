import { utilArrayUniq } from '@rapid-sdk/util';
import MiniSearch from 'minisearch';

import { AbstractSystem } from './AbstractSystem.ts';
import { osmNodeGeometriesForTags, osmSetAreaKeys, osmSetDeprecatedTags, osmSetPointTags, osmSetVertexTags } from '../lib/tags.ts';
import { Category, Field, Preset, Ruleset } from '../lib/index.ts';
import { utilIterable } from '../util/iterable.ts';
import { utilExtractValues, utilWildcardDelete } from '../util/string.ts';

import type { CategoryProps } from '../lib/Category.ts';
import type { Context } from '../Context.ts';
import type { FieldProps } from '../lib/Field.ts';
import type { Graph } from '../lib/Graph.ts';
import type { HasLocationSet } from '../core/LocationSystem.ts';
import type { OsmEntity, OsmNode, Tags, Vec2 } from '../data/types.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { PresetProps } from '../lib/Preset.ts';
import type { RulesetProps } from '../lib/Ruleset.ts';

// Make very sure this resolves to Rapid's `package.json`
// If you mess up the `../`s, the resolver may import another random package.json from somewhere else.
import { dependencies as rapidDependencies } from '../../package.json' with { type: 'json' };

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


/**
 * Input format for data to merge into the SchemaSystem.
 */
export interface SchemaInput {
  /** An asset identifier, e.g. 'id-tagging-schema' (required) */
  assetID: AssetID;
  /** A string version specifier, e.g. '6.13.0' */
  assetVersion?: string;
  /** Array of scoped schema input data, each must contain a scope identifier */
  scopes?: SchemaInputScope[];
  /** Custom GeoJSON features for locationSets */
  featureCollection?: GeoJSON.FeatureCollection;
}

/**
 * Input format for a single scope of schema data.
 */
export interface SchemaInputScope {
  /** Scope identifier that this input data applies to (required - defaults to 'osm') */
  scope: ScopeID;
  /** Object mapping FieldID to Field props (or null to delete) */
  fields?: Record<FieldID, Partial<FieldProps> | null>;
  /** Object mapping PresetID to Preset props (or null to delete) */
  presets?: Record<PresetID, Partial<PresetProps> | null>;
  /** Object mapping CategoryID to Category props (or null to delete) */
  categories?: Record<CategoryID, Partial<CategoryProps> | null>;
  /** Object mapping RulesetID to Ruleset props (or null to delete) */
  rulesets?: Record<RulesetID, Partial<RulesetProps> | null>;
  /** Object mapping geometry type to array of default preset/category IDs */
  defaults?: Record<GeometryType, string[]>;

  // improve:
  deprecated?: DeprecationRule[];
  discarded?: Record<string, true>;
}

/**
 * Internal per-scope cache for loaded schema data.
 */
export interface SchemaScope {
  /** Map of FieldIDs to instantiated Fields */
  fields: Map<FieldID, Field>;
  /** Map of PresetIDs to instantiated Presets */
  presets: Map<PresetID, Preset>;
  /** Map of CategoryID to instantiated Categories */
  categories: Map<CategoryID, Category>;
  /** Map of RulesetIDs to instantiated Rulesets */
  rulesets: Map<RulesetID, Ruleset>;

  defaults: Map<GeometryType, Set<PresetID | CategoryID>>;
  universal: Map<FieldID, Field>;
  matchIndex: Map<GeometryType, Record<string, Record<string, Preset[]>>>;
  searchIndexes: Map<LocaleCode, MiniSearch>;
  currSearchIndex: MiniSearch | null;

  // improve:
  deprecated: DeprecationRule[];
  discarded: Record<string, true>;
}

/**
 * MiniSearch search result
 */
export interface SearchResult {
  id: string;
  match: Record<string, string[]>;
  queryTerms: string[];
  score: number;
  terms: string[];
  [key: string]: any;
}

/**
 * A deprecation rule describes an old tag pattern and its replacement.
 */
export interface DeprecationRule {
  /** The old tag pattern to match. Value of '*' matches any value. */
  old: Record<string, string>;
  /** Optional replacement tags */
  replace?: Record<string, string>;
}



/**
 * `SchemaSystem` maintains data and indexes of all the Categories, Presets, and Fields.
 * (This used to be called 'presets' or 'PresetSystem')
 *
 * This system is used to identify features in OpenStreetMap based on their tagging,
 * and to support user interface functions like searching for feature types and editing attributes.
 *
 * - A `Field` represents a user interface component for displaying/editing a tag or tags.
 * - A `Preset` represents a set of tags that identify a feature type. A Preset can reference multiple Fields.
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
 *   `geometryTypes`    The supported geometry types ('point', 'vertex', 'line', 'area', 'relation')
 *   `fieldTypes`       The supported field types (see also `ui/fields/index.js`)
 *   `defaultAssetIDs`  Default assetIDs that are loaded if no custom assets are requested
 *   `loadedAssetIDs`   Map<AssetID, string> - assetIDs that have been loaded (maps to version string)
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
  addablePresetIDs: Set<PresetID> | null;

  /** Default schema file assetIDs */
  private _defaultAssetIDs: Set<AssetID>;
  /** Currently loaded schema file assetIDs, maps to the version string that was loaded, if known */
  private _loadedAssetIDs: Map<AssetID, string>;
  /** Requested schema file assetIDs - optional, these can be different than the default files */
  private _requestedAssetIDs: Set<AssetID> | null;

  private _recentIDs: PresetID[] | null;

  /** Per-scope data */
  private _scopes: Map<ScopeID, SchemaScope>;

  private _currLocaleCode: LocaleCode | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'schema';
    this.optionalDependencies = new Set(['assets', 'gfx', 'l10n', 'locations', 'storage', 'urlhash']);

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

    this._scopes = new Map();    // Map<ScopeID, SchemaScope>

    // The default schema assets.
    // 'id_tagging_schema' is a "bundle" that combines multiple id_tagging_schema files.
    // 'rapid_schema' is Rapid's customizations to merge in after.
    this._defaultAssetIDs = new Set(['id_tagging_schema', 'osm_rulesets', 'rapid_schema']);
    this._loadedAssetIDs = new Map();
    this._requestedAssetIDs = null;
    this._recentIDs = null;
    this._currLocaleCode = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
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
        urlhash?.on('hashchange', this._hashChanged);
        l10n?.on('localechange', this._localeChanged);

        // If we received a subset of addable presetIDs specified in the url hash, save them.
        const presetIDs = urlhash?.initialHashParams.get('presets') || '';
        if (presetIDs) {
          const vals = utilExtractValues(presetIDs, /[,;|]/).filter(Boolean);  // allow '/' in PresetIDs
          this.addablePresetIDs = new Set(vals);
        }

        // If AssetSystem is available, tell it about default schema files and load them.
        // Without AssetSystem, we'll just have the fallback presets (point, line, area, relation).
        if (assets) {
          this._registerDefaultAssets();
          return this.loadSchemaAssetsAsync();
        } else {
          this.resetAll();  // Set up fallback presets
          return Promise.resolve();
        }
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
   * loadSchemaAssetsAsync
   * @return Promise fulfilled when the schema assets have been loaded
   */
  loadSchemaAssetsAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets;
const gfx = context.systems.gfx;
const unpause = gfx?.pause();  // block rendering

    // Clear out whatever was loaded before.
    this.resetAll();

    // If AssetSystem is not available, we can't load schema files.
    // resetAll() has already set up the fallback presets (point, line, area, relation).
    if (!assets) {
      return Promise.resolve();
    }

    // Load the schema files
    const which = this._requestedAssetIDs ?? this._defaultAssetIDs;
    const assetIDs = [...which];

    // Type guard, see https://stackoverflow.com/a/73913774/7620
    const isFulfilled = <T,>(p:PromiseSettledResult<T>): p is PromiseFulfilledResult<T> => p.status === 'fulfilled';
    const isRejected = <T,>(p:PromiseSettledResult<T>): p is PromiseRejectedResult => p.status === 'rejected';

    return Promise.allSettled(
      assetIDs.map(assetID => assets.loadAssetAsync(assetID))
    )
    .then(results => {
      // Determine a version for id-tagging-schema...
      // This might not be exact because the CDN can return a newer semver patch.
      // But it's close enough, and this version string is informational only.
      let idSchemaVersion = 'unknown';
      for (const [k, semver] of Object.entries(rapidDependencies)) {
        if (/id-tagging-schema$/.test(k)) {
          idSchemaVersion = semver;
          break;
        }
      }

      // Process the loaded data
      const fulfilledValues = results.filter(isFulfilled).map(p => p.value);
      for (const value of fulfilledValues as Record<string, any>[]) {
        let schemaInput: SchemaInput;

        if (value.assetID === 'id_tagging_schema') {
          // The bundle returns flat parts (fields, presets, categories, defaults, deprecated, discarded).
          // Wrap the schema parts into scoped format for merge().
          schemaInput = {
            assetID: value.assetID as AssetID,
            assetVersion: value.assetVersion ?? idSchemaVersion,
            scopes: [{
              scope: 'osm',
              fields: value.fields,
              presets: value.presets,
              categories: value.categories,
              defaults: value.defaults,
              deprecated: value.deprecated,
              discarded: value.discarded
            }],
          };
        } else {
          // Other assets (e.g. 'rapid_schema') are already in scoped format
          schemaInput = value as SchemaInput;
          if (schemaInput.assetID === 'rapid_schema') {
            schemaInput.assetVersion ||= context.version;
          }
        }
        this.merge(schemaInput);
      }

      const rejectedReasons = results.filter(isRejected).map(p => p.reason);
      for (const reason of rejectedReasons as string[]) {
        console.error(reason);   // eslint-disable-line no-console
      }
  unpause?.();  // resume rendering

    });
  }


  /**
   * resetAll
   * This puts the SchemaSystem internal data back to its initial state.
   * i.e. nothing loaded, only fallback presets.
   */
  resetAll(): void {
    const context = this.context;

    this._loadedAssetIDs.clear();
    this._scopes.clear();
    this._currLocaleCode = null;


// HACK for demo
const storage = context.systems.storage as any;
this._recentIDs = [];
storage?.setItem('preset_recents', JSON.stringify(this._recentIDs));

// clear all entities cached transients
const editor = context.systems.editor as any;
if (editor) {
  const base = editor.base?.graph;
  if (base) {
    for (const [_, v] of base.base.entities) {
      if (!v) continue;
      v.updateGeometry(base);
    }
  }

  const staging = editor.staging?.graph;
  if (staging) {
    for (const [_, v] of staging.local.entities) {
      if (!v) continue;
      v.updateGeometry(staging);
    }
  }

  const history = editor._history || [];
  for (const edit of history) {
    const graph = edit.graph;
    if (graph) {
      for (const [_, v] of graph.local.entities) {
        if (!v) continue;
        v.updateGeometry(graph);
      }
    }
  }
}
const gfx = context.systems.gfx as any;
gfx?.scene?.reset();  // throw it all away

    // Create the '*' common scope with geometry fallback presets.
    // Items in the common scope are always available.
    const common = this.getScope('*');

    const point = new Preset(context, {
      id: 'point', scopeID: '*', name: 'Point', tags: {}, geometry: ['point', 'vertex'], matchScore: 0.1
    });
    const line = new Preset(context, {
      id: 'line', scopeID: '*', name: 'Line', tags: {}, geometry: ['line'], matchScore: 0.1
    });
    const area = new Preset(context, {
      id: 'area', scopeID: '*', name: 'Area', tags: { area: 'yes' }, geometry: ['area'], matchScore: 0.1
    });
    const relation = new Preset(context, {
      id: 'relation', scopeID: '*', name: 'Relation', tags: {}, geometry: ['relation'], matchScore: 0.1
    });

    common.presets.set('point', point);
    common.presets.set('line', line);
    common.presets.set('area', area);
    common.presets.set('relation', relation);

    this._schemaChanged();  // this will reset the search index too
  }


  /**
   * defaultAssetIDs
   * Returns the default assetIDs. These are the schema assets that Rapid will load by default.
   * @return  Default assetIDs
   * @readonly
   */
  get defaultAssetIDs(): Set<AssetID> {
    return this._defaultAssetIDs;
  }

  /**
   * loadedAssetIDs
   * Returns the loaded assetIDs, along with their version numbers if known.
   * @return  Loaded assetIDs
   * @readonly
   */
  get loadedAssetIDs(): Map<AssetID, string> {
    return this._loadedAssetIDs;
  }

  /**
   * requestedAssetIDs
   * Allows user to request different schema asset files than what Rapid uses by default.
   *
   * If set before init time, these assets will be loaded at init time when init calls `loadSchemaAssetsAsync`.
   * You can also change this after init time, but then you'll need to call `loadSchemaAssetsAsync` again.
   *
   * The 'default' keyword is special - if found in the list, it will expand to all the default IDs.
   *
   * You can set `requestedAssetIDs` to an empty list ''.  In this case, subsequent calls to
   *   `loadSchemaAssetsAsync` will load nothing, you'll have only the fallback presets.
   * You can also pass `null` - in this case the `requestedAssetIDs` list is not used,
   *   and subsequent calls to `loadSchemaAssetsAsync` will use the `defaultAssetIDs` Set.
   * @param vals - A `string`, `Array<string>` or `Set<string>` of assetIDs to load (or `null` to disable)
   */
  set requestedAssetIDs(vals: OneOrMore<AssetID> | null) {
    if (vals === null || vals === undefined) {
      this._requestedAssetIDs = null;
      return;
    }

    this._requestedAssetIDs = new Set();
    for (const assetID of utilIterable(vals)) {
      if (!assetID) continue;
      if (assetID === 'default') {
        for (const defaultID of this._defaultAssetIDs) {
          this._requestedAssetIDs.add(defaultID);
        }
      } else {
        this._requestedAssetIDs.add(assetID);
      }
    }
  }
  get requestedAssetIDs(): Set<AssetID> | null {
    return this._requestedAssetIDs;
  }


  /**
   * merge
   * Accepts schema data in scoped format:
   * ```
   * {
   *   assetID: '',       // A string asset identifier, e.g. 'rapid_schema'
   *   assetVersion: '',  // A string version specifier, e.g. '1.0.0'  (defaults to 'unknown' if not present)
   *   scopes: [{
   *     scope: 'osm',        // A string identifier, which scope these declarations apply to.
   *     fields: { … },       // Object<FieldID, Partial<FieldProps>>
   *     presets: { … },      // Object<PresetID, Partial<PresetProps>>
   *     categories: { … },   // Object<CategoryID, Partial<CategoryProps>>
   *     defaults: { … },
   *     deprecated: { … },
   *     discarded: { … },
   *   }],
   *   featureCollection: { … }    // optional, for locationSets
   * }
   * ```
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
   * @param  input - schema data to merge into the SchemaSystem
   * @throws  Will throw if given data does not contain a `assetID`, or if the `assetID` has already been merged
   */
  merge(input: SchemaInput): void {
    const context = this.context;
    const locations = context.systems.locations;

    const assetID = input.assetID;
    const assetVersion = input.assetVersion ?? 'unknown';

    if (!assetID) {
      throw new Error('Schema missing assetID property');
    }
    if (this._loadedAssetIDs.has(assetID)) {
      throw new Error(`Schema "${assetID}" already merged`);
    }

    this._loadedAssetIDs.set(assetID, assetVersion);

    const inputScopes: SchemaInputScope[] = input.scopes ?? [];
    const checkLocationSets: HasLocationSet[] = [];

    // Process each scope
    for (const inputScope of inputScopes) {
      const scopeID = inputScope.scope ?? 'osm';

      // Get or create a data cache for this scopeID
      const scope = this.getScope(scopeID);

      // Merge Fields
      if (inputScope.fields) {
        for (const [fieldID, props] of Object.entries(inputScope.fields)) {
          const existing = scope.fields.get(fieldID);
          if (existing?.isBuiltin()) continue;  // don't override a builtin Field

          if (props) {   // add or replace
            if (!this.fieldTypes.has(props.type as FieldType)) {
              if (VERBOSE) console.warn(`"${props.type}" type not supported for ${fieldID}`);  // eslint-disable-line no-console
              continue;
            }
            const setProps = { ...props, id: fieldID, assetID, assetVersion, scopeID } as Partial<FieldProps>;
            const field = new Field(context, setProps);
            if (field.props.locationSet) {
              checkLocationSets.push(field.props);
            }
            scope.fields.set(fieldID, field);

          } else {   // remove
            utilWildcardDelete(scope.fields, fieldID);
          }
        }
      }

      // Merge Presets
      if (inputScope.presets) {
        for (const [presetID, props] of Object.entries(inputScope.presets)) {
          const existing = scope.presets.get(presetID);
          if (existing?.isBuiltin()) continue;  // don't override a builtin Preset

          if (props) {   // add or replace
            // Rename icon identifiers to match the rapid spritesheet
            if (props.icon)  props.icon = props.icon.replace(/^iD-/, 'rapid-');

            // A few overrides to use better icons than the ones provided by the id-tagging-schema project
            if (presetID === 'address')                        props.icon = 'maki-circle-stroked';
            if (presetID === 'highway/turning_loop')           props.icon = 'maki-circle';
            if (props.icon === 'roentgen-needleleaved_tree')   props.icon = 'temaki-tree_needleleaved';
            if (props.icon === 'roentgen-tree')                props.icon = 'temaki-tree_broadleaved';
            // fix: FontAwesome v7 no longer has 'fas-vector-square'
            // see https://github.com/openstreetmap/id-tagging-schema/pull/1707 and previous
            if (props.icon === 'fas-vector-square')            props.icon = 'temaki-portrait_framed';

            const setProps = { ...props, id: presetID, assetID, assetVersion, scopeID } as Partial<PresetProps>;
            const preset = new Preset(context, setProps);
            if (preset.props.locationSet) {
              checkLocationSets.push(preset.props);
            }
            scope.presets.set(presetID, preset);

          } else {   // remove
            utilWildcardDelete(scope.presets, presetID);
          }
        }
      }

      // Merge Categories
      if (inputScope.categories) {
        for (const [categoryID, props] of Object.entries(inputScope.categories)) {
          const existing = scope.categories.get(categoryID);
          if (existing?.isBuiltin()) continue;  // don't override a builtin Category

          if (props) {   // add or replace
            // Rename icon identifiers to match the rapid spritesheet
            if (props.icon)  props.icon = props.icon.replace(/^iD-/, 'rapid-');

            const setProps = { ...props, id: categoryID, assetID, assetVersion, scopeID } as Partial<CategoryProps>;
            const category = new Category(context, setProps);
            if (category.props.locationSet) {
              checkLocationSets.push(category.props);
            }
            scope.categories.set(categoryID, category);

          } else {   // remove
            utilWildcardDelete(scope.categories, categoryID);
          }
        }
      }

      // Merge Defaults into per-scope map
      if (inputScope.defaults) {
        for (const [geometry, itemIDs] of Object.entries(inputScope.defaults)) {
          if (!this.geometryTypes.has(geometry as GeometryType)) continue;

          let defaultIDs = scope.defaults.get(geometry as GeometryType);
          if (!defaultIDs) {
            defaultIDs = new Set();
            scope.defaults.set(geometry as GeometryType, defaultIDs);
          }

          const newIDs = Array.isArray(itemIDs) ? itemIDs : [];
          for (const newID of newIDs) {
            if (!newID || this.geometryTypes.has(newID as GeometryType)) continue;  // skip if empty or fallback
            defaultIDs.add(newID);
          }
        }
      }

      // TODO:  These just do simple overwrites right now
      // Merge deprecated
      if (inputScope.deprecated) {
        scope.deprecated = inputScope.deprecated;
      }
      // Merge discarded
      if (inputScope.discarded) {
        scope.discarded = inputScope.discarded;
      }

      // Merge Rulesets
      if (inputScope.rulesets) {
        for (const [rulesetID, props] of Object.entries(inputScope.rulesets)) {
          if (props) {   // add or replace
            const setProps = { ...props, id: rulesetID, assetID, assetVersion, scopeID } as Partial<RulesetProps>;
            const ruleset = new Ruleset(context, setProps);
            scope.rulesets.set(rulesetID, ruleset);

          } else {   // remove
            utilWildcardDelete(scope.rulesets, rulesetID);
          }
        }
      }
    }

    if (locations) {
      // Merge Custom Features
      if (input.featureCollection && Array.isArray(input.featureCollection.features)) {
        locations.mergeCustomGeoJSON(input.featureCollection);
      }

      // Resolve all locationSet features.
      if (checkLocationSets.length) {
        locations.mergeLocationSets(checkLocationSets);
      }
    }

    this._schemaChanged();
  }


  /**
   * getScope
   * Get the scope data for a specific scope ID.
   * If the scope doesn't exist yet, it is created and cached automatically.
   * @param scopeID - ID of the scope to look up
   * @return The scope data
   */
  getScope(scopeID: ScopeID): SchemaScope {
    let scope = this._scopes.get(scopeID);
    if (!scope) {
      // Doesn't exist yet - create.
      scope = {
        fields: new Map(),
        presets: new Map(),
        categories: new Map(),
        defaults: new Map(),
        universal: new Map(),
        rulesets: new Map(),
        matchIndex: new Map(),
        searchIndexes: new Map(),
        currSearchIndex: null,

        // improve
        deprecated: [],
        discarded: {}
      };

      // Initialize per-geometry caches
      for (const geometry of this.geometryTypes) {
        scope.defaults.set(geometry, new Set());
        scope.matchIndex.set(geometry, {});
      }

      this._scopes.set(scopeID, scope);
    }
    return scope;
  }


  /**
   * search
   * Performs a full-text search across Presets and Categories for a given scope.
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
   * @param   scopeID - Scope to search in (defaults to 'osm')
   * @return  A Minisearch `SearchResult`, containing the score and information about the match
   * @throws  Will throw if the search index is not ready
   */
  search(
    query: string = '',
    geometries: GeometryType | GeometryType[] = [],
    loc: Vec2 | null = null,
    scopeID: ScopeID = 'osm'
  ): SearchResult[] {
    const scope = this.getScope(scopeID);
    if (!scope.currSearchIndex) {   // shouldn't happen
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
      const item = scope.presets.get(result.id) ?? scope.categories.get(result.id);
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
    const exactResults = scope.currSearchIndex.search(query, {
      boost: { primary: 20, alternate: 10 },
      boostDocument: _boostDocument,
      combineWith: 'AND',
      filter: _filter,
      fuzzy: false,   // no fuzzy (match strings with nearby edit distance)
      prefix: false   // no prefix (partial match beginning of a string)
    }) as SearchResult[];

    const fuzzyResults = scope.currSearchIndex.search(query, {
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
      if (geometry === 'vertex' && (entity as OsmNode).isOnAddressLine?.(graph)) {
        geometry = 'point';
      }
      const entityExtent = entity.extent();
      return this.matchTags(entity.tags, geometry, entityExtent?.center());
    });
  }


  /**
   * matchTags
   * @param   tags
   * @param   geometry
   * @param   loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @param   loc - `[lon,lat]` location to query, e.g. `[-74.4813, 40.7967]`
   * @param   scopeID - Scope to match in (defaults to 'osm')
   * @return  Preset that best matches
   */
  matchTags(tags: Tags, geometry: GeometryType, loc?: Vec2, scopeID: ScopeID = 'osm'): Preset | null {
    const context = this.context;
    const locations = context.systems.locations;

    const scope = this.getScope(scopeID);

    const keyIndex = scope.matchIndex.get(geometry);
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

    return bestMatch || this.getFallback(geometry, scopeID) || null;
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
   * @param   scopeID - Scope to query (defaults to 'osm')
   * @returns  areaKeys Object
   */
  areaKeys(scopeID: ScopeID = 'osm'): Record<string, Record<string, boolean>> {
    const scope = this.getScope(scopeID);

    // The ignore list is for keys that imply lines. (We always add `area=yes` for exceptions)
    const ignore = new Set(['barrier', 'highway', 'footway', 'railway', 'junction', 'type']);
    const areaKeys: Record<string, Record<string, boolean>> = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...scope.presets.values()]
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


  /**
   * pointTags
   */
  pointTags(scopeID: ScopeID = 'osm'): Record<string, Record<string, boolean>> {
    const scope = this.getScope(scopeID);

    const pointTags: Record<string, Record<string, boolean>> = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...scope.presets.values()]
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


  /**
   * vertexTags
   */
  vertexTags(scopeID: ScopeID = 'osm'): Record<string, Record<string, boolean>> {
    const scope = this.getScope(scopeID);

    const vertexTags: Record<string, Record<string, boolean>> = {};

    // ignore name-suggestion-index and deprecated presets
    const presets = [...scope.presets.values()]
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
   * @param   scopeID - Scope to query (defaults to 'osm')
   * @return  The fallback preset, or `undefined` if not found
   */
  getFallback(geometry: GeometryType, scopeID: ScopeID = 'osm'): Preset | undefined {
    if (geometry === 'vertex') {
      geometry = 'point';
    }
    return this.getScope(scopeID).presets.get(geometry)
      ?? this.getScope('*').presets.get(geometry);
  }


  /**
   * getDefaults
   * Defaults are the Presets and Categories offered to the user when adding a new feature.
   * Each geometry type has its own set of defaults.
   * The fallback preset for the given geometry is appended to the list automatically.
   * @param   geometry
   * @param   includeRecents - `true` to start with recently used presets
   * @param   loc - WGS84 [lon,lat] where we are editing
   * @param   scopeID - Scope to query (defaults to 'osm')
   * @return  Array of Categories and Presets
   */
  getDefaults(
    geometry: GeometryType,
    includeRecents: boolean = true,
    loc: Vec2 | null = null,
    scopeID: ScopeID = 'osm'
  ): Array<Category | Preset> {
    if (!geometry) return [];

    const context = this.context;
    const locations = context.systems.locations;
    const scope = this.getScope(scopeID);

    const results = new Map<string, Category | Preset>();   // Map<itemID, item>  (may be a Preset or a Category)

    if (includeRecents) {
      for (const preset of this.getRecents(scopeID)) {
        if (results.size < MAXRECENTS_SHOW && preset.geometries.has(geometry)) {
          results.set(preset.id, preset);
        }
      }
    }

    // If there is a set of addable presetIDs, use that instead of defaults
    if (this.addablePresetIDs instanceof Set) {
      for (const itemID of this.addablePresetIDs) {
        const item = scope.presets.get(itemID) ?? scope.categories.get(itemID);
        if (item?.geometries.has(geometry)) {
          results.set(itemID, item);
        }
      }
    } else {
      const itemIDs = scope.defaults.get(geometry);
      if (itemIDs) {
        for (const itemID of itemIDs) {
          const item = scope.presets.get(itemID) ?? scope.categories.get(itemID);
          if (item?.geometries.has(geometry)) {
            results.set(itemID, item);
          }
        }
      }
    }

    const fallback = this.getFallback(geometry, scopeID);
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
   * @param   scopeID - Scope to query (defaults to 'osm')
   * @return  An Array of recent presets
   */
  getRecents(scopeID: ScopeID = 'osm'): Preset[] {
    const context = this.context;
    const storage = context.systems.storage;
    const scope = this.getScope(scopeID);

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
        return scope.presets.get(id);
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
   * _registerDefaultAssets
   * Tell the AssetSystem where to find the default schema files.
   * This is called during initAsync before loading the assets.
   */
  private _registerDefaultAssets(): void {
    const assets = this.context.systems.assets!;

    // Tell the AssetSystem what to load..
    const latestPath = 'https://cdn.jsdelivr.net/npm/@openstreetmap/id-tagging-schema@6.6/dist';
    const localPath = 'data/modules/id-tagging-schema';

    // Register id_schema as a bundle - multiple files fetched together
    assets.registerBundleAsset('id_tagging_schema', {
      categories: {
        latest: `${latestPath}/preset_categories.min.json`,
        local:  `${localPath}/preset_categories.min.json`
      },
      defaults: {
        latest: `${latestPath}/preset_defaults.min.json`,
        local:  `${localPath}/preset_defaults.min.json`
      },
      presets: {
        latest: `${latestPath}/presets.min.json`,
        local:  `${localPath}/presets.min.json`
      },
      fields: {
        latest: `${latestPath}/fields.min.json`,
        local:  `${localPath}/fields.min.json`
      },
      deprecated: {
        latest: `${latestPath}/deprecated.min.json`,
        local: `${localPath}/deprecated.min.json`
      },
      discarded: {
        latest: `${latestPath}/discarded.min.json`,
        local: `${localPath}/discarded.min.json`
      }
    });

    // 'osm_rulesets' = tag classification rulesets for OSM data
    assets.registerAsset('osm_rulesets', {
      preferred: 'data/osm_rulesets.min.json5'
    });

    // 'rapid_schema' = customizations to merge in after the id-tagging-schema
    assets.registerAsset('rapid_schema', {
      preferred: 'data/rapid_schema.min.json5'
    });
  }


  /**
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // schema
    // AssetIDs to request, e.g. `schema=default,my_presets`
    const newSchema = currParams.get('schema');
    const oldSchema = prevParams.get('schema');
    if (newSchema !== oldSchema) {
      if (typeof newSchema === 'string') {
        this.requestedAssetIDs = utilExtractValues(newSchema).filter(Boolean);
      } else {
        this.requestedAssetIDs = null;
      }
      this.loadSchemaAssetsAsync();
    }
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

    // Re-localize the Category, Preset, Field strings across all scopes.
    for (const scope of this._scopes.values()) {
      for (const field of scope.fields.values()) {
        field.setLocale(localeCode);
      }
      for (const preset of scope.presets.values()) {
        preset.setLocale(localeCode);
      }
      for (const category of scope.categories.values()) {
        category.setLocale(localeCode);
      }
    }

    this._prepareSearchIndex();
  }


  /**
   * _prepareSearchIndex
   * Prepares a MiniSearch index for the current locale code, per scope.
   * These are cached, so switching back to an already-seen locale should be fast.
   */
  private _prepareSearchIndex(): void {
    const l10n = this.context.systems.l10n;

    // Ensure that we have a current locale code.
    this._currLocaleCode ||= l10n?.localeCode || 'en-US';

    // Prepare/switch search index for each scope
    for (const scope of this._scopes.values()) {
      scope.currSearchIndex = scope.searchIndexes.get(this._currLocaleCode) ?? null;

      if (!scope.currSearchIndex) {
        scope.currSearchIndex = new MiniSearch({
          autoVacuum: false,
          idField: 'id',
          fields: ['primary', 'alternate'],
          storeFields: ['type', 'suggestion'],
          extractField: (item: any, fieldName: string) => item._currStrings[fieldName]
        });

        scope.searchIndexes.set(this._currLocaleCode, scope.currSearchIndex);
        this._rebuildSearchIndex(scope);
      }
    }
  }


  /**
   * _rebuildSearchIndex
   * Rebuild the MiniSearch full-text search index for a given scope.
   * This happens when we switch to a new search index for the first time.
   * This may be a bit slow, so consider making this async.
   * @param scope - The scope to rebuild the search index for
   */
  private _rebuildSearchIndex(scope: SchemaScope): void {
    if (!scope.currSearchIndex) {
      this._prepareSearchIndex();  // sets up currSearchIndex for all scopes
    }
    if (!scope.currSearchIndex) return;  // still null — bail

    scope.currSearchIndex.removeAll();

    for (const preset of scope.presets.values()) {
      if (!preset.props.searchable) continue;
      scope.currSearchIndex.add(preset);
    }
    for (const category of scope.categories.values()) {
      if (!category.props.searchable) continue;
      scope.currSearchIndex.add(category);
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
    const gfx = context.systems.gfx;

    // Reset and rebuild per-scope derived data
    for (const scope of this._scopes.values()) {
      // Reset the Category, Preset, Field cached data
      for (const field of scope.fields.values()) {
        field.reset();
      }
      for (const preset of scope.presets.values()) {
        preset.reset();
      }
      for (const category of scope.categories.values()) {
        category.reset();
      }

      // Reset search indexes for this scope
      scope.searchIndexes.clear();
      scope.currSearchIndex = null;

      // Gather "universal" fields
      scope.universal.clear();
      for (const field of scope.fields.values()) {
        if (field.props.universal) {
          scope.universal.set(field.id, field);
        }
      }

      // Rebuild geometry match index
      scope.matchIndex.clear();
      for (const geometry of this.geometryTypes) {
        scope.matchIndex.set(geometry, {});
      }
      for (const preset of scope.presets.values()) {
        if (preset.isFallback()) continue;   // skip these ones

        for (const geometry of preset.geometries) {
          const obj = scope.matchIndex.get(geometry);
          if (!obj) continue;
          const tags = preset.tags || {};
          for (const [k, v] of Object.entries(tags)) {
            obj[k] ||= {};
            (obj[k][v] = obj[k][v] || []).push(preset);
          }
        }
      }
    }

    // Prepare search indexes
    this._prepareSearchIndex();

    // Update OSM-specific global state from the 'osm' scope
    osmSetAreaKeys(this.areaKeys());
    osmSetPointTags(this.pointTags());
    osmSetVertexTags(this.vertexTags());

    gfx?.immediateRedraw();
    this.emit('schemachange');
  }

}
