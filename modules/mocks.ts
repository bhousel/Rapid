import { select as d3_select } from 'd3-selection';
import { Viewport } from '@rapid-sdk/math';
import { AbstractSystem } from './core/AbstractSystem.ts';

import type { TransformProps } from '@rapid-sdk/math';
import type { Context } from './Context.ts';
import type { Systems } from './core/types.ts';
import type { Keybinding } from './util/keybinding.ts';


// This file contains minimal mocks useful for testing.

/**
 * MockSystem
 * @class
 */
export class MockSystem extends AbstractSystem {
  constructor(context: Context) {
    super(context);
    this.id = 'mock';
  }
}

/**
 * MockContext
 * @class
 */
export class MockContext {
  viewport: Viewport;
  systems: Systems;
  services: Record<ServiceID, any>;
  sequences: Record<SequenceID, number>;
  private _keybinding: Keybinding;

  constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new Viewport();
    this._keybinding = (new MockSystem(this as unknown as Context) as unknown as Keybinding);
  }
  initAsync()   { return Promise.resolve(); }
  startAsync()  { return Promise.resolve(); }
  resetAsync()  { return Promise.resolve(); }
  on()          { return this; }
  off()         { return this; }
  keybinding()  { return this._keybinding; }
  container()   { return d3_select(null); }
  cleanTagKey(val: string): string    { return val; };
  cleanTagValue(val: string): string  { return val; };
  next(which: SequenceID): number {
    let num = this.sequences[which] || 0;
    return this.sequences[which] = ++num;
  }
}


/**
 * MockGfxSystem
 * @class
 */
export class MockGfxSystem extends MockSystem {
  scene: AbstractSystem;

  constructor(context: Context) {
    super(context);
    this.id = 'gfx';
    this.scene = new MockSystem(context);
    (this.scene as any).layers = new Map();
  }
  deferredRedraw() {}
  immediateRedraw() {}
  setTransformAsync(t: TransformProps) {
    this.context.viewport.transform = t;
    return Promise.resolve(t);
  }
}
