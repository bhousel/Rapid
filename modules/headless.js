// Polyfills for missing JavaScript features.
import './polyfills.ts';

// Core components to support a headless (no browser) Rapid for testing.
export * from './actions/index.ts';
export * from './data/index.ts';
export * from './geo/index.ts';
export * from './lib/index.ts';
export * from './services/index.ts';
export * from './util/index.ts';
export * from './validators/index.js';
export * from './mocks.ts';

// These Systems and Services can work without browser and UI.
export { AbstractSystem } from './core/AbstractSystem.ts';
export { AssetSystem } from './core/AssetSystem.ts';
export { EditSystem } from './core/EditSystem.ts';
export { FilterSystem } from './core/FilterSystem.ts';
export { ImagerySystem } from './core/ImagerySystem.ts';
export { LocalizationSystem } from './core/LocalizationSystem.ts';
export { LocationSystem } from './core/LocationSystem.ts';
export { MapSystem } from './core/MapSystem.ts';
export { PhotoSystem } from './core/PhotoSystem.ts';
export { RapidSystem } from './core/RapidSystem.ts';
export { SchemaSystem } from './core/SchemaSystem.ts';
export { SchedulerSystem } from './core/SchedulerSystem.ts';
export { SpatialSystem } from './core/SpatialSystem.ts';
export { StorageSystem } from './core/StorageSystem.ts';
export { StyleSystem } from './core/StyleSystem.ts';
export { UploaderSystem } from './core/UploaderSystem.ts';
export { UrlHashSystem } from './core/UrlHashSystem.ts';
export { ValidationSystem } from './core/ValidationSystem.ts';

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
