import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Handle returned by `scheduleIdleTask`, used to cancel it */
type IdleTaskHandle = number;

/** A deferred idle task, with its rejection callback for cleanup */
interface IdleTask {
  reject: () => void;
}

/** Opaque cancel function returned by `scheduleTimeout` and `scheduleInterval` */
type CancelFn = () => void;

/** Callback registered to run once per frame in the game loop */
type FrameCallback = (deltaMS: number) => void;

/**
 * Maximum deltaMS we'll report between frames.
 * Prevents huge jumps after tab switches, debugger pauses, or context loss recovery.
 */
const MAX_DELTA_MS = 100;


/**
 * `SchedulerSystem` centralizes deferred and background work scheduling.
 *
 * **Game loop** — Owns the `requestAnimationFrame` loop.  Other systems
 * (notably GraphicsSystem) register frame callbacks that the scheduler
 * calls each frame with the elapsed time (`deltaMS`).
 *
 * **Idle scheduling** — Wraps `requestIdleCallback` / `cancelIdleCallback`
 * behind a managed interface, so callers don't need to track handles or
 * deal with polyfill quirks.  When the system is paused, new idle tasks
 * are queued and deferred until the system resumes.
 *
 * **Timer management** — Wraps `setTimeout` / `setInterval` so callers
 * don't need to track handles.  All managed timers are automatically
 * cancelled on `resetAsync()`.
 *
 * **Worker management** (future) — Will spawn, pool, and message web
 * workers so that CPU-heavy work (validation, spatial indexing, etc.) can
 * be offloaded from the main thread through a single coordination point.
 *
 * Events available:
 *   `paused`    Fires when the system transitions from unpaused to paused
 *   `resumed`   Fires when the system transitions from paused to unpaused
 */
export class SchedulerSystem extends AbstractSystem {
  // Game loop
  /** Registered frame callbacks, keyed by a string identifier */
  private _frameCallbacks: Map<string, FrameCallback>;
  /** The handle from `requestAnimationFrame`, or 0 if the loop is not running */
  private _rafHandle: number;
  /** Timestamp of the previous frame (from the rAF callback), for computing deltaMS */
  private _lastTimestamp: number;
  /** Milliseconds elapsed since the previous frame */
  private _deltaMS: number;

  // Idle tasks
  /** Active idle tasks keyed by their requestIdleCallback handle */
  private _idleTasks: Map<IdleTaskHandle, IdleTask>;
  /** Tasks that arrived while paused — will be scheduled on resume */
  private _pendingTasks: Array<{ fn: () => void; resolve: () => void; reject: () => void }>;

  // Timers
  /** Active managed timeouts keyed by their setTimeout handle */
  private _timeouts: Set<ReturnType<typeof setTimeout>>;
  /** Active managed intervals keyed by their setInterval handle */
  private _intervals: Set<ReturnType<typeof setInterval>>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'scheduler';
    // No required dependencies — this system should be available very early.
    this.requiredDependencies = new Set();
    this.optionalDependencies = new Set();

    this._frameCallbacks = new Map();
    this._rafHandle = 0;
    this._lastTimestamp = 0;
    this._deltaMS = 0;

    this._idleTasks = new Map();
    this._pendingTasks = [];
    this._timeouts = new Set();
    this._intervals = new Set();
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => {
        this.on('resumed', () => {
          this._drainPending();
          this._startLoop();
        });
        this.on('paused', () => {
          this._stopLoop();
        });
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    return this._startPromise = super.startAsync()
      .then(() => {
        this._startLoop();
      });
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state.
   * Cancels all transient work (idle tasks, timers) but preserves
   * frame callbacks and the game loop — those are structural registrations.
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    this.cancelAllIdleTasks();
    this.cancelAllTimeouts();
    this.cancelAllIntervals();
    return Promise.resolve();
  }


