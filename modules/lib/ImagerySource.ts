import { geoArea as d3_geoArea, geoMercatorRaw as d3_geoMercatorRaw } from 'd3-geo';
import { DEG2RAD, RAD2DEG, TAU, geoSphericalDistance } from '@rapid-sdk/math';
import { utilAesDecrypt, utilQsString, utilStringQs, utilSafeString } from '@rapid-sdk/util';

import { utilDateString } from '../util/date.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';
import type { Vec2 } from '../lib/types.ts';

// Cast utilAesDecrypt to allow optional key parameter (matches runtime behavior)
const aesDecrypt = utilAesDecrypt as (cipherText: string | undefined, key?: number[]) => string;


/**
 * ImagerySourceStrings
 * Pre-localized strings for an ImagerySource.
 */
interface ImagerySourceStrings {
  id: ImagerySourceID;
  name: string;
  description: string;
}

/**
 * Vintage date range information for imagery metadata.
 */
export interface VintageRange {
  /** Start date as ISO string (YYYY-MM-DD) */
  start: string;
  /** End date as ISO string (YYYY-MM-DD) */
  end: string;
  /** Formatted date range string for display */
  range?: string;
}

/**
 * Properties that define an ImagerySource.
 */
export interface ImagerySourceProps {
  /** Unique identifier for this imagery source (required) */
  id: ImagerySourceID;
  /** The bundle that this ImagerySource came from (e.g. 'editor-layer-index') */
  bundleID: BundleID;
  /** URL template for fetching tiles */
  template?: string;
  /** Whether the imagery source is considered "best" in the area it is available */
  best: boolean;
  /** Whether the imagery source is an "overlay" (transparent tiles) */
  overlay: boolean;
  /** Whether the template is encrypted */
  encrypted: boolean;
  /** Imagery type: 'tms', 'wms', or 'bing' */
  type: 'tms' | 'wms' | 'bing';
  /** Display name of the imagery source */
  name?: string;
  /** Description text for the imagery source */
  description?: string;
  /** String ID for localized name */
  nameStringID?: string;
  /** String ID for localized description */
  descriptionStringID?: string;
  /** Tile opacity (0-1) */
  alpha?: number;
  /** Size of tiles in pixels */
  tileSize?: number;
  /** [minZoom, maxZoom] for this imagery */
  zoomExtent?: [number, number];
  /** Zoom range for the imagery source */
  zoomRange?: number;
  /** Feature defining the coverage area */
  feature?: GeoJSON.Feature;
  /** Icon url for the source */
  icon?: string;
  /** Terms of service text */
  terms_text?: string;
  /** Terms of service URL */
  terms_url?: string;
  /** Start date for imagery (ISO string) */
  startDate?: string;
  /** End date for imagery (ISO string) */
  endDate?: string;
  /** Projection used (e.g., 'EPSG:3857', 'EPSG:4326') */
  projection?: string;
  /** Whether the imagery is blocked */
  isBlocked?: boolean;
}


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
  context: Context;
  props: ImagerySourceProps;
  id: ImagerySourceID;
  safeid: string;
  imageryID: ImagerySourceID;
  type: 'tms' | 'wms' | 'bing' | undefined;
  offset: Vec2;

  protected _template: string;
  protected _strings: Map<string, ImagerySourceStrings>;
  protected _currLocaleCode: LocaleCode | null;
  protected _currStrings: Partial<ImagerySourceStrings>;

  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Object containing the properties for this ImagerySource
   */
  constructor(context: Context, props: Partial<ImagerySourceProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('ImagerySource missing id property');
    }

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props) as ImagerySourceProps;
    this.props.alpha ||= 1;
    this.props.best ||= false;
    this.props.overlay ||= false;
    this.props.tileSize ||= 256;
    this.props.zoomExtent ??= [0, 22];
    this.props.zoomRange ||= 5;
    this.props.isBlocked = false;

    this.offset = [0, 0];

    this.id = props.id;                         // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);     // For use in classes, element ids, css selectors
    this._template = props.encrypted ? aesDecrypt(props.template) : (props.template ?? '');

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
  reset(): void {
    const l10n = this.context.systems.l10n;

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode || 'en-US');
  }


  /**
   * setLocale
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * @param localeCode - the locale code to switch to (defaults to 'en-US')
   */
  setLocale(localeCode: LocaleCode = 'en-US'): void {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    // Pre-localize and store strings
    const fallbackName = this.props.name || this.id;
    const fallbackDesc = this.props.description || '';
    const nameStr = (this.props.nameStringID && l10n?.t(this.props.nameStringID, { default: '' })) || fallbackName;
    const descStr = (this.props.descriptionStringID && l10n?.t(this.props.descriptionStringID, { default: '' })) || fallbackDesc;

    this._currStrings = {
      id: this.id,
      name: nameStr.trim(),
      description: descStr.trim(),
    };

    this._strings.set(this._currLocaleCode, this._currStrings as ImagerySourceStrings);
  }


  /**
   * name
   * The name is the main display name of the ImagerySource, as shown in the user interface.
   * @return Localized name
   * @readonly
   */
  get name(): string {
    return this._currStrings.name ?? '';
  }

  /**
   * description
   * Provides additional descriptive text about the ImagerySource.
   * @return Localized description
   * @readonly
   */
  get description(): string {
    return this._currStrings.description ?? '';
  }

  /**
   * key
   * The `key` can be used to uniquely identify this imagery source.
   * It is usually just the `safeid`, but for 'wayback' it will also include the `date`.
   * @return The key
   * @readonly
   */
  get key(): string {
    return this.safeid;
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * @return The imagery used string
   * @readonly
   */
  get imageryUsed(): string | null {
    return this._currStrings.name ?? null;
  }

  /**
   * template
   * Returns the imagery URL template
   * @return The imagery URL template
   * @readonly
   */
  get template(): string {
    return this._template;
  }

  /**
   * area
   * Returns the area of this imagery extent.
   * This area is in steradians (square radians) which is unusual, but useful for comparing areas.
   * @see https://d3js.org/d3-geo/math#geoArea
   * @return Area in steradians
   * @readonly
   */
  get area(): number {
    if (!this.props.feature) return Number.MAX_VALUE;  // worldwide
    const area = d3_geoArea(this.props.feature as any);
    return isNaN(area) ? 0 : area;
  }

  /**
   * isValidZoom
   * Is the imagery valid at the given zoom?
   * @return `true` if the imagery is valid at the given zoom, `false` if not
   */
  isValidZoom(z: number): boolean {
    if (Number.isNaN(z)) return false;
    const [min, max] = this.props.zoomExtent!;
    return (z >= min) && (z <= max);
  }

  /**
   * isLocatorOverlay
   * Is this source the "mapbox locator overlay"?
   * @return `true` if the imagery is the locator overlay, `false` if not
   */
  isLocatorOverlay(): boolean {
    return this.id === 'mapbox_locator_overlay';
  }

  /**
   * isBuiltin
   * Is this one of the builtin objects?
   * We consider it "builtin" if it doesn't have a `bundleID` (i.e. added via a merge).
   * These include the 'none', 'custom' and possibly 'EsriWayback' sources.
   * @return `true` if the imagery is a builtin ImagerySource, `false` if not
   */
  isBuiltin(): boolean {
    return !this.props.bundleID;
  }


  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * @param tile - The tile to get metadata for
   * @param callback - errback-style callback function to call with results
   */
  getMetadata(tile: any, callback?: (err: string | null, metadata: any) => void): void {
    const vintage: VintageRange = {
      start: utilDateString(this.props.startDate as any),
      end: utilDateString(this.props.endDate as any)
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
   * @param delta - pixels to nudge, as [dx, dy]
   * @param zoom - the current zoom
   */
  nudge(delta: Vec2, zoom: number): void {
    this.offset[0] += delta[0] / Math.pow(2, zoom);
    this.offset[1] += delta[1] / Math.pow(2, zoom);
  }


  /**
   * url
   * Return the url to fetch the imagery for the given tile coordinate
   * @param coord - Tile coordinate as [x,y,z]
   * @return The url to fetch imagery (empty string if no imagery, for example 'none' source)
   */
  url(coord: [number, number, number]): string {
    const urlTemplate = this.template;
    let result = urlTemplate;
    if (result === '') return result;   // source 'none'

    function _tileToProjectedCoords(proj: string, x: number, y: number, z: number): { x: number; y: number } {
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
      const tileSize = this.props.tileSize!;
      const projection = this.props.projection ?? 'EPSG:3857';
      const minXmaxY = _tileToProjectedCoords(projection, coord[0], coord[1], coord[2]);
      const maxXminY = _tileToProjectedCoords(projection, coord[0] + 1, coord[1] + 1, coord[2]);

      result = result.replace(/\{(\w+)\}/g, (match, capture): string => {
        switch (capture) {
          case 'width':
          case 'height':
            return String(tileSize);
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
            return String(minXmaxY.x);
          case 's':
            return String(maxXminY.y);
          case 'n':
            return String(maxXminY.x);
          case 'e':
            return String(minXmaxY.y);
          default:
            return match;
        }
      });

    } else if (this.type === 'tms') {
      let isRetina = false;
      if ('window' in globalThis) {
        const _window = globalThis.window;
        isRetina = !!(_window.devicePixelRatio && _window.devicePixelRatio >= 2);
      }

      result = result
        .replace('{x}', String(coord[0]))
        .replace('{y}', String(coord[1]))
        // TMS-flipped y coordinate
        .replace(/\{[t-]y\}/, String(Math.pow(2, coord[2]) - coord[1] - 1))
        .replace(/\{z(oom)?\}/, String(coord[2]))
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
   * @param vintage - A VintageRange object with `start`, `end` strings
   * @return The string as a range
   */
  _vintageRange(vintage: VintageRange): string | undefined {
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
   * @param context - Global shared application context
   */
  constructor(context: Context) {
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
   * @return Always returns -1
   * @readonly
   */
  get area(): number {
    return -1;  // sources in background pane are sorted by area
  }

  /**
   * imageryUsed
   * Returns `null` for ImagerySourceNone.
   * @return Always returns `null`
   * @readonly
   */
  get imageryUsed(): null {
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
   * @param context - Global shared application context
   * @param template - the url teplate to use for this custom imagery
   */
  constructor(context: Context, template: string = '') {
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
   * @return Always returns -2
   * @readonly
   */
  get area(): number {
    return -2;  // sources in background pane are sorted by area
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * For custom sources, it will look like "Custom (…)" with the url template string.
   * (but with sensitive details removed from the url template string).
   * @return The imagery used string
   * @readonly
   */
  get imageryUsed(): string {
    // Sanitize personal connection tokens - iD#6801
    let cleaned = this.template;

    // Sanitize query string parameters
    const [url, params] = cleaned.split('?', 2);
    if (params) {
      const qs = utilStringQs(params) as Record<string, string>;
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
  set template(val: string) {
    this._template = val;
  }
  get template(): string {
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
   * @param context - Global shared application context
   * @param props - Object containing the properties for this ImagerySource
   */
  constructor(context: Context, props: Partial<ImagerySourceProps> = {}) {
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
  protected _cache: Record<string, any>;
  protected _inflight: Record<string, boolean>;
  protected _prevLoc: Vec2 | null;

  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Object containing the properties for this ImagerySource
   */
  constructor(context: Context, props: Partial<ImagerySourceProps> = {}) {
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
  fetchTilemap(loc: Vec2): void {
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
    const tilemapUrl = dummyUrl.replace(/tile\/[0-9]+\/[0-9]+\/[0-9]+\?blankTile=false/, 'tilemap') + '/' + z + '/' + y + '/' + x + '/8/8';

    // make the request and inspect the response from the tilemap server
    fetch(tilemapUrl)
      .then(utilFetchResponse as (response: Response) => any)
      .then(tilemap => {
        if (!tilemap) {
          throw new Error('Unknown Error');
        }
        let hasTiles = true;
        for (const d of (tilemap as any).data) {
          // 0 means an individual tile in the grid doesn't exist
          if (!d) {
            hasTiles = false;
          }
        }
        // if any tiles are missing at level 20 we restrict maxZoom to 19
        this.props.zoomExtent![1] = (hasTiles ? 22 : 19);
      })
      .catch(e => console.error(e));  // eslint-disable-line
  }


  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * @param tile - The tile to get metadata for
   * @param callback - errback-style callback function to call with results
   */
  override getMetadata(tile: any, callback?: (err: string | null, metadata?: any) => void): void {
    const context = this.context;
    const l10n = context.systems.l10n;

    const loc = tile.wgs84Extent.center();
    const tileID = tile.xyz.join('/');
    const zoom = Math.min(tile.xyz[2], this.props.zoomExtent![1]);
    const unknown = l10n?.t('inspector.unknown') || 'unknown';

    if (this._inflight[tileID]) return;

    let metadataLayer: number;
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
    let url: string;
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
      if (callback) callback(null, this._cache[tileID].metadata);
      return;
    }

    // accurate metadata is only available >= 13
    let vintage: any = {};
    let metadata: any = {};
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

      if (callback) callback(null, metadata);

    } else {
      this._inflight[tileID] = true;
      fetch(url)
        .then(utilFetchResponse as (response: Response) => any)
        .then((result: any) => {
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

    function clean(val: any): string {
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
   * @param context - Global shared application context
   * @param props - Object containing the properties for this ImagerySource
   */
  constructor(context: Context) {
    const props = {
      id: 'EsriWayback',
      name: 'Esri Wayback',
      description: 'Esri Wayback contains archived snapshots of Esri World Imagery created over time.',
      nameStringID: 'background.wayback.name',
      descriptionStringID: 'background.wayback.description',
      type: 'tms',
      template: '',
      zoomExtent: [0, 22],
      terms_url: 'https://wiki.openstreetmap.org/wiki/Esri',
      terms_text: 'Terms & Feedback',
      icon: 'https://osmlab.github.io/editor-layer-index/sources/world/EsriImageryClarity.png'
    } as ImagerySourceProps;

    super(context, props);
  }

  /**
   * key
   * The `key` can be used to uniquely identify this imagery source.
   * It is usually just the `safeid`, but for 'wayback' it will also include the `date`.
   * @return The key
   * @readonly
   */
  override get key(): string {
    let s = this.safeid;
    const date = this.date;
    if (date) {
      s += `_${date}`;
    }
    return s;
  }

  // Get the url template for the selected release
  override get template(): string {
    const wayback = (this.context.services as any).wayback;
    const release = wayback.byReleaseDate.get(this.date);
    return release?.template || this._template;
  }

  /**
   * imageryUsed
   * Returns a string that can be used as the "imagery_used" changeset metadata.
   * It is usually just the name, but for 'wayback', append the date if there is one, e.g. `Esri Wayback (2024-01-01)`
   * @return The imagery used string
   * @readonly
   */
  override get imageryUsed(): string {
    let s = this._currStrings.name ?? '';
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
   * @return The date string
   */
  set date(val: string | undefined) {
    const wayback = (this.context.services as any).wayback;
    const chooseDate = wayback.chooseClosestDate(val);

    this.props.startDate = chooseDate;
    this.props.endDate = chooseDate;
  }

  get date(): string | undefined {
    return this.props.startDate;
  }

  /**
   * getMetadata
   * Calls the callback with an object containing metadata for this imagery source.
   * The Wayback service will get the metadata for the given tile.
   * @param tile - the tile to get metadata for
   * @param callback - errback-style callback function to call with results
   */
  override getMetadata(tile: any, callback?: (err: any, metadata?: any) => void): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const wayback = (context.services as any).wayback;
    const unknown = l10n?.t('inspector.unknown') || 'unknown';

    const release = wayback.byReleaseDate.get(this.date);
    if (!release) {
      if (typeof callback === 'function') {
        callback(null, {});
      }
      return;
    }

    wayback.getMetadataAsync(tile, this.date)
      .then((result: any) => {
        const metadata: any = {
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

        function clean(val: any): string {
          return String(val).trim() || unknown;
        }
      })
      .catch((err: any) => {
        console.error(err);  // eslint-disable-line no-console
        if (typeof callback === 'function') {
          callback(err, {});
        }
      });
  }

}