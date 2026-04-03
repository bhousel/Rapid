import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Message sent from main thread → worker */
interface WorkerRequest {
  id: number;
  listenerID: ListenerID;
  data: unknown;
}

/** Message sent from worker → main thread */
interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}

/** Pending worker request awaiting a response */
interface PendingWorkerRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** The Worker that owns this request (for targeted cancel messages) */
  worker: Worker;
  /** Cleanup function to remove AbortSignal listener, if any */
  signalCleanup: (() => void) | null;
}

/** Default max worker pool size */
const DEFAULT_MAX_WORKERS = 2;


/**
 * WorkerSystem
 * Manages the web worker pool and listener registry.
 *
 * Responsibilities:
 * - **Worker pool** — Spawns module-type workers lazily (on first task),
 *   round-robins tasks across them, terminates on reset.
 * - **listeners** — Code can register listener functions.
 *   These functions can run either in the worker or on the main thread as a fallback.
 *
 * This system has no required dependencies and should be available very early.
 * Host apps must set `workerURL` before dispatching tasks (typically right
 * after `initAsync`).
 *
 * Design rationale:
 * - SchedulerSystem = **when** to run (game loop, queues, timers, backpressure)
 * - WorkerSystem = **where** to run (worker pool, task dispatch, listener registry)
 * - NetworkSystem = network I/O (fetch lifecycle, inflight tracking, dedup, concurrency)
 *
 * Events available:
 *   `paused`     Fires when the system transitions from unpaused to paused
 *   `resumed`    Fires when the system transitions from paused to unpaused
 */
export class WorkerSystem extends AbstractSystem {

  // Worker pool
  /** URL to the worker script (set by host app via `workerURL` setter) */
  private _workerURL: string | null;
  /** Pool of spawned workers */
  private _workers: Worker[];
  /** Maximum number of workers to spawn */
  private _maxWorkers: number;
  /** Round-robin index for dispatching tasks to workers */
  private _workerIndex: number;
  /** Monotonically increasing request ID for correlating responses */
  private _nextRequestID: number;
  /** Pending requests awaiting worker responses, keyed by request ID */
  private _pendingRequests: Map<number, PendingWorkerRequest>;

  // listener registry
  /** Registered listeners for worker/main-thread dispatch */
  private _listeners: Map<ListenerID, Listener>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'worker';
    // No required dependencies — this system should be available very early.
    this.requiredDependencies = new Set();
    this.optionalDependencies = new Set();

    this._workerURL = null;
    this._workers = [];
    this._maxWorkers = DEFAULT_MAX_WORKERS;
    this._workerIndex = 0;
    this._nextRequestID = 1;
    this._pendingRequests = new Map();
    this._listeners = new Map();
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;
    return this._initPromise = super.initAsync();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;
    return this._startPromise = super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state.
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  // -------------------------------------------------------
  // Worker pool
  //
  // Spawns web workers lazily (on first task) up to `maxWorkers`.
  // Tasks are dispatched round-robin.  Each request gets a unique
  // ID; the worker posts back a response with the same ID so the
  // system can resolve the correct Promise.
  //
  // Host app must set `workerURL` before dispatching tasks.
  // Workers are terminated on `resetAsync()` and `terminateWorkers()`.
  // -------------------------------------------------------

  /**
   * workerURL
   * URL to the built worker script.  Must be set by the host app
   * before calling `dispatch`.  Typically something like
   * `assetPath + 'rapid-worker.js'`.
   */
  get workerURL(): string | null {
    return this._workerURL;
  }
  set workerURL(url: string | null) {
    this._workerURL = url;
  }


  /**
   * maxWorkers
   * Maximum number of workers in the pool.  Workers are spawned
   * lazily, so setting this higher doesn't immediately spawn them.
   * Defaults to 2.
   */
  get maxWorkers(): number {
    return this._maxWorkers;
  }
  set maxWorkers(n: number) {
    this._maxWorkers = Math.max(1, n);
  }


  /**
   * numWorkers
   * Number of workers currently alive in the pool.
   * @readonly
   */
  get numWorkers(): number {
    return this._workers.length;
  }


  /**
   * numPendingRequests
   * Number of worker requests awaiting a response.
   * Useful for debugging and tests.
   * @readonly
   */
  get numPendingRequests(): number {
    return this._pendingRequests.size;
  }


