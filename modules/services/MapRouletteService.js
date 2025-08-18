import { Tiler } from '@rapid-sdk/math';

import { AbstractSystem } from '../core/AbstractSystem';
import { Marker } from '../models/Marker.js';
import { utilFetchResponse } from '../util';

const TILEZOOM = 14;
const MAPROULETTE_API = 'https://maproulette.org/api/v2';


/**
 * `MapRouletteService`
 * MapRoulette is a microtask platform for performing tasks to improve OpenStreetMap.
 * This service connects to the MapRoulette API to fetch about challenges and tasks.
 * @see https://wiki.openstreetmap.org/wiki/MapRoulette
 * @see https://maproulette.org/docs/swagger-ui/index.html
 *
 * Events available:
 *   'loadedData'
 */
export class MapRouletteService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'maproulette';
    this.autoStart = false;

    this._initPromise = null;
    this._challengeIDs = new Set();  // Set<string> - if we want to filter only a specific challengeID

    this._cache = {};
    this._tiler = new Tiler().zoomRange(TILEZOOM).skipNullIsland(true);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashchange = this._hashchange.bind(this);
    this._mapRouletteChanged = this._mapRouletteChanged.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const gfx = context.systems.gfx;
    const urlhash = context.systems.urlhash;

    const prerequisites = Promise.all([
      gfx.initAsync(),   // `gfx.scene` will exist after `initAsync`
      urlhash.initAsync()
    ]);

    return this._initPromise = prerequisites
      .then(() => this.resetAsync())
      .then(() => {
        // Setup event handlers..
        gfx.scene.on('layerchange', this._mapRouletteChanged);
        urlhash.on('hashchange', this._hashchange);
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return {Promise} Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return {Promise} Promise resolved when this component has completed resetting
   */
  resetAsync() {
    if (this._cache.inflight) {
      for (const controller of this._cache.inflight) {
        controller.abort();
      }
    }

    this._cache = {
      lastv: null,
      tasks: new Map(),             // Map<taskID, Marker>
      challenges: new Map(),        // Map<challengeID, Object>
      tileRequest: new Map(),       // Map<tileID, { status, controller, url }>
      challengeRequest: new Map(),  // Map<challengeID, { status, controller, url }>
      inflight: new Map(),          // Map<url, controller>
      closed: []                    // Array<{ challengeID, taskID }>
    };

    const spatial = this.context.systems.spatial;
    spatial.clearCache('maproulette');

    return Promise.resolve();
  }


  /**
   * challengeID
   * set/get the challengeIDs (as a string of comma-separated values)
   */
  get challengeIDs() {
    return [...this._challengeIDs].join(',');
  }

  set challengeIDs(ids = '') {
    const str = ids.toString();
    const vals = str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Keep only values that are numeric, reject things like NaN, null, Infinity
    this._challengeIDs.clear();
    for (const val of vals) {
      const num = +val;
      const valIsNumber = (!isNaN(num) && isFinite(num));
      if (valIsNumber) {
        this._challengeIDs.add(val);  // keep the string
      }
    }
    const gfx = this.context.systems.gfx;
    gfx.immediateRedraw();
    this._mapRouletteChanged();
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @return  {Array<Marker>}  Array of data
   */
  getData() {
    const spatial = this.context.systems.spatial;

    return spatial.getVisibleData('maproulette')
      .map(d => d.data)
      .filter(task => {
        if (this._challengeIDs.size) {
          return this._challengeIDs.has(task.props.parentId);  // ignore isVisible if it's in the list
        } else {
          return task.props.isVisible;
        }
      });
  }


  /**
   * getTask
   * @param   {string}   dataID
   * @return  {Marker?}  The task with that id, or `undefined` if not found
   */
  getTask(dataID) {
    const spatial = this.context.systems.spatial;
    return spatial.getData('maproulette', dataID);
  }


  /**
   * getChallenge
   * @param   {string}   challengeID
   * @return  {Object?}  The challenge with that id, or `undefined` if not found
   */
  getChallenge(challengeID) {
    return this._cache.challenges.get(challengeID);
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   */
  loadTiles() {
    if (this._paused) return;

    const context = this.context;
    const spatial = context.systems.spatial;
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
        request.controller.abort();
        cache.inflight.delete(request.url);
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
   * loadTile
   * Load a single tile of data.
   * @param  {Tile}  tile - Tile to load
   */
  loadTile(tile) {
    const context = this.context;
    const spatial = context.systems.spatial;

    const cache = this._cache;
    if (cache.tileRequest.has(tile.id)) return;

    const extent = tile.wgs84Extent;
    const bbox = extent.rectangle().join('/');  // minX/minY/maxX/maxY
    const url = `${MAPROULETTE_API}/tasks/box/${bbox}`;

    const controller = new AbortController();
    cache.inflight.set(url, controller);
    cache.tileRequest.set(tile.id, { status: 'inflight', controller: controller, url: url });

    fetch(url, { signal: controller.signal })
      .then(utilFetchResponse)
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
      })
      .finally(() => {
        cache.inflight.delete(url);
      });
  }


  /**
   * loadChallenges
   * Schedule any data requests needed for challenges we are interested in
   */
  loadChallenges() {
    if (this._paused) return;

    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial;
    const cache = this._cache;

    for (const [challengeID, val] of cache.challengeRequest) {
      if (val.status) return;  // processed already

      const url = `${MAPROULETTE_API}/challenge/${challengeID}`;

      const controller = new AbortController();
      cache.inflight.set(url, controller);
      cache.challengeRequest.set(challengeID, { status: 'inflight', controller: controller, url: url });

      fetch(url, { signal: controller.signal })
        .then(utilFetchResponse)
        .then(challenge => {
          cache.challengeRequest.set(challengeID, { status: 'loaded' });

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

          gfx.deferredRedraw();
          this.emit('loadedData');
        })
        .catch(err => {
          if (err.name === 'AbortError') {
            cache.challengeRequest.delete(challengeID);  // allow retry
          } else {  // real error
            console.error(err);    // eslint-disable-line no-console
            cache.challengeRequest.set(challengeID, { status: 'error' });  // don't retry
          }
        })
        .finally(() => {
          cache.inflight.delete(url);
        });
    }
  }


  /**
   * loadTaskDetailAsync
   * This loads the challenge instructions and adds it to an existing task.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Challenge/read
   * @param   {Marker}  task
   * @return  {Promise}
   */
  loadTaskDetailAsync(task) {
    if (task.props.description !== undefined) return Promise.resolve(task);  // already done

    const challengeID = task.props.parentId;
    const url = `${MAPROULETTE_API}/challenge/${challengeID}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(data => {
        task.props.instruction = data.instruction || '';
        task.props.description = data.description || '';
        return task.touch();
      })
      .then(task => this.loadTaskFeaturesAsync(task));
  }


  /**
   * loadTaskFeaturesAsync
   * This loads the task features geojson and adds it to an existing task.
   * Those properties are used to replace the Mustache tags in the challenge.instruction/.description.
   * @see https://maproulette.org/docs/swagger-ui/index.html#/Task/read
   * @param   {Marker}   task
   * @return  {Promise}  Promise resolved when we've fetched the task details
   */
  loadTaskFeaturesAsync(task) {
    if (task.props.taskFeatures !== undefined) return Promise.resolve(task);  // already done

    const url = `${MAPROULETTE_API}/task/${task.id}`;

    return fetch(url)
      .then(utilFetchResponse)
      .then(data => {
        task.props.taskFeature = data?.geometries?.features || [];
        return task.touch();
      });
  }


  /**
   * postUpdate
   * @param   {Marker}    task
   * @param   {function}  callback
   */
  postUpdate(task, callback) {
    const cache = this._cache;

    const taskID = task.id;
    const challengeID = task.props.parentId;
    const taskStatus = task.props.taskStatus;
    const taskComment = task.props.comment;
    const apikey = task.props.mapRouletteApiKey;

    // A comment is optional, but if we have one, POST it..
    const commentUrl = `${MAPROULETTE_API}/task/${taskID}/comment`;
    if (taskComment && !cache.inflight.has(commentUrl)) {
      const commentController = new AbortController();
      cache.inflight.set(commentUrl, commentController);

      fetch(commentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiKey': apikey
        },
        body: JSON.stringify({ actionId: 2, comment: taskComment }),
        signal: commentController.signal
      })
      .then(utilFetchResponse)
      .catch(err => {
        if (err.name === 'AbortError') {
          return;  // ok
        } else {  // real error
          console.error(err);    // eslint-disable-line no-console
        }
      })
      .finally(() => {
        cache.inflight.delete(commentUrl);
      });
    }

    // update the status and release the task
    const updateTaskUrl = `${MAPROULETTE_API}/task/${taskID}/${taskStatus}`;
    const releaseTaskUrl = `${MAPROULETTE_API}/task/${taskID}/release`;

    if (!cache.inflight.has(updateTaskUrl) && !cache.inflight.has(releaseTaskUrl)) {
      const updateTaskController = new AbortController();
      const releaseTaskController = new AbortController();
      cache.inflight.set(updateTaskUrl, updateTaskController);
      cache.inflight.set(releaseTaskUrl, releaseTaskController);

      fetch(updateTaskUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apiKey': apikey
        },
        signal: updateTaskController.signal
      })
      .then(utilFetchResponse)
      .then(() => {
        return fetch(releaseTaskUrl, {
          signal: releaseTaskController.signal,
          headers: {
            'apiKey': apikey
          }
        });
      })
      .then(utilFetchResponse)
      .then(() => {
        // All requests completed successfully
        if (taskStatus === 1) {  // only counts if the use chose "I Fixed It".
          this._cache.closed.push({ taskID: taskID, challengeID: challengeID });
        }
        this.removeTask(task);
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
      })
      .finally(() => {
        cache.inflight.delete(updateTaskUrl);
        cache.inflight.delete(releaseTaskUrl);
      });
    }
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
    spatial.replaceData('maproulette', item);
    return item;
  }


  /**
   * removeItem
   * Remove a single item from the cache
   * @param  {Marker}  item to remove
   */
  removeItem(item) {
    if (!(item instanceof Marker) || !item.id) return;

    const spatial = this.context.systems.spatial;
    spatial.removeData('maproulette', item);
  }


  /**
   * getClosed
   * Get details about all taskks closed in this session
   * @return  {Array<*>}  Array of objects
   */
  getClosed() {
    return this._cache.closed;
  }


  /**
   * flyToNearbyTask
   * Initiates the process to find and fly to a nearby task based on the current task's challenge ID and task ID.
   * @param  {Marker}  task - The current task containing task details.
   */
  flyToNearbyTask(task) {
    if (!this.nearbyTaskEnabled) return;
    const challengeID = task.props.parentId;
    const taskID = task.id;
    if (!challengeID || !taskID) return;
    this.filterNearbyTasks(challengeID, taskID);
  }


  /**
   * getChallengeDetails
   * Retrieves challenge details from cache or API.
   * @param    {string}   challengeID - The ID of the challenge.
   * @returns  {Promise}  Promise resolving with challenge data.
   */
  getChallengeDetails(challengeID) {
// Why is this different from what `loadChallenges()` does???
    const cachedChallenge = this._cache.challenges.get(challengeID);
    if (cachedChallenge) {
      return Promise.resolve(cachedChallenge);
    } else {
      const challengeUrl = `${MAPROULETTE_API}/challenge/${challengeID}`;
      return fetch(challengeUrl)
        .then(utilFetchResponse);
    }
  }


  /**
   * filterNearbyTasks
   * Fetches nearby tasks for a given challenge and task ID, and flies to the nearest task.
   * @param  {string}  challengeID - The ID of the challenge.
   * @param  {string}  taskID - The ID of the current task.
   * @param  {number}  [zoom] - Optional zoom level for the map.
   */
  filterNearbyTasks(challengeID, taskID, zoom) {
    const nearbyTasksUrl = `${MAPROULETTE_API}/challenge/${challengeID}/tasksNearby/${taskID}?excludeSelfLocked=true&limit=1`;
    if (!taskID) return;

    fetch(nearbyTasksUrl)
      .then(utilFetchResponse)
      .then(nearbyTasks => {
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
            if (map) {
              map.centerZoomEase(task.loc, zoom);
              this.selectAndDisplayTask(task);
            }
          });
      })
      .catch(err => {
        console.error('Error fetching nearby tasks for challenge:', challengeID, err);  // eslint-disable-line no-console
      });
  }


  /**
   * selectAndDisplayTask
   * Selects a task and updates the sidebar reflect the selection
   * @param  {Marker}  task - The task to be selected
   */
  selectAndDisplayTask(task) {
    if (!(task instanceof Marker)) return;

    this.currentTask = task;
    const selection = new Map().set(task.id, task);
    this.context.enter('select', { selection });
  }


  /**
   * itemURL
   * Returns the URL for user to visit for information about the task and challenge.
   * @param   {Marker}  task
   * @return  {string}  the url
   */
  itemURL(task) {
    return `https://maproulette.org/challenge/${task.props.parentId}/task/${task.id}`;
  }


  /**
   * _cacheTask
   * Store the given task in the cache
   * @param   {Object}  props - the task properties
   * @return  {Marker}  The task
   */
  _cacheTask(props) {
    const context = this.context;
    const spatial = context.systems.spatial;

    const cache = this._cache;
    const taskID = props.id.toString();
    const challengeID = props.parentId.toString();

    let task = spatial.getData('maproulette', taskID);
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

    // Create a Marker for the task
    task = new Marker(context, props);
    spatial.addData('maproulette', task);

    return task;
  }


  /**
   * _hashchange
   * Respond to any changes appearing in the url hash
   * @param  {Map<string, string>}  currParams - The current hash parameters
   * @param  {Map<string, string>}  prevParams - The previous hash parameters
   */
  _hashchange(currParams, prevParams) {
    const scene = this.context.systems.gfx.scene;

    // maproulette
    // Support opening maproulette layer with a URL parameter:
    //  e.g. `maproulette=true`  -or-
    //  e.g. `maproulette=<challengeIDs>`
    const newVal = currParams.get('maproulette') || '';
    const oldVal = prevParams.get('maproulette') || '';
    if (newVal !== oldVal) {
      let isEnabled = false;

      this._challengeIDs.clear();
      const vals = newVal.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const val of vals) {
        if (val === 'true') {
          isEnabled = true;
          continue;
        }
        // Try the value as a number, but reject things like NaN, null, Infinity
        const num = +val;
        const valIsNumber = (!isNaN(num) && isFinite(num));
        if (valIsNumber) {
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
   * _mapRouletteChanged
   * Push changes in MapRoulette state to the urlhash
   */
  _mapRouletteChanged() {
    const context = this.context;
    const urlhash = context.systems.urlhash;
    const scene = context.systems.gfx.scene;
    const layer = scene.layers.get('maproulette');

    // `maproulette=true` -or- `maproulette=<challengeIDs>`
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
