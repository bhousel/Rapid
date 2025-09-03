// Core components to support a headless (no browser) Rapid for testing.
export * from './actions/index.js';
export * from './core/lib/index.js';
export * from './geo/index.js';
export * from './models/index.js';
export * from './services/index.js';
export * from './util/index.js';
export * from './validations/index.js';

// These Systems and Services can work without browser and UI.
export { AbstractSystem } from './core/AbstractSystem.js';
export { AssetSystem } from './core/AssetSystem.js';
export { EditSystem } from './core/EditSystem.js';
export { FilterSystem } from './core/FilterSystem.js';
export { ImagerySystem } from './core/ImagerySystem.js';
export { LocalizationSystem } from './core/LocalizationSystem.js';
export { LocationSystem } from './core/LocationSystem.js';
export { MapSystem } from './core/MapSystem.js';
export { PhotoSystem } from './core/PhotoSystem.js';
export { PresetSystem } from './core/PresetSystem.js';
export { RapidSystem } from './core/RapidSystem.js';
export { SpatialSystem } from './core/SpatialSystem.js';
export { StorageSystem } from './core/StorageSystem.js';
export { StyleSystem } from './core/StyleSystem.js';
export { UploaderSystem } from './core/UploaderSystem.js';
export { UrlHashSystem } from './core/UrlHashSystem.js';
export { ValidationSystem } from './core/ValidationSystem.js';


// Reexport only what our tests use, see iD#4379
import * as D3 from 'd3';
export const d3 = {
  select: D3.select,
  polygonArea: D3.polygonArea,
  polygonCentroid: D3.polygonCentroid,
  timerFlush: D3.timerFlush
};

// Reexport the sdk as a single `sdk` namespace.
// (This works because we know there are no name conflicts)
import * as SDKMATH from '@rapid-sdk/math';
import * as SDKUTIL from '@rapid-sdk/util';
export const sdk = { ...SDKMATH, ...SDKUTIL };


// Mocks for testing
// Headless will not have access to the GraphicsSystem or UiSystem.

/**
 * MockSystem
 * @class
 */
export class MockSystem {
  constructor(context) { this.context = context; }
  initAsync()   { return Promise.resolve(); }
  startAsync()  { return Promise.resolve(); }
  resetAsync()  { return Promise.resolve(); }
  on()          { return this; }
  off()         { return this; }
  pause()       { }
  resume()      { }
}

/**
 * MockContext
 * @class
 */
export class MockContext {
  constructor() {
    this.sequences = {};
    this.services = {};
    this.systems = {};
    this.viewport = new sdk.Viewport();
    this._keybinding = new MockSystem(this);
  }
  initAsync()   { return Promise.resolve(); }
  startAsync()  { return Promise.resolve(); }
  resetAsync()  { return Promise.resolve(); }
  on()          { return this; }
  off()         { return this; }
  keybinding()  { return this._keybinding; }
  container()   { return d3.select(null); }
  next(which) {
    let num = this.sequences[which] || 0;
    return this.sequences[which] = ++num;
  }
}


/**
 * MockGfxSystem
 * @class
 */
export class MockGfxSystem extends MockSystem {
  constructor(context) {
    super(context);
    this.id = 'gfx';
    this.scene = new MockSystem();
    this.scene.layers = new Map();
  }
  deferredRedraw() {}
  immediateRedraw() {}
  setTransformAsync(t) {
    this.context.viewport.transform = t;
    return Promise.resolve(t);
  }
}



// Polyfill idle callback functions (for Node)
if (!globalThis.requestIdleCallback) {
  globalThis.requestIdleCallback = (callback) => {
    const start = Date.now();
    return globalThis.setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => {
          return Math.max(0, 50 - (Date.now() - start));   // Simulates a time limit
        }
      });
    }, 1); // Executes with a minimal delay
  };
}

if (!globalThis.cancelIdleCallback) {
  globalThis.cancelIdleCallback = (handle) => {
    globalThis.clearTimeout(handle);
  };
}
