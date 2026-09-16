import { utilArrayGroupBy } from '@rapid-sdk/util';

import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';

import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';


/**
 * `ContinueOperation` continues drawing a line from the endpoint of an existing line.
 */
export class ContinueOperation extends AbstractOperation {

  /** The vertex to continue drawing from, or `null` if the selection isn't eligible */
  protected _continueFromNode: OsmNode | null;
  /** The line geometries in the selection */
  protected _lines: OsmEntity[];
  /** The vertex geometries in the selection */
  protected _vertices: OsmEntity[];
  /** The candidate ways that could be continued */
  protected _candidates: OsmWay[];


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to continue from
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    const entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    const geometries = Object.assign(
      { line: [], vertex: [] },
      utilArrayGroupBy(entities, entity => entity.geometry(graph))
    ) as { line: OsmEntity[]; vertex: OsmEntity[] };

    this._lines = geometries.line;
    this._vertices = geometries.vertex;
    this._continueFromNode = this._vertices.length === 1 ? (this._vertices[0] as OsmNode) : null;
    this._candidates = this._candidateWays();

    this.id = 'continue';
    this.keys = [ l10n.t('shortcuts.command.continue_line.key') ];
    this.title = l10n.t('operations.continue.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;

    if (!this._candidates.length) return;

    context.enter('draw-line', {
      continueWayID: this._candidates[0].id,
      continueNodeID: this._continueFromNode!.id
    });
  }


  public relatedEntityIds(): EntityID[] {
    return this._candidates.length ? [ this._candidates[0].id ] : [];
  }


  public available(): boolean {
    const editor = this.context.systems.editor!;
    const filters = this.context.systems.filters!;
    const graph = editor.staging.graph;

    return this._vertices.length === 1 && this._lines.length <= 1 &&
      !filters.hasHiddenConnections(this._continueFromNode!, graph);
  }


  public disabled(): string | false {
    if (this._candidates.length === 0) {
      return 'not_eligible';
    } else if (this._candidates.length > 1) {
      return 'multiple';
    }
    return false;
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.continue.${disabledReason}`) :
      l10n.t('operations.continue.description');
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.continue.annotation.line');
  }


  protected _candidateWays(): OsmWay[] {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;

    const continueFromNode = this._continueFromNode;
    if (!continueFromNode) return [];

    return graph.parentWays(continueFromNode).filter(parent => {
      return parent.geometry(graph) === 'line' &&
        !parent.isClosed() &&
        parent.affix(continueFromNode.id) &&
        (this._lines.length === 0 || this._lines[0] === parent);
    });
  }
}
