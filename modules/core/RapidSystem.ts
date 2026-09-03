import { AbstractSystem } from './AbstractSystem.ts';
import { gpx } from '@tmcw/togeojson';
import { Extent } from '@rapid-sdk/math';
import { RapidDataset, RapidDataDictionary } from '../lib/index.ts';
import { utilExtractValues } from '../util/string.ts';
import { utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { SettingsValue } from './SettingsSystem.ts';
import type { TreeValue } from '../lib/TreeStore.ts';


/**
 * Persisted settings for a single service-provided dataset,
 * stored under `rapid.dataset.<DatasetID>`. Leaves are strings (the settings store
 * is string-only), so `conflated` is persisted as `'true'`/`'false'`.
 */
export interface RapidDatasetSettings {
  color?: string;
  conflated?: string;
}

/**
 * Persisted settings for a single user-added custom dataset,
 * stored under `rapid.custom.<DatasetID>`. This is the string-only JSON produced by
 * `RapidDataset.toJSON()` and consumed by `RapidDataset.fromJSON()`.
 */
export type RapidCustomDatasetSettings = Record<string, TreeValue>;

/**
 * The structured view of the `rapid.*` settings subtree owned by `RapidSystem`.
 * The engine stores leaves as strings (or arrays of strings); this interface
 * documents the shape `RapidSystem` reads and writes on top of that.
 */
export interface RapidSettings {
  /** DatasetIDs that should appear on the Rapid menu */
  addedDatasetIDs?: DatasetID[];
  /** DatasetIDs that the user has enabled for display, a subset of addedDatasetIDs */
  enabledDatasetIDs?: DatasetID[];
  /** Per-dataset settings for service-provided datasets, keyed by DatasetID */
  dataset?: Record<DatasetID, RapidDatasetSettings>;
  /** Per-dataset settings for user-added custom datasets, keyed by DatasetID */
  custom?: Record<DatasetID, RapidCustomDatasetSettings>;
};


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
 *
 * Rapid allows users to work with third party datasets external to OpenStreetMap.
 * These datasets may be derived from authorative sources or AI-detected suggestions.
 *
 * Events available:
 * - `datasetchange`   Fires when datasets are added/removed from the list
 * - `taskchanged`
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


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'rapid';
    this.optionalDependencies = new Set<SystemID>(['editor', 'gfx', 'settings', 'urlhash']);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._stablechange = this._stablechange.bind(this);
    this._datasetsChanged = this._datasetsChanged.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          editor?.initAsync(),
          settings?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        urlhash?.on('hashchange', this._hashChanged);
        editor?.on('stablechange', this._stablechange);
     });
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
        // Gather all available datasets and categories into the dataset catalog..
        for (const service of services) {
          const datasets = service.getAvailableDatasets();
          for (const dataset of datasets) {
            this.catalog.set(dataset.id, dataset);
            for (const category of dataset.categories) {
              this.categories.add(category);
            }
          }
        }

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
   * The geographic extent of the current task (e.g. from a loaded GPX task boundary).
   * @return The current task extent, or null
   */
  public get taskExtent(): Extent | null {
    return this._taskExtent;
  }

  /**
   * Whether the current task boundary forms a rectangle.
   * @return true if the task bounds form a rectangle
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
   * Save dataset settings to the `SettingsSystem`.
   * The code in here should match the settings loaded in `_loadDatasetSettings()`
   * @param  ds  The Rapid Dataset to save
   */
  public saveDatasetSettings(ds: RapidDataset): void {
    const context = this.context;
    const settings = context.systems.settings;
    if (!settings || !ds) return;
    if (ds.hidden) return;   // skip reserved datasets (e.g. for the walkthrough)

    // A service-provided dataset - save the subset of things that the user can customize..
    if (!ds.custom) {
      const prefs: RapidDatasetSettings = {
        color: ds.color,
        conflated: String(ds.conflated)
      };
      settings.set(`rapid.dataset.${ds.id}`, prefs as SettingsValue);

    // A user-provided custom dataset - save everything..
    } else {
      const prefs = ds.toJSON();
      settings.set(`rapid.custom.${ds.id}`, prefs as SettingsValue);
    }
  }


  /**
   * This is called anytime the history changes, we recompute the accepted/ignored sets.
   * This can run on history change, undo, redo, or history restore.
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
        const ids = (annotation.allIDs ?? []) as EntityID[];
        for (const id of ids) {
          this.acceptIDs.add(id);
        }
      } else if (annotation?.type === 'rapid_ignore_feature') {
        if (annotation.entityID) {
          this.ignoreIDs.add(annotation.entityID as string);
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

    // datasets (optional) - if using, it overrides the user's stored dataset settings.
    if (currParams.has('datasets')) {
      this._setupDatasetLists();
      this._datasetsChanged();
    }
  }


  /**
   * Setup dataset lists - this runs on startup and anytime the urlhash 'datasets' param changes.
   * We'll check both `UrlHashSystem` and `SettingsSystem` to decide what appears on the menu.
   * (The urlhash overrides the stored settings)
   */
  protected _setupDatasetLists(): void {
    const context = this.context;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    const urlVals = utilExtractValues(urlhash?.getParam('datasets') || '').filter(Boolean);

    // Added datasetIDs  (datasets that appear on the menu)
    // Take from `datasets` url param if available, fallback to stored setting.
    let addedVals = urlVals;
    if (!addedVals.length) {
      addedVals = settings?.get<DatasetID[]>('rapid.addedDatasetIDs') ?? ['fbRoads', 'overture-buildings', 'overture-places'];
    }
    this.addedDatasetIDs = new Set<DatasetID>(addedVals);

    // Enabled datasetIDs  (datasets on the menu that are checked)
    // Take from `datasets` url param if available, fallback to stored setting.
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
   * Load dataset settings from the `SettingsSystem`.
   * We'll expect to find two subtrees of settings indexed by DatasetID.
   * One for normal datasets provided by a service, one for custom datasets added by the user.
   * If we've never stored anything in `SettingsSystem`, the settings will be empty.
   * The code in here should match the settings loaded in `saveDatasetSettings()`
   */
  protected _loadDatasetSettings(): void {
    const context = this.context;
    const settings = context.systems.settings;
    if (!settings) return;

    // Apply the settings for the service-provided datasets:
    // dataset: {
    //   fbRoads: { … },
    //   msBuildings: { … },
    //   …
    // }
    const datasetSettings = settings.get<Record<DatasetID, RapidDatasetSettings>>('rapid.dataset') ?? {};
    for (const [datasetID, prefs] of Object.entries(datasetSettings)) {
      const hasValidPrefs = (typeof prefs === 'object' && !Array.isArray(prefs) && prefs !== null);
      if (!hasValidPrefs ) {   // `prefs` should be an object
        settings.unset(`rapid.dataset.${datasetID}`);
        continue;
      }
      const ds = this.catalog.get(datasetID);
      if (!ds) {   // unknown dataset
        settings.unset(`rapid.dataset.${datasetID}`);
        continue;
      }
      if (ds.hidden) {   // a reserved dataset (e.g. for the walkthrough)
        settings.unset(`rapid.dataset.${datasetID}`);
        continue;
      }

      // Only apply the subset of preferences that the user can customize.
      // Leaves come back from the string-only settings store as strings.
      if (typeof prefs.color === 'string') {
        ds.color = prefs.color;
      }
      if (typeof prefs.conflated === 'string') {
        ds.conflated = (prefs.conflated === 'true');
      }
    }

    // Instantiate user-provided custom datasets:
    // custom: {
    //   custom_a: { … },
    //   custom_b: { … },
    //   …
    // }
    const customSettings = settings.get<Record<DatasetID, RapidCustomDatasetSettings>>('rapid.custom') ?? {};
    for (const [datasetID, prefs] of Object.entries(customSettings)) {
      const hasValidPrefs = (typeof prefs === 'object' && !Array.isArray(prefs) && prefs !== null);
      if (!hasValidPrefs) {   // `prefs` should be an object
        settings.unset(`rapid.custom.${datasetID}`);
        continue;
      }
      let ds = this.catalog.get(datasetID);
      if (ds) {   // added already
        if (!ds.custom) {   // Custom datasetID should not collide with service-provided datasetID
          settings.unset(`rapid.custom.${datasetID}`);
        }
        continue;
      }

      // Instantiate the custom dataset and add it to the catalog.
      // `fromJSON` coerces the string-only settings leaves (e.g. boolean flags) back to their real types.
      ds = RapidDataset.fromJSON(context, { ...prefs, custom: 'true' });
      this.catalog.set(datasetID, ds);
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

      // 'datasets' (optional) - if using, it overrides the user's stored dataset settings.
      if (urlhash?.hasParam('datasets')) {
        urlhash?.setParam('datasets', enabledVals.length ? enabledVals.join(',') : null);
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

    gfx?.immediateRedraw();
    this.emit('datasetchange');
  }

}
