/**
 * Modes module barrel file.
 * Exports all mode classes and the modes registry.
 * @module modes
 */
import { AbstractMode } from './AbstractMode.ts';
import { AddNoteMode } from './AddNoteMode.ts';
import { AddPointMode } from './AddPointMode.ts';
import { BrowseMode } from './BrowseMode.ts';
import { DragNodeMode } from './DragNodeMode.ts';
import { DragNoteMode } from './DragNoteMode.ts';
import { DrawAreaMode } from './DrawAreaMode.ts';
import { DrawLineMode } from './DrawLineMode.ts';
import { MoveMode } from './MoveMode.ts';
import { RotateMode } from './RotateMode.ts';
import { SaveMode } from './SaveMode.ts';
import { SelectMode } from './SelectMode.ts';
import { SelectOsmMode } from './SelectOsmMode.ts';

export {
  AbstractMode,
  AddNoteMode,
  AddPointMode,
  BrowseMode,
  DragNodeMode,
  DragNoteMode,
  DrawAreaMode,
  DrawLineMode,
  MoveMode,
  RotateMode,
  SaveMode,
  SelectMode,
  SelectOsmMode  // someday, combine with SelectMode and have a single mode?
};

// Re-export types from types.ts for convenience
import type { ModeConstructor } from './types.ts';
export type { Modes, ModeConstructor } from './types.ts';

/**
 * Registry interface for available modes.
 * Contains a Map of mode IDs to their constructor functions.
 * Modes in the `available` collection will be instantiated at init time.
 */
interface ModeRegistry {
  /** Map of mode IDs to their constructors - modes here will be instantiated at init time */
  available: Map<ModeID, ModeConstructor>;
}

/**
 * Registry of available modes.
 * At init time, Context will instantiate any modes in the 'available' collection.
 */
export const modes: ModeRegistry = {
  available: new Map<ModeID, ModeConstructor>()
};

modes.available.set('add-note', AddNoteMode);
modes.available.set('add-point', AddPointMode);
modes.available.set('browse', BrowseMode);
modes.available.set('drag-node', DragNodeMode);
modes.available.set('drag-note', DragNoteMode);
modes.available.set('draw-area', DrawAreaMode);
modes.available.set('draw-line', DrawLineMode);
modes.available.set('move', MoveMode);
modes.available.set('rotate', RotateMode);
modes.available.set('save', SaveMode);
modes.available.set('select', SelectMode);
modes.available.set('select-osm', SelectOsmMode);
