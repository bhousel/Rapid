import { AbstractSystem } from './AbstractSystem.ts';
import { osmPavedTags } from '../lib/tags.ts';
import { Style } from '../lib/Style.ts';
import { StyleSelector } from '../lib/StyleSelector.ts';
import { utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';
import type { Tags } from '../data/types.ts';
import type { LineCap, LineJoin, StyleProps } from '../lib/Style.ts';
import type { StyleMatchConditions } from '../lib/StyleSelector.ts';
import type { OneOrMore } from '../util/iterable.ts';


/**
 * Style selector input - the format used in style data files.
 * The `id` is provided separately as the object key.
 */
interface StyleSelectorInput {
  /** IDs of Styles to apply when this selector matches (merged in order) */
  styleIDs: StyleID[];
  /** Conditions that must be met for this selector to match */
  match: StyleMatchConditions;
}


/**
 * Style asset data to merge into the system.
 * Contains styles and selectors.
 */
export interface StyleData {
  /** An asset identifier, e.g. 'rapid_style' (required) */
  assetID: AssetID;
  /** A string version specifier, e.g. '1.0.0' */
  assetVersion?: string;
  /** Object mapping styleID to style (or null to delete) */
  styles?: Record<StyleID, Partial<StyleProps> | null>;
  /** Object mapping selectorID to style selector (or null to delete) */
  selectors?: Record<StyleSelectorID, StyleSelectorInput | null>;
}


/**
 * Resolved fill style properties.
 */
interface ResolvedFillProps {
  width: number;
  color: number;
  alpha: number;
  pattern?: string;
}


/**
 * Resolved line style properties.
 */
interface ResolvedLineProps {
  width: number;
  color: number;
  alpha: number;
  cap: LineCap;
  join: LineJoin;
  dash?: number[];
}


/**
 * The resolved style object returned by styleMatch.
 */
export interface MatchedStyle {
  fill: ResolvedFillProps;
  casing: ResolvedLineProps;
  stroke: ResolvedLineProps;
  /** Extra properties are allowed */
  [key: string]: unknown;
}


const roadVals = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'unclassified', 'road', 'service', 'track', 'living_street', 'bus_guideway', 'busway',
]);

const lifecycleVals = new Set([
  'abandoned', 'construction', 'demolished', 'destroyed', 'dismantled', 'disused',
  'intermittent', 'obliterated', 'planned', 'proposed', 'razed', 'removed', 'was'
]);

// matches these things as a tag prefix
const lifecycleRegex = new RegExp('^(' + Array.from(lifecycleVals).join('|') + '):');


/**
 * `StyleSystem` maintains the the rules about how map data should look.
 *
 * Properties available:
 *   `styles`           Map of styleID → Style
 *   `selectors`        Map of selectorID → StyleSelector
 *   `defaultAssetIDs`  Default assetIDs that are loaded if no custom assets are requested
 *   `loadedAssetIDs`   Map<AssetID, string> - assetIDs that have been loaded (maps to version string)
 *
 * Events available:
 *   `stylechange`  Fires on any change in style
 */
export class StyleSystem extends AbstractSystem {
  /** Protanopia color blindness simulation matrix */
  protanopiaMatrix: number[];
  /** Deuteranopia color blindness simulation matrix */
  deuteranopiaMatrix: number[];
  /** Tritanopia color blindness simulation matrix */
  tritanopiaMatrix: number[];

  /** Map of styleID to Style */
  styles: Map<StyleID, Style>;
  /** Map of selectorID to StyleSelector */
  selectors: Map<StyleSelectorID, StyleSelector>;
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
    this.optionalDependencies = new Set(['assets', 'gfx', 'urlhash']);

    this.styles = new Map();
    this.selectors = new Map();

    this._defaultAssetIDs = new Set(['rapid_style']);
    this._loadedAssetIDs = new Map();
    this._requestedAssetIDs = null;

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

    // Clear out whatever was loaded before.
    this.resetAll();

