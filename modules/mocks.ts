import { select as d3_select } from 'd3-selection';
import { Viewport } from '@rapid-sdk/math';
import { AbstractSystem } from './core/AbstractSystem.ts';

import type { TransformProps } from '@rapid-sdk/math';
import type { Context } from './Context.ts';
import type { Systems } from './core/types.ts';
import type { Keybinding } from './util/keybinding.ts';


// This file contains minimal mocks useful for testing.

/**
 * @class
 */
export class MockSystem extends AbstractSystem {
  public constructor(context: Context) {
    super(context);
    this.id = 'mock';
  }
}

/**
 * @class
 */
export class MockContext {
  public viewport: Viewport;
  public systems: Systems;
  public services: Record<ServiceID, any>;
  public sequences: Record<SequenceID, number>;
  protected _keybinding: Keybinding;

  public constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new Viewport();
    this._keybinding = (new MockSystem(this as unknown as Context) as unknown as Keybinding);
  }
  public initAsync()   { return Promise.resolve(); }
  public startAsync()  { return Promise.resolve(); }
  public resetAsync()  { return Promise.resolve(); }
  public on()          { return this; }
  public off()         { return this; }
  public keybinding()  { return this._keybinding; }
  public container()   { return d3_select(null); }
  public cleanTagKey(val: string): string    { return val; };
  public cleanTagValue(val: string): string  { return val; };
  public next(which: SequenceID): number {
    const num = (this.sequences[which] || 0) + 1;
    return this.sequences[which] = num;
  }
}


/**
 * @class
 */
export class MockGfxSystem extends MockSystem {
  public scene: AbstractSystem;

  public constructor(context: Context) {
    super(context);
    this.id = 'gfx';
    this.scene = new MockSystem(context);
    (this.scene as any).layers = new Map();
  }
  public deferredRedraw() {}
  public immediateRedraw() {}
  public setTransformAsync(t: TransformProps) {
    this.context.viewport.transform = t;
    return Promise.resolve(t);
  }
}
