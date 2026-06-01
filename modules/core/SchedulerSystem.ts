import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Task priority — determines scheduling order within each frame */
type TaskPriority = 'urgent' | 'normal' | 'idle';

/** Pressure levels from least to most severe */
type PressureLevel = 'none' | 'light' | 'moderate' | 'heavy';

/** Frame timing metrics exposed to consumers */
interface FrameMetrics {
  /** Exponential moving average of total frame time (ms) */
  avgFrameTime: number;
  /** EMA of frame callback time — APP + DRAW (ms) */
  avgRenderTime: number;
  /** EMA of queue drain time (ms) */
  avgIdleTime: number;
  /** Count of over-budget frames in the recent window */
  droppedFrames: number;
  /** Current target frame time (ms) */
  targetFrameTime: number;
  /** Current pressure level */
  pressure: PressureLevel;
}

/** A task waiting in an internal queue */
interface QueuedTask {
  workID?: WorkID;
  fn: () => void;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

/** Options for the general `schedule()` API */
interface ScheduleOptions {
  priority?: TaskPriority;
  workID?: WorkID;
}

/** Options for the workID-based timer methods */
interface TimerOptions {
  /** Delay or interval in milliseconds (default varies by method) */
  ms?: number;
  /** Which queue the matured task goes into (default `'normal'`) */
  priority?: TaskPriority;
  /** For debounce: fire on leading edge (default `false`) */
  leading?: boolean;
}

/** Internal tracking entry for a workID-keyed timer */
interface TimerEntry {
  workID: WorkID;
  type: 'timeout' | 'interval' | 'debounce' | 'throttle';
  fn: () => void;
  ms: number;
  priority: TaskPriority;
  handle: ReturnType<typeof globalThis.setTimeout> | null;
  leading: boolean;
  /** Throttle: the most recent fn passed during the throttle window */
  trailingFn: (() => void) | null;
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

/** Default target: 60fps */
const DEFAULT_TARGET_FRAME_TIME = 1000 / 60;

/**
 * EMA smoothing factor for frame timing metrics.
 * alpha = 2 / (N + 1) where N is the effective window.
 * 0.05 ≈ 39-frame window — responsive without jitter.
 */
const EMA_ALPHA = 0.05;

/**
 * Number of recent frames to track for dropped-frame ratio.
 * At 60fps this is ~1 second of history.
 */
const PRESSURE_WINDOW = 60;

/** Dropped-frame ratio thresholds for escalating pressure */
const PRESSURE_ESCALATE = {
  light:    0.15,   // 9+ of 60 frames dropped
  moderate: 0.35,   // 21+ of 60 frames dropped
  heavy:    0.50,   // 30+ of 60 frames dropped
} as const;

/** Dropped-frame ratio thresholds for recovering (lower = more hysteresis) */
const PRESSURE_RECOVER = {
  heavy:    0.40,   // heavy → moderate when below 40%
  moderate: 0.20,   // moderate → light when below 20%
  light:    0.05,   // light → none when below 5%
} as const;


/**
 * `SchedulerSystem` centralizes deferred and background work scheduling.
 *
 * **Game loop** — Owns the `requestAnimationFrame` loop.  Other systems
 * (notably `GraphicsSystem`) register frame callbacks that the scheduler
 * calls each frame with the elapsed time (`deltaMS`).
 *
 * **Task scheduling** — Queued tasks are drained at the end of each frame
 * within the remaining frame budget.  Callers specify priority:
 *   - `'urgent'`  — always runs this frame, even if over budget
 *   - `'normal'`  — runs if budget remains after urgent tasks
 *   - `'idle'`    — runs only if budget remains after normal tasks
 *
 * **Timer management** — Wraps `setTimeout` / `setInterval` so callers
 * don't need to track handles.  Additionally provides `workID`-keyed
 * timer methods — `setTimeout`, `setInterval`, `debounce`, `throttle` —
 * where expired timers float into the priority queue instead of firing
 * directly.  All managed timers are automatically cancelled on
 * `resetAsync()`.
 *
 * **Worker management** — Spawns, pools, and messages web workers so
 * that CPU-heavy work (validation, spatial indexing, etc.) can be
 * offloaded from the main thread.  Host app sets `workerURL` to the
 * built worker script, then calls `dispatch(listenerID, data)`
 * to dispatch serializable tasks.  Workers are spawned lazily up to
 * `maxWorkers` and terminated on `resetAsync()`.
 *
 * Events available:
 *   `paused`    Fires when the system transitions from unpaused to paused
 *   `resumed`   Fires when the system transitions from paused to unpaused
 *   `pressure`  Fires when backpressure level changes
 */
export class SchedulerSystem extends AbstractSystem {

