import { Extent } from '@rapid-sdk/math';

import { AbstractSystem } from './AbstractSystem.ts';
import { utilDate, utilDateString } from '../util/date.ts';

import type { D3Selection } from 'd3-selection';
import type { Context } from './types.ts';


/** Photo layer identifiers (e.g. 'streetside', 'mapillary', 'kartaview') */
export type PhotoLayerID = string;

/** Detection layer identifiers (e.g. 'mapillary-detections', 'mapillary-signs') */
export type DetectionLayerID = string;

/** All layer identifiers (photos + detections) */
export type LayerID = string;

/** Photo types for filtering (e.g. 'flat', 'panoramic') */
export type PhotoType = string;

/** Date filter types ('fromDate' or 'toDate') */
export type DateFilter = 'fromDate' | 'toDate';


/**
 * `PhotoSystem` maintains the state of the photo viewer.
 *
 * Properties available:
 *   `fromDate`              Current fromDate filter value
 *   `toDate`                Current toDate filter value
 *   `usernames`             Current usernames filter value
 *   `currPhotoID`           Current PhotoID
 *   `currPhotoLayerID`      Current Photo LayerID
 *   `currDetectionID`       Current DetectionID
 *   `currDetectionLayerID`  Current Detection LayerID
 *
 * Events available:
 *   `photochange`   Fires on any change in selected photo, detection, or filtering options
 */
export class PhotoSystem extends AbstractSystem {
  private _currPhotoLayerID: PhotoLayerID | null = null;
  private _currPhotoID: string | null = null;
  private _currDetectionLayerID: DetectionLayerID | null = null;
  private _currDetectionID: string | null = null;

  private _filterPhotoTypes: Set<PhotoType>;
  private _filterFromDate: string | null = null;
  private _filterToDate: string | null = null;
  private _filterUsernames: string[] | null = null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'photos';
    this.requiredDependencies = new Set();
    this.optionalDependencies = new Set(['gfx', 'map', 'urlhash', 'ui']);

    this._filterPhotoTypes = new Set(this.photoTypes);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._layerChanged = this._layerChanged.bind(this);
    this._photoChanged = this._photoChanged.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          gfx?.initAsync(),   // `gfx.scene` will exist after `initAsync`
          urlhash?.initAsync(),
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup event handlers..
        urlhash?.on('hashchange', this._hashChanged);
        gfx?.scene?.on('layerchange', this._layerChanged);
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * _hashChanged
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const scene = gfx?.scene;

    // photo_overlay
    // support enabling photo layers by default via a URL parameter, e.g. `photo_overlay=kartaview;mapillary;streetside`
    const newPhotoOverlay = currParams.get('photo_overlay');
    const oldPhotoOverlay = prevParams.get('photo_overlay');
    if (scene && newPhotoOverlay !== oldPhotoOverlay) {
      let toEnableIDs = new Set<string>();
      if (typeof newPhotoOverlay === 'string') {
        toEnableIDs = new Set(newPhotoOverlay.replace(/;/g, ',').split(','));
      }
      for (const layerID of this.layerIDs) {
        const layer = scene.layers.get(layerID);
        if (!layer) continue;
        layer.enabled = toEnableIDs.has(layer.id);
      }
    }

    // photo_dates
    const newPhotoDates = currParams.get('photo_dates');
    const oldPhotoDates = prevParams.get('photo_dates');
    if (newPhotoDates !== oldPhotoDates) {
      if (typeof newPhotoDates === 'string') {
        // expect format like `photo_dates=2019-01-01_2020-12-31`, but allow a couple different separators
        const parts = /^(.*)[–_](.*)$/g.exec(newPhotoDates.trim());
        this.setDateFilter('fromDate', parts && parts.length >= 2 ? parts[1] : null);
        this.setDateFilter('toDate', parts && parts.length >= 3 ? parts[2] : null);
      } else {
        this._filterToDate = this._filterFromDate = null;
      }
    }

    // photo_username
    const newPhotoUsername = currParams.get('photo_username');
    const oldPhotoUsername = prevParams.get('photo_username');
    if (newPhotoUsername !== oldPhotoUsername) {
      this.setUsernameFilter(newPhotoUsername);
    }

