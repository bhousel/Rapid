import { actionReverse } from '../actions/reverse.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';

import type { ReverseAction } from '../actions/reverse.ts';
import type { Context } from '../Context.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * `ReverseOperation` reverses the direction of the selected way(s) or node(s),
 * updating any direction-dependent tags.
 */
export class ReverseOperation extends AbstractOperation {

  /** The reverse actions to perform, one per eligible entity */
  protected _actions: ReverseAction[];
  /** `'line'`, `'point'`, or `'feature'` - affects the labels shown */
  protected _reverseType: string;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to reverse
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const l10n = context.systems.l10n!;

    this._actions = selectedIDs
      .map(entityID => this._getAction(entityID))
      .filter(Boolean) as ReverseAction[];
    this._reverseType = this._getReverseType();

    this.id = 'reverse';
    this.keys = [ l10n.t('shortcuts.command.reverse.key') ];
    this.title = l10n.t('operations.reverse.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    if (!this._actions.length) return;

    const actions = this._actions;
    const combinedAction = (graph: Graph): Graph => {
      for (const action of actions) {
        graph = action(graph);
      }
      return graph;
    };

    const annotation = this.annotation();
    editor.perform(combinedAction);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });
  }


  public available(): boolean {
    return this._actions.length > 0;
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.reverse.description.${this._reverseType}`);
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.reverse.annotation.${this._reverseType}`, { n: this._actions.length });
  }


  protected _getAction(entityID: EntityID): ReverseAction | null {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;

    const entity = graph.hasEntity(entityID);
    if (!entity) return null;

    const geometry = entity.geometry(graph);
    if (entity.type !== 'node' && geometry !== 'line') return null;

    const action = actionReverse(entityID);
    if (action.disabled(graph)) return null;

    return action;
  }


  protected _getReverseType(): string {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;

    const nodeActionCount = this._actions.filter(action => {
      const entity = graph.hasEntity(action.entityID());
      return entity?.type === 'node';
    }).length;

    if (nodeActionCount === 0) return 'line';
    if (nodeActionCount === this._actions.length) return 'point';
    return 'feature';
  }
}
