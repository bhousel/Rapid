import { geoMetersToOffset, geoOffsetToMeters } from '@rapid-sdk/math';
import whichPolygon from 'which-polygon';

import { AbstractSystem } from './AbstractSystem.ts';
import {
  ImagerySource, ImagerySourceBing, ImagerySourceCustom,
  ImagerySourceEsri, ImagerySourceEsriWayback, ImagerySourceNone
} from '../lib/ImagerySource.ts';
import { utilExtractValues, utilWildcardDelete } from '../util/string.ts';
import { utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';
import type { ImagerySourceProps } from '../lib/ImagerySource.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { PixiLayerBackgroundTiles } from '../pixi/PixiLayerBackgroundTiles.ts';
import type { Vec2, Vec4 } from '../data/types.ts';


/**
 * Input format for data to merge into the ImagerySystem.
 */
export interface ImageryInput {
  /** An asset identifier, e.g. 'editor_layer_index' (required) */
  assetID: AssetID;
  /** A string version specifier, e.g. '2026-01-01' */
  assetVersion?: string;
  /** Array of scoped imagery input data, each must contain a scope identifier */
  scopes?: ImageryInputScope[];
}

/**
 * Input format for a single scope of imagery data.
 */
export interface ImageryInputScope {
  /** Scope identifier that this input data applies to (required - defaults to 'osm') */
  scope: ScopeID;
  /** Object mapping ImagerySourceID to ImagerySource props (or null to delete) */
  imagery?: Record<ImagerySourceID, Partial<ImagerySourceProps> | null>;
}

/**
 * Internal per-scope storage for loaded imagery data.
 */
export interface ImageryScope {
  /** Map of ImagerySourceIDs to instantiated ImagerySources */
  sources: Map<ImagerySourceID, ImagerySource>;
}


/**
 * `ImagerySystem` maintains the state of the tiled background and overlay imagery.
 *
 * At init time, Rapid will load the imagery index and any custom imagery assets.
 *
 * **Scoped Architecture:**
 * Data is organized into scopes (e.g. 'osm', '*'). Each scope has its own
 * `Map<ImagerySourceID, ImagerySource>`. The '*' common scope holds builtin
 * sources ('none' and 'custom') that are always available. The `sources` getter
 * aggregates all scopes into a single Map. Data is loaded via `merge()`, which
 * accepts scoped input.
 *
 * **Default assets loaded at init time:**
 * - `editor_layer_index` — Community-maintained imagery definitions
 * - `rapid_imagery` — Rapid-specific imagery additions (from `data/rapid_imagery.json5`)
 *
 * Custom imagery data can be merged in to supplement or override the defaults.
 *
 * Properties available:
 *   `sources`     `Map<ImagerySourceID, ImagerySource>` - Computed aggregate of all scopes
 *   `features`    `Map<ImagerySourceID, GeoJSON.Feature>` - Imagery geofences
 *   `offset`
 *   `brightness`
 *   `contrast`
 *   `saturation`
 *   `sharpness`
 *   `numGridSplits`
 *
 * Events available:
 *   `imagerychange`   Fires on any change in imagery or display options
 */
export class ImagerySystem extends AbstractSystem {
  /** Imagery geofences, keyed by ImagerySourceID (lowercase) */
  features: Map<ImagerySourceID, GeoJSON.Feature>;

  /** Per-scope storage */
  private _scopes: Map<ScopeID, ImageryScope>;

  /** Default imagery file assetIDs */
  private _defaultAssetIDs: Set<AssetID>;
  /** Currently loaded imagery file assetIDs, maps to the version string that was loaded, if known */
  private _loadedAssetIDs: Map<AssetID, string>;
  /** Requested imagery file assetIDs - optional, these can be different than the default files */
  private _requestedAssetIDs: Set<AssetID> | null;

  private _baseLayer: ImagerySource | null;
  private _overlayLayers: Map<ImagerySourceID, ImagerySource>;
  private _checkedBlocklists: string[];
  private _isValid: boolean;  // todo, find a new way to check this, no d3 enter/update render anymore
  private _whichPolygon: ReturnType<typeof whichPolygon> | null;

  private _brightness: number;
  private _contrast: number;
  private _saturation: number;
  private _sharpness: number;
  private _numGridSplits: number;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'imagery';
    this.optionalDependencies = new Set(['assets', 'gfx', 'l10n', 'storage', 'urlhash']);

    this._scopes = new Map();    // Map<ScopeID, ImageryScope>
    this.features = new Map();   // Map<ImagerySourceID, GeoJSON.Feature>

    this._defaultAssetIDs = new Set(['editor_layer_index', 'rapid_imagery']);
    this._loadedAssetIDs = new Map();
    this._requestedAssetIDs = null;

    this._baseLayer = null;
    this._overlayLayers = new Map();
    this._checkedBlocklists = [];
    this._isValid = true;
    this._whichPolygon = null;

    this._brightness = 1;
    this._contrast = 1;
    this._saturation = 1;
    this._sharpness = 1;
    this._numGridSplits = 0; // No grid by default.

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._imageryChanged = this._imageryChanged.bind(this);
    this._localeChanged = this._localeChanged.bind(this);
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
    const gfx = context.systems.gfx;
    const l10n = context.systems.l10n;
    const storage = context.systems.storage;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          gfx?.initAsync(),      // `gfx.scene` will exist after `initAsync`
          l10n?.initAsync(),
          storage?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup event handlers..
        urlhash?.on('hashchange', this._hashChanged);
        gfx?.scene?.on('layerchange', this._imageryChanged);
        l10n?.on('localechange', this._localeChanged);

        // If AssetSystem is available, tell it about default imagery files and load them.
        // Without AssetSystem, we'll just have the builtin 'none' and 'custom' sources.
        if (assets) {
          assets.registerAsset('editor_layer_index', { preferred: 'data/editor_layer_index.min.json' });
          assets.registerAsset('rapid_imagery', { preferred: 'data/rapid_imagery.min.json5' });
          return this.loadImageryAssetsAsync();
        } else {
          this.resetAll();  // Set up builtin sources
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
   * loadImageryAssetsAsync
   * @return Promise fulfilled when the imagery has been loaded
   */
  loadImageryAssetsAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets;

    // Clear out whatever was loaded before.
    this.resetAll();

    // If AssetSystem is not available, we can't load imagery files.
    // resetAll() has already set up the builtin 'none' and 'custom' sources.
    if (!assets) {
      return Promise.resolve();
    }

    // Load the imagery files
    const which = this._requestedAssetIDs ?? this._defaultAssetIDs;
    const assetIDs = [...which];

    // Type guard, see https://stackoverflow.com/a/73913774/7620
    const isFulfilled = <T,>(p:PromiseSettledResult<T>): p is PromiseFulfilledResult<T> => p.status === 'fulfilled';
    const isRejected = <T,>(p:PromiseSettledResult<T>): p is PromiseRejectedResult => p.status === 'rejected';

    return Promise.allSettled(
      assetIDs.map(assetID => assets.loadAssetAsync(assetID))
    )
    .then(results => {
      const fulfilledValues = results.filter(isFulfilled).map(p => p.value);
      for (const value of fulfilledValues as ImageryInput[]) {
        if (value.assetID === 'rapid_imagery') {
          value.assetVersion ||= context.version;
        }
        this.merge(value);
      }

      const rejectedReasons = results.filter(isRejected).map(p => p.reason);
      for (const reason of rejectedReasons as string[]) {
        console.error(reason);   // eslint-disable-line no-console
      }

      // Default the locator overlay to "on"..
      const locator = this.sources.get('mapbox_locator_overlay');
      if (locator) {
        this.toggleOverlayLayer(locator);
      }
    });
  }


  /**
   * resetAll
   * This puts the ImagerySystem internal data back to its initial state, i.e. no imagery.
   */
  resetAll(): void {
    const context = this.context;
    const storage = context.systems.storage;

    this._loadedAssetIDs.clear();
    this.features.clear();
    this._scopes.clear();

    // Create the '*' common scope with geometry fallback imagery.
    // Items in the common scope are always available.
    const common = this.getScope('*');

    // Add 'None'
    const none = new ImagerySourceNone(context);
    common.sources.set(none.id.toLowerCase(), none);

    // Add 'Custom' - seed it with whatever template the user has used previously
    const custom = new ImagerySourceCustom(context);
    custom.template = storage?.getItem('background-custom-template') ?? '';
    common.sources.set(custom.id.toLowerCase(), custom);

    this._baseLayer = none;
    this._overlayLayers.clear();

    this._rebuildIndex();    // also calls _imageryChanged()
  }


  /**
   * sources
   * Returns an aggregate Map of all ImagerySource objects across all scopes.
   * Sources from later scopes override sources from earlier scopes with the same key.
   * @return  Aggregate map of all sources
   * @readonly
   */
  get sources(): Map<ImagerySourceID, ImagerySource> {
    const all = new Map<ImagerySourceID, ImagerySource>();
    for (const scope of this._scopes.values()) {
      for (const [id, source] of scope.sources) {
        all.set(id, source);
      }
    }
    return all;
  }


  /**
   * getScope
   * Get the scope data for a specific scope ID.
   * If the scope doesn't exist yet, it is created and cached automatically.
   * @param scopeID - ID of the scope to look up
   * @return The scope data
   */
  getScope(scopeID: ScopeID): ImageryScope {
    let scope = this._scopes.get(scopeID);
    if (!scope) {
      scope = { sources: new Map() };
      this._scopes.set(scopeID, scope);
    }
    return scope;
  }


  /**
   * defaultAssetIDs
   * Returns the default assetIDs. These are the imagery assets that Rapid will load by default.
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
   * Allows user to request different imagery asset files than what Rapid uses by default.
   *
   * If set before init time, these assets will be loaded at init time when init calls `loadImageryAssetsAsync`.
   * You can also change this after init time, but then you'll need to call `loadImageryAssetsAsync` again.
   *
   * The 'default' keyword is special - if found in the list, it will expand to all the default IDs.
   *
   * You can set `requestedAssetIDs` to an empty list ''.  In this case, subsequent calls to
   *   `loadImageryAssetsAsync` will load nothing, you'll have only builtin 'none' and 'custom' sources.
   * You can also pass `null` - in this case the `requestedAssetIDs` list is not used,
   *   and subsequent calls to `loadImageryAssetsAsync` will use the `defaultAssetIDs` Set.
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
   * Accepts imagery data contained in scope blocks:
   * ```
   * {
   *   assetID: 'my_imagery',
   *   scopes: [{
   *     scope: 'osm',
   *     imagery: { ... }
   *   }]
   * }
   * ```
   *
   * When merging:
   *  - Items are processed in the order they appear.
   *  - New items will replace existing items that have the same `id`.
   *     `"Bing": { name: 'My Bing', … }`    <-- `Bing` source replaced
   *  - If no new data supplied (null), this is treated as a delete.
   *     `"Bing": null`                      <-- `Bing` source deleted
   *  - Wildcard characters '*' and '?' are allowed when deleting.
   *     `"US-TIGER*": null`                 <-- all `US-TIGER*` sources deleted
   *
   * @param input - imagery data to merge
   * @throws Will throw if given data does not contain an `assetID`, or if the `assetID` has already been merged
   */
  merge(input: ImageryInput): void {
    const context = this.context;
    const wayback = context.services.wayback;

    const assetID = input.assetID;
    const assetVersion = input.assetVersion ?? 'unknown';

    if (!assetID) {
      throw new Error('Imagery missing assetID property');
    }
    if (this._loadedAssetIDs.has(assetID)) {
      throw new Error(`Imagery "${assetID}" already merged`);
    }

    this._loadedAssetIDs.set(assetID, assetVersion);

    // Process each scope
    const inputScopes = input.scopes ?? [];
    for (const inputScope of inputScopes) {
      const scopeID = inputScope.scope ?? 'osm';

      // Get or create a data cache for this scopeID
      const scope = this.getScope(scopeID);

      // Merge Imagery Sources
      if (inputScope.imagery) {
        for (const [sourceID, props] of Object.entries(inputScope.imagery)) {
          const sourceKey = sourceID.toLowerCase();
          const existing = scope.sources.get(sourceKey);
          if (existing?.isBuiltin()) continue;  // don't override a builtin ImagerySource

          if (props) {   // add or replace
            const setProps = { ...props, id: sourceID, assetID, assetVersion, scopeID } as Partial<ImagerySourceProps>;

            // Instantiate the appropriate `ImagerySource` class
            let source: ImagerySource;
            if (props.type === 'bing') {
              source = new ImagerySourceBing(context, setProps);
            } else if (props.type === 'wayback' && wayback) {    // if the WaybackService exists..
              source = new ImagerySourceEsriWayback(context, setProps);
            } else if (/^EsriWorldImagery/.test(sourceID)) {
              source = new ImagerySourceEsri(context, setProps);
            } else {
              source = new ImagerySource(context, setProps);
            }
            scope.sources.set(sourceKey, source);

            // Save the GeoJSON feature too, if there is one.
            if (props.feature) {
              this.features.set(sourceKey, props.feature);
            }

          } else {   // remove
            utilWildcardDelete(scope.sources, sourceKey);
            utilWildcardDelete(this.features, sourceKey);
          }
        }
      }
    }

    this._rebuildIndex();   // also calls _imageryChanged()
  }


  /**
   * source
   * Returns the ImagerySource with the given id.
   * @param sourceID - a source id
   * @return The ImagerySource, or `undefined` if not found
   */
  source(sourceID?: ImagerySourceID): ImagerySource | undefined {
    if (!sourceID) return undefined;
    return this._findSource(sourceID.toLowerCase());
  }


  /**
   * imageryUsed
   * Called by the EditSystem to gather the sources being used to make an edit.
   * We return the English name of any active imagery layers, it will be included in the user's changeset.
   * @return Array of the names of imagery layers currently visible
   */
  imageryUsed(): string[] {
    const results = new Set<string>();

    // Gather info about enabled base imagery
    const baseUsed = this._baseLayer?.imageryUsed;
    if (baseUsed && this._isValid) {
      results.add(baseUsed);
    }

    // Gather info about enabled overlay imagery (ignore locator)
    for (const overlay of this._overlayLayers.values()) {
      if (overlay.isLocatorOverlay()) continue;
      if (overlay.imageryUsed) {
        results.add(overlay.imageryUsed);
      }
    }

    return [...results];
  }


  /**
   * visibleSources
   * Returns array of known imagery sources that are valid at the given extent and zoom
   * @return Visible imagery sources
   */
  visibleSources(): ImagerySource[] {
    if (!this.sources.size || !this._whichPolygon) return [];   // called too soon?

    const context = this.context;
    const viewport = context.viewport;
    const extent = viewport.visibleExtent();
    const zoom = viewport.transform.zoom;

    const visible = new Set<ImagerySourceID>();
    const bbox = extent.rectangle() as Vec4;
    (this._whichPolygon.bbox(bbox, true) || [])
      .forEach((d: { id: ImagerySourceID }) => visible.add(d.id));

    const currSource = this._baseLayer;
    const sources = [...this.sources.values()];

    // Recheck blocked sources only if we detect new blocklists pulled from the OSM API.
    const osm = context.services.osm;
    const blocklists: RegExp[] = osm?.imageryBlocklists ?? [];
    const blocklistChanged = (blocklists.length !== this._checkedBlocklists.length) ||
      blocklists.some((regex, index) => String(regex) !== this._checkedBlocklists[index]);

    if (blocklistChanged) {
      for (const source of sources) {
        source.props.isBlocked = blocklists.some(regex => regex.test(source.template));
      }
      this._checkedBlocklists = blocklists.map(regex => String(regex));
    }

    return sources.filter(source => {
      if (currSource === source) return true;    // always include the current imagery
      if (source.props.isBlocked) return false;  // even default sources may be blocked - iD#7905
      if (!source.props.feature) return true;    // always include imagery with worldwide coverage
      if (zoom && zoom < 6) return false;        // optionally exclude local imagery at low zooms
      return visible.has(source.id);             // include imagery visible in given extent
    });
  }


  /**
   * baseLayerSource
   * Gets or sets the base layer source.
   * @param source - optional ImagerySource to set as base layer
   * @return The current base layer source when getting, or `this` when setting
   */
  baseLayerSource(source?: ImagerySource): ImagerySource | null | this {
    if (!arguments.length) return this._baseLayer;

    // test source against OSM imagery blocklists..
    const osm = this.context.services.osm;
    if (!osm) return this;

    const blocklists: RegExp[] = osm?.imageryBlocklists ?? [];
    const template = source!.template;
    let fail = false;
    let tested = 0;
    let regex: RegExp;

    for (regex of blocklists) {
      fail = regex.test(template);
      tested++;
      if (fail) break;
    }

    // ensure at least one test was run.
    if (!tested) {
      regex = /.*\.google(apis)?\..*\/(vt|kh)[\?\/].*([xyz]=.*){3}.*/;
      fail = regex.test(template);
    }

    this._baseLayer = (!fail ? source! : this.getSourceByID('none')!);

    this._imageryChanged();
    return this;
  }


  /**
   * chooseDefaultSource
   * When we haven't been told to use a specific background imagery,
   * this tries several options to pick an appropriate imagery to use.
   * @return The chosen default ImagerySource
   */
  chooseDefaultSource(): ImagerySource {
    const context = this.context;
    const storage = context.systems.storage;

    const available = this.visibleSources();
    const first = available[0];
    const best = available.find(s => s.props.best);

    // Consider previously chosen imagery unless it was 'none'
    const previousID = storage?.getItem('background-last-used') || 'none';
    const previous = (previousID !== 'none') && this.getSourceByID(previousID);

    return best ||
      previous ||
      this.getSourceByID('Bing') ||
      first ||    // maybe this is a custom Rapid that doesn't include Bing?
      this.getSourceByID('none')!;
  }


  /**
   * getSourceByID
   * Returns an ImagerySource for the given `sourceID`
   * @param sourceID - The sourceID to get
   * @return The `ImagerySource` with the given ID, or `undefined` if not found
   */
  getSourceByID(sourceID: ImagerySourceID = ''): ImagerySource | undefined {
    if (/^EsriWayback/i.test(sourceID)) {   // ignore start date, if any
      sourceID = 'EsriWayback';
    }
    return this._findSource(sourceID.toLowerCase());
  }


  /**
   * setSourceByID
   * Activates the base layer with the given `sourceID`
   * This function will correctly handle IDs like `EsriWayback_<DATE>`.
   * @param sourceID - The sourceID to activate
   */
  setSourceByID(sourceID: ImagerySourceID = ''): void {
    let date: string | undefined;
    const match = sourceID.match(/^EsriWayback\_?(.*)$/i);   // get start date, if any
    if (match) {
      sourceID = 'EsriWayback';
      date = match[1];
    }

    const source = this.getSourceByID(sourceID);
    if (source) {
      if (date) {
        (source as ImagerySourceEsriWayback).date = date;
      }
      this.baseLayerSource(source);
    }
  }


  /**
   * showsLayer
   * Checks if the given source is currently being shown (as base or overlay)
   * @param source - The imagery source to check
   * @return `true` if the source is currently visible
   */
  showsLayer(source?: ImagerySource): boolean {
    const currSource = this._baseLayer;
    if (!source || !currSource) return false;
    return source.id === currSource.id || this._overlayLayers.has(source.id);
  }


  /**
   * overlayLayerSources
   * Returns the current overlay imagery sources
   * @return Array of overlay ImagerySource objects
   */
  overlayLayerSources(): ImagerySource[] {
    return [...this._overlayLayers.values()];
  }


  /**
   * toggleOverlayLayer
   * Toggles an overlay layer on or off
   * @param source - The imagery source to toggle
   */
  toggleOverlayLayer(source: ImagerySource): void {
    if (this._overlayLayers.has(source.id)) {
      this._overlayLayers.delete(source.id);
    } else {
      this._overlayLayers.set(source.id, source);
    }
    this._imageryChanged();
  }


  /**
   * enableOverlayLayers
   * This makes sure that only the overlays identified by `enableIDs` are in the list
   * ignoring the "locator overlay"
   * @param enableIDs - Iterable Set or Array of sourceIDs to enable
   */
  enableOverlayLayers(enableIDs: Iterable<ImagerySourceID>): void {
    for (const [sourceID, source] of this._overlayLayers) {
      if (source.isLocatorOverlay()) continue;  // ignore this one
      this._overlayLayers.delete(sourceID);     // remove all others
    }

    for (const enableID of enableIDs) {             // add what belongs
      const source = this.getSourceByID(enableID);  // note that enableID is case insensitive
      if (source) {
        this._overlayLayers.set(source.id, source);
      }
    }

    this._imageryChanged();
  }


  /**
   * nudge
   * Nudge offset, in delta pixels [dx,dy]
   * @param delta - pixels to nudge, as [dx, dy]
   * @param _zoom - the current zoom (unused, obtained from viewport)
   */
  nudge(delta: Vec2, _zoom?: number): void {
    if (this._baseLayer) {
      const zoom = this.context.viewport.transform.zoom;
      this._baseLayer.nudge(delta, zoom);
      this._imageryChanged();
    }
  }


  /**
   * offset
   * Gets the current imagery offset in pixels [x, y]
   */
  get offset(): Vec2 {
    return this._baseLayer?.offset ?? [0, 0];
  }

  /**
   * offset
   * Sets the imagery offset in pixels [x, y]
   */
  set offset([setX, setY]: Vec2) {
    const [currX, currY] = this._baseLayer?.offset ?? [0, 0];
    if (setX === currX && setY === currY) return;  // no change

    if (this._baseLayer) {
      this._baseLayer.offset = [setX, setY];
      this._imageryChanged();
    }
  }

  /**
   * brightness
   * Gets the current brightness value (default 1)
   */
  get brightness(): number {
    return this._brightness;
  }

  /**
   * brightness
   * Sets the brightness value
   */
  set brightness(val: number) {
    if (val === this._brightness) return;  // no change
    this._brightness = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setBrightness(val);
    this._imageryChanged();
  }

  /**
   * contrast
   * Gets the current contrast value (default 1)
   */
  get contrast(): number {
    return this._contrast;
  }

  /**
   * contrast
   * Sets the contrast value
   */
  set contrast(val: number) {
    if (val === this._contrast) return;  // no change
    this._contrast = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setContrast(val);
    this._imageryChanged();
  }

  /**
   * saturation
   * Gets the current saturation value (default 1)
   */
  get saturation(): number {
    return this._saturation;
  }

  /**
   * saturation
   * Sets the saturation value
   */
  set saturation(val: number) {
    if (val === this._saturation) return;  // no change
    this._saturation = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setSaturation(val);
    this._imageryChanged();
  }

  /**
   * sharpness
   * Gets the current sharpness value (default 1)
   */
  get sharpness(): number {
    return this._sharpness;
  }

  /**
   * sharpness
   * Sets the sharpness value
   */
  set sharpness(val: number) {
    if (val === this._sharpness) return;  // no change
    this._sharpness = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setSharpness(val);
    this._imageryChanged();
  }

  /**
   * numGridSplits
   * Gets the current number of grid splits (default 0)
   */
  get numGridSplits(): number {
    return this._numGridSplits;
  }

  /**
   * numGridSplits
   * Sets the number of grid splits
   */
  set numGridSplits(val: number) {
    if (val === this._numGridSplits) return;  // no change
    this._numGridSplits = val;
    this._imageryChanged();
  }


  /**
   * _rebuildIndex
   * Reset all sources and rebuild the whichPolygon spatial index.
   * This should be called after merging new imagery data.
   */
  private _rebuildIndex(): void {
    // Reset and localize the ImagerySources
    for (const scope of this._scopes.values()) {
      for (const source of scope.sources.values()) {
        source.reset();
      }
    }

    // Reset and rebuild the whichPolygon index
    const features = [...this.features.values()];
    this._whichPolygon = whichPolygon({ type: 'FeatureCollection', features: features });

    // Reset the blocklist check so it re-runs
    this._checkedBlocklists = [];

    // Emit the imagerychange event
    this._imageryChanged();
  }


  /**
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    let loadPromise = Promise.resolve();

    // imagery
    // AssetIDs to request, e.g. `imagery=default,my_imagery`
    const newImagery = currParams.get('imagery');
    const oldImagery = prevParams.get('imagery');
    if (newImagery !== oldImagery) {
      if (typeof newImagery === 'string') {
        this.requestedAssetIDs = utilExtractValues(newImagery).filter(Boolean);
      } else {
        this.requestedAssetIDs = null;
      }
      loadPromise = this.loadImageryAssetsAsync();
    }

    // Handle any change in the imagery index first, then consider the other parameters.
    loadPromise.then(() => {
      // background
      const newBackground = currParams.get('background') || '';
      const oldBackground = prevParams.get('background') || '';
      if (!newBackground || newBackground !== oldBackground) {
        const foundSource = this.getSourceByID(newBackground);
        if (foundSource) {
          this.setSourceByID(newBackground!);  // Calling `setSourceByID` handles Esri Wayback w/date
        } else {
          this.baseLayerSource(this.chooseDefaultSource());
        }
      }

      // overlays
      const newOverlays = currParams.get('overlays') || '';
      const oldOverlays = prevParams.get('overlays') || '';
      if (newOverlays !== oldOverlays) {
        const vals = utilExtractValues(newOverlays).filter(Boolean);
        const toEnableIDs = new Set<ImagerySourceID>(vals);
        this.enableOverlayLayers(toEnableIDs);
      }

      // offset
      const newOffset = currParams.get('offset') || '';
      const oldOffset = prevParams.get('offset') || '';
      if (newOffset !== oldOffset) {
        let [x, y] = newOffset.split(/[;,]/).map(s => s.trim()).map(Number);
        if (!Number.isFinite(x)) x = 0;
        if (!Number.isFinite(y)) y = 0;
        this.offset = geoMetersToOffset([x, y]) as Vec2;
      }
    });
  }


  /**
   * _imageryChanged
   * Called whenever the imagery changes.
   * This will update the urlhash, trigger a redraw, and emit an 'imagerychange' event.
   */
  private _imageryChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;

    const baseLayer = this._baseLayer;
    if (urlhash && baseLayer && !context.inIntro) {
      // Gather info about enabled base imagery
      let baseLayerID = baseLayer.key;  // note: use `key` here - for Wayback it will include the date
      if (baseLayerID === 'custom') {
        baseLayerID = `custom:${baseLayer.template}`;
      }

      // Gather info about enabled overlay imagery (ignore locator)
      const overlayIDs: ImagerySourceID[] = [];
      for (const overlay of this._overlayLayers.values()) {
        if (overlay.isLocatorOverlay()) continue;
        overlayIDs.push(overlay.id);
      }

      // Update hash params: 'background', 'overlays', 'offset'
      urlhash.setParam('background', baseLayerID);
      urlhash.setParam('overlays', overlayIDs.length ? overlayIDs.join(',') : null);

      const meters = geoOffsetToMeters(baseLayer.offset);
      const EPSILON = 0.01;
      const x = +meters[0].toFixed(2);
      const y = +meters[1].toFixed(2);
      urlhash.setParam('offset', (Math.abs(x) > EPSILON || Math.abs(y) > EPSILON) ? `${x},${y}` : null);
    }

    gfx?.immediateRedraw();
    this.emit('imagerychange');
  }


  /**
   * _localeChanged
   * Call this whenever the locale changes.
   * It will lock in the new locale and relocalize all the imagery sources.
   * These are cached, so switching back to an already-seen locale should be fast.
   * @param localeCode - optional new locale code (fallback to getting it from LocalizationSystem, or en-US)
   */
  private _localeChanged(localeCode?: string): void {
    const l10n = this.context.systems.l10n;

    // Ensure that we have a current locale code.
    localeCode ||= l10n?.localeCode ?? 'en-US';

    // Reset and localize the ImagerySources
    for (const scope of this._scopes.values()) {
      for (const source of scope.sources.values()) {
        source.setLocale(localeCode);
      }
    }
  }


  /**
   * _findSource
   * Searches across all scopes for an ImagerySource with the given key.
   * @param sourceKey - Lowercase source key to find
   * @return The ImagerySource, or `undefined` if not found in any scope
   */
  private _findSource(sourceKey: ImagerySourceID): ImagerySource | undefined {
    for (const scope of this._scopes.values()) {
      const source = scope.sources.get(sourceKey);
      if (source) return source;
    }
    return undefined;
  }

}
