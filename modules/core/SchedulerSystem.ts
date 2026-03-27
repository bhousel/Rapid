import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Task priority — determines scheduling order within each frame */
type TaskPriority = 'urgent' | 'normal' | 'idle';

/** A task waiting in an internal queue */
interface QueuedTask {
  fn: () => void;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

/** Options for the general `schedule()` API */
interface ScheduleOptions {
  priority?: TaskPriority;
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
 * `SchedulerSystem` centralizes deferred and background work scheduling.
 *
 * **Game loop** — Owns the `requestAnimationFrame` loop.  Other systems
 * (notably GraphicsSystem) register frame callbacks that the scheduler
 * calls each frame with the elapsed time (`deltaMS`).
 *
 * **Task scheduling** — Queued tasks are drained at the end of each frame
 * within the remaining frame budget.  Callers specify priority:
 *   - `'urgent'`  — always runs this frame, even if over budget
 *   - `'normal'`  — runs if budget remains after urgent tasks
 *   - `'idle'`    — runs only if budget remains after normal tasks
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
  /** Target frame time in milliseconds — determines idle budget */
  private _targetFrameTime: number;

  // Task queues (drained per-frame in priority order)
  private _urgentQueue: QueuedTask[];
  private _normalQueue: QueuedTask[];
  private _idleQueue: QueuedTask[];

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
    this._targetFrameTime = DEFAULT_TARGET_FRAME_TIME;

    this._urgentQueue = [];
    this._normalQueue = [];
    this._idleQueue = [];

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
   * schedule
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
  schedule(fn: () => void, opts?: ScheduleOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const task: QueuedTask = { fn, resolve, reject };
      const priority = opts?.priority ?? 'normal';
      switch (priority) {
        case 'urgent':  this._urgentQueue.push(task);  break;
        case 'normal':  this._normalQueue.push(task);  break;
        case 'idle':    this._idleQueue.push(task);    break;
      }
    });
  }


  /**
   * scheduleIdleTask
   * Convenience wrapper — equivalent to `schedule(fn, { priority: 'idle' })`.
   *
   * @param fn - The function to execute during idle time
   * @return Promise resolved after the task completes
   */
  scheduleIdleTask(fn: () => void): Promise<void> {
    return this.schedule(fn, { priority: 'idle' });
  }


  /**
   * cancelAllIdleTasks
   * Cancels every outstanding queued task (urgent, normal, and idle)
   * and rejects their promises.  Useful during reset or teardown.
   */
  cancelAllIdleTasks(): void {
    const queues = [this._urgentQueue, this._normalQueue, this._idleQueue];
    for (const queue of queues) {
      for (const task of queue) {
        task.reject();
      }
      queue.length = 0;
    }
  }


  /**
   * numPending
   * Total number of tasks waiting in all priority queues.
   * Useful for debugging and tests.
   * @readonly
   */
  get numPending(): number {
    return this._urgentQueue.length + this._normalQueue.length + this._idleQueue.length;
  }


  /**
   * targetFrameTime
   * Target frame duration in milliseconds.  Tasks are drained at the end
   * of each frame only while `performance.now()` is below the deadline
   * (`frameStart + targetFrameTime`).  Defaults to ~16.7ms (60 fps).
   */
  get targetFrameTime(): number {
    return this._targetFrameTime;
  }
  set targetFrameTime(ms: number) {
    this._targetFrameTime = Math.max(1, ms);
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
   * Computes `deltaMS` from the browser-provided timestamp, calls
   * all registered frame callbacks, then drains queued tasks with
   * whatever frame budget remains.
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

    // Drain queued tasks with remaining frame budget
    const deadline = timestamp + this._targetFrameTime;
    this._drainQueues(deadline);
  }


  /**
   * _drainQueues
   * Processes queued tasks in priority order within the frame budget.
   * Urgent tasks always drain (even if over budget).  Normal and idle
   * tasks only run while `performance.now()` is below the deadline.
   *
   * @param deadline - Absolute `performance.now()` time to stay under
   */
  private _drainQueues(deadline: number): void {
    // Urgent: always drain fully, regardless of budget
    this._drainQueue(this._urgentQueue, Infinity);

    // Normal: drain within budget
    this._drainQueue(this._normalQueue, deadline);

    // Idle: drain with remaining budget
    this._drainQueue(this._idleQueue, deadline);
  }


  /**
   * _drainQueue
   * Runs tasks from a single queue until the queue is empty or the
   * deadline is exceeded.  Each task's promise is resolved on success
   * or rejected if the task function throws.
   *
   * @param queue - The task queue to drain
   * @param deadline - Absolute `performance.now()` time to stay under
   *                   (pass `Infinity` to drain unconditionally)
   */
  private _drainQueue(queue: QueuedTask[], deadline: number): void {
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
}
