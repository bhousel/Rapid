import { geoArea as d3_geoArea, geoMercatorRaw as d3_geoMercatorRaw } from 'd3-geo';
import { DEG2RAD, RAD2DEG, TAU, geoSphericalDistance } from '@rapid-sdk/math';
import { utilAesDecrypt, utilQsString, utilStringQs, utilSafeString } from '@rapid-sdk/util';

import { utilDateString } from '../util/date.js';
import { utilFetchResponse } from '../util/fetch_response.js';


/**
 * ImagerySource
 * An Imagery Source maintains the state of a single tiled imagery source.
 *
 * Properties you can access:
 *   `id` (or `imageryID`)  Unique string to identify this Field.
 *   `safeid`               The id, but safe for use in classes, DOM element ids, css selectors..
 *   `props`                Properties object
 */
export class ImagerySource {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this ImagerySource
   */
  constructor(context, props = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('ImagerySource missing id property');
    }

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
    this.props.alpha ||= 1;
    this.props.tileSize ||= 256;
    this.props.zoomExtent ||= [0, 22];
    this.props.zoomRange ||= 5;
    this.props.isBlocked = false;

    this.offset = [0, 0];

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors
    this._template = props.encrypted ? utilAesDecrypt(props.template) : props.template;

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {};       // The current strings

    const idtx = props.id.replace(/\./g, '<TX_DOT>');  // replace '.' in ids, so localization system can handle them
    this.props.nameStringID ??= `_imagery.imagery.${idtx}.name`;
    this.props.descriptionStringID ??= `_imagery.imagery.${idtx}.description`;

