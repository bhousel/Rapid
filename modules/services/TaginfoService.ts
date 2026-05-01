import { utilObjectOmit, utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Base URL for the OpenStreetMap Taginfo API v4 */
const TAGINFO_API = 'https://taginfo.openstreetmap.org/api/4/';

/** Maps geometry types to their sortname parameter for key/value queries */
const tag_sorts = {
  point: 'count_nodes',
  vertex: 'count_nodes',
  area: 'count_ways',
  line: 'count_ways'
};
/** Maps geometry types to their sortname parameter for relation member queries */
const tag_sort_members = {
  point: 'count_node_members',
  vertex: 'count_node_members',
  area: 'count_way_members',
  line: 'count_way_members',
  relation: 'count_relation_members'
};
/** Maps geometry types to their filter parameter for taginfo queries */
const tag_filters = {
  point: 'nodes',
  vertex: 'nodes',
  area: 'ways',
  line: 'ways'
};
/** Maps geometry types to their member-fraction property name for role filtering */
const tag_members_fractions: Record<GeometryType, string> = {
  point: 'count_node_members_fraction',
  vertex: 'count_node_members_fraction',
  area: 'count_way_members_fraction',
  line: 'count_way_members_fraction',
  relation: 'count_relation_members_fraction'
};


/** Parameters for taginfo API requests */
interface TaginfoParams {
  /** Results per page (number of results to return) */
  rp?: number;
  /** Column name to sort results by */
  sortname?: string;
  /** Sort order: 'asc' or 'desc' */
  sortorder?: string;
  /** Page number for paginated results */
  page?: number;
  /** Language code for localized results */
  lang?: string;
  /** Search query string to filter results */
  query?: string;
  /** OSM tag key to look up */
  key?: string;
  /** OSM tag value to look up */
  value?: string;
  /** Relation type to look up */
  rtype?: string;
  /** Element type filter (e.g. 'nodes', 'ways') */
  filter?: string;
  /** Geometry type (e.g. 'point', 'line', 'area', 'vertex') */
  geometry?: GeometryType;
  /** Whether to debounce the request */
  debounce?: boolean;
  /** Additional arbitrary parameters */
  [key: string]: any;
}

/** Result from taginfo value/key lookups */
interface TaginfoResult {
  /** The tag key, value, or role string */
  value: string;
  /** Display title (may be description or same as value) */
  title: string;
  /** Usage count from taginfo, if available */
  count?: number;
}

/** Errback-style callback for taginfo results */
type TaginfoCallback = (err: string | null, data?: any[]) => void;


/**
 * `TaginfoService`
 * This service runs queries against the OpenStreetMap Taginfo API.
 * @see https://taginfo.openstreetmap.org/taginfo/apidoc
 */
export class TaginfoService extends AbstractSystem {

  /** Cache of API responses keyed by request URL */
  _cache: Record<string, any[]>;
  /** Set of popular tag keys to exclude from value lookups (see iD#3955) */
  _popularKeys: Record<string, boolean>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'taginfo';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['l10n', 'scheduler']);

    this._cache = {};
    this._popularKeys = {
      // manually exclude some keys – iD#5377, iD#7485
      postal_code: true,
      full_name: true,
      loc_name: true,
      reg_name: true,
      short_name: true,
      sorting_name: true,
      artist_name: true,
      nat_name: true,
      long_name: true,
      'bridge:name': true
    };

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.keys = this.keys.bind(this);
    this.multikeys = this.multikeys.bind(this);
    this.values = this.values.bind(this);
    this.roles = this.roles.bind(this);
    this.docs = this.docs.bind(this);
    this._request = this._request.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const l10n = this.context.systems.l10n;
    const langCode = l10n?.languageCode || 'en';

    // Fetch popular keys.  We'll exclude these from `values`
    // lookups because they stress taginfo, and they aren't likely
    // to yield meaningful autocomplete results.. see iD#3955
    const params = {
      rp: 100,
      sortname: 'values_all',
      sortorder: 'desc',
      page: 1,
      debounce: false,
      lang: langCode
    };

    return this._startPromise = new Promise((resolve, reject) => {
      this.keys(params, (err, results) => {
        if (err) {
          this._startPromise = null;
          reject();

        } else {
          for (const d of results!) {
            if (d.value === 'opening_hours') continue;  // exception
            this._popularKeys[d.value] = true;
          }

          this._started = true;
          resolve();
        }
      });

    });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    const context = this.context;
    const network = context.systems.network!;
    const scheduler = context.systems.scheduler;

    scheduler?.cancel('taginfo-request');  // cancel any request in progress
    network.abortMatching(id => /taginfo\.openstreetmap\.org/.test(id));

    return Promise.resolve();
  }


  /**
   * @param params
   * @param callback - errback-style callback function to call with results
   */
  keys(params: TaginfoParams, callback: TaginfoCallback): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;

    const langCode = l10n?.languageCode || 'en';
    const shouldDebounce = params.debounce;

    params = this._clean(this._setSort(params));
    params = Object.assign({
      rp: 10,
      sortname: 'count_all',
      sortorder: 'desc',
      page: 1,
      lang: langCode
    }, params);

    const url = TAGINFO_API + 'keys/all?' + utilQsString(params, false);
    const request = () => this._request(url, params, false, callback, (err, result) => {
      if (err) {
        callback(err);
      } else {
        const f = this._filterKeys(params.filter);
        const vals = result.data.filter(f).sort(this._sortKeys).map(this._valKey);
        this._cache[url] = vals;
        callback(null, vals);
      }
    });

    if (shouldDebounce && scheduler) {
      scheduler.debounce('taginfo-request', request, { ms: 300 });
    } else {
      request();
    }
  }


  /**
   * @param params
   * @param callback - errback-style callback function to call with results
   */
  multikeys(params: TaginfoParams, callback: TaginfoCallback): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;

    const langCode = l10n?.languageCode || 'en';
    const shouldDebounce = params.debounce;

    params = this._clean(this._setSort(params));
    params = Object.assign({
      rp: 25,
      sortname: 'count_all',
      sortorder: 'desc',
      page: 1,
      lang: langCode
    }, params);

    const prefix = params.query ?? '';
    const url = TAGINFO_API + 'keys/all?' + utilQsString(params, false);
    const request = () => this._request(url, params, true, callback, (err, result) => {
      if (err) {
        callback(err);
      } else {
        const f = this._filterMultikeys(prefix);
        const vals = result.data.filter(f).map(this._valKey);
        this._cache[url] = vals;
        callback(null, vals);
      }
    });

    if (shouldDebounce && scheduler) {
      scheduler.debounce('taginfo-request', request, { ms: 300 });
    } else {
      request();
    }
  }


  /**
   * @param params
   * @param callback - errback-style callback function to call with results
   */
  values(params: TaginfoParams, callback: TaginfoCallback): void {
    // Exclude popular keys from values lookups.. see iD#3955
    const key = params.key;
    if (key && this._popularKeys[key]) {
      callback(null, []);
      return;
    }
    const context = this.context;
    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;

    const langCode = l10n?.languageCode || 'en';
    const shouldDebounce = params.debounce;

    params = this._clean(this._setSort(this._setFilter(params)));
    params = Object.assign({
      rp: 25,
      sortname: 'count_all',
      sortorder: 'desc',
      page: 1,
      lang: langCode
    }, params);

    const url = TAGINFO_API + 'key/values?' + utilQsString(params, false);
    const request = () => this._request(url, params, false, callback, (err, result) => {
      if (err) {
        callback(err);
      } else {
        // In most cases we prefer taginfo value results with lowercase letters.
        // A few OSM keys expect values to contain uppercase values (see iD#3377).
        // This is not an exhaustive list (e.g. `name` also has uppercase values)
        // but these are the fields where taginfo value lookup is most useful.
        const re = /network|taxon|genus|species|brand|grape_constiety|royal_cypher|listed_status|booth|rating|stars|:output|_hours|_times|_ref|manufacturer|country|target|brewery/;
        const allowUpperCase = re.test(params.key ?? '');
        const f = this._filterValues(allowUpperCase);

        const vals = result.data.filter(f).map(this._valKeyDescription);
        this._cache[url] = vals;
        callback(null, vals);
      }
    });

    if (shouldDebounce && scheduler) {
      scheduler.debounce('taginfo-request', request, { ms: 300 });
    } else {
      request();
    }
  }


  /**
   * @param params
   * @param callback - errback-style callback function to call with results
   */
  roles(params: TaginfoParams, callback: TaginfoCallback): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;

    const langCode = l10n?.languageCode || 'en';
    const shouldDebounce = params.debounce;

    const geometry = params.geometry ?? '';
    params = this._clean(this._setSortMembers(params));
    params = Object.assign({
      rp: 25,
      sortname: 'count_all_members',
      sortorder: 'desc',
      page: 1,
      lang: langCode
    }, params);

    const url = TAGINFO_API + 'relation/roles?' + utilQsString(params, false);
    const request = () => this._request(url, params, true, callback, (err, result) => {
      if (err) {
        callback(err);
      } else {
        const f = this._filterRoles(geometry);
        const vals = result.data.filter(f).map(this._roleKey);
        this._cache[url] = vals;
        callback(null, vals);
      }
    });

    if (shouldDebounce && scheduler) {
      scheduler.debounce('taginfo-request', request, { ms: 300 });
    } else {
      request();
    }
  }


  /**
   * @param params
   * @param callback - errback-style callback function to call with results
   */
  docs(params: TaginfoParams, callback: TaginfoCallback): void {
    const context = this.context;
    const scheduler = context.systems.scheduler;

    const shouldDebounce = params.debounce;
    params = this._clean(this._setSort(params));

    let path = 'key/wiki_pages?';
    if (params.value) {
      path = 'tag/wiki_pages?';
    } else if (params.rtype) {
      path = 'relation/wiki_pages?';
    }

    const url = TAGINFO_API + path + utilQsString(params, false);
    const request = () => this._request(url, params, true, callback, (err, result) => {
      if (err) {
        callback(err);
      } else {
        this._cache[url] = result.data;
        callback(null, result.data);
      }
    });

    if (shouldDebounce && scheduler) {
      scheduler.debounce('taginfo-request', request, { ms: 300 });
    } else {
      request();
    }
  }


  /**
   * Sets a parameter value based on the geometry type by looking it up in a mapping object.
   * @param params - The request parameters to modify
   * @param n - The parameter name to set
   * @param o - Mapping from geometry type to parameter value
   * @return The modified params
   */
  _sets(params: TaginfoParams, n: string, o: Record<string, string>): TaginfoParams {
    if (params.geometry && o[params.geometry]) {
      params[n] = o[params.geometry];
    }
    return params;
  }

  /** Sets the `filter` parameter based on geometry type */
  _setFilter(params: TaginfoParams): TaginfoParams {
    return this._sets(params, 'filter', tag_filters);
  }

  /** Sets the `sortname` parameter based on geometry type for key/value queries */
  _setSort(params: TaginfoParams): TaginfoParams {
    return this._sets(params, 'sortname', tag_sorts);
  }

  /** Sets the `sortname` parameter based on geometry type for relation member queries */
  _setSortMembers(params: TaginfoParams): TaginfoParams {
    return this._sets(params, 'sortname', tag_sort_members);
  }

  /** Removes internal-only parameters (`geometry`, `debounce`) before sending to the API */
  _clean(params: TaginfoParams): TaginfoParams {
    return utilObjectOmit(params, ['geometry', 'debounce']);
  }


  /** Returns a filter function that keeps keys with high usage count or wiki presence */
  _filterKeys(type?: string): (d: any) => boolean {
    const count_type = type ? 'count_' + type : 'count_all';
    return (d: any) => parseFloat(d[count_type]) > 2500 || d.in_wiki;
  }

  /** Returns a filter function that keeps keys matching the prefix without additional colons */
  _filterMultikeys(prefix: string): (d: any) => boolean {
    return (d: any) => {
      // d.key begins with prefix, and d.key contains no additional ':'s
      const re = new RegExp('^' + prefix + '(.*)$');
      const matches = d.key.match(re) || [];
      return (matches.length === 2 && matches[1].indexOf(':') === -1);
    };
  }

  /** Returns a filter function that excludes values with punctuation, optionally uppercase, or zero fraction */
  _filterValues(allowUpperCase: boolean): (d: any) => boolean {
    return (d: any) => {
      if (d.value.match(/[;,]/) !== null) return false;  // exclude some punctuation
      if (!allowUpperCase && d.value.match(/[A-Z*]/) !== null) return false;  // exclude uppercase letters
      return parseFloat(d.fraction) > 0.0;
    };
  }

  /** Returns a filter function that excludes empty roles, uppercase, and low-fraction roles */
  _filterRoles(geometry: GeometryType | ''): (d: any) => boolean {
    return (d: any) => {
      if (d.role === '') return false; // exclude empty role
      if (d.role.match(/[A-Z*;,]/) !== null) return false;  // exclude uppercase letters and some punctuation
      if (geometry === '') return true;  // no filter, just include it
      return parseFloat(d[tag_members_fractions[geometry]]) > 0.0;
    };
  }

  /** Maps a taginfo key datum to a TaginfoResult using the key as both value and title */
  _valKey(d: any): TaginfoResult {
    return {
      value: d.key,
      title: d.key
    };
  }


  /** Maps a taginfo value datum to a TaginfoResult, using the description as title if available */
  _valKeyDescription(d: any): TaginfoResult {
    const obj: TaginfoResult = {
      value: d.value,
      title: d.description || d.value
    };
    if (d.count) {
      obj.count = d.count;
    }
    return obj;
  }


  /** Maps a taginfo role datum to a TaginfoResult using the role as both value and title */
  _roleKey(d: any): TaginfoResult {
    return {
      value: d.role,
      title: d.role
    };
  }


  /** Sorts keys so that simple keys (without ':') appear before namespaced keys (with ':') */
  _sortKeys(a: any, b: any): number {
    return (a.key.indexOf(':') === -1 && b.key.indexOf(':') !== -1) ? -1
      : (a.key.indexOf(':') !== -1 && b.key.indexOf(':') === -1) ? 1
      : 0;
  }



  /**
   * Performs an API request to taginfo, checking cache and deduplicating in-flight requests.
   * @param url - The full request URL
   * @param params - The query parameters
   * @param exactMatch - Whether cache lookups require an exact URL match
   * @param callback - Errback-style callback for the results
   * @param loaded - Internal callback invoked when the fetch completes
   */
  _request(
    url: string,
    params: TaginfoParams,
    exactMatch: boolean,
    callback: TaginfoCallback,
    loaded: (err: string | null, result?: any) => void
  ): void {
    if (this._checkCache(url, params, exactMatch, callback)) return;

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (loaded) loaded(null, result);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (loaded) loaded(err.message);
      });
  }


  /**
   * Checks the response cache for a matching result.
   * For non-exact matches, progressively shortens the query to find a cached
   * result that returned fewer than the maximum number of results.
   * @param url - The full request URL to look up
   * @param params - The query parameters (used for `rp` and `query`)
   * @param exactMatch - If true, only exact URL matches count as cache hits
   * @param callback - Called with cached results if a hit is found
   * @return True if a cache hit was found and callback was invoked
   */
  _checkCache(url: string, params: TaginfoParams, exactMatch: boolean, callback: TaginfoCallback): boolean {
    const rp = params.rp ?? 25;
    let testQuery = params.query ?? '';
    let testUrl = url;

    do {
      const hit = this._cache[testUrl];

      // exact match, or shorter match yielding fewer than max results (rp)
      if (hit && (url === testUrl || hit.length < rp)) {
        callback(null, hit);
        return true;
      }

      // don't try to shorten the query
      if (exactMatch || !testQuery.length) return false;

      // do shorten the query to see if we already have a cached result
      // that has returned fewer than max results (rp)
      testQuery = testQuery.slice(0, -1);
      testUrl = url.replace(/&query=(.*?)&/, `&query=${testQuery}&`);
    } while (testQuery.length >= 0);

    return false;
  }

}