  /** Registered frame callbacks, keyed by a string identifier */
  protected _frameCallbacks: Map<string, FrameCallback>;
  /** The handle from `requestAnimationFrame`, or 0 if the loop is not running */
  protected _rafHandle: number;
  /** Timestamp of the previous frame (from the rAF callback), for computing deltaMS */
  protected _lastTimestamp: number;
  /** Milliseconds elapsed since the previous frame */
  protected _deltaMS: number;
  /** Target frame time in milliseconds — determines idle budget */
  protected _targetFrameTime: number;

  // Task queues (drained per-frame in priority order)
  /** Highest-priority tasks that will run before rendering this frame */
  protected _urgentQueue: QueuedTask[];
  /** Normal-priority tasks run after urgent work when time allows */
  protected _normalQueue: QueuedTask[];
  /** Low-priority tasks run only during idle time at the end of a frame */
  protected _idleQueue: QueuedTask[];

  // workID-keyed timers (timeout, interval, debounce, throttle)
  /** Named timers (timeout / interval / debounce / throttle) keyed by workID */
  protected _timers: Map<string, TimerEntry>;

  // Legacy handle-based timers (Phase 1 API — still used by existing callers)
  /** Active managed timeouts keyed by their setTimeout handle */
  protected _timeouts: Set<ReturnType<typeof setTimeout>>;
  /** Active managed intervals keyed by their setInterval handle */
  protected _intervals: Set<ReturnType<typeof setInterval>>;

  // Backpressure — frame timing metrics and pressure tracking
  /** EMA of total frame time (ms) */
  protected _avgFrameTime: number;
  /** EMA of frame callback time (ms) */
  protected _avgRenderTime: number;
  /** EMA of queue drain time (ms) */
  protected _avgIdleTime: number;
  /** Ring buffer: true if that frame exceeded the budget */
  protected _droppedFrameRing: boolean[];
  /** Write index into the ring buffer */
  protected _ringIndex: number;
  /** Cached count of `true` values in the ring buffer */
  protected _droppedCount: number;
  /** Current pressure level */
  protected _pressure: PressureLevel;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'scheduler';
    // No required dependencies — this system should be available very early.
    this.requiredDependencies = new Set();
    this.optionalDependencies = new Set();

    this._frameCallbacks = new Map();
    this._rafHandle = 0;
    this._lastTimestamp = 0;
    this._deltaMS = 0;
    this._targetFrameTime = DEFAULT_TARGET_FRAME_TIME;

    this._urgentQueue = [];
    this._normalQueue = [];
    this._idleQueue = [];

    this._timers = new Map();

    this._timeouts = new Set();
    this._intervals = new Set();

