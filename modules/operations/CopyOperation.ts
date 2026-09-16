import { utilArrayGroupBy } from '@rapid-sdk/util';

import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilCmd, utilTotalExtent } from '../util/index.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmRelation, OsmWay } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * `CopyOperation` copies the selected features to the clipboard.
 */
export class CopyOperation extends AbstractOperation {

  /** The copyable selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The combined extent of the selection */
  protected _extent: Extent;
  /** The screen coordinate the copy was triggered at, if any */
  protected _point: Vec2 | null;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to copy
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs
      .map(entityID => graph.hasEntity(entityID))
      .filter(entity => {
        // don't copy untagged vertices separately from ways
        return entity && (entity.hasInterestingTags() || entity.geometry(graph) !== 'vertex');
      }) as OsmEntity[];

    this._isNew = this._entities.every(entity => entity.isNew());
    this._extent = utilTotalExtent(this._entities, graph);
    this._point = null;

    this.id = 'copy';
    this.keys = [ utilCmd('⌘C') ];
    this.title = l10n.t('operations.copy.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    const graph = editor.staging.graph;
    const selected = Object.assign(
      { relation: [], way: [], node: [] },
      utilArrayGroupBy(this._entities, 'type')
    ) as { relation: OsmEntity[]; way: OsmEntity[]; node: OsmEntity[] };

    const canCopy: EntityID[] = [];
    let skip: Record<EntityID, boolean> = {};
    let entity: OsmEntity;
    let i: number;

    for (i = 0; i < selected.relation.length; i++) {
      entity = selected.relation[i];
      if (!skip[entity.id] && (entity as OsmRelation).isComplete(graph)) {
        canCopy.push(entity.id);
        skip = this._getDescendants(entity.id, graph, skip);
      }
    }
    for (i = 0; i < selected.way.length; i++) {
      entity = selected.way[i];
      if (!skip[entity.id]) {
        canCopy.push(entity.id);
        skip = this._getDescendants(entity.id, graph, skip);
      }
    }
    for (i = 0; i < selected.node.length; i++) {
      entity = selected.node[i];
      if (!skip[entity.id]) {
        canCopy.push(entity.id);
      }
    }

    context.copyIDs = canCopy;

    if (this._point && (canCopy.length !== 1 || graph.entity(canCopy[0]).type !== 'node')) {
      // store the anchor coordinates if copying more than a single node
      context.copyLoc = context.viewport.unproject(this._point);
    } else {
      context.copyLoc = null;
    }
  }


  public available(): boolean {
    return this._entities.length > 0;
  }


  public disabled(): string | false {
    const context = this.context;
    const settings = context.systems.settings;
    const viewport = context.viewport;

    const extent = this._extent;

    if (!this._isNew && tooLarge()) {
      return 'too_large';
    }
    return false;

    // If the selection is not 80% contained in view
    function tooLarge(): boolean {
      const allowLargeEdits = settings?.get('poweruser.allowLargeEdits') === 'true';
      return !allowLargeEdits && extent.percentContainedIn(viewport.visibleExtent()) < 0.8;
    }
  }


  public availableForKeypress(): boolean {
    // if the user has text selected then let them copy that, not the selected feature
    const selection = globalThis.getSelection?.();
    return !selection || !selection.toString();
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.copy.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t('operations.copy.description', { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.copy.annotation', { n: this.selectedIDs.length });
  }


  public point(val: Vec2 | null): void {
    this._point = val;
  }


  protected _getDescendants(id: EntityID, graph: Graph, descendants: Record<EntityID, boolean>): Record<EntityID, boolean> {
    const entity = graph.entity(id);
    let children: EntityID[];

    if (entity.type === 'relation') {
      children = (entity as OsmRelation).members.map(member => member.id);
    } else if (entity.type === 'way') {
      children = (entity as OsmWay).nodes;
    } else {
      children = [];
    }

    for (const child of children) {
      if (!descendants[child]) {
        descendants[child] = true;
        descendants = this._getDescendants(child, graph, descendants);
      }
    }

    return descendants;
  }
}
