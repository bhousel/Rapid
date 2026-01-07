import { geoMetersToOffset, geoOffsetToMeters } from '@rapid-sdk/math';
import whichPolygon from 'which-polygon';

import { AbstractSystem } from './AbstractSystem.js';
import {
  ImagerySource, ImagerySourceBing, ImagerySourceCustom,
  ImagerySourceEsri, ImagerySourceEsriWayback, ImagerySourceNone
} from '../lib/ImagerySource.ts';
import { utilWildcard } from '../util/string.ts';

// Make very sure this resolves to Rapid's `package.json`
// If you mess up the `../`s, the resolver may import another random package.json from somewhere else.
import { version as rapidVersion } from '../../package.json' with { type: 'json' };


/**
 * `ImagerySystem` maintains the state of the tiled background and overlay imagery.
 *
 * At init time, Rapid will load the default imagery data from the bundled imagery index,
 * but additional imagery data can be merged in to supplement or override the defaults.
 *
 * Properties available:
 *   `bundles`         {Set<bundleID>}               Names of imagery bundles that have been merged in
 *   `features`        {Map<sourceID, GeoJSON>}      GeoJSON features for spatial queries
 *   `sources`         {Map<sourceID, ImagerySource>} The imagery sources
 *   `offset`
 *   `brightness`
 *   `contrast`
 *   `saturation`
 *   `sharpness`
 *   `numGridSplits`
 *
 * Events available:
 *   `imagerychange`     Fires on any change in imagery or display options
 */
