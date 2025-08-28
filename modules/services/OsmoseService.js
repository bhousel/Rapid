import * as PIXI from 'pixi.js';
import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';
import { marked } from 'marked';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Marker } from '../models/Marker.js';
import { utilFetchResponse } from '../util/index.js';


const TILEZOOM = 14;
const OSMOSE_API = 'https://osmose.openstreetmap.fr/api/0.3';


/**
 * `OsmoseService`
 * This service connects to the Osmose API to fetch detected QA issues.
 * @see https://wiki.openstreetmap.org/wiki/Osmose/api/0.3
 *
 * Events available:
 *   'loadedData'
 */
export class OsmoseService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'osmose';
    this.requiredDependencies = new Set(['assets', 'spatial']);
    this.optionalDependencies = new Set(['gfx', 'l10n']);
    this.autoStart = false;

    // persistent data - loaded at start
    this._osmoseColors = new Map();    // Map<itemType, hex color>
    this._osmoseStrings = new Map();   // Map<locale, Object containing strings>
    this._osmoseData = { icons: {}, types: [] };

    this._cache = {};
    this._tiler = new Tiler().zoomRange(TILEZOOM).skipNullIsland(true);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    if (this._startPromise) return this._startPromise;

    const assets = this.context.systems.assets;

    return this._startPromise = assets.loadAssetAsync('qa_data')
      .then(d => {
        this._osmoseData.icons = d.osmose.icons;
        this._osmoseData.types = Object.keys(d.osmose.icons)
          .map(s => s.split('-')[0])
          .reduce((unique, item) => unique.indexOf(item) !== -1 ? unique : [...unique, item], []);
      })
      .then(() => this._loadStringsAsync())
      .then(() => this._started = true)
      .catch(err => {
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        this._startPromise = null;
      });
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    if (this._cache.inflightTile) {
      for (const controller of this._cache.inflightTile.values()) {
        controller.abort();
      }
    }
    this._cache = {
      inflightTile:  new Map(),   // Map<tileID, AbortController>
      inflightPost:  new Map(),   // Map<dataID, AbortController>
      closed:        {},
      lastv:         null         // viewport version last time we fetched data
    };

    return Promise.resolve();
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @return  {Array<Marker>}  Array of data
   */
  getData() {
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('osmose').map(d => d.data);
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   */
  loadTiles() {
    const context = this.context;
    const spatial = context.systems.spatial;
    const viewport = context.viewport;
    const cache = this._cache;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const [tileID, controller] of cache.inflightTile) {
      const isNeeded = tiles.some(tile => tile.id === tileID);
      if (!isNeeded) {
        controller.abort();
      }
    }

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      if (spatial.hasTile('osmose', tileID) || cache.inflightTile.has(tileID)) continue;
      this.loadTile(tile);
    }
  }


  /**
   * loadTile
   * Load a single tile of data.
   * @param  {Tile}  tile - Tile data
   */
  loadTile(tile) {
    const spatial = this.context.systems.spatial;
    const cache = this._cache;
    const tileID = tile.id;

    const [x, y, z] = tile.xyz;
    const params = { item: this._osmoseData.types };   // Only request the types that we support
    const url = `${OSMOSE_API}/issues/${z}/${x}/${y}.json?` + utilQsString(params);

    const controller = new AbortController();
    cache.inflightTile.set(tileID, controller);

    fetch(url, { signal: controller.signal })
      .then(utilFetchResponse)
      .then(response => this._gotTile(tile, response))
      .catch(err => {
        if (err.name === 'AbortError') return;          // ok
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        spatial.addTiles('osmose', [tile]);             // don't retry
      })
      .finally(() => {
        cache.inflightTile.delete(tileID);
      });
  }


  /**
   * _gotTile
   * Parse the response from the tile fetch
   * @param  {Tile}  tile - Tile data
   * @param  {Object}  response - Response data
   */
  _gotTile(tile, response) {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;

    spatial.addTiles('osmose', [tile]);   // mark as loaded

    for (const feature of (response.features ?? [])) {
      // Osmose issues are uniquely identified by a unique
      // `item` and `class` combination (both integer values)
      const { item, class: cl, uuid: id } = feature.properties;
      const itemType = `${item}-${cl}`;
      const iconID = this._osmoseData.icons[itemType];

      // Filter out unsupported issue types (some are too specific or advanced)
      if (!iconID) continue;

      const loc = spatial.preventCoincidentLoc('osmose', feature.geometry.coordinates);
      const props = {
        id:        id,
        class:     cl,
        item:      item,
        type:      itemType,
        iconID:    iconID,
        serviceID: this.id,
        loc:       loc
      };

      // Assigning `elems` here prevents UI detail requests
      if (item === 8300 || item === 8360) {
        props.elems = [];
      }

      spatial.addData('osmose', new Marker(context, props));
    }

    gfx?.deferredRedraw();
    this.emit('loadedData');
  }


  /**
   * loadIssueDetailAsync
   * Fetch additional issue details when needed.
   * @param   {Marker}   issue
   * @return  {Promise}  Promise resolved once the data has been fetched
   */
  loadIssueDetailAsync(issue) {
    // Issue details only need to be fetched once
    if (issue.props.elems !== undefined) return Promise.resolve(issue);

    const l10n = this.context.systems.l10n;
    const localeCode = l10n?.localeCode() || 'en-US';

    const url = `${OSMOSE_API}/issue/${issue.id}?langs=${localeCode}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(data => {
        // Associated elements used for highlighting
        // Assign directly for immediate use in the callback
        const elems = data.elems.map(e => e.type.substring(0,1) + e.id);
        // Some issues have instance specific detail in a subtitle
        const detail = data.subtitle ? marked.parse(data.subtitle.auto) : '';

        issue.props.elems = elems;
        issue.props.detail = detail;
        issue.touch();
        this.replaceItem(issue);
        return issue;
      });
  }


  /**
   * getStrings
   * @param   {string}  itemType
   * @param   {string}  locale
   * @return  {Object}  stringdata
   */
  getStrings(itemType, locale) {
    const l10n = this.context.systems.l10n;
    locale = locale || l10n?.localeCode() || 'en-US';

    const stringData = this._osmoseStrings.get(locale) ?? {};
    return stringData[itemType] ?? {};
  }


  /**
   * getColor
   * Get the color associated with this issue type
   * @param   {number}  itemInt
   * @return  {number}  hex color
   */
  getColor(itemInt) {
    return this._osmoseColors.get(itemInt) ?? 0xffffff;
  }


  /**
   * getIcon
   * Get the icon to use for the given itemType
   * @param   itemType
   * @return  icon name
   */
  getIcon(itemType) {
    return this._osmoseData.icons[itemType];
  }


  /**
   * postUpdate
   * Called to change some properies (status, comments) about the Osmose data item.
   * Will send the update to the Osmose API and refresh the local data cache.
   * @param  {Marker}    item
   * @param  {function}  callback - errback-style callback function to call with results
   */
  postUpdate(issue, callback) {
    const cache = this._cache;
    const issueID = issue.id;
    const status = issue.props.newStatus;
    const item = issue.props.item;

    if (cache.inflightPost.has(issueID)) {
      return callback({ message: 'Issue update already inflight', status: -2 }, issue);
    }

    // UI sets the status to either 'done' or 'false'
    const url = `${OSMOSE_API}/issue/${issueID}/${status}`;
    const controller = new AbortController();
    cache.inflightPost.set(issueID, controller);

    let gotErr;
    fetch(url, { signal: controller.signal })
      .catch(err => {
        gotErr = err;  // capture any error but continue to `finally` block.
      })
      .finally(() => {
        cache.inflightPost.delete(issueID);

        this.removeItem(issue);

        if (status === 'done') {
          // Keep track of the number of issues closed per `item` to tag the changeset
          if (!(item in this._cache.closed)) {
            this._cache.closed[item] = 0;
          }
          this._cache.closed[item] += 1;
        }

        if (callback) {
          callback(gotErr?.message, issue);
        }
      });
  }


  /**
   * getError
   * Get item with given id from cache
   * @param   {string}   dataID
   * @return  {Marker?}  the cached item, or `undefined` if not found
   */
  getError(dataID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('osmose', dataID);
  }


  /**
   * replaceItem
   * Replace a single item in the cache
   * @param   {Marker}  item to replace
   * @return  {Marker}  the item, or `null` if it couldn't be replaced
   */
  replaceItem(item) {
    if (!(item instanceof Marker) || !item.id) return null;

    const spatial = this.context.systems.spatial;
    return spatial.replaceData('osmose', item);
  }


  /**
   * removeItem
   * Remove a single item from the cache
   * @param  {Marker}  item to remove
   */
  removeItem(item) {
    if (!(item instanceof Marker) || !item.id) return;

    const spatial = this.context.systems.spatial;
    return spatial.removeData('osmose', item);
  }



  /**
   * getClosedCounts
   * Used to populate `closed:osmose:*` changeset tags
   * @return  {Object}  the closed cache
   */
  getClosedCounts() {
    return this._cache.closed;
  }


  /**
   * itemURL
   * Returns the URL to link to details about an item
   * @param   {Marker}  item
   * @return  {string}  the url
   */
  itemURL(item) {
    return `https://osmose.openstreetmap.fr/en/error/${item.id}`;
  }


  /**
   * _loadStringsAsync
   * Load the strings for the types of issues that we support
   * @return  Promise
   */
  _loadStringsAsync() {
    // Only need to cache strings for supported issue types
    const itemTypes = Object.keys(this._osmoseData.icons);

    // For now, we only do this one time at init.
    // Todo: support switching locales
    let stringData = {};

    const l10n = this.context.systems.l10n;
    const localeCode = l10n?.localeCode() || 'en-US';
    this._osmoseStrings.set(localeCode, stringData);

    // Using multiple individual item + class requests to reduce fetched data size
    const allRequests = itemTypes.map(itemType => {

      const handleResponse = (data) => {
        // Bunch of nested single value arrays of objects
        const [ cat = { items:[] } ] = data.categories;
        const [ item = { class:[] } ] = cat.items;
        const [ cl = null ] = item.class;

        // If null default value is reached, data wasn't as expected (or was empty)
        if (!cl) {
          /* eslint-disable no-console */
          console.log(`Osmose strings request (${itemType}) had unexpected data`);
          /* eslint-enable no-console */
          return;
        }

        // Save item colors to automatically style issue markers later
        const itemInt = item.item;
        this._osmoseColors.set(itemInt, new PIXI.Color(item.color).toNumber());

        // Value of root key will be null if no string exists
        // If string exists, value is an object with key 'auto' for string
        const { title, detail, fix, trap } = cl;

        let issueStrings = {};
        // Force title to begin with an uppercase letter
        if (title)  issueStrings.title = title.auto.charAt(0).toUpperCase() + title.auto.slice(1);
        if (detail) issueStrings.detail = marked.parse(detail.auto);
        if (trap)   issueStrings.trap = marked.parse(trap.auto);
        if (fix)    issueStrings.fix = marked.parse(fix.auto);

        stringData[itemType] = issueStrings;
      };

      // Osmose API falls back to English strings where untranslated or if locale doesn't exist
      const [item, cl] = itemType.split('-');
      const url = `${OSMOSE_API}/items/${item}/class/${cl}?langs=${localeCode}`;

      return fetch(url)
        .then(utilFetchResponse)
        .then(handleResponse);

    }).filter(Boolean);

    return Promise.all(allRequests);
  }
}
