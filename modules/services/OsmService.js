import { Tiler, Viewport } from '@rapid-sdk/math';
import { utilArrayChunk, utilArrayGroupBy, utilArrayUniq, utilObjectOmit, utilQsString } from '@rapid-sdk/util';
import _throttle from 'lodash-es/throttle.js';
import { osmAuth } from 'osm-auth';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { JXON } from '../util/jxon.js';
import { createOsmEntity, OsmEntity, OsmNode, OsmRelation, OsmWay, Marker } from '../data/index.js';

import { OsmJSONParser, OsmXMLParser } from '../data/parsers/index.js';
import { utilFetchResponse } from '../util/index.js';


/**
 * `OsmService`
 * This service connects to the OpenStreetMap editing API to perform queries,
 *  fetch data, upload changesets, and more.
 * @see https://wiki.openstreetmap.org/wiki/API
 *
 * Events available:
 *   'apistatuschange'
 *   'authLoading'
 *   'authDone'
 *   'authchange'
 */
export class OsmService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'osm';
    this.requiredDependencies = new Set(['spatial']);
    this.optionalDependencies = new Set(['editor', 'gfx', 'l10n', 'locations']);

    // Some defaults that we will replace with whatever we fetch from the OSM API capabilities result.
    this._maxWayNodes = 2000;
    this._imageryBlocklists = [/.*\.google(apis)?\..*\/(vt|kh)[\?\/].*([xyz]=.*){3}.*/];
    this._wwwroot = 'https://www.openstreetmap.org';
    this._apiroot = 'https://api.openstreetmap.org';

    // Rapid supports both XML and JSON when talking to the OSM API.
    // @see https://wiki.openstreetmap.org/wiki/OSM_JSON
    // @see https://wiki.openstreetmap.org/wiki/OSM_XML
    // Using JSON can be much more efficient because it avoids the overhead
    // of parsing and creating a Document and DOM objects.
    this.preferJSON = true;
    this.JSONParser = new OsmJSONParser();
    this.XMLParser = new OsmXMLParser();

    this._tileCache = {};
    this._noteCache = {};
    this._userCache = {};
    this._changeset = {};

    this._tiler = new Tiler();
    this._deferred = new Set();
    this._connectionID = 0;
    this._tileZoom = 16;
    this._noteZoom = 12;
    this._apiStatus = null;
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;
    this._userPreferences = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._authLoading = this._authLoading.bind(this);
    this._authDone = this._authDone.bind(this);

    this.reloadApiStatus = this.reloadApiStatus.bind(this);
    this.throttledReloadApiStatus = _throttle(this.reloadApiStatus, 500);

    // Calculate the deafult OAuth2 `redirect_uri`.
    // - `redirect_uri` should be a page that the authorizing server (e.g. `openstreetmap.org`)
    //   can redirect the user back to as the final step in the OAuth2 handshake.
    // - By convention we redirect back to a file `land.html` on the same server that Rapid is served from.
    // - The `redirect_uri` value can be overridden by an option to `switchAsync`.
    // - Because OAuth2 requires applications to register their allowable `redirect_uri` values,
    //   there is a short list of `redirect_uris` that will work. Redirecting anywhere else will
    //   result in "The requested redirect uri is malformed or doesn't match client redirect URI".
    // This means:
    // - If you have a custom Rapid installed somewhere, you will need to register your own
    //   OAuth2 application on `openstreetmap.org` for it.
    // - If your custom Rapid installation wants to use OSM's dev server 'api06.dev.openstreetmap.org',
    //   you will need to register a custom application on their dev server too.
    // - For more info see:  https://github.com/osmlab/osm-auth?tab=readme-ov-file#registering-an-application
    let redirect_uri, origin, pathname;
    try {
      origin = window.location.origin;
      pathname = window.location.pathname;
    } catch (e) {  // test environment, no window?
      origin = 'https://127.0.0.1';
      pathname = '/';
    }

    // Anything served from `https://mapwith.ai` or `https://rapideditor.org`,
    // redirect to the common `/rapid/land.html` on that same origin
    if (/^https:\/\/(mapwith\.ai|rapideditor\.org)/i.test(origin)) {
      redirect_uri = `${origin}/rapid/land.html`;

    // Local testing, redirect to `dist/land.html`
    } else if (/^https?:\/\/127\.0\.0\.1:?\d*?/i.test(origin)) {
      redirect_uri = `${origin}/dist/land.html`;

    // Pick a reasonable default, expect a `land.html` file to exist in the same folder as `index.html`.
    // You'll need to register your own OAuth2 application, our OAuth2 application won't redirect to your origin.
    } else {
      let path = pathname.split('/');
      if (path.at(-1).includes('.')) {   // looks like a filename, like `index.html`
        path.pop();                      // we want the path without that file
        pathname = path.join('/') || '/';
      }
      if (pathname.charAt(pathname.length - 1) !== '/') {
        pathname += '/';   // make sure it ends with '/'
      }
      redirect_uri = `${origin}${pathname}land.html`;
    }

    this._oauth = osmAuth({
      url: this._wwwroot,
      apiUrl: this._apiroot,
      client_id: 'O3g0mOUuA2WY5Fs826j5tP260qR3DDX7cIIE2R2WWSc',
      client_secret: 'b4aeHD1cNeapPPQTrvpPoExqQRjybit6JBlNnxh62uE',
      scope: 'read_prefs write_prefs write_api read_gpx write_notes',
      redirect_uri: redirect_uri,
      loading: this._authLoading,
      done: this._authDone
    });
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
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    for (const handle of this._deferred) {
      globalThis.cancelIdleCallback(handle);
      this._deferred.delete(handle);
    }

    this._connectionID++;
    this._apiStatus = null;
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;

    if (this._tileCache.inflight) {
      Object.values(this._tileCache.inflight).forEach(this._abortRequest);
    }
    if (this._noteCache.inflight) {
      Object.values(this._noteCache.inflight).forEach(this._abortRequest);
    }
    if (this._noteCache.inflightPost) {
      Object.values(this._noteCache.inflightPost).forEach(this._abortRequest);
    }
    if (this._changeset.inflight) {
      this._abortRequest(this._changeset.inflight);
    }

    this._tileCache = {
      lastv: null,
      toLoad: new Set(),
      inflight: {},
      seen: new Set()
    };

    this._noteCache = {
      lastv: null,
      toLoad: new Set(),
      inflight: {},
      inflightPost: {},
      closed: {},
    };

    this._userCache = {
      toLoad: new Set(),
      user: {}
    };

    this._changeset = {};

    const spatial = this.context.systems.spatial;
    spatial.clearCache('osm-data');
    spatial.clearCache('osm-notes');

    this.JSONParser.reset();
    this.XMLParser.reset();

    return Promise.resolve();
  }


  /**
   * switchAsync
   * Switch connection and credentials, and reset
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  switchAsync(newOptions) {
    this._wwwroot = newOptions.url;
    this._apiroot = newOptions.apiUrl;

    // Copy the existing options, but omit 'access_token'.
    // (if we did preauth, access_token won't work on a different server)
    const oldOptions = utilObjectOmit(this._oauth.options(), 'access_token');
    this._oauth.options(Object.assign(oldOptions, newOptions));

    return this.resetAsync()
      .then(() => {
        this.emit('authchange');
      });
  }


  get connectionID() {
    return this._connectionID;
  }

  get wwwroot() {
    return this._wwwroot;
  }

  get imageryBlocklists() {
    return this._imageryBlocklists;
  }

  // Returns the maximum number of nodes a single way can have
  get maxWayNodes() {
    return this._maxWayNodes;
  }


  changesetURL(changesetID) {
    return `${this._wwwroot}/changeset/${changesetID}`;
  }


  changesetsURL(center, zoom) {
    const precision = Math.max(0, Math.ceil(Math.log(zoom) / Math.LN2));
    return this._wwwroot + '/history#map=' +
      Math.floor(zoom) + '/' +
      center[1].toFixed(precision) + '/' +
      center[0].toFixed(precision);
  }


  entityURL(entity) {
    const entityID = entity.osmId();
    return `${this._wwwroot}/${entity.type}/${entityID}`;
  }


  historyURL(entity) {
    const entityID = entity.osmId();
    return `${this._wwwroot}/${entity.type}/${entityID}/history`;
  }


  userURL(username) {
    return `${this._wwwroot}/user/${username}`;
  }


  noteURL(note) {
    return `${this._wwwroot}/note/${note.id}`;
  }


  noteReportURL(note) {
    return `${this._wwwroot}/reports/new?reportable_type=Note&reportable_id=${note.id}`;
  }


  /**
   * loadFromAPI
   * Generic method to load data from the OSM API.
   * Can handle either auth or unauth calls.
   * @param   {string}    path - the url path to load data from
   * @param   {function}  callback - errback-style callback function to call with results
   * @param   {Object}    options - parsing options
   * @return  {AbortController}  reference to an AbortController
   */
  loadFromAPI(path, callback, options = {}) {
    options.skipSeen ??= true;

    const cid = this._connectionID;

    const gotResult = (err, content) => {
      // The user switched connection while the request was inflight
      // Ignore content and raise an error.
      if (this._connectionID !== cid) {
        if (callback) callback({ message: 'Connection Switched', status: -1 });
        return;
      }

      // 400 Bad Request, 401 Unauthorized, 403 Forbidden (while logged in)
      // An issue has occurred with the user's credentials.
      // Logout and retry the request..
      const isAuthenticated = this.authenticated();
      if (isAuthenticated && (err?.status === 400 || err?.status === 401 || err?.status === 403)) {
        this.logout();
        this.loadFromAPI(path, callback, options);  // retry
        return;

      } else {  // No retry.. We will relay any error and results to the callback.

        if (err) {
          // 509 Bandwidth Limit Exceeded, 429 Too Many Requests
          if (err.status === 509 || err.status === 429) {
            err.response.text()   // capture the rate limit details
              .then(message => {
                let duration = 10;  // default 10sec, see if response contains a better value
                const match = message.match(/ (\d+) seconds/);
                if (match) {
                  duration = parseInt(match[1], 10);
                }
                this.setRateLimit(duration);
              })
              .then(() => this.throttledReloadApiStatus());  // reload status / raise warning

          // Some other error.. Note that these are not automatically API issues.
          // May be 404 Not Found, etc, but it is worth checking the API status now.
          } else {
            if (this._apiStatus !== 'error') {  // if no error before
              this.throttledReloadApiStatus();  // reload status / raise warning
            }
          }

        } else {  // no error
          if (this._rateLimit) {               // if had rate limit before
            this._rateLimit = null;            // clear rate limit
            this.throttledReloadApiStatus();   // reload status / clear warning
          }
          if (this._apiStatus === 'error') {   // if had error before
            this.throttledReloadApiStatus();   // reload status / clear warning
          }
        }

        if (callback) {
          if (err) {
            return callback(err);
          } else {
            try {
              let results;
              if (path.includes('.json')) {
                results = this.JSONParser.parse(content, options);
              } else {
                results = this.XMLParser.parse(content, options);
              }
              return callback(null, results);
            } catch (err2) {
              return callback(err2);
            }
          }
        }
      }
    };

    // Accept absolute or relative paths
    const url = /^http/i.test(path) ? path : (this._apiroot + path);
    const controller = new AbortController();
    const _fetch = this.authenticated() ? this._oauth.fetch : globalThis.fetch;

    _fetch(url, { signal: controller.signal })
      .then(utilFetchResponse)
      .then(result => gotResult(null, result))
      .catch(err => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          gotResult(err);
          return;
        }
      });

    return controller;
  }


  /**
   * loadEntityAsync
   * Load a single entity by id (ways and relations use the `/full` call to include
   * nodes and members).  Parent relations are not included, see `loadEntityRelationsAsync`.
   * GET /api/0.6/node/#id
   * GET /api/0.6/[way|relation]/#id/full
   * @param   {string}   entityID - the entityID to load
   * @return  {Promise}  Promise resolved with the parsed api results
   */
  loadEntityAsync(entityID) {
    const type = OsmEntity.type(entityID);    // 'node', 'way', 'relation'
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set(['node', 'way', 'relation']) };
    const full = (type !== 'node' ? '/full' : '');
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}${full}${json}`, errback, options);
    });
  }


  /**
   * loadEntityVersionAsync
   * Load a single entity with a specific version
   * GET /api/0.6/[node|way|relation]/#id/#version
   * @param   {string}         entityID - the entityID to load
   * @param   {string|number}  version - version to load
   * @return  {Promise}  Promise resolved with the parsed api results
   */
  loadEntityVersionAsync(entityID, version) {
    const type = OsmEntity.type(entityID);    // 'node', 'way', 'relation'
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set(['node', 'way', 'relation']) };
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}/${version}${json}`, errback, options);
    });
  }


  /**
   * loadEntityRelationsAsync
   * Load the parent relations of a single entity with the given id.
   * (i.e. relations in which the given entity is used).
   * GET /api/0.6/[node|way|relation]/#id/relations
   * @param   {string}   entityID - the entityID to get parent relations
   * @return  {Promise}  Promise resolved with the parsed api results
   */
  loadEntityRelationsAsync(entityID) {
    const type = OsmEntity.type(entityID);
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set(['relation']) };
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}/relations${json}`, errback, options);
    });
  }


  /**
   * loadMultipleAsync
   * Load multiple elements in chunks.
   * Unlike `loadEntityAsync`, child nodes and members are not fetched automatically.
   * GET /api/0.6/[nodes|ways|relations]?#parameters
   * @param   {Array<string|number>}  entityIDs - the entityIDs to load
   * @return  {Promise}               Promise resolved with an Array of entity details
   */
  loadMultipleAsync(entityIDs) {
    const loaded = [];
    const toLoad = {};

    // Group entityIDs into sets by their type
    for (const entityID of entityIDs) {
      const k = OsmEntity.type(entityID);  // 'node', 'way', 'relation'
      let set = toLoad[k];
      if (!set) {
        set = toLoad[k] = new Set();
      }
      set.add(OsmEntity.toOSM(entityID));  // just the number
    }

    let promises;
    for (const [k, set] of Object.entries(toLoad)) {
      const chunks = utilArrayChunk(Array.from(set), 150);
      for (const chunk of chunks) {
        const prom = new Promise(resolve => {
          const errback = (err, results) => {
            // ignore errors here
            loaded.push.apply(loaded, (results.data || []));
            resolve();
          };

          const type = k + 's';   // nodes, ways, relations
          const options = { skipSeen: false, filter: new Set([k]) };
          const json = (this.preferJSON ? '.json' : '');
          this.loadFromAPI(`/api/0.6/${type}${json}?${type}=` + chunk.join(), errback, options);
        });

        promises.push(prom);
      }
    }

    return Promise.all(promises)
      .then(() => loaded);
  }


  /**
   * loadUserAsync
   * Load a given user by id.
   * Note that this call requires an auth connection and will return a cached result if unauth.
   * GET /api/0.6/user/#id
   * @param   {string|number}  userID - the userID to load
   * @return  {Promise}        Promise resolved with the user details
   */
  loadUserAsync(userID) {
    const uid = userID.toString();

    // First, try to resolve to a cached result
    const user = this._userCache.user[uid];
    if (user || !this.authenticated()) {   // require auth
      this._userCache.toLoad.delete(uid);
      if (user) {
        return Promise.resolve(user);
      } else {
        return Promise.reject(new Error(`User ${uid} not found`));
      }
    }

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          const user = (results?.data || []).find(d => d.id === uid);
          if (user) {
            this._userCache.user[uid] = user;
            resolve(user);
          } else {
            reject(new Error(`User ${uid} not found`));
          }
        }
      };

      const options = { skipSeen: false, filter: new Set(['user']) };
      const json = (this.preferJSON ? '.json' : '');
      this.loadFromAPI(`/api/0.6/user/${uid}${json}`, errback, options);
    });
  }


  /**
   * loadUsersAsync
   * Load multiple users in chunks.
   * Note that this call requires an auth connection and will return a cached result if unauth.
   * GET /api/0.6/users?users=#id1,#id2,...,#idn
   * @param   {Array<string|number>}  userIDs - the userIDs to load
   * @return  {Promise}               Promise resolved with an Array of user details
   */
  loadUsersAsync(userIDs) {
    const loaded = [];
    const toLoad = [];

    // First, collect cached results
    for (const userID of utilArrayUniq(userIDs)) {
      const uid = userID.toString();
      const user = this._userCache.user[uid];
      if (user) {
        loaded.push(user);
      } else {
        toLoad.push(uid);
      }
    }

    if (!toLoad.length || !this.authenticated()) {   // require auth
      return Promise.resolve(loaded);
    }

    const options = { skipSeen: false, filter: new Set(['user']) };
    const json = (this.preferJSON ? '.json' : '');
    const chunks = utilArrayChunk(toLoad, 150);

    const promises = [];
    for (const chunk of chunks) {
      const prom = new Promise(resolve => {
        const errback = (err, results) => {
          // ignore errors here
          for (const user of (results?.data || [])) {
            this._userCache.user[user.id] = user;
            loaded.push(user);
          }
          resolve();
        };

        this.loadFromAPI('/api/0.6/users${json}?users=' + chunk.join(), errback, options);
      });
      promises.push(prom);
    }

    return Promise.all(promises)
      .then(() => loaded);
  }


  /**
   * getUserDetailsAsync
   * Get the details of the logged-in user.
   * GET /api/0.6/user/details
   * @return  {Promise}  Promise resolved with the current logged in user's details
   */
  getUserDetailsAsync() {
    if (!this.authenticated()) {
      this._userDetails = null;
      return Promise.reject(new Error('Not logged in'));
    }

    if (this._userDetails) {
      return Promise.resolve(this._userDetails);
    }

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          this._userDetails = results.data[0];
          resolve(this._userDetails);
        }
      };

      const options = { skipSeen: false, filter: new Set(['user']) };
      const json = (this.preferJSON ? '.json' : '');

      this.loadFromAPI(`/api/0.6/user/details${json}`, errback, options);
    });
  }


  /**
   * getUserPreferencesAsync
   * Get the stored preferences for the logged in user.
   * GET /api/0.6/user/preferences
   * @return  {Promise}  Promise resolved with the current logged in user's preferences
   */
  getUserPreferencesAsync() {
    if (!this.authenticated()) {
      this._userPreferences = null;
      return Promise.reject(new Error('Not logged in'));
    }
    if (this._userPreferences) {
      return Promise.resolve(this._userPreferences);
    }

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else {
          this._userPreferences = results.data[0];
          resolve(this._userPreferences);
        }
      };

      const options = { skipSeen: false, filter: new Set(['preferences']) };
      const json = (this.preferJSON ? '.json' : '');

      this.loadFromAPI(
        `/api/0.6/user/preferences${json}`,
        errback,
        options
      );
    });
  }


  /**
   * getUserChangesetsAsync
   * Get the previous changesets for the logged in user.
   * GET /api/0.6/changesets?user=#id
   * @return  {Promise}  Promise resolved with the current logged in user's previous changesets
   */
  getUserChangesetsAsync() {
    if (!this.authenticated()) {
      this._userChangesets = null;
      return Promise.reject(new Error('Not logged in'));
    }
    if (this._userChangesets) {
      return Promise.resolve(this._userChangesets);
    }

    return this.getUserDetailsAsync()
      .then(user => {
        return new Promise((resolve, reject) => {
          const errback = (err, results) => {
            if (err) {
              reject(err);
            } else {
              this._userChangesets = results.data;
              resolve(this._userChangesets);
            }
          };

          const options = { skipSeen: false, filter: new Set(['changeset']) };
          const json = (this.preferJSON ? '.json' : '');
          this.loadFromAPI(`/api/0.6/changesets${json}?user=${user.id}`, errback, options);
        });
      });
  }


  /**
   * getCapabilitiesAsync
   * Fetch the API capabilities information.
   * GET /api/capabilities
   *
   * The status will be one of:
   *   'online'      - working normally
   *   'readonly'    - reachable but readonly
   *   'offline'     - reachable but offline
   *   'error'       - unreachable / network issue
   *   'ratelimit'   - rate limit detected
   *
   * see: https://wiki.openstreetmap.org/wiki/API_v0.6#Response
   * @return  {Promise}  Promise resolved with the API status information
   */
  getCapabilitiesAsync() {
    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err?.message === 'Connection Switched') {  // If connection was just switched,
          this._apiStatus = null;                      // reset cached status and try again
          this._rateLimit = null;
          this.getCapabilitiesAsync().then(resolve, reject);

        } else if (err) {
          this._apiStatus = 'error';
          reject(err);

        } else {
          const api = results.data.find(d => d.type === 'api');
          const policy = results.data.find(d => d.type === 'policy');

          // Set status - 'online', 'readonly', or 'offline'
          this._apiStatus = this._rateLimit ? 'ratelimit' : (api?.status?.api || 'online');

          // Update max nodes per way
          const maxWayNodes = api?.waynodes?.maximum || 2000;
          if (maxWayNodes && isFinite(maxWayNodes)) {
            this._maxWayNodes = maxWayNodes;
          }

          // Update imagery blocklists
          const blocklist = policy?.imagery?.blacklist || [];
          if (blocklist.length) {
            this._imageryBlocklists = blocklist;
          }

          resolve({ osm: results.osm, api: api, policy: policy });
        }
      };

      const options = { skipSeen: false, filter: new Set(['api', 'policy']) };
      const json = (this.preferJSON ? '.json' : '');
      this.loadFromAPI(
        this._apiroot + `/api/capabilities${json}`,  // note, no '0.6'
        errback,
        options
      );
    });
  }


  /**
   * reloadApiStatus
   * Calls `getCapabilitiesAsync` and emits an `apistatuschange` event if the returned
   * status differs from the cached status.
   *
   * The status will be one of:
   *   'online'    - working normally
   *   'readonly'  - reachable but readonly
   *   'offline'   - reachable but offline
   *   'error'     - unreachable / network issue
   *   'ratelimit' - rate limit detected
   */
  reloadApiStatus() {
    const startStatus = this._apiStatus;
    this.getCapabilitiesAsync()
      .then(() => {
        const currStatus = this._apiStatus;
        if (currStatus !== startStatus) {
          this.emit('apistatuschange', currStatus);
        }
      });
  }


  // Create a changeset
  // PUT /api/0.6/changeset/create
  createChangeset(changeset, callback) {
    if (this._changeset.inflight) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    }

    const createdChangeset = (err, changesetID) => {
      this._changeset.inflight = null;
      if (err) { return callback(err, changeset); }

      this._changeset.openChangesetID = changesetID;
      changeset = changeset.update({ id: changesetID });
      callback(null, changeset);
    };

    // try to reuse an existing open changeset
    if (this._changeset.openChangesetID) {
      return createdChangeset(null, this._changeset.openChangesetID);
    }

    const errback = this._wrapcb(createdChangeset);
    const resource = this._apiroot + '/api/0.6/changeset/create';
    const controller = new AbortController();
    const options = {
      method: 'PUT',
      headers: { 'Content-Type': 'text/xml' },
      body: JXON.stringify(changeset.asJXON()),
      signal: controller.signal
    };

    this._oauth.fetch(resource, options)
      .then(utilFetchResponse)
      .then(result => errback(null, result))
      .catch(err => {
        this._changeset.inflight = null;
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });

    this._changeset.inflight = controller;
  }


  // Upload changes to a changeset
  // POST /api/0.6/changeset/#id/upload
  uploadChangeset(changeset, changes, callback) {
    if (this._changeset.inflight) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    } else if (changeset.id !== this._changeset.openChangesetID) {
      // the given changeset is not open, or a different changeset is open?
      return callback({ message: 'Changeset ID mismatch', status: -4 });
    }

    const uploadedChangeset = (err, /*result*/) => {
      this._changeset.inflight = null;
      // we do get a changeset diff result, but we don't currently use it for anything
      callback(err, changeset);
    };

    const errback = this._wrapcb(uploadedChangeset);
    const resource = this._apiroot + `/api/0.6/changeset/${changeset.id}/upload`;
    const controller = new AbortController();
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: JXON.stringify(changeset.osmChangeJXON(changes)),
      signal: controller.signal
    };

    // Attempt to prevent user from creating duplicate changes - see iD#5200
    // Some users will refresh their tab as soon as the changeset is inflight.
    // We don't want to offer to restore these same changes when their browser refreshes.
    const editor = this.context.systems.editor;
    editor?.clearBackup();

    this._oauth.fetch(resource, options)
      .then(utilFetchResponse)
      .then(result => errback(null, result))
      .catch(err => {
        this._changeset.inflight = null;
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });

    this._changeset.inflight = controller;
  }


  // Close a changeset
  // PUT /api/0.6/changeset/#id/close
  closeChangeset(changeset, callback) {
    if (this._changeset.inflight) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    } else if (changeset.id !== this._changeset.openChangesetID) {
      // the given changeset is not open, or a different changeset is open?
      return callback({ message: 'Changeset ID mismatch', status: -4 });
    }

    const closedChangeset = (err, /*result*/) => {
      this._changeset.inflight = null;
      this._changeset.openChangesetID = null;
      // there is no result to this call
      callback(err, changeset);
    };

    const errback = this._wrapcb(closedChangeset);
    const resource = this._apiroot + `/api/0.6/changeset/${changeset.id}/close`;
    const controller = new AbortController();
    const options = {
      method: 'PUT',
      headers: { 'Content-Type': 'text/xml' },
      signal: controller.signal
    };

    this._oauth.fetch(resource, options)
      .then(utilFetchResponse)
      .then(result => errback(null, result))
      .catch(err => {
        this._changeset.inflight = null;
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });

    this._changeset.inflight = controller;
  }


  // Just chains together create, upload, and close a changeset
  // PUT /api/0.6/changeset/create
  // POST /api/0.6/changeset/#id/upload
  // PUT /api/0.6/changeset/#id/close
  sendChangeset(changeset, changes, callback) {
    const cid = this._connectionID;

    this.createChangeset(changeset, (err, updated) => {
      changeset = updated;
      if (err) { return callback(err, changeset); }

      this.uploadChangeset(changeset, changes, (err, updated) => {
        changeset = updated;
        if (err) { return callback(err, changeset); }

        // Upload was successful, it is safe to call the callback.
        // Add delay to allow for postgres replication iD#1646 iD#2678
        globalThis.setTimeout(() => {
          this._changeset.openChangesetID = null;
          callback(null, changeset);
        }, 2500);

        // Closing the changeset is optional, and we won't get a result.
        // Only try to close the changeset if we're still talking to the same server.
        if (this._connectionID === cid) {
          this.closeChangeset(changeset, () => {});
        }
      });
    });
  }


  // Load data (entities) from the API in tiles
  // GET /api/0.6/map?bbox=
  loadTiles(callback) {
    if (this._paused || this.getRateLimit()) {
      if (callback) callback(null, { data: [] });
      return;
    }

    const cache = this._tileCache;
    const viewport = this.context.viewport;
    if (cache.lastv === viewport.v) {  // exit early if the view is unchanged
      if (callback) callback(null, { data: [] });
      return;
    }

    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.zoomRange(this._tileZoom).getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    this._abortUnwantedRequests(cache, tiles);

    // Issue new requests..
    for (const tile of tiles) {
      this.loadTile(tile, callback);
    }
  }


  /**
   * setRateLimit
   * This will establish a rate limit for the given duration in seconds.
   * If a rate limit already exists, extend the time if needed.
   * @param  {number}   seconds - seconds to impose the rate limit (default 10 sec)
   * @return {Object?}  rate limit info, or `null` if `seconds` is junk
   */
  setRateLimit(seconds = 10) {
    // If `seconds` makes no sense, just return the existing rate limit, if any..
    if (isNaN(seconds) || !isFinite(seconds) || seconds <= 0) {
      return this._rateLimit;
    }

    // If rate limit already exists for a longer duration, do nothing..
    if (this._rateLimit && this._rateLimit.remaining >= seconds) {
      return this._rateLimit;
    }

    // Stop loading tiles, and cancel any inflight
    this._tileCache.toLoad.clear();
    this._noteCache.toLoad.clear();
    Object.values(this._tileCache.inflight).forEach(this._abortRequest);
    Object.values(this._noteCache.inflight).forEach(this._abortRequest);

    return this._rateLimit = {
      start: Math.floor(Date.now() / 1000),  // epoch seconds
      duration: seconds,                     // retry-after seconds
      remaining: seconds,
      elapsed:  0
    };
  }


  /**
   * getRateLimit
   * If there is currently a rate limit, return the information about it.
   * This will also cancel the rate limit if we detect that it has expired.
   * @return  {Object?}  rate limit info, or `null` if no current rate limit
   */
  getRateLimit() {
    if (!this._rateLimit) return null;

    const now = Math.floor(Date.now() / 1000);  // epoch seconds
    const start = this._rateLimit.start ?? now;
    const duration = this._rateLimit.duration ?? 10;
    let elapsed = now - start;

    // Check if something unexpected moved the clock more than 5 seconds backwards
    if (elapsed < -5) {   // leap seconds? epoch rollover? time travel?
      this._rateLimit.start = now;  // restart the counter
      elapsed = 0;
    }

    const remaining = duration - elapsed;
    if (remaining > 0) {
      this._rateLimit.remaining = remaining;
      this._rateLimit.elapsed = elapsed;
      return this._rateLimit;
    } else {
      this._rateLimit = null;  // rate limit is over
      return null;
    }
  }


  // Load a single data tile
  // GET /api/0.6/map?bbox=
  loadTile(tile, callback) {
    if (this._paused || this.getRateLimit()) return;

    const context = this.context;
    const cache = this._tileCache;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;
    const locations = context.systems.locations;
    const tileID = tile.id;

    if (spatial.hasTile('osm-data', tileID)) return;
    if (cache.inflight[tileID]) return;

    if (locations) {
      // Exit if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const tileBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (tileBlocked) {
        spatial.addTiles('osm-data', tile);   // don't try again
        return;
      }
    }

    const gotTile = (err, results) => {
      delete cache.inflight[tileID];
      if (!err) {
        cache.toLoad.delete(tileID);
        spatial.addTiles('osm-data', [tile]);
      }

      gfx?.deferredRedraw();

      if (callback) {
        callback(err, Object.assign({}, results, { tile: tile }));
      }
    };

    const options = { skipSeen: true };
    const json = (this.preferJSON ? '.json' : '');
    const path = `/api/0.6/map${json}?bbox=` + tile.wgs84Extent.toParam();

    cache.inflight[tileID] = this.loadFromAPI(path, gotTile, options);
  }


  /**
   * isDataLoaded
   * Is OSM data exist at the given [lon,lat] coordinate?
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @return  {boolean}  `true` if data exists there, `false` if not
   */
  isDataLoaded(loc) {
    const spatial = this.context.systems.spatial;
    return spatial.hasTileAtLoc('osm-data', loc);
  }


  /**
   * loadTileAtLoc
   * Queue loading the tile that covers the given `loc`
   * @param   {Array<number>}  loc      - the search location (WGS84 [lon,lat])
   * @param   {function}       callback - errback-style callback function to call with results
   */
  loadTileAtLoc(loc, callback) {
    const spatial = this.context.systems.spatial;

    if (this._paused || this.getRateLimit()) return;
    const cache = this._tileCache;

    // Back off if the toLoad queue is filling up.. re iD#6417
    // (Currently `loadTileAtLoc` requests are considered low priority - used by operations to
    // let users safely edit geometries which extend to unloaded tiles.  We can drop some.)
    if (cache.toLoad.size > 50) return;

//worldcoordinates
    // const k = geoZoomToScale(this._tileZoom + 1);
    // const offset = new Viewport({ k: k }).project(loc);
    // const viewport = new Viewport({ k: k, x: -offset[0], y: -offset[1] });
    // const tiles = this._tiler.zoomRange(this._tileZoom).getTiles(viewport).tiles;
    const z2 = this._tileZoom + 1;
    const offset = new Viewport({ z: z2 }).project(loc);
    const viewport = new Viewport({ x: -offset[0], y: -offset[1], z: z2 });
    const tiles = this._tiler.zoomRange(this._tileZoom).getTiles(viewport).tiles;

    for (const tile of tiles) {
      if (spatial.hasTile('osm-data', tile.id)) continue;                   // already loaded
      if (cache.toLoad.has(tile.id) || cache.inflight[tile.id]) continue;   // queued or inflight

      cache.toLoad.add(tile.id);
      this.loadTile(tile, callback);
    }
  }


  /**
   * loadNotes
   * Schedule any data requests needed to cover the current map view
   * @param  {Object}  noteOptions - note options
   */
  loadNotes(noteOptions) {
    if (this._paused || this.getRateLimit()) return;

    const context = this.context;
    const cache = this._noteCache;
    const locations = context.systems.locations;
    const spatial = context.systems.spatial;
    const viewport = context.viewport;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.zoomRange(this._noteZoom).getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed
    this._abortUnwantedRequests(cache, tiles);

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      if (spatial.hasTile('osm-notes', tileID)) continue;
      if (cache.inflight[tileID]) continue;

      if (locations) {
        // Skip if this tile covers a blocked region (all corners are blocked)
        const corners = tile.wgs84Extent.polygon().slice(0, 4);
        const tileBlocked = corners.every(loc => locations.isBlockedAt(loc));
        if (tileBlocked) {
          spatial.addTiles('osm-notes', [tile]);   // don't try again
          continue;
        }
      }
      this.loadNotesTile(tile, noteOptions);
    }
  }


  /**
   * loadNotesTile
   * Load a single tile of note data.
   * GET /api/0.6/notes?bbox=
   * @param  {Tile}    tile - Tile data
   * @param  {Object}  noteOptions - note options
   */
  loadNotesTile(tile, noteOptions) {
    noteOptions = Object.assign({ limit: 10000, closed: 7 }, noteOptions);

    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;
    const cache = this._noteCache;
    const tileID = tile.id;

    const errback = (err, results) => {
      delete cache.inflight[tileID];

      if (results) {
        spatial.addTiles('osm-notes', [tile]);   // mark as loaded
        for (const props of (results.data ?? [])) {
          this._cacheNote(props);
        }
        gfx?.deferredRedraw();
      }
    };

    const json = (this.preferJSON ? '.json' : '');
    const options = { skipSeen: true, filter: new Set(['note']) };
    const path = `/api/0.6/notes${json}?limit=` + noteOptions.limit + '&closed='
      + noteOptions.closed + '&bbox=' + tile.wgs84Extent.toParam();

    cache.inflight[tileID] = this.loadFromAPI(path, errback, options);
  }


  /**
   * loadNoteAsync
   * Load a single note by id.
   * GET /api/0.6/notes/#id
   * @param   {string|number}  id - noteID to get
   * @return  {Promise}  Promise resolved with the note
   */
  loadNoteAsync(id) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const gfx = context.systems.gfx;

    const noteID = id.toString();
    let note = spatial.getData('osm-notes', noteID);
    if (note) {
      return Promise.resolve(note);
    }

    return new Promise((resolve, reject) => {
      const errback = (err, results) => {
        if (err) {
          reject(err);
        } else if (Array.isArray(results?.data)) {
          note = this._cacheNote(results.data[0]);
          gfx?.deferredRedraw();
          resolve(note);
        } else {
          reject(new Error(`Note ${noteID} not found`));
        }
      };

      const options = { skipSeen: false, filter: new Set(['note']) };
      const json = (this.preferJSON ? '.json' : '');

      this.loadFromAPI(`/api/0.6/notes/${noteID}${json}`, errback, options);
    });
  }


  // Create a note
  // POST /api/0.6/notes?params
  postNoteCreate(note, callback) {
    const noteID = note.id;

    if (this._noteCache.inflightPost[noteID]) {
      return callback({ message: 'Note update already inflight', status: -2 }, note);
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 }, note);
    }

    if (!Array.isArray(note.loc) || !note.props.newComment) return;  // location & description required

    const createdNote = (err, xml) => {
      delete this._noteCache.inflightPost[noteID];
      if (err) { return callback(err); }

      // we get the updated note back, remove from caches and reparse..
      this.removeNote(note);

      const options = { skipSeen: false };
      return this._parseXML(xml, (err, results) => {
        if (err) {
          return callback(err);
        } else {
          const gfx = this.context.systems.gfx;
          gfx?.deferredRedraw();
          return callback(null, results.data[0]);
        }
      }, options);
    };

    const errback = this._wrapcb(createdNote);
    const resource = this._apiroot + '/api/0.6/notes?' +
      utilQsString({ lon: note.loc[0], lat: note.loc[1], text: note.props.newComment });
    const controller = new AbortController();
    const options = { method: 'POST', signal: controller.signal };

    this._oauth.fetch(resource, options)
      .then(utilFetchResponse)
      .then(result => errback(null, result))
      .catch(err => {
        this._changeset.inflight = null;
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });

    this._noteCache.inflightPost[noteID] = controller;
  }


  // Update a note
  // POST /api/0.6/notes/#id/comment?text=comment
  // POST /api/0.6/notes/#id/close?text=comment
  // POST /api/0.6/notes/#id/reopen?text=comment
  postNoteUpdate(note, newStatus, callback) {
    const noteID = note.id;

    if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 }, note);
    }
    if (this._noteCache.inflightPost[noteID]) {
      return callback({ message: 'Note update already inflight', status: -2 }, note);
    }

    let action;
    if (note.props.status !== 'closed' && newStatus === 'closed') {
      action = 'close';
    } else if (note.props.status !== 'open' && newStatus === 'open') {
      action = 'reopen';
    } else {
      action = 'comment';
      if (!note.props.newComment) return; // when commenting, comment required
    }

    const updatedNote = (err, xml) => {
      delete this._noteCache.inflightPost[noteID];
      if (err) { return callback(err); }

      // we get the updated note back, remove from caches and reparse..
      this.removeNote(note);

      // update closed note cache - used to populate `closed:note` changeset tag
      if (action === 'close') {
        this._noteCache.closed[noteID] = true;
      } else if (action === 'reopen') {
        delete this._noteCache.closed[noteID];
      }

      const options = { skipSeen: false };
      return this._parseXML(xml, (err, results) => {
        if (err) {
          return callback(err);
        } else {
          const gfx = this.context.systems.gfx;
          gfx?.deferredRedraw();
          return callback(null, results.data[0]);
        }
      }, options);
    };

    const errback = this._wrapcb(updatedNote);
    let resource = this._apiroot + `/api/0.6/notes/${noteID}/${action}`;
    if (note.props.newComment) {
      resource += '?' + utilQsString({ text: note.props.newComment });
    }
    const controller = new AbortController();
    const options = { method: 'POST', signal: controller.signal };

    this._oauth.fetch(resource, options)
      .then(utilFetchResponse)
      .then(result => errback(null, result))
      .catch(err => {
        this._changeset.inflight = null;
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });

    this._noteCache.inflightPost[noteID] = controller;
  }


  // get/set cached data
  // This is used to save/restore the state when entering/exiting the walkthrough
  // Also used for testing purposes.
  caches(obj) {
    function cloneCache(source) {
      let target = {};
      for (const [k, v] of Object.entries(source)) {
        if (k === 'note') {
          target.note = {};
          for (const id of Object.keys(v)) {
            target.note[id] = new Marker(source.note[id]);  // clone notes
          }
        } else {
          target[k] = globalThis.structuredClone(v);  // clone anything else
        }
      }
      return target;
    }

    if (obj === undefined) {
      return {
        tile: cloneCache(this._tileCache),
        note: cloneCache(this._noteCache),
        user: cloneCache(this._userCache)
      };
    }

    if (obj.tile) {
      this._tileCache = obj.tile;
      this._tileCache.inflight = {};
    }
    if (obj.note) {
      this._noteCache = obj.note;
      this._noteCache.inflight = {};
      this._noteCache.inflightPost = {};
    }
    if (obj.user) {
      this._userCache = obj.user;
    }

    return this;
  }


  logout() {
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;
    this._userPreferences = null;
    this._oauth.logout();
    this.emit('authchange');
    return this;
  }


  authenticated() {
    return this._oauth.authenticated();
  }


  authenticate(callback) {
    const cid = this._connectionID;
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;

    const gotResult = (err, result) => {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (this._connectionID !== cid) {
        if (callback) callback({ message: 'Connection Switched', status: -1 });
        return;
      }
      this.reloadApiStatus();
//      this.userChangesets(function() {});  // eagerly load user details/changesets
      this.emit('authchange');
      if (callback) callback(err, result);
    };

    // Ensure the locale is correctly set before opening the popup
    const l10n = this.context.systems.l10n;
    const localeCode = l10n?.localeCode() || 'en-US';

    this._oauth.options({
      ...this._oauth.options(),
      locale: localeCode
    });
    this._oauth.authenticate(gotResult);
    this._oauth.bringPopupWindowToFront();  // no guarantees, but we can try
  }


  // get all cached notes covering the viewport
  getNotes() {
    const spatial = this.context.systems.spatial;
    return spatial.getVisibleData('osm-notes').map(d => d.data);
  }


  /**
   * getNote
   * Get a note with given id from cache
   * @param   {string}  dataID
   * @return  {Marker}  the cached note
   */
  getNote(dataID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('osm-notes', dataID);
  }


  /**
   * replaceNote
   * Replace a single item in the cache
   * @param   {Marker}  item to replace
   * @return  {Marker}  the item, or `null` if it couldn't be replaced
   */
  replaceNote(item) {
    if (!(item instanceof Marker) || !item.id) return null;

    const spatial = this.context.systems.spatial;
    spatial.replaceData('osm-notes', item);
    return item;
  }


  /**
   * removeNote
   * Remove a single item from the cache
   * @param  {Marker}  item to remove
   */
  removeNote(item) {
    if (!(item instanceof Marker) || !item.id) return;

    const spatial = this.context.systems.spatial;
    spatial.removeData('osm-notes', item);
  }


  /**
   * getClosedIDs
   * Get an array of noteIDs closed during this session.
   * Used to populate `closed:note` changeset tag
   * @return  {Array<string>}  Array of closed note ids
   */
  getClosedIDs() {
    return Object.keys(this._noteCache.closed).sort();
  }


  _authLoading() {
    this.emit('authLoading');
  }


  _authDone() {
    this.emit('authDone');
  }


  _abortRequest(controller) {
    if (controller) {
      controller.abort();
    }
  }


  _abortUnwantedRequests(cache, visibleTiles) {
    for (const k of Object.keys(cache.inflight)) {
      if (cache.toLoad.has(k)) continue;
      if (visibleTiles.some(tile => tile.id === k)) continue;

      this._abortRequest(cache.inflight[k]);
      delete cache.inflight[k];
    }
  }


  /**
   * _cacheNote
   * Store the given note in the caches
   * @param   {Object}  source - the note properties
   * @return  {Marker}  The note
   */
  _cacheNote(source) {
    const context = this.context;
    const spatial = context.systems.spatial;
    const noteID = source.id;

    let note = spatial.getData('osm-notes', noteID);
    if (!note) {
      const loc = spatial.preventCoincidentLoc('osm-notes', source.loc);
      note = new Marker(this.context, {
        type:       'note',
        serviceID:  this.id,
        id:         noteID,
        loc:        loc
      });
    }

    // Update whatever additional props we were passed..
    const props = note.props;
    if (source.url)           props.url          = source.url;
    if (source.comment_url)   props.comment_url  = source.comment_url;
    if (source.close_url)     props.close_url    = source.close_url;
    if (source.date_created)  props.date_created = source.date_created;
    if (source.status)        props.status       = source.status;
    if (source.comments)      props.comments     = source.comments;

    spatial.replaceData('osm-notes', note);
    return note.touch();
  }


  // Wraps an API callback in some additional checks.
  // Logout if we receive 400, 401, 403
  // Raise an error if the connectionID has switched during the API call.
  // @param  callback
  _wrapcb(callback) {
    const cid = this._connectionID;
    return (err, results) => {
      if (err) {
        // 400 Bad Request, 401 Unauthorized, 403 Forbidden..
        if (err.status === 400 || err.status === 401 || err.status === 403) {
          this.logout();
        }
        return callback.call(this, err);

      } else if (this._connectionID !== cid) {
        return callback.call(this, { message: 'Connection Switched', status: -1 });

      } else {
        return callback.call(this, err, results);
      }
    };
  }

}
