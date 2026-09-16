import { actionJoin } from '../actions/join.ts';
import { actionMerge } from '../actions/merge.ts';
import { actionMergeNodes } from '../actions/merge_nodes.ts';
import { actionMergePolygon } from '../actions/merge_polygon.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';

import type { Action } from '../actions/types.ts';
import type { JoinAction } from '../actions/join.ts';
import type { Context } from '../Context.ts';


/**
 * `MergeOperation` merges the selected features together, choosing the appropriate
 * merge strategy (join, merge, merge polygon, or merge nodes).
 */
export class MergeOperation extends AbstractOperation {

  /** The chosen merge action */
  protected _action: Action;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to merge
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const l10n = context.systems.l10n!;

    this._action = this._chooseAction();

    this.id = 'merge';
    this.keys = [ l10n.t('shortcuts.command.merge.key') ];
    this.title = l10n.t('operations.merge.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    if (this.disabled()) return;

    const annotation = this.annotation();
    editor.perform(this._action);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });

    const graph = editor.staging.graph;  // after edit
    let successorIDs = this.selectedIDs.filter(entityID => graph.hasEntity(entityID));
    if (successorIDs.length > 1) {
      const interestingIDs = successorIDs.filter(entityID => graph.entity(entityID).hasInterestingTags());
      if (interestingIDs.length) {
        successorIDs = interestingIDs;
      }
    }
    context.enter('select-osm', { selection: { osm: successorIDs }} );
  }


  public available(): boolean {
    return this.selectedIDs.length >= 2;
  }


  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;

    const graph = editor.staging.graph;
    const action = this._action;
    const actionDisabled = action.disabled?.(graph);
    if (actionDisabled) return actionDisabled;

    const osm = context.services.osm;
    const resultingWayNodesLength = (action as Partial<JoinAction>).resultingWayNodesLength;
    if (osm && resultingWayNodesLength && resultingWayNodesLength(graph) > osm.maxWayNodes) {
      return 'too_many_vertices';
    }

    return false;
  }


  public tooltip(): string {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    const disabledReason = this.disabled();

    if (disabledReason) {
      if (disabledReason === 'conflicting_relations') {
        return l10n.t('operations.merge.conflicting_relations');
      } else if (disabledReason === 'restriction' || disabledReason === 'connectivity') {
        const preset = schema.getScope('osm').presets.get(`type/${disabledReason}`);
        return l10n.t('operations.merge.damage_relation', { relation: preset?.name });
      } else {
        return l10n.t(`operations.merge.${disabledReason}`);
      }
    } else {
      return l10n.t('operations.merge.description');
    }
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.merge.annotation', { n: this.selectedIDs.length });
  }


  protected _chooseAction(): Action {
    const context = this.context;
    const editor = context.systems.editor!;
    const settings = context.systems.settings;

    const graph = editor.staging.graph;
    const selectedIDs = this.selectedIDs;
    const tagnosticRoadCombine = settings?.get('poweruser.tagnosticRoadCombine') === 'true';
    const options = { tagnosticRoadCombine: tagnosticRoadCombine };

    // prefer a non-disabled action first
    const join = actionJoin(selectedIDs, options);
    if (!join.disabled?.(graph)) return join;

    const merge = actionMerge(selectedIDs);
    if (!merge.disabled?.(graph)) return merge;

    const mergePolygon = actionMergePolygon(selectedIDs);
    if (!mergePolygon.disabled?.(graph)) return mergePolygon;

    const mergeNodes = actionMergeNodes(selectedIDs);
    if (!mergeNodes.disabled?.(graph)) return mergeNodes;

    // otherwise prefer an action with an interesting disabled reason
    if (join.disabled?.(graph) !== 'not_eligible') return join;
    if (merge.disabled?.(graph) !== 'not_eligible') return merge;
    if (mergePolygon.disabled?.(graph) !== 'not_eligible') return mergePolygon;

    return mergeNodes;
  }
}
