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

// At init time, we will instantiate any that are in the 'available' collection.
export const behaviors = {
  available:  new Map()  // Map<behaviorID, Behavior constructor>
};

behaviors.available.set('drag', DragBehavior);
behaviors.available.set('draw', DrawBehavior);
behaviors.available.set('hover', HoverBehavior);
behaviors.available.set('lasso', LassoBehavior);
behaviors.available.set('mapInteraction', MapInteractionBehavior);
behaviors.available.set('mapNudge', MapNudgeBehavior);
behaviors.available.set('paste', PasteBehavior);
behaviors.available.set('select', SelectBehavior);

/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  @typedef  {string}            behaviorID
 *  @typedef  {AbstractBehavior}  Behavior
 */
