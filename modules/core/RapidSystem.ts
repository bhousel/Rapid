import { gpx } from '@tmcw/togeojson';
import { Extent } from '@rapid-sdk/math';

import { AbstractSystem } from './AbstractSystem.ts';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { Context } from './types.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';


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
 * `RapidSystem` maintains all the Rapid datasets
 *
 * Events available:
 *  `datasetchange`   Fires when datasets are added/removed from the list
 *  `taskchanged`
 */
export class RapidSystem extends AbstractSystem {
  /** Map<datasetID, RapidDataset> - all the datasets we know about */
  readonly catalog = new Map<string, RapidDataset>();
  /** Set<string> - all the dataset 'categories' we know about */
  readonly categories = new Set<string>();
  /** Set<dataID> - features accepted by the user */
  readonly acceptIDs = new Set<string>();
  /** Set<dataID> - features ignored by the user */
  readonly ignoreIDs = new Set<string>();

  private _addedDatasetIDs = new Set<string>();
  private _enabledDatasetIDs = new Set<string>();
  private _nextColorIndex = 2;  // see note in _datasetsChanged()
  private _taskExtent: Extent | null = null;
  private _isTaskBoundsRect: boolean | null = null;
  private _hadPoweruser = false;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'rapid';
    this.requiredDependencies = new Set();
    this.optionalDependencies = new Set(['editor', 'gfx', 'urlhash']);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._stablechange = this._stablechange.bind(this);
    this._datasetsChanged = this._datasetsChanged.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
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
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    // We wait until startAsync to create the dataset catalog because the services need to be initialized.
    const context = this.context;
    const urlhash = context.systems.urlhash;

    const esri = context.services.esri as any;
    const mapwithai = context.services.mapwithai as any;
    const overture = context.services.overture as any;

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
          this._addedDatasetIDs = new Set(['fbRoads', 'msBuildings', 'overture-places' /*, 'omdFootways'*/]);  // on menu
          this._enabledDatasetIDs = new Set(['fbRoads', 'msBuildings']);  // checked
          this._datasetsChanged();
        }

        this._started = true;
      });
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    this.acceptIDs.clear();
    this.ignoreIDs.clear();
    return Promise.resolve();
  }


  /**
   * addDatasets
   * Add datasets to the menu.  (Does not set their checked 'enabled' state)
   * @param datasetIDs - datasetIDs to add
   */
  addDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * removeDatasets
   * Remove datasets from the menu. (Also unchecks their 'enabled' state)
   * @param datasetIDs - datasetIDs to remove
   */
  removeDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.delete(datasetID);
      this._enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * enableDatasets
   * Checks the dataset as enabled. (Also ensures that the dataset is 'added' to the menu).
   * @param datasetIDs - datasetIDs to enable
   */
  enableDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._addedDatasetIDs.add(datasetID);
      this._enabledDatasetIDs.add(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * disableDatasets
   * Unchecks the dataset as disabled. (Does not affect whether the dataset is 'added' to the menu)
   * @param datasetIDs - datasetIDs to disable
   */
  disableDatasets(datasetIDs: OneOrMore<string>): void {
    for (const datasetID of utilIterable(datasetIDs)) {
      this._enabledDatasetIDs.delete(datasetID);
    }
    this._datasetsChanged();
  }


  /**
   * toggleDatasets
   * Toggles the given datasets enabled state, does not affect any other datasets.
   * @param datasetIDs - datasetIDs to toggle
   */
  toggleDatasets(datasetIDs: OneOrMore<string>): void {
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
   * datasets
   * @return The currently added datasets
   */
  get datasets(): Map<string, RapidDataset> {
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
   * colors
   * @return Array of available colors for datasets
   */
  get colors(): readonly string[] {
    return RAPID_COLORS;
  }

  /**
   * taskExtent
   * @return The current task extent, or null
   */
  get taskExtent(): Extent | null {
    return this._taskExtent;
  }

  /**
   * isTaskRectangular
   * @return true if the task bounds form a rectangle
   */
  isTaskRectangular(): boolean {
    return (!!this._taskExtent && !!this._isTaskBoundsRect);
  }


  /**
   * hadPoweruser
   * true if the user had poweruser mode at any point in their editing
   * @readonly
   */
  get hadPoweruser(): boolean {
    return this._hadPoweruser;
  }


  /**
   * setTaskExtentByGpxData
   * @param gpxDomData - GPX DOM document
   */
  setTaskExtentByGpxData(gpxDomData: Document): void {
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

    function distinct<T>(value: T, index: number, self: T[]): boolean {
      return self.indexOf(value) === index;
    }
  }


  /**
   * _stablechange
   * This is called anytime the history changes, we recompute the accepted/ignored sets.
   * This can run on history change, undo, redo, or history restore.
   */
  _stablechange(): void {
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
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // poweruser
    // remember if the user had poweruser on at any point in their editing
    if (currParams.get('poweruser') === 'true') {
      this._hadPoweruser = true;
    }

    // datasets
    const newDatasets = currParams.get('datasets');
    const oldDatasets = prevParams.get('datasets');
    if (newDatasets !== oldDatasets) {
      this._enabledDatasetIDs.clear();
      if (typeof newDatasets === 'string') {
        const toEnable = newDatasets.replace(/;/g, ',').split(',').map(s => s.trim()).filter(Boolean);
        this.enableDatasets(toEnable);
      } else {  // all removed
        this._datasetsChanged();
      }
    }
  }


  /**
   * _datasetsChanged
   * Called whenever the datasets change.
   * This will update the urlhash, trigger a redraw, and emit a 'datasetchange' event.
   */
  _datasetsChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;

    const enabledIDs: string[] = [];
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
