import { merge as deepMerge } from 'lodash-es';
import { AbstractSystem } from './AbstractSystem.ts';
import { Style, styleDefaults } from '../lib/Style.ts';
import { StyleSelector } from '../lib/StyleSelector.ts';
import { Variable } from '../lib/Variable.ts';
import { utilIterable } from '../util/iterable.ts';
import { utilExtractValues, utilWildcardDelete } from '../util/string.ts';

import type { Context } from '../Context.ts';
import type { OsmTags } from '../data/types.ts';
import type { StyleProps, FillStyleProps, LineStyleProps, PointStyleProps, LabelStyleProps, ViewfieldStyleProps } from '../lib/Style.ts';
import type { StyleSelectorProps } from '../lib/StyleSelector.ts';
import type { VariableValue, VariableProps } from '../lib/Variable.ts';
import type { OneOrMore } from '../util/iterable.ts';


/** Style Groups supported by the style system */
export type StyleGroup =
  | 'base' | 'fill' | 'casing' | 'stroke' | 'marker' | 'icon'
  | 'viewfield' | 'lineMarker' | 'sidedMarker' | 'label';

/**
 * Input format for data to merge into the StyleSystem.
 */
export interface StyleInput {
  /** An asset identifier, e.g. 'rapid_style' (required) */
  assetID: AssetID;
  /** A string version specifier, e.g. '1.0.0' */
  assetVersion?: string;
  /** Array of scoped style input data, each must contain a scope identifier */
  scopes?: StyleInputScope[];
}

/**
 * Input format for a single scope of style data.
 */
export interface StyleInputScope {
  /** Scope identifier that this input data applies to (required - defaults to 'osm') */
  scope: ScopeID;
  /** Object mapping VariableID to Variable value (or null to delete) */
  variables?: Record<VariableID, VariableValue | null>;
  /** Object mapping StyleID to Style props (or null to delete) */
  styles?: Record<StyleID, Partial<StyleProps> | null>;
  /** Object mapping StyleSelectorID to StyleSelector props (or null to delete) */
  selectors?: Record<StyleSelectorID, Partial<StyleSelectorProps> | null>;
}

/**
 * Internal per-scope storage for loaded style data.
 */
export interface StyleScope {
  /** Map of VariableIDs to instantiated Variables */
  variables: Map<VariableID, Variable>;
  /** Map of StyleIDs to instantiated Styles */
  styles: Map<StyleID, Style>;
  /** Map of StyleSelectorIDs to instantiated StyleSelectors */
  selectors: Map<StyleSelectorID, StyleSelector>;
}

/**
 * The resolved style object returned by styleMatch.
 */
export interface MatchedStyle {
  fill: FillStyleProps;
  casing: LineStyleProps;
  stroke: LineStyleProps;
  marker: PointStyleProps;
  icon: PointStyleProps;
  viewfield: ViewfieldStyleProps;
  lineMarker?: PointStyleProps;
  sidedMarker?: PointStyleProps;
  label: LabelStyleProps;
  /** Extra properties are allowed for backward compatibility with PixiFeature styles */
  [key: string]: unknown;
}


/**
 * getTag
 * Returns the value of the tag, but ignores 'no' values.
 * @param tags - OSM tags object
 * @param key - Tag key to look up
 * @return Tag value, or undefined if not present or 'no'
 */
function getTag(tags: OsmTags, key: string): string | undefined {
  return tags[key] === 'no' ? undefined : tags[key];
}


