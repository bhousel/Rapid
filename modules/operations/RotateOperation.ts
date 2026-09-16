import { utilGetAllNodes } from '@rapid-sdk/util';

import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmRelation } from '../data/types.ts';


/**
 * `RotateOperation` puts the user into the rotate mode to spin the selected features.
 */
export class RotateOperation extends AbstractOperation {

  /** The selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The locations of all involved nodes */
  protected _coords: Vec2[];
  /** The combined extent of the selection */
  protected _extent: Extent;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to rotate
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._extent = utilTotalExtent(this._entities, graph);
    this._coords = (utilGetAllNodes(selectedIDs, graph) as OsmNode[]).map(node => node.loc!);

    this.id = 'rotate';
    this.keys = [ l10n.t('shortcuts.command.rotate.key') ];
    this.title = l10n.t('operations.rotate.title');
    this.behavior = new KeyOperationBehavior(context, this);
    this.mouseOnly = true;
  }


  public run(): void {
    this.context.enter('rotate', { selection: { osm: this.selectedIDs }} );
  }


  public available(): boolean {
    return this._coords.length >= 2;
  }


  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;
    const settings = context.systems.settings;
    const viewport = context.viewport;

    const graph = editor.staging.graph;
    const coords = this._coords;
    const extent = this._extent;
    const isNew = this._isNew;

    if (!isNew && tooLarge()) {
      return 'too_large';
    } else if (!isNew && notDownloaded()) {
      return 'not_downloaded';
    } else if (this.selectedIDs.some(context.hasHiddenConnections)) {
      return 'connected_to_hidden';
    } else if (this._entities.some(incompleteRelation)) {
      return 'incomplete_relation';
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

    // If fhe selection involves a relation that has not been completely downloaded
    function incompleteRelation(entity: OsmEntity): boolean {
      return entity.type === 'relation' && !(entity as OsmRelation).isComplete(graph);
    }
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.rotate.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t(`operations.rotate.description`, { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const editor = this.context.systems.editor!;
    const l10n = this.context.systems.l10n!;

    if (this.selectedIDs.length === 1) {
      const graph = editor.staging.graph;
      const entity = graph.entity(this.selectedIDs[0]);
      return l10n.t('operations.rotate.annotation.' + entity.geometry(graph));
    } else {
      return l10n.t('operations.rotate.annotation.feature', { n: this.selectedIDs.length });
    }
  }
}
