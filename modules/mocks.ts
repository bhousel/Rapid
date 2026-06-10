import { select as d3_select } from 'd3-selection';
import { Viewport } from '@rapid-sdk/math';
import { AbstractSystem } from './core/AbstractSystem.ts';

import type { TransformProps } from '@rapid-sdk/math';
import type { Context } from './Context.ts';
import type { Systems } from './core/types.ts';
import type { Keybinding } from './util/keybinding.ts';


// This file contains minimal mocks useful for testing.

/**
 * A mock `AbstractSystem` class.
 */
export class MockSystem extends AbstractSystem {
  /**
   * @constructor
   * @param context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'mock';
  }
}

/**
 * A mock `Context` class.
 * Note that it comes with no systems or services set up.
 * Tests must add any systems and services needed to run the thing being tested.
 */
export class MockContext {

  /** The map viewport (projection, pan, zoom) */
  public viewport: Viewport;
  /** All systems available to this mock context */
  public systems: Systems;
  /** All services (empty in tests by default) */
  public services: Record<ServiceID, any>;
  /** Sequence counters for generating unique IDs */
  public sequences: Record<SequenceID, number>;

  /** Stub keybinding manager (backed by a MockSystem cast) */
  protected _keybinding: Keybinding;
  /** Promise for init phase */
  protected _initPromise: Promise<void> | null;
  /** Promise for start phase */
  protected _startPromise: Promise<void> | null;
  /** Promise for reset */
  protected _resetPromise: Promise<void> | null;

  /** @constructor */
  public constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new Viewport();
    this._keybinding = (new MockSystem(this as unknown as Context) as unknown as Keybinding);

    this._initPromise = null;
    this._startPromise = null;
    this._resetPromise = null;
  }

  /**
   * Resolves immediately (tests must construct systems and services themselves).
   * @return  A promise already resolved
   */
  public prepareAsync(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Initializes all systems and services.
   * @return  Promise resolved when all components are initialized
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = this.prepareAsync()
      .then(() => {
        const allSystems = Object.values(this.systems).filter(s => !!s);
        const allServices = Object.values(this.services).filter(s => !!s);
        return Promise.all(allSystems.map(s => s.initAsync()))
          .then(() => Promise.all(allServices.map(s => s.initAsync())));
      })
      .then(() => { });  // void return
  }

  /**
   * Starts all systems and services that have `autoStart` enabled.
   * Implicitly calls `initAsync()` first if it hasn't been called yet.
   * @return  Promise resolved when Rapid is running
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    return this._startPromise = this.initAsync()
      .then(() => {
        const allSystems = Object.values(this.systems).filter(s => !!s);
        const allServices = Object.values(this.services).filter(s => !!s);
        return Promise.all(allSystems.map(s => s.autoStart ? s.startAsync() : Promise.resolve()))
          .then(() => Promise.all(allServices.map(s => s.autoStart ? s.startAsync() : Promise.resolve())));
      })
      .then(() => { });  // void return
  }

  /**
   * Convenience method that calls `prepareAsync()`, `initAsync()`, and `startAsync()`.
   * @return  Promise resolved when Rapid is fully running
   */
  public runAsync(): Promise<void> {
    return this.startAsync();
  }

  /**
   * Call after completing an edit session to reset any internal state.
   * @return  Promise resolved when Rapid is finished resetting
   */
  public resetAsync(): Promise<void> {
    if (this._resetPromise) return this._resetPromise;

    const allSystems = Object.values(this.systems).filter(s => !!s);
    const allServices = Object.values(this.services).filter(s => !!s);

    return this._resetPromise = Promise.resolve()
      .then(() => Promise.all(allSystems.map(s => s.resetAsync())))
      .then(() => Promise.all(allServices.map(s => s.resetAsync())))
      .then(() => { })  // void return
      .finally(() => { this._resetPromise = null; });
  }


  /** Stub event emitter — no-ops and returns `this` for chaining */
  public on()          { return this; }
  /** Stub event emitter — no-ops and returns `this` for chaining */
  public off()         { return this; }
  /** Returns the stub keybinding manager */
  public keybinding()  { return this._keybinding; }
  /** Returns an empty D3 selection (no DOM in tests) */
  public container()   { return d3_select(null); }
  /**
   * Stub tag key cleaner that returns the value unchanged.
   * @param val - The tag key to clean
   * @return  The unchanged tag key
   */
  public cleanTagKey(val: string): string    { return val; };
  /**
   * Stub tag value cleaner that returns the value unchanged.
   * @param val - The tag value to clean
   * @return  The unchanged tag value
   */
  public cleanTagValue(val: string): string  { return val; };
  /**
   * Returns the next number in a named sequence (stub ID generator).
   * @param which - The sequence identifier
   * @return  The next number in the sequence
   */
  public next(which: SequenceID): number {
    const num = (this.sequences[which] || 0) + 1;
    return this.sequences[which] = num;
  }
}


/**
 * A mock `GraphicsSystem` class.
 */
export class MockGfxSystem extends MockSystem {
  /** Stub scene property holding a MockSystem with an empty layers Map */
  public scene: AbstractSystem;

  /**
   *
   * @param context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'gfx';
    this.scene = new MockSystem(context);
    (this.scene as any).layers = new Map();
  }
  /** Schedules a redraw at the next animation frame (no-op stub) */
  public deferredRedraw() {}
  /** Forces an immediate redraw (no-op stub) */
  public immediateRedraw() {}
  /**
   * Sets the viewport transform and resolves immediately (no animation in tests).
   * @param t - The transform props to apply
   * @return  A promise resolving to the applied transform
   */
  public setTransformAsync(t: TransformProps) {
    this.context.viewport.transform = t;
    return Promise.resolve(t);
  }
}
