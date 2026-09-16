import { utilGetAllNodes } from '@rapid-sdk/util';

import { actionReflect } from '../actions/reflect.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmRelation } from '../data/types.ts';


/**
 * `ReflectOperation` reflects (mirrors) the selected features across their long or short axis.
 */
export class ReflectOperation extends AbstractOperation {

  /** `'long'` or `'short'` - which axis to reflect across */
  protected _axis: string;
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
   * @param  selectedIDs - The entityIDs to reflect
   * @param  axis - `'long'` or `'short'` axis to reflect across
   */
  public constructor(context: Context, selectedIDs: EntityID[], axis: string = 'long') {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._axis = axis;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._extent = utilTotalExtent(this._entities, graph);
    this._coords = (utilGetAllNodes(selectedIDs, graph) as OsmNode[]).map(node => node.loc!);

    this.id = `reflect-${axis}`;
    this.keys = [ l10n.t(`shortcuts.command.reflect_${axis}.key`) ];
    this.title = l10n.t(`operations.reflect.title.${axis}`);
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    const annotation = this.annotation();
    const action = actionReflect(this.selectedIDs).useLongAxis(this._axis === 'long');

    editor
      .performAsync(action)
      .then(() => editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs }));
  }


  public available(): boolean {
    return this._coords.length >= 3;
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

    function incompleteRelation(entity: OsmEntity): boolean {
      return entity.type === 'relation' && !(entity as OsmRelation).isComplete(graph);
    }
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.reflect.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t(`operations.reflect.description.${this._axis}`, { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.reflect.annotation.${this._axis}.feature`, { n: this.selectedIDs.length });
  }
}


/**
 * `ReflectShortOperation` reflects the selected features across their short axis.
 */
export class ReflectShortOperation extends ReflectOperation {
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs, 'short');
  }
}


/**
 * `ReflectLongOperation` reflects the selected features across their long axis.
 */
export class ReflectLongOperation extends ReflectOperation {
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs, 'long');
  }
}
