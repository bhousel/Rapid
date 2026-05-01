import { DEG2RAD, vecAdd, vecScale, vecSubtract } from '@rapid-sdk/math';

import { AbstractMode } from './AbstractMode.ts';
import { actionRotate } from '../actions/rotate.ts';

import type { Context } from '../Context.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Options for entering `RotateMode` */
export interface RotateModeOptions {
  /** Selection object where keys are layerIDs and values are arrays of dataIDs */
  selection?: Record<string, EntityID[]>;
}


/**
 * In `RotateMode`, we are rotating one or more map features.
 */
export class RotateMode extends AbstractMode {
  /** Entity IDs being rotated */
  private _entityIDs: EntityID[];
  /** Last pointer position for calculating rotation delta */
  private _lastPoint: Vec2 | null;
  /** Pivot location for rotation (in world coordinates) */
  private _pivotWorld: Vec2 | null;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'rotate';

    this._entityIDs = [];
    this._lastPoint = null;
    this._pivotWorld = null;

    // Make sure the event handlers have `this` bound correctly
    this._cancel = this._cancel.bind(this);
    this._finish = this._finish.bind(this);
    this._keydown = this._keydown.bind(this);
    this._pointermove = this._pointermove.bind(this);
  }


  /**
   * Enters the mode.
   * @param  options - Optional options object
   * @return `true` if the mode can be entered, `false` if not
   */
  enter(options: RotateModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const filters = context.systems.filters!;
    const locations = context.systems.locations;
    const eventManager = context.systems.gfx!.eventManager!;

    const selection = options.selection ?? {};
    const entityIDs = selection.osm ?? [];

    // Gather valid entities and entityIDs from selection.
    // For this mode, keep only the OSM data.
    this._selectedData = new Map();

    for (const entityID of entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) continue;   // not in the osm graph
      if (entity.type === 'node') {
        const loc = (entity as OsmNode).loc;
        if (loc && locations?.isBlockedAt(loc)) continue;  // editing is blocked
      }

      this._selectedData.set(entityID, entity);
    }

    if (!this._selectedData.size) return false;  // nothing to select

    this._entityIDs = [...this._selectedData.keys()];  // the ones we ended up keeping
    this._active = true;

    filters.forceVisible(this._entityIDs);
    context.enableBehaviors(['mapInteraction']);

    this._lastPoint = null;
    this._pivotWorld = this._calcPivot();

    eventManager
      .on('click', this._finish)
      .on('keydown', this._keydown)
      .on('pointercancel', this._cancel)
      .on('pointermove', this._pointermove);

    return true;
  }


  /**
   * Exits the mode, committing any pending rotate operation.
   * Removes event listeners and clears state.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const eventManager = context.systems.gfx!.eventManager!;

    this._lastPoint = null;
    this._pivotWorld = null;

    filters.forceVisible([]);

    eventManager
      .off('click', this._finish)
      .off('keydown', this._keydown)
      .off('pointercancel', this._cancel)
      .off('pointermove', this._pointermove);

    // If there is work in progress, finalize it.
    if (editor.hasWorkInProgress) {
      let annotation: string;
      if (this._entityIDs.length === 1) {
        const graph = editor.staging.graph;
        const entity = graph.entity(this._entityIDs[0]);
        annotation = l10n.t('operations.rotate.annotation.' + entity.geometry(graph));
      } else {
        annotation = l10n.t('operations.rotate.annotation.feature', { n: this._entityIDs.length });
      }

      editor.commit({
        annotation: annotation,
        selectedIDs: this._entityIDs
      });
    }
  }


  /**
   * Handler for keydown events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  private _keydown(e: KeyboardEvent): void {
    if (['Enter'].includes(e.key)) {
      e.preventDefault();
      this._finish();

    } else if (['Backspace', 'Delete', 'Del', 'Escape', 'Esc'].includes(e.key)) {
      e.preventDefault();
      this._cancel();

    } else if (['m', 'M'].includes(e.key)) {
      e.preventDefault();
      this.context.enter('move', { selection: { osm: this._entityIDs }} );
    }
  }


  /**
   * Handler for pointermove events.
   * Converts pointer movement into rotation: moving left/right or up/down
   * rotates the shape clockwise or counterclockwise based on position relative to pivot.
   */
  private _pointermove(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const eventManager = context.systems.gfx!.eventManager!;
    const currPoint = eventManager.coord.map;

    // Some notes!
    // There are 2 approaches to converting user's pointer movement into a rotation.
    //
    // The "old" code calcuated the angle between the pointer and the pivot.
    // This worked great when the pointer was close to the pivot, but not all all when
    // the pointer was far from the pivot (as the angles would not change much).
    // This would be intuitive to use if there is a rotation handle for the user to grab.
    // However - we don't have that!  Users enter rotation mode either by pressing the
    // 'R' key, or by selecting the option from the edit menu.
    // The pointer is often not near the pivot at all.
    //
    // The "new" code converts +/- pointer movements into +/- rotations linearly.
    // This means that even if you are far from the pivot, moving the pointer
    // left/right or up/down, should spin the shape in a mostly intuitive way.
    //
    // We can keep the old code around in case people dislike "new" rotation, or if
    // we ever build a transforming tool with a rotation handle that the user can grab.

    // "new" - determine pointer movement dx,dy but relative to the pivot point
    if (this._lastPoint) {
      const pivotPoint = context.viewport.worldToScreen(this._pivotWorld!);
      const [dX, dY] = vecSubtract(currPoint, this._lastPoint);   // delta pointer movement
      const [sX, sY]: Vec2 = [                     // swap signs if needed
        (currPoint[0] > pivotPoint[0]) ? 1 : -1,   // right/left of pivot
        (currPoint[1] > pivotPoint[1]) ? -1 : 1    // above/below pivot
      ];
      const degrees = (sY * dX) + (sX * dY);   // Degrees rotation to apply: + clockwise, - counterclockwise
      const SPEED = 0.3;
      const angle = degrees * DEG2RAD * SPEED;
      editor.perform(actionRotate(this._entityIDs, pivotPoint, angle, context.viewport));
    }
    this._lastPoint = currPoint.slice() as Vec2;  // copy

    // "old" - rotational
    // const pivotPoint = context.viewport.worldToScreen(this._pivotWorld);
    // const currAngle = Math.atan2(currPoint[1] - pivotPoint[1], currPoint[0] - pivotPoint[0]);
    // if (this._lastAngle !== null) {
    //   const angle = currAngle - this._lastAngle;
    //   editor.perform(actionRotate(entityIDs, pivotPoint, angle, context.viewport));
    // }
    // this._lastAngle = currAngle;


    // Update selected/active collections to contain the current moved entities
    this._selectedData.clear();
    const currGraph = editor.staging.graph;
    for (const entityID of this._entityIDs) {
      this._selectedData.set(entityID, currGraph.entity(entityID));
    }
  }


  /**
   * Calculate the location that the features should pivot around.
   * We simply average the centroids of all selected entities - this gives each
   * feature equal weight regardless of size/complexity, which is more intuitive
   * for a rotation UX than a true center-of-mass calculation.
   * @return  Array [x,y] world coordinate to pivot around
   */
  private _calcPivot(): Vec2 {
    const graph = this.context.systems.editor!.staging.graph;
    let sum: Vec2 = [0, 0];
    let count = 0;

    for (const entityID of this._entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) continue;
      for (const part of entity.geoms.parts || []) {
        const centroid = part.world?.centroid;
        if (centroid) {
          sum = vecAdd(sum, centroid);
          count++;
        }
      }
    }

    return count > 0 ? vecScale(sum, 1 / count) : [0, 0];
  }


  /**
   * Return to select mode - `exit()` will finalize the work in progress.
   */
  private _finish(): void {
    this.context.enter('select-osm', { selection: { osm: this._entityIDs }} );
  }


  /**
   * Return to select mode without doing anything
   */
  private _cancel(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    editor.revert();
    context.enter('select-osm', { selection: { osm: this._entityIDs }} );
  }

}