  /**
   * dispatch
   * Dispatches a message to a given web worker listener function
   * and returns a Promise that resolves with the worker's result.
   *
   * The `data` argument must be structured-clone-compatible
   * (no functions, DOM nodes, or non-transferable objects).
   *
   * An optional `AbortSignal` can be passed to cancel the task.
   * When the signal fires, a `{ type: 'cancel', id }` message is
   * sent to the worker, the pending promise rejects with an AbortError,
   * and the worker-side AbortController is triggered.
   *
   * @param listenerID - The id of the listener function
   * @param data - Serializable input for the listener
   * @param signal - Optional AbortSignal to cancel the task
   * @return Promise resolved with the task result, or rejected on error
   * @throws Error if `workerURL` has not been set
   */
  dispatch<T = unknown>(listenerID: ListenerID, data?: unknown, signal?: AbortSignal): Promise<T> {
    if (!this._workerURL) {
      return Promise.reject(new Error('WorkerSystem: workerURL not set'));
    }

    // Already aborted before we even start
    if (signal?.aborted) {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      return Promise.reject(err);
    }

    const worker = this._getOrSpawnWorker();
    const id = this._nextRequestID++;

    return new Promise<T>((resolve, reject) => {
      let signalCleanup: (() => void) | null = null;

      if (signal) {
        const onAbort = () => {
          // Send cancel to the specific worker that owns this request
          worker.postMessage({ type: 'cancel', id });
          // Clean up and reject
          const pending = this._pendingRequests.get(id);
          if (pending) {
            pending.signalCleanup = null;  // prevent double cleanup
            this._pendingRequests.delete(id);
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        signalCleanup = () => signal.removeEventListener('abort', onAbort);
      }

      this._pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        worker,
        signalCleanup,
      });

      const request: WorkerRequest = { id, listenerID, data };
      worker.postMessage(request);
    });
  }


  /**
   * terminateWorkers
   * Terminates all workers in the pool and rejects any pending
   * requests.  Called automatically by `resetAsync()`.
   */
  terminateWorkers(): void {
    for (const worker of this._workers) {
      worker.terminate();
    }
    this._workers.length = 0;
    this._workerIndex = 0;

    // Reject all pending requests and clean up signal listeners
    for (const [, pending] of this._pendingRequests) {
      if (pending.signalCleanup) pending.signalCleanup();
      pending.reject(new Error('WorkerSystem: worker terminated'));
    }
    this._pendingRequests.clear();
  }


  /**
   * registerListener
   * Registers a named listener function.
   * @param listenerID - The id of the listener function
   * @param listener - Listener function
   */
  registerListener(listenerID: ListenerID, listener: Listener): void {
    this._listeners.set(listenerID, listener);
  }


  /**
   * unregisterListener
   * Removes a previously registered listener function.
   * @param listenerID - The id of the listener function
   */
  unregisterListener(listenerID: ListenerID): void {
    this._listeners.delete(listenerID);
  }


  /**
   * getListener
   * Returns the listener function for a given listenerID, or undefined.
   * @param listenerID - The id of the listener function
   * @return The listener function, or undefined if no such id exists
   */
  getListener(listenerID: ListenerID): Listener | undefined {
    return this._listeners.get(listenerID);
  }


  /**
   * _getOrSpawnWorker
   * Returns the next worker from the pool (round-robin), spawning
   * a new one if the pool isn't full yet.
   */
  private _getOrSpawnWorker(): Worker {
    // Spawn if pool not full
    if (this._workers.length < this._maxWorkers) {
      const worker = this._spawnWorker();
      this._workers.push(worker);
    }

    // Round-robin
    const worker = this._workers[this._workerIndex % this._workers.length];
    this._workerIndex++;
    return worker;
  }


  /**
   * _spawnWorker
   * Creates a new Worker and wires up message/error handlers.
   */
  private _spawnWorker(): Worker {
    const worker = new Worker(this._workerURL!, { type: 'module' });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, result, error } = event.data;
      const pending = this._pendingRequests.get(id);
      if (!pending) return;  // stale response after terminate or cancel
      this._pendingRequests.delete(id);

      if (pending.signalCleanup) pending.signalCleanup();

      if (error !== undefined) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      console.error('WorkerSystem: worker error:', event.message);  // eslint-disable-line no-console
    };

    return worker;
  }
}