export class ImagerySystem extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'imagery';
    this.requiredDependencies = new Set(['assets']);
    this.optionalDependencies = new Set(['gfx', 'l10n', 'storage', 'urlhash']);

    this.bundles = new Set();    // Set<bundleID> - track merged imagery bundles
    this.features = new Map();   // Map<sourceID, GeoJSON feature>
    this.sources = new Map();    // Map<sourceID, ImagerySource>

    this._baseLayer = null;
    this._overlayLayers = new Map();   // Map<sourceID, ImagerySource>
    this._checkedBlocklists = [];
    this._isValid = true;    // todo, find a new way to check this, no d3 enter/update render anymore
    this._whichPolygon = null;    // which-polygon index

    this._brightness = 1;
    this._contrast = 1;
    this._saturation = 1;
    this._sharpness = 1;
    this._numGridSplits = 0; // No grid by default.

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashchange = this._hashchange.bind(this);
    this._imageryChanged = this._imageryChanged.bind(this);
    this._localeChanged = this._localeChanged.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
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
          assets.initAsync(),
          gfx?.initAsync(),      // `gfx.scene` will exist after `initAsync`
          l10n?.initAsync(),
          storage?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup event handlers..
        urlhash?.on('hashchange', this._hashchange);
        gfx?.scene?.on('layerchange', this._imageryChanged);
        l10n?.on('localechange', this._localeChanged);
      })
      .then(() => this._loadDefaultImageryAsync());
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    return Promise.resolve();
  }


  /**
   * merge
   * Accepts an object containing new imagery data (all properties except 'bundleID' are optional):
   * {
   *   bundleID: '',    // A string identifier, e.g. 'editor-layer-index@2025'
   *   imagery: {},     // Object<sourceID, imageryData>
   * }
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
   * @param  {Object}  src - imagery data to merge
   * @throws  Will throw if given data does not contain a `bundleID`, or if the `bundleID` has already been merged
   */
  merge(src = {}) {
    const context = this.context;

    const bundleID = src.bundleID;
    if (!bundleID) {
      throw new Error('Imagery missing bundleID property');
    }
    if (this.bundles.has(bundleID)) {
      throw new Error(`Imagery "${bundleID}" already merged`);
    }

    this.bundles.add(bundleID);

    // Merge Imagery Sources
    if (src.imagery) {
      for (const [sourceID, props] of Object.entries(src.imagery)) {
        const sourceKey = sourceID.toLowerCase();

        if (props) {   // add or replace
          // Instantiate the appropriate `ImagerySource` class
          let source;
          if (props.type === 'bing') {
            source = new ImagerySourceBing(context, { bundleID: bundleID, ...props });
          } else if (/^EsriWorldImagery/.test(sourceID)) {
            source = new ImagerySourceEsri(context, { bundleID: bundleID, ...props });
          } else {
            source = new ImagerySource(context, { bundleID: bundleID, ...props });
          }
          this.sources.set(sourceKey, source);

          // Save the GeoJSON feature too, if there is one.
          if (props.feature) {
            this.features.set(sourceKey, props.feature);
          }

        } else {   // remove
          const wildcard = utilWildcard(sourceID);
          if (wildcard) {
            for (const k of this.sources.keys()) {
              if (wildcard.test(k)) {
                this.sources.delete(k);
                this.features.delete(k);
              }
            }
          } else {
            this.sources.delete(sourceKey);
            this.features.delete(sourceKey);
          }
        }
      }
    }

    this._rebuildIndex();
  }


  /**
   * source
   * Returns the ImagerySource with the given id.
   * @param   {string}        sourceID - a source id
   * @return  {ImagerySource} The ImagerySource, or `undefined` if not found
   */
  source(sourceID) {
    return this.sources.get(sourceID?.toLowerCase());
  }


  /**
   * imageryUsed
   * Called by the EditSystem to gather the sources being used to make an edit.
   * We return the English name of any active imagery layers, it will be included in the user's changeset.
   * @return  {Array<string>}  Array of the names of imagery layers currently visible
   */
  imageryUsed() {
    const results = new Set();

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
   *  visibleSources
   *  Returns array of known imagery sources that are valid at the given extent and zoom
   *  @return {Array<ImagerySource>}  Visible imagery sources
   */
  visibleSources() {
    if (!this.sources.size || !this._whichPolygon) return [];   // called too soon?

    const context = this.context;
    const viewport = context.viewport;
    const extent = viewport.visibleExtent();
    const zoom = viewport.transform.zoom;

    const visible = new Set();
    (this._whichPolygon.bbox(extent.rectangle(), true) || [])
      .forEach(d => visible.add(d.id));

    const currSource = this._baseLayer;
    const sources = [...this.sources.values()];

    // Recheck blocked sources only if we detect new blocklists pulled from the OSM API.
    const osm = context.services.osm;
    const blocklists = osm?.imageryBlocklists ?? [];
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
      if (source.props.isBlocked) return false;  // even bundled sources may be blocked - iD#7905
      if (!source.props.feature) return true;    // always include imagery with worldwide coverage
      if (zoom && zoom < 6) return false;        // optionally exclude local imagery at low zooms
      return visible.has(source.id);             // include imagery visible in given extent
    });
  }


  /**
   *
   */
  baseLayerSource(source) {
    if (!arguments.length) return this._baseLayer;

    // test source against OSM imagery blocklists..
    const osm = this.context.services.osm;
    if (!osm) return this;

    const blocklists = osm?.imageryBlocklists ?? [];
    const template = source.template;
    let fail = false;
    let tested = 0;
    let regex;

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

    this._baseLayer = (!fail ? source : this.getSourceByID('none'));

    this._imageryChanged();
    return this;
  }


  /**
   * chooseDefaultSource
   * When we haven't been told to use a specific background imagery,
   * this tries several options to pick an appropriate imagery to use.
   */
  chooseDefaultSource() {
    const context = this.context;
    const storage = context.systems.storage;

    const available = this.visibleSources();
    const first = available[0];
    const best = available.find(s => s.props.best);

    // Consider previously chosen imagery unless it was 'none'
    let previousID = storage?.getItem('background-last-used') || 'none';
    const previous = (previousID !== 'none') && this.getSourceByID(previousID);

    return best ||
      previous ||
      this.getSourceByID('Bing') ||
      first ||    // maybe this is a custom Rapid that doesn't include Bing?
      this.getSourceByID('none');
  }


  /**
   * getSource
   * Returns an ImagerySource for the given `sourceID`
   * @param   {string}  sourceID -  The sourceID to get
   * @return  {ImagerySource?}  The `ImagerySource` with the given ID, or `null` if not found
   */
  getSourceByID(sourceID = '') {
    if (/^EsriWayback/i.test(sourceID)) {   // ignore start date, if any
      sourceID = 'EsriWayback';
    }
    return this.sources.get(sourceID.toLowerCase());
  }


  /**
   * setSourceByID
   * Activates the base layer with the given `sourceID`
   * This function will correctly handle IDs like `EsriWayback_<DATE>`.
   * @param   {string}  sourceID -  The sourceID to activate
   */
  setSourceByID(sourceID = '') {
    let date;
    const match = sourceID.match(/^EsriWayback\_?(.*)$/i);   // get start date, if any
    if (match) {
      sourceID = 'EsriWayback';
      date = match[1];
    }

    const source = this.getSourceByID(sourceID);
    if (source) {
      if (date) {
        source.date = date;
      }
      this.baseLayerSource(source);
    }
  }


  /**
   *
   */
  showsLayer(source) {
    const currSource = this._baseLayer;
    if (!source || !currSource) return false;
    return source.id === currSource.id || this._overlayLayers.has(source.id);
  }


  /**
   *
   */
  overlayLayerSources() {
    return [...this._overlayLayers.values()];
  }


  /**
   *
   */
  toggleOverlayLayer(source) {
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
   *  ignoring the "locator overlay"
   * @param  {Set|Array}  enableIDs  Iterable Set or Array of sourceIDs to enable
   */
  enableOverlayLayers(enableIDs) {
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
   * nudge offset, in delta pixels [dx,dy]
   * @param  delta  pixels to nudge, as [dx, dy]
   * @param  zoom   the current zoom
   */
  nudge(delta, zoom) {
    if (this._baseLayer) {
      const zoom = this.context.viewport.transform.zoom;
      this._baseLayer.nudge(delta, zoom);
      this._imageryChanged();
    }
  }


  /**
   * offset
   * set/get offset, in pixels [x,y]
   */
  get offset() {
    return this._baseLayer?.offset || [0, 0];
  }
  set offset([setX, setY] = [0, 0]) {
    const [currX, currY] = this._baseLayer?.offset || [0, 0];
    if (setX === currX && setY === currY) return;  // no change

    if (this._baseLayer) {
      this._baseLayer.offset = [setX, setY];
      this._imageryChanged();
    }
  }

  /**
   * brightness
   * set/get brightness
   */
  get brightness() {
    return this._brightness;
  }
  set brightness(val = 1) {
    if (val === this._brightness) return;  // no change
    this._brightness = val;

    const context = this.context;
    const layer = context.systems.gfx?.scene?.layers?.get('background');
    layer?.setBrightness(val);
    this._imageryChanged();
  }

  /**
   * contrast
   * set/get contrast
   */
  get contrast() {
    return this._contrast;
  }
  set contrast(val = 1) {
    if (val === this._contrast) return;  // no change
    this._contrast = val;

    const context = this.context;
    const layer = context.systems.gfx?.scene?.layers?.get('background');
    layer?.setContrast(val);
    this._imageryChanged();
  }

  /**
   * saturation
   * set/get saturation
   */
  get saturation() {
    return this._saturation;
  }
  set saturation(val = 1) {
    if (val === this._saturation) return;  // no change
    this._saturation = val;

    const context = this.context;
    const layer = context.systems.gfx?.scene?.layers?.get('background');
    layer?.setSaturation(val);
    this._imageryChanged();
  }

  /**
   * sharpness
   * set/get sharpness
   */
  get sharpness() {
    return this._sharpness;
  }
  set sharpness(val = 1) {
    if (val === this._sharpness) return;  // no change
    this._sharpness = val;

    const context = this.context;
    const layer = context.systems.gfx?.scene?.layers?.get('background');
    layer?.setSharpness(val);
    this._imageryChanged();
  }

  /**
   * numGridSplits
   * set/get numGridSplits  (unused?)
   */
  get numGridSplits() {
    return this._numGridSplits;
  }
  set numGridSplits(val = 0) {
    if (val === this._numGridSplits) return;  // no change
    this._numGridSplits = val;
    this._imageryChanged();
  }


  /**
   * _loadDefaultImageryAsync
   * This loads the default imagery for Rapid:
   *  - edior-layer-index
   *  - rapid imagery overrides
   */
  _loadDefaultImageryAsync() {
    const context = this.context;
    const assets = context.systems.assets;

    // Tell the AssetSystem what to load..
    assets.setAsset('editor_layer_index', 'data/imagery.min.json');
    // 'rapid_imagery_overrides' = customizations to merge in after the editor-layer-index
    assets.setAsset('rapid_imagery_overrides', 'data/imagery_overrides.min.json');

    // Fetch the imagery data
    return Promise.all([
      assets.loadAssetAsync('editor_layer_index'),
      assets.loadAssetAsync('rapid_imagery_overrides')
    ])
    .then(vals => {
      // Merge editor-layer-index bundle..
      this.merge(vals[0]);

      // Merge rapid_imagery_overrides..
      const rapidSchemaVersion = rapidVersion || 'unknown';
      this.merge({
        bundleID: `rapid-imagery-overrides@${rapidSchemaVersion}`,
        ...vals[1]
      });

      // Add built-in sources (None, Custom) that don't come from data files
      this._addBuiltinSources();

      // Default the locator overlay to "on"..
      const locator = this.sources.get('mapbox_locator_overlay');
      if (locator) {
        this.toggleOverlayLayer(locator);
      }
    });
  }


  /**
   * _addBuiltinSources
   * Add the built-in imagery sources that don't come from data files.
   * These are 'None', 'Custom', and 'EsriWayback'.
   */
  _addBuiltinSources() {
    const context = this.context;
    const storage = context.systems.storage;
    const wayback = context.services.wayback;

    // Add 'None'
    const none = new ImagerySourceNone(context);
    this.sources.set(none.id.toLowerCase(), none);

    // Add 'Custom' - seed it with whatever template the user has used previously
    const custom = new ImagerySourceCustom(context);
    custom.template = storage?.getItem('background-custom-template') || '';
    this.sources.set(custom.id.toLowerCase(), custom);

    // Add 'Esri Wayback', if the WaybackService exists.
    if (wayback) {
      const waybackSource = new ImagerySourceEsriWayback(context, props);
      this.sources.set(props.id.toLowerCase(), waybackSource);

      // Copy the feature for Wayback too (for spatial queries)
      const esriFeature = this.features.get('esriworldimagery');
      if (esriFeature) {
        const waybackFeature = JSON.parse(JSON.stringify(esriFeature));
        waybackFeature.properties.id = props.id;
        this.features.set(props.id.toLowerCase(), waybackFeature);
      }
    }
  }


  /**
   * _rebuildIndex
   * Rebuild the whichPolygon spatial index.
   * This should be called after merging new imagery data.
   */
  _rebuildIndex() {
    // Reset and localize the ImagerySources
    for (const source of this.sources.values()) {
      source.reset();
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
   * _hashchange
   * Respond to any changes appearing in the url hash
   * @param  {Map<string, string>}  currParams - The current hash parameters
   * @param  {Map<string, string>}  prevParams - The previous hash parameters
   */
  _hashchange(currParams, prevParams) {
    // background
    const newBackground = currParams.get('background');
    const oldBackground = prevParams.get('background');
    if (!newBackground || newBackground !== oldBackground) {
      let foundSource;
      if (typeof newBackground === 'string') {
        foundSource = this.getSourceByID(newBackground);
      }
      if (foundSource) {
        this.setSourceByID(newBackground);
      } else {
        this.baseLayerSource(this.chooseDefaultSource());
      }
    }

    // overlays
    const newOverlays = currParams.get('overlays');
    const oldOverlays = prevParams.get('overlays');
    if (newOverlays !== oldOverlays) {
      let toEnableIDs = new Set();
      if (typeof newOverlays === 'string') {
        const vals = newOverlays.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        toEnableIDs = new Set(vals);
      }
      this.enableOverlayLayers(toEnableIDs);
    }

    // offset
    const newOffset = currParams.get('offset');
    const oldOffset = prevParams.get('offset');
    if (newOffset !== oldOffset) {
      let x, y;
      if (typeof newOffset === 'string') {
        [x, y] = newOffset.replace(/;/g, ',').split(',').map(s => s.trim()).map(Number);
      }
      if (isNaN(x) || !isFinite(x)) x = 0;
      if (isNaN(y) || !isFinite(y)) y = 0;
      this.offset = geoMetersToOffset([x, y]);
    }
  }


  /**
   * _imageryChanged
   * Called whenever the imagery changes.
   * This will update the urlhash, trigger a redraw, and emit an 'imagerychange' event.
   */
  _imageryChanged() {
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
      let overlayIDs = [];
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
   * @param  {string}  localeCode - optional new locale code (fallback to getting it from LocalizationSystem, or en-US)
   */
  _localeChanged(localeCode) {
    const l10n = this.context.systems.l10n;

    // Ensure that we have a current locale code.
    localeCode ||= l10n?.localeCode() || 'en-US';

    // Reset and localize the ImagerySources
    for (const source of this.sources.values()) {
      source.setLocale(localeCode);
    }
  }

}


/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  @typedef  {string}  bundleID
 */