    // If AssetSystem is not available, we can't load style files.
    // resetAll() has already set up empty maps.
    if (!assets) return Promise.resolve();

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
      for (const result of results) {
        if (isFulfilled(result) && result.value) {
          this.merge(result.value as StyleData);
        }
      }
      for (const result of results) {
        if (isRejected(result)) {
          console.error(result.reason);  // eslint-disable-line no-console
        }
      }

      this._styleChanged();
    });
  }


  /**
   * resetAll
   * This puts the StyleSystem internal data back to its initial state, i.e. no styles.
   */
  resetAll(): void {
    this._loadedAssetIDs.clear();
    this.styles.clear();
    this.selectors.clear();

    this._styleChanged();
  }


  /**
   * defaultAssetIDs
   * Returns the default assetIDs
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
   * Accepts an object containing new style data (all properties except 'assetID' are optional):
   * {
   *   assetID: '',           // A string asset identifier, e.g. 'rapid_style'
   *   assetVersion: '',      // A string version specifier, e.g. '1.0.0'  (defaults to 'unknown' if not present)
   *   styles: {},            // Object<StyleID, Style>
   *   selectors: {}          // Object<SelectorID, StyleSelector>
   * }
   *
   * When merging:
   *  - Items are processed in the order they appear.
   *  - You can't replace the `DEFAULTS` or `LIFECYCLE` styles (these are required).
   *  - New items will replace existing items that have the same `id`.
   *     `"motorway": { casing: { color: 0xff0000 }, … }`    <-- `motorway` style replaced
   *  - If no new data supplied (null), this is treated as a delete.
   *     `"motorway": null`                                   <-- `motorway` style deleted
   *  - Wildcard characters '*' and '?' are allowed when deleting.
   *     `"motor*": null`                                     <-- all `motor*` styles deleted
   *
   * @param src - style data to merge into the system
   * @throws Will throw if given data does not contain an `assetID`, or if the `assetID` has already been merged
   */
  merge(src: StyleData): void {
    const assetID = src.assetID;
    const assetVersion = src.assetVersion ?? 'unknown';

    if (!assetID) {
      throw new Error('StyleSystem.merge(): data must include assetID');
    }
    if (this._loadedAssetIDs.has(assetID)) {
      throw new Error(`StyleSystem.merge(): assetID '${assetID}' was already merged`);
    }

    this._loadedAssetIDs.set(assetID, assetVersion);

    // Merge styles
    if (src.styles) {
      for (const [styleID, input] of Object.entries(src.styles)) {
        // Skip protected styles
        if (styleID === 'DEFAULTS' || styleID === 'LIFECYCLE') {
          if (input === null) continue;  // can't delete these
        }

        if (input === null) {
          // Delete: supports wildcards
          this._deleteMatching(this.styles, styleID);
        } else {
          // Add/replace - create Style instance from input
          const style = new Style({
            id: styleID,
            assetID: assetID,
            assetVersion: assetVersion,
            fill: input.fill,
            casing: input.casing,
            stroke: input.stroke
          });
          this.styles.set(styleID, style);
        }
      }
    }

    // Merge selectors
    if (src.selectors) {
      for (const [selectorID, input] of Object.entries(src.selectors)) {
        if (input === null) {
          // Delete: supports wildcards
          this._deleteMatching(this.selectors, selectorID);
        } else {
          // Add/replace - create StyleSelector instance from input
          const selector = new StyleSelector({
            id: selectorID,
            assetID: assetID,
            assetVersion: assetVersion,
            styleIDs: input.styleIDs,
            match: input.match
          });
          this.selectors.set(selectorID, selector);
        }
      }
    }

    this._styleChanged();
  }


  /**
   * _deleteMatching
   * Delete entries from a Map that match a pattern (supports '*' and '?' wildcards)
   */
  private _deleteMatching<V>(map: Map<string, V>, pattern: string): void {
    if (pattern.includes('*') || pattern.includes('?')) {
      // Convert wildcard pattern to regex
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
        .replace(/\*/g, '.*')                   // * matches any characters
        .replace(/\?/g, '.');                   // ? matches single character
      const regex = new RegExp(`^${regexPattern}$`);

      for (const key of map.keys()) {
        if (regex.test(key)) {
          map.delete(key);
        }
      }
    } else {
      map.delete(pattern);
    }
  }


  /**
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    const context = this.context;
    const assets = context.systems.assets;

    // style=assetID1,assetID2,assetID3
    const currStyle = currParams.get('style');
    const prevStyle = prevParams.get('style');

    if (currStyle !== prevStyle) {
      // Special: setting to '' means load nothing
      // Special: setting to null means load the defaults
      if (currStyle === '') {
        this.requestedAssetIDs = '';
        this.loadStyleAssetsAsync();
      } else if (currStyle === null || currStyle === undefined) {
        this.requestedAssetIDs = null;
        this.loadStyleAssetsAsync();
      } else {
        // First register any custom assets from `assets=` parameter
        const customAssets = currParams.get('assets');
        if (customAssets && assets) {
          for (const pair of customAssets.split(',')) {
            const [assetID, url] = pair.split('|');
            if (assetID && url) {
              assets.registerAsset(assetID, { preferred: url });
            }
          }
        }
        this.requestedAssetIDs = currStyle;
        this.loadStyleAssetsAsync();
      }
    }
  }


  /**
   * styleMatch
   * @param tags - OSM tags to match to a display style
   * @return Styling info for the given tags
   */
  styleMatch(tags: Tags): MatchedStyle {
    const defaults = this.styles.get('DEFAULTS');

    // If DEFAULTS hasn't been loaded yet, return a minimal style
    if (!defaults) {
      return {
        fill:   { width: 2, color: 0xaaaaaa, alpha: 0.3 },
        casing: { width: 5, color: 0x444444, alpha: 1, cap: 'round', join: 'round' },
        stroke: { width: 3, color: 0xcccccc, alpha: 1, cap: 'round', join: 'round' }
      };
    }

    // Find all matching selectors, sorted by specificity (highest first)
    const featureInfo = { tags };
    const matchingSelectors = StyleSelector.findAll(this.selectors.values(), featureInfo);

    // Start with defaults, then merge all matching selectors in order.
    // We iterate in reverse (lowest specificity first) so higher specificity selectors win.
    let matched: Style = defaults;
    let styleKey: string | undefined;

    for (let i = matchingSelectors.length - 1; i >= 0; i--) {
      const selector = matchingSelectors[i];
      for (const styleID of selector.styleIDs) {
        const style = this.styles.get(styleID);
        if (style) {
          matched = matched.merge(style);
        } else {
          console.error(`invalid styleID: ${styleID}`);  // eslint-disable-line
        }
      }
    }

    // Extract styleKey from most specific selector (for lifecycle handling)
    if (matchingSelectors.length > 0) {
      const bestSelector = matchingSelectors[0];
      const tagMatchers = bestSelector.tagMatchers;
      if (tagMatchers.length > 0) {
        styleKey = tagMatchers[0].key;
      }
    }

    // Also scan for lifecycle keywords in any of their various forms.
    // The feature will be drawn with dashed lines.
    // see Rapid#1312, Rapid#1199, Rapid#791, Rapid#535
    let hasLifecycleTag = false;
    for (const [k, v] of Object.entries(tags)) {
      // Lifecycle key, e.g. `demolished=yes`
      // (applies to all tags, styleKey doesn't matter)
      if (lifecycleVals.has(k) && v !== 'no') {
        hasLifecycleTag = true;
        break;

      // Lifecycle value, e.g. `railway=demolished`
      // (applies only if `k` is styleKey or there is no styleKey controlling styling)
      } else if ((!styleKey || k === styleKey) && lifecycleVals.has(v)) {
        hasLifecycleTag = true;
        break;

      // Lifecycle key prefix, e.g. `demolished:railway=rail`
      // (applies only if there is no styleKey controlling the styling)
      } else if (!styleKey && lifecycleRegex.test(k) && v !== 'no') {
        hasLifecycleTag = true;
        break;
      }
    }

    // Copy style properties from the matched style, fallback to defaults as needed..
    // We use type assertions here since we're building the result object dynamically
    const result: MatchedStyle = {
      fill: {} as ResolvedFillProps,
      casing: {} as ResolvedLineProps,
      stroke: {} as ResolvedLineProps
    };

    for (const group of ['fill', 'casing', 'stroke'] as const) {
      const styleGroup = result[group] as unknown as Record<string, unknown>;
      const matchedGroup = matched[group] as Record<string, unknown> | undefined;
      const defaultGroup = defaults[group] as Record<string, unknown> | undefined;

      for (const prop of ['width', 'color', 'alpha', 'cap', 'join', 'dash']) {
        const value = matchedGroup?.[prop];
        if (value !== undefined) {
          styleGroup[prop] = value;
        } else {
          const fallback = defaultGroup?.[prop];
          if (fallback !== undefined) {
            styleGroup[prop] = fallback;
          }
        }
      }
    }

    // Apply casing/stroke overrides
    const bridge = getTag(tags, 'bridge');
    const building = getTag(tags, 'building');
    const cutting = getTag(tags, 'cutting');
    const embankment = getTag(tags, 'embankment');
    const highway = getTag(tags, 'highway');
    const tracktype = getTag(tags, 'tracktype');
    const tunnel = getTag(tags, 'tunnel');
    let surface = getTag(tags, 'surface');
    if (highway === 'track' && tracktype !== 'grade1') {
      surface = surface || 'dirt';   // assume unimproved (non-grade1) tracks have 'dirt' surface
    }

    if (bridge || embankment || cutting) {
      result.casing.width += 7;
      result.casing.color = 0x000000;
      result.casing.cap = 'butt';
      if (embankment || cutting) {
        result.casing.dash = [2, 4];
      }
    }
    if (tunnel) {
      result.stroke.alpha = 0.5;
    }

    // Bumpy casing for roads with unpaved surface
    if (surface && highway && roadVals.has(highway) && !osmPavedTags.surface[surface]) {
      if (!bridge) result.casing.color = 0xcccccc;
      result.casing.cap = 'butt';
      result.casing.dash = [4, 4];
    }

    // After applying all other styling rules and overrides, perform lifecycle overrides.
    // (This is for features that are not really existing - "abandoned", "proposed", etc.)
    if (hasLifecycleTag) {
      const lifecycle = this.styles.get('LIFECYCLE');
      if (lifecycle) {
        for (const group of ['fill', 'casing', 'stroke'] as const) {
          for (const prop of ['width', 'color', 'alpha', 'cap', 'dash'] as const) {
            const lifecycleGroup = lifecycle[group] as Record<string, unknown> | undefined;
            const value = lifecycleGroup?.[prop];
            if (value !== undefined) {
              (result[group] as unknown as Record<string, unknown>)[prop] = value;
            }
          }
        }
      }
    }


    // Validate fill pattern (patterns come from styles/selectors via styleIDs array)
    if (building) return result;   // exception: don't apply patterns to buildings

    if (result.fill.pattern && !this.patternIDs.has(result.fill.pattern)) {
      console.error(`invalid patternID: ${result.fill.pattern}`);  // eslint-disable-line
      result.fill.pattern = undefined;
    }

    return result;


    // This just returns the value of the tag, but ignores 'no' values
    function getTag(tags: Tags, key: string): string | undefined {
      return tags[key] === 'no' ? undefined : tags[key];
    }
  }


  /**
   * _styleChanged
   * Called whenever the style changes.
   * This will trigger a redraw and emit a 'stylechange' event.
   */
  _styleChanged(): void {
    const gfx = this.context.systems.gfx;

    gfx?.immediateRedraw();
    this.emit('stylechange');
  }
}
