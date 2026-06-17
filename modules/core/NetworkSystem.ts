import { AbstractSystem } from './AbstractSystem.ts';
import { networkListeners } from './NetworkSystem.worker.ts';
import { FetchError, fetchEnvelope, utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';
import type { FetchEnvelope } from '../util/fetch_response.ts';
import type { DispatchOptions } from './WorkerSystem.ts';


/** Options for network fetch requests */
export interface NetworkFetchOptions extends Omit<RequestInit, 'signal'> {
  /**
   * Unique identifier for dedup and cancellation.  If another request with the
   * same requestID is already inflight, the existing promise is returned.
   * Default: `'${method} ${url}'` (e.g. `'GET https://example.com/data'`).
   */
  requestID?: RequestID;

  /**
   * Timeout in milliseconds.  Overrides `defaultTimeout`.
   * Set to 0 to disable.
   */
  timeout?: number;

  /**
   * Custom fetch function.  Replaces `globalThis.fetch` for this request.
   * Useful as an escape hatch when request interceptors are insufficient.
   */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;

  /**
   * If true, skip worker dispatch and always fetch on the main thread.
   * Default: false.
   */
  mainThread?: boolean;

  /**
   * Named listener to invoke instead of the default fetch+parse.
   * When set, the request is dispatched to a registered listener
   * (on a worker if available, otherwise on the main thread).
   * Listener names are namespaced: `'network:fetchAndParse'`, etc.
   */
  listenerID?: ListenerID;

  /**
   * Extra data to pass to the named listener alongside the URL.
   * Only used when `listenerID` is set.
   */
  listenerData?: Record<string, unknown>;

  /**
   * When set, worker results are deferred through `SchedulerSystem` at
   * the given priority.  Prevents heavy `.then()` chains from blowing
   * the frame budget.  Passed through to `WorkerSystem.dispatch()`.
   * @see DispatchOptions.resultPriority
   */
  resultPriority?: DispatchOptions['resultPriority'];
}


/** Tracks a single inflight request */
interface InflightRequest<T = unknown> {
  /** Unique identifier for dedup and cancellation */
  requestID: RequestID;
  /** The AbortController for this request */
  controller: AbortController;
  /** The in-progress envelope promise (for dedup — second caller gets same promise) */
  promise: Promise<FetchEnvelope<T>>;
  /** Timestamp when the request was created (for diagnostics) */
  created: number;
}

/** A queued request waiting for a concurrency slot */
interface QueuedFetch {
  requestID: RequestID;
  controller: AbortController;
  /** Called when a concurrency slot opens */
  run: () => void;
}


/**
 * Function that can modify a request before it is dispatched.
 * Interceptors run on the main thread, producing a serializable `RequestInit`
 * that can be sent to a web worker.
 */
export type RequestInterceptor = (url: string, init: RequestInit) => RequestInit;

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT = 30_000;

/** Default maximum concurrent inflight requests */
const DEFAULT_MAX_INFLIGHT = 100;

/**
 * Sentinel status recorded in `completed` for a request that was never sent over
 * the network (e.g. a tile skipped because it covers a blocked region).
 */
export const STATUS_SKIPPED = -1;

/**
 * Sentinel status recorded in `completed` for a request that failed without a
 * usable HTTP status (e.g. a transport/DNS failure, or a worker error whose
 * status was lost crossing the worker boundary).
 */
export const STATUS_ERROR = 0;


/**
 * `NetworkSystem` centralizes fetch lifecycle management — inflight
 * tracking, request deduplication, automatic timeouts, worker-based
 * fetch offloading, and concurrency limiting.
 *
 * **Inflight tracking** — All active requests live in one `Map`.
 * Cleanup happens in `.finally()`, so entries never leak (fixes Rapid#1451).
 *
 * **Timeouts** — Every request is automatically aborted after a
 * configurable timeout (default 30s), solving Rapid#1487.
 *
 * **Worker offloading** — When WorkerSystem is available with a
 * configured `workerURL`, fetch + parse runs in a web worker, keeping
 * the main thread free for rendering.
 *
 * **Deduplication** — If a request with the same key is already
 * inflight, the existing promise is returned.
 *
 * **Concurrency limiting** — When the number of active (dispatched)
 * requests reaches `maxInflight`, new requests enter a FIFO queue.
 * Queued requests are abortable for free (no network request started yet).
 *
 * Events available:
 * - `paused`   Fires when the system transitions from unpaused to paused
 * - `resumed`  Fires when the system transitions from paused to unpaused
 */
export class NetworkSystem extends AbstractSystem {
  /**
   * All settled requests that used an explicit `requestID`, mapped to their outcome status.
   * The status is the HTTP status code, or one of the `STATUS_*` sentinels
   * (`STATUS_SKIPPED` for requests never sent, `STATUS_ERROR` for failures with
   * no usable HTTP status).  Aborted requests are *not* recorded.
   */
  protected _completed: Map<RequestID, number>;
  /** All currently inflight requests, keyed by requestID */
  protected _inflight: Map<RequestID, InflightRequest>;
  /** FIFO queue for requests waiting on a concurrency slot */
  protected _queue: QueuedFetch[];
  /** Number of actively dispatched network requests (excludes queued) */
  protected _numActive: number;
  /** Default timeout in milliseconds */
  protected _defaultTimeout: number;
  /** Max concurrent active requests */
  protected _maxInflight: number;
  /** Registered request interceptors, applied before dispatch */
  protected _interceptors: RequestInterceptor[];


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'network';
    this.requiredDependencies = new Set<SystemID>();
    this.optionalDependencies = new Set<SystemID>(['worker']);

    this._completed = new Map<RequestID, number>();
    this._inflight = new Map<RequestID, InflightRequest>();
    this._queue = [];
    this._numActive = 0;
    this._defaultTimeout = DEFAULT_TIMEOUT;
    this._maxInflight = DEFAULT_MAX_INFLIGHT;
    this._interceptors = [];
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const worker = this.context.systems.worker;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [ worker?.initAsync() ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Register available listeners with the WorkerSystem
        for (const [listenerID, listener] of Object.entries(networkListeners)) {
          worker?.registerListener(listenerID, listener);
        }
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;
    this._started = true;
    return this._startPromise = Promise.resolve();
  }


  /**
   * Aborts all inflight requests, and clears the queue, and the completed requests.
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const worker = this.context.systems.worker;

    this.clearAll();

    if (worker?.workerURL) {
      return worker.dispatch<void>('network:reset');
    } else {
      networkListeners['network:reset'](undefined, new AbortController().signal);
      return Promise.resolve();
    }
  }


  /**
   * Default timeout in milliseconds for new requests.
   * @return  Current default timeout in milliseconds
   */
  public get defaultTimeout(): number {
    return this._defaultTimeout;
  }
  /** Sets the default request timeout in milliseconds (minimum 0 = no timeout).
   * @param ms - Timeout in milliseconds; `0` disables the timeout
   */
  public set defaultTimeout(ms: number) {
    this._defaultTimeout = Math.max(0, ms);
  }


  /**
   * Maximum concurrent active requests.  Requests beyond this limit
   * are queued (FIFO).
   * @return  Maximum number of concurrent requests
   */
  public get maxInflight(): number {
    return this._maxInflight;
  }
  /** Sets the maximum number of concurrent in-flight requests (minimum 1).
   * @param n - Maximum concurrency; values below 1 are clamped to 1
   */
  public set maxInflight(n: number) {
    this._maxInflight = Math.max(1, n);
  }


  /**
   * Total number of tracked requests (active + queued).
   * For diagnostics / tests.
   * @return  Total tracked request count
   * @readonly
   */
  public get numInflight(): number {
    return this._inflight.size;
  }


  /**
   * Number of actively dispatched network requests (excludes queued).
   * @return  Number of active requests
   * @readonly
   */
  public get numActive(): number {
    return this._numActive;
  }


  /**
   * Number of requests waiting in the concurrency queue.
   * @return  Number of queued requests
   * @readonly
   */
  public get numQueued(): number {
    return this._queue.length;
  }


  /**
   * Returns true if a request with the given requestID is currently tracked
   * (either active or queued).
   * @param requestID - The request identifier
   * @return  `true` if the request is currently inflight
   */
  public isInflight(requestID: RequestID): boolean {
    return this._inflight.has(requestID);
  }


  /**
   * Returns true if a request with the given requestID has settled (succeeded,
   * failed with an HTTP error, or was skipped).  Aborted requests are not recorded.
   * @param requestID - The request identifier
   * @return  `true` if the request has settled
   */
  public isCompleted(requestID: RequestID): boolean {
    return this._completed.has(requestID);
  }


  /**
   * Returns the recorded outcome status for a settled request, or `undefined`
   * if the request has not settled.  The status is an HTTP status code, or one
   * of the `STATUS_*` sentinels.
   * @param requestID - The request identifier
   * @return  The recorded status, or `undefined`
   */
  public getStatus(requestID: RequestID): number | undefined {
    return this._completed.get(requestID);
  }


  /**
   * Manually mark a request as completed without sending it.
   * Used by callers to skip a request they don't want to issue (e.g. a tile
   * covering a blocked region).  Defaults to the `STATUS_SKIPPED` sentinel.
   * @param requestID - The request identifier
   * @param status - The status to record (default `STATUS_SKIPPED`)
   */
  public markCompleted(requestID: RequestID, status: number = STATUS_SKIPPED): void {
    this._completed.set(requestID, status);
  }


  /**
   * Forget a recorded request so that it may be issued again.
   * Used by callers that want to retry a request that settled with an error.
   * No-op if the requestID is not recorded.
   * @param requestID - The request identifier
   */
  public forget(requestID: RequestID): void {
    this._completed.delete(requestID);
  }


  /**
   * Wrapper for the `fetch` API.  Fetches a URL with automatic:
   * - Inflight dedup (by `key`)
   * - Timeout (default 30s, configurable)
   * - `AbortController` management
   * - Worker offloading (when worker + workerURL are available)
   * - Response parsing via `utilFetchResponse`
   * - Concurrency limiting
   * - Outcome recording into `completed`
   *
   * Rejection behavior:
   * - `AbortError` for expected cancellation paths (manual abort, timeout,
   *   or reset-related cancellation)
   * - `FetchError` for HTTP errors (carries `status`/`statusText`/`body`)
   * - Other errors for true failures (transport, parse, missing listener, etc.)
   *
   * Callers that want to branch on HTTP status *without* a try/catch should use
   * `fetchEnvelope()` instead.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options + NetworkSystem extensions
   * @return The parsed response
   */
  public fetch<T = unknown>(url: string, options?: NetworkFetchOptions): Promise<T> {
    return this._getOrDispatch<T>(url, options).then(env => {
      if (env.ok) return env.value;
      throw new FetchError({
        status: env.status,
        statusText: env.statusText,
        message: env.message,
        body: env.body
      });
    });
  }


  /**
   * Like `fetch`, but resolves with a `FetchEnvelope` instead of unwrapping it.
   * HTTP errors resolve with `{ ok: false, status, ... }` rather than throwing,
   * so callers can branch on status codes without a try/catch.  `AbortError`
   * and transport failures still reject.
   *
   * Inflight tracking, dedup, timeout, abort, and outcome recording all apply.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options + NetworkSystem extensions
   * @return  A `FetchEnvelope` describing the outcome
   */
  public fetchEnvelope<T = unknown>(url: string, options?: NetworkFetchOptions): Promise<FetchEnvelope<T>> {
    return this._getOrDispatch<T>(url, options);
  }


  /**
   * Like `fetch` but returns the raw `Response` object without
   * parsing through `utilFetchResponse`.  Useful for binary data,
   * streams, or when the caller needs response headers.
   *
   * Inflight tracking, dedup, timeout, abort, and outcome recording still apply.
   * Always runs on main thread (no worker dispatch).  Unlike `fetch`, HTTP
   * errors do *not* reject — the raw `Response` is returned for the caller to
   * inspect.  Rejects with `AbortError` for expected cancellation paths.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options + NetworkSystem extensions
   * @return  The raw `Response` object
   */
  public fetchRaw(url: string, options?: NetworkFetchOptions): Promise<Response> {
    const method = (options?.method ?? 'GET').toUpperCase();
    const requestID = options?.requestID ?? `${method} ${url}`;
    const timeout = options?.timeout ?? this._defaultTimeout;
    const trackCompleted = options?.requestID !== undefined;

    // Dedup
    const existing = this._inflight.get(requestID);
    if (existing) {
      return (existing.promise as Promise<FetchEnvelope<Response>>).then(env => (env as { value: Response }).value);
    }

    const controller = new AbortController();
    const signal = this._createCombinedSignal(controller, timeout);
    const dispatch = async (): Promise<FetchEnvelope<Response>> => {
      const fetchFn = options?.fetchFn ?? globalThis.fetch;
      const init = this._applyInterceptors(url, this._buildInit(options, signal));
      const response = await fetchFn(url, init);
      // Raw fetches treat any received Response as a completion (the caller
      // inspects `response.status` itself), so always wrap as `ok: true`.
      return { ok: true, status: response.status, value: response };
    };

    return this._trackAndDispatch<Response>(requestID, controller, dispatch, trackCompleted)
      .then(env => (env as { value: Response }).value);
  }


  /**
   * Dedup helper shared by `fetch` and `fetchEnvelope`.  Returns the shared
   * `FetchEnvelope` promise for the requestID — either the existing inflight
   * one, or a freshly dispatched one.
   * @param url - The URL to fetch
   * @param options - Fetch options + NetworkSystem extensions
   * @return  The shared `FetchEnvelope` promise
   */
  protected _getOrDispatch<T>(url: string, options?: NetworkFetchOptions): Promise<FetchEnvelope<T>> {
    const method = (options?.method ?? 'GET').toUpperCase();
    const requestID = options?.requestID ?? `${method} ${url}`;
    const timeout = options?.timeout ?? this._defaultTimeout;

    // Dedup: if same requestID is already inflight, return existing promise
    const existing = this._inflight.get(requestID);
    if (existing) return existing.promise as Promise<FetchEnvelope<T>>;

    const controller = new AbortController();
    const signal = this._createCombinedSignal(controller, timeout);
    const dispatch = (): Promise<FetchEnvelope<T>> => this._dispatchFetch<T>(url, signal, options);
    const trackCompleted = options?.requestID !== undefined;

    return this._trackAndDispatch<T>(requestID, controller, dispatch, trackCompleted);
  }


  /**
   * Aborts a specific inflight request by requestID.
   * No-op if the requestID is not inflight.
   * @param requestID - The dedup/cancellation identifier
   */
  public abort(requestID: RequestID): void {
    const inflight = this._inflight.get(requestID);
    if (inflight) {
      inflight.controller.abort();
    }
    // Also remove from queue if it hasn't dispatched yet
    this._removeFromQueue(requestID);
  }


  /**
   * Aborts every inflight request and clears the queue.
   */
  public abortAll(): void {
    for (const [, inflight] of this._inflight) {
      inflight.controller.abort();
    }
    for (const queued of this._queue) {
      queued.controller.abort();
    }
    this._queue.length = 0;
  }


  /**
   * Aborts all inflight requests whose requestID matches a predicate.
   * Useful for viewport-based cleanup.
   * @param predicate - Function that returns true for requestIDs to abort
   */
  public abortMatching(predicate: (requestID: RequestID) => boolean): void {
    for (const [requestID, inflight] of this._inflight) {
      if (predicate(requestID)) {
        inflight.controller.abort();
      }
    }
    // Also clean up matching queued requests
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (predicate(this._queue[i].requestID)) {
        this._queue[i].controller.abort();
        this._queue.splice(i, 1);
      }
    }
  }

  /**
   * Clears all inflight, queued, and completed requests.
   */
  public clearAll(): void {
    this.abortAll();
    this._completed.clear();
  }

  /**
   * Clears inflight, queued, and completed requests that match a predicate.
   * @param predicate - Function that returns true for requestIDs to abort
   */
  public clearMatching(predicate: (requestID: RequestID) => boolean): void {
    this.abortMatching(predicate);

    for (const requestID of this._completed.keys()) {
      if (predicate(requestID)) {
        this._completed.delete(requestID);
      }
    }
  }


  /**
   * Returns true if any inflight request matches the given predicate.
   * Useful for guards that need to check if any request in a category is active.
   * @param predicate - Function that returns true for matching requestIDs
   * @return  `true` if at least one inflight request matches
   */
  public hasMatching(predicate: (requestID: RequestID) => boolean): boolean {
    for (const requestID of this._inflight.keys()) {
      if (predicate(requestID)) return true;
    }
    return false;
  }


  /**
   * Registers a function that can modify outgoing requests before dispatch.
   * Interceptors run in registration order on the main thread, producing a
   * serializable `RequestInit` that can be sent to a web worker.
   *
   * Common uses: adding Authorization headers, custom logging, or
   * request-level metrics.
   *
   * @param interceptor - Receives (url, init) and returns a (possibly modified) init
   */
  public addRequestInterceptor(interceptor: RequestInterceptor): void {
    this._interceptors.push(interceptor);
  }


  /**
   * Removes a previously registered request interceptor.
   * @param interceptor - The same function reference passed to `addRequestInterceptor`
   */
  public removeRequestInterceptor(interceptor: RequestInterceptor): void {
    const idx = this._interceptors.indexOf(interceptor);
    if (idx !== -1) {
      this._interceptors.splice(idx, 1);
    }
  }


  // -------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------

  /**
   * Creates the tracked promise, registers it in `_inflight`, and either
   * dispatches immediately or queues for later.  Returns the promise
   * that the caller awaits.
   *
   * The `.finally()` cleanup is chained directly onto the returned promise
   * so there is exactly one promise chain — no orphaned branches that
   * could produce unhandled rejections.
   *
   * Queued requests remain abortable while waiting for a concurrency slot;
   * aborting a queued request rejects with `AbortError`.
   *
   * @param requestID - The dedup/cancellation identifier
   * @param controller - The AbortController for this request
   * @param dispatch - Callback that performs the actual fetch, producing an envelope
   * @param trackCompleted - If true, record the outcome in `_completed`
   * @return  A promise that resolves with the request's `FetchEnvelope`
   */
  protected _trackAndDispatch<T>(
    requestID: RequestID,
    controller: AbortController,
    dispatch: () => Promise<FetchEnvelope<T>>,
    trackCompleted: boolean,
  ): Promise<FetchEnvelope<T>> {
    const onResolve = trackCompleted
      ? (env: FetchEnvelope<T>) => this._recordSettled(requestID, env)
      : (env: FetchEnvelope<T>) => env;
    const onReject = trackCompleted
      ? (err: unknown): never => this._recordFailed(requestID, err)
      : (err: unknown): never => { throw err; };

    let promise: Promise<FetchEnvelope<T>>;

    if (this._numActive < this._maxInflight) {
      // Dispatch immediately
      this._numActive++;
      promise = dispatch()
        .then(onResolve, onReject)
        .finally(() => {
          this._numActive--;
          this._inflight.delete(requestID);
          this._drainQueue();
        });
    } else {
      // Queue for later dispatch
      promise = new Promise<FetchEnvelope<T>>((resolve, reject) => {
        if (controller.signal.aborted) {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
          return;
        }

        const queued: QueuedFetch = {
          requestID,
          controller,
          run: () => {
            this._numActive++;
          dispatch()
              .then(onResolve, onReject)
              .finally(() => {
                this._numActive--;
                this._inflight.delete(requestID);
                this._drainQueue();
              })
              .then(resolve as (v: unknown) => void, reject);
          },
        };
        this._queue.push(queued);

        // Listen for abort while queued
        controller.signal.addEventListener('abort', () => {
          this._removeFromQueue(requestID);
          this._inflight.delete(requestID);
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    }

    // Track in inflight map (for dedup and abort)
    const inflight: InflightRequest<T> = { requestID, controller, promise, created: Date.now() };
    this._inflight.set(requestID, inflight);

    return promise;
  }


  /**
   * Records a settled request's status in `completed` and returns the envelope.
   * Called for both successful and HTTP-error envelopes (both carry a status).
   * @param requestID - The request identifier
   * @param env - The settled `FetchEnvelope`
   * @return  The same envelope, for chaining
   */
  protected _recordSettled<T>(requestID: RequestID, env: FetchEnvelope<T>): FetchEnvelope<T> {
    this._completed.set(requestID, env.status);
    return env;
  }


  /**
   * Records a failed request's status in `completed` and re-throws the error.
   * Aborts are *not* recorded (so they remain retryable).  Other failures
   * (transport errors, worker-flattened errors, parse errors) record the
   * error's HTTP status if present, otherwise the `STATUS_ERROR` sentinel.
   * @param requestID - The request identifier
   * @param err - The rejection reason
   * @throws Always re-throws `err`
   */
  protected _recordFailed(requestID: RequestID, err: unknown): never {
    if ((err as { name?: string })?.name !== 'AbortError') {
      const status = (err as { status?: number })?.status ?? STATUS_ERROR;
      this._completed.set(requestID, status);
    }
    throw err;
  }


  /**
   * Combines a manual AbortController signal with a timeout signal.
   * Returns the combined signal, or just the controller's signal if no timeout.
   * @param controller - The manual AbortController
   * @param timeout - Timeout in milliseconds; `0` means no timeout
   * @return  The combined abort signal
   */
  protected _createCombinedSignal(controller: AbortController, timeout: number): AbortSignal {
    if (timeout > 0) {
      return AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    }
    return controller.signal;
  }


  /**
   * Dispatches queued requests as concurrency slots become available.
   */
  protected _drainQueue(): void {
    while (this._queue.length > 0 && this._numActive < this._maxInflight) {
      const queued = this._queue.shift()!;
      // Skip if already aborted while waiting
      if (queued.controller.signal.aborted) continue;
      queued.run();
    }
  }


  /**
   * Removes a queued request by requestID.
   * @param requestID
   */
  protected _removeFromQueue(requestID: RequestID): void {
    const idx = this._queue.findIndex(q => q.requestID === requestID);
    if (idx !== -1) {
      this._queue.splice(idx, 1);
    }
  }


  /**
   * Runs all registered interceptors on the (url, init) pair.
   * Interceptors run in registration order; each receives the output of the previous.
   * @param url - The request URL
   * @param init - The `RequestInit` to transform
   * @return  The final `RequestInit` after all interceptors have run
   */
  protected _applyInterceptors(url: string, init: RequestInit): RequestInit {
    for (const interceptor of this._interceptors) {
      init = interceptor(url, init);
    }
    return init;
  }


  /**
   * Performs the actual fetch, either via worker or main thread.
   *
   * Request interceptors are applied first, producing a serializable
   * `RequestInit` that includes any headers added by interceptors
   * (e.g. Authorization).  This init is safe to send to a web worker.
   *
   * When a named `listenerID` is provided, it is dispatched to the worker
   * (via `dispatch`) when available, or executed directly
   * on the main thread using the registered listener as fallback.
   * If `resultPriority` is set for a named listener, worker results are
   * deferred through `SchedulerSystem`, so cancellation before deferred
   * execution may reject with `AbortError`.
   *
   * Relative URLs are resolved to absolute before dispatching to a worker,
   * because the worker script runs in a different path context and would
   * resolve relative URLs against its own location.
   *
   * @param url - The URL to fetch
   * @param signal - The abort signal for this request
   * @param options - Fetch options + NetworkSystem extensions
   * @return  The fetch outcome as a `FetchEnvelope`
   */
  protected _dispatchFetch<T>(
    url: string,
    signal: AbortSignal,
    options?: NetworkFetchOptions,
  ): Promise<FetchEnvelope<T>> {
    const worker = this.context.systems.worker;

    const fetchFn = options?.fetchFn;
    const mainThread = options?.mainThread ?? false;
    const listenerID = options?.listenerID;
    const listenerData = options?.listenerData;
    const resultPriority = options?.resultPriority;
    const useWorker = worker && worker.workerURL && !fetchFn && !mainThread;

    // Resolve relative URLs to absolute so that worker-dispatched fetches
    // resolve against the page origin, not the worker script's location.
    if (useWorker) {
      url = this._resolveURL(url);
    }

    // Build base init (without signal) and apply interceptors.
    // Interceptors run on the main thread, producing serializable headers
    // (e.g. Authorization) that can be sent to a worker.
    const init = this._applyInterceptors(url, this._buildInit(options));

    // Dispatch to a named listener
    if (listenerID) {
      const payload = { url, init, ...listenerData };
      const dispatchOpts: DispatchOptions | undefined = resultPriority ? { resultPriority } : undefined;

      if (useWorker) {
        return worker.dispatch<FetchEnvelope<T>>(listenerID, payload, signal, dispatchOpts);
      }

      // Main-thread fallback — call the registered listener directly
      const listener = worker?.getListener(listenerID);
      if (listener) {
        return Promise.resolve(listener(payload, signal)) as Promise<FetchEnvelope<T>>;
      }

      return Promise.reject(new Error(`NetworkSystem: listener '${listenerID}' not registered`));
    }

    // Default fetch+parse path
    if (useWorker) {
      return worker.dispatch<FetchEnvelope<T>>('network:fetchAndParse', { url, init }, signal);
    } else {
      const actualFetchFn = fetchFn ?? globalThis.fetch;
      init.signal = signal;
      return fetchEnvelope<T>(actualFetchFn, url, init, utilFetchResponse as (r: Response) => Promise<T>);
    }
  }


  /**
   * Resolves a potentially relative URL to an absolute URL using the
   * page's base URI.  This ensures that when a URL is dispatched to a
   * web worker, it resolves against the main page's origin rather than
   * the worker script's location.
   *
   * Absolute URLs (http://, https://, data:, blob:) pass through unchanged.
   *
   * @param url - The possibly-relative URL to resolve
   * @return  The absolute URL
   */
  protected _resolveURL(url: string): string {
    if (/^(https?|data|blob):/i.test(url)) return url;
    try {
      return new URL(url, globalThis.location?.href).href;
    } catch {
      return url;  // If URL construction fails, return as-is
    }
  }


  /**
   * Builds a `RequestInit` from the options, excluding NetworkSystem-specific keys.
   * @param options - Fetch options + NetworkSystem extensions
   * @param signal - Optional abort signal to attach to the init
   * @return  A plain `RequestInit` suitable for `fetch`
   */
  protected _buildInit(options?: NetworkFetchOptions, signal?: AbortSignal): RequestInit {
    if (!options) return signal ? { signal } : {};

    // Rename the NetworkSystem-specific keys - the rest becomes RequestInit
    const {
      requestID: _rid,
      timeout: _to,
      fetchFn: _fn,
      mainThread: _mt,
      listenerID: _lid,
      listenerData: _td,
      resultPriority: _rp,
      ...init
    } = options;

    if (signal) {
      (init as RequestInit).signal = signal;
    }
    return init as RequestInit;
  }
}
