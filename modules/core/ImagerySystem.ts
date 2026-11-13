import { AbstractSystem } from './AbstractSystem.ts';
import { geoMetersToOffset, geoOffsetToMeters } from '@rapid-sdk/math';
import {
  ImagerySource, ImagerySourceBing, ImagerySourceCustom,
  ImagerySourceEsri, ImagerySourceEsriWayback, ImagerySourceNone
} from '../lib/ImagerySource.ts';
import { utilExtractValues, utilWildcardDelete } from '../util/string.ts';
import { utilIterable } from '../util/iterable.ts';
import whichPolygon from 'which-polygon';

import type { Context } from '../Context.ts';
import type { ImagerySourceProps } from '../lib/ImagerySource.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { PixiLayerBackgroundTiles } from '../pixi/PixiLayerBackgroundTiles.ts';
import type { Vec2 } from '@rapid-sdk/math';


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
 * - `sources` -   `Map<ImagerySourceID, ImagerySource>` - Computed aggregate of all scopes
 * - `features` -  `Map<ImagerySourceID, GeoJSON.Feature>` - Imagery geofences
 * - `defaultAssetIDs` - Default assetIDs that are loaded if no custom assets are requested
 * - `loadedAssetIDs`  - `Map<AssetID, string>` - assetIDs that have been loaded (maps to version string)
 * - `offset`
 * - `brightness`
 * - `contrast`
 * - `saturation`
 * - `sharpness`
 * - `numGridSplits`
 *
 * Events available:
 * - `imagerychange` - Fires on any change in imagery or display options
 */
export class ImagerySystem extends AbstractSystem {

  /** Imagery geofences, keyed by ImagerySourceID (lowercase) */
  public features: Map<ImagerySourceID, GeoJSON.Feature>;

  /** Per-scope storage */
  protected _scopes: Map<ScopeID, ImageryScope>;

  /** Default imagery file assetIDs */
  protected _defaultAssetIDs: Set<AssetID>;
  /** Currently loaded imagery file assetIDs, maps to the version string that was loaded, if known */
  protected _loadedAssetIDs: Map<AssetID, string>;
  /** Requested imagery file assetIDs - optional, these can be different than the default files */
  protected _requestedAssetIDs: Set<AssetID> | null;

  /** Currently active base (background) imagery source */
  protected _baseLayer: ImagerySource | null;
  /** Active overlay imagery sources keyed by ImagerySourceID */
  protected _overlayLayers: Map<ImagerySourceID, ImagerySource>;
  /** Blocklist URL patterns that have already been checked and applied */
  protected _checkedBlocklists: string[];
  /** Whether the current base layer URL is valid (not blocked) */
  protected _isValid: boolean;  // todo, find a new way to check this, no d3 enter/update render anymore
  /** Spatial index for matching a lat/lon to imagery coverage polygons */
  protected _whichPolygon: whichPolygon.Query<{ id: ImagerySourceID }> | null;

  /** CSS filter brightness value (0–2, default 1) */
  protected _brightness: number;
  /** CSS filter contrast value (0–2, default 1) */
  protected _contrast: number;
  /** CSS filter saturation value (0–2, default 1) */
  protected _saturation: number;
  /** CSS filter sharpness (actually an unsharp-mask) value (0–2, default 1) */
  protected _sharpness: number;
  /** Number of grid splits to apply when splitting tiles for alignment correction */
  protected _numGridSplits: number;