  /**
   * scheduleIdleTask
   * Schedules a function to run during the browser's idle time.
   * Returns a Promise that resolves after the task has executed.
   *
   * If the system is paused, the task is held until resumption.
   *
   * @param fn - The function to execute during idle time
   * @return Promise resolved after the task completes
   */
  scheduleIdleTask(fn: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._paused) {
        this._pendingTasks.push({ fn, resolve, reject });
        return;
      }
      this._scheduleOne(fn, resolve, reject);
    });
  }


  /**
   * cancelAllIdleTasks
   * Cancels every outstanding idle task and rejects pending tasks.
   * Useful during reset or teardown.
   */
  cancelAllIdleTasks(): void {
    // Cancel tasks already scheduled with requestIdleCallback
    for (const [handle, task] of this._idleTasks) {
      globalThis.cancelIdleCallback(handle);
      task.reject();
    }
    this._idleTasks.clear();

    // Reject tasks queued while paused
    for (const pending of this._pendingTasks) {
      pending.reject();
    }
    this._pendingTasks = [];
  }


  /**
   * numPending
   * Number of idle tasks that are either scheduled or waiting to be scheduled.
   * Useful for debugging and tests.
   * @readonly
   */
  get numPending(): number {
    return this._idleTasks.size + this._pendingTasks.length;
  }


  /**
   * scheduleTimeout
   * Managed wrapper around `setTimeout`.  Returns a cancel function.
   * The timeout is automatically cancelled on `resetAsync()`.
   *
   * @param fn - The function to execute after the delay
   * @param ms - Delay in milliseconds (default 0)
   * @return A cancel function that clears the timeout
   */
  scheduleTimeout(fn: () => void, ms: number = 0): CancelFn {
    let handle: ReturnType<typeof setTimeout> | null = null;

    handle = globalThis.setTimeout(() => {
      this._timeouts.delete(handle!);
      handle = null;
      fn();
    }, ms);

    this._timeouts.add(handle);

    return () => {
      if (handle !== null) {
        globalThis.clearTimeout(handle);
        this._timeouts.delete(handle);
        handle = null;
      }
    };
  }


  /**
   * cancelAllTimeouts
   * Cancels every outstanding managed timeout.
   */
  cancelAllTimeouts(): void {
    for (const handle of this._timeouts) {
      globalThis.clearTimeout(handle);
    }
    this._timeouts.clear();
  }


  /**
   * numTimeouts
   * Number of active managed timeouts.
   * Useful for debugging and tests.
   * @readonly
   */
  get numTimeouts(): number {
    return this._timeouts.size;
  }


  /**
   * scheduleInterval
   * Managed wrapper around `setInterval`.  Returns a cancel function.
   * The interval is automatically cancelled on `resetAsync()`.
   *
   * @param fn - The function to execute on each interval tick
   * @param ms - Interval in milliseconds
   * @return A cancel function that clears the interval
   */
  scheduleInterval(fn: () => void, ms: number): CancelFn {
    const handle = globalThis.setInterval(fn, ms);
    this._intervals.add(handle);

    return () => {
      globalThis.clearInterval(handle);
      this._intervals.delete(handle);
    };
  }


  /**
   * cancelAllIntervals
   * Cancels every outstanding managed interval.
   */
  cancelAllIntervals(): void {
    for (const handle of this._intervals) {
      globalThis.clearInterval(handle);
    }
    this._intervals.clear();
  }


  /**
   * numIntervals
   * Number of active managed intervals.
   * Useful for debugging and tests.
   * @readonly
   */
  get numIntervals(): number {
    return this._intervals.size;
  }


  /**
   * deltaMS
   * Milliseconds elapsed since the previous frame.
   * Useful for frame-rate-independent calculations.
   * @readonly
   */
  get deltaMS(): number {
    return this._deltaMS;
  }


  /**
   * addFrameCallback
   * Registers a callback to run once per frame in the game loop.
   * The callback receives `deltaMS` — milliseconds since the previous frame.
   *
   * @param id - A unique string identifier (e.g. `'gfx'`)
   * @param fn - The callback to invoke each frame
   */
  addFrameCallback(id: string, fn: FrameCallback): void {
    this._frameCallbacks.set(id, fn);
  }


  /**
   * removeFrameCallback
   * Unregisters a previously registered frame callback.
   *
   * @param id - The identifier passed to `addFrameCallback`
   */
  removeFrameCallback(id: string): void {
    this._frameCallbacks.delete(id);
  }


  /**
   * numFrameCallbacks
   * Number of registered frame callbacks.
   * Useful for debugging and tests.
   * @readonly
   */
  get numFrameCallbacks(): number {
    return this._frameCallbacks.size;
  }


  /**
   * _scheduleOne
   * Internal: registers a single task with requestIdleCallback.
   */
  private _scheduleOne(fn: () => void, resolve: () => void, reject: () => void): void {
    const handle = globalThis.requestIdleCallback(() => {
      this._idleTasks.delete(handle);
      fn();
      resolve();
    });
    this._idleTasks.set(handle, { reject });
  }


  /**
   * _drainPending
   * Called on 'resumed' — schedules all tasks that were queued while paused.
   */
  private _drainPending(): void {
    const tasks = this._pendingTasks;
    this._pendingTasks = [];
    for (const { fn, resolve, reject } of tasks) {
      this._scheduleOne(fn, resolve, reject);
    }
  }


  /**
   * _startLoop
   * Starts the `requestAnimationFrame` game loop if it isn't already running.
   */
  private _startLoop(): void {
    if (!this._started) return;
    if (this._rafHandle) return;  // already running
    this._lastTimestamp = 0;
    this._rafHandle = globalThis.requestAnimationFrame((ts) => this._onFrame(ts));
  }


  /**
   * _stopLoop
   * Stops the `requestAnimationFrame` game loop.
   */
  private _stopLoop(): void {
    if (this._rafHandle) {
      globalThis.cancelAnimationFrame(this._rafHandle);
      this._rafHandle = 0;
    }
  }


  /**
   * _onFrame
   * The core game loop callback, driven by `requestAnimationFrame`.
   * Computes `deltaMS` from the browser-provided timestamp and calls
   * all registered frame callbacks.
   *
   * @param timestamp - `DOMHighResTimeStamp` from `requestAnimationFrame`
   */
  private _onFrame(timestamp: DOMHighResTimeStamp): void {
    // Schedule next frame first (standard game loop pattern).
    // If something pauses us during a callback, _stopLoop will cancel it.
    this._rafHandle = globalThis.requestAnimationFrame((ts) => this._onFrame(ts));

    // Compute deltaMS from the rAF timestamp, capped to avoid huge jumps
    // (e.g., after a tab switch, debugger pause, or context loss recovery).
    const deltaMS = this._lastTimestamp > 0 ? Math.min(timestamp - this._lastTimestamp, MAX_DELTA_MS) : 0;
    this._lastTimestamp = timestamp;
    this._deltaMS = deltaMS;

    // Call registered frame callbacks
    for (const [id, fn] of this._frameCallbacks) {
      try {
        fn(deltaMS);
      } catch (e) {
        console.error(`SchedulerSystem: frame callback '${id}' threw:`, e);  // eslint-disable-line no-console
      }
    }
  }
}
