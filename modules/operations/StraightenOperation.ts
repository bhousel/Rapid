import { utilArrayDifference, utilGetAllNodes } from '@rapid-sdk/util';

import { actionStraightenNodes } from '../actions/straighten_nodes.ts';
import { actionStraightenWay } from '../actions/straighten_way.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';


/**
 * `StraightenOperation` straightens the selected line(s) or line of nodes.
 */
export class StraightenOperation extends AbstractOperation {

  /** The selected entities */
  protected _entities: OsmEntity[];
  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The selected ways */
  protected _ways: OsmEntity[];
  /** The selected way IDs */
  protected _wayIDs: EntityID[];
  /** The selected nodes */
  protected _nodes: OsmEntity[];
  /** The selected node IDs */
  protected _nodeIDs: EntityID[];
  /** The locations of all involved nodes */
  protected _coords: Vec2[];
  /** The extent of the portion being straightened */
  protected _extent: Extent;
  /** `'point'` or `'line'` - affects the labels shown */
  protected _geometry?: string;
  /** The action to perform, or `null` if the selection isn't eligible */
  protected _action: Action | null;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to straighten
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    this._entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];
    this._isNew = this._entities.every(entity => entity.isNew());
    this._ways = this._entities.filter(entity => entity.type === 'way');
    this._wayIDs = this._ways.map(entity => entity.id);
    this._nodes = this._entities.filter(entity => entity.type === 'node');
    this._nodeIDs = this._nodes.map(entity => entity.id);
    this._coords = (utilGetAllNodes(selectedIDs, graph) as OsmNode[]).map(node => node.loc!);
    this._extent = utilTotalExtent(selectedIDs, graph);
    this._action = this._chooseAction();

    this.id = 'straighten';
    this.keys = [ l10n.t('shortcuts.command.straighten.key') ];
    this.title = l10n.t('operations.straighten.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    const action = this._action;
    if (!action) return;

    const annotation = this.annotation();
    editor
      .performAsync(action)
      .then(() => editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs }));
  }


  public available(): boolean {
    return Boolean(this._action);
  }


  public disabled(): string | false {
    const context = this.context;
    const editor = context.systems.editor!;
    const settings = context.systems.settings;
    const viewport = context.viewport;

    const action = this._action;
    if (!action) return false;

    const graph = editor.staging.graph;
    const coords = this._coords;
    const extent = this._extent;
    const isNew = this._isNew;

    const disabledReason = action.disabled?.(graph);
    if (disabledReason) {
      return disabledReason;
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
      l10n.t(`operations.straighten.${disabledReason}`, { n: this._ways.length || this._nodes.length }) :
      l10n.t(`operations.straighten.description.${this._geometry}` + (this._ways.length === 1 ? '' : 's'));
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.straighten.annotation.${this._geometry}`, { n: this._ways.length || this._nodes.length });
  }


  protected _chooseAction(): Action | null {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;

    const ways = this._ways;
    const nodes = this._nodes;
    const nodeIDs = this._nodeIDs;
    const wayIDs = this._wayIDs;

    // straighten selected nodes
    if (ways.length === 0 && nodes.length > 2) {
      this._geometry = 'point';
      return actionStraightenNodes(nodeIDs);

    // straighten selected ways (possibly between range of 2 selected nodes)
    } else if (ways.length > 0 && (nodes.length === 0 || nodes.length === 2)) {
      let startNodeIDs: EntityID[] = [];
      let endNodeIDs: EntityID[] = [];

      // check the selected ways, gather their start/end nodes
      for (const entity of this._entities) {
        if (entity.type !== 'way') continue;

        const way = entity as OsmWay;
        if (way.isClosed()) return null;  // exit early, can't straighten these

        startNodeIDs.push(way.first()!);
        endNodeIDs.push(way.last()!);
      }

      // Remove duplicate start/endNodeIDs (duplicate nodes cannot be at the line end)
      startNodeIDs = startNodeIDs.filter(nodeID => startNodeIDs.indexOf(nodeID) === startNodeIDs.lastIndexOf(nodeID));
      endNodeIDs = endNodeIDs.filter(nodeID => endNodeIDs.indexOf(nodeID) === endNodeIDs.lastIndexOf(nodeID));

      // Ensure all ways are connected (i.e. only 2 unique endpoints/startpoints)
      if (utilArrayDifference(startNodeIDs, endNodeIDs).length +
        utilArrayDifference(endNodeIDs, startNodeIDs).length !== 2) return null;

      // Ensure path contains at least 3 unique nodes
      const wayNodeIDs = (utilGetAllNodes(wayIDs, graph) as OsmNode[]).map(node => node.id);
      if (wayNodeIDs.length <= 2) return null;

      // If range of 2 selected nodes is supplied, ensure nodes lie on the selected path
      if (nodeIDs.length === 2 &&
        (wayNodeIDs.indexOf(nodeIDs[0]) === -1 || wayNodeIDs.indexOf(nodeIDs[1]) === -1)
      ) return null;

      if (nodeIDs.length) {
        // If we're only straightenting between two points, we only need that extent visible
        this._extent = utilTotalExtent(nodeIDs, graph);
      }

      this._geometry = 'line';
      return actionStraightenWay(this.selectedIDs);
    }

    return null;
  }
}
