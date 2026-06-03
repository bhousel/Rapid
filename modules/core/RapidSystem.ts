import { AbstractSystem } from './AbstractSystem.ts';
import { gpx } from '@tmcw/togeojson';
import { Extent } from '@rapid-sdk/math';
import { utilExtractValues } from '../util/string.ts';
import { utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { OneOrMore } from '../util/iterable.ts';


const RAPID_MAGENTA = '#da26d3';
const OVERTURE_CYAN = '#00ffff';
const RAPID_COLORS: readonly string[] = [
  '#ff0000',  // red
  '#ffa500',  // orange
  '#ffd700',  // gold
  '#00ff00',  // lime
  '#00ffff',  // cyan
  '#1e90ff',  // dodgerblue
  '#da26d3',  // rapid magenta
  '#ffc0cb',  // pink
  '#d3d3d3',  // lightgray
  '#faf0e6'   // linen
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

  /** IDs of datasets that have been added to the active list by the user */
  protected _addedDatasetIDs = new Set<DatasetID>();
  /** IDs of datasets that the user has enabled for display */
  protected _enabledDatasetIDs = new Set<DatasetID>();
  /** Index into `RAPID_COLORS` for the next auto-assigned dataset color */
  protected _nextColorIndex = 2;  // see note in _datasetsChanged()
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
    this.optionalDependencies = new Set<SystemID>(['editor', 'gfx', 'urlhash']);

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
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          editor?.initAsync(),
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
    const urlhash = context.systems.urlhash;

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

        // Set some defaults if urlhash doesn't have them
        if (!urlhash?.initialHashParams.has('datasets')) {
          this._addedDatasetIDs = new Set<DatasetID>(['fbRoads', 'msBuildings', 'overture-places' /*, 'omdFootways'*/]);  // on menu
          this._enabledDatasetIDs = new Set<DatasetID>(['fbRoads', 'msBuildings']);  // checked
          this._datasetsChanged();
        }

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
   * Add datasets to the menu.  (Does not set their checked 'enabled' state)
   * @param datasetIDs - datasetIDs to add
   */
  public addDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Remove datasets from the menu. (Also unchecks their 'enabled' state)
   * @param datasetIDs - datasetIDs to remove
   */
  public removeDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.delete(datasetID);
      this._enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Checks the dataset as enabled. (Also ensures that the dataset is 'added' to the menu).
   * @param datasetIDs - datasetIDs to enable
   */
  public enableDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.add(datasetID);
      this._enabledDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Unchecks the dataset as disabled. (Does not affect whether the dataset is 'added' to the menu)
   * @param datasetIDs - datasetIDs to disable
   */
  public disableDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * Toggles the given datasets enabled state, does not affect any other datasets.
   * @param datasetIDs - datasetIDs to toggle
   */
  public toggleDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.add(datasetID);  // it needs to be added to the menu
      if (this._enabledDatasetIDs.has(datasetID)) {
        this._enabledDatasetIDs.delete(datasetID);
      } else {
        this._enabledDatasetIDs.add(datasetID);
      }
    }
    this._datasetsChanged();
  }


  /**
   * The datasets currently added to the editing session.
   * @return The currently added datasets
   */
  public get datasets(): Map<string, RapidDataset> {
    const results = new Map<string, RapidDataset>();
    for (const datasetID of this._addedDatasetIDs) {
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
   * true if the user had poweruser mode at any point in their editing
   * @return  `true` if poweruser mode was activated at least once during this session
   * @readonly
   */
  public get hadPoweruser(): boolean {
    return this._hadPoweruser;
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
        if (annotation.entityID)  this.acceptIDs.add(annotation.entityID as string);
      } else if (annotation?.type === 'rapid_ignore_feature') {
        if (annotation.entityID)  this.ignoreIDs.add(annotation.entityID as string);
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
    const newDatasets = currParams.get('datasets') || '';
    const oldDatasets = prevParams.get('datasets') || '';
    if (newDatasets !== oldDatasets) {
      this._enabledDatasetIDs.clear();
      const vals = utilExtractValues(newDatasets).filter(Boolean);
      if (vals.length) {
        this.enableDatasets(vals);
      } else {  // all removed
        this._datasetsChanged();
      }
    }
  }


  /**
   * Called whenever the datasets change.
   * This will update the urlhash, trigger a redraw, and emit a 'datasetchange' event.
   */
  protected _datasetsChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;

    const enabledIDs: DatasetID[] = [];
    for (const [datasetID, dataset] of this.catalog) {
      // This code is a bit weird - I don't like it and we should change it...
      // I'm trying to match the legacy color-choosing behavior from before Rapid#1642 (which changed a bunch of things)
      // - If adding fbRoads/msBuildings, choose "Rapid magenta".
      // - If adding an Overture dataset, choose "Overture cyan".
      // - If adding an Esri dataset, choose a color based on how many datasets were added already.
      const wasAdded = dataset.added;
      const nowAdded = this._addedDatasetIDs.has(datasetID);
      if (!wasAdded && nowAdded && dataset.color === RAPID_MAGENTA) {  // being added right now with the default color
        if (dataset.categories.has('meta') || dataset.categories.has('microsoft')) {
          dataset.color = RAPID_MAGENTA;
        } else if (dataset.categories.has('overture')) {
          dataset.color = OVERTURE_CYAN;
        } else {
          dataset.color = RAPID_COLORS[this._nextColorIndex++ % RAPID_COLORS.length];
        }
      }

      dataset.added = nowAdded;
      dataset.enabled = this._enabledDatasetIDs.has(datasetID);

      if (dataset.added && dataset.enabled) {
        enabledIDs.push(datasetID);
      }
    }

    // datasets
    urlhash?.setParam('datasets', enabledIDs.length ? enabledIDs.join(',') : null);

    gfx?.immediateRedraw();
    this.emit('datasetchange');
  }

}
