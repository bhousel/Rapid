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

  /** @constructor */
  public constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new Viewport();
    this._keybinding = (new MockSystem(this as unknown as Context) as unknown as Keybinding);
  }
  /** Resolves immediately — no real async work in tests */
  public initAsync()   { return Promise.resolve(); }
  /** Resolves immediately — no real async work in tests */
  public startAsync()  { return Promise.resolve(); }
  /** Resolves immediately — no real async work in tests */
  public resetAsync()  { return Promise.resolve(); }
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
