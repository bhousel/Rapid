import { EventEmitter } from 'tseep';

import type { Context } from '../Context.ts';


/**
 * `AbstractSystem` is the base class from which all systems and services inherit.
 * "Systems" are the core components of Rapid.
 * "Services" are extension components that connect to other web services and fetch data.
 * They are owned by the Context. All systems are EventEmitters
 *
 * Systems have some built-in dependency tracking.  You can add systemIDs to
 * the `requiredDependencies` or `optionalDependencies` sets.  At init time
 * an exception will be thrown if a required depencency is not met.
 *
 * System Components all go through a standard lifecycle.
 * `constructor()` -> `initAsync()` -> `startAsync()`
 *
 * `constructor()` - Called one time and passed the Context.
 *   At this stage all components are still being constructed, in no particular order.
 *   You should not call other components or use the context in the constructor.
 *
 * `initAsync()` - Called one time after all systems are constructed.
 *   Systems may check at init time that their dependencies are met.
 *   They may chain onto other system `initAsync` promises in order to establish a dependency graph.
 *   (for example, if `AssetSystem` must be initialized and ready
 *    so that the `ImagerySystem` can start fetching its imagery index)
 *   `initAsync` is also a good place to set up event listeners.
 *   After 'init', the component should mostly be able to function normally.
 *   You should be able to call methods but there is no user interface yet.
 *   and no events will be dispatched yet.
 *
 * `startAsync()` - Called one time after all systems are initialized.
 *   At this stage we are creating the user interface and the map.
 *   There is an `autoStart` property that defaults to `true` but can be set `false` for some systems.
 *   (for example `Map3dSystem` doesn't need to load and start MapLibre until the user actually decides
 *    they want to see it - it is another component's job to call `startAsync` in this situation)
 *   Like with init, components can chain onto other components startAsync promises they depend on.
 *   After 'start', the system should be doing its job and dispatching events.
 *
 * `resetAsync()` - Called after completing an edit session to reset any internal state.
 *   Resets mainly happen when completing an edit session, but can happen other times,
 *   for example entering/exiting the tutorial, restoring a saved backup, or when switching
 *   connection between live/dev OSM API.  Each system is responsible for clearing out any
 *   stored state during reset.
 *
 * `pause() / _resume()` - Call `pause()` to pause the system.
 *   The meaning of "pause" / "resume" is dependent on the system - they may not be used at all.
 *   It may be used to prevent network fetches, background work, or rendering.
 *   Pause uses reference counting — `pause()` returns a release token, and the system
 *   only fully unpauses when all outstanding pauses have been released.
 *   `_resume()` is private — callers must hold onto the release token and call it when done.
 *   Emits `'paused'` / `'resumed'` events on state transitions.
 *
 * Properties available:
 *   `id`         `String`   Identifier for the system (e.g. 'l10n')
 *   `autoStart`  `Boolean`  True to start automatically when initializing the Context
 *
 * Events available:
 *   `paused`     Fires when the system transitions from unpaused to paused
 *   `resumed`    Fires when the system transitions from paused to unpaused
 */
export class AbstractSystem extends EventEmitter {

  /** Identifier for the system (e.g. 'l10n') */
  public id: SystemID;
  /** Global shared application context */
  public context: Context;
  /** Dependencies that must be met before init */
  public requiredDependencies: Set<SystemID>;
  /** Dependencies that are nice to have but not required */
  public optionalDependencies: Set<SystemID>;
  /** True to start automatically when initializing the Context */
  public autoStart: boolean;

  /** Memoized promise for `initAsync()` — ensures init runs at most once */
  protected _initPromise: Promise<void> | null;
  /** Memoized promise for `startAsync()` — ensures start runs at most once */
  protected _startPromise: Promise<void> | null;
  /** Whether `startAsync()` has completed successfully */
  protected _started: boolean;
  /** Whether the system is currently paused (pause count > 0) */
  protected _paused: boolean;
  /** Number of outstanding `pause()` calls; system resumes when this reaches zero */
  protected _pauseCount: number;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.id = '';
    this.context = context;
    this.requiredDependencies = new Set<SystemID>();
    this.optionalDependencies = new Set<SystemID>();
    this.autoStart = true;

    this._initPromise = null;
    this._startPromise = null;

    this._started = false;
    this._paused = false;
    this._pauseCount = 0;
  }


  /**
   * Unique string to identify this System.
   * @return  This system's unique ID
   * @readonly
   */
  public get systemID(): SystemID {
    return this.id;
  }


  /**
   * Because services also inherit from 'AbstractSystem',
   *  we will offer a convenience getter named `serviceID` too.
   * They all just return `id` anyway.
   * @return  This service's unique ID (same as `systemID`)
   * @readonly
   */
  public get serviceID(): SystemID {
    return this.id;
  }


  /**
   * Whether this system has completed `startAsync` and is running.
   * @return  `true` if this system has been started
   * @readonly
   */
  public get started(): boolean {
    return this._started;
  }


  /**
   * Whether this system is currently paused (event handling and updates suspended).
   * @return  `true` if this system is currently paused
   * @readonly
   */
  public get paused(): boolean {
    return this._paused;
  }


  /**
   * Called after all core objects have been constructed.
   * Will return a rejected promise if any required system is not available.
   * @return  Promise resolved when this component has completed initialization
   * @abstract
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    for (const requiredID of this.requiredDependencies) {
      if (!this.context.systems[requiredID]) {
        return Promise.reject(`Cannot init:  ${this.id} requires ${requiredID}`);
      }
    }
    return this._initPromise = Promise.resolve();
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   * @abstract
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    this._started = true;
    return this._startPromise = Promise.resolve();
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * @return  Promise resolved when this component has completed resetting
   * @abstract
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Pauses this system using reference counting.
   * The meaning of "pause" / "resume" is dependent on the system - they may not be used at all.
   * It may be used to prevent network fetches, background work, or rendering.
   *
   * Multiple callers can pause independently — the system stays paused
   * until all callers have released their pause.
   *
   * Returns a release function (token). Call it when your work is done.
   * The token is idempotent — safe to call multiple times.
   *
   * Emits `'paused'` when transitioning from unpaused to paused.
   *
   * @return A release function that decrements the pause count
   */
  public pause(): () => void {
    this._pauseCount++;
    const wasPaused = this._paused;
    this._paused = true;

    if (!wasPaused) {
      this.emit('paused');
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._resume();
    };
  }


  /**
   * Resumes (unpauses) this system by decrementing the pause count.
   * The meaning of "pause" / "resume" is dependent on the system - they may not be used at all.
   * It may be used to prevent network fetches, background work, or rendering.
   *
   * The system only actually unpauses when all outstanding pauses have been released.
   * This is called internally by the release token returned from `pause()`.
   *
   * Emits `'resumed'` when transitioning from paused to unpaused.
   */
  protected _resume(): void {
    this._pauseCount = Math.max(0, this._pauseCount - 1);
    const wasPaused = this._paused;
    this._paused = this._pauseCount > 0;

    if (wasPaused && !this._paused) {
      this.emit('resumed');
    }
  }

}
