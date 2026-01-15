/**
 * Type definitions for the core module.
 * These types represent the application context and system interfaces.
 * @module
 */

// Import converted system types for use in Systems interface.
// Using `import type` avoids runtime circular dependencies.
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
import type { SchemaSystem } from './SchemaSystem.ts';
import type { SpatialSystem } from './SpatialSystem.ts';
import type { StorageSystem } from './StorageSystem.ts';
import type { StyleSystem } from './StyleSystem.ts';
import type { UiSystem } from './UiSystem.ts';
import type { UploaderSystem } from './UploaderSystem.ts';
import type { UrlHashSystem } from './UrlHashSystem.ts';
import type { ValidationSystem } from './ValidationSystem.ts';

// Re-export Context from the main Context module.
// This allows existing imports from './types.ts' to continue working.
export type { Context } from '../Context.ts';


/** System ID string used to identify systems in Context.systems */
export type SystemID =
  | 'assets'
  | 'editor'
  | 'filters'
  | 'gfx'
  | 'imagery'
  | 'l10n'
  | 'locations'
  | 'map'
  | 'map3d'
  | 'photos'
  | 'rapid'
  | 'schema'
  | 'spatial'
  | 'storage'
  | 'styles'
  | 'ui'
  | 'uploader'
  | 'urlhash'
  | 'validator';


/** Union of all system types */
type AnySystem =
  | AssetSystem
  | EditSystem
  | FilterSystem
  | GraphicsSystem
  | ImagerySystem
  | LocalizationSystem
  | LocationSystem
  | MapSystem
  | Map3dSystem
  | PhotoSystem
  | RapidSystem
  | SchemaSystem
  | SpatialSystem
  | StorageSystem
  | StyleSystem
  | UiSystem
  | UploaderSystem
  | UrlHashSystem
  | ValidationSystem;

/**
 * Container for all system instances.
 * Systems are accessed via context.systems[systemID].
 */
export interface Systems {
  [key: string]: AnySystem | undefined;

  // Converted to TypeScript - use specific types:
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
  schema?: SchemaSystem;
  spatial?: SpatialSystem;
  storage?: StorageSystem;
  styles?: StyleSystem;
  ui?: UiSystem;
  uploader?: UploaderSystem;
  urlhash?: UrlHashSystem;
  validator?: ValidationSystem;
}