    this._avgFrameTime = 0;
    this._avgRenderTime = 0;
    this._avgIdleTime = 0;
    this._droppedFrameRing = new Array<boolean>(PRESSURE_WINDOW).fill(false);
    this._ringIndex = 0;
    this._droppedCount = 0;
    this._pressure = 'none';

  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => {
        this.on('resumed', () => {
          this._startLoop();
        });
        this.on('paused', () => {
          this._stopLoop();
        });
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    return this._startPromise = super.startAsync()
      .then(() => {
        this._startLoop();
      });
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * Cancels all transient work (idle tasks, timers) but preserves
   * frame callbacks and the game loop — those are structural registrations.
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    this.cancelAllIdleTasks();
    this.cancelAllTimers();
    this.cancelAllTimeouts();
    this.cancelAllIntervals();

    // Reset backpressure metrics so recovered state doesn't carry over
    this._avgFrameTime = 0;
    this._avgRenderTime = 0;
    this._avgIdleTime = 0;
    this._droppedFrameRing.fill(false);
    this._ringIndex = 0;
    this._droppedCount = 0;
    if (this._pressure !== 'none') {
      this._pressure = 'none';
      this.emit('pressure', 'none');
    }

    return Promise.resolve();
  }


  /**
   * Queues a function to run at the end of a future frame within the
   * remaining frame budget.  Returns a Promise that resolves after the
   * task has executed.
   *
   * Priority controls ordering:
   *   - `'urgent'`  — always runs this frame, even if over budget
   *   - `'normal'`  — runs if budget remains after urgent tasks (default)
   *   - `'idle'`    — runs only if budget remains after normal tasks
   *
   * Tasks queued while the system is paused accumulate and drain
   * automatically when the game loop resumes.
   *
   * @param fn - The function to execute
   * @param opts - Scheduling options (priority, etc.)
   * @return Promise resolved after the task completes, rejected if the
   *         task throws or is cancelled
   */
  public schedule(fn: () => void, opts?: ScheduleOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const task: QueuedTask = { workID: opts?.workID, fn, resolve, reject };
      const priority = opts?.priority ?? 'normal';
      switch (priority) {
        case 'urgent':  this._urgentQueue.push(task);  break;
        case 'normal':  this._normalQueue.push(task);  break;
        case 'idle':    this._idleQueue.push(task);    break;
      }
    });
  }


  /**
   * Convenience wrapper — equivalent to `schedule(fn, { priority: 'idle' })`.
   *
   * @param fn - The function to execute during idle time
   * @return Promise resolved after the task completes
   */
  public scheduleIdleTask(fn: () => void): Promise<void> {
    return this.schedule(fn, { priority: 'idle' });
  }


  /**
   * Cancels every outstanding queued task (urgent, normal, and idle)
   * and rejects their promises.  Useful during reset or teardown.
   */
  public cancelAllIdleTasks(): void {
    const queues = [this._urgentQueue, this._normalQueue, this._idleQueue];
    for (const queue of queues) {
      for (const task of queue) {
        task.reject();
      }
      queue.length = 0;
    }
  }


  /**
   * Total number of tasks waiting in all priority queues.
   * Useful for debugging and tests.
   * @return  Total pending task count across urgent, normal, and idle queues
   * @readonly
   */
  public get numPending(): number {
    return this._urgentQueue.length + this._normalQueue.length + this._idleQueue.length;
  }


  /**
   * Target frame duration in milliseconds.  Tasks are drained at the end
   * of each frame only while `performance.now()` is below the deadline
   * (`frameStart + targetFrameTime`).  Defaults to ~16.7ms (60 fps).
   * @return  Target frame budget in milliseconds
   */
  public get targetFrameTime(): number {
    return this._targetFrameTime;
  }
  /** Sets the target frame time budget in milliseconds (minimum 1 ms).
   * @param ms - Frame budget in milliseconds; values below 1 are clamped to 1
   */
  public set targetFrameTime(ms: number) {
    this._targetFrameTime = Math.max(1, ms);
  }


  // -------------------------------------------------------
  // workID-keyed timer API
  //
  // These methods track timers by a string key (`workID`).
  // When a timer matures, its task enters the priority queue
  // ("float") rather than firing directly — so execution is
  // synchronized with the game loop's frame budget.
  //
  // Cancel by name: `scheduler.cancel(workID)`
  // Cancel all:     `scheduler.cancelAllTimers()`
  // -------------------------------------------------------