    // For convenient access:
    this.imageryID = this.props.id;
    this.type = this.props.type;   // 'tms', 'wms', or 'bing'
  }


  /**
   * reset
   * Resets all cached data.
   * This should happen whenever ImagerySystem merges in new data.
   * You must add the ImagerySource to the ImagerySystem and call `reset` before using the ImagerySource.
   */
  reset() {
    const l10n = this.context.systems.l10n;

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode() || 'en-US');
  }


  /**
   * setLocale
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * @param  {string}  localeCode - the locale code to switch to (defaults to 'en-US')
   */
  setLocale(localeCode = 'en-US') {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    // Pre-localize and store strings
    const fallbackName = this.props.name || this.id;
    const fallbackDesc = this.props.description || '';
    const fallbackAttr = this.props.terms_text || fallbackName;
    const nameStr = l10n?.t(this.props.nameStringID, { default: '' }) || fallbackName;
    const descStr = l10n?.t(this.props.descriptionStringID, { default: '' }) || fallbackDesc;

    this._currStrings = {
      id: this.id,
      name: nameStr.trim(),
      description: descStr.trim(),
    };

    this._strings.set(this._currLocaleCode, this._currStrings);
  }


  /**
   * name
   * The name is the main display name of the ImagerySource, as shown in the user interface.
   * @return  {string}  Localized name
   * @readonly
   */
  get name() {
    return this._currStrings.name;
  }

  /**
   * description
   * Provides additional descriptive text about the ImagerySource.
   * @return  {string}  Localized description
   * @readonly
   */
  get description() {
    return this._currStrings.description;
  }

  /**
   * key
   * The `key` can be used to uniquely identify this imagery source.
   * It is usually just the `safeid`, but for 'wayback' it will also include the `date`.
   * @return  {string}  The key
   * @readonly
   */
  get key() {
    return this.safeid;
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * @return  {string}  The imagery used string
   * @readonly
   */
  get imageryUsed() {
    return this._currStrings.name;
  }

  /**
   * template
   * Returns the imagery URL template
   * @return  {string}  The imagery URL template
   * @readonly
   */
  get template() {
    return this._template;
  }

  /**
   * area
   * Returns the area of this imagery extent.
   * This area is in steradians (square radians) which is unusual, but useful for comparing areas.
   * @see https://d3js.org/d3-geo/math#geoArea
   * @return  {number}  Area in steradians
   * @readonly
   */
  get area() {
    if (!this.props.polygon) return Number.MAX_VALUE;  // worldwide
    const area = d3_geoArea({ type: 'MultiPolygon', coordinates: [ this.props.polygon ] });
    return isNaN(area) ? 0 : area;
  }

  /**
   * isValidZoom
   * Is the imagery valid at the given zoom?
   * @return  {boolean}  `true` if the imagery is valid at the given zoom, `false` if not
   */
  isValidZoom(z) {
    if (Number.isNaN(z)) return false;
    const [min, max] = this.props.zoomExtent;
    return (z >= min) && (z <= max);
  }

  /**
   * isLocatorOverlay
   * Is this source the "mapbox locator overlay"?
   * @return  {boolean}  `true` if the imagery is the locator overlay, `false` if not
   */
  isLocatorOverlay() {
    return this.id === 'mapbox_locator_overlay';
  }


  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * @param  {Tile}      tile - The tile to get metadata for
   * @param  {function}  callback - errback-style callback function to call with results
   */
  getMetadata(tile, callback) {
    const vintage = {
      start: utilDateString(this.props.startDate),
      end: utilDateString(this.props.endDate)
    };
    vintage.range = this._vintageRange(vintage);

    const metadata = { vintage: vintage };
    if (typeof callback === 'function') {
      callback(null, metadata);
    }
  }


  /**
   * nudge
   * Adjust the imagery offset, in pixels [dx,dy]
   * @param  {Vec2}    delta - pixels to nudge, as [dx, dy]
   * @param  {number}  zoom  - the current zoom
   */
  nudge(delta, zoom) {
    this.offset[0] += delta[0] / Math.pow(2, zoom);
    this.offset[1] += delta[1] / Math.pow(2, zoom);
  }


  /**
   * url
   * Return the url to fetch the imagery for the given tile coordinate
   * @param   {Vec3}    coord - Tile coordinate as [x,y,z]
   * @return  {string}  The url to fetch imagery (empty string if no imagery, for example 'none' source)
   */
  url(coord) {
    const urlTemplate = this.template;
    let result = urlTemplate;
    if (result === '') return result;   // source 'none'

    function _tileToProjectedCoords(proj, x, y, z) {
      const zoomSize = Math.pow(2, z);
      const lon = x / zoomSize * TAU - Math.PI;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / zoomSize)));
      let mercCoords;

      switch (proj) {
        case 'EPSG:4326':
          return {
            x: lon * RAD2DEG,
            y: lat * RAD2DEG
          };
        default: // EPSG:3857 and synonyms
          mercCoords = d3_geoMercatorRaw(lon, lat);
          return {
            x: 20037508.34 / Math.PI * mercCoords[0],
            y: 20037508.34 / Math.PI * mercCoords[1]
          };
      }
    }

    // Guess a type based on the tokens present in the template
    // (This is for 'custom' source, where we don't know)
    if (!this.type) {
      if (/SERVICE=WMS|\{(proj|wkid|bbox)\}/.test(urlTemplate)) {
        this.type = 'wms';
        this.props.projection = 'EPSG:3857';  // guess
      } else if (/\{(x|y)\}/.test(urlTemplate)) {
        this.type = 'tms';
      } else if (/\{u\}/.test(urlTemplate)) {
        this.type = 'bing';
      }
    }

    if (this.type === 'wms') {
      const tileSize = this.props.tileSize;
      const projection = this.props.projection;
      const minXmaxY = _tileToProjectedCoords(projection, coord[0], coord[1], coord[2]);
      const maxXminY = _tileToProjectedCoords(projection, coord[0] + 1, coord[1] + 1, coord[2]);

      result = result.replace(/\{(\w+)\}/g, (match, capture) => {
        switch (capture) {
          case 'width':
          case 'height':
            return tileSize;
          case 'proj':
            return projection;
          case 'wkid':
            return projection.replace(/^EPSG:/, '');
          case 'bbox':
            // WMS 1.3 flips x/y for some coordinate systems including EPSG:4326 - iD#7557
            // The CRS parameter implies version 1.3 (prior versions use SRS)
            if (projection === 'EPSG:4326' && /VERSION=1.3|CRS={proj}/.test(urlTemplate.toUpperCase())) {
              return maxXminY.y + ',' + minXmaxY.x + ',' + minXmaxY.y + ',' + maxXminY.x;
            } else {
              return minXmaxY.x + ',' + maxXminY.y + ',' + maxXminY.x + ',' + minXmaxY.y;
            }
          case 'w':
            return minXmaxY.x;
          case 's':
            return maxXminY.y;
          case 'n':
            return maxXminY.x;
          case 'e':
            return minXmaxY.y;
          default:
            return match;
        }
      });

    } else if (this.type === 'tms') {
      let isRetina = false;
      if ('window' in globalThis) {
        const _window = globalThis.window;
        isRetina = _window.devicePixelRatio && _window.devicePixelRatio >= 2;
      }

      result = result
        .replace('{x}', coord[0])
        .replace('{y}', coord[1])
        // TMS-flipped y coordinate
        .replace(/\{[t-]y\}/, Math.pow(2, coord[2]) - coord[1] - 1)
        .replace(/\{z(oom)?\}/, coord[2])
        // only fetch retina tiles for retina screens
        .replace(/\{@2x\}|\{r\}/, isRetina ? '@2x' : '');

    } else if (this.type === 'bing') {
      result = result
        .replace('{u}', () => {
          let u = '';
          for (let zoom = coord[2]; zoom > 0; zoom--) {
            let b = 0;
            const mask = 1 << (zoom - 1);
            if ((coord[0] & mask) !== 0) b++;
            if ((coord[1] & mask) !== 0) b += 2;
            u += b.toString();
          }
          return u;
        });
    }

    // these apply to any type..
    result = result.replace(/\{switch:([^}]+)\}/, (match, capture) => {
      const subdomains = capture.split(',');
      return subdomains[(coord[0] + coord[1]) % subdomains.length];
    });

    return result;
  }


  /**
   * _vintageRange
   * Helper function to format `start` and `end` dates as a range
   * @param   {Object}  vintage - An Object with `start`, `end` strings
   * @return  {string}  The string as a range
   */
  _vintageRange(vintage) {
    let s;
    if (vintage.start || vintage.end) {
      s = (vintage.start || '?');
      if (vintage.start !== vintage.end) {
        s += ' - ' + (vintage.end || '?');
      }
    }
    return s;
  }

}


