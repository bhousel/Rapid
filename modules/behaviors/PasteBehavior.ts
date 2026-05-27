import { Extent, projWgs84ToWorld, vecSubtract } from '@rapid-sdk/math';

import { AbstractBehavior } from './AbstractBehavior.ts';
import { actionCopyEntities } from '../actions/copy_entities.ts';
import { actionMove } from '../actions/move.ts';
import { utilDetect } from '../util/detect.ts';

import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';


/**
 * `PasteBehavior` listens for key event '⌘V' when pasting is allowed
 */
export class PasteBehavior extends AbstractBehavior {
  /** Whether the user is on macOS (affects modifier key detection) */
  private _isMacOS: boolean;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'paste';

    this._isMacOS = (utilDetect().os === 'mac');

    // Make sure the event handlers have `this` bound correctly
    this._keydown = this._keydown.bind(this);
  }


  /**
   * Bind event handlers
   */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.on('keydown', this._keydown);
  }


  /**
   * Unbind event handlers
   */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.off('keydown', this._keydown);
  }


  /**
   * Handler for keydown events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  _keydown(e: KeyboardEvent): void {
    const isMacOS = this._isMacOS;
    const modifier = (isMacOS && e.metaKey) || (!isMacOS && e.ctrlKey);
    if (modifier && e.key === 'v') {
      this._doPaste(e);
    }
  }


  /**
   * Pastes copied features onto the map, if possible
   * @param  e - A DOM KeyboardEvent
   */
  _doPaste(e: KeyboardEvent): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;

    // Note: nearly the same code appears in both PasteBehavior and PasteOperation
    const copyGraph = context.copyGraph;
    const copyIDs = context.copyIDs;
    if (!copyIDs.length || !copyGraph) return;   // Nothing to copy..

    // Prevent paste if the pasted object would be invisible (see iD#10000)
    const osmLayer = gfx.scene!.layers.get('osm');
    if (!osmLayer?.enabled) return;

    // Ignore it if we are not over the canvas
    // (e.g. sidebar, out of browser window, over a button, toolbar, modal)
    const eventManager = gfx.eventManager!;
    if (!eventManager.pointerOverRenderer) return;

    e.preventDefault();
    e.stopPropagation();

    const action = actionCopyEntities(copyIDs, copyGraph);
    editor.beginTransaction();
    editor.perform(action);

    const currGraph = editor.staging.graph;
    const copies = action.copies() as Record<string, OsmEntity>;

    const originalIDs = new Set<EntityID>();
    for (const entity of Object.values(copies)) {
      originalIDs.add((entity as OsmEntity).id);
    }

    let extent = new Extent();
    const newIDs: EntityID[] = [];
    for (const [entityID, newEntity] of Object.entries(copies)) {
      const oldEntity = copyGraph.entity(entityID);
      const oldExtent = oldEntity.extent();
      if (oldExtent) {
        extent = extent.extend(oldExtent);
      }

      // Exclude child nodes from newIDs if their parent way was also copied.
      const parents = currGraph.parentWays(newEntity);
      const parentCopied = parents.some(parent => originalIDs.has(parent.id));

      if (!parentCopied) {
        newIDs.push(newEntity.id);
      }
    }

    // Move pasted features to where mouse pointer is..
    // (or center of map if there is no readily available pointer coordinate)
    const copyLoc = context.copyLoc;
    const copyWorld = projWgs84ToWorld(copyLoc ?? extent.center());
    const delta = vecSubtract(map.mouseWorld(), copyWorld);
    const annotation = l10n.t('operations.paste.annotation', { n: newIDs.length });

    editor.perform(actionMove(newIDs, delta));
    editor.commit({ annotation: annotation, selectedIDs: newIDs });
    editor.endTransaction();

    // Put the user in move mode so they can place the pasted features
    context.enter('move', { selection: { osm: newIDs }} );
  }

}
