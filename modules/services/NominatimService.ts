import { Extent } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';
import RBush from 'rbush';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Vec2 } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';


/** RBush item with associated Nominatim result data */
interface NominatimCacheItem {
  /** Minimum longitude of the bounding box */
  minX: number;
  /** Minimum latitude of the bounding box */
  minY: number;
  /** Maximum longitude of the bounding box */
  maxX: number;
  /** Maximum latitude of the bounding box */
  maxY: number;
  /** Associated Nominatim result data */
  data: any;
}

/** Errback-style callback for Nominatim results */
type NominatimCallback = (err: Error | string | null, result?: any) => void;


/**
 * `NominatimService`
 * This service connects to the Nominatim API to perform geocoding queries.
 * @see https://nominatim.org/release-docs/latest/api/Overview/
 */
export class NominatimService extends AbstractSystem {

  /** Base URL for the Nominatim API */
  apibase: string;
  /** Map of inflight request URLs to their AbortControllers */
  _inflight: Record<string, AbortController>;
  /** Spatial index cache of previously fetched Nominatim results */
  _nominatimCache: RBush<NominatimCacheItem>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'nominatim';
    this.optionalDependencies = new Set(['l10n']);

    this.apibase = 'https://nominatim.openstreetmap.org/';
    this._inflight = {};
    this._nominatimCache = new RBush<NominatimCacheItem>();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.countryCode = this.countryCode.bind(this);
    this.reverse = this.reverse.bind(this);
    this.search = this.search.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
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
    Object.values(this._inflight).forEach(controller => controller.abort());
    this._inflight = {};
    this._nominatimCache = new RBush<NominatimCacheItem>();
    return Promise.resolve();
  }


  /**
   * countryCode
   * Get the country code for the given location.
   * @param loc - location to lookup [lon,lat]
   * @param callback - errback-style callback function to call with results
   */
  countryCode(loc: Vec2, callback: NominatimCallback): void {
    this.reverse(loc, (err, result) => {
      if (err) {
        return callback(err);
      } else if (result.address) {
        return callback(null, result.address.country_code);
      } else {
        return callback('Unable to geocode', null);
      }
    });
  }


  /**
   * reverse
   * Reverse Geocode:  Get the address for the given location.
   * @param loc - location to lookup [lon,lat]
   * @param callback - errback-style callback function to call with results
   */
  reverse(loc: Vec2, callback: NominatimCallback): void {
    const cached = this._nominatimCache.search(
      { minX: loc[0], minY: loc[1], maxX: loc[0], maxY: loc[1] }
    );

    if (cached.length > 0) {
      if (callback) callback(null, cached[0].data);
      return;
    }

    const params = { zoom: 13, format: 'json', addressdetails: 1, lat: loc[1], lon: loc[0] };
    const url = this.apibase + 'reverse?' + utilQsString(params, false);
    if (this._inflight[url]) return;

    const controller = new AbortController();
    this._inflight[url] = controller;

    const context = this.context;
    const l10n = context.systems.l10n;
    const localeCodes = l10n?.localeCodes || ['en-US', 'en'];

    const opts = {
      signal: controller.signal,
      headers: { 'Accept-Language': localeCodes.join(',') }
    };

    fetch(url, opts)
      .then(utilFetchResponse)
      .then(result => {
        delete this._inflight[url];
        if (result?.error) {
          throw new Error(result.error);
        }
        const extent = new Extent(loc).padByMeters(200);
        this._nominatimCache.insert(Object.assign(extent.bbox(), { data: result }));
        if (callback) callback(null, result);
      })
      .catch(err => {
        delete this._inflight[url];
        if (err.name === 'AbortError') return;
        if (callback) callback(err.message);
      });
  }


  /**
   * search
   * Search nominatum for things with the given name
   * @param val - value to search for
   * @param callback - errback-style callback function to call with results
   */
  search(val: string, callback: NominatimCallback): void {
    const searchVal = encodeURIComponent(val);
    const url = this.apibase + `search?q=${searchVal}&limit=10&format=json`;
    if (this._inflight[url]) return;

    const controller = new AbortController();
    this._inflight[url] = controller;

    const context = this.context;
    const l10n = context.systems.l10n;
    const localeCodes = l10n?.localeCodes || ['en-US', 'en'];

    const opts = {
      signal: controller.signal,
      headers: { 'Accept-Language': localeCodes.join(',') }
    };

    fetch(url, opts)
      .then(utilFetchResponse)
      .then(result => {
        delete this._inflight[url];
        if (result?.error) {
          throw new Error(result.error);
        }
        if (callback) callback(null, result);
      })
      .catch(err => {
        delete this._inflight[url];
        if (err.name === 'AbortError') return;
        if (callback) callback(err.message);
      });
  }

}
