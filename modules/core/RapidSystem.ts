import { AbstractSystem } from './AbstractSystem.ts';
import { gpx } from '@tmcw/togeojson';
import { Extent } from '@rapid-sdk/math';
import { RapidDataset, RapidDataDictionary, TreeStore } from '../lib/index.ts';
import { utilExtractValues, utilWildcardDelete } from '../util/string.ts';
import { utilIterable } from '../util/iterable.ts';

import type { ConflationSettings } from './ConflationSystem.ts';
import type { Context } from '../Context.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { RapidDataTransform } from '../lib/RapidDataDictionary.ts';
import type { RapidDatasetProps } from '../lib/RapidDataset.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Input format for dataset asset data (see `RapidSystem.merge`).
 */
export interface DatasetInput {
  /** An asset identifier, e.g. 'rapid_datasets' (required) */
  assetID: AssetID;
  /** A string version specifier, e.g. '2026-01-01' */
  assetVersion?: string;
  /** Array of scoped dataset input data, each must contain a scope identifier */
  scopes?: DatasetInputScope[];
}

/**
 * Input format for a single scope of dataset data.
 * Datasets aren't specific to a scope yet; the scopes are applied in order.
 */
export interface DatasetInputScope {
  /** Scope identifier that this input data applies to */
  scope: ScopeID;
  /** Object mapping DatasetID to dataset properties (or null to delete) */
  datasets?: Record<DatasetID, DatasetInputProps | null>;
}

/**
 * A dataset as defined in an asset file: the `RapidDataset` properties in plain JSON types,
 * plus an optional data dictionary. The datasetID is the key it's stored under.
 */
export interface DatasetInputProps extends Omit<Partial<RapidDatasetProps>, 'id' | 'assetID' | 'custom' | 'extent'> {
  /** Bounding extent of the dataset, as `[[minLon, minLat], [maxLon, maxLat]]` */
  extent?: [Vec2, Vec2];
  /** Data dictionary: how the source attributes become OSM tags */
  dictionary?: { transforms?: Partial<RapidDataTransform>[] };
}


/**
 * All persisted settings used by `RapidSystem`,
 * stored by `SettingsSystem` under `rapid.*`.
 */
export interface RapidSettings {
  /** DatasetIDs that should appear on the Rapid menu */
  addedDatasetIDs?: DatasetID[];
  /** DatasetIDs that the user has enabled for display, a subset of addedDatasetIDs */
  enabledDatasetIDs?: DatasetID[];
};

/**
 * The user's changes to a dataset from a service or an asset file: the few things they can change.
 */
export interface DatasetChanges {
  /** Display color */
  color?: string;
  /** Whether the dataset is matched against OpenStreetMap */
  conflated?: boolean;
  /** The conflation settings (show matched, and the rules) */
  conflation?: ConflationSettings;
}

/**
 * What the user saved about one dataset, in the `DatabaseSystem` `datasets` store.
 * - `dataset`: the whole definition of a custom dataset the user added, from `RapidDataset.toJSON()`.
 * - `changes`: the user's changes to a dataset from a service or an asset file.
 * A record usually has one or the other. It can have both if the user's own dataset has the same
 * datasetID as one from an asset file.
 */
export interface DatasetRecord {
  /** The datasetID (the store's key) */
  id: DatasetID;
  /** When the record was last written (ms since epoch) */
  updatedAt: number;
  /** The definition of a custom dataset the user added: plain JSON types */
  dataset?: Record<string, unknown>;
  /** The user's changes to a dataset from a service or an asset file */
  changes?: DatasetChanges;
}


const RAPID_COLORS: readonly string[] = [
  '#ff0000', // Pure Red
  '#ff8c00', // Dark Orange
  '#ffd600', // Gold
  '#adff2f', // Green Yellow
  '#00dd00', // Pure Green
  '#00ffff', // Pure Cyan
  '#00bbff', // Sky Blue
  '#bb88ff', // Amethyst
  '#da26d3', // Rapid Magenta
  '#ff88aa'  // Hot Pink
];


/**
 * `RapidSystem` maintains the catalog of available Rapid datasets,
 * and keeps track of which features have been accepted or ignored.
 * Rapid allows users to work with third party datasets external to OpenStreetMap.
 *
 * The catalog is built in layers: the datasets provided by services, then the datasets
 * defined in asset files (see `merge` and the `datasets=` url parameter), then the
 * custom datasets that the user added themselves.
 *
 * Properties available:
 * - `catalog`     - `Map<DatasetID, RapidDataset>` data structure of all known datasets
 * - `categories`  - `Set<string>` of all known dataset categories (free-text keywords)
 * - `acceptIDs`   - `Set<DataID>` of Data IDs for features accepted by the user
 * - `ignoreIDs`   - `Set<DataID>` of Data IDs for features ignored by the user
 * - `addedDatasetIDs`   - `Set<DatasetID>` of Dataset IDs added to the Rapid menu
 * - `enabledDatasetIDs` - `Set<DatasetID>` of Dataset IDs that are checked as 'visible'
 * - `datasets`    - computed subset of `catalog` - only the datasets that are added to the Rapid menu
 *
 * Events available:
 * - `datasetchange` - Fires when datasets are added/removed from the list
 * - `taskchanged`
 *
 * See `design/rapid-system.md` for the full design.
 */
export class RapidSystem extends AbstractSystem {

  /** Catalog of all the datasets we know about */
  public readonly catalog = new Map<DatasetID, RapidDataset>();
  /** All the dataset 'categories' we know about, free-text keywords attached to datasets */
  public readonly categories = new Set<string>();
  /** IDs of features accepted by the user */
  public readonly acceptIDs = new Set<DataID>();
  /** IDs of features ignored by the user */
  public readonly ignoreIDs = new Set<DataID>();

  /** DatasetIDs that should appear on the Rapid menu */
  public addedDatasetIDs = new Set<DatasetID>();
  /** DatasetIDs that the user has enabled for display, a subset of addedDatasetIDs */
  public enabledDatasetIDs = new Set<DatasetID>();

  /** Bounding extent of the current MapRoulette / task boundary, if any */
  protected _taskExtent: Extent | null = null;
  /** Whether the task boundary is a simple rectangle (null = not yet determined) */
  protected _isTaskBoundsRect: boolean | null = null;
  /** Whether the poweruser setting was active at the last dataset change check */
  protected _hadPoweruser = false;

  /** The assetIDs that Rapid loads datasets from by default */
  protected _defaultAssetIDs: Set<AssetID>;
  /** The assetIDs merged so far, with their versions */
  protected _loadedAssetIDs: Map<AssetID, string>;
  /** The assetIDs requested instead of the defaults, or `null` to use the defaults */
  protected _requestedAssetIDs: Set<AssetID> | null;
  /** The dataset inputs merged so far, in order (applied again whenever the catalog is rebuilt) */
  protected _inputs: DatasetInput[];
  /** The datasets provided by services, gathered at startup */
  protected _serviceDatasets: RapidDataset[];
  /** The `datasets` url parameter that the current dataset assets were loaded for */
  protected _datasetsParam: string | undefined;
  /** Datasets from asset files whose data has started loading */
  protected _setupDatasets: WeakSet<RapidDataset>;
  /** What the user saved about each dataset, as last read from or written to `DatabaseSystem` */
  protected _datasetRecords: Map<DatasetID, DatasetRecord>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'rapid';

    this._defaultAssetIDs = new Set<AssetID>(['rapid_datasets']);
    this._loadedAssetIDs = new Map<AssetID, string>();
    this._requestedAssetIDs = null;
    this._inputs = [];
    this._serviceDatasets = [];
    this._datasetsParam = undefined;
    this._setupDatasets = new WeakSet<RapidDataset>();
    this._datasetRecords = new Map<DatasetID, DatasetRecord>();

