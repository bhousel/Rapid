// Just a few core components that we could use to
// support a headless (no browser) Rapid for testing

export * from './actions/index.js';
export * from './core/lib/index.js';
export * from './geo/index.js';
export * from './models/index.js';
export * from './util/index.js';

// Reexport only what our tests use, see iD#4379
import * as D3 from 'd3';
export const d3 = {
  append: D3.append,
  polygonArea: D3.polygonArea,
  polygonCentroid: D3.polygonCentroid,
  select: D3.select,
  selectAll: D3.selectAll,
  timerFlush: D3.timerFlush
};

// Reexport the sdk as a single `sdk` namespace.
// (This works because we know there are no name conflicts)
import * as SDKMATH from '@rapid-sdk/math';
import * as SDKUTIL from '@rapid-sdk/util';
export const sdk = { ...SDKMATH, ...SDKUTIL };

// Used for testing
export class MockContext {
  constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new sdk.Viewport();
  }
  next(which) {
    let num = this.sequences[which] || 0;
    return this.sequences[which] = ++num;
  }
}
