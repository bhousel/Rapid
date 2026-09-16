import { utilGetAllNodes } from '@rapid-sdk/util';

import { actionCircularize } from '../actions/circularize.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * `CircularizeOperation` makes the selected way(s) more circular.
 */
export class CircularizeOperation extends AbstractOperation {

  /** The selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The combined extent of the selection */
  protected _extent: Extent;
  /** The circularize actions to perform, one per eligible way */
  protected _actions: Action[];
  /** The locations of all involved nodes */
  protected _coords: Vec2[];


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to circularize
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._extent = utilTotalExtent(this._entities, graph);
    this._actions = this._entities.map(entity => this._getAction(entity)).filter(Boolean) as Action[];
    this._coords = (utilGetAllNodes(selectedIDs, graph) as OsmNode[]).map(node => node.loc!);

    this.id = 'circularize';
    this.keys = [ l10n.t('shortcuts.command.circularize.key') ];
    this.title = l10n.t('operations.circularize.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    if (!this._actions.length) return;

    const actions = this._actions;
    const combinedAction: Action = (graph: Graph, t?: number): Graph => {
      for (const action of actions) {
        if (!action.disabled?.(graph)) {
          graph = action(graph, t);
        }
      }
      return graph;
    };
    combinedAction.transitionable = true;

    const annotation = this.annotation();
    editor
      .performAsync(combinedAction)
      .then(() => editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs }));
  }


  public available(): boolean {
    return this._actions.length > 0 && this.selectedIDs.length === this._actions.length;
  }


  // don't cache this because the visible extent could change
  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;
    const settings = context.systems.settings;
    const viewport = context.viewport;

    if (!this._actions.length) return '';

    const graph = editor.staging.graph;
    const coords = this._coords;
    const extent = this._extent;
    const isNew = this._isNew;

    const disabledReasons = this._actions.map(action => action.disabled?.(graph)).filter(Boolean);
    if (disabledReasons.length === this._actions.length) {  // none of the features can be circularized
      if (new Set(disabledReasons).size > 1) {
        return 'multiple_blockers';
      }
      return disabledReasons[0] as string;
    } else if (!isNew && tooLarge()) {
      return 'too_large';
    } else if (!isNew && notDownloaded()) {
      return 'not_downloaded';
    } else if (this.selectedIDs.some(context.hasHiddenConnections)) {
      return 'connected_to_hidden';
    }

    return false;

    // If the selection is not 80% contained in view
    function tooLarge(): boolean {
      const allowLargeEdits = settings?.get('poweruser.allowLargeEdits') === 'true';
      return !allowLargeEdits && extent.percentContainedIn(viewport.visibleExtent()) < 0.8;
    }

    // If fhe selection spans tiles that haven't been downloaded yet
    function notDownloaded(): boolean {
      if (context.inIntro) return false;
      const osm = context.services.osm;
      if (osm) {
        const missing = coords.filter(loc => !osm.isDataLoaded(loc));
        if (missing.length) {
          missing.forEach(loc => context.loadTileAtLoc(loc));
          return true;
        }
      }
      return false;
    }
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.circularize.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t(`operations.circularize.description`, { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.circularize.annotation.feature', { n: this._actions.length });
  }


  protected _getAction(entity: OsmEntity): Action | null {
    if (entity.type !== 'way') return null;

    const way = entity as OsmWay;
    if (new Set(way.nodes).size <= 1) return null;
    return actionCircularize(way.id);
  }
}
