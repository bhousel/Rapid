import { AbstractSystem } from './AbstractSystem.ts';
import { AssetSystem } from './AssetSystem.ts';
import { EditSystem } from './EditSystem.js';
import { FilterSystem } from './FilterSystem.ts';
import { GraphicsSystem } from './GraphicsSystem.js';
import { ImagerySystem } from './ImagerySystem.ts';
import { LocalizationSystem } from './LocalizationSystem.ts';
import { LocationSystem } from './LocationSystem.ts';
import { Map3dSystem } from './Map3dSystem.ts';
import { MapSystem } from './MapSystem.js';
import { PhotoSystem } from './PhotoSystem.ts';
import { RapidSystem } from './RapidSystem.ts';
import { SchemaSystem } from './SchemaSystem.ts';
import { SpatialSystem } from './SpatialSystem.ts';
import { StorageSystem } from './StorageSystem.ts';
import { StyleSystem } from './StyleSystem.ts';
import { UiSystem } from './UiSystem.js';
import { UploaderSystem } from './UploaderSystem.ts';
import { UrlHashSystem } from './UrlHashSystem.ts';
import { ValidationSystem } from './ValidationSystem.js';

export {
  AbstractSystem,
  AssetSystem,
  EditSystem,
  FilterSystem,
  GraphicsSystem,
  ImagerySystem,
  LocalizationSystem,
  LocationSystem,
  Map3dSystem,
  MapSystem,
  PhotoSystem,
  RapidSystem,
  SchemaSystem,
  SpatialSystem,
  StorageSystem,
  StyleSystem,
  UiSystem,
  UploaderSystem,
  UrlHashSystem,
  ValidationSystem
};

// At init time, we will instantiate any that are in the 'available' collection.
export const systems = {
  available: new Map()   // Map<systemID, System constructor>
};

systems.available.set('assets', AssetSystem);
systems.available.set('editor', EditSystem);
systems.available.set('filters', FilterSystem);
systems.available.set('gfx', GraphicsSystem);
systems.available.set('imagery', ImagerySystem);
systems.available.set('l10n', LocalizationSystem);
systems.available.set('locations', LocationSystem);
systems.available.set('map', MapSystem);
systems.available.set('map3d', Map3dSystem);
systems.available.set('photos', PhotoSystem);
systems.available.set('rapid', RapidSystem);
systems.available.set('schema', SchemaSystem);
systems.available.set('spatial', SpatialSystem);
systems.available.set('storage', StorageSystem);
systems.available.set('styles', StyleSystem);
systems.available.set('ui', UiSystem);
systems.available.set('uploader', UploaderSystem);
systems.available.set('urlhash', UrlHashSystem);
systems.available.set('validator', ValidationSystem);

/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  @typedef  {string}          systemID
 *  @typedef  {AbstractSystem}  System
 */
