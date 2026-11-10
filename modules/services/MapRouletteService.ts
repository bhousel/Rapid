import { AbstractSystem } from '../core/AbstractSystem.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { Extent, geoSphericalDistance, projWgs84ToWorld, Tiler } from '@rapid-sdk/math';
import { utilExtractValues } from '../util/string.ts';

import type { Context } from '../Context.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


/** Properties specific to MapRoulette task markers */
export interface MapRouletteTaskProps extends MarkerProps {
  /** The parent challenge ID for this task */
  parentId: string;
  /** Whether this task is currently visible on the map */
  isVisible: boolean;
  /** Display title for the task */
  title?: string;
  /** Name of the parent challenge */
  parentName?: string;
  /** Challenge description text (may contain Mustache templates) */
  description?: string;
  /** Challenge instruction text (may contain Mustache templates) */
  instruction?: string;
  /** GeoJSON features associated with this task */
  features?: GeoJSON.Feature[];
  /** Numeric status code for the task (e.g. 1 = Fixed) */
  taskStatus?: number;
  /** User comment submitted with the task update */
  comment?: string;
  // MapRoulette auth is turned off: MapRoulette stopped storing API keys in the OSM user preferences
  // and expired the old ones, so Rapid submits without one for now (see "MapRoulette authentication"
  // in `.scratchpad/backlog.md`, and https://community.openstreetmap.org/t/maproulette-security-incident-october-2026).
  // /** API key for authenticating MapRoulette API requests */
  // mapRouletteApiKey?: string;
  /** Geographic coordinates of the task */
  point?: { lng: number; lat: number };
  /** The status the user has picked in the editor, before it's submitted (`''` if none) */
  _status?: number | '';
  /** The comment the user is typing in the editor */
  newComment?: string;
  /** The task ID, as submitted */
  taskId?: string;
  /** The OSM user ID of the user submitting */
  userId?: number;
}

/** A MapRoulette task MarkerData with typed props */
export type MapRouletteTask = MarkerData<MapRouletteTaskProps>;

/** Zoom level used to tile data requests */
const TILEZOOM = 14;
/** Base URL for the MapRoulette REST API v2 */
const MAPROULETTE_API = 'https://maproulette.org/api/v2';


/** Closed task record */
interface ClosedEntry {
  /** ID of the closed task */
  taskID: string;
  /** ID of the challenge the closed task belongs to */
  challengeID: string;
}

/** Challenge data from the MapRoulette API */
interface ChallengeData {
  /** Unique challenge identifier */
  id: string;
  /** Human-readable challenge name */
  name?: string;
  /** Whether the challenge is currently enabled */
  enabled?: boolean;
  /** Whether the challenge has been deleted */
  deleted?: boolean;
  /** Derived visibility flag (enabled and not deleted) */
  isVisible?: boolean;
  /** Instructions for completing the challenge (may contain Mustache templates) */
  instruction?: string;
  /** Description of the challenge */
  description?: string;
  /** Additional API-provided properties */
  [key: string]: any;
}


/**
 * `MapRouletteService` connects to the MapRoulette API to fetch about challenges and tasks.
 * MapRoulette is a microtask platform for performing tasks to improve OpenStreetMap.
 * @see https://wiki.openstreetmap.org/wiki/MapRoulette
 * @see https://maproulette.org/docs/swagger-ui/index.html
 */
export class MapRouletteService extends AbstractSystem {

  /** Whether flying to nearby tasks is enabled */
  public nearbyTaskEnabled: boolean;
  /** The currently selected task */
  public currentTask: MapRouletteTask | null;