    // The addition of "custom" datasets means that RapidSystem needs more dependencies
    // See `RapidDataset.ts` for details.
    // 'assets' - for thumbnailUrl,
    // 'database' - to fetch the data from a sourceFileID,
    // 'network' - to fetch the data from a sourceUrl,
    // 'spatial' - for the custom data,
    // 'l10n' - to localize RapidDataset

    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['assets', 'database', 'editor', 'gfx', 'l10n', 'settings', 'urlhash']);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._stablechange = this._stablechange.bind(this);
    this._datasetsChanged = this._datasetsChanged.bind(this);
    this.isAcceptedOrIgnored = this.isAcceptedOrIgnored.bind(this);
    this.isTaskRectangular = this.isTaskRectangular.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const database = context.systems.database;
    const editor = context.systems.editor;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          database?.initAsync(),
          editor?.initAsync(),
          settings?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        urlhash?.on('hashchange', this._hashChanged);
        editor?.on('stablechange', this._stablechange);

        // Tell AssetSystem about the default dataset file, if it's available.
        assets?.registerAsset('rapid_datasets', { preferred: 'data/rapid_datasets.min.json5' });

        // Honor the `datasets` param now, so that its datasets are in the catalog by the time
        // the lists of added and enabled datasets are set up at startup.
        const param = urlhash?.getParam('datasets');
        if (param !== undefined) {
          this.requestedAssetIDs = utilExtractValues(param).filter(Boolean);
        }
        this._datasetsParam = param;

        return Promise.all([
          this.loadDatasetAssetsAsync(),
          this._readDatasetRecordsAsync()
        ]);
      })
      .then(() => {});
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    // We wait until startAsync to create the dataset catalog because the services need to be initialized.
    const context = this.context;

    const esri = context.services.esri;
    const mapwithai = context.services.mapwithai;
    const overture = context.services.overture;

    // This code is written in a way that we can work with whatever
    // data-providing services are installed.
    const services: any[] = [];
    if (esri)      services.push(esri);
    if (mapwithai) services.push(mapwithai);
    if (overture)  services.push(overture);

    const prerequisites = Promise.all(services.map(service => service.startAsync()));

    return this._startPromise = prerequisites
      .then(() => {
        // Gather all available datasets from the services,
        // then build the catalog with the dataset assets on top.
        this._serviceDatasets = [];
        for (const service of services) {
          const datasets = service.getAvailableDatasets();
          for (const dataset of datasets) {
            this._serviceDatasets.push(dataset);
          }
        }
        this._rebuildCatalog();

        this._setupDatasetLists();
        this._loadDatasetSettings();
        this._datasetsChanged();

        this._started = true;
      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    this.acceptIDs.clear();
    this.ignoreIDs.clear();
    return Promise.resolve();
  }


  /**
   * Add datasets to the Rapid menu.  (Does not set their checked 'enabled' state)
   * @param datasetIDs - datasetIDs to add
   */
  public addDatasets(datasetIDs: OneOrMore<DatasetID>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this.addedDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Checks the dataset as enabled. (Also ensures that the dataset is 'added' to the Rapid menu).
   * @param datasetIDs - datasetIDs to enable
   */
  public enableDatasets(datasetIDs: OneOrMore<DatasetID>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this.addedDatasetIDs.add(datasetID);
      this.enabledDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Remove datasets from the Rapid menu. (Also unchecks their 'enabled' state)
   * @param datasetIDs - datasetIDs to remove
   */
  public removeDatasets(datasetIDs: OneOrMore<DatasetID>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this.addedDatasetIDs.delete(datasetID);
      this.enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Unchecks the dataset as disabled. (Does not affect whether the dataset is 'added' to the Rapid menu)
   * @param datasetIDs - datasetIDs to disable
   */
  public disableDatasets(datasetIDs: OneOrMore<DatasetID>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this.enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Toggles the given datasets enabled state, does not affect any other datasets.
   * @param datasetIDs - datasetIDs to toggle
   */
  public toggleDatasets(datasetIDs: OneOrMore<DatasetID>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this.addedDatasetIDs.add(datasetID);  // it needs to be added to the menu
      if (this.enabledDatasetIDs.has(datasetID)) {
        this.enabledDatasetIDs.delete(datasetID);
      } else {
        this.enabledDatasetIDs.add(datasetID);
      }
    }
    this._datasetsChanged();
  }


  /**
   * The datasets currently added to the Rapid menu.
   * @return The currently added datasets
   */
  public get datasets(): Map<DatasetID, RapidDataset> {
    const results = new Map<DatasetID, RapidDataset>();
    for (const datasetID of this.addedDatasetIDs) {
      const dataset = this.catalog.get(datasetID);
      if (dataset) {
        results.set(datasetID, dataset);
      }
    }
    return results;
  }

  /**
   * The palette of colors available for distinguishing datasets.
   * @return Array of available colors for datasets
   */
  public get colors(): readonly string[] {
    return RAPID_COLORS;
  }

  /**
   * Returns the default assetIDs. These are the dataset assets that Rapid will load by default.
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
   * Allows user to request different dataset asset files than what Rapid uses by default.
   *
   * If set before init time, these assets will be loaded at init time when init calls `loadDatasetAssetsAsync`.
   * You can also change this after init time, but then you'll need to call `loadDatasetAssetsAsync` again.
   *
   * The 'default' keyword is special - if found in the list, it will expand to all the default IDs.
   *
   * You can also pass `null` - in this case the `requestedAssetIDs` list is not used,
   *   and subsequent calls to `loadDatasetAssetsAsync` will use the `defaultAssetIDs` Set.
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
  /** Returns the currently requested dataset asset IDs, or null if using defaults.
   * @return  The requested asset IDs, or `null` when using defaults
   */
  public get requestedAssetIDs(): Set<AssetID> | null {
    return this._requestedAssetIDs;
  }


  /**
   * Loads the dataset definitions from the requested asset files (see `requestedAssetIDs`).
   * This replaces everything merged before, including data passed to `merge()` directly.
   * An assetID that can't be loaded is skipped with a warning. (For example, an old link
   * might still use `datasets=` for the datasetIDs, which are now `dataset_ids=`.)
   * @return Promise resolved when the datasets have been loaded
   */
  public loadDatasetAssetsAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets;

    // Clear out whatever was merged before.
    this._loadedAssetIDs.clear();
    this._inputs = [];

    const updateCatalog = (): void => {
      this._rebuildCatalog();
      if (this._started) {
        this._loadDatasetSettings();
        this._datasetsChanged();
      }
    };

    // Without AssetSystem, there are no dataset files to load.
    if (!assets) {
      updateCatalog();
      return Promise.resolve();
    }

    const which = this._requestedAssetIDs ?? this._defaultAssetIDs;
    const assetIDs = [...which];

    return Promise.allSettled(
      assetIDs.map(assetID => assets.loadAssetAsync(assetID))
    )
    .then(results => {
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          try {
            this._mergeInput(result.value as DatasetInput);
          } catch (err) {
            console.error(err);   // eslint-disable-line no-console
          }
        } else {
          console.warn(`RapidSystem: skipping dataset asset '${assetIDs[i]}':`, result.reason);  // eslint-disable-line no-console
        }
      });
      updateCatalog();
    });
  }


  /**
   * Accepts dataset definitions contained in scope blocks:
   * ```
   * {
   *   assetID: 'my_datasets',
   *   scopes: [{
   *     scope: '*',
   *     datasets: { ... }
   *   }]
   * }
   * ```
   *
   * When merging:
   *  - Items are processed in the order they appear.
   *  - New items will replace existing items that have the same `id`, including datasets from services.
   *     `"my_sidewalks": { label: 'My Sidewalks', sourceUrl: … }`   <-- `my_sidewalks` dataset added
   *  - If no new data supplied (null), this is treated as a delete.
   *     `"fbRoads": null`                     <-- `fbRoads` dataset deleted
   *  - Wildcard characters '*' and '?' are allowed when deleting.
   *     `"overture-*": null`                  <-- all `overture-*` datasets deleted
   *
   * A dataset without a `serviceID` loads its data from its `sourceUrl`, once it's added to the Rapid menu.
   *
   * @param input - dataset data to merge
   * @throws Will throw if given data does not contain an `assetID`, or if the `assetID` has already been merged
   */
  public merge(input: DatasetInput): void {
    this._mergeInput(input);
    this._rebuildCatalog();
    if (this._started) {
      this._loadDatasetSettings();
      this._datasetsChanged();
    }
  }


  /**
   * Records a dataset input, to be applied when the catalog is rebuilt.
   * @param input - dataset data to merge
   * @throws Will throw if given data does not contain an `assetID`, or if the `assetID` has already been merged
   */
  protected _mergeInput(input: DatasetInput): void {
    const assetID = input.assetID;
    if (!assetID) {
      throw new Error('Datasets missing assetID property');
    }
    if (this._loadedAssetIDs.has(assetID)) {
      throw new Error(`Datasets "${assetID}" already merged`);
    }

    this._loadedAssetIDs.set(assetID, input.assetVersion ?? 'unknown');
    this._inputs.push(input);
  }


  /**
   * Rebuilds the catalog in layers: the datasets from services, then the merged dataset inputs
   * in order, then the user's own custom datasets (unless an asset already uses the datasetID).
   * A dataset that's still defined the same way keeps its instance, and any data it has loaded.
   *
   * The user's custom datasets are carried over from the previous catalog, not read here.
   * `_loadDatasetSettings()` creates them from the stored settings, so callers run it after this
   * (the first rebuild, at startup, has none to carry over yet).
   */
  protected _rebuildCatalog(): void {
    const previous = new Map(this.catalog);
    this.catalog.clear();

    for (const ds of this._serviceDatasets) {
      this.catalog.set(ds.id, ds);
    }

    for (const input of this._inputs) {
      const assetID = input.assetID;
      for (const inputScope of input.scopes ?? []) {
        for (const [datasetID, props] of Object.entries(inputScope.datasets ?? {})) {
          if (props) {   // add or replace
            const existing = previous.get(datasetID);
            const ds = (existing?.assetID === assetID) ? existing : this._datasetFromInput(datasetID, props, assetID);
            this.catalog.set(datasetID, ds);
          } else {   // remove
            utilWildcardDelete(this.catalog, datasetID);
          }
        }
      }
    }

    for (const ds of previous.values()) {
      if (ds.custom && !this.catalog.has(ds.id)) {
        this.catalog.set(ds.id, ds);
      }
    }

    this.categories.clear();
    for (const ds of this.catalog.values()) {
      for (const category of ds.categories) {
        this.categories.add(category);
      }
    }
  }


  /**
   * Creates a `RapidDataset` from its definition in an asset file.
   * @param datasetID - The datasetID it's defined under
   * @param props - The dataset definition
   * @param assetID - The asset file it came from
   * @return A new `RapidDataset`
   */
  protected _datasetFromInput(datasetID: DatasetID, props: DatasetInputProps, assetID: AssetID): RapidDataset {
    const { extent, ...rest } = props;

    // Not `custom`: the user didn't add it, so they can't edit or delete it.
    // (Without a `serviceID`, Rapid still loads the data itself, like a custom dataset.)
    const ds = RapidDataset.fromJSON(this.context, { ...rest, id: datasetID, assetID, custom: false });
    if (Array.isArray(extent)) {
      ds.extent = new Extent(extent[0], extent[1]);
    }
    return ds;
  }


  /**
   * The geographic extent of the current task (e.g. from a loaded GPX task boundary).
   * @return The current task extent, or `null`
   */
  public get taskExtent(): Extent | null {
    return this._taskExtent;
  }

  /**
   * Returns `true` if the given dataID is an accepted or ignored feature.
   * These features are hidden from the renderer.
   * @return `true` if the given dataID is an accepted or ignored feature
   */
  public isAcceptedOrIgnored(dataID: DataID): boolean {
    return this.acceptIDs.has(dataID) || this.ignoreIDs.has(dataID);
  }

  /**
   * Whether the current task boundary forms a rectangle.
   * @return `true` if the task bounds form a rectangle
   */
  public isTaskRectangular(): boolean {
    return (!!this._taskExtent && !!this._isTaskBoundsRect);
  }

  /**
   * Returns `true` if the user had poweruser mode at any point in their editing.
   * The state for this is stored in the urlhash in the `poweruser=true` hash param.
   * We rely on `_hashChanged()` to catch this, either at startup or anytime Rapid runs.
   * @return  `true` if poweruser mode was activated at least once during this session
   */
  public hadPoweruser(): boolean {
    return this._hadPoweruser;
  }

  /**
   * Returns `true` if the user has poweruser mode on right now.
   * The state for this is stored in the urlhash in the `poweruser=true` hash param.
   * @return  `true` if poweruser mode is activated right now.
   */
  public isPoweruser(): boolean {
    const urlhash = this.context.systems.urlhash;
    return urlhash?.getParam('poweruser') === 'true';
  }


  /**
   * Computes and stores the task extent from a parsed GPX document.
   * @param gpxDomData - GPX DOM document
   */
  public setTaskExtentByGpxData(gpxDomData: Document): void {
    const gj = gpx(gpxDomData);
    const lineStringCount = gj.features.reduce((accumulator, currentValue) =>  {
      return accumulator + (currentValue.geometry?.type === 'LineString' ? 1 : 0);
    }, 0);

    if (gj.type === 'FeatureCollection') {
      let minlat: number | undefined;
      let minlon: number | undefined;
      let maxlat: number | undefined;
      let maxlon: number | undefined;

      gj.features.forEach(f => {
        if (f.geometry?.type === 'Point') {
          const lon = f.geometry.coordinates[0];
          const lat = f.geometry.coordinates[1];
          if (minlat === undefined || lat < minlat) minlat = lat;
          if (minlon === undefined || lon < minlon) minlon = lon;
          if (maxlat === undefined || lat > maxlat) maxlat = lat;
          if (maxlon === undefined || lon > maxlon) maxlon = lon;

        } else if (f.geometry?.type === 'LineString' && lineStringCount === 1) {
          const lats = f.geometry.coordinates.map(c => c[0]);
          const lngs = f.geometry.coordinates.map(c => c[1]);
          const uniqueLats = lats.filter(distinct);
          const uniqueLngs = lngs.filter(distinct);
          let eachLatHas2Lngs = true;

          uniqueLats.forEach(lat => {
            const lngsForThisLat = (f.geometry as GeoJSON.LineString).coordinates
              .filter(coord => coord[0] === lat)   // Filter the coords to the ones with this lat
              .map(coord => coord[1])              // Make an array of lngs that associate with that lat
              .filter(distinct);                   // Finally, filter for uniqueness

            if (lngsForThisLat.length !== 2) {
              eachLatHas2Lngs = false;
            }
          });
          // Check for exactly two unique latitudes, two unique longitudes,
          // and that each latitude was associated with exactly 2 longitudes,
          if (uniqueLats.length === 2 && uniqueLngs.length === 2 && eachLatHas2Lngs) {
            this._isTaskBoundsRect = true;
          } else {
            this._isTaskBoundsRect = false;
          }
        }
      });

      if (minlon !== undefined && minlat !== undefined && maxlon !== undefined && maxlat !== undefined) {
        this._taskExtent = new Extent([minlon, minlat], [maxlon, maxlat]);
      }
      this.emit('taskchanged');
    }

    /**
     *
     * @param value
     * @param index
     * @param self
     */
    function distinct<T>(value: T, index: number, self: T[]): boolean {
      return self.indexOf(value) === index;
    }
  }


  /**
   * Saves what the user can change about a dataset, in the `DatabaseSystem` `datasets` store.
   * - For a dataset from a service or an asset file: the user's changes (color, whether it's
   *   matched against OpenStreetMap, and the conflation settings).
   * - For a custom dataset the user added: its whole definition (including its data dictionary and
   *   conflation settings).
   * Without `DatabaseSystem`, these last for this session only.
   * The code in here should match the settings loaded in `_loadDatasetSettings()`
   * @param  ds  The Rapid Dataset to save
   * @return Promise resolved when the dataset has been saved
   */
  public saveDatasetSettings(ds: RapidDataset): Promise<void> {
    if (!ds) return Promise.resolve();
    if (ds.hidden) return Promise.resolve();   // skip reserved datasets (e.g. for the walkthrough)

    const record: DatasetRecord = { ...this._datasetRecords.get(ds.id), id: ds.id, updatedAt: Date.now() };
    if (ds.custom) {   // A user-provided custom dataset - save everything..
      record.dataset = ds.toJSON();
    } else {           // A dataset from a service or an asset file - save the user's changes..
      record.changes = {
        color: ds.color,
        conflated: ds.conflated,
        conflation: structuredClone(ds.conflation)
      };
    }
    return this._putDatasetRecordAsync(record);
  }


  /**
   * Keeps a dataset record, and writes it to the `DatabaseSystem` `datasets` store (if available).
   * @param  record - The record to keep
   * @return Promise resolved when the record has been written
   */
  protected _putDatasetRecordAsync(record: DatasetRecord): Promise<void> {
    const context = this.context;
    const database = context.systems.database;

    this._datasetRecords.set(record.id, record);
    if (!database) return Promise.resolve();

    return database.put('datasets', record)
      .then(() => {})
      .catch((err: any) => {
        console.error(`Couldn't save dataset ${record.id}:  `, err);  // eslint-disable-line no-console
      });
  }


  /**
   * Deletes a custom dataset that the user added: its saved definition, its stored file (if any),
   * and its place in the catalog and on the Rapid menu.
   * @param  datasetID - The custom dataset to delete
   * @return Promise resolved when the saved data has been deleted
   */
  public deleteCustomDatasetAsync(datasetID: DatasetID): Promise<void> {
    const context = this.context;
    const database = context.systems.database;

    const ds = this.catalog.get(datasetID);
    if (!ds?.custom) return Promise.resolve();   // only the user's own datasets can be deleted

    this.catalog.delete(datasetID);
    this.removeDatasets(datasetID);

    // Keep any changes the user made to an asset file's dataset with the same datasetID.
    const changes = this._datasetRecords.get(datasetID)?.changes;
    const work: Promise<void>[] = [];
    if (changes) {
      work.push(this._putDatasetRecordAsync({ id: datasetID, updatedAt: Date.now(), changes }));
    } else {
      this._datasetRecords.delete(datasetID);
      if (database) work.push(database.delete('datasets', datasetID));
    }
    if (database && ds.sourceFileID) {
      work.push(database.deleteFileAsync(ds.sourceFileID));
    }
    return Promise.all(work)
      .then(() => {})
      .catch((err: any) => {
        console.error(`Couldn't delete dataset ${datasetID}:  `, err);  // eslint-disable-line no-console
      });
  }


  /**
   * Reads what the user saved about each dataset from the `DatabaseSystem` `datasets` store:
   * their own custom datasets, and their changes to datasets from services and asset files.
   * Without `DatabaseSystem` there are none to read.
   * Errors are logged; the user's datasets and changes just won't appear.
   * @return Promise resolved when the records have been read
   */
  protected async _readDatasetRecordsAsync(): Promise<void> {
    const context = this.context;
    const database = context.systems.database;
    if (!database) return;

    try {
      this._datasetRecords.clear();
      for (const record of await database.getAll<DatasetRecord>('datasets')) {
        if (typeof record?.id !== 'string') continue;
        if (!TreeStore.isPlainObject(record.dataset) && !TreeStore.isPlainObject(record.changes)) continue;
        this._datasetRecords.set(record.id, record);
      }
    } catch (err) {
      console.error(`Couldn't read the saved datasets:  `, err);  // eslint-disable-line no-console
    }
  }


  /**
   * This is called anytime the history changes, we recompute the accepted/ignored sets.
   * This will run on history change, undo, redo, or history restore.
   */
  protected _stablechange(): void {
    const context = this.context;
    const editor = context.systems.editor;
    if (!editor) return;

    this.acceptIDs.clear();
    this.ignoreIDs.clear();

    const history = editor.history;
    const index = editor.index;

    // Start at `1` - there won't be sources on the `base` edit..
    // End at `index` - don't continue into the redo part of the history..
    for (let i = 1; i <= index; i++) {
      const edit = history[i];
      const annotation = edit.annotation as Record<string, unknown> | undefined;

      if (annotation?.type === 'rapid_accept_feature') {
        const ids = (annotation.acceptIDs ?? []) as DataID[];
        for (const id of ids) {
          this.acceptIDs.add(id);
        }
      } else if (annotation?.type === 'rapid_ignore_feature') {
        if (annotation.ignoreID) {
          this.ignoreIDs.add(annotation.ignoreID as DataID);
        }
      }
    }
  }


  /**
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  protected _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // poweruser
    // remember if the user had poweruser on at any point in their editing
    if (currParams.get('poweruser') === 'true') {
      this._hadPoweruser = true;
    }

    // datasets
    // AssetIDs to load datasets from, e.g. `datasets=default,my_datasets`
    // (Compared with the value the current datasets were loaded for, since init already used it.)
    let loadPromise = Promise.resolve();
    const newDatasets = currParams.get('datasets');
    if (newDatasets !== this._datasetsParam) {
      this._datasetsParam = newDatasets;
      if (typeof newDatasets === 'string') {
        this.requestedAssetIDs = utilExtractValues(newDatasets).filter(Boolean);
      } else {
        this.requestedAssetIDs = null;
      }
      loadPromise = this.loadDatasetAssetsAsync();
    }

    // dataset_ids (optional) - if using, it overrides the user's stored dataset settings.
    loadPromise.then(() => {
      if (currParams.has('dataset_ids')) {
        this._setupDatasetLists();
        this._datasetsChanged();
      }
    });
  }


  /**
   * Setup dataset lists - this runs on startup and anytime the urlhash 'dataset_ids' param changes.
   * We'll check both `UrlHashSystem` and `SettingsSystem` to decide what appears on the menu.
   * (The urlhash overrides the stored settings)
   */
  protected _setupDatasetLists(): void {
    const context = this.context;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    const urlVals = utilExtractValues(urlhash?.getParam('dataset_ids') || '').filter(Boolean);

    // Added datasetIDs  (datasets that appear on the menu)
    // Take from `dataset_ids` url param if available, fallback to stored setting.
    let addedVals = urlVals;
    if (!addedVals.length) {
      addedVals = settings?.get<DatasetID[]>('rapid.addedDatasetIDs') ?? ['fbRoads', 'overture-buildings', 'overture-places'];
    }
    this.addedDatasetIDs = new Set<DatasetID>(addedVals);

    // Enabled datasetIDs  (datasets on the menu that are checked)
    // Take from `dataset_ids` url param if available, fallback to stored setting.
    // Note that we won't enable the default datasets anymore - this is a change from earlier
    // versions of Rapid which enabled Facebook Roads and Microsoft Buildings by default.
    // Going forward, we'll default them to disabled, until the user enables them.
    let enabledVals = urlVals;
    if (!enabledVals.length) {
      enabledVals = settings?.get<DatasetID[]>('rapid.enabledDatasetIDs') ?? [];
    }
    this.enabledDatasetIDs = new Set<DatasetID>(enabledVals);
  }


  /**
   * Applies what the user saved about each dataset (see `_readDatasetRecordsAsync`):
   * - The datasets from services and asset files get the user's changes (color, whether they're
   *   matched against OpenStreetMap, and the conflation settings).
   * - The user's custom datasets are created from their definitions.
   * The code in here should match the settings saved in `saveDatasetSettings()`
   */
  protected _loadDatasetSettings(): void {
    const context = this.context;
    const database = context.systems.database;

    for (const record of this._datasetRecords.values()) {
      const datasetID = record.id;
      let ds = this.catalog.get(datasetID);

      // The user's changes to a dataset from a service or an asset file.
      // (Kept even if that dataset isn't in the catalog now; its asset file may be loaded next time.)
      const changes = record.changes;
      if (ds && !ds.custom && !ds.hidden && changes) {
        if (typeof changes.color === 'string')      ds.color = changes.color;
        if (typeof changes.conflated === 'boolean') ds.conflated = changes.conflated;
        if (changes.conflation)                     ds.conflation = structuredClone(changes.conflation);
      }

      if (!record.dataset) continue;   // not one of the user's own datasets

      if (ds) {   // added already
        if (!ds.custom && !ds.assetID) {   // Custom datasetID should not collide with service-provided datasetID
          if (changes) {
            this._putDatasetRecordAsync({ id: datasetID, updatedAt: Date.now(), changes });
          } else {
            this._datasetRecords.delete(datasetID);
            database?.delete('datasets', datasetID)
              .catch((err: any) => console.error(`Couldn't delete dataset ${datasetID}:  `, err));  // eslint-disable-line no-console
          }
        }
        // (If an asset file uses the datasetID, keep the record; the asset may not be loaded next time.)
        continue;
      }

      // Instantiate the custom dataset and add it to the catalog.
      ds = RapidDataset.fromJSON(context, { ...record.dataset, id: datasetID, custom: true });
      this.catalog.set(ds.id, ds);
      if (ds.serviceID) continue;   // a service will load its data, not Rapid

      ds.setupCustomDatasetAsync()
        .then(() => {
          // everything looks ok
        })
        .catch((err: any) => {
          console.error(`Dataset setup failed for ${ds.id}:  `, err);  // eslint-disable-line no-console
        });
    }
  }


  /**
   * Called whenever the datasets change.
   * This will:
   * - Update `UrlHashSystem`/`SettingsSystem` to persist the lists of datasets added/enabled.
   * - Try to setup a RapidDataDictionary for each added dataset.
   * - trigger a redraw.
   * - emit a 'datasetchange' event.
   */
  protected _datasetsChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    // Skip checks and persisting completely if we are in the intro walkthrough.
    if (!context.inIntro) {
      // Check the lists to make sure we are only including valid datasetIDs,
      // remove anything that should be hidden (e.g. walkthrough data).
      const addedVals: DatasetID[] = [];
      const enabledVals: DatasetID[] = [];

      for (const datasetID of this.addedDatasetIDs) {
        const ds = this.catalog.get(datasetID);
        if (!ds || ds.hidden) {
          this.addedDatasetIDs.delete(datasetID);
        } else {
          addedVals.push(datasetID);
        }
      }
      for (const datasetID of this.enabledDatasetIDs) {
        const ds = this.catalog.get(datasetID);
        if (!ds || ds.hidden) {
          this.enabledDatasetIDs.delete(datasetID);
        } else {
          enabledVals.push(datasetID);
        }
      }

      // 'dataset_ids' (optional) - if using, it overrides the user's stored dataset settings.
      if (urlhash?.hasParam('dataset_ids')) {
        urlhash?.setParam('dataset_ids', enabledVals.length ? enabledVals.join(',') : null);
      } else {
        settings?.set('rapid.addedDatasetIDs', addedVals);
        settings?.set('rapid.enabledDatasetIDs', enabledVals);
      }
    }


    // Schedule data dictionary setup if needed.
    // If this is not setup, Rapid can still display the data, but Accept/Ignore will be unavailable.
    for (const datasetID of this.addedDatasetIDs) {
      const ds = this.catalog.get(datasetID);
      if (!ds || !ds.serviceID || ds.custom) continue;
      if (!ds.dictionary) {
        const service = context.services[ds.serviceID] as any;
        if (!service || typeof service.getDataDictionaryAsync !== 'function') continue;

        service.getDataDictionaryAsync(ds.id)
          .then((dict: RapidDataDictionary) => ds.dictionary = dict);
      }
    }

    // Start loading the data for datasets from asset files, once they're added to the Rapid menu.
    // (A custom dataset that the user added loads its data at startup, see `_loadDatasetSettings`.)
    for (const datasetID of this.addedDatasetIDs) {
      const ds = this.catalog.get(datasetID);
      if (!ds?.assetID || ds.serviceID || this._setupDatasets.has(ds)) continue;

      this._setupDatasets.add(ds);
      ds.setupCustomDatasetAsync()
        .catch((err: any) => {
          console.error(`Dataset setup failed for ${ds.id}:  `, err);  // eslint-disable-line no-console
        });
    }

    gfx?.immediateRedraw();
    this.emit('datasetchange');
  }

}