  /**
   * Schedules `fn` to run once after `ms` milliseconds.  When the timer
   * expires, the task enters the priority queue and runs at the next
   * frame's drain phase.
   *
   * Calling again with the same `workID` cancels the previous timer and
   * starts a new one.
   *
   * @param workID - Unique string key for tracking / cancellation
   * @param fn - The function to execute
   * @param opts - Timer options (`ms`, `priority`)
   */
  public setTimeout(workID: WorkID, fn: () => void, opts?: TimerOptions): void {
    this.cancel(workID);

    const ms = opts?.ms ?? 0;
    const priority = opts?.priority ?? 'normal';

    const handle = globalThis.setTimeout(() => {
      this._timers.delete(workID);
      this._enqueue(fn, priority, workID);
    }, ms);

    this._timers.set(workID, {
      workID, type: 'timeout', fn, ms, priority, handle,
      leading: false, trailingFn: null,
    });
  }


  /**
   * Schedules `fn` to run repeatedly every `ms` milliseconds.  Each tick
   * enters the priority queue rather than firing directly.
   *
   * Calling again with the same `workID` cancels the previous interval
   * and starts a new one.
   *
   * @param workID - Unique string key for tracking / cancellation
   * @param fn - The function to execute on each tick
   * @param opts - Timer options (`ms`, `priority`)
   */
  public setInterval(workID: WorkID, fn: () => void, opts?: TimerOptions): void {
    this.cancel(workID);

    const ms = opts?.ms ?? 1000;
    const priority = opts?.priority ?? 'normal';

    // Use globalThis.setInterval — each tick pushes into the queue
    const handle = globalThis.setInterval(() => {
      this._enqueue(fn, priority, workID);
    }, ms) as unknown as ReturnType<typeof globalThis.setTimeout>;
    // Note: setInterval and setTimeout return the same handle type in practice,
    // but TypeScript may distinguish them.  The cast keeps the TimerEntry uniform.

    this._timers.set(workID, {
      workID, type: 'interval', fn, ms, priority, handle,
      leading: false, trailingFn: null,
    });
  }


  /**
   * Resets a timer on each call.  When `ms` elapses without another call,
   * the task enters the priority queue.
   *
   * Calling again with the same `workID` resets the timer and replaces
   * the function — this is the core debounce behavior.
   *
   * With `leading: true`, the function fires immediately on the first
   * call, then debounces subsequent calls.
   *
   * @param workID - Unique string key for tracking / cancellation
   * @param fn - The function to execute after the quiet period
   * @param opts - Timer options (`ms`, `priority`, `leading`)
   */
  public debounce(workID: WorkID, fn: () => void, opts?: TimerOptions): void {
    const ms = opts?.ms ?? 250;
    const priority = opts?.priority ?? 'normal';
    const leading = opts?.leading ?? false;

    const existing = this._timers.get(workID);

    if (existing?.type === 'debounce') {
      // Subsequent call — reset the timer, update fn
      if (existing.handle !== null) {
        globalThis.clearTimeout(existing.handle);
      }
      existing.fn = fn;
      existing.handle = globalThis.setTimeout(() => {
        this._timers.delete(workID);
        this._enqueue(existing.fn, priority, workID);
      }, ms);
      return;
    }

    // First call with this workID (or replacing a different timer type)
    this.cancel(workID);

    // Leading edge: fire immediately
    if (leading) {
      this._enqueue(fn, priority, workID);
    }

    // Set up the trailing timer
    const handle = globalThis.setTimeout(() => {
      this._timers.delete(workID);
      // If leading-only (no subsequent calls), don't double-fire.
      // Subsequent calls reset via the branch above, so if the original
      // timer fires it means no subsequent calls happened.
      if (!leading) {
        this._enqueue(fn, priority, workID);
      }
    }, ms);

    this._timers.set(workID, {
      workID, type: 'debounce', fn, ms, priority, handle,
      leading, trailingFn: null,
    });
  }