  /** Set of challenge IDs to filter tasks by (empty means show all visible) */
  protected _challengeIDs: Set<string>;
  /** Tiler instance for computing tile coverage at the configured zoom level */
  protected _tiler: Tiler;
  /** Last viewport version used for tile loading, to avoid redundant work */
  protected _lastv: number | null;
  /** Cached challenge data keyed by challenge ID */
  protected _challenges: Map<string, ChallengeData>;
  /** ChallengeIDs that we need to load */
  protected _challengeQueue: Set<string>;
  /** Tasks closed during this editing session */
  protected _closed: ClosedEntry[];
  /** The comment posted for each task (by task ID) whose update hasn't finished, so it isn't posted twice */
  protected _postedComments: Map<string, string>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'maproulette';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['map', 'gfx', 'urlhash']);
    this.autoStart = false;

    this._challengeIDs = new Set<string>();  // if we want to filter only certain challengeIDs
    this.nearbyTaskEnabled = false;
    this.currentTask = null;

    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;
    this._lastv = null;
    this._challenges = new Map<string, ChallengeData>();
    this._challengeQueue = new Set<string>();
    this._closed = [];
    this._postedComments = new Map<string, string>();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._mapRouletteChanged = this._mapRouletteChanged.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync())
      .then(() => {
        const context = this.context;
        const gfx = context.systems.gfx;
        const urlhash = context.systems.urlhash;

        // Setup event handlers..
        gfx?.scene?.on('layerchange', this._mapRouletteChanged);
        urlhash?.on('hashchange', this._hashChanged);
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    network.clearMatching(id => id.startsWith('maproulette-') || id.includes(MAPROULETTE_API));
    spatial.clearCache('maproulette');

    this._lastv = null;
    this._challenges.clear();
    this._challengeQueue.clear();
    this._closed = [];
    this._postedComments.clear();

    return Promise.resolve();
  }


  /**
   * set/get the challengeIDs (as a string of comma-separated values)
   * @return  Comma-separated string of active challenge IDs
   */
  public get challengeIDs(): string {
    return [...this._challengeIDs].join(',');
  }

  /** Parses comma-separated challenge IDs (numeric), clears non-numeric values, and triggers a redraw.
   * @param ids - Comma-separated string of numeric challenge IDs
   */
  public set challengeIDs(ids: string) {
    const str = ids.toString();
    const vals = str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Keep only values that are numeric, reject things like NaN, null, Infinity
    this._challengeIDs.clear();
    for (const val of vals) {
      const num = +val;
      if (Number.isFinite(num)) {
        this._challengeIDs.add(val);  // keep the string
      }
    }
    const gfx = this.context.systems.gfx;
    gfx?.immediateRedraw();
    this._mapRouletteChanged();
  }


  /**
   * Get already loaded data that appears in the current map view
   * @return Array of data
   */
  public getData(): MapRouletteTask[] {
    const spatial = this.context.systems.spatial!;

    return (spatial.getVisibleItems('maproulette')
      .map(hit => hit.contents) as MapRouletteTask[])
      .filter(task => {
        if (this._challengeIDs.size) {
          return this._challengeIDs.has(task.props.parentId as string);  // ignore isVisible if it's in the list
        } else {
          return task.props.isVisible;
        }
      });
  }


  /**
   * Returns a cached MapRoulette task by ID.
   * @param dataID - The task's data ID
   * @return The task with that id, or `undefined` if not found
   */
  public getTask(dataID: DataID): MapRouletteTask | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getItem<MapRouletteTask>('maproulette', dataID);
  }


  /**
   * Returns a cached MapRoulette challenge by ID.
   * @param challengeID - The challenge ID
   * @return The challenge with that id, or `undefined` if not found
   */
  public getChallenge(challengeID: string): ChallengeData | undefined {
    return this._challenges.get(challengeID);
  }


  /**
   * Schedule any data requests needed to cover the current map view
   */
  public loadTiles(): void {
    if (this._paused) return;

    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    if (this._lastv === viewport.v) return;  // exit early if the view is unchanged
    this._lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(tiles.map(tile => `maproulette-tile-${tile.id}`));
    network.abortMatching(id => id.startsWith('maproulette-tile') && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      this.loadTile(tile);
    }
  }


  /**
   * Load a single tile of data.
   * @param tile - Tile to load
   */
  public loadTile(tile: Tile): void {
    const context = this.context;
    const network = context.systems.network!;

    const requestID = `maproulette-tile-${tile.id}`;
    if (network.isCompleted(requestID) || network.isInflight(requestID)) return;

    const extent = tile.wgs84Extent;
    const bbox = extent.rectangle().join('/');  // minX/minY/maxX/maxY
    const url = `${MAPROULETTE_API}/tasks/box/${bbox}`;

    network.fetch<any>(url, { requestID })
      .then(data => {
        for (const props of (data ?? [])) {
          this._cacheTask(props);
        }
        this._drainChallengeQueue();   // call this sometimes
      })
      .catch(err => {
        if (err.name === 'AbortError') return;   // ok
        console.error(err);  // eslint-disable-line
      });
  }


  /**
   * Get challenge details for challenges in the queue
   */
  protected _drainChallengeQueue(): void {
    if (this._paused) return;

    const context = this.context;
    const gfx = context.systems.gfx;

    for (const challengeID of this._challengeQueue) {
      this._challengeQueue.delete(challengeID);
      this.loadChallengeAsync(challengeID);
    }
    gfx?.deferredRedraw();
  }


  /**
   * This loads the challenge details and updates existing tasks as needed.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Challenge/read
   * @param challengeID  - the challengeID to load
   * @return Promise resolved with the challenge
   */
  public loadChallengeAsync(challengeID: string): Promise<ChallengeData> {
    const challenge = this._challenges.get(challengeID);
    if (challenge) return Promise.resolve(challenge);  // done already

    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    const url = `${MAPROULETTE_API}/challenge/${challengeID}`;
    const requestID = `maproulette-challenge-${challengeID}`;

    return network.fetch<any>(url, { requestID })
      .then(challenge => {
        challenge.id = challenge.id.toString();    // force to string
        challenge.isVisible = challenge.enabled && !challenge.deleted;
        challenge.instruction ??= '';
        challenge.description ??= '';
        this._challenges.set(challengeID, challenge);

        // Update task details (as new tasks: data isn't changed in place)
        const toUpdate = [];
        const allTasks = spatial.getAllItems<MapRouletteTask>('maproulette');
        for (const task of allTasks) {
          if (task.props.parentId !== challengeID) continue;
          if (task.props.instruction !== undefined) continue;   // done already

          toUpdate.push(task.update({
            isVisible: challenge.isVisible,
            instruction: challenge.instruction,
            description: challenge.description
          }));
        }
        spatial.replaceData('maproulette', toUpdate);

        return challenge;
      })
      .catch(err => {
        if (err.name === 'AbortError') return;   // ok
        console.error(err);  // eslint-disable-line
      });
  }


  /**
   * The task markers that we fetch from the bounding box query do not include all the details.
   * This makes sure that we've also fetched the full challenge and task details.
   * @param task
   * @return Promise resolved with the task
   */
  public loadCompleteTaskAsync(task: MapRouletteTask): Promise<MapRouletteTask> {
    const challengeID = task.props.parentId;
    return this.loadChallengeAsync(challengeID)
      .then(() => this.loadTaskAsync(task));
  }


  /**
   * This loads the full task details if needed, and updates the task marker.
   * The important detail here is the properties stored in the task's geojson.
   * Those properties are used to replace the Mustache tags in the challenge.instruction/.description.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Task/read
   * @param task
   * @return Promise resolved when we've fetched the task details
   */
  public loadTaskAsync(task: MapRouletteTask): Promise<MapRouletteTask> {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    // The cached task may be newer than the one given (data isn't changed in place)
    const cached = spatial.getItem<MapRouletteTask>('maproulette', task.id) ?? task;
    if (cached.props.features !== undefined) return Promise.resolve(cached);  // already done

    const url = `${MAPROULETTE_API}/task/${task.id}`;
    const requestID = `maproulette-task-${task.id}`;

    return network.fetch<any>(url, { requestID })
      .then(data => {
        // The task as it is now (the challenge may have updated it), with its details
        const current = spatial.getItem<MapRouletteTask>('maproulette', task.id) ?? task;
        const updated = current.update({ features: data?.geometries?.features || [] });
        spatial.replaceData('maproulette', updated);
        return updated;
      });
  }


  /**
   * Posts a status update (and optional comment) for a MapRoulette task.
   * @param task - The task to update
   * @param callback - Optional errback invoked when the update completes
   */
  public postUpdate(task: MapRouletteTask, callback?: (err: string | null, task?: MapRouletteTask) => void): void {
    const network = this.context.systems.network!;
    const taskID = task.id;
    const challengeID = task.props.parentId;
    const taskStatus = task.props.taskStatus;
    const taskComment = task.props.comment;
    // const apikey = task.props.mapRouletteApiKey;   // MapRoulette auth is turned off (see `mapRouletteApiKey`)

    const commentID = `maproulette-comment-${taskID}`;
    const updateTaskUrl = `${MAPROULETTE_API}/task/${taskID}/${taskStatus}`;
    const releaseTaskUrl = `${MAPROULETTE_API}/task/${taskID}/release`;
    const updateKey = `maproulette-update-${taskID}`;
    const releaseKey = `maproulette-release-${taskID}`;

    // Submitting again while this task's update is still being sent does nothing.
    // (The comment usually finishes first, and it would be posted again.)
    if (network.isInflight(commentID) || network.isInflight(updateKey) || network.isInflight(releaseKey)) return;

    // A comment is optional, but if we have one, POST it..
    // (Not if it was posted already: the user submits again after the status update failed.)
    if (taskComment && this._postedComments.get(taskID) !== taskComment) {
      this._postedComments.set(taskID, taskComment);
      network.fetch<any>(`${MAPROULETTE_API}/task/${taskID}/comment`, {
        requestID: commentID,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // 'apiKey': apikey as string
        },
        body: JSON.stringify({ actionId: 2, comment: taskComment })
      })
      .catch(err => {
        if (err.name === 'AbortError') return;  // ok
        this._postedComments.delete(taskID);   // not posted, so submitting again tries it again
        console.error(err);    // eslint-disable-line no-console
      });
    }

    // update the status and release the task
    network.fetch<any>(updateTaskUrl, {
      requestID: updateKey,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
        // 'apiKey': apikey as string
      }
    })
    .then(() => {
      return network.fetch<any>(releaseTaskUrl, {
        requestID: releaseKey
        // headers: {
        //   'apiKey': apikey as string
        // }
      });
    })
    .then(() => {
      // All requests completed successfully
      if (taskStatus === 1) {  // only counts if the use chose "I Fixed It".
        this._closed.push({ taskID, challengeID });
      }
      this._postedComments.delete(taskID);
      this.removeItem(task);
      this.context.enter('browse');
      if (callback) callback(null, task);
    })
    .catch(err => {
      if (err.name === 'AbortError') return;  // ok
      console.error(err);    // eslint-disable-line no-console
      if (callback) callback(err.message);
    });
  }


  /**
   * Replace a single item in the cache
   * @param item - item to replace
   * @return the item, or `null` if it couldn't be replaced
   */
  public replaceItem(item: MapRouletteTask): MapRouletteTask | null {
    if (!(item instanceof MarkerData) || !item.id) return null;

    const spatial = this.context.systems.spatial!;
    spatial.replaceData('maproulette', item);
    return item;
  }


  /**
   * Remove a single item from the cache
   * @param item - item to remove
   */
  public removeItem(item: MapRouletteTask): void {
    if (!(item instanceof MarkerData) || !item.id) return;

    const spatial = this.context.systems.spatial!;
    spatial.removeItems('maproulette', item.id);
  }


  /**
   * Get details about all tasks closed in this session
   * @return Array of closed task entries
   */
  public getClosed(): ClosedEntry[] {
    return this._closed;
  }


  /**
   * For a given task, selects the next most nearby task that is available
   * and belongs to the same challenge as the current task.
   * @param task - The current task
   */
  public flyToNearbyTask(task: MapRouletteTask): void {
    if (!this.nearbyTaskEnabled) return;

    const context = this.context;
    const map = context.systems.map;
    const spatial = context.systems.spatial!;

    const currCoord = task.geoms.parts[0].world?.coords as Vec2;  // Current task world coordinate
    if (!currCoord) return;

    const extent = new Extent(task.loc).padByMeters(5000);   // search up to 5km
    // Convert the WGS84 extent to a world-coordinate box.
    const bb = extent.bbox();
    const [ax, ay] = projWgs84ToWorld([bb.minX, bb.minY]);
    const [bx, by] = projWgs84ToWorld([bb.maxX, bb.maxY]);
    const search = {
      minX: Math.min(ax, bx),
      minY: Math.min(ay, by),
      maxX: Math.max(ax, bx),
      maxY: Math.max(ay, by)
    };

    const hits = spatial.getItemsAtBox('maproulette', search)
      .map(hit => hit.contents as MarkerData<MapRouletteTaskProps>);

    const nearby = [];
    for (const other of hits) {
      if (other.id === task.id) continue;   // skip self
      if (other.props.parentId !== task.props.parentId) continue;

      const otherStatus = other.props.taskStatus ?? 0;
      if (otherStatus !== 0) continue;   // task must be available

      const otherCoord = other.geoms.parts[0].world?.coords as Vec2;  // Other task world coordinate
      if (!otherCoord) continue;

      nearby.push({
        task: other,
        dist: geoSphericalDistance(currCoord, otherCoord)
      });
    }

    if (!nearby.length) return;

    nearby.sort((a, b) => a.dist - b.dist);
    const other = nearby[0]!.task;
    if (other.loc) {
      map?.centerEase(other.loc);
    }

    this.currentTask = other;
    context.enter('select', { selection: [other.dataID] });
  }


  /**
   * Returns the URL for user to visit for information about the task and challenge.
   * @param task
   * @return the url
   */
  public itemURL(task: MapRouletteTask): string {
    const challengeID = task.props.parentId;
    return `https://maproulette.org/challenge/${challengeID}/task/${task.id}`;
  }


  /**
   * Store the given task in the cache
   * @param props - the task properties
   * @return The task
   */
  protected _cacheTask(props: Record<string, any>): MapRouletteTask {
    const context = this.context;
    const spatial = context.systems.spatial!;

    const taskID = props.id.toString();
    const challengeID = props.parentId.toString();

    let task = spatial.getItem<MapRouletteTask>('maproulette', taskID);
    if (task) return task;  // seen it already

    // Have we seen this challenge before?
    const challenge = this._challenges.get(challengeID);
    if (!challenge) {
      this._challengeQueue.add(challengeID);  // if not, queue fetching it.
      props.isVisible = false;                // keep invisible for now
    } else {
      props.isVisible = challenge.isVisible;
      props.instruction = challenge.instruction;
      props.description = challenge.description;
    }

    props.id = taskID;               // force to string
    props.parentId = challengeID;    // force to string
    props.loc = spatial.getFreeLoc('maproulette', [props.point.lng, props.point.lat]);
    props.serviceID = this.id;
    props.namespace = 'maproulette';

    // Create a MarkerData for the task
    task = new MarkerData<MapRouletteTaskProps>(context, props as Partial<MapRouletteTaskProps>);
    spatial.addData('maproulette', task);

    return task;
  }


  /**
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  protected _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;
    const scene = gfx?.scene;
    if (!scene) return;  // test environment?

    // maproulette
    // Shows only the tasks of the given challenges for this session, e.g. `maproulette=<challengeIDs>`,
    // and turns on the layer, since a filter on a layer you can't see does nothing.
    // The url keeps it until the tasks shown no longer match it (see `_mapRouletteChanged`).
    // (`maproulette=true` is a legacy way to turn on the layer, like `layers=` does now, see API.md)
    // (Not a value that was dropped since, by a change made while the same url was being read.
    // When `maproulette` goes away, the filter stays as it is.)
    const newVal = currParams.get('maproulette');
    if (newVal === undefined || newVal === prevParams.get('maproulette') || urlhash?.getParam('maproulette') !== newVal) return;

    const ids = this._parseChallengeIDs(newVal);
    this._challengeIDs.clear();
    for (const id of ids) {
      this._challengeIDs.add(id);
    }
    if (!ids.size) {   // the legacy `true`, or no challenges to show
      urlhash?.setParam('maproulette', null);
    }

    if (ids.size || utilExtractValues(newVal).includes('true')) {
      scene.enableLayers('maproulette');   // will trigger 'layerchange'
    }
    gfx?.immediateRedraw();
  }


  /**
   * Called when the challenge filter or the layers change.
   * The filter isn't written to the url: a link's `maproulette` stays there only until the tasks shown
   * no longer match it (the layer is turned off, or the filter changes), and then it's dropped (see `API.md`).
   */
  protected _mapRouletteChanged(): void {
    const context = this.context;
    const urlhash = context.systems.urlhash;
    const scene = context.systems.gfx?.scene;
    if (!urlhash || !scene) return;  // test environment?

    const urlVal = urlhash.getParam('maproulette');
    if (urlVal === undefined) return;

    const layer = scene.layers.get('maproulette');
    const urlIDs = this._parseChallengeIDs(urlVal);
    if (!layer?.enabled || urlIDs.size !== this._challengeIDs.size || [...urlIDs].some(id => !this._challengeIDs.has(id))) {
      urlhash.setParam('maproulette', null);
    }
  }


  /**
   * Parses the challengeIDs in a url `maproulette` value.
   * @param val - The url's value, e.g. `100,200`
   * @return The challengeIDs (as strings), without values that aren't numbers (like the legacy `true`)
   */
  protected _parseChallengeIDs(val: string): Set<string> {
    const ids = new Set<string>();
    for (const s of utilExtractValues(val).filter(Boolean)) {
      // Try the value as a number, but reject things like NaN, null, Infinity
      if (Number.isFinite(+s)) {
        ids.add(s);  // keep the string
      }
    }
    return ids;
  }
}