/**
 * ImagerySourceNone
 * A special imagery source for when the user has imagery disabled.
 */
export class ImagerySourceNone extends ImagerySource {
  /**
   * @constructor
   * @param  {Context}  context  - Global shared application context
   */
  constructor(context) {
    super(context, {
      id: 'none',
      template: '',
      nameStringID: 'background.none',
      descriptionStringID: ''
    });
  }

  /**
   * area
   * Returns -1 for ImagerySourceNone.
   * Because area is used for sorting the imagery sources, this returns -1 for sorting.
   * @return  {number}  Always returns -1
   * @readonly
   */
  get area() {
    return -1;  // sources in background pane are sorted by area
  }

  /**
   * imageryUsed
   * Returns `null` for ImagerySourceNone.
   * @return  {string}  Always returns `null`
   * @readonly
   */
  get imageryUsed() {
    return null;
  }
}


/**
 * ImagerySourceCustom
 * A special imagery source for when the user has custom imagery.
 * Overrides the imageryUsed method, also allows the url template to be changed.
 */
export class ImagerySourceCustom extends ImagerySource {
  /**
   * @constructor
   * @param  {Context}  context  - Global shared application context
   * @param  {string}   template - the url teplate to use for this custom imagery
   */
  constructor(context, template = '') {
    super(context, {
      id: 'custom',
      template: template,
      nameStringID: 'background.custom',
      descriptionStringID: ''
    });
  }

