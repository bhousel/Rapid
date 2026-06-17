import { AbstractSystem } from '../core/AbstractSystem.ts';
import { JXON } from '../util/jxon.ts';
import { OsmEntity, MarkerData } from '../data/index.ts';
import { osmAuth } from 'osm-auth';
import { osmServiceListeners } from './OsmService.worker.ts';
import { Extent, numClamp, projWgs84ToWorld, projWorldToWgs84, Tiler, WORLD_SIZE } from '@rapid-sdk/math';
import { utilArrayChunk, utilArrayUniq, utilObjectOmit, utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { EntityType } from '../data/types.ts';
import type { FetchEnvelope } from '../util/fetch_response.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { OsmChangeset, OsmChanges } from '../data/OsmChangeset.ts';
import type { ParserDataType, ParserOptions, ParserResult, ParsedApi, ParsedData, ParsedPolicy } from '../data/parsers/types.ts';
import type { Tile, Vec2, Vec3 } from '@rapid-sdk/math';


/** Properties specific to OSM note markers */
export interface OsmNoteProps extends MarkerProps {
  /** API URL for the note */
  url?: string;
  /** API URL for commenting on the note */
  comment_url?: string;
  /** API URL for closing the note */
  close_url?: string;
  /** ISO date string when the note was created */
  date_created?: string;
  /** Current status of the note (e.g. 'open', 'closed') */
  status?: string;
  /** Array of comment objects on the note */
  comments?: any[];
  /** Unsaved comment text being composed */
  newComment?: string;
}

/** An OSM note MarkerData with typed props */
export type OsmNote = MarkerData<OsmNoteProps>;

/** Rate limit information */
interface RateLimitInfo {
  /** Timestamp (ms) when the rate limit was imposed */
  start: number;
  /** Duration of the rate limit in seconds */
  duration: number;
  /** Remaining seconds until the rate limit expires */
  remaining: number;
  /** Elapsed seconds since the rate limit started */
  elapsed: number;
}

/** Cache for tile loading state */
interface TileCache {
  /** Last viewport version number used for tile loading */
  lastv: number | null;
}

/** Cache for note loading state */
interface NoteCache {
  /** Last viewport version number used for note loading */
  lastv: number | null;
  /** Set of tile IDs pending note loading */
  toLoad: Set<string>;
  /** Map of note IDs to their closed status */
  closed: Record<string, boolean>;
}

/** Cache for user data */
interface UserCache {
  /** Set of user IDs pending loading */
  toLoad: Set<string>;
  /** Map of user IDs to cached user data */
  user: Record<string, any>;
}

/** Changeset tracking state */
interface ChangesetState {
  /** The ID of the currently open changeset */
  openChangesetID?: string | null;
}

/** Options for note queries */
interface NoteOptions {
  /** Maximum number of notes to return */
  limit?: number;
  /** Number of days since closure to include (0 = only open notes) */
  closed?: number;
}

/** Options passed to switchAsync */
interface SwitchOptions {
  /** OSM website URL to switch to */
  url: string;
  /** OSM API URL to switch to */
  apiUrl: string;
  [key: string]: any;
}

/** Capabilities result */
interface CapabilitiesResult {
  /** Raw OSM capabilities response data */
  osm: Record<string, unknown>;
  /** Parsed API capability details (e.g. max way nodes, bounding box limits) */
  api: ParsedApi | undefined;
  /** Parsed imagery policy details (e.g. blocklists) */
  policy: ParsedPolicy | undefined;
}

/** Caches object for get/set */
interface CachesObject {
  /** Tile loading cache */
  tile?: TileCache;
  /** Note loading cache */
  note?: NoteCache;
  /** User data cache */
  user?: UserCache;
}

/**
 * Options passed to `osmAuth()` factory.
 * The shipped `osm-auth` types declare this as a class constructor, but at
 * runtime it's a plain factory function.  We define our own interface here
 * because the bundled `.d.ts` is missing `client_secret` and other fields.
 */
interface OsmAuthOptions {
  /** Base URL for the OSM website (e.g. 'https://www.openstreetmap.org') */
  url: string;
  /** Base URL for the OSM API (e.g. 'https://api.openstreetmap.org') */
  apiUrl: string;
  /** OAuth2 client identifier */
  client_id: string;
  /** OAuth2 client secret */
  client_secret: string;
  /** OAuth2 authorization scopes (space-separated) */
  scope: string;
  /** OAuth2 redirect URI after authorization */
  redirect_uri: string;
  /** Pre-authorized access token (for pre-auth scenarios) */
  access_token?: string;
  /** Whether to automatically authenticate */
  auto?: boolean;
  /** Whether to use single-page auth flow (no popup) */
  singlepage?: boolean;
  /** Callback invoked when the auth popup opens */
  loading?: () => void;
  /** Callback invoked when the auth popup closes */
  done?: () => void;
  /** Locale code for the auth page */
  locale?: string;
}

/** The object returned by `osmAuth()` */
interface OsmAuthInstance {
  /** Performs an authenticated fetch request */
  fetch(resource: string, options?: RequestInit): Promise<Response>;
  /** Returns whether the user is currently authenticated */
  authenticated(): boolean;
  /** Returns the access token if the user is authenticated, empty string if not */
  getAccessToken(): string;
  /** Initiates the OAuth2 authentication flow */
  authenticate(callback: Errback, options?: { switchUser?: boolean }): void;
  /** Brings the auth popup window to front, if open */
  bringPopupWindowToFront(): boolean;
  /** Logs the user out and clears stored credentials */
  logout(): OsmAuthInstance;
  /** Gets the current auth options */
  options(): OsmAuthOptions;
  /** Sets auth options (merges with existing) */
  options(val: Partial<OsmAuthOptions>): OsmAuthInstance;
}


/**
 * `OsmService` connects to the OpenStreetMap editing API to perform queries,
 *  fetch data, upload changesets, and more.
 * @see https://wiki.openstreetmap.org/wiki/API
 *
 * Events available:
 * - 'apistatuschange'
 * - 'authLoading'
 * - 'authDone'
 * - 'authchange'
 */
export class OsmService extends AbstractSystem {

  /** Whether to prefer JSON over XML when communicating with the OSM API */
  public preferJSON: boolean;

  /** Maximum number of nodes allowed in a single way (from API capabilities) */
  protected _maxWayNodes: number;
  /** Regex patterns for imagery sources blocked by OSM policy */
  protected _imageryBlocklists: RegExp[];
  /** Base URL of the OSM website (e.g. 'https://www.openstreetmap.org') */
  protected _wwwroot: string;
  /** Base URL of the OSM API (e.g. 'https://api.openstreetmap.org') */
  protected _apiroot: string;
  /** Cache for tile loading state */
  protected _tileCache: TileCache;
  /** Cache for note loading state */
  protected _noteCache: NoteCache;
  /** Cache for user data */
  protected _userCache: UserCache;
  /** Changeset tracking state */
  protected _changeset: ChangesetState;
  /** Tiler used to compute which tiles to load for the current viewport */
  protected _tiler: Tiler;
  /** Incrementing ID that changes on connection reset (invalidates in-flight requests) */
  protected _connectionID: number;
  /** Zoom level at which map data tiles are loaded */
  protected _tileZoom: number;
  /** Zoom level at which note tiles are loaded */
  protected _noteZoom: number;
  /** Current API status string ('online', 'readonly', 'offline', 'error'), or null */
  protected _apiStatus: string | null;
  /** Current rate limiting info, or null if not rate-limited */
  protected _rateLimit: RateLimitInfo | null;
  /** Cached list of the authenticated user's changesets, or null */
  protected _userChangesets: any[] | null;
  /** Cached details of the authenticated user, or null */
  protected _userDetails: any | null;
  /** Cached preferences of the authenticated user, or null */
  protected _userPreferences: any | null;
  /** The `osm-auth` instance used for OAuth2 authentication */
  protected _oauth: OsmAuthInstance;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'osm';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['editor', 'gfx', 'l10n', 'locations', 'scheduler', 'worker']);

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

    this._tileCache = {} as TileCache;
    this._noteCache = {} as NoteCache;
    this._userCache = {} as UserCache;
    this._changeset = {};

    this._tiler = new Tiler();
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
    this._authInterceptor = this._authInterceptor.bind(this);
    this.reloadApiStatus = this.reloadApiStatus.bind(this);
    this.deferredReloadApiStatus = this.deferredReloadApiStatus.bind(this);

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
    let redirect_uri: string, origin: string, pathname: string;
    try {
      origin = globalThis.location.origin;
      pathname = globalThis.location.pathname;
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
      const path = pathname.split('/');
      if (path.at(-1)?.includes('.')) {   // looks like a filename, like `index.html`
        path.pop();                      // we want the path without that file
        pathname = path.join('/') || '/';
      }
      if (pathname.charAt(pathname.length - 1) !== '/') {
        pathname += '/';   // make sure it ends with '/'
      }
      redirect_uri = `${origin}${pathname}land.html`;
    }

    this._oauth = (osmAuth as unknown as (o: OsmAuthOptions) => OsmAuthInstance)({
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
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const network = context.systems.network!;
    const worker = context.systems.worker;

    return this._initPromise = super.initAsync()
      .then(() => {
        network.addRequestInterceptor(this._authInterceptor);

        // Register listeners for worker dispatch (and main-thread fallback)
        for (const [listenerID, listener] of Object.entries(osmServiceListeners)) {
          worker?.registerListener(listenerID, listener);
        }
      })
      .then(() => this.resetAsync());
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
    this._connectionID++;
    this._apiStatus = null;
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;

    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const worker = context.systems.worker;

    this._tileCache = { lastv: null };
    this._noteCache = { lastv: null, toLoad: new Set<string>(), closed: {} };
    this._userCache = { toLoad: new Set<string>(), user: {} };
    this._changeset = {};

    network.clearMatching(id => id.startsWith('osm-'));
    spatial.clearMatching(id => id.startsWith('osm-'));

    // Reset the worker-side parser instances
    if (worker?.workerURL) {
      return worker.dispatch<void>('osmService:reset');
    } else {
      osmServiceListeners['osmService:reset'](undefined, new AbortController().signal);
      return Promise.resolve();
    }
  }


  /**
   * Switch connection and credentials, and reset
   * @param newOptions
   * @return  Promise resolved when this component has completed resetting
   */
  public switchAsync(newOptions: SwitchOptions): Promise<void> {
    const context = this.context;
    const gfx = context.systems.gfx;

    this._wwwroot = newOptions.url;
    this._apiroot = newOptions.apiUrl;

    // Copy the existing options, but omit 'access_token'.
    // (if we did preauth, access_token won't work on a different server)
    const oldOptions = utilObjectOmit(this._oauth.options(), ['access_token']);
    this._oauth.options(Object.assign(oldOptions, newOptions));

    return this.resetAsync()
      .then(() => {
        gfx?.immediateRedraw();
        this.emit('authchange');
      });
  }


  /** The current connection ID (incremented on each reset to invalidate in-flight requests)
   * @return  The current connection ID
   */
  public get connectionID(): number {
    return this._connectionID;
  }

  /** The base URL of the OSM website
   * @return  Base URL string (e.g. `'https://www.openstreetmap.org'`)
   */
  public get wwwroot(): string {
    return this._wwwroot;
  }

  /** Regex patterns for imagery sources blocked by OSM policy
   * @return  Array of blocklist regex patterns
   */
  public get imageryBlocklists(): RegExp[] {
    return this._imageryBlocklists;
  }

  /** The maximum number of nodes a single way can have
   * @return  Maximum node count per way
   */
  public get maxWayNodes(): number {
    return this._maxWayNodes;
  }


  /**
   * Returns the OSM website URL for a given changeset
   * @param changesetID - The changeset ID
   * @return  The changeset page URL
   */
  public changesetURL(changesetID: string | number): string {
    return `${this._wwwroot}/changeset/${changesetID}`;
  }


  /**
   * Returns the OSM website URL for the changeset history view at a given location
   * @param center - Map center as `[lon, lat]`
   * @param zoom - Map zoom level
   * @return  The changeset history URL
   */
  public changesetsURL(center: Vec2, zoom: number): string {
    const precision = Math.max(0, Math.ceil(Math.log(zoom) / Math.LN2));
    return this._wwwroot + '/history#map=' +
      Math.floor(zoom) + '/' +
      center[1].toFixed(precision) + '/' +
      center[0].toFixed(precision);
  }


  /**
   * Returns the OSM website URL for a given entity
   * @param entity - The OSM entity
   * @return  The entity page URL
   */
  public entityURL(entity: OsmEntity): string {
    const entityID = entity.osmId();
    return `${this._wwwroot}/${entity.type}/${entityID}`;
  }


  /**
   * Returns the OSM website URL for the history of a given entity
   * @param entity - The OSM entity
   * @return  The entity history page URL
   */
  public historyURL(entity: OsmEntity): string {
    const entityID = entity.osmId();
    return `${this._wwwroot}/${entity.type}/${entityID}/history`;
  }


  /**
   * Returns the OSM website URL for a given user's profile
   * @param username - The OSM username
   * @return  The user profile page URL
   */
  public userURL(username: string): string {
    return `${this._wwwroot}/user/${username}`;
  }


  /**
   * Returns the OSM website URL for a given note
   * @param note - The note marker data
   * @return  The note page URL
   */
  public noteURL(note: MarkerData): string {
    return `${this._wwwroot}/note/${note.id}`;
  }


  /**
   * Returns the OSM website URL for reporting a given note
   * @param note - The note marker data
   * @return  The note report URL
   */
  public noteReportURL(note: MarkerData): string {
    return `${this._wwwroot}/reports/new?reportable_type=Note&reportable_id=${note.id}`;
  }


  /**
   * Generic method to load data from the OSM API.
   * Can handle either auth or unauth calls.
   *
   * Fetching and parsing are dispatched to a web worker via the
   * `osmService:fetchAndParse` listener.  The listener returns a
   * discriminated result type (`OsmFetchResult`) so that HTTP error
   * details (status, body text) survive the worker boundary.
   *
   * @param   path - the url path to load data from
   * @param   callback - errback-style callback function to call with results
   * @param   options - parsing options
   * @param   requestID - optional requestID for NetworkSystem tracking
   * @return  the RequestID used for this request
   */
  public loadFromAPI(path: string, callback: Errback | null, options: Partial<ParserOptions> = {}, requestID?: RequestID): RequestID {
    const context = this.context;
    const network = context.systems.network!;

    const cid = this._connectionID;
    options.skipSeen ??= true;

    const format: 'json' | 'xml' = path.includes('.json') ? 'json' : 'xml';

    // Accept absolute or relative paths
    const url = /^http/i.test(path) ? path : (this._apiroot + path);
    const computedID = requestID ?? (`GET ${url}` as RequestID);

    network.fetchEnvelope<ParserResult>(url, {
      requestID: computedID,
      listenerID: 'osmService:fetchAndParse',
      listenerData: { format, parserOptions: options },
      resultPriority: 'normal',
    })
      .then((env: FetchEnvelope<ParserResult>) => {
        // The user switched connection while the request was inflight.
        // Ignore content and raise an error.
        if (this._connectionID !== cid) {
          if (callback) callback({ message: 'Connection Switched', status: -1 });
          return;
        }

        if (!env.ok) {
          const { status, statusText, message, body } = env;

          // 400 Bad Request, 401 Unauthorized, 403 Forbidden (while logged in)
          // An issue has occurred with the user's credentials.
          // Logout and retry the request..
          const isAuthenticated = this.authenticated();
          if (isAuthenticated && (status === 400 || status === 401 || status === 403)) {
            this.logout();
            this.loadFromAPI(path, callback, options);  // retry
            return;
          }

          // 509 Bandwidth Limit Exceeded, 429 Too Many Requests
          if (status === 509 || status === 429) {
            let duration = 10;  // default 10sec, see if response contains a better value
            const match = (body ?? '').match(/ (\d+) seconds/);
            if (match) {
              duration = parseInt(match[1], 10);
            }
            this.setRateLimit(duration);
            this.deferredReloadApiStatus();  // reload status / raise warning

          // Some other error.. Note that these are not automatically API issues.
          // May be 404 Not Found, etc, but it is worth checking the API status now.
          } else {
            if (this._apiStatus !== 'error') {  // if no error before
              this.deferredReloadApiStatus();   // reload status / raise warning
            }
          }

          if (callback) callback({ message, status, statusText });
          return;
        }

        // Success path — data was fetched and parsed on the worker
        if (this._rateLimit) {               // if had rate limit before
          this._rateLimit = null;            // clear rate limit
          this.deferredReloadApiStatus();    // reload status / clear warning
        }
        if (this._apiStatus === 'error') {   // if had error before
          this.deferredReloadApiStatus();    // reload status / clear warning
        }

        if (callback) callback(null, env.value);
      })
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok

        // The user switched connection while the request was inflight
        if (this._connectionID !== cid) {
          if (callback) callback({ message: 'Connection Switched', status: -1 });
          return;
        }

        if (callback) callback(err);
      });

    return computedID;
  }


  /**
   * Load a single entity by id (ways and relations use the `/full` call to include
   * nodes and members).  Parent relations are not included, see `loadEntityRelationsAsync`.
   * GET /api/0.6/node/#id
   * GET /api/0.6/[way|relation]/#id/full
   * @param   entityID - the entityID to load
   * @return  Promise resolved with the parsed api results
   */
  public loadEntityAsync(entityID: EntityID): Promise<ParserResult> {
    const type = OsmEntity.type(entityID);    // 'node', 'way', 'relation'
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set<ParserDataType>(['node', 'way', 'relation']) };
    const full = (type !== 'node' ? '/full' : '');
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          resolve(results!);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}${full}${json}`, errback, options);
    });
  }


  /**
   * Load a single entity with a specific version
   * GET /api/0.6/[node|way|relation]/#id/#version
   * @param   entityID - the entityID to load
   * @param   version - version to load
   * @return  Promise resolved with the parsed api results
   */
  public loadEntityVersionAsync(entityID: EntityID, version: string | number): Promise<ParserResult> {
    const type = OsmEntity.type(entityID);    // 'node', 'way', 'relation'
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set<ParserDataType>(['node', 'way', 'relation']) };
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          resolve(results!);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}/${version}${json}`, errback, options);
    });
  }


  /**
   * Load the parent relations of a single entity with the given id.
   * (i.e. relations in which the given entity is used).
   * GET /api/0.6/[node|way|relation]/#id/relations
   * @param   entityID - the entityID to get parent relations
   * @return  Promise resolved with the parsed api results
   */
  public loadEntityRelationsAsync(entityID: EntityID): Promise<ParserResult> {
    const type = OsmEntity.type(entityID);
    const osmID = OsmEntity.toOSM(entityID);
    const options = { skipSeen: false, filter: new Set<ParserDataType>(['relation']) };
    const json = (this.preferJSON ? '.json' : '');

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          resolve(results!);
        }
      };

      this.loadFromAPI(`/api/0.6/${type}/${osmID}/relations${json}`, errback, options);
    });
  }


  /**
   * Load multiple elements in chunks.
   * Unlike `loadEntityAsync`, child nodes and members are not fetched automatically.
   * GET /api/0.6/[nodes|ways|relations]?#parameters
   * @param   entityIDs - the entityIDs to load
   * @return  Promise resolved with an Array of entity details
   */
  public loadMultipleAsync(entityIDs: EntityID[]): Promise<ParsedData[]> {
    const loaded: ParsedData[] = [];
    const toLoad = {} as Record<EntityType, Set<string>>;

    // Group entityIDs into sets by their type
    for (const entityID of entityIDs) {
      const k = OsmEntity.type(entityID) as EntityType;
      if (!k) continue;
      let set = toLoad[k];
      if (!set) {
        set = toLoad[k] = new Set<string>();
      }
      set.add(OsmEntity.toOSM(entityID));  // just the number
    }

    const promises: Promise<void>[] = [];
    for (const k of ['node', 'way', 'relation'] as const) {
      const set = toLoad[k];
      if (!set) continue;

      const chunks = utilArrayChunk(Array.from(set), 150);
      for (const chunk of chunks) {
        const prom = new Promise<void>(resolve => {
          const errback = (err: any, results?: ParserResult): void => {
            // ignore errors here
            loaded.push(...(results?.data || []));
            resolve();
          };

          const type = k + 's';   // nodes, ways, relations
          const options = { skipSeen: false, filter: new Set<ParserDataType>([k]) };
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
   * Load a given user by id.
   * Note that this call requires an auth connection and will return a cached result if unauth.
   * GET /api/0.6/user/#id
   * @param   userID - the userID to load
   * @return  Promise resolved with the user details
   */
  public loadUserAsync(userID: string | number): Promise<any> {
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
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          const user = (results?.data || []).find(d => (d as any).id === uid);
          if (user) {
            this._userCache.user[uid] = user;
            resolve(user);
          } else {
            reject(new Error(`User ${uid} not found`));
          }
        }
      };

      const options = { skipSeen: false, filter: new Set<ParserDataType>(['user']) };
      const json = (this.preferJSON ? '.json' : '');
      this.loadFromAPI(`/api/0.6/user/${uid}${json}`, errback, options);
    });
  }


  /**
   * Load multiple users in chunks.
   * Note that this call requires an auth connection and will return a cached result if unauth.
   * GET /api/0.6/users?users=#id1,#id2,...,#idn
   * @param   userIDs - the userIDs to load
   * @return  Promise resolved with an Array of user details
   */
  public loadUsersAsync(userIDs: (string | number)[]): Promise<any[]> {
    const loaded: any[] = [];
    const toLoad: string[] = [];

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

    const options = { skipSeen: false, filter: new Set<ParserDataType>(['user']) };
    const json = (this.preferJSON ? '.json' : '');
    const chunks = utilArrayChunk(toLoad, 150);

    const promises: Promise<void>[] = [];
    for (const chunk of chunks) {
      const prom = new Promise<void>(resolve => {
        const errback = (err: any, results?: ParserResult): void => {
          // ignore errors here
          for (const user of (results?.data || [])) {
            this._userCache.user[(user as any).id] = user;
            loaded.push(user);
          }
          resolve();
        };

        this.loadFromAPI(`/api/0.6/users${json}?users=` + chunk.join(), errback, options);
      });
      promises.push(prom);
    }

    return Promise.all(promises)
      .then(() => loaded);
  }


  /**
   * Get the details of the logged-in user.
   * GET /api/0.6/user/details
   * @return  Promise resolved with the current logged in user's details
   */
  public getUserDetailsAsync(): Promise<any> {
    if (!this.authenticated()) {
      this._userDetails = null;
      return Promise.reject(new Error('Not logged in'));
    }

    if (this._userDetails) {
      return Promise.resolve(this._userDetails);
    }

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          this._userDetails = results!.data[0];
          resolve(this._userDetails);
        }
      };

      const options = { skipSeen: false, filter: new Set<ParserDataType>(['user']) };
      const json = (this.preferJSON ? '.json' : '');

      this.loadFromAPI(`/api/0.6/user/details${json}`, errback, options);
    });
  }


  /**
   * Get the stored preferences for the logged in user.
   * GET /api/0.6/user/preferences
   * @return  Promise resolved with the current logged in user's preferences
   */
  public getUserPreferencesAsync(): Promise<any> {
    if (!this.authenticated()) {
      this._userPreferences = null;
      return Promise.reject(new Error('Not logged in'));
    }
    if (this._userPreferences) {
      return Promise.resolve(this._userPreferences);
    }

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else {
          this._userPreferences = results!.data[0];
          resolve(this._userPreferences);
        }
      };

      const options = { skipSeen: false, filter: new Set<ParserDataType>(['preferences']) };
      const json = (this.preferJSON ? '.json' : '');

      this.loadFromAPI(
        `/api/0.6/user/preferences${json}`,
        errback,
        options
      );
    });
  }


  /**
   * Get the previous changesets for the logged in user.
   * GET /api/0.6/changesets?user=#id
   * @return  Promise resolved with the current logged in user's previous changesets
   */
  public getUserChangesetsAsync(): Promise<any[]> {
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
          const errback = (err: any, results?: ParserResult): void => {
            if (err) {
              reject(err);
            } else {
              this._userChangesets = results!.data;
              resolve(this._userChangesets);
            }
          };

          const options = { skipSeen: false, filter: new Set<ParserDataType>(['changeset']) };
          const json = (this.preferJSON ? '.json' : '');
          this.loadFromAPI(`/api/0.6/changesets${json}?user=${user.id}`, errback, options);
        });
      });
  }


  /**
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
   * @return  Promise resolved with the API status information
   */
  public getCapabilitiesAsync(): Promise<CapabilitiesResult> {
    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err?.message === 'Connection Switched') {  // If connection was just switched,
          this._apiStatus = null;                      // reset cached status and try again
          this._rateLimit = null;
          this.getCapabilitiesAsync().then(resolve, reject);

        } else if (err) {
          this._apiStatus = 'error';
          reject(err);

        } else {
          const api = results!.data.find(d => d.type === 'api') as ParsedApi | undefined;
          const policy = results!.data.find(d => d.type === 'policy') as ParsedPolicy | undefined;

          // Set status - 'online', 'readonly', or 'offline'
          this._apiStatus = this._rateLimit ? 'ratelimit' : ((api as any)?.status?.api || 'online');

          // Update max nodes per way
          const maxWayNodes = (api as any)?.waynodes?.maximum || 2000;
          if (maxWayNodes && isFinite(maxWayNodes)) {
            this._maxWayNodes = maxWayNodes;
          }

          // Update imagery blocklists
          const blocklist = policy?.imagery?.blacklist || [];
          if (blocklist.length) {
            this._imageryBlocklists = blocklist;
          }

          resolve({ osm: results!.osm, api: api, policy: policy });
        }
      };

      const options = { skipSeen: false, filter: new Set<ParserDataType>(['api', 'policy']) };
      const json = (this.preferJSON ? '.json' : '');
      this.loadFromAPI(
        this._apiroot + `/api/capabilities${json}`,  // note, no '0.6'
        errback,
        options
      );
    });
  }


  /**
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
  public reloadApiStatus(): void {
    const startStatus = this._apiStatus;
    this.getCapabilitiesAsync()
      .then(() => {
        const currStatus = this._apiStatus;
        if (currStatus !== startStatus) {
          this.emit('apistatuschange', currStatus);
        }
      });
  }

  /**
   * Uses `throttle` to checking the API status too frequently
   */
  public deferredReloadApiStatus(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler.throttle('osm-reload-api-status', () => this.reloadApiStatus(), { ms: 500 });
    } else {
      this.reloadApiStatus();
    }
  }


  /**
   * Create a new changeset on the OSM API, or reuse an existing open one.
   * PUT /api/0.6/changeset/create
   * @param  changeset - the changeset to create
   * @param  callback - errback-style callback called with the updated changeset
   */
  public createChangeset(changeset: OsmChangeset, callback: Errback): void {
    if (this._isChangesetInflight()) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    }

    const context = this.context;
    const network = context.systems.network!;

    const createdChangeset = (err: any, changesetID?: any): void => {
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
    const requestID = 'osm-changeset-create' as RequestID;
    const resource = this._apiroot + '/api/0.6/changeset/create';

    network.fetch<any>(resource, {
      requestID,
      method: 'PUT',
      headers: { 'Content-Type': 'text/xml' },
      body: JXON.stringify(changeset.asJXON()),
      mainThread: true
    })
      .then((result: any) => errback(null, result))
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });
  }


  /**
   * Upload entity changes (creates, updates, deletes) to an open changeset.
   * POST /api/0.6/changeset/#id/upload
   * @param  changeset - the open changeset to upload to
   * @param  changes - the entity changes to upload
   * @param  callback - errback-style callback called when the upload completes
   */
  public uploadChangeset(changeset: OsmChangeset, changes: OsmChanges, callback: Errback): void {
    if (this._isChangesetInflight()) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    } else if (changeset.id !== this._changeset.openChangesetID) {
      // the given changeset is not open, or a different changeset is open?
      return callback({ message: 'Changeset ID mismatch', status: -4 });
    }

    const context = this.context;
    const editor = context.systems.editor;
    const network = context.systems.network!;

    const uploadedChangeset = (err: any, /*result*/): void => {
      // we do get a changeset diff result, but we don't currently use it for anything
      callback(err, changeset);
    };

    const errback = this._wrapcb(uploadedChangeset);
    const requestID = `osm-changeset-upload-${changeset.id}` as RequestID;
    const resource = this._apiroot + `/api/0.6/changeset/${changeset.id}/upload`;

    // Attempt to prevent user from creating duplicate changes - see iD#5200
    // Some users will refresh their tab as soon as the changeset is inflight.
    // We don't want to offer to restore these same changes when their browser refreshes.
    editor?.clearBackup();

    network.fetch<any>(resource, {
      requestID,
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: JXON.stringify(changeset.osmChangeJXON(changes)),
      mainThread: true
    })
      .then((result: any) => errback(null, result))
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });
  }


  /**
   * Close an open changeset on the OSM API.
   * PUT /api/0.6/changeset/#id/close
   * @param  changeset - the changeset to close
   * @param  callback - errback-style callback called when the close completes
   */
  public closeChangeset(changeset: OsmChangeset, callback: Errback): void {
    if (this._isChangesetInflight()) {
      return callback({ message: 'Changeset already inflight', status: -2 });
    } else if (!this.authenticated()) {
      return callback({ message: 'Not Authenticated', status: -3 });
    } else if (changeset.id !== this._changeset.openChangesetID) {
      // the given changeset is not open, or a different changeset is open?
      return callback({ message: 'Changeset ID mismatch', status: -4 });
    }

    const context = this.context;
    const network = context.systems.network!;

    const closedChangeset = (err: any, /*result*/): void => {
      this._changeset.openChangesetID = null;
      // there is no result to this call
      callback(err, changeset);
    };

    const errback = this._wrapcb(closedChangeset);
    const requestID = `osm-changeset-close-${changeset.id}` as RequestID;
    const resource = this._apiroot + `/api/0.6/changeset/${changeset.id}/close`;

    // Note that `changeset/#id/close` returns an empty document with `text/html` content type.
    // We use `fetchRaw` here because otherwise `utilFetchResponse` will try handling it,
    // and the xmldom parser will raise a "missing root element" error on the empty document.
    network.fetchRaw(resource, { requestID, method: 'PUT' })
      .then((result: any) => errback(null, result))
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });
  }


  /**
   * Convenience method that chains together create, upload, and close a changeset.
   * PUT /api/0.6/changeset/create
   * POST /api/0.6/changeset/#id/upload
   * PUT /api/0.6/changeset/#id/close
   * @param  changeset - the changeset to send
   * @param  changes - the entity changes to upload
   * @param  callback - errback-style callback called when the full send cycle completes
   */
  public sendChangeset(changeset: OsmChangeset, changes: OsmChanges, callback: Errback): void {
    const cid = this._connectionID;

    this.createChangeset(changeset, (err: any, updated: OsmChangeset) => {
      changeset = updated;
      if (err) { return callback(err, changeset); }

      this.uploadChangeset(changeset, changes, (err: any, updated: OsmChangeset) => {
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


  /**
   * This will establish a rate limit for the given duration in seconds.
   * If a rate limit already exists, extend the time if needed.
   * @param  seconds - seconds to impose the rate limit (default 10 sec)
   * @return rate limit info, or `null` if `seconds` is junk
   */
  public setRateLimit(seconds: number = 10): RateLimitInfo | null {
    // If `seconds` makes no sense, just return the existing rate limit, if any..
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return this._rateLimit;
    }

    // If rate limit already exists for a longer duration, do nothing..
    if (this._rateLimit && this._rateLimit.remaining >= seconds) {
      return this._rateLimit;
    }

    const context = this.context;
    const network = context.systems.network!;

    // Stop loading tiles, and cancel any inflight tile/note requests
    this._noteCache.toLoad.clear();
    network.abortMatching(id => id.startsWith('osm-data-tile') || id.startsWith('osm-note'));

    return this._rateLimit = {
      start: Math.floor(Date.now() / 1000),  // epoch seconds
      duration: seconds,                     // retry-after seconds
      remaining: seconds,
      elapsed: 0
    };
  }


  /**
   * If there is currently a rate limit, return the information about it.
   * This will also cancel the rate limit if we detect that it has expired.
   * @return  rate limit info, or `null` if no current rate limit
   */
  public getRateLimit(): RateLimitInfo | null {
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


  /**
   * Load OSM entity data from the API in tiles covering the current viewport.
   * Aborts any in-flight requests for tiles no longer visible and issues new ones.
   * GET /api/0.6/map?bbox=
   * @param  callback - optional errback-style callback called per-tile with results
   */
  public loadTiles(callback?: Errback | null): void {
    if (this._paused || this.getRateLimit()) {
      if (callback) callback(null, { data: [] });
      return;
    }

    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    const cache = this._tileCache;
    if (cache.lastv === viewport.v) {  // exit early if the view is unchanged
      if (callback) callback(null, { data: [] });
      return;
    }
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = (this._tiler.zoomRange(this._tileZoom) as Tiler).getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const prefix = `osm-data-tile`;
    const neededIDs = new Set<RequestID>(tiles.map(tile => `${prefix}-${tile.id}`));
    network.abortMatching(id => id.startsWith(prefix) && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      this.loadTile(tile, callback);
    }
  }


  /**
   * Load a single data tile from the API.
   * Skips tiles that are already loaded, in-flight, or cover a blocked region.
   * GET /api/0.6/map?bbox=
   * @param  tile - the tile to load
   * @param  callback - optional errback-style callback called with the results
   */
  public loadTile(tile: Tile, callback?: Errback | null): void {
    if (this._paused || this.getRateLimit()) {
      if (callback) callback(null, { data: [] });
      return;
    }

    const context = this.context;
    const gfx = context.systems.gfx;
    const locations = context.systems.locations;
    const network = context.systems.network!;

    const tileID = tile.id;
    const prefix = `osm-data-tile`;
    const requestID = `${prefix}-${tileID}`;
    if (network.isCompleted(requestID) || network.isInflight(requestID)) return;

    if (locations) {
      // Skip if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const isBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (isBlocked) {
        network.markCompleted(requestID);  // don't try again (blocked region)
        if (callback) callback(null, { data: [] });
        return;
      }
    }

    const done = (err: any, results?: ParserResult): void => {
      if (err) {
        // The settled request was recorded in `completed` by NetworkSystem.
        // Forget it so that errored tiles can be retried later.
        network.forget(requestID);
      } else {
        gfx?.deferredRedraw();
      }

      if (callback) {
        callback(err, Object.assign({}, results, { tile: tile }));
      }
    };

    const options = { skipSeen: true };
    const json = (this.preferJSON ? '.json' : '');
    const path = `/api/0.6/map${json}?bbox=` + tile.wgs84Extent.toParam();

    this.loadFromAPI(path, done, options, requestID);
  }


  /**
   * Return a tile that covers the given location.
   * @param   loc - the search location (WGS84 [lon,lat])
   * @return  Tile object
   */
  public getTileAtLoc(loc: Vec2): Tile {
    const coord = projWgs84ToWorld(loc);

    const z = Math.round(this._tileZoom);
    const pow2z = 2 ** z;
    const worldScale = pow2z / WORLD_SIZE;
    const tileScale = WORLD_SIZE / pow2z;
    const min = 0;
    const max = pow2z - 1;

    const x = numClamp(Math.floor(coord[0] * worldScale), min, max);
    const y = numClamp(Math.floor(coord[1] * worldScale), min, max);

    // The tile bounds in world coordinates
    const tileMin: Vec2 = [x * tileScale, y * tileScale];
    const tileMax: Vec2 = [(x + 1) * tileScale, (y + 1) * tileScale];
    const tileExtent = new Extent(tileMin, tileMax);

    // back to lon/lat
    const wgs84Min = projWorldToWgs84([tileMin[0], tileMax[1]]);  // bottom left
    const wgs84Max = projWorldToWgs84([tileMax[0], tileMin[1]]);  // top right
    const wgs84Extent = new Extent(wgs84Min, wgs84Max);
    const xyz: Vec3 = [x, y, z];

    const tile: Tile = {
      id: xyz.toString(),
      xyz: xyz,
      wgs84Extent: wgs84Extent,
      worldExtent: tileExtent,
      isVisible: false
    };

    return tile;
  }


  /**
   * Is OSM data loaded at the given [lon,lat] coordinate?
   * @param   loc - the search location (WGS84 [lon,lat])
   * @return  `true` if data exists there, `false` if not
   */
  public isDataLoaded(loc: Vec2): boolean {
    const network = this.context.systems.network!;

    const tile = this.getTileAtLoc(loc);
    const prefix = `osm-data-tile`;
    const requestID = `${prefix}-${tile.id}`;

    return network.isCompleted(requestID);
  }


  /**
   * Queue loading the tile that covers the given `loc`.
   * @param   loc - the search location (WGS84 [lon,lat])
   * @param   callback - errback-style callback function to call with results
   */
  public loadTileAtLoc(loc: Vec2, callback?: Errback | null): void {
    if (this._paused || this.getRateLimit()) {
      if (callback) callback(null, { data: [] });
      return;
    }

    // Back off if the queue is filling up.. re iD#6417
    // (Currently `loadTileAtLoc` requests are considered low priority - used by operations to
    // let users safely edit geometries which extend to unloaded tiles.  We can drop some.)
    const network = this.context.systems.network!;
    if (network.numQueued > 50) {
      if (callback) callback(null, { data: [] });
      return;
    }

    const tile = this.getTileAtLoc(loc);
    this.loadTile(tile, callback);
  }


  /**
   * Load OSM note data from the API in tiles covering the current viewport.
   * Aborts any in-flight requests for tiles no longer visible and issues new ones.
   * @param  noteOptions - note options
   */
  public loadNotes(noteOptions?: NoteOptions): void {
    if (this._paused || this.getRateLimit()) return;

    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    const cache = this._noteCache;
    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = (this._tiler.zoomRange(this._noteZoom) as Tiler).getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const prefix = `osm-note-tile`;
    const neededIDs = new Set<RequestID>(tiles.map(tile => `${prefix}-${tile.id}`));
    network.abortMatching(id => id.startsWith(prefix) && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      this.loadNoteTile(tile, noteOptions);
    }
  }


  /**
   * Load a single note tile from the API.
   * GET /api/0.6/notes?bbox=
   * @param  tile - the tile to load
   * @param  noteOptions - note options
   */
  public loadNoteTile(tile: Tile, noteOptions?: NoteOptions): void {
    if (this._paused || this.getRateLimit()) return;

    noteOptions = Object.assign({ limit: 10000, closed: 7 }, noteOptions);

    const context = this.context;
    const gfx = context.systems.gfx;
    const locations = context.systems.locations;
    const network = context.systems.network!;

    const tileID = tile.id;
    const prefix = `osm-note-tile`;
    const requestID = `${prefix}-${tileID}`;
    if (network.isCompleted(requestID) || network.isInflight(requestID)) return;

    if (locations) {
      // Skip if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const isBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (isBlocked) {
        network.markCompleted(requestID);  // don't try again (blocked region)
        return;
      }
    }

    const done = (err: any, results?: ParserResult): void => {
      if (err) {
        network.forget(requestID);   // allow retry on error
        return;
      }
      if (results) {
        for (const props of (results.data ?? [])) {
          this._cacheNote(props);
        }
        gfx?.deferredRedraw();
      }
    };

    const json = (this.preferJSON ? '.json' : '');
    const options = { skipSeen: true, filter: new Set<ParserDataType>(['note']) };
    const path = `/api/0.6/notes${json}?limit=` + noteOptions.limit + '&closed='
      + noteOptions.closed + '&bbox=' + tile.wgs84Extent.toParam();

    this.loadFromAPI(path, done, options, requestID);
  }


  /**
   * Load a single note by id.
   * GET /api/0.6/notes/#id
   * @param   id - noteID to get
   * @return  Promise resolved with the note
   */
  public loadNoteAsync(id: string | number): Promise<OsmNote> {
    const context = this.context;
    const spatial = context.systems.spatial!;
    const gfx = context.systems.gfx;

    const noteID = id.toString();
    let note = spatial.getItem<OsmNote>('osm-notes', noteID);
    if (note) {
      return Promise.resolve(note);
    }

    return new Promise((resolve, reject) => {
      const errback = (err: any, results?: ParserResult): void => {
        if (err) {
          reject(err);
        } else if (Array.isArray(results?.data)) {
          note = this._cacheNote(results!.data[0]);
          gfx?.deferredRedraw();
          resolve(note!);
        } else {
          reject(new Error(`Note ${noteID} not found`));
        }
      };

      const options = { skipSeen: false, filter: new Set<ParserDataType>(['note']) };
      const json = (this.preferJSON ? '.json' : '');
      const path = `/api/0.6/notes/${noteID}${json}`;
      this.loadFromAPI(path, errback, options);
    });
  }


  /**
   * Create a new note on the OSM API at the note's location.
   * POST /api/0.6/notes?params
   * @param  note - the note to create (must have `loc` and `newComment`)
   * @param  callback - errback-style callback called with the created note
   */
  public postNoteCreate(note: OsmNote, callback: Errback): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const network = context.systems.network!;
    const noteID = note.id;
    const requestID = `osm-note-post-create-${noteID}`;

    if (network.isInflight(requestID)) {
      callback?.({ message: 'Note update already inflight', status: -2 }, note);
      return;
    } else if (!this.authenticated()) {
      callback?.({ message: 'Not Authenticated', status: -3 }, note);
      return;
    } else if (!Array.isArray(note.loc) || !note.props.newComment) {
      callback?.({ message: 'No location or description', status: -4 }, note);
      return;
    }


    const done = (err: any, results?: ParserResult): void => {
      if (err) {
        callback?.(err);
        return;
      } else if (Array.isArray(results?.data)) {
        // We get the updated note back, remove from caches and reparse..
        this.removeNote(note);
        note = this._cacheNote(results!.data[0]);
        gfx?.deferredRedraw();
        callback?.(null, note!);
        return;
      } else {
        callback?.({ message: 'No Response', status: -5 });
        return;
      }
    };

    const parserOptions = { skipSeen: false, filter: new Set<ParserDataType>(['note']) };
    const errback = this._wrapcb(done);
    const resource = this._apiroot + '/api/0.6/notes?' +
      utilQsString({ lon: note.loc[0], lat: note.loc[1], text: note.props.newComment }, false);

    network.fetch<any>(resource, {
      requestID,
      listenerID: 'osmService:fetchAndParse',
      listenerData: { format: 'xml', parserOptions: parserOptions },
      method: 'POST',
      mainThread: true
    })
      .then((result: any) => errback(null, result))
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });
  }


  /**
   * Update an existing note by commenting, closing, or reopening it.
   * POST /api/0.6/notes/#id/comment?text=comment
   * POST /api/0.6/notes/#id/close?text=comment
   * POST /api/0.6/notes/#id/reopen?text=comment
   * @param  note - the note to update
   * @param  newStatus - the desired status ('open' or 'closed'), or unchanged for a comment
   * @param  callback - errback-style callback called with the updated note
   */
  public postNoteUpdate(note: OsmNote, newStatus: string, callback: Errback): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const network = context.systems.network!;

    const cache = this._noteCache;
    const noteID = note.id;
    const requestID = `osm-note-post-update-${noteID}`;

    if (network.isInflight(requestID)) {
      callback?.({ message: 'Note update already inflight', status: -2 }, note);
      return;
    } else if (!this.authenticated()) {
      callback?.({ message: 'Not Authenticated', status: -3 }, note);
      return;
    }

    let action;
    if (note.props.status !== 'closed' && newStatus === 'closed') {
      action = 'close';
    } else if (note.props.status !== 'open' && newStatus === 'open') {
      action = 'reopen';
    } else {
      action = 'comment';
      if (!note.props.newComment) { // when commenting, comment required
        callback?.({ message: 'No description', status: -4 }, note);
        return;
      }
    }

    const done = (err: any, results?: ParserResult): void => {
      if (err) {
        callback?.(err);
        return;
      } else if (Array.isArray(results?.data)) {
        // Update closed note cache - used to populate `closed:note` changeset tag
        if (action === 'close') {
          cache.closed[noteID] = true;
        } else if (action === 'reopen') {
          delete cache.closed[noteID];
        }

        // We get the updated note back, remove from caches and reparse..
        this.removeNote(note);
        note = this._cacheNote(results!.data[0]);
        gfx?.deferredRedraw();
        callback?.(null, note!);
        return;
      } else {
        callback?.({ message: 'No Response', status: -5 });
        return;
      }
    };

    const parserOptions = { skipSeen: false, filter: new Set<ParserDataType>(['note']) };
    const errback = this._wrapcb(done);
    let resource = this._apiroot + `/api/0.6/notes/${noteID}/${action}`;
    if (note.props.newComment) {
      resource += '?' + utilQsString({ text: note.props.newComment }, false);
    }

    network.fetch<any>(resource, {
      requestID,
      listenerID: 'osmService:fetchAndParse',
      listenerData: { format: 'xml', parserOptions: parserOptions },
      method: 'POST',
      mainThread: true
    })
      .then((result: any) => errback(null, result))
      .catch((err: any) => {
        if (err.name === 'AbortError') return;  // ok
        if (err.name === 'FetchError') {
          errback(err);
          return;
        }
      });
  }


  /**
   * Get or set the internal cached data (tiles, notes, users).
   * Used to save/restore state when entering/exiting the walkthrough,
   * and for testing purposes.
   * @param  obj - if provided, replaces the internal caches; if omitted, returns cloned caches
   * @return the cloned caches when getting, or `this` when setting
   */
  public caches(obj?: CachesObject): CachesObject | this {
    /**
     * clone the cache
     * @param source
     */
    function cloneCache(source: Record<string, any>): Record<string, any> {
      const target: Record<string, any> = {};
      for (const [k, v] of Object.entries(source)) {
        if (k === 'note') {
          target.note = {} as Record<string, any>;
          for (const id of Object.keys(v as Record<string, any>)) {
            target.note[id] = new MarkerData((source as any).note[id]);  // clone notes
          }
        } else {
          target[k] = structuredClone(v);  // clone anything else
        }
      }
      return target;
    }

    if (obj === undefined) {
      return {
        tile: cloneCache(this._tileCache),
        note: cloneCache(this._noteCache),
        user: cloneCache(this._userCache)
      } as CachesObject;
    }

    if (obj.tile) {
      this._tileCache = obj.tile;
    }
    if (obj.note) {
      this._noteCache = obj.note;
    }
    if (obj.user) {
      this._userCache = obj.user;
    }

    return this;
  }


  /**
   * Log the current user out, clearing stored credentials and cached user data.
   * Emits an `authchange` event.
   * @return `this` for chaining
   */
  public logout(): this {
    const gfx = this.context.systems.gfx;

    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;
    this._userPreferences = null;
    this._oauth.logout();

    gfx?.immediateRedraw();
    this.emit('authchange');
    return this;
  }


  /**
   * Returns whether the user is currently authenticated with the OSM API
   * @return  `true` if the user is authenticated
   */
  public authenticated(): boolean {
    return this._oauth.authenticated();
  }


  /**
   * Initiate the OAuth2 authentication flow.
   * Opens a popup window for the user to authorize Rapid,
   * then reloads the API status and emits an `authchange` event on success.
   * @param  callback - optional errback-style callback called with the auth result
   */
  public authenticate(callback?: Errback | null): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const l10n = context.systems.l10n;

    const cid = this._connectionID;
    this._rateLimit = null;
    this._userChangesets = null;
    this._userDetails = null;

    const gotResult = (err: any, result?: any): void => {
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
      gfx?.immediateRedraw();
      this.emit('authchange');
      if (callback) callback(err, result);
    };

    // Ensure the locale is correctly set before opening the popup
    const localeCode = l10n?.localeCode || 'en-US';

    this._oauth.options({
      ...this._oauth.options(),
      locale: localeCode
    });
    this._oauth.authenticate(gotResult);
    this._oauth.bringPopupWindowToFront();  // no guarantees, but we can try
  }


  /** Returns all cached notes that are visible in the current viewport
   * @return  Array of visible OSM notes
   */
  public getNotes(): OsmNote[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleItems('osm-notes').map(hit => hit.contents) as OsmNote[];
  }


  /**
   * Get a note with given id from cache
   * @param   dataID
   * @return  the cached note
   */
  public getNote(dataID: string): OsmNote | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getItem<OsmNote>('osm-notes', dataID);
  }


  /**
   * Replace a single item in the cache
   * @param   item to replace
   * @return  the item, or `null` if it couldn't be replaced
   */
  public replaceNote(item: OsmNote): OsmNote | null {
    if (!(item instanceof MarkerData) || !item.id) return null;

    const spatial = this.context.systems.spatial!;
    spatial.replaceData('osm-notes', item);
    return item;
  }


  /**
   * Remove a single item from the cache
   * @param  item to remove
   */
  public removeNote(item: OsmNote): void {
    if (!(item instanceof MarkerData) || !item.id) return;

    const spatial = this.context.systems.spatial!;
    spatial.removeItems('osm-notes', item.id);
  }


  /**
   * Get an array of noteIDs closed during this session.
   * Used to populate `closed:note` changeset tag
   * @return  Array of closed note ids
   */
  public getClosedIDs(): string[] {
    return Object.keys(this._noteCache.closed).sort();
  }


  /** Emits the `authLoading` event (called when the auth popup opens) */
  protected _authLoading(): void {
    this.emit('authLoading');
  }


  /** Emits the `authDone` event (called when the auth popup closes) */
  protected _authDone(): void {
    this.emit('authDone');
  }


  /**
   * Request interceptor that adds the OAuth2 Bearer token to OSM API requests.
   * Registered with NetworkSystem at init time so that all fetch paths
   * (including web workers) receive the correct Authorization header.
   *
   * Uses `oauth.getAccessToken()` — the public API added in osm-auth v3.2.0.
   * @param url - The outgoing request URL
   * @param init - The request init to augment with an Authorization header
   * @return  The (possibly augmented) request init
   */
  protected _authInterceptor(url: string, init: RequestInit): RequestInit {
    if (this._oauth.authenticated() && url.startsWith(this._apiroot)) {
      const accessToken = this._oauth.getAccessToken();
      if (accessToken) {
        const headers = (init.headers ?? {}) as Record<string, string>;
        return { ...init, headers: { ...headers, 'Authorization': `Bearer ${accessToken}` } };
      }
    }
    return init;
  }


  /** Returns true if any changeset operation (create/upload/close) is currently inflight
   * @return  `true` if a changeset operation is inflight
   */
  protected _isChangesetInflight(): boolean {
    const network = this.context.systems.network!;
    return network.hasMatching(id => id.startsWith('osm-changeset-'));
  }


  /**
   * Store the given note in the caches
   * @param   source - the note properties
   * @return  The note
   */
  protected _cacheNote(source: any): OsmNote {
    const context = this.context;
    const spatial = context.systems.spatial!;
    const noteID = source.id;

    let note = spatial.getItem<OsmNote>('osm-notes', noteID);
    if (!note) {
      const loc = spatial.getFreeLoc('osm-notes', source.loc);
      note = new MarkerData<OsmNoteProps>(this.context, {
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
    return note.touch() as OsmNote;
  }


  /**
   * Wraps an API errback in additional guards:
   * - Logs out on 400/401/403 responses (credential issues)
   * - Raises an error if the connection was switched while the call was in-flight
   * @param  callback - the original errback to wrap
   * @return a wrapped errback with the additional checks
   */
  protected _wrapcb(callback: Errback): Errback {
    const cid = this._connectionID;
    return (err: any, results?: any): void => {
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
