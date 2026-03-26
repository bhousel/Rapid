import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/** Handle returned by `scheduleIdleTask`, used to cancel it */
type IdleTaskHandle = number;

/** A deferred idle task, with its rejection callback for cleanup */
interface IdleTask {
  reject: () => void;
}


/**
 * `SchedulerSystem` centralizes deferred and background work scheduling.
 *
 * **Idle scheduling** — Wraps `requestIdleCallback` / `cancelIdleCallback`
 * behind a managed interface, so callers don't need to track handles or
 * deal with polyfill quirks.  When the system is paused, new idle tasks
 * are queued and deferred until the system resumes.
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
  /** Active idle tasks keyed by their requestIdleCallback handle */
  private _idleTasks: Map<IdleTaskHandle, IdleTask>;

  /** Tasks that arrived while paused — will be scheduled on resume */
  private _pendingTasks: Array<{ fn: () => void; resolve: () => void; reject: () => void }>;

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

    this._idleTasks = new Map();
    this._pendingTasks = [];
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
        this.on('resumed', () => this._drainPending());
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    this.cancelAllIdleTasks();
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
}