    // photo
    // support opening a specific photo via a URL parameter, e.g. `photo=mapillary/<photoID>`
    const newPhoto = currParams.get('photo') || '';
    const oldPhoto = prevParams.get('photo') || '';
    if (newPhoto !== oldPhoto) {
      const [layerID, photoID] = newPhoto.split('/', 2).filter(Boolean);
      if (layerID && photoID) {
        this.selectPhoto(layerID as PhotoLayerID, photoID);
      } else {
        this.selectPhoto();  // deselect
      }
    }

    // detections
    // support opening a specific detection via a URL parameter, e.g. `detection=mapillary-detections/<detectionID>`
    const newDetection = currParams.get('detection') || '';
    const oldDetection = prevParams.get('detection') || '';
    if (newDetection !== oldDetection) {
      const [layerID, detectionID] = newDetection.split('/', 2).filter(Boolean);
      if (layerID && detectionID) {
        this.selectDetection(layerID as DetectionLayerID, detectionID);
      } else {
        this.selectDetection();  // deselect
      }
    }
  }


  /**
   * _layerChanged
   * Respond to any changes in the layers that are enabled
   */
  private _layerChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const scene = gfx?.scene;
    if (!scene) return;

    // Update detections
    // If there is a currently selected detection, return to browse mode.
    for (const layerID of this.detectionLayerIDs) {
      const layer = scene.layers.get(layerID);
      if (layer && !layer.enabled && this._currDetectionLayerID === layerID) {
        context.enter('browse');
        this.selectDetection();  // deselect
      }
    }

    // Update photos
    // If there is a current photo layer, refresh it by calling `selectPhoto` again.
    // (Maybe the detections layers changed, and we need to redraw the viewer
    // to remove the highlighting or make the segmentations appear or disappear)
    let enabledCount = 0;
    for (const layerID of this.photoLayerIDs) {
      const layer = scene.layers.get(layerID);
      if (layer?.enabled) {
        enabledCount++;
      }
      if (layerID === this._currPhotoLayerID) {
        if (layer?.enabled) {
          this.selectPhoto(this._currPhotoLayerID, this._currPhotoID);  // keep selection
        } else {
          this.selectPhoto();  // deselect
        }
      }
    }

    if (!enabledCount) {  // no photo layers enabled, hide the viewer
      this.hideViewer();
    }
  }


  /**
   * _photoChanged
   * Called whenever the photo changes.
   * This will update the urlhash, trigger a redraw, and emit a 'photochange' event.
   */
  private _photoChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;
    const scene = gfx?.scene;

    if (urlhash) {
      // photo_overlay
      const enabledIDs: LayerID[] = [];
      if (scene) {
        for (const layerID of this.layerIDs) {
          const layer = scene.layers.get(layerID);
          if (layer && layer.supported && layer.enabled) {
            enabledIDs.push(layerID);
          }
        }
      }
      urlhash.setParam('photo_overlay', enabledIDs.length ? enabledIDs.join(',') : null);

      // photo_dates
      let rangeString;
      if (this._filterFromDate || this._filterToDate) {
        rangeString = (this._filterFromDate || '') + '_' + (this._filterToDate || '');
      }
      urlhash.setParam('photo_dates', rangeString);

      // photo_username
      urlhash.setParam('photo_username', this._filterUsernames ? this._filterUsernames.join(',') : null);

      // current photo
      let photoString;
      if (this._currPhotoLayerID && this._currPhotoID) {
        photoString = `${this._currPhotoLayerID}/${this._currPhotoID}`;
      }
      urlhash.setParam('photo', photoString);

      // current detection
      let detectionString;
      if (this._currDetectionLayerID && this._currDetectionID) {
        detectionString = `${this._currDetectionLayerID}/${this._currDetectionID}`;
      }
      urlhash.setParam('detection', detectionString);
    }

    gfx?.immediateRedraw();
    this.emit('photochange');
  }


  /**
   * photosUsed
   * Called by the EditSystem to gather the sources being used to make an edit.
   * We can return the English names of:
   *  - current photo layer (if showing a photo)
   *  - current detection layer (if showing a detection)
   * These strings will be included in the user's changeset as sources.
   * @return  Array of layers currently being used.
   */
  photosUsed(): string[] {
    // These are the English layer names that will appear in the changeset tag if the layer is used.
    const LAYERNAMES: Record<LayerID, string> = {
      'streetside': 'Bing Streetside',
      'mapillary': 'Mapillary',
      'mapillary-detections': 'Mapillary Detected Objects',
      'mapillary-signs': 'Mapillary Traffic Signs',
      'kartaview': 'KartaView'
    };

    const results = [];

    if (this._currPhotoLayerID && this._currPhotoID) {
      results.push(LAYERNAMES[this._currPhotoLayerID]);
    }
    if (this._currDetectionLayerID && this._currDetectionID) {
      results.push(LAYERNAMES[this._currDetectionLayerID]);
    }

    return results;
  }


  /**
   * layerIDs
   * @return  All available layerIDs
   * @readonly
   */
  get layerIDs(): LayerID[] {
    return ['streetside', 'mapillary', 'mapillary-detections', 'mapillary-signs', 'kartaview'];
  }

  /**
   * photoLayerIDs
   * @return  All available photo layerIDs
   * @readonly
   */
  get photoLayerIDs(): PhotoLayerID[] {
    return ['streetside', 'mapillary', 'kartaview'];
  }

  /**
   * detectionLayerIDs
   * @return  All available detection layerIDs
   * @readonly
   */
  get detectionLayerIDs(): DetectionLayerID[] {
    return ['mapillary-detections', 'mapillary-signs'];
  }

  /**
   * photoTypes
   * @return  All available photo types
   * @readonly
   */
  get photoTypes(): PhotoType[] {
    return ['flat', 'panoramic'];
  }

  /**
   * dateFilters
   * @return  All available date filters
   * @readonly
   */
  get dateFilters(): DateFilter[] {
    return ['fromDate', 'toDate'];
  }

  /**
   * fromDate
   * @return  The from date filter value, as YYYY-MM-DD, or null if unset
   * @readonly
   */
  get fromDate(): string | null {
    return this._filterFromDate;
  }

  /**
   * toDate
   * @return  The to date filter value, as YYYY-MM-DD, or null if unset
   * @readonly
   */
  get toDate(): string | null {
    return this._filterToDate;
  }

  /**
   * usernames
   * @return  The usernames filter value, or null if unset
   * @readonly
   */
  get usernames(): string[] | null {
    return this._filterUsernames;
  }

  /**
   * currPhotoLayerID
   * @return  The current photo layerID
   * @readonly
   */
  get currPhotoLayerID(): PhotoLayerID | null {
    return this._currPhotoLayerID;
  }

  /**
   * currPhotoID
   * @return  The current photoID
   * @readonly
   */
  get currPhotoID(): string | null {
    return this._currPhotoID;
  }

  /**
   * currDetectionLayerID
   * @return  The current detection layerID
   * @readonly
   */
  get currDetectionLayerID(): DetectionLayerID | null {
    return this._currDetectionLayerID;
  }

  /**
   * currDetectionID
   * @return  The current detectionID
   * @readonly
   */
  get currDetectionID(): string | null {
    return this._currDetectionID;
  }


  /**
   * selectPhoto
   * Pass falsy values to deselect the layer and photo.
   * @param layerID - The layerID to select
   * @param photoID - The photoID to select
   */
  selectPhoto(layerID: PhotoLayerID | null = null, photoID: string | null = null): void {
    const context = this.context;
    const map = context.systems.map;
    const gfx = context.systems.gfx;
    const scene = gfx?.scene;

    const didChange = (this._currPhotoLayerID !== layerID || this._currPhotoID !== photoID);

    // If we're selecting a photo then make sure its layer is enabled too.
    if (scene && layerID && this.photoLayerIDs.includes(layerID) && !this.isLayerEnabled(layerID)) {
      scene.enableLayers(layerID);
      return;  // exit to avoid infinite loop, we will be right back in here via `_layerChanged` handler.
    }

    // Clear out any existing selection..
    this._currPhotoLayerID = null;
    this._currPhotoID = null;
    scene?.clearClass('selectphoto');

    // Apply the new selection..
    if (photoID && layerID && this.photoLayerIDs.includes(layerID)) {
      const service = context.services[layerID];
      if (!service) return;

      this._currPhotoLayerID = layerID;
      this._currPhotoID = photoID;
      scene?.setClass('selectphoto', layerID, photoID);

      // Try to show the viewer with the image selected..
      service.selectImageAsync(photoID)
        .then((photo: any) => {
          if (!photo) return;
          if (photo.id !== this._currPhotoID) return;  // exit if something else is now selected
          if (this._currDetectionID) return;  // don't adjust the map if a detection is already selected

          if (didChange) {
            map?.centerEase(photo.loc);
          }
        })
        .then(() => this.showViewer());
    }

    this._photoChanged();
  }


  /**
   * selectDetection
   * Pass falsy values to deselect the layer and detection.
   * @param layerID - The layerID to select
   * @param detectionID - The detectionID to select
   */
  selectDetection(layerID: DetectionLayerID | null = null, detectionID: string | null = null): void {
    const context = this.context;
    const map = context.systems.map;
    const gfx = context.systems.gfx;
    const scene = gfx?.scene;

    // If we're selecting a detection then make sure its layer is enabled too.
    if (scene && layerID && this.detectionLayerIDs.includes(layerID) && !this.isLayerEnabled(layerID)) {
      scene.enableLayers(layerID);
      return;  // exit to avoid infinite loop, we will be right back in here via `_layerChanged` handler.
    }

    // Clear out any existing selection..
    this._currDetectionLayerID = null;
    this._currDetectionID = null;
    scene?.clearClass('selectdetection');
    scene?.clearClass('highlightphoto');

    // Apply the new selection..
    if (detectionID && layerID && this.detectionLayerIDs.includes(layerID)) {
      const photoLayerID = layerID.split('-')[0] as PhotoLayerID;     // e.g. 'mapillary-signs' -> 'mapillary'
      const service = context.services[photoLayerID];
      if (!service) return;

      this._currDetectionLayerID = layerID;
      this._currDetectionID = detectionID;
      scene?.setClass('selectdetection', layerID, detectionID);

      // Try to highlight any photos that show this detection,
      // And try to select a photo in the viewer that shows it.
      service.selectDetectionAsync(detectionID)
        .then((detection: any) => {
          if (!detection) return;
          if (detection.id !== this._currDetectionID) return;  // exit if something else is now selected

          // Handle the situation where we want to select a detection,
          // but we haven't properly entered SelectMode yet.
          // This can happen if the detection arrived in the URL hash.
          if (!context.selectedData().has(detection.id)) {
            const selection = new Map().set(detection.id, detection);
            context.enter('select', { selection: selection });
            return;  // exit to avoid infinite loop - entering select mode will bring us right back in here.
          }

          // Highlight any images that show this detection..
          const highlightPhotoIDs = (detection.props.images ?? []).map((image: any) => image.id);
          for (const photoID of highlightPhotoIDs) {
            scene?.setClass('highlightphoto', photoLayerID, photoID);
          }

          // Try to select a photo that shows this detection..
          // - If the current photo already shows it, keep it selected
          // - Otherwise choose the "best" photo suggested by the detection
          // - Otherwise no selected photo.
          let bestPhotoID;
          if (this._currPhotoLayerID === photoLayerID && highlightPhotoIDs.includes(this._currPhotoID)) {
            bestPhotoID = this._currPhotoID;
          } else {
            bestPhotoID = detection.props.bestImageID;
          }

          // If we are changing the selected photo to a new photo,
          // Try to adjust the map to show both the detection and the best photo (if any)
          // (note: make sure the detection actually has a location, see Rapid#1557)
          if (detection.loc && (!this._currPhotoID || this._currPhotoID !== bestPhotoID)) {
            const extent = new Extent(detection.loc);
            const bestPhoto = service.getImage(bestPhotoID);
            if (bestPhoto?.loc) {
              extent.extendSelf(bestPhoto.loc);
            }

            // Need to zoom out a little to see both things?
            if (map) {
              const needZoom = map.trimmedExtentZoom(extent) - 0.5;  // little extra so the things aren't at the map edges
              const currZoom = context.viewport.transform.zoom;
              map.centerZoomEase(extent.center(), Math.min(needZoom, currZoom));
            }
          }

          // Select the best photo (if any)
          this.selectPhoto(photoLayerID, bestPhotoID);
        });

    // If there is now no detection selected, we should still refresh the viewer,
    // in case it needs to replace any detection highlights or segmentations..
    } else {
      this.selectPhoto(this._currPhotoLayerID, this._currPhotoID);  // keep selection
    }

    this._photoChanged();
  }


  /**
   * dateFilterValue
   * Gets a date filter value
   * @param val - 'fromDate' or 'toDate'
   * @return  The from date or to date value, or `null` if unset
   */
  dateFilterValue(val: DateFilter): string | null {
    if (val === 'fromDate') return this._filterFromDate;
    if (val === 'toDate') return this._filterToDate;
    return null;
  }


  /**
   * setDateFilter
   * Sets a date filter value
   * @param type - 'fromDate' or 'toDate'
   * @param val - the value to set it to, should be in YYYY-MM-DD format
   */
  setDateFilter(type: DateFilter, val: Nullable<string>): void {
    const newValue = utilDateString(val) || null;
    const newDate = utilDate(val);
    let didChange = false;

    if (type === 'fromDate') {   // set the fromDate..
      this._filterFromDate = newValue;
      didChange = true;

      const toDate = utilDate(this._filterToDate);
      if (newDate && toDate && newDate > toDate) {  // if new fromDate is after toDate..
        this._filterToDate = newValue;
      }
    }

    if (type === 'toDate') {    // set the toDate..
      this._filterToDate = newValue;
      didChange = true;

      const fromDate = utilDate(this._filterFromDate);
      if (newDate && fromDate && newDate < fromDate) {  // if new toDate is before fromDate..
        this._filterFromDate = newValue;
      }
    }

    if (didChange) {
      this._photoChanged();
    }
  }


  /**
   * setUsernameFilter
   * Sets a username filter value
   * @param val - The value to set it to
   */
  setUsernameFilter(val: string | string[] | null | undefined): void {
    let usernames: string[] | null = null;
    if (val && typeof val === 'string') {
      usernames = val.replace(/;/g, ',').split(',');
    } else if (Array.isArray(val)) {
      usernames = val;
    }
    if (usernames) {
      usernames = usernames.map(d => d.trim()).filter(Boolean);
      if (!usernames.length) {
        usernames = null;
      }
    }
    this._filterUsernames = usernames;
    this._photoChanged();
  }


  /**
   * togglePhotoType
   * Toggles a photo type display on/off
   * @param which - String phototype to toggle on/off ('flat', or 'panoramic')
   */
  togglePhotoType(which: PhotoType): void {
    if (!this.photoTypes.includes(which)) return;

    if (this._filterPhotoTypes.has(which)) {
      this._filterPhotoTypes.delete(which);
    } else {
      this._filterPhotoTypes.add(which);
    }
    this._photoChanged();
  }


  /**
   * isLayerEnabled
   * Is the given layerID enabled?
   * @param layerID - the layerID to check
   * @return  `true` if enabled, `false` if not
   */
  isLayerEnabled(layerID: LayerID): boolean {
    const context = this.context;
    const gfx = context.systems.gfx;
    const layer = gfx?.scene?.layers?.get(layerID);
    return layer?.enabled ?? false;
  }


  /**
   * showViewer
   * Show the photo viewer
   */
  showViewer(): void {
    const context = this.context;
    const layerID = this._currPhotoLayerID;
    const photoID = this._currPhotoID;
    if (!layerID || !photoID) return;   // nothing to show

    const service = context.services[layerID];
    service?.showViewer();
  }


  /**
   * hideViewer
   * Hide the photo viewer.  If the viewer was showing a photo, deselect the photo.
   */
  hideViewer(): void {
    for (const layerID of this.photoLayerIDs) {
      if (layerID === this._currPhotoLayerID) {
        this.selectPhoto();  // deselect
      }
      const service = this.context.services[layerID];
      service?.hideViewer();
    }
  }


  /**
   * isViewerShowing
   * @return  `true` if showing, `false` if not
   */
  isViewerShowing(): boolean {
    // viewer exists and is not hidden
    const context = this.context;
    const $viewer: D3Selection = context.container().selectAll('.photoviewer');
    return !!$viewer.size() && !$viewer.classed('hide');
  }


  shouldFilterByDate(): boolean {
    return !!this.isLayerEnabled('mapillary') || !!this.isLayerEnabled('kartaview') || !!this.isLayerEnabled('streetside');
  }
  shouldFilterByPhotoType(): boolean {
    return !!this.isLayerEnabled('mapillary') || (!!this.isLayerEnabled('streetside') && !!this.isLayerEnabled('kartaview'));
  }
  shouldFilterByUsername(): boolean {
    return !this.isLayerEnabled('mapillary') && !!this.isLayerEnabled('kartaview') && !this.isLayerEnabled('streetside');
  }
  showsPhotoType(val: PhotoType): boolean {
    if (!this.shouldFilterByPhotoType()) return true;
    return this._filterPhotoTypes.has(val);
  }
  showsFlat(): boolean {
    return this.showsPhotoType('flat');
  }
  showsPanoramic(): boolean {
    return this.showsPhotoType('panoramic');
  }
}
