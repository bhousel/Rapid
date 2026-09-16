import { utilArrayUniq } from '@rapid-sdk/util';

import { actionExtract } from '../actions/extract.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent } from '@rapid-sdk/math';
import type { ExtractAction } from '../actions/extract.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * `ExtractOperation` extracts a point from the selected feature(s).
 */
export class ExtractOperation extends AbstractOperation {

  /** The selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The combined extent of the selection */
  protected _extent: Extent;
  /** The common geometry type, or `'feature'` if mixed */
  protected _geometryType: string;
  /** The extract actions to perform */
  protected _actions: ExtractAction[];


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to extract from
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._extent = utilTotalExtent(this._entities, graph);

    const geometries = utilArrayUniq(this._entities.map(entity => entity.geometry(graph)));
    this._geometryType = geometries.length === 1 ? geometries[0] : 'feature';

    this._actions = this._entities.map(entity => {
      if (!entity.hasInterestingTags()) return null;
      if (entity.type === 'node' && graph.parentWays(entity).length === 0) return null;

      if (entity.type !== 'node') {
        const preset = schema.match(entity, graph);
        // only allow extraction from ways/relations if the preset supports points
        if (!preset || !preset.geometries.has('point')) return null;
      }

      return actionExtract(entity.id);
    }).filter(Boolean) as ExtractAction[];

    this.id = 'extract';
    this.keys = [ l10n.t('shortcuts.command.extract.key') ];
    this.title = l10n.t('operations.extract.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    if (!this._actions.length) return;

    const actions = this._actions;
    const extractedNodeIDs: EntityID[] = [];
    const combinedAction = (graph: Graph): Graph => {
      for (const action of actions) {
        graph = action(graph);
        const extractedNodeID = action.getExtractedNodeID();
        if (extractedNodeID) extractedNodeIDs.push(extractedNodeID);
      }
      return graph;
    };

    const annotation = this.annotation();
    editor.beginTransaction();
    editor.perform(combinedAction);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });
    editor.endTransaction();

    this.context.enter('select-osm', { selection: { osm: extractedNodeIDs }} );
  }


  public available(): boolean {
    return this._actions.length > 0 && this.selectedIDs.length === this._actions.length;
  }


  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;
    const settings = context.systems.settings;
    const viewport = context.viewport;

    const graph = editor.staging.graph;
    const extent = this._extent;

    if (!this._isNew && tooLarge()) {
      return 'too_large';
    } else if (this.selectedIDs.some(entityID => {
      const entity = graph.entity(entityID);
      return entity.geometry(graph) === 'vertex' && context.hasHiddenConnections(entityID);
    })) {
      return 'connected_to_hidden';
    }
    return false;

    // If the selection is not 80% contained in view
    function tooLarge(): boolean {
      const allowLargeEdits = settings?.get('poweruser.allowLargeEdits') === 'true';
      return !allowLargeEdits && extent.percentContainedIn(viewport.visibleExtent()) < 0.8;
    }
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.extract.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t(`operations.extract.description.${this._geometryType}`, { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.extract.annotation', { n: this.selectedIDs.length });
  }
}
