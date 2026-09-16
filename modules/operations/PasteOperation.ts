import { Extent, projWgs84ToWorld, vecSubtract } from '@rapid-sdk/math';

import { actionCopyEntities } from '../actions/copy_entities.ts';
import { actionMove } from '../actions/move.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilCmd } from '../util/cmd.ts';

import type { Context } from '../Context.ts';


/**
 * `PasteOperation` pastes the previously-copied features near the pointer.
 * See also `PasteBehavior`.
 */
export class PasteOperation extends AbstractOperation {

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);

    const l10n = context.systems.l10n!;

    this.id = 'paste';
    this.keys = [ utilCmd('⌘V') ];
    this.title = l10n.t('operations.paste.title');
    // Note: paste has no `KeyOperationBehavior` - it is bound via `PasteBehavior`.
  }


  public run(): void {
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
    const osmLayer = gfx.scene?.layers.get('osm');
    if (!osmLayer?.enabled) return;

    const action = actionCopyEntities(copyIDs, copyGraph);
    editor.beginTransaction();
    editor.perform(action);

    const currGraph = editor.staging.graph;
    const copies = action.copies();

    const originalIDs = new Set<EntityID>();
    for (const entity of Object.values(copies)) {
      originalIDs.add(entity.id);
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


  public available(): boolean {
    return this.context.mode?.id === 'browse';
  }


  public disabled(): string | false {
    return !this.context.copyIDs.length ? 'nothing_copied' : false;
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const oldGraph = this.context.copyGraph;
    const ids = this.context.copyIDs;
    if (!ids.length || !oldGraph) {
      return l10n.t('operations.paste.nothing_copied');
    }
    return l10n.t('operations.paste.description', {
      feature: l10n.displayLabel(oldGraph.entity(ids[0]), oldGraph),
      n: ids.length
    });
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    const ids = this.context.copyIDs;
    return l10n.t('operations.paste.annotation', { n: ids.length });
  }
}
