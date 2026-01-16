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

import type { Context } from '../Context.ts';

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

/** Type alias for behavior identifiers */
export type BehaviorID = string;

/** Type alias for Behavior classes */
export type Behavior = AbstractBehavior;

/** Constructor type for behaviors */
export type BehaviorConstructor = new (context: Context) => AbstractBehavior;

/** Collection of available behaviors */
export interface BehaviorRegistry {
  available: Map<BehaviorID, BehaviorConstructor>;
}

// At init time, we will instantiate any that are in the 'available' collection.
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
