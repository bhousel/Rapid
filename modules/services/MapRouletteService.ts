import { AbstractSystem } from '../core/AbstractSystem.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { Tiler } from '@rapid-sdk/math';
import { utilExtractValues } from '../util/string.ts';

import type { Context } from '../Context.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { Tile } from '@rapid-sdk/math';


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
  taskFeatures?: any;
  /** Primary GeoJSON feature for this task */
  taskFeature?: any;
  /** Numeric status code for the task (e.g. 1 = Fixed) */
  taskStatus?: number;
  /** User comment submitted with the task update */
  comment?: string;
  /** API key for authenticating MapRoulette API requests */
  mapRouletteApiKey?: string;
  /** Geographic coordinates of the task */
  point?: { lng: number; lat: number };
}

/** A MapRoulette task MarkerData with typed props */
export type MapRouletteTask = MarkerData<MapRouletteTaskProps>;

/** Zoom level used to tile data requests */
const TILEZOOM = 14;
/** Base URL for the MapRoulette REST API v2 */
const MAPROULETTE_API = 'https://maproulette.org/api/v2';


/** Status of a tile or challenge request */
interface RequestEntry {
  /** Current request state: 'inflight', 'loaded', or 'error' */
  status?: string;
}

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

/** Internal cache for MapRoulette data */
interface MapRouletteCache {
  /** Last viewport version used for tile loading, to avoid redundant work */
  lastv: number | null;
  /** Cached task Markers keyed by task ID */
  tasks: Map<string, MarkerData>;
  /** Cached challenge data keyed by challenge ID */
  challenges: Map<string, ChallengeData>;
  /** Tile request statuses keyed by tile ID */
  tileRequest: Map<TileID, RequestEntry>;
  /** Challenge request statuses keyed by challenge ID */
  challengeRequest: Map<string, RequestEntry>;
  /** Tasks closed during this editing session */
  closed: ClosedEntry[];
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
  /** Internal data cache for tasks, challenges, and request tracking */
  protected _cache: MapRouletteCache;
  /** Tiler instance for computing tile coverage at the configured zoom level */
  protected _tiler: Tiler;


  /**
   * @constructor
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

    this._cache = {} as MapRouletteCache;
    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;

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
        urlhash?.on('hashChanged', this._hashChanged);
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

    network.abortMatching(id => /^maproulette-/.test(id));
    spatial.clearCache('maproulette');

    this._cache = {
      lastv:             null,
      tasks:             new Map<string, MarkerData>(),
      challenges:        new Map<string, ChallengeData>(),
      tileRequest:       new Map<TileID, RequestEntry>(),
      challengeRequest:  new Map<string, RequestEntry>(),
      closed:            []    // Array<{ challengeID, taskID }>
    };

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

    return (spatial.getVisibleData('maproulette')
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
    return spatial.getData<MapRouletteTask>('maproulette', dataID);
  }


  /**
   * Returns a cached MapRoulette challenge by ID.
   * @param challengeID - The challenge ID
   * @return The challenge with that id, or `undefined` if not found
   */
  public getChallenge(challengeID: string): ChallengeData | undefined {
    return this._cache.challenges.get(challengeID);
  }


  /**
   * Schedule any data requests needed to cover the current map view
   */
  public loadTiles(): void {
    if (this._paused) return;

    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const viewport = context.viewport;
    const cache = this._cache;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const [tileID, request] of cache.tileRequest) {
      if (request.status !== 'inflight') continue;
      const isNeeded = tiles.some(tile => tile.id === tileID);
      if (!isNeeded) {
        network.abort(`maproulette-tile-${tileID}`);
      }
    }

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      if (spatial.hasTile('maproulette', tileID)) continue;
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
    const spatial = context.systems.spatial!;

    const cache = this._cache;
    if (cache.tileRequest.has(tile.id)) return;

    const extent = tile.wgs84Extent;
    const bbox = extent.rectangle().join('/');  // minX/minY/maxX/maxY
    const url = `${MAPROULETTE_API}/tasks/box/${bbox}`;
    const requestID = `maproulette-tile-${tile.id}`;

    cache.tileRequest.set(tile.id, { status: 'inflight' });

