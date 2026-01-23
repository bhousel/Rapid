/**
 * Type definitions for the behaviors module.
 * These types represent the behavior instances container.
 * @module
 */

import type { Context } from '../Context.ts';
import type { AbstractBehavior } from './AbstractBehavior.ts';
import type { DragBehavior } from './DragBehavior.ts';
import type { DrawBehavior } from './DrawBehavior.ts';
import type { HoverBehavior } from './HoverBehavior.ts';
import type { LassoBehavior } from './LassoBehavior.ts';
import type { MapInteractionBehavior } from './MapInteractionBehavior.ts';
import type { MapNudgeBehavior } from './MapNudgeBehavior.ts';
import type { PasteBehavior } from './PasteBehavior.ts';
import type { SelectBehavior } from './SelectBehavior.ts';

/** A Behavior class constructor */
export type BehaviorConstructor = new (context: Context) => AbstractBehavior;

/**
 * Container interface for all behavior instances.
 * Behaviors are accessed via `context.behaviors[behaviorID]`.
 * The index signature allows flexible access by behavior ID,
 * while specific properties provide type-safe access to known behaviors.
 * Note: `KeyOperationBehavior` is not included as it's created dynamically per-operation.
 */
export interface Behaviors {
  /** Index signature for flexible behavior access by ID */
  [key: BehaviorID]: AbstractBehavior | undefined;

  drag?: DragBehavior;
  draw?: DrawBehavior;
  hover?: HoverBehavior;
  lasso?: LassoBehavior;
  mapInteraction?: MapInteractionBehavior;
  mapNudge?: MapNudgeBehavior;
  paste?: PasteBehavior;
  select?: SelectBehavior;
}
