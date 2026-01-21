/**
 * Behaviors module barrel file.
 * Exports all behavior classes and the behaviors registry.
 * @module behaviors
 */
import { AbstractBehavior } from './AbstractBehavior.ts';
import { DragBehavior } from './DragBehavior.ts';
import { DrawBehavior } from './DrawBehavior.ts';
import { HoverBehavior } from './HoverBehavior.ts';
import { KeyOperationBehavior } from './KeyOperationBehavior.ts';
import { LassoBehavior } from './LassoBehavior.ts';
import { MapInteractionBehavior } from './MapInteractionBehavior.ts';
import { MapNudgeBehavior } from './MapNudgeBehavior.ts';
import { PasteBehavior } from './PasteBehavior.ts';
import { SelectBehavior } from './SelectBehavior.ts';

export {
  AbstractBehavior,
  DragBehavior,
  DrawBehavior,
  HoverBehavior,
  KeyOperationBehavior,
  LassoBehavior,
  MapInteractionBehavior,
  MapNudgeBehavior,
  PasteBehavior,
  SelectBehavior
};

// Re-export types from types.ts for convenience
import type { BehaviorConstructor } from './types.ts';
export type { Behaviors, BehaviorConstructor } from './types.ts';

/**
 * Registry interface for available behaviors.
 * Contains a Map of behavior IDs to their constructor functions.
 * Behaviors in the `available` collection will be instantiated at init time.
 * Note: `KeyOperationBehavior` is not included as it requires extra constructor args.
 */
interface BehaviorRegistry {
  /** Map of behavior IDs to their constructors - behaviors here will be instantiated at init time */
  available: Map<BehaviorID, BehaviorConstructor>;
}

/**
 * Registry of available behaviors.
 * At init time, Context will instantiate any behaviors in the 'available' collection.
 */
export const behaviors: BehaviorRegistry = {
  available: new Map<BehaviorID, BehaviorConstructor>()
};

behaviors.available.set('drag', DragBehavior);
behaviors.available.set('draw', DrawBehavior);
behaviors.available.set('hover', HoverBehavior);
behaviors.available.set('lasso', LassoBehavior);
behaviors.available.set('mapInteraction', MapInteractionBehavior);
behaviors.available.set('mapNudge', MapNudgeBehavior);
behaviors.available.set('paste', PasteBehavior);
behaviors.available.set('select', SelectBehavior);