  /**
   * Fires `fn` on the leading edge, then ignores calls for `ms`
   * milliseconds.  The last call during the window fires on the trailing
   * edge when the window expires.
   *
   * With `leading: false`, the first call is deferred to the trailing
   * edge instead of firing immediately.
   *
   * Calling again with the same `workID` during the window stores the
   * latest `fn` as the trailing call.
   *
   * @param workID - Unique string key for tracking / cancellation
   * @param fn - The function to execute
   * @param opts - Timer options (`ms`, `priority`, `leading`)
   */
  public throttle(workID: WorkID, fn: () => void, opts?: TimerOptions): void {
    const ms = opts?.ms ?? 250;
    const priority = opts?.priority ?? 'normal';
    const leading = opts?.leading ?? true;

    const existing = this._timers.get(workID);

    if (existing?.type === 'throttle' && existing.handle !== null) {
      // Within the throttle window — save as trailing
      existing.trailingFn = fn;
      return;
    }

    // Not in a window (first call or window expired)
    this.cancel(workID);

    // Fire on leading edge (if enabled), otherwise save as trailing
    if (leading) {
      this._enqueue(fn, priority, workID);
    }

    // Start the throttle window
    const entry: TimerEntry = {
      workID, type: 'throttle', fn, ms, priority, handle: null,
      leading, trailingFn: leading ? null : fn,
    };
    entry.handle = globalThis.setTimeout(() => this._throttleWindowExpired(entry), ms);
    this._timers.set(workID, entry);
  }


  /**
   * Cancels all pending work associated with `workID` — both the timer
   * entry (if any) and any queued tasks bearing that workID.
   *
   * @param workID - The work identifier to cancel
   */
  public cancel(workID: WorkID): void {
    const entry = this._timers.get(workID);
    if (entry) {
      if (entry.handle !== null) {
        if (entry.type === 'interval') {
          globalThis.clearInterval(entry.handle as unknown as ReturnType<typeof globalThis.setInterval>);
        } else {
          globalThis.clearTimeout(entry.handle);
        }
      }
      this._timers.delete(workID);
    }
    this._removeFromQueues(workID);
  }


  /**
   * Cancels every outstanding workID-keyed timer and removes their
   * queued tasks.  Called automatically by `resetAsync()`.
   */
  public cancelAllTimers(): void {
    for (const entry of this._timers.values()) {
      if (entry.handle !== null) {
        if (entry.type === 'interval') {
          globalThis.clearInterval(entry.handle as unknown as ReturnType<typeof globalThis.setInterval>);
        } else {
          globalThis.clearTimeout(entry.handle);
        }
      }
    }
    this._timers.clear();
  }


  /**
   * Number of active workID-keyed timers.
   * Useful for debugging and tests.
   * @return  Count of active named timers
   * @readonly
   */
  public get numTimers(): number {
    return this._timers.size;
  }