  /**
   * area
   * Returns -2 for ImagerySourceCustom.
   * Because area is used for sorting the imagery sources, this returns -1 for sorting.
   * @return  {number}  Always returns -2
   * @readonly
   */
  get area() {
    return -2;  // sources in background pane are sorted by area
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * For custom sources, it will look like "Custom (…)" with the url template string.
   * (but with sensitive details removed from the url template string).
   * @return  {string}  The imagery used string
   * @readonly
   */
  get imageryUsed() {
    // Sanitize personal connection tokens - iD#6801
    let cleaned = this.template;

    // Sanitize query string parameters
    let [url, params] = cleaned.split('?', 2);
    if (params) {
      const qs = utilStringQs(params);
      for (const k of Object.keys(qs)) {
        if (/^(access_token|connectid|key|signature|token)$/i.test(k)) {
          qs[k] = '{apikey}';
        }
      }
      cleaned = url + '?' + utilQsString(qs, true);  // true = soft encode
    }

    // Sanitize wms/wmts path parameters
    cleaned = cleaned
      .replace(/token\/(\w+)/, 'token/{apikey}')
      .replace(/key=(\w+)/, 'key={apikey}');

    return `Custom (${cleaned} )`;
  }

  // only 'custom' imagery source allows the template to be changed
  set template(val) {
    this._template = val;
  }
  get template() {
    return this._template;
  }
}


/**
 * ImagerySourceBing
 * A special imagery source for the Bing imagery source.
 * There should be more overrides in here, but they aren't currently working.
 *   https://docs.microsoft.com/en-us/bingmaps/rest-services/imagery/get-imagery-metadata
 *   https://docs.microsoft.com/en-us/bingmaps/rest-services/directly-accessing-the-bing-maps-tiles
 *   See also https://github.com/openstreetmap/iD/pull/9133
 */
export class ImagerySourceBing extends ImagerySource {
  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this ImagerySource
   */
  constructor(context, props = {}) {
    super(context, props);

    // missing tile image strictness param (n=)
    // * n=f -> (Fail) returns a 404
    // * n=z -> (Empty) returns a 200 with 0 bytes (no content)
    // * n=t -> (Transparent) returns a 200 with a transparent (png) tile
    this._template = 'https://ecn.t{switch:0,1,2,3}.tiles.virtualearth.net/tiles/a{u}.jpeg?g=1&pr=odbl&n=z';
    this.props.terms_url = 'https://blog.openstreetmap.org/2010/11/30/microsoft-imagery-details';
  }
}


/**
 * ImagerySourceEsri
 * A special imagery source for the Esri imagery sources
 * Overrides the getMetadata function to get more imagery metadata.
 */
export class ImagerySourceEsri extends ImagerySource {
  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this ImagerySource
   */
  constructor(context, props = {}) {
    super(context, props);

    // In addition to using the tilemap at zoom level 20, overzoom real tiles
    //  iD#4327 (deprecated technique, but it works)
    if (!/blankTile/.test(this._template)) {
      this._template += '?blankTile=false';
    }

    this._cache = {};
    this._inflight = {};
    this._prevLoc = null;
  }


