import { actionSplit } from '../actions/split.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';

import type { SplitAction } from '../actions/split.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmWay } from '../data/types.ts';


/**
 * `SplitOperation` splits the selected way(s) at the selected vertex/vertices.
 */
export class SplitOperation extends AbstractOperation {

  /** The vertices to split at */
  protected _vertexIDs: EntityID[];
  /** `'single'` or `'multiple'` - affects the labels shown */
  protected _vertexMulti: string;
  /** The selected way IDs */
  protected _wayIDs: EntityID[];
  /** Whether the operation can be performed on the current selection */
  protected _isAvailable: boolean;
  /** The split action to perform */
  protected _action: SplitAction;
  /** `'line'`, `'area'`, or `'feature'` - affects the labels shown */
  protected _geometry: string;
  /** The ways that would be split */
  protected _splittable: OsmWay[];
  /** `'single'` or `'multiple'` - affects the labels shown */
  protected _waysMulti: string;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to split
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    const entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    const vertices = entities.filter(entity => entity.type === 'node' && entity.geometry(graph) === 'vertex');
    const ways = entities.filter(entity => entity.type === 'way');

    this._vertexIDs = vertices.map(entity => entity.id);
    this._vertexMulti = this._vertexIDs.length === 1 ? 'single' : 'multiple';
    this._wayIDs = ways.map(entity => entity.id);
    this._isAvailable = vertices.length > 0 && (vertices.length + ways.length === selectedIDs.length);
    this._action = actionSplit(this._vertexIDs);
    this._geometry = 'feature';   // 'line', 'area', or 'feature'
    this._splittable = [];
    this._waysMulti = 'single';

    if (this._isAvailable) {
      if (this._wayIDs.length) {
        this._action.limitWays(this._wayIDs);
      }

      this._splittable = this._action.ways(graph);

      // Check the geometries of the splittable ways (line or area)
      const geometries = new Set<string>();
      for (const way of this._splittable) {
        geometries.add(way.geometry(graph));
      }
      // Are all splittable ways same geometry?  (line or area)
      // (this only affects messages shown in annotation and tooltip)
      if (geometries.size === 1) {
        this._geometry = Array.from(geometries)[0];
      }

      this._waysMulti = this._splittable.length === 1 ? 'single' : 'multiple';
    }

    this.id = 'split';
    this.keys = [ l10n.t('shortcuts.command.split.key') ];
    this.title = l10n.t('operations.split.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    const annotation = this.annotation();
    const difference = editor.perform(this._action);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });

    const idsToSelect = this._vertexIDs.slice();  // copy

    // select both the nodes and the ways so the mapper can immediately disconnect them if desired
    if (difference) {
      for (const [entityID, change] of difference.changes) {
        const entity = change.head;
        if (entity && entity.type === 'way') {
          idsToSelect.push(entityID);
        }
      }
    }
    context.enter('select-osm', { selection: { osm: idsToSelect }} );
  }


  public relatedEntityIds(): EntityID[] {
    return this._splittable.map(way => way.id);
  }


  public available(): boolean {
    return this._isAvailable;
  }


  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;

    const graph = editor.staging.graph;
    const disabledReason = this._action.disabled?.(graph);
    if (disabledReason) {
      return disabledReason;
    } else if (this.selectedIDs.some(context.hasHiddenConnections)) {
      return 'connected_to_hidden';
    }
    return false;
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.split.${disabledReason}`) :
      l10n.t(`operations.split.description.${this._geometry}.${this._waysMulti}.${this._vertexMulti}_node`);
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.split.annotation.${this._geometry}`, { n: this._splittable.length });
  }
}