  /**
   * Managed wrapper around `setTimeout`.  Returns a cancel function.
   * The timeout is automatically cancelled on `resetAsync()`.
   *
   * @param fn - The function to execute after the delay
   * @param ms - Delay in milliseconds (default 0)
   * @return A cancel function that clears the timeout
   */
  public scheduleTimeout(fn: () => void, ms: number = 0): CancelFn {
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
   * Cancels every outstanding managed timeout.
   */
  public cancelAllTimeouts(): void {
    for (const handle of this._timeouts) {
      globalThis.clearTimeout(handle);
    }
    this._timeouts.clear();
  }


  /**
   * Number of active managed timeouts.
   * Useful for debugging and tests.
   * @return  Count of active managed timeouts
   * @readonly
   */
  public get numTimeouts(): number {
    return this._timeouts.size;
  }


  /**
   * Managed wrapper around `setInterval`.  Returns a cancel function.
   * The interval is automatically cancelled on `resetAsync()`.
   *
   * @param fn - The function to execute on each interval tick
   * @param ms - Interval in milliseconds
   * @return A cancel function that clears the interval
   */
  public scheduleInterval(fn: () => void, ms: number): CancelFn {
    const handle = globalThis.setInterval(fn, ms);
    this._intervals.add(handle);

    return () => {
      globalThis.clearInterval(handle);
      this._intervals.delete(handle);
    };
  }


  /**
   * Cancels every outstanding managed interval.
   */
  public cancelAllIntervals(): void {
    for (const handle of this._intervals) {
      globalThis.clearInterval(handle);
    }
    this._intervals.clear();
  }


  /**
   * Number of active managed intervals.
   * Useful for debugging and tests.
   * @return  Count of active managed intervals
   * @readonly
   */
  public get numIntervals(): number {
    return this._intervals.size;
  }


  /**
   * Milliseconds elapsed since the previous frame.
   * Useful for frame-rate-independent calculations.
   * @return  Delta time in milliseconds
   * @readonly
   */
  public get deltaMS(): number {
    return this._deltaMS;
  }


  /**
   * Current backpressure level.  The scheduler automatically adjusts
   * idle-queue draining based on this level and emits `'pressure'`
   * events when the level changes.
   * @return  Current `PressureLevel`
   * @readonly
   */
  public get pressure(): PressureLevel {
    return this._pressure;
  }


  /**
   * Snapshot of the current frame timing metrics.
   * All time values are in milliseconds.
   * @return  `FrameMetrics` snapshot for the current frame
   * @readonly
   */
  public get metrics(): FrameMetrics {
    return {
      avgFrameTime: this._avgFrameTime,
      avgRenderTime: this._avgRenderTime,
      avgIdleTime: this._avgIdleTime,
      droppedFrames: this._droppedCount,
      targetFrameTime: this._targetFrameTime,
      pressure: this._pressure,
    };
  }


  /**
   * Registers a callback to run once per frame in the game loop.
   * The callback receives `deltaMS` — milliseconds since the previous frame.
   *
   * @param id - A unique string identifier (e.g. `'gfx'`)
   * @param fn - The callback to invoke each frame
   */
  public addFrameCallback(id: string, fn: FrameCallback): void {
    this._frameCallbacks.set(id, fn);
  }


  /**
   * Unregisters a previously registered frame callback.
   *
   * @param id - The identifier passed to `addFrameCallback`
   */
  public removeFrameCallback(id: string): void {
    this._frameCallbacks.delete(id);
  }


  /**
   * Number of registered frame callbacks.
   * Useful for debugging and tests.
   * @return  Count of active frame callbacks
   * @readonly
   */
  public get numFrameCallbacks(): number {
    return this._frameCallbacks.size;
  }


  /**
   * Pushes a fire-and-forget task into the appropriate priority queue.
   * Used by the workID-based timer methods when a timer matures.
   * Unlike `schedule()`, this does not return a Promise.
   *
   * @param fn - The function to execute
   * @param priority - Which queue to use
   * @param workID - Optional workID for cancellation support
   */
  protected _enqueue(fn: () => void, priority: TaskPriority, workID?: WorkID): void {
    const task: QueuedTask = {
      workID,
      fn,
      resolve: () => {},
      reject: (e) => {
        if (e !== undefined) {
          console.error(`SchedulerSystem: task '${workID ?? 'anonymous'}' threw:`, e);  // eslint-disable-line no-console
        }
      },
    };
    switch (priority) {
      case 'urgent':  this._urgentQueue.push(task);  break;
      case 'normal':  this._normalQueue.push(task);  break;
      case 'idle':    this._idleQueue.push(task);    break;
    }
  }


  /**
   * Removes all queued tasks matching `workID` from every priority queue
   * and rejects their promises.
   *
   * @param workID - The work identifier to remove
   */
  protected _removeFromQueues(workID: WorkID): void {
    for (const queue of [this._urgentQueue, this._normalQueue, this._idleQueue]) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].workID === workID) {
          const [task] = queue.splice(i, 1);
          task.reject();
        }
      }
    }
  }


  /**
   * Called when a throttle window timer fires.  If a trailing call was
   * recorded during the window, fire it and start a new window.
   * Otherwise, clean up the timer entry.
   *
   * @param entry - The throttle TimerEntry
   */
  protected _throttleWindowExpired(entry: TimerEntry): void {
    if (entry.trailingFn) {
      const fn = entry.trailingFn;
      entry.trailingFn = null;
      this._enqueue(fn, entry.priority, entry.workID);

      // Start a new throttle window
      entry.handle = globalThis.setTimeout(() => this._throttleWindowExpired(entry), entry.ms);
    } else {
      // No trailing call — clean up
      entry.handle = null;
      this._timers.delete(entry.workID);
    }
  }


  /**
   * Starts the `requestAnimationFrame` game loop if it isn't already running.
   */
  protected _startLoop(): void {
    if (!this._started) return;
    if (this._rafHandle) return;  // already running
    this._lastTimestamp = 0;
    this._rafHandle = globalThis.requestAnimationFrame((ts) => this._onFrame(ts));
  }


  /**
   * Stops the `requestAnimationFrame` game loop.
   */
  protected _stopLoop(): void {
    if (this._rafHandle) {
      globalThis.cancelAnimationFrame(this._rafHandle);
      this._rafHandle = 0;
    }
  }


  /**
   * The core game loop callback, driven by `requestAnimationFrame`.
   * Computes `deltaMS` from the browser-provided timestamp, calls
   * all registered frame callbacks, then drains queued tasks with
   * whatever frame budget remains.
   *
   * @param timestamp - `DOMHighResTimeStamp` from `requestAnimationFrame`
   */
  protected _onFrame(timestamp: DOMHighResTimeStamp): void {
    // Schedule next frame first (standard game loop pattern).
    // If something pauses us during a callback, _stopLoop will cancel it.
    this._rafHandle = globalThis.requestAnimationFrame((ts) => this._onFrame(ts));

    // Compute deltaMS from the rAF timestamp, capped to avoid huge jumps
    // (e.g., after a tab switch, debugger pause, or context loss recovery).
    const deltaMS = this._lastTimestamp > 0 ? Math.min(timestamp - this._lastTimestamp, MAX_DELTA_MS) : 0;
    this._lastTimestamp = timestamp;
    this._deltaMS = deltaMS;

    const frameStart = performance.now();

    // Call registered frame callbacks
    for (const [id, fn] of this._frameCallbacks) {
      try {
        fn(deltaMS);
      } catch (e) {
        console.error(`SchedulerSystem: frame callback '${id}' threw:`, e);  // eslint-disable-line no-console
      }
    }

    const renderEnd = performance.now();

    // Drain queued tasks with remaining frame budget
    const deadline = timestamp + this._targetFrameTime;
    this._drainQueues(deadline);

    const frameEnd = performance.now();

    // Update timing metrics (skip the first frame where deltaMS is 0)
    if (deltaMS > 0) {
      this._updateMetrics(frameEnd - frameStart, renderEnd - frameStart, frameEnd - renderEnd);
    }
  }


  /**
   * Processes queued tasks in priority order within the frame budget.
   * Urgent tasks always drain (even if over budget).  Normal and idle
   * tasks only run while `performance.now()` is below the deadline.
   *
   * Under backpressure, idle queue draining is reduced or skipped:
   *   - `'light'`    — idle tasks get half the remaining budget
   *   - `'moderate'`/`'heavy'` — idle queue is skipped entirely
   *
   * @param deadline - Absolute `performance.now()` time to stay under
   */
  protected _drainQueues(deadline: number): void {
    // Urgent: always drain fully, regardless of budget
    this._drainQueue(this._urgentQueue, Infinity);

    // Normal: drain within budget
    this._drainQueue(this._normalQueue, deadline);

    // Idle: respect pressure level
    const pressure = this._pressure;
    if (pressure === 'none') {
      this._drainQueue(this._idleQueue, deadline);
    } else if (pressure === 'light') {
      // Halve the remaining budget for idle work
      const now = performance.now();
      const remaining = deadline - now;
      if (remaining > 0) {
        this._drainQueue(this._idleQueue, now + remaining * 0.5);
      }
    }
    // 'moderate' and 'heavy': skip idle queue entirely
  }


  /**
   * Runs tasks from a single queue until the queue is empty or the
   * deadline is exceeded.  Each task's promise is resolved on success
   * or rejected if the task function throws.
   *
   * @param queue - The task queue to drain
   * @param deadline - Absolute `performance.now()` time to stay under
   *                   (pass `Infinity` to drain unconditionally)
   */
  protected _drainQueue(queue: QueuedTask[], deadline: number): void {
    while (queue.length > 0) {
      if (deadline !== Infinity && performance.now() >= deadline) break;
      const task = queue.shift()!;
      try {
        task.fn();
        task.resolve();
      } catch (e) {
        task.reject(e);
      }
    }
  }


  /**
   * Called at the end of each frame to update the exponential moving
   * averages, the dropped-frame ring buffer, and the pressure level.
   *
   * @param frameTime - Total frame time (ms)
   * @param renderTime - Frame callback time (ms)
   * @param idleTime - Queue drain time (ms)
   */
  protected _updateMetrics(frameTime: number, renderTime: number, idleTime: number): void {
    const alpha = EMA_ALPHA;

    // Bootstrap EMA on the first real frame
    if (this._avgFrameTime === 0) {
      this._avgFrameTime = frameTime;
      this._avgRenderTime = renderTime;
      this._avgIdleTime = idleTime;
    } else {
      this._avgFrameTime = alpha * frameTime + (1 - alpha) * this._avgFrameTime;
      this._avgRenderTime = alpha * renderTime + (1 - alpha) * this._avgRenderTime;
      this._avgIdleTime = alpha * idleTime + (1 - alpha) * this._avgIdleTime;
    }

    // Update dropped-frame ring buffer
    const dropped = frameTime > this._targetFrameTime;
    const idx = this._ringIndex % PRESSURE_WINDOW;
    if (this._droppedFrameRing[idx] && !dropped) {
      this._droppedCount--;
    } else if (!this._droppedFrameRing[idx] && dropped) {
      this._droppedCount++;
    }
    this._droppedFrameRing[idx] = dropped;
    this._ringIndex++;

    // Compute pressure level with hysteresis
    this._computePressure();
  }


  /**
   * Determines the pressure level from the dropped-frame ratio and
   * emits a `'pressure'` event if it changed.  Uses separate escalation
   * and recovery thresholds to prevent oscillation.
   */
  protected _computePressure(): void {
    const ratio = this._droppedCount / PRESSURE_WINDOW;
    const prev = this._pressure;
    let next: PressureLevel;

    // Escalation: only step up one level at a time
    if (prev === 'none') {
      next = ratio > PRESSURE_ESCALATE.light ? 'light' : 'none';
    } else if (prev === 'light') {
      if (ratio > PRESSURE_ESCALATE.moderate)       next = 'moderate';
      else if (ratio < PRESSURE_RECOVER.light)      next = 'none';
      else                                           next = 'light';
    } else if (prev === 'moderate') {
      if (ratio > PRESSURE_ESCALATE.heavy)           next = 'heavy';
      else if (ratio < PRESSURE_RECOVER.moderate)    next = 'light';
      else                                           next = 'moderate';
    } else {
      // prev === 'heavy'
      next = ratio < PRESSURE_RECOVER.heavy ? 'moderate' : 'heavy';
    }

    if (next !== prev) {
      this._pressure = next;
      this.emit('pressure', next);
    }
  }
}