  // Use a tilemap service to set maximum zoom for Esri tiles dynamically
  // https://developers.arcgis.com/documentation/tiled-elevation-service/
  fetchTilemap(loc) {
    // skip if we have already fetched a tilemap within 5km
    if (this._prevLoc && geoSphericalDistance(loc, this._prevLoc) < 5000) return;
    this._prevLoc = loc;

    // tiles are available globally to zoom level 19, afterward they may or may not be present
    // first generate a random url using the template
    const dummyUrl = this.url([1,2,3]);

    // calculate url z/y/x from the lat/long of the center of the map
    const z = 20;
    const x = (Math.floor((loc[0] + 180) / 360 * Math.pow(2, z)));
    const y = (Math.floor((1 - Math.log(Math.tan(loc[1] * DEG2RAD) + 1 / Math.cos(loc[1] * DEG2RAD)) / Math.PI) / 2 * Math.pow(2, z)));

    // fetch an 8x8 grid to leverage cache
    let tilemapUrl = dummyUrl.replace(/tile\/[0-9]+\/[0-9]+\/[0-9]+\?blankTile=false/, 'tilemap') + '/' + z + '/' + y + '/' + x + '/8/8';

    // make the request and inspect the response from the tilemap server
    fetch(tilemapUrl)
      .then(utilFetchResponse)
      .then(tilemap => {
        if (!tilemap) {
          throw new Error('Unknown Error');
        }
        let hasTiles = true;
        for (const d of tilemap.data) {
          // 0 means an individual tile in the grid doesn't exist
          if (!d) {
            hasTiles = false;
          }
        }
        // if any tiles are missing at level 20 we restrict maxZoom to 19
        this.props.zoomExtent[1] = (hasTiles ? 22 : 19);
      })
      .catch(e => console.error(e));  // eslint-disable-line
  }


  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * @param  {Tile}      tile - The tile to get metadata for
   * @param  {function}  callback - errback-style callback function to call with results
   */
  getMetadata(tile, callback) {
    const context = this.context;
    const l10n = context.systems.l10n;

    const loc = tile.wgs84Extent.center();
    const tileID = tile.xyz.join('/');
    const zoom = Math.min(tile.xyz[2], this.props.zoomExtent[1]);
    const unknown = l10n?.t('inspector.unknown') || 'unknown';

    if (this._inflight[tileID]) return;

    let metadataLayer;
    switch (true) {
      case (zoom >= 20 && this.id === 'EsriWorldImageryClarity'):
        metadataLayer = 4;
        break;
      case zoom >= 19:
        metadataLayer = 3;
        break;
      case zoom >= 17:
        metadataLayer = 2;
        break;
      case zoom >= 13:
        metadataLayer = 0;
        break;
      default:
        metadataLayer = 99;
    }

    // build up query using the layer appropriate to the current zoom
    let url;
    if (this.id === 'EsriWorldImagery') {
      url = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/';
    } else if (this.id === 'EsriWorldImageryClarity') {
      url = 'https://serviceslab.arcgisonline.com/arcgis/rest/services/Clarity_World_Imagery/MapServer/';
    } else {
      return;
    }

    url += metadataLayer + '/query?returnGeometry=false&geometry=' + loc.join(',') + '&inSR=4326&geometryType=esriGeometryPoint&outFields=*&f=json';

    if (!this._cache[tileID]) {
      this._cache[tileID] = {};
    }
    if (this._cache[tileID] && this._cache[tileID].metadata) {
      return callback(null, this._cache[tileID].metadata);
    }

    // accurate metadata is only available >= 13
    let vintage = {};
    let metadata = {};
    if (metadataLayer === 99) {
      vintage = {
        start: null,
        end: null,
        range: null
      };
      metadata = {
        vintage: null,
        source: unknown,
        description: unknown,
        resolution: unknown,
        accuracy: unknown
      };

      callback(null, metadata);

    } else {
      this._inflight[tileID] = true;
      fetch(url)
        .then(utilFetchResponse)
        .then(result => {
          delete this._inflight[tileID];

          if (!result) {
            throw new Error('Unknown Error');
          } else if (result.features && result.features.length < 1) {
            throw new Error('No Results');
          } else if (result.error && result.error.message) {
            throw new Error(result.error.message);
          }

          // pass through the discrete capture date from metadata
          const captureDate = utilDateString(result.features[0].attributes.SRC_DATE2);
          vintage = {
            start: captureDate,
            end: captureDate,
            range: captureDate
          };
          metadata = {
            vintage: vintage,
            source: clean(result.features[0].attributes.NICE_NAME),
            description: clean(result.features[0].attributes.NICE_DESC),
            resolution: clean(+parseFloat(result.features[0].attributes.SRC_RES).toFixed(4)),
            accuracy: clean(+parseFloat(result.features[0].attributes.SRC_ACC).toFixed(4))
          };

          // append units - meters
          if (isFinite(metadata.resolution)) {
            const fallback = `${metadata.resolution} m`;
            metadata.resolution = l10n?.t('units.meters', { quantity: metadata.resolution }) || fallback;
          }
          if (isFinite(metadata.accuracy)) {
            const fallback = `${metadata.accuracy} m`;
            metadata.accuracy = l10n?.t('units.meters', { quantity: metadata.accuracy }) || fallback;
          }

          this._cache[tileID].metadata = metadata;
          if (callback) callback(null, metadata);
        })
        .catch(err => {
          delete this._inflight[tileID];

          if (callback) callback(err.message);
        });
    }

    function clean(val) {
      return String(val).trim() || unknown;
    }
  }

}


/**
 * ImagerySourceEsriWayback
 * A special imagery source that allows users to choose available dates in the Esri Wayback Archive.
 * Unlike other imagery sources, this source has a `date` setter and getter.
 * The actual date that the user wants to view is stored in `this.props.startDate` (and `this.props.endDate`)
 * Note that all "dates" in imagery sources are actually stored as ISO strings like `2024-01-01`
 */
export class ImagerySourceEsriWayback extends ImagerySourceEsri {
  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this ImagerySource
   */
  constructor(context, props = {}) {
    props.nameStringID = 'background.wayback.name';
    props.descriptionStringID = 'background.wayback.description';
    super(context, props);
  }