    network.fetch<any>(url, { requestID })
      .then(data => {
        spatial.addTiles('maproulette', [tile]);   // mark as loaded
        cache.tileRequest.set(tile.id, { status: 'loaded' });

        for (const props of (data ?? [])) {
          this._cacheTask(props);
        }

        this.loadChallenges();   // call this sometimes
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          cache.tileRequest.delete(tile.id);  // allow retry
        } else {  // real error
          console.error(err);    // eslint-disable-line no-console
          spatial.addTiles('maproulette', [tile]);              // don't retry
          cache.tileRequest.set(tile.id, { status: 'error' });  // don't retry
        }
      });
  }


  /**
   * Schedule any data requests needed for challenges we are interested in
   */
  public loadChallenges(): void {
    if (this._paused) return;

    const context = this.context;
    const gfx = context.systems.gfx;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const cache = this._cache;


    for (const [challengeID, val] of cache.challengeRequest) {
      if (val.status) return;  // processed already

      const url = `${MAPROULETTE_API}/challenge/${challengeID}`;
      const requestID = `maproulette-challenge-${challengeID}`;

      cache.challengeRequest.set(challengeID, { status: 'inflight' });

      network.fetch<any>(url, { requestID })
        .then(challenge => {
          cache.challengeRequest.set(challengeID, { status: 'loaded' });

          challenge.id = challenge.id.toString();    // force to string
          challenge.isVisible = challenge.enabled && !challenge.deleted;

          // Update task statuses
          const toUpdate = [];
          const allTasks = spatial.getCache('maproulette').data;
          for (const task of allTasks.values()) {
            if (task.props.parentId === challengeID && task.props.isVisible !== challenge.isVisible) {
              task.props.isVisible = challenge.isVisible;
              task.touch();
              toUpdate.push(task);
            }
          }
          spatial.replaceData('maproulette', toUpdate);

          // save the challenge
          cache.challenges.set(challengeID, challenge);

          gfx?.deferredRedraw();
        })
        .catch(err => {
          if (err.name === 'AbortError') {
            cache.challengeRequest.delete(challengeID);  // allow retry
          } else {  // real error
            console.error(err);    // eslint-disable-line no-console
            cache.challengeRequest.set(challengeID, { status: 'error' });  // don't retry
          }
        });
    }
  }


  /**
   * This loads the challenge instructions and adds it to an existing task.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Challenge/read
   * @param task
   * @return Promise resolved with the task
   */
  public loadTaskDetailAsync(task: MapRouletteTask): Promise<MapRouletteTask> {
    if (task.props.description !== undefined) return Promise.resolve(task);  // already done

    const network = this.context.systems.network!;
    const challengeID = task.props.parentId;
    const url = `${MAPROULETTE_API}/challenge/${challengeID}`;

    return network.fetch<any>(url)
      .then(data => {
        task.props.instruction = data.instruction || '';
        task.props.description = data.description || '';
        return task.touch();
      })
      .then(task => this.loadTaskFeaturesAsync(task));
  }


  /**
   * This loads the task features geojson and adds it to an existing task.
   * Those properties are used to replace the Mustache tags in the challenge.instruction/.description.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Task/read
   * @param task
   * @return Promise resolved when we've fetched the task details
   */
  public loadTaskFeaturesAsync(task: MapRouletteTask): Promise<MapRouletteTask> {
    if (task.props.taskFeatures !== undefined) return Promise.resolve(task);  // already done

    const network = this.context.systems.network!;
    const url = `${MAPROULETTE_API}/task/${task.id}`;

    return network.fetch<any>(url)
      .then(data => {
        task.props.taskFeature = data?.geometries?.features || [];
        return task.touch();
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
    const apikey = task.props.mapRouletteApiKey;

    // A comment is optional, but if we have one, POST it..
    const commentKey = `maproulette-comment-${taskID}`;
    if (taskComment && !network.isInflight(commentKey)) {
      network.fetch<any>(`${MAPROULETTE_API}/task/${taskID}/comment`, {
        requestID: commentKey,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiKey': apikey as string
        },
        body: JSON.stringify({ actionId: 2, comment: taskComment })
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          return;  // ok
        } else {  // real error
          console.error(err);    // eslint-disable-line no-console
        }
      });
    }

    // update the status and release the task
    const updateTaskUrl = `${MAPROULETTE_API}/task/${taskID}/${taskStatus}`;
    const releaseTaskUrl = `${MAPROULETTE_API}/task/${taskID}/release`;
    const updateKey = `maproulette-update-${taskID}`;
    const releaseKey = `maproulette-release-${taskID}`;

    if (!network.isInflight(updateKey) && !network.isInflight(releaseKey)) {
      network.fetch<any>(updateTaskUrl, {
        requestID: updateKey,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apiKey': apikey as string
        }
      })
      .then(() => {
        return network.fetch<any>(releaseTaskUrl, {
          requestID: releaseKey,
          headers: {
            'apiKey': apikey as string
          }
        });
      })
      .then(() => {
        // All requests completed successfully
        if (taskStatus === 1) {  // only counts if the use chose "I Fixed It".
          this._cache.closed.push({ taskID: taskID as string, challengeID: challengeID as string });
        }
        this.removeItem(task);
        this.context.enter('browse');
        if (callback) callback(null, task);
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          return;  // ok
        } else {  // real error
          console.error(err);    // eslint-disable-line no-console
          if (callback) callback(err.message);
        }
      });
    }
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
    spatial.removeData('maproulette', item);
  }


  /**
   * Get details about all tasks closed in this session
   * @return Array of closed task entries
   */
  public getClosed(): ClosedEntry[] {
    return this._cache.closed;
  }


  /**
   * Initiates the process to find and fly to a nearby task based on the current task's challenge ID and task ID.
   * @param task - The current task containing task details.
   */
  public flyToNearbyTask(task: MapRouletteTask): void {
    if (!this.nearbyTaskEnabled) return;
    const challengeID = task.props.parentId as string;
    const taskID = task.id;
    if (!challengeID || !taskID) return;
    this.filterNearbyTasks(challengeID, taskID);
  }


  /**
   * Retrieves challenge details from cache or API.
   * @param challengeID - The ID of the challenge.
   * @returns Promise resolving with challenge data.
   */
  public getChallengeDetails(challengeID: string): Promise<ChallengeData> {
// Why is this different from what `loadChallenges()` does???
    const cachedChallenge = this._cache.challenges.get(challengeID);
    if (cachedChallenge) {
      return Promise.resolve(cachedChallenge);
    } else {
      const network = this.context.systems.network!;
      const challengeUrl = `${MAPROULETTE_API}/challenge/${challengeID}`;
      return network.fetch<any>(challengeUrl);
    }
  }


  /**
   * Fetches nearby tasks for a given challenge and task ID, and flies to the nearest task.
   * @param challengeID - The ID of the challenge.
   * @param taskID - The ID of the current task.
   * @param zoom - Optional zoom level for the map.
   */
  public filterNearbyTasks(challengeID: string, taskID: string, zoom?: number): void {
    const nearbyTasksUrl = `${MAPROULETTE_API}/challenge/${challengeID}/tasksNearby/${taskID}?excludeSelfLocked=true&limit=1`;
    if (!taskID) return;
    const network = this.context.systems.network!;

    network.fetch<any>(nearbyTasksUrl)
      .then((nearbyTasks: any[]) => {
        if (!nearbyTasks?.length) return;  // no nearby tasks?

        const props = nearbyTasks[0];
        // fix a few things that are named differently?
        props.parentId = props.parent.toString();
        props.point.lng = props.location.coordinates[0];
        props.point.lat = props.location.coordinates[1];

        const task = this._cacheTask(props);  // create task, or get existing from cache

// Why is this different from what `loadChallenges()` does???
        return this.getChallengeDetails(challengeID)
          .then(challengeData => {
            task.props.title = challengeData.name;
            task.props.parentName = challengeData.name;
            task.touch();

            const map = this.context.systems.map;
            if (task.loc && zoom !== undefined) {
              map?.centerZoomEase(task.loc, zoom);
            }
            this.selectAndDisplayTask(task);
          });
      })
      .catch(err => {
        console.error('Error fetching nearby tasks for challenge:', challengeID, err);  // eslint-disable-line no-console
      });
  }


  /**
   * Selects a task and updates the sidebar reflect the selection
   * @param task - The task to be selected
   */
  public selectAndDisplayTask(task: MapRouletteTask): void {
    if (!(task instanceof MarkerData)) return;

    this.currentTask = task;
    const selection = new Map<string, MarkerData>().set(task.id, task);
    this.context.enter('select', { selection });
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

    const cache = this._cache;
    const taskID = props.id.toString();
    const challengeID = props.parentId.toString();

    let task = spatial.getData<MapRouletteTask>('maproulette', taskID);
    if (task) return task;  // seen it already

    // Have we seen this challenge before?
    const challenge = cache.challenges.get(challengeID);
    if (!challenge) {
      cache.challengeRequest.set(challengeID, {});  // queue fetching it
      props.isVisible = false;
    } else {
      props.isVisible = challenge.isVisible;
    }

    props.id = taskID;               // force to string
    props.parentId = challengeID;    // force to string
    props.loc = spatial.preventCoincidentLoc('maproulette', [props.point.lng, props.point.lat]);
    props.serviceID = this.id;

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
    const scene = this.context.systems.gfx?.scene;
    if (!scene) return;  // test environment?

    // maproulette
    // Support opening maproulette layer with a URL parameter:
    //  e.g. `maproulette=true`  -or-
    //  e.g. `maproulette=<challengeIDs>`
    const newVal = currParams.get('maproulette') || '';
    const oldVal = prevParams.get('maproulette') || '';
    if (newVal !== oldVal) {
      let isEnabled = false;

      this._challengeIDs.clear();
      const vals = utilExtractValues(newVal).filter(Boolean);
      for (const val of vals) {
        if (val === 'true') {
          isEnabled = true;
          continue;
        }
        // Try the value as a number, but reject things like NaN, null, Infinity
        const num = +val;
        if (Number.isFinite(num)) {
          isEnabled = true;
          this._challengeIDs.add(val);  // keep the string
        }
      }

      if (isEnabled) {  // either of these will trigger 'layerchange'
        scene.enableLayers('maproulette');
      } else {
        scene.disableLayers('maproulette');
      }
    }
  }


  /**
   * Push changes in MapRoulette state to the urlhash
   */
  protected _mapRouletteChanged(): void {
    const context = this.context;
    const urlhash = context.systems.urlhash;
    const scene = context.systems.gfx?.scene;
    if (!urlhash || !scene) return;  // test environment?

    // `maproulette=true` -or- `maproulette=<challengeIDs>`
    const layer = scene.layers.get('maproulette');
    if (layer?.enabled) {
      const ids = this.challengeIDs;
      if (ids) {
        urlhash.setParam('maproulette', ids);
      } else {
        urlhash.setParam('maproulette', 'true');
      }
    } else {
      urlhash.setParam('maproulette', null);
    }
  }
}