/**
 * `StyleSystem` maintains the rules about how map data should look.
 *
 * The style system uses a `Style` + `StyleSelector` architecture:
 * - A `Style` defines visual properties (fill color, stroke width, dash patterns, etc.)
 * - A `StyleSelector` defines *when* a style applies, using tag-matching conditions
 *   with AND semantics (all conditions must match). Each selector references one or more
 *   `styleIDs` to apply.
 * - A `Variable` is a named value list that can be referenced from Styles and Selectors
 *   via `var()` syntax, allowing shared values to be defined once.
 *
 * **Scoped Architecture:**
 * Data is organized into scopes (e.g. 'osm', '*'). Each scope has its own Styles,
 * Selectors, and Variables. When matching, the system falls back from the requested scope
 * to the '*' common scope. Data is loaded via `merge()`, which accepts scoped input and
 * processes Variables before Styles/Selectors (since they may contain `var()` references).
 *
 * **Style Matching (`styleMatch`):**
 * All matching selectors are collected and sorted by specificity (more conditions = higher
 * specificity). Styles from matching selectors are deep-merged in order of increasing
 * specificity, so more specific selectors override less specific ones.
 *
 * **Default assets loaded at init time:**
 * - `rapid_style` — Style declarations, selectors, and variables (from `data/rapid_style.json5`)
 *
 * Custom style data can be merged in to supplement or override the defaults.
 *
 * Properties available:
 *   `defaultAssetIDs`  Default assetIDs that are loaded if no custom assets are requested
 *   `loadedAssetIDs`   Map<AssetID, string> - assetIDs that have been loaded (maps to version string)
 *
 * Events available:
 *   `stylechange`  Fires on any change in style
 */
export class StyleSystem extends AbstractSystem {
  /** The supported style groups */
  readonly styleGroups: Set<StyleGroup>;

  /** Protanopia color blindness simulation matrix */
  protanopiaMatrix: number[];
  /** Deuteranopia color blindness simulation matrix */
  deuteranopiaMatrix: number[];
  /** Tritanopia color blindness simulation matrix */
  tritanopiaMatrix: number[];

  /** Per-scope storage */
  private _scopes: Map<ScopeID, StyleScope>;
  /** List of supported pattern IDs (hardcoded, must match patterns loaded by PixiTextures) */
  patternIDs: Set<string>;

  /** Default style file assetIDs */
  private _defaultAssetIDs: Set<AssetID>;
  /** Currently loaded style file assetIDs, maps to the version string that was loaded, if known */
  private _loadedAssetIDs: Map<AssetID, string>;
  /** Requested style file assetIDs - optional, these can be different than the default files */
  private _requestedAssetIDs: Set<AssetID> | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'styles';
    this.optionalDependencies = new Set(['assets', 'gfx', 'schema', 'urlhash']);

    this._scopes = new Map();

    this._defaultAssetIDs = new Set(['rapid_style']);
    this._loadedAssetIDs = new Map();
    this._requestedAssetIDs = null;

    this.styleGroups = new Set([
      'base', 'fill', 'casing', 'stroke', 'marker', 'icon',
      'viewfield', 'lineMarker', 'sidedMarker', 'label'] as StyleGroup[]
    );

    // Pattern IDs - hardcoded list that must match the patterns loaded by PixiTextures.
    // (Maybe we will make this dynamic someday, but for now it stays in code.)
    this.patternIDs = new Set([
      'bushes', 'cemetery', 'cemetery_buddhist', 'cemetery_christian', 'cemetery_jewish', 'cemetery_muslim',
      'construction', 'dots', 'farmland', 'farmyard', 'forest', 'forest_broadleaved', 'forest_leafless',
      'forest_needleleaved', 'grass', 'landfill', 'lines', 'orchard', 'pond', 'quarry', 'vineyard',
      'waves', 'wetland', 'wetland_bog', 'wetland_marsh', 'wetland_reedbed', 'wetland_swamp'
    ]);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.styleMatch = this.styleMatch.bind(this);
    this._hashChanged = this._hashChanged.bind(this);
    this._styleChanged = this._styleChanged.bind(this);

    // Experiment, see Rapid#1230
    // matrix values from https://github.com/maputnik/editor
    this.protanopiaMatrix = [
      0.567,  0.433,  0,     0,  0,
      0.558,  0.442,  0,     0,  0,
      0,      0.242,  0.758, 0,  0,
      0,      0,      0,     1,  0
    ];

    this.deuteranopiaMatrix = [
      0.625,  0.375,  0,     0,  0,
      0.7,    0.3,    0,     0,  0,
      0,      0.3,    0.7,   0,  0,
      0,      0,      0,     1,  0
    ];

    this.tritanopiaMatrix = [
      0.95,   0.05,   0,     0,  0,
      0,      0.433,  0.567, 0,  0,
      0,      0.475,  0.525, 0,  0,
      0,      0,      0,     1,  0
    ];
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup event handlers..
        urlhash?.on('hashchange', this._hashChanged);

