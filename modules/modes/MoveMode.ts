import { AbstractMode } from './AbstractMode.ts';
import { actionMove } from '../actions/move.ts';
import { projWgs84ToWorld, vecSubtract } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { MoveCache } from '../actions/move.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Options for entering `MoveMode` */
export interface MoveModeOptions {
  /** Selection object where keys are layerIDs and values are arrays of dataIDs */
  selection?: Record<string, EntityID[]>;
}


/**
 * In `MoveMode`, the user is moving one or more map features.
 */
export class MoveMode extends AbstractMode {

  /** Entity IDs being moved */
  protected _entityIDs: EntityID[];
  /** Starting location of the move operation */
  protected _startLoc: Vec2 | null;
  /** Cache used by the move action */
  protected _movementCache: Partial<MoveCache> | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'move';

    this._entityIDs = [];
    this._startLoc = null;
    this._movementCache = null;

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
  public enter(options: MoveModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const graph = editor.staging.graph;
    const filters = context.systems.filters!;
    const locations = context.systems.locations;
    const map = context.systems.map!;
    const eventManager = gfx.eventManager;

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
    context.enableBehaviors(['mapInteraction', 'mapNudge']);
    context.behaviors.mapNudge!.allow();

    this._startLoc = map.mouseLoc();
    this._movementCache = {};

    eventManager!
      .on('click', this._finish)
      .on('keydown', this._keydown)
      .on('pointercancel', this._cancel)
      .on('pointermove', this._pointermove);

    return true;
  }


  /**
   * Exits the mode, committing any pending move operation.
   * Removes event listeners and clears state.
   */
  public exit(): void {
    if (!this._active) return;
    this._active = false;

    this._startLoc = null;
    this._movementCache = null;

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const eventManager = context.systems.gfx!.eventManager!;

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
        annotation = l10n.t('operations.move.annotation.' + entity.geometry(graph));
      } else {
        annotation = l10n.t('operations.move.annotation.feature', { n: this._entityIDs.length });
      }

      editor.commit({
        annotation: annotation,
        selectedIDs: this._entityIDs
      });
    }
  }


  /**
   * Handler for keydown events on the window.
   * Handles Enter to finish, Escape/Delete to cancel, and R to switch to rotate mode.
   * @param  e - A DOM KeyboardEvent
   */
  protected _keydown(e: KeyboardEvent): void {
    if (['Enter'].includes(e.key)) {
      e.preventDefault();
      this._finish();

    } else if (['Backspace', 'Delete', 'Del', 'Escape', 'Esc'].includes(e.key)) {
      e.preventDefault();
      this._cancel();

    } else if (['r', 'R'].includes(e.key)) {
      e.preventDefault();
      this.context.enter('rotate', { selection: { osm: this._entityIDs }} );
    }
  }


  /**
   * Handler for pointermove events.
   * Calculates the delta from the start location and moves all selected entities.
   */
  protected _pointermove(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const locations = context.systems.locations;
    const map = context.systems.map!;

    const currLoc = map.mouseLoc();
    if (locations?.isBlockedAt(currLoc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    const startPoint = projWgs84ToWorld(this._startLoc!);
    const currPoint = projWgs84ToWorld(currLoc);
    const delta = vecSubtract(currPoint, startPoint);

    editor.revert();  // moves are relative to the start location, so revert before applying movement
    editor.perform(actionMove(this._entityIDs, delta, this._movementCache!));
    const graph = editor.staging.graph;  // after move

    // Update selected/active collections to contain the moved entities
    this._selectedData.clear();
    for (const entityID of this._entityIDs) {
      this._selectedData.set(entityID, graph.entity(entityID));
    }
  }


  /**
   * Return to select mode - `exit()` will finalize the work in progress.
   */
  protected _finish(): void {
    this.context.enter('select-osm', { selection: { osm: this._entityIDs }} );
  }


  /**
   * Return to select mode without doing anything
   */
  protected _cancel(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    editor.revert();
    context.enter('select-osm', { selection: { osm: this._entityIDs }} );
  }

}