  /**
   * key
   * The `key` can be used to uniquely identify this imagery source.
   * It is usually just the `safeid`, but for 'wayback' it will also include the `date`.
   * @return  {string}  The key
   * @readonly
   */
  get key() {
    let s = this.safeid;
    const date = this.date;
    if (date) {
      s += `_${date}`;
    }
    return s;
  }

  // Get the url template for the selected release
  get template() {
    const wayback = this.context.services.wayback;
    const release = wayback.byReleaseDate.get(this.date);
    return release?.template || this._template;
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * It is usually just the name, but for 'wayback', append the date if there is one, e.g. `Esri Wayback (2024-01-01)`
   * @return  {string}  The imagery used string
   * @readonly
   */
  get imageryUsed() {
    let s = this._currStrings.name;
    const date = this.date;
    if (date) {
      s += ` (${date})`;
    }
    return s;
  }

  /**
   * date
   * Wayback imagery has a `date` getter/setter.
   * Pick the closest supported date from the Wayback archive, without going over.
   * The date is stored in both `startDate` and `endDate` props.
   * @return  {string}  Localized name
   */
  set date(val) {
    const wayback = this.context.services.wayback;
    const chooseDate = wayback.chooseClosestDate(val);

    this.props.startDate = chooseDate;
    this.props.endDate = chooseDate;
  }

  get date() {
    return this.props.startDate;
  }

  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * The Wayback service will get the metadata for the given tile.
   * @param  {Tile}      tile - the tile to get metadata for
   * @param  {function}  callback - errback-style callback function to call with results
   */
  getMetadata(tile, callback) {
    const context = this.context;
    const l10n = context.systems.l10n;
    const wayback = context.services.wayback;
    const unknown = l10n?.t('inspector.unknown') || 'unknown';

    const release = wayback.byReleaseDate.get(this.date);
    if (!release) {
      if (typeof callback === 'function') {
        callback(null, {});
      }
      return;
    }

    wayback.getMetadataAsync(tile, this.date)
      .then(result => {
        const metadata = {
          vintage: {
            start: result.captureDate,
            end:   result.captureDate,
            range: result.captureDate
          },
          source: clean(result.source),
          description: clean(result.provider),
          resolution: clean(+parseFloat(result.resolution).toFixed(4)),
          accuracy: clean(+parseFloat(result.accuracy).toFixed(4))
        };

        // append units - meters
        if (isFinite(metadata.resolution)) {
          const fallback = `${metadata.resolution} m`;
          metadata.resolution = l10n?.t('units.meters', { quantity: metadata.resolution }) || fallback;
        }
        if (isFinite(metadata.accuracy)) {
          const fallback = `${metadata.accuracy} m`;
          metadata.accuracy = l10n?.t('units.meters', { quantity: metadata.accuracy }) || fallback;
        }

        if (typeof callback === 'function') {
          callback(null, metadata);
        }

        function clean(val) {
          return String(val).trim() || unknown;
        }
      })
      .catch(err => {
        console.error(err);  // eslint-disable-line no-console
        if (typeof callback === 'function') {
          callback(err, {});
        }
      });
  }

}

