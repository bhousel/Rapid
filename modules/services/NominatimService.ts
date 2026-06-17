import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Extent } from '@rapid-sdk/math';
import RBush from 'rbush';
import { utilQsString } from '@rapid-sdk/util';

import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** RBush item with associated Nominatim result data */
interface NominatimCacheItem extends BBox {
  /** Associated Nominatim result data */
  data: any;
}

/** Errback-style callback for Nominatim results */
type NominatimCallback = (err: Error | string | null, result?: any) => void;


/**
 * `NominatimService` connects to the Nominatim API to perform geocoding queries.
 * @see https://nominatim.org/release-docs/latest/api/Overview/
 */
export class NominatimService extends AbstractSystem {

  /** Base URL for the Nominatim API */
  public apibase: string;
  /** Spatial index cache of previously fetched Nominatim results */
  protected _nominatimCache: RBush<NominatimCacheItem>;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'nominatim';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['l10n']);

    this.apibase = 'https://nominatim.openstreetmap.org/';
    this._nominatimCache = new RBush<NominatimCacheItem>();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.countryCode = this.countryCode.bind(this);
    this.reverse = this.reverse.bind(this);
    this.search = this.search.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const network = this.context.systems.network!;
    network.clearMatching(id => id.includes(this.apibase));

    this._nominatimCache = new RBush<NominatimCacheItem>();
    return Promise.resolve();
  }


  /**
   * Get the country code for the given location.
   * @param loc - location to lookup [lon,lat]
   * @param callback - errback-style callback function to call with results
   */
  public countryCode(loc: Vec2, callback: NominatimCallback): void {
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
   * Reverse Geocode:  Get the address for the given location.
   * @param loc - location to lookup [lon,lat]
   * @param callback - errback-style callback function to call with results
   */
  public reverse(loc: Vec2, callback: NominatimCallback): void {
    const cached = this._nominatimCache.search(
      { minX: loc[0], minY: loc[1], maxX: loc[0], maxY: loc[1] }
    );

    if (cached.length > 0) {
      if (callback) callback(null, cached[0].data);
      return;
    }

    const params = { zoom: 13, format: 'json', addressdetails: 1, lat: loc[1], lon: loc[0] };
    const url = this.apibase + 'reverse?' + utilQsString(params, false);

    const context = this.context;
    const l10n = context.systems.l10n;
    const network = context.systems.network!;
    const localeCodes = l10n?.localeCodes || ['en-US', 'en'];

    network.fetch<any>(url, { headers: { 'Accept-Language': localeCodes.join(',') } })
      .then(result => {
        if (result?.error) {
          throw new Error(result.error);
        }
        const extent = new Extent(loc).padByMeters(200);
        this._nominatimCache.insert(Object.assign(extent.bbox(), { data: result }));
        if (callback) callback(null, result);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (callback) callback(err.message);
      });
  }


  /**
   * Search nominatum for things with the given name
   * @param val - value to search for
   * @param callback - errback-style callback function to call with results
   */
  public search(val: string, callback: NominatimCallback): void {
    const searchVal = encodeURIComponent(val);
    const url = this.apibase + `search?q=${searchVal}&limit=10&format=json`;

    const context = this.context;
    const l10n = context.systems.l10n;
    const network = context.systems.network!;
    const localeCodes = l10n?.localeCodes || ['en-US', 'en'];

    network.fetch<any>(url, { headers: { 'Accept-Language': localeCodes.join(',') } })
      .then(result => {
        if (result?.error) {
          throw new Error(result.error);
        }
        if (callback) callback(null, result);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (callback) callback(err.message);
      });
  }

}
