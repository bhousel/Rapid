import { utilArrayUniq, utilGetAllNodes } from '@rapid-sdk/util';

import { actionDisconnect } from '../actions/disconnect.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilTotalExtent } from '../util/util.ts';

import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { DisconnectAction } from '../actions/disconnect.ts';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * `DisconnectOperation` disconnects the selected node(s) from the ways they connect,
 * or disconnects the selected ways from each other.
 */
export class DisconnectOperation extends AbstractOperation {

  /** Whether every selected entity is new (unsaved) */
  protected _isNew: boolean;
  /** The selected vertex IDs */
  protected _vertexIDs: EntityID[];
  /** The selected way IDs */
  protected _wayIDs: EntityID[];
  /** Any other selected IDs (makes the operation unavailable) */
  protected _otherIDs: EntityID[];
  /** The disconnect actions to perform */
  protected _actions: DisconnectAction[];
  /** The locations of the involved way nodes (only set when disconnecting ways) */
  protected _coords?: Vec2[];
  /** Localization key describing what is being disconnected */
  protected _descriptionID: string;
  /** Localization key for the undo annotation */
  protected _annotationID: string;
  /** The vertices being disconnected */
  protected _disconnectingVertexIDs: EntityID[];
  /** The ways being disconnected */
  protected _disconnectingWayIDs: EntityID[];
  /** The extent of the vertices being disconnected */
  protected _extent: Extent;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to disconnect
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    const entities = selectedIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean) as OsmEntity[];

    this._isNew = entities.every(entity => entity.isNew());
    this._vertexIDs = [];
    this._wayIDs = [];
    this._otherIDs = [];
    this._actions = [];
    this._descriptionID = '';
    this._annotationID = 'features';
    this._disconnectingVertexIDs = [];
    this._disconnectingWayIDs = [];

    for (const entity of entities) {
      if (entity.type === 'way') {
        this._wayIDs.push(entity.id);
      } else if (entity.geometry(graph) === 'vertex') {
        this._vertexIDs.push(entity.id);
      } else {
        this._otherIDs.push(entity.id);
      }
    }

    if (this._vertexIDs.length > 0) {
      // At the selected vertices, disconnect the selected ways, if any, else
      // disconnect all connected ways
      this._disconnectingVertexIDs = this._vertexIDs;

      this._vertexIDs.forEach(vertexID => {
        const action = actionDisconnect(vertexID);

        if (this._wayIDs.length > 0) {
          const waysIDsForVertex = this._wayIDs.filter(wayID => {
            const way = graph.entity(wayID) as OsmWay;
            return way.nodes.indexOf(vertexID) !== -1;
          });
          action.limitWays(waysIDsForVertex);
        }
        this._actions.push(action);
        this._disconnectingWayIDs = this._disconnectingWayIDs
          .concat(graph.parentWays(graph.entity(vertexID)).map(d => d.id));
      });

      this._disconnectingWayIDs = utilArrayUniq(this._disconnectingWayIDs).filter(id => {
        return this._wayIDs.indexOf(id) === -1;
      });

      this._descriptionID += this._actions.length === 1 ? 'single_point.' : 'multiple_points.';
      if (this._wayIDs.length === 1) {
        const entity = graph.entity(this._wayIDs[0]);
        this._descriptionID += 'single_way.' + entity.geometry(graph);
      } else {
        this._descriptionID += this._wayIDs.length === 0 ? 'no_ways' : 'multiple_ways';
      }

    } else if (this._wayIDs.length > 0) {
      // Disconnect the selected ways from each other, if they're connected,
      // else disconnect them from all connected ways

      const ways = this._wayIDs.map(wayID => graph.entity(wayID) as OsmWay);
      const nodes = utilGetAllNodes(this._wayIDs, graph) as OsmNode[];
      this._coords = nodes.map(node => node.loc!);

      // actions for connected nodes shared by at least two selected ways
      const sharedActions: DisconnectAction[] = [];
      const sharedNodes: OsmNode[] = [];
      // actions for connected nodes
      const unsharedActions: DisconnectAction[] = [];
      const unsharedNodes: OsmNode[] = [];

      nodes.forEach(node => {
        const action = actionDisconnect(node.id).limitWays(this._wayIDs);
        if (action.disabled?.(graph) !== 'not_connected') {
          let count = 0;
          for (const way of ways) {
            if (way.nodes.indexOf(node.id) !== -1) {
              count += 1;
            }
            if (count > 1) break;
          }

          if (count > 1) {
            sharedActions.push(action);
            sharedNodes.push(node);
          } else {
            unsharedActions.push(action);
            unsharedNodes.push(node);
          }
        }
      });

      this._descriptionID += 'no_points.';
      this._descriptionID += this._wayIDs.length === 1 ? 'single_way.' : 'multiple_ways.';

      if (sharedActions.length) {
        // if any nodes are shared, only disconnect the selected ways from each other
        this._actions = sharedActions;
        this._disconnectingVertexIDs = sharedNodes.map(node => node.id);
        this._descriptionID += 'conjoined';
        this._annotationID = 'from_each_other';
      } else {
        // if no nodes are shared, disconnect the selected ways from all connected ways
        this._actions = unsharedActions;
        this._disconnectingVertexIDs = unsharedNodes.map(node => node.id);
        if (this._wayIDs.length === 1) {
          const entity = graph.entity(this._wayIDs[0]);
          this._descriptionID += entity.geometry(graph);
        } else {
          this._descriptionID += 'separate';
        }
      }
    }

    this._extent = utilTotalExtent(this._disconnectingVertexIDs, graph);

    this.id = 'disconnect';
    this.keys = [ l10n.t('shortcuts.command.disconnect.key') ];
    this.title = l10n.t('operations.disconnect.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    const actions = this._actions;
    const combinedAction = (graph: Graph): Graph => {
      for (const action of actions) {
        if (!action.disabled?.(graph)) {
          graph = action(graph);
        }
      }
      return graph;
    };

    editor.perform(combinedAction);
    editor.commit({ annotation: this.annotation(), selectedIDs: this.selectedIDs });
  }


  public relatedEntityIds(): EntityID[] {
    if (this._vertexIDs.length) {
      return this._disconnectingWayIDs;
    }
    return this._disconnectingVertexIDs;
  }


  public available(): boolean {
    const editor = this.context.systems.editor!;

    if (this._actions.length === 0) return false;
    if (this._otherIDs.length !== 0) return false;

    const graph = editor.staging.graph;
    if (this._vertexIDs.length !== 0 && this._wayIDs.length !== 0 && !this._wayIDs.every(wayID => {
      return this._vertexIDs.some(vertexID => {
        const way = graph.entity(wayID) as OsmWay;
        return way.nodes.indexOf(vertexID) !== -1;
      });
    })) return false;

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

    for (const action of this._actions) {
      const disabledReason = action.disabled?.(graph);
      if (disabledReason) return disabledReason;
    }

    if (!isNew && tooLarge()) {
      return 'too_large.' + ((this._vertexIDs.length ? this._vertexIDs : this._wayIDs).length === 1 ? 'single' : 'multiple');
    } else if (!isNew && coords && notDownloaded()) {
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
      if (osm && coords) {
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
      l10n.t(`operations.disconnect.${disabledReason}`) :
      l10n.t(`operations.disconnect.description.${this._descriptionID}`);
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t(`operations.disconnect.annotation.${this._annotationID}`);
  }
}
