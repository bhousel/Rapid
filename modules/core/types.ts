/**
 * Type definitions for the core module.
 * These types represent the application context and system interfaces.
 * @module
 */

import type { Context } from '../Context.ts';

import type { AbstractSystem } from './AbstractSystem.ts';
import type { AssetSystem } from './AssetSystem.ts';
import type { EditSystem } from './EditSystem.ts';
import type { FilterSystem } from './FilterSystem.ts';
import type { GraphicsSystem } from './GraphicsSystem.ts';
import type { ImagerySystem } from './ImagerySystem.ts';
import type { LocalizationSystem } from './LocalizationSystem.ts';
import type { LocationSystem } from './LocationSystem.ts';
import type { MapSystem } from './MapSystem.ts';
import type { Map3dSystem } from './Map3dSystem.ts';
import type { PhotoSystem } from './PhotoSystem.ts';
import type { RapidSystem } from './RapidSystem.ts';
import type { SchedulerSystem } from './SchedulerSystem.ts';
import type { SchemaSystem } from './SchemaSystem.ts';
import type { SpatialSystem } from './SpatialSystem.ts';
import type { StorageSystem } from './StorageSystem.ts';
import type { StyleSystem } from './StyleSystem.ts';
import type { UiSystem } from './UiSystem.ts';
import type { UploaderSystem } from './UploaderSystem.ts';
import type { UrlHashSystem } from './UrlHashSystem.ts';
import type { ValidationSystem } from './ValidationSystem.ts';

/** A System class constructor */
export type SystemConstructor = new (context: Context) => AbstractSystem;

/**
 * Container interface for all system instances.
 * Systems are accessed via `context.systems[systemID]`.
 * The index signature allows flexible access by system ID,
 * while specific properties provide type-safe access to known systems.
 */
export interface Systems {
  /** Index signature for flexible system access by ID */
  [key: SystemID]: AbstractSystem | undefined;

  assets?: AssetSystem;
  editor?: EditSystem;
  filters?: FilterSystem;
  gfx?: GraphicsSystem;
  imagery?: ImagerySystem;
  l10n?: LocalizationSystem;
  locations?: LocationSystem;
  map?: MapSystem;
  map3d?: Map3dSystem;
  photos?: PhotoSystem;
  rapid?: RapidSystem;
  scheduler?: SchedulerSystem;
  schema?: SchemaSystem;
  spatial?: SpatialSystem;
  storage?: StorageSystem;
  styles?: StyleSystem;
  ui?: UiSystem;
  uploader?: UploaderSystem;
  urlhash?: UrlHashSystem;
  validator?: ValidationSystem;
}
