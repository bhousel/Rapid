/**
 * Type definitions for the core module.
 * These types represent the application context and system interfaces.
 * @module
 */

import type { Viewport } from '@rapid-sdk/math';
import type { EventEmitter } from 'tseep';

import type { Graph } from '../lib/Graph.js';


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


/** System lifecycle status */
export type SystemStatus = 'idle' | 'loading' | 'ready' | 'error';


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


/**
 * Container for all system instances.
 * Systems are accessed via context.systems[systemID].
 *
 * Note: We use a flexible index signature here because the actual
 * system classes are defined in JavaScript. As systems are converted
 * to TypeScript, we can add more specific type information.
 */
export interface Systems {
  [key: string]: System | undefined;

  // Common systems accessed frequently in lib/ code:
  // These provide better autocomplete while we migrate.
  assets?: System;
  editor?: System;
  filters?: System;
  gfx?: System;
  imagery?: System;
  l10n?: System;
  locations?: System;
  map?: System;
  map3d?: System;
  photos?: System;
  rapid?: System;
  schema?: System;
  spatial?: System;
  storage?: System;
  styles?: System;
  ui?: System;
  uploader?: System;
  urlhash?: System;
  validator?: System;
}


/**
 * The global application context.
 * Contains references to all core components and shared state.
 *
 * Context is passed to almost every class constructor in the codebase.
 * It provides access to systems, viewport, and utility functions.
 */
export interface Context extends EventEmitter {
  /** Application version string */
  readonly version: string;

  /** All initialized systems */
  systems: Systems;

  /** The map viewport (projection, pan, zoom) */
  viewport: Viewport;

  /** Whether the app is in the intro walkthrough */
  inIntro: boolean;

  /**
   * Generate a unique sequential ID with the given prefix.
   * @param prefix - The prefix for the ID (e.g. 'graph', 'node')
   * @returns The next number in the sequence for this prefix
   */
  next(prefix: string): number;

  /**
   * Get the current stable graph from the editor.
   * Shortcut for context.systems.editor.stable.graph
   */
  graph(): Graph;
}
