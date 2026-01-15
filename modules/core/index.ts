import { AbstractSystem } from './AbstractSystem.ts';
import { AssetSystem } from './AssetSystem.ts';
import { EditSystem } from './EditSystem.ts';
import { FilterSystem } from './FilterSystem.ts';
import { GraphicsSystem } from './GraphicsSystem.ts';
import { ImagerySystem } from './ImagerySystem.ts';
import { LocalizationSystem } from './LocalizationSystem.ts';
import { LocationSystem } from './LocationSystem.ts';
import { Map3dSystem } from './Map3dSystem.ts';
import { MapSystem } from './MapSystem.ts';
import { PhotoSystem } from './PhotoSystem.ts';
import { RapidSystem } from './RapidSystem.ts';
import { SchemaSystem } from './SchemaSystem.ts';
import { SpatialSystem } from './SpatialSystem.ts';
import { StorageSystem } from './StorageSystem.ts';
import { StyleSystem } from './StyleSystem.ts';
import { UiSystem } from './UiSystem.ts';
import { UploaderSystem } from './UploaderSystem.ts';
import { UrlHashSystem } from './UrlHashSystem.ts';
import { ValidationSystem } from './ValidationSystem.ts';

import type { Context, SystemID } from './types.ts';

/** Type for a System class constructor */
type SystemConstructor = new (context: Context) => AbstractSystem;

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

// Re-export types from types.ts for convenience
export type { Context, SystemID, Systems } from './types.ts';

/** Container for registering available systems */
interface SystemsRegistry {
  /** Map of system IDs to their constructors - systems here will be instantiated at init time */
  available: Map<SystemID, SystemConstructor>;
}

// At init time, we will instantiate any that are in the 'available' collection.
export const systems: SystemsRegistry = {
  available: new Map<SystemID, SystemConstructor>()
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
