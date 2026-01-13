/**
 * Type definitions for the core module.
 * These types represent the application context and system interfaces.
 * @module
 */

import type { Viewport } from '@rapid-sdk/math';
import type { EventEmitter } from 'tseep';
import type { Selection } from 'd3-selection';

// Import converted system types for use in Systems interface.
// Using `import type` avoids runtime circular dependencies.
import type { AssetSystem } from './AssetSystem.ts';
import type { EditSystem } from './EditSystem.ts';
import type { FilterSystem } from './FilterSystem.ts';
import type { ImagerySystem } from './ImagerySystem.ts';
import type { LocalizationSystem } from './LocalizationSystem.ts';
import type { LocationSystem } from './LocationSystem.ts';
import type { Map3dSystem } from './Map3dSystem.ts';
import type { PhotoSystem } from './PhotoSystem.ts';
import type { RapidSystem } from './RapidSystem.ts';
import type { SchemaSystem } from './SchemaSystem.ts';
import type { SpatialSystem } from './SpatialSystem.ts';
import type { StorageSystem } from './StorageSystem.ts';
import type { StyleSystem } from './StyleSystem.ts';
import type { UploaderSystem } from './UploaderSystem.ts';
import type { UrlHashSystem } from './UrlHashSystem.ts';
import type { ValidationSystem } from './ValidationSystem.ts';

/** Permissive D3 selection type - accepts any selection without strict type checking */
export type D3Selection = Selection<any, any, any, any>;
/** A type that can be T, null, or undefined */
export type Nullable<T> = T | null | undefined;


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


/**
 * Minimal interface for a System.
 * All systems extend AbstractSystem which implements this interface.
 */
export interface System {
  /** Unique identifier for this system */
  readonly id: SystemID;
  /** Dependencies that must be initialized before this system */
  readonly dependencies: Set<SystemID>;
  /** Whether this system has started */
  readonly started: boolean;

  /** Initialize the system */
  initAsync(): Promise<void>;
  /** Start the system after initialization */
  startAsync(): Promise<void>;
  /** Reset the system state */
  resetAsync(): Promise<void>;
}


/** Union of all system types (converted and unconverted) */
type AnySystem =
  | AssetSystem
  | EditSystem
  | FilterSystem
  | ImagerySystem
  | LocalizationSystem
  | LocationSystem
  | Map3dSystem
  | PhotoSystem
  | RapidSystem
  | SchemaSystem
  | SpatialSystem
  | StorageSystem
  | StyleSystem
  | UploaderSystem
  | UrlHashSystem
  | ValidationSystem
  | System;

/**
 * Container for all system instances.
 * Systems are accessed via context.systems[systemID].
 *
 * As systems are converted to TypeScript, we add their specific types here.
 * Systems not yet converted use the base `System` type.
 */
export interface Systems {
  [key: string]: AnySystem | undefined;

  // Converted to TypeScript - use specific types:
  assets?: AssetSystem;
  editor?: EditSystem;
  filters?: FilterSystem;
  imagery?: ImagerySystem;
  l10n?: LocalizationSystem;
  locations?: LocationSystem;
  map3d?: Map3dSystem;
  photos?: PhotoSystem;
  rapid?: RapidSystem;
  schema?: SchemaSystem;
  spatial?: SpatialSystem;
  storage?: StorageSystem;
  styles?: StyleSystem;
  uploader?: UploaderSystem;
  urlhash?: UrlHashSystem;
  validator?: ValidationSystem;

  // Not yet converted - use base System type:
  gfx?: System;
  map?: System;
  ui?: System;
}


/**
 * The global application context.
 * Contains references to all core components and shared state.
 *
 * Context is passed to almost every class constructor in the codebase.
 * It provides access to systems, services, viewport, and utility functions.
 */
export interface Context extends EventEmitter {
  /** Application version string */
  readonly version: string;
  /** All initialized systems */
  systems: Systems;
  /** All initialized services (external data sources, APIs) */
  services: Record<string, any>;
  /** The map viewport (projection, pan, zoom) */
  viewport: Viewport;
  /** Whether the app is in the intro walkthrough */
  inIntro: boolean;
  /** Sequence counters for generating unique IDs */
  sequences: Record<string, number>;

  /**
   * Generate a unique sequential ID with the given prefix.
   * @param prefix - The prefix for the ID (e.g. 'graph', 'node')
   * @returns The next number in the sequence for this prefix
   */
  next(prefix: string): number;
}
