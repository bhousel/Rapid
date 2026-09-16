import { geoSphericalDistance } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import { actionDeleteMultiple } from '../actions/delete_multiple.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilCmd, utilTotalExtent } from '../util/index.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmWay } from '../data/types.ts';


/**
 * `DeleteOperation` deletes the selected features.
 */
export class DeleteOperation extends AbstractOperation {

  /** The selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The delete action to perform */
  protected _action: Action;
  /** The locations of all involved nodes */
  protected _coords: Vec2[];
  /** The combined extent of the selection */
  protected _extent: Extent;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to delete
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._action = actionDeleteMultiple(selectedIDs);
    this._coords = (utilGetAllNodes(selectedIDs, graph) as OsmNode[]).map(node => node.loc!);
    this._extent = utilTotalExtent(this._entities, graph);

    this.id = 'delete';
    this.keys = [ utilCmd('⌘⌫'), utilCmd('⌘⌦'), utilCmd('⌦') ];
    this.title = l10n.t('operations.delete.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;

    const graph = editor.staging.graph;
    let nextNode: OsmNode | undefined;
    let nextLoc: Vec2 | undefined;

    // If we are deleting a vertex, try to select the next nearest vertex along the way.
    if (this._entities.length === 1) {
      const entity = this._entities[0];
      const geometry = entity.geometry(graph);
      const parents = graph.parentWays(entity);
      const parent = parents[0];

      // Select the next closest node in the way.
      if (geometry === 'vertex') {
        const nodes = parent.nodes;
        let i = nodes.indexOf(entity.id);

        if (i === 0) {
          i++;
        } else if (i === nodes.length - 1) {
          i--;
        } else {
          const a = geoSphericalDistance((entity as OsmNode).loc!, (graph.entity(nodes[i - 1]) as OsmNode).loc!);
          const b = geoSphericalDistance((entity as OsmNode).loc!, (graph.entity(nodes[i + 1]) as OsmNode).loc!);
          i = a < b ? i - 1 : i + 1;
        }

        nextNode = graph.entity(nodes[i]) as OsmNode;
        nextLoc = nextNode.loc;
      }
    }

    const annotation = this.annotation();  // watch out! calculate this _before_ we delete the stuff.
    editor.perform(this._action);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });

    if (nextNode && nextLoc) {
      map.centerEase(nextLoc);
      // Try to select the next node.
      // It may be deleted and that's ok, we'll fallback to browse mode automatically
      context.enter('select-osm', { selection: { osm: [nextNode.id] }} );
    } else {
      context.enter('browse');
    }
  }


  public available(): boolean {
    return true;
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
    } else if (this.selectedIDs.some(protectedMember)) {
      return 'part_of_relation';
    } else if (this.selectedIDs.some(incompleteRelation)) {
      return 'incomplete_relation';
    } else if (this.selectedIDs.some(hasWikidataTag)) {
      return 'has_wikidata_tag';
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

    function hasWikidataTag(id: EntityID): boolean {
      const entity = graph.entity(id);
      return Boolean(entity.tags.wikidata && entity.tags.wikidata.trim().length > 0);
    }

    function incompleteRelation(id: EntityID): boolean {
      const entity = graph.entity(id);
      return entity.type === 'relation' && !(entity as OsmRelation).isComplete(graph);
    }

    function protectedMember(id: EntityID): boolean {
      const entity = graph.entity(id);
      if (entity.type !== 'way') return false;

      const parents = graph.parentRelations(entity as OsmWay);
      for (const parent of parents) {
        const type = parent.tags.type;
        const role = parent.memberById(id)?.role || 'outer';
        if (type === 'route' || type === 'boundary' || (type === 'multipolygon' && role === 'outer')) {
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
      l10n.t(`operations.delete.${disabledReason}`, { n: this.selectedIDs.length }) :
      l10n.t(`operations.delete.description`, { n: this.selectedIDs.length });
  }


  public annotation(): string {
    const editor = this.context.systems.editor!;
    const l10n = this.context.systems.l10n!;

    if (this.selectedIDs.length === 1) {
      const graph = editor.staging.graph;
      const entity = graph.entity(this.selectedIDs[0]);
      return l10n.t('operations.delete.annotation.' + entity.geometry(graph));
    } else {
      return l10n.t('operations.delete.annotation.feature', { n: this.selectedIDs.length });
    }
  }
}
