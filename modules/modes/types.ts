/**
 * Type definitions for the modes module.
 * These types represent the mode instances container and constructor.
 * @module
 */

import type { AbstractMode } from './AbstractMode.ts';
import type { AddNoteMode } from './AddNoteMode.ts';
import type { AddPointMode } from './AddPointMode.ts';
import type { BrowseMode } from './BrowseMode.ts';
import type { DragNodeMode } from './DragNodeMode.ts';
import type { DragNoteMode } from './DragNoteMode.ts';
import type { DrawAreaMode } from './DrawAreaMode.ts';
import type { DrawLineMode } from './DrawLineMode.ts';
import type { MoveMode } from './MoveMode.ts';
import type { RotateMode } from './RotateMode.ts';
import type { SaveMode } from './SaveMode.ts';
import type { SelectMode } from './SelectMode.ts';
import type { SelectOsmMode } from './SelectOsmMode.ts';

// Re-export Context from the main Context module.
// This allows existing imports from './types.ts' to continue working.
import type { Context } from '../Context.ts';
export type { Context };

/** A Mode class constructor */
export type ModeConstructor = new (context: Context) => AbstractMode;

/**
 * Container interface for all mode instances.
 * Modes are accessed via `context.modes[modeID]`.
 * The index signature allows flexible access by mode ID,
 * while specific properties provide type-safe access to known modes.
 */
export interface Modes {
  /** Index signature for flexible mode access by ID */
  [key: ModeID]: AbstractMode | undefined;

  'add-note'?: AddNoteMode;
  'add-point'?: AddPointMode;
  'browse'?: BrowseMode;
  'drag-node'?: DragNodeMode;
  'drag-note'?: DragNoteMode;
  'draw-area'?: DrawAreaMode;
  'draw-line'?: DrawLineMode;
  'move'?: MoveMode;
  'rotate'?: RotateMode;
  'save'?: SaveMode;
  'select'?: SelectMode;
  'select-osm'?: SelectOsmMode;
}