  /** Whether the url has set up the imagery (again after an `imagery=` reload); nothing is saved before that */
  protected _settled: boolean;
  /** Whether `_hashChanged` is applying the url's imagery, so the change isn't the user's: it isn't saved, and the url keeps its params */
  protected _isApplyingUrl: boolean;
  /** The base imagery last seen, as the url names it, to find what the user changed */
  protected _shownBackground: string;
  /** The overlays last seen (not the locator overlay), to find what the user changed */
  protected _shownOverlayIDs: Set<ImagerySourceID>;
  /** The offset last seen, as the url names it, to find what the user changed */
  protected _shownOffset: string;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'imagery';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['assets', 'gfx', 'l10n', 'settings', 'urlhash']);

    this._scopes = new Map<ScopeID, ImageryScope>();
    this.features = new Map<ImagerySourceID, GeoJSON.Feature>();

    this._defaultAssetIDs = new Set<AssetID>(['editor_layer_index', 'rapid_imagery']);
    this._loadedAssetIDs = new Map<AssetID, string>();
    this._requestedAssetIDs = null;

    this._baseLayer = null;
    this._overlayLayers = new Map<ImagerySourceID, ImagerySource>();
    this._checkedBlocklists = [];
    this._isValid = true;
    this._whichPolygon = null;

    this._brightness = 1;
    this._contrast = 1;
    this._saturation = 1;
    this._sharpness = 1;
    this._numGridSplits = 0; // No grid by default.

    this._settled = false;
    this._isApplyingUrl = false;
    this._shownBackground = '';
    this._shownOverlayIDs = new Set<ImagerySourceID>();
    this._shownOffset = '';

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._imageryChanged = this._imageryChanged.bind(this);
    this._localeChanged = this._localeChanged.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const gfx = context.systems.gfx;
    const l10n = context.systems.l10n;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    // Settings that follow the user to other browsers
    settings?.registerSync(['imagery.favorites', 'imagery.lastUsed', 'imagery.opacity', 'imagery.overlays']);
    // Settings kept in this browser (a custom template may hold an access token)
    settings?.registerLocal(['imagery.custom', 'imagery.lastUsedToggle']);

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          gfx?.initAsync(),      // `gfx.scene` will exist after `initAsync`
          l10n?.initAsync(),
          settings?.initAsync(),
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
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Loads the imagery source definitions from the assets system.
   * @return Promise fulfilled when the imagery has been loaded
   */
  public loadImageryAssetsAsync(): Promise<void> {
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
   * This puts the ImagerySystem internal data back to its initial state, i.e. no imagery.
   */
  public resetAll(): void {
    const context = this.context;
    const settings = context.systems.settings;

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
    custom.template = settings?.get('imagery.custom[0].template') ?? '';
    common.sources.set(custom.id.toLowerCase(), custom);

    this._baseLayer = none;
    this._overlayLayers.clear();

    this._rebuildIndex();    // also calls _imageryChanged()
  }


  /**
   * Returns an aggregate Map of all ImagerySource objects across all scopes.
   * Sources from later scopes override sources from earlier scopes with the same key.
   * @return  Aggregate map of all sources
   * @readonly
   */
  public get sources(): Map<ImagerySourceID, ImagerySource> {
    const all = new Map<ImagerySourceID, ImagerySource>();
    for (const scope of this._scopes.values()) {
      for (const [id, source] of scope.sources) {
        all.set(id, source);
      }
    }
    return all;
  }


  /**
   * Get the scope data for a specific scope ID.
   * If the scope doesn't exist yet, it is created and cached automatically.
   * @param scopeID - ID of the scope to look up
   * @return The scope data
   */
  public getScope(scopeID: ScopeID): ImageryScope {
    let scope = this._scopes.get(scopeID);
    if (!scope) {
      scope = {
        sources: new Map<ImagerySourceID, ImagerySource>()
      };
      this._scopes.set(scopeID, scope);
    }
    return scope;
  }


  /**
   * Returns the default assetIDs. These are the imagery assets that Rapid will load by default.
   * @return  Default assetIDs
   * @readonly
   */
  public get defaultAssetIDs(): Set<AssetID> {
    return this._defaultAssetIDs;
  }

  /**
   * Returns the loaded assetIDs, along with their version numbers if known.
   * @return  Loaded assetIDs
   * @readonly
   */
  public get loadedAssetIDs(): Map<AssetID, string> {
    return this._loadedAssetIDs;
  }

  /**
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
  public set requestedAssetIDs(vals: OneOrMore<AssetID> | null) {
    if (vals === null || vals === undefined) {
      this._requestedAssetIDs = null;
      return;
    }

    this._requestedAssetIDs = new Set<AssetID>();
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
  /** Returns the currently requested imagery asset IDs, or null if using defaults.
   * @return  The requested asset IDs, or `null` when using defaults
   */
  public get requestedAssetIDs(): Set<AssetID> | null {
    return this._requestedAssetIDs;
  }


  /**
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
  public merge(input: ImageryInput): void {
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
   * Returns the ImagerySource with the given id.
   * @param sourceID - a source id
   * @return The ImagerySource, or `undefined` if not found
   */
  public source(sourceID?: ImagerySourceID): ImagerySource | undefined {
    if (!sourceID) return undefined;
    return this._findSource(sourceID.toLowerCase());
  }


  /**
   * Called by the EditSystem to gather the sources being used to make an edit.
   * We return the English name of any active imagery layers, it will be included in the user's changeset.
   * @return Array of the names of imagery layers currently visible
   */
  public imageryUsed(): string[] {
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
   * Returns array of known imagery sources that are valid at the given location and zoom.
   * @return Visible imagery sources
   */
  public visibleSources(): ImagerySource[] {
    if (!this.sources.size || !this._whichPolygon) return [];   // called too soon?

    const context = this.context;
    const viewport = context.viewport;
    const loc = viewport.centerLoc();
    const zoom = viewport.transform.zoom;

    const visible = new Set<ImagerySourceID>();
    (this._whichPolygon(loc, true) ?? [])
      .forEach(d => visible.add(d.id));

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
   * Gets or sets the base layer source.
   * @param source - optional ImagerySource to set as base layer
   * @return The current base layer source when getting, or `this` when setting
   */
  public baseLayerSource(source?: ImagerySource): ImagerySource | null | this {
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
   * When we haven't been told to use a specific background imagery,
   * try several options to pick an appropriate imagery to use.
   * @return The chosen default ImagerySource
   */
  public chooseDefaultSource(): ImagerySource {
    const context = this.context;
    const settings = context.systems.settings;

    // Exclude overlays, 'none', or Custom with empty template,
    // Only real background imagery worth looking at.
    const visible = this.visibleSources().filter(s => {
      if (s.props.overlay) return false;
      if (s.id === 'none') return false;
      if ((s instanceof ImagerySourceCustom) && !s.template) return false;
      return true;
    });

    const first = visible[0];
    const best = visible.find(s => s.props.best);

    // Consider previously used imagery, if visible, unless it was 'none'
    // (The user's own choice wins over the 'best' imagery)
    const previousID = settings?.get('imagery.lastUsed') || 'none';
    const previous = (previousID !== 'none') && visible.find(s => s.id === previousID);

    return previous ||
      best ||
      first ||
      this.getSourceByID('Bing') ||  // fallback to Bing
      this.getSourceByID('none')!;   // maybe this is a custom Rapid that doesn't include Bing?
  }


  /**
   * Returns an ImagerySource for the given `sourceID`
   * @param sourceID - The sourceID to get
   * @return The `ImagerySource` with the given ID, or `undefined` if not found
   */
  public getSourceByID(sourceID: ImagerySourceID = ''): ImagerySource | undefined {
    if (/^EsriWayback/i.test(sourceID)) {   // ignore start date, if any
      sourceID = 'EsriWayback';
    }
    return this._findSource(sourceID.toLowerCase());
  }


  /**
   * Activates the base layer with the given `sourceID`
   * This function will correctly handle IDs like `EsriWayback_<DATE>`.
   * @param sourceID - The sourceID to activate
   */
  public setSourceByID(sourceID: ImagerySourceID = ''): void {
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
   * Checks if the given source is currently being shown (as base or overlay)
   * @param source - The imagery source to check
   * @return `true` if the source is currently visible
   */
  public showsLayer(source?: ImagerySource): boolean {
    const currSource = this._baseLayer;
    if (!source || !currSource) return false;
    return source.id === currSource.id || this._overlayLayers.has(source.id);
  }


  /**
   * Returns the current overlay imagery sources
   * @return Array of overlay ImagerySource objects
   */
  public overlayLayerSources(): ImagerySource[] {
    return [...this._overlayLayers.values()];
  }


  /**
   * Toggles an overlay layer on or off
   * @param source - The imagery source to toggle
   */
  public toggleOverlayLayer(source: ImagerySource): void {
    if (this._overlayLayers.has(source.id)) {
      this._overlayLayers.delete(source.id);
    } else {
      this._overlayLayers.set(source.id, source);
    }
    this._imageryChanged();
  }


  /**
   * This makes sure that only the overlays identified by `enableIDs` are in the list
   * ignoring the "locator overlay"
   * @param enableIDs - Iterable Set or Array of sourceIDs to enable
   */
  public enableOverlayLayers(enableIDs: Iterable<ImagerySourceID>): void {
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
   * Nudge offset, in delta pixels [dx,dy]
   * @param delta - pixels to nudge, as [dx, dy]
   * @param _zoom - the current zoom (unused, obtained from viewport)
   */
  public nudge(delta: Vec2, _zoom?: number): void {
    if (this._baseLayer) {
      const zoom = this.context.viewport.transform.zoom;
      this._baseLayer.nudge(delta, zoom);
      this._imageryChanged();
    }
  }


  /**
   * Gets the current imagery offset in pixels [x, y]
   * @return  Current `[x, y]` pixel offset for the base imagery layer
   */
  public get offset(): Vec2 {
    return this._baseLayer?.offset ?? [0, 0];
  }

  /**
   * Sets the imagery offset in pixels [x, y]
   * @param val - `[x, y]` pixel offset to apply to the base imagery layer
   */
  public set offset([setX, setY]: Vec2) {
    const [currX, currY] = this._baseLayer?.offset ?? [0, 0];
    if (setX === currX && setY === currY) return;  // no change

    if (this._baseLayer) {
      this._baseLayer.offset = [setX, setY];
      this._imageryChanged();
    }
  }

  /**
   * Gets the current brightness value (default 1)
   * @return  Current brightness multiplier (1 = normal)
   */
  public get brightness(): number {
    return this._brightness;
  }

  /**
   * Sets the brightness value
   * @param val - Brightness multiplier (1 = normal)
   */
  public set brightness(val: number) {
    if (val === this._brightness) return;  // no change
    this._brightness = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setBrightness(val);
    this._imageryChanged();
  }

  /**
   * Gets the current contrast value (default 1)
   * @return  Current contrast multiplier (1 = normal)
   */
  public get contrast(): number {
    return this._contrast;
  }

  /**
   * Sets the contrast value
   * @param val - Contrast multiplier (1 = normal)
   */
  public set contrast(val: number) {
    if (val === this._contrast) return;  // no change
    this._contrast = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setContrast(val);
    this._imageryChanged();
  }

  /**
   * Gets the current saturation value (default 1)
   * @return  Current saturation multiplier (1 = normal)
   */
  public get saturation(): number {
    return this._saturation;
  }

  /**
   * Sets the saturation value
   * @param val - Saturation multiplier (1 = normal)
   */
  public set saturation(val: number) {
    if (val === this._saturation) return;  // no change
    this._saturation = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setSaturation(val);
    this._imageryChanged();
  }

  /**
   * Gets the current sharpness value (default 1)
   * @return  Current sharpness multiplier (1 = normal)
   */
  public get sharpness(): number {
    return this._sharpness;
  }

  /**
   * Sets the sharpness value
   * @param val - Sharpness multiplier (1 = normal)
   */
  public set sharpness(val: number) {
    if (val === this._sharpness) return;  // no change
    this._sharpness = val;

    const gfx = this.context.systems.gfx;
    const layer = gfx?.scene?.layers?.get('background') as PixiLayerBackgroundTiles;
    layer?.setSharpness(val);
    this._imageryChanged();
  }

  /**
   * Gets the current number of grid splits (default 0)
   * @return  Current grid-split count (0 = no splits)
   */
  public get numGridSplits(): number {
    return this._numGridSplits;
  }

  /**
   * Sets the number of grid splits
   * @param val - Number of grid splits (0 = no splits)
   */
  public set numGridSplits(val: number) {
    if (val === this._numGridSplits) return;  // no change
    this._numGridSplits = val;
    this._imageryChanged();
  }


  /**
   * Reset all sources and rebuild the whichPolygon spatial index.
   * This should be called after merging new imagery data.
   */
  protected _rebuildIndex(): void {
    // Reset and localize the ImagerySources
    for (const scope of this._scopes.values()) {
      for (const source of scope.sources.values()) {
        source.reset();
      }
    }

    // Reset and rebuild the whichPolygon index
    const features = [...this.features.values()] as GeoJSON.Feature<GeoJSON.Geometry, { id: ImagerySourceID }>[];
    this._whichPolygon = whichPolygon({ type: 'FeatureCollection', features: features });

    // Reset the blocklist check so it re-runs
    this._checkedBlocklists = [];

    // Emit the imagerychange event
    this._imageryChanged();
  }


  /**
   * Respond to any changes appearing in the url hash.
   * The first url sets up the imagery (see `_setupImagery`).  After that, imagery the user puts
   * in the url overrides the settings, without being saved.
   * (When `background`, `overlays` or `offset` goes away, the imagery stays as it is.)
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  protected _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
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
      this._settled = false;   // the reload starts with no imagery, which isn't the user's choice
      loadPromise = this.loadImageryAssetsAsync();
    }

    // Handle any change in the imagery index first, then consider the other parameters.
    loadPromise.then(() => {
      if (!this._settled) {
        this._setupImagery(currParams);
        return;
      }

      const isNew = (k: string): boolean => currParams.get(k) !== prevParams.get(k);
      this._isApplyingUrl = true;
      try {
        // background
        const background = this._urlValue(currParams, 'background');
        if (background !== undefined && isNew('background')) {
          this._applyBackground(background);
        }

        // overlays
        const overlays = this._urlValue(currParams, 'overlays');
        if (overlays !== undefined && isNew('overlays')) {
          this.enableOverlayLayers(utilExtractValues(overlays).filter(Boolean));
        }

        // offset
        const offset = this._urlValue(currParams, 'offset');
        if (offset !== undefined && isNew('offset')) {
          this.offset = geoMetersToOffset(this._parseOffset(offset)) as Vec2;
        }
      } finally {
        this._isApplyingUrl = false;
      }
    });
  }


  /**
   * Sets up the imagery from the url, at startup and after an `imagery=` reload:
   * the imagery the url names, or else what the user saved, without saving any of it.
   * (Saved overlays are only shown where they can be seen, so they aren't credited in changesets elsewhere.)
   * @param params - The url's params
   */
  protected _setupImagery(params: Map<string, string>): void {
    // background
    const background = this._urlValue(params, 'background');
    if (background === undefined || !this._applyBackground(background)) {
      this.baseLayerSource(this.chooseDefaultSource());
    }

    // overlays
    const overlays = this._urlValue(params, 'overlays');
    if (overlays !== undefined) {
      this.enableOverlayLayers(utilExtractValues(overlays).filter(Boolean));
    } else {
      const visibleIDs = new Set<ImagerySourceID>(this.visibleSources().map(source => source.id));
      this.enableOverlayLayers(this._readSavedOverlays().filter(sourceID => visibleIDs.has(sourceID)));
    }

    // offset
    const offset = this._urlValue(params, 'offset');
    if (offset !== undefined) {
      this.offset = geoMetersToOffset(this._parseOffset(offset)) as Vec2;
    }

    this._settled = true;
  }


  /**
   * Returns a url param's value, unless it was dropped since, by a change made while the same url was being read.
   * @param params - The url's params, as they were emitted
   * @param k - The param to get
   * @return The param's value, or `undefined` if it isn't in the url
   */
  protected _urlValue(params: Map<string, string>, k: string): string | undefined {
    const urlhash = this.context.systems.urlhash;
    const val = params.get(k);
    return (val !== undefined && urlhash?.getParam(k) === val) ? val : undefined;
  }


  /**
   * Shows the base imagery named by a url `background` value.
   * It can be a sourceID (Esri Wayback can include a date), or `custom:<template>`.
   * @param val - The url's value
   * @return `true` if the imagery was found and shown
   */
  protected _applyBackground(val: string): boolean {
    if (/^custom:/i.test(val)) {
      const custom = this.getSourceByID('custom');
      const template = val.slice(7);
      if (!(custom instanceof ImagerySourceCustom) || !template) return false;
      custom.template = template;
      this.baseLayerSource(custom);
      return true;
    }

    if (!this.getSourceByID(val)) return false;
    this.setSourceByID(val);  // Calling `setSourceByID` handles Esri Wayback w/date
    return true;
  }


  /**
   * Returns the base imagery as a url `background` value names it.
   * @return The value, or '' if there is no base imagery
   */
  protected _backgroundValue(): string {
    const baseLayer = this._baseLayer;
    if (!baseLayer) return '';

    const baseLayerID = baseLayer.key;  // note: use `key` here - for Wayback it will include the date
    return baseLayerID === 'custom' ? `custom:${baseLayer.template}` : baseLayerID;
  }


  /**
   * Checks whether a url `background` value names the base imagery being shown.
   * @param val - The url's value
   * @return `true` if it does
   */
  protected _matchesBackground(val: string): boolean {
    const baseLayer = this._baseLayer;
    if (!baseLayer) return false;

    if (/^custom:/i.test(val)) {
      return this._backgroundValue() === `custom:${val.slice(7)}`;
    }
    if (this.getSourceByID(val) !== baseLayer) return false;

    // A date for Esri Wayback has to match too (it shows the closest release to the date)
    const date = val.match(/^EsriWayback_(.+)$/i)?.[1];
    if (!date) return true;
    const wayback = this.context.services.wayback;
    return (wayback?.chooseClosestDate(date) ?? date) === (baseLayer as ImagerySourceEsriWayback).date;
  }


  /**
   * Parses a url `offset` value, in meters, e.g. `offset=-10.5,20`
   * @param val - The url's value
   * @return The offset in meters, as [x, y]
   */
  protected _parseOffset(val: string): Vec2 {
    let [x, y] = val.split(/[;,]/).map(s => s.trim()).map(Number);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    return [x, y];
  }


  /**
   * Returns an offset as a url `offset` value names it.
   * @param meters - The offset in meters, as [x, y]
   * @return The value, or '' for no offset
   */
  protected _offsetValue(meters: Vec2): string {
    const EPSILON = 0.01;
    const x = +meters[0].toFixed(2);
    const y = +meters[1].toFixed(2);
    return (Math.abs(x) > EPSILON || Math.abs(y) > EPSILON) ? `${x},${y}` : '';
  }


  /**
   * Reads the overlays the user saved in settings.
   * @return The saved overlay sourceIDs
   */
  protected _readSavedOverlays(): ImagerySourceID[] {
    const settings = this.context.systems.settings;
    const saved = settings?.get<ImagerySourceID[]>('imagery.overlays');
    return Array.isArray(saved) ? saved : [];
  }


  /**
   * Called whenever the imagery changes.
   * This will save what the user changed, trigger a redraw, and emit an 'imagerychange' event.
   * The user's base imagery is saved as `imagery.lastUsed`, and the overlays they turn on or off in
   * `imagery.overlays` (only those, so overlays a link shows for this session don't replace the user's).
   * Nothing is saved while the url or settings set the imagery, or in the walkthrough.  The offset isn't saved.
   * The imagery isn't written to the url: a link's `background`, `overlays` and `offset` stay there only
   * until the imagery no longer matches them, and then they're dropped (see `API.md`).
   */
  protected _imageryChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    // What changed since this was last called (ignore the locator overlay)
    const background = this._backgroundValue();
    const overlayIDs = new Set<ImagerySourceID>();
    for (const overlay of this._overlayLayers.values()) {
      if (overlay.isLocatorOverlay()) continue;
      overlayIDs.add(overlay.id);
    }
    const offset = this._offsetValue(geoOffsetToMeters(this.offset));

    const changedBackground = (background !== this._shownBackground);
    const changedOverlayIDs = [...overlayIDs].filter(sourceID => !this._shownOverlayIDs.has(sourceID))
      .concat([...this._shownOverlayIDs].filter(sourceID => !overlayIDs.has(sourceID)));
    const changedOffset = (offset !== this._shownOffset);

    this._shownBackground = background;
    this._shownOverlayIDs = overlayIDs;
    this._shownOffset = offset;

    const changed = changedBackground || changedOverlayIDs.length > 0 || changedOffset;
    if (changed && this._settled && !this._isApplyingUrl && !context.inIntro) {
      if (changedBackground && this._baseLayer) {
        settings?.set('imagery.lastUsed', this._baseLayer.id);
      }

      if (changedOverlayIDs.length) {
        const saved = new Set<ImagerySourceID>(this._readSavedOverlays());
        for (const sourceID of changedOverlayIDs) {
          if (overlayIDs.has(sourceID)) {
            saved.add(sourceID);
          } else {
            saved.delete(sourceID);
          }
        }
        settings?.set('imagery.overlays', [...saved]);
      }

      // drop the url's imagery once it no longer matches (overlays it names that don't exist are ignored)
      const urlBackground = urlhash?.getParam('background');
      if (urlBackground !== undefined && !this._matchesBackground(urlBackground)) {
        urlhash?.setParam('background', null);
      }

      const urlOverlays = urlhash?.getParam('overlays');
      if (urlOverlays !== undefined) {
        const urlIDs = new Set<ImagerySourceID>();
        for (const val of utilExtractValues(urlOverlays)) {
          const source = this.getSourceByID(val);
          if (source && !source.isLocatorOverlay()) {
            urlIDs.add(source.id);
          }
        }
        if (urlIDs.size !== overlayIDs.size || [...urlIDs].some(sourceID => !overlayIDs.has(sourceID))) {
          urlhash?.setParam('overlays', null);
        }
      }

      const urlOffset = urlhash?.getParam('offset');
      if (urlOffset !== undefined && this._offsetValue(this._parseOffset(urlOffset)) !== offset) {
        urlhash?.setParam('offset', null);
      }
    }

    gfx?.immediateRedraw();
    this.emit('imagerychange');
  }


  /**
   * Call this whenever the locale changes.
   * It will lock in the new locale and relocalize all the imagery sources.
   * These are cached, so switching back to an already-seen locale should be fast.
   * @param localeCode - optional new locale code (fallback to getting it from LocalizationSystem, or en-US)
   */
  protected _localeChanged(localeCode?: string): void {
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
   * Searches across all scopes for an ImagerySource with the given key.
   * @param sourceKey - Lowercase source key to find
   * @return The ImagerySource, or `undefined` if not found in any scope
   */
  protected _findSource(sourceKey: ImagerySourceID): ImagerySource | undefined {
    for (const scope of this._scopes.values()) {
      const source = scope.sources.get(sourceKey);
      if (source) return source;
    }
    return undefined;
  }

}