        // If AssetSystem is available, tell it about default style files and load them.
        // Without AssetSystem, we'll just have empty styles.
        if (assets) {
          assets.registerAsset('rapid_style', { preferred: 'data/rapid_style.min.json5' });
          return this.loadStyleAssetsAsync();
        } else {
          this.resetAll();
          return Promise.resolve();
        }
      });
  }

  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * loadStyleAssetsAsync
   * @return Promise fulfilled when the style assets have been loaded
   */
  loadStyleAssetsAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets;
    const gfx = context.systems.gfx;

    // Clear out whatever was loaded before.
    this.resetAll();

    // If AssetSystem is not available, we can't load style files.
    // resetAll() has already set up empty maps.
    if (!assets) {
      return Promise.resolve();
    }

    const unpause = gfx?.pause();  // block rendering

    // Load the style files
    const which = this._requestedAssetIDs ?? this._defaultAssetIDs;
    const assetIDs = [...which];

    // Type guard, see https://stackoverflow.com/a/73913774/7620
    const isFulfilled = <T,>(p:PromiseSettledResult<T>): p is PromiseFulfilledResult<T> => p.status === 'fulfilled';
    const isRejected = <T,>(p:PromiseSettledResult<T>): p is PromiseRejectedResult => p.status === 'rejected';

    return Promise.allSettled(
      assetIDs.map(assetID => assets.loadAssetAsync(assetID))
    )
    .then(results => {
      // Process the loaded data
      const fulfilledValues = results.filter(isFulfilled).map(p => p.value);
      for (const value of fulfilledValues as StyleInput[]) {
        if (value.assetID === 'rapid_style') {
          value.assetVersion ||= context.version;
        }
        this.merge(value);
      }

      for (const result of results) {
        if (isRejected(result)) {
          console.error(result.reason);  // eslint-disable-line no-console
        }
      }

      this._styleChanged();
    })
    .finally(() => {
      unpause?.();  // resume rendering
      gfx?.scene?.reset();  // throw it all away
    });

  }


  /**
   * resetAll
   * This puts the StyleSystem internal data back to its initial state, i.e. no styles.
   */
  resetAll(): void {
    this._loadedAssetIDs.clear();
    this._scopes.clear();

    this._styleChanged();
  }


  /**
   * defaultAssetIDs
   * Returns the default assetIDs. These are the style assets that Rapid will load by default.
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
   * Allows user to request different style asset files than what Rapid uses by default.
   *
   * If set before init time, these assets will be loaded at init time when init calls `loadStyleAssetsAsync`.
   * You can also change this after init time, but then you'll need to call `loadStyleAssetsAsync` again.
   *
   * The 'default' keyword is special - if found in the list, it will expand to all the default IDs.
   *
   * You can set `requestedAssetIDs` to an empty list ''.  In this case, subsequent calls to
   *   `loadStyleAssetsAsync` will load nothing, you'll have only empty styles.
   * You can also pass `null` - in this case the `requestedAssetIDs` list is not used,
   *   and subsequent calls to `loadStyleAssetsAsync` will use the `defaultAssetIDs` Set.
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
   * Accepts an object containing new style data in scoped format:
   * {
   *   assetID: '',       // A string asset identifier, e.g. 'rapid_style'
   *   assetVersion: '',  // A string version specifier, e.g. '1.0.0'  (defaults to 'unknown' if not present)
   *   scopes: [{
   *     scope: 'osm',       // A string identifier, which scope these declarations apply to.
   *     styles: { … },      // Object<StyleID, Partial<StyleProps>>
   *     selectors: { … }    // Object<SelectorID, Partial<StyleSelectorProps>>
   *   }]
   * }
   *
   * When merging:
   *  - Items are processed in the order they appear.
   *  - New items will replace existing items that have the same `id`.
   *     `"motorway": { casing: { color: 0xff0000 }, … }`    <-- `motorway` style replaced
   *  - If no new data supplied (null), this is treated as a delete.
   *     `"motorway": null`                                   <-- `motorway` style deleted
   *  - Wildcard characters '*' and '?' are allowed when deleting.
   *     `"motor*": null`                                     <-- all `motor*` styles deleted
   *
   * @param input - style data to merge into the system
   * @throws Will throw if given data does not contain an `assetID`, or if the `assetID` has already been merged
   */
  merge(input: StyleInput): void {
    const context = this.context;
    const assetID = input.assetID;
    const assetVersion = input.assetVersion ?? 'unknown';

    if (!assetID) {
      throw new Error('StyleSystem.merge(): data must include assetID');
    }
    if (this._loadedAssetIDs.has(assetID)) {
      throw new Error(`StyleSystem.merge(): assetID '${assetID}' was already merged`);
    }

    this._loadedAssetIDs.set(assetID, assetVersion);

    // Process each scope
    const inputScopes = input.scopes ?? [];
    for (const inputScope of inputScopes) {
      const scopeID = inputScope.scope ?? 'osm';

      // Get or create a data cache for this scopeID
      const scope = this.getScope(scopeID);

      // Merge Variables (before Styles/Selectors, since selectors may reference variables)
      if (inputScope.variables) {
        for (const [variableID, value] of Object.entries(inputScope.variables)) {
          if (value !== null && value !== undefined) {   // add or replace
            const varProps: Partial<VariableProps> = { id: variableID, assetID, scopeID, value };
            const variable = new Variable(context, varProps);
            scope.variables.set(variableID, variable);

          } else {   // remove
            utilWildcardDelete(scope.variables, variableID);
          }
        }
      }

      // Merge Styles
      if (inputScope.styles) {
        for (const [styleID, props] of Object.entries(inputScope.styles)) {
          if (props) {   // add or replace
            const setProps = { ...props, id: styleID, assetID, assetVersion, scopeID } as Partial<StyleProps>;
            const style = new Style(context, setProps);
            scope.styles.set(styleID, style);
          } else {   // remove
            utilWildcardDelete(scope.styles, styleID);
          }
        }
      }

      // Merge StyleSelectors
      if (inputScope.selectors) {
        for (const [selectorID, props] of Object.entries(inputScope.selectors)) {
          if (props) {  // add or replace
            const setProps = { ...props, id: selectorID, assetID, assetVersion, scopeID } as Partial<StyleSelectorProps>;
            const selector = new StyleSelector(context, setProps);
            scope.selectors.set(selectorID, selector);
          } else {   // remove
            utilWildcardDelete(scope.selectors, selectorID);
          }
        }
      }
    }

    this._styleChanged();
  }


  /**
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // style
    // AssetIDs to request, e.g. `style=default,my_presets`
    const newStyle = currParams.get('style');
    const oldStyle = prevParams.get('style');
    if (newStyle !== oldStyle) {
      if (typeof newStyle === 'string') {
        this.requestedAssetIDs = utilExtractValues(newStyle).filter(Boolean);
      } else {
        this.requestedAssetIDs = null;
      }
      this.loadStyleAssetsAsync();
    }
  }


  /**
   * getScope
   * Get the scope data for a specific scope ID.
   * If the scope doesn't exist yet, it is created and cached automatically.
   * @param scopeID - ID of the scope to look up
   * @return The scope data
   */
  getScope(scopeID: ScopeID): StyleScope {
    let scope = this._scopes.get(scopeID);
    if (!scope) {
      scope = { variables: new Map(), styles: new Map(), selectors: new Map() };
      this._scopes.set(scopeID, scope);
    }
    return scope;
  }


  /**
   * styleMatch
   * @param tags - OSM tags to match to a display style
   * @param geometry - Optional geometry type (if provided, will look up preset icon from SchemaSystem)
   * @param scopeID - Optional scope ID for scoped matching (defaults to 'osm')
   * @return Styling info for the given tags
   */
  styleMatch(tags: OsmTags, geometry?: GeometryType, scopeID: ScopeID = 'osm'): MatchedStyle {
    const context = this.context;
    const schema = context.systems.schema;

    // Use per-scope data for the requested scope, falling back to '*' common scope.
    const scope = this.getScope(scopeID);
    const common = this.getScope('*');
    const scopeStyles = scope.styles.size ? scope.styles : common.styles;
    const scopeSelectors = scope.selectors.size ? scope.selectors : common.selectors;

    let defaults = scopeStyles.get('DEFAULTS') ?? common.styles.get('DEFAULTS');

    // If DEFAULTS doesn't exist, construct a minimal default style.
    if (!defaults) {
      defaults = new Style(context, { id: 'DEFAULTS', ...styleDefaults });
    }

    // Find all matching selectors, sorted by specificity (highest first)
    const matchInfo = { tags, geometry };
    const matchingSelectors = StyleSelector.findAll(scopeSelectors.values(), matchInfo);

    // Start with an empty style and apply matching selectors in order of increasing specificity.
    // DEFAULTS is passed to resolvedStyle() separately so it doesn't block cascade fallbacks.
    let combinedProps: Partial<StyleProps> = {};
    const combinedIDs = new Set<string>();

    for (let i = matchingSelectors.length - 1; i >= 0; i--) {
      const selector = matchingSelectors[i];
      for (const styleID of selector.styleIDs) {
        const style = scopeStyles.get(styleID);
        if (style) {
          combinedProps = deepMerge(combinedProps, style.resolved) as StyleProps;
          combinedIDs.add(styleID);
        } else {
          console.error(`invalid styleID: ${styleID}`);  // eslint-disable-line
        }
      }
    }

    // Extract styleKey from most specific selector (for lifecycle handling)
    let styleKey: string | undefined;
    if (matchingSelectors.length > 0) {
      const bestSelector = matchingSelectors[0];
      const tagMatchers = bestSelector.tagMatchers;
      if (tagMatchers.length > 0) {
        const k = tagMatchers[0].key;
        styleKey = Array.isArray(k) ? k[0] : k;
      }
    }

    // Build result from resolved style properties.
    // Pass defaults so resolvedStyle() can layer it between styleDefaults and fallbacks.
    const combinedID = [...combinedIDs].join(',') || 'empty';
    const matched = new Style(this.context, { id: combinedID, ...combinedProps });
    const result: MatchedStyle = matched.resolvedStyle(defaults);

    // If icon.image is not set by the style, try to get it from the preset
    if (!result.icon.image && geometry) {
      if (schema) {
        let preset = schema.matchTags(tags, geometry);
        let iconName = preset?.props?.icon;

        // If we didn't get an icon for a point, try matching it as a 'vertex'.
        // This is just to choose a better icon for an otherwise empty-looking pin.
        if (!iconName && geometry === 'point') {
          preset = schema.matchTags(tags, 'vertex');
          iconName = preset?.props?.icon;
        }

        if (iconName) {
          result.icon.image = iconName;
        }
      }
    }

    // Apply structure overrides (bridge, tunnel, embankment, surface)
    this._applyStructureOverrides(result, tags);

    // Apply lifecycle overrides if applicable
    const hasLifecycleTag = this._hasLifecycleTag(tags, styleKey);
    if (hasLifecycleTag) {
      this._applyLifecycleOverrides(result, scopeStyles);
    }

    // Validate fill pattern
    this._validateFillPattern(result, tags);

    return result;
  }


  /**
   * _hasLifecycleTag
   * Scan tags for lifecycle keywords in any of their various forms.
   * @param tags - OSM tags to scan
   * @param styleKey - The primary style key (e.g. 'highway'), if any
   * @return True if a lifecycle tag is found
   * @see Rapid#1312, Rapid#1199, Rapid#791, Rapid#535
   */
  private _hasLifecycleTag(tags: OsmTags, styleKey: string | undefined): boolean {
    const schema = this.context.systems.schema;
    const lifecyclePrefixes = schema?.getScope('osm')?.variables?.get('lifecycle_prefixes')?.asSet();
    if (!lifecyclePrefixes?.size) return false;

    for (const [k, v] of Object.entries(tags)) {
      // Lifecycle key, e.g. `demolished=yes`
      // (applies to all tags, styleKey doesn't matter)
      if (lifecyclePrefixes.has(k) && v !== 'no') {
        return true;

      // Lifecycle value, e.g. `railway=demolished`
      // (applies only if `k` is styleKey or there is no styleKey controlling styling)
      } else if ((!styleKey || k === styleKey) && lifecyclePrefixes.has(v)) {
        return true;

      // Lifecycle key prefix, e.g. `demolished:railway=rail`
      // (applies only if there is no styleKey controlling the styling)
      } else if (!styleKey && v !== 'no') {
        const colonIdx = k.indexOf(':');
        if (colonIdx !== -1 && lifecyclePrefixes.has(k.substring(0, colonIdx))) {
          return true;
        }
      }
    }
    return false;
  }


  /**
   * _applyStructureOverrides
   * Apply casing/stroke overrides for bridges, tunnels, embankments, cuttings, and unpaved surfaces.
   * @param result - The result object to mutate
   * @param tags - OSM tags
   */
  private _applyStructureOverrides(result: MatchedStyle, tags: OsmTags): void {
    const context = this.context;
    const schema = context.systems.schema;

    const bridge = getTag(tags, 'bridge');
    const cutting = getTag(tags, 'cutting');
    const embankment = getTag(tags, 'embankment');
    const highway = getTag(tags, 'highway');
    const tracktype = getTag(tags, 'tracktype');
    const tunnel = getTag(tags, 'tunnel');
    let surface = getTag(tags, 'surface');

    // Assume unimproved (non-grade1) tracks have 'dirt' surface
    if (highway === 'track' && tracktype !== 'grade1') {
      surface = surface || 'dirt';
    }

    // Bridge/embankment/cutting: wider black casing
    if (bridge || embankment || cutting) {
      result.casing.width ??= 1;  // make sure there is a casing
      result.casing.width += 7;
      result.casing.color = 0x000000;
      result.casing.cap = 'butt';
      if (embankment || cutting) {
        result.casing.dash = [2, 4];
      }
    }

    // Tunnel: reduced stroke opacity
    if (tunnel) {
      result.stroke.opacity = 0.5;
    }

    // Bumpy casing for roads with unpaved surface
    if (surface && highway) {
      const osmRulesets = schema?.getScope('osm')?.rulesets;
      const isRoad = osmRulesets?.get('major_vehicular')?.match({ highway }) ||
                     osmRulesets?.get('minor_vehicular')?.match({ highway });
      if (isRoad) {
        const isPaved = osmRulesets?.get('surface_paved')?.match({ surface });
        if (!isPaved) {
          if (!bridge) result.casing.color = 0xcccccc;
          result.casing.cap = 'butt';
          result.casing.dash = [4, 4];
        }
      }
    }
  }


  /**
   * _applyLifecycleOverrides
   * Apply lifecycle overrides (dashed lines for abandoned, proposed, etc.).
   * @param result - The result object to mutate
   * @param scopeStyles - The scoped styles map to look up LIFECYCLE style from
   */
  private _applyLifecycleOverrides(result: MatchedStyle, scopeStyles: Map<StyleID, Style>): void {
    const lifecycle = scopeStyles.get('LIFECYCLE');
    if (!lifecycle) return;

    for (const group of ['fill', 'casing', 'stroke'] as const) {
      for (const prop of ['width', 'color', 'opacity', 'cap', 'dash'] as const) {
        const lifecycleGroup = lifecycle[group] as Record<string, unknown> | undefined;
        const value = lifecycleGroup?.[prop];
        if (value !== undefined) {
          (result[group] as unknown as Record<string, unknown>)[prop] = value;
        }
      }
    }
  }


  /**
   * _validateFillPattern
   * Validate and clear invalid fill patterns.
   * @param result - The result object to validate
   * @param tags - OSM tags (to check for building exception)
   */
  private _validateFillPattern(result: MatchedStyle, tags: OsmTags): void {
    const building = getTag(tags, 'building');
    if (building) return;  // exception: don't apply patterns to buildings

    if (result.fill.pattern && !this.patternIDs.has(result.fill.pattern)) {
      console.error(`invalid patternID: ${result.fill.pattern}`);  // eslint-disable-line
      result.fill.pattern = undefined;
    }
  }


  /**
   * _styleChanged
   * Called whenever the style changes.
   * Resolves `var()` references in styles and selectors, then dirties all features
   * so they get re-styled, triggers a redraw, and emits a 'stylechange' event.
   */
  private _styleChanged(): void {
    const gfx = this.context.systems.gfx;

    // Resolve var() references in styles and selectors against scope variables
    for (const scope of this._scopes.values()) {
      for (const style of scope.styles.values()) {
        style.reset();
        style.resolveVariables(scope.variables);
      }
      for (const selector of scope.selectors.values()) {
        selector.reset();
        selector.resolveVariables(scope.variables);
      }
    }

    // Mark all features dirty so they re-fetch their styles on the next render
    gfx?.scene?.dirtyScene();
    gfx?.immediateRedraw();
    this.emit('stylechange');
  }
}
