import { AbstractMode } from './AbstractMode.ts';
import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { actionConnect } from '../actions/connect.ts';
import { actionMoveNode } from '../actions/move_node.ts';
import { OsmNode } from '../data/OsmNode.ts';
import { projWorldToWgs84, vecAdd, vecProject, vecRotate, vecSubtract, WORLD_ZOOM } from '@rapid-sdk/math';
import { utilArrayIntersection } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmWay } from '../data/types.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Options for entering `DragNodeMode` */
export interface DragNodeModeOptions {
  /** If set, reselect these IDs when finished dragging */
  reselectIDs?: EntityID[];
  /** If set, drag the node for the given id */
  nodeID?: EntityID;
  /** If set, create a node from the given midpoint */
  midpoint?: Midpoint;
}


/**
 *  In `DragNodeMode` mode, the user has started dragging a point or vertex.
 */
export class DragNodeMode extends AbstractMode {
  /** The node being dragged */
  dragNode: OsmNode | null;

  /** When finished dragging, restore the selected ids from before */
  private _reselectIDs: EntityID[];
  /** Used to set the correct edit annotation */
  private _wasMidpoint: boolean;
  /** Difference between where the pin is, and where on the pin the user clicked */
  private _dragOffset: Vec2;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'drag-node';

    this.dragNode = null;

    this._reselectIDs = [];
    this._wasMidpoint = false;
    this._dragOffset = [0, 0];

    // Make sure the event handlers have `this` bound correctly
    this._move = this._move.bind(this);
    this._end = this._end.bind(this);
    this._cancel = this._cancel.bind(this);
    this._nudge = this._nudge.bind(this);
  }


  /**
   * Enters the mode.
   * @param  options - Optional options object
   * @return `true` if the mode can be entered, `false` if not
   */
  enter(options: DragNodeModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene;
    const ui = context.systems.ui!;

    this._reselectIDs = options.reselectIDs ?? [];
    const midpoint = options.midpoint;
    const nodeID = options.nodeID;

    let graph = editor.staging.graph;
    let node: OsmNode | undefined;

    if (midpoint) {
      if (!graph.hasEntity(midpoint.edge[0])) return false;
      if (!graph.hasEntity(midpoint.edge[1])) return false;
      node = new OsmNode(context);
      editor.perform(actionAddMidpoint(midpoint, node));
      graph = editor.staging.graph;                // refresh with post-action graph
      node = graph.hasEntity(node.id) as OsmNode;  // refresh with post-action entity
      if (!node) {  // somehow the midpoint did not convert to a node
        editor.revert();
        return false;
      }
      this._wasMidpoint = true;

    } else if (nodeID) {
      node = graph.hasEntity(nodeID) as OsmNode | undefined;
      this._wasMidpoint = false;
    }

    if (!node) return false;

    if (!this._wasMidpoint) {
      // Bail out if the node is connected to something hidden.
      const hasHidden = filters.hasHiddenConnections(node, graph);
      if (hasHidden) {
        ui.Flash
          .duration(4000)
          .iconName('#rapid-icon-no')
          .label(l10n.t('modes.drag_node.connected_to_hidden'))();
        return false;
      }
    }

    this._active = true;
    this.dragNode = node;
    this._selectedData.set(node.id, node);

    // Calculate dragOffset, to correct for where "on the pin" the user grabbed the target.
    const startCoord = node.geoms.parts[0]!.world!.coords as Vec2;  // A node should have a single world coord
    const clickCoord = context.behaviors.drag!.lastDown!.coord.world;
    this._dragOffset = vecSubtract(startCoord, clickCoord);

    const layer = scene!.layers.get('osm')!;
    layer.setClass('drawing', this.dragNode.id);
    for (const parent of graph.parentWays(this.dragNode)) {
      layer.setClass('drawing', parent.id);
    }

    context.enableBehaviors(['hover', 'drag', 'mapNudge']);
    context.behaviors.mapNudge!.allow();

    context.behaviors.drag!
      .on('move', this._move)
      .on('end', this._end)
      .on('cancel', this._cancel);

    context.behaviors.mapNudge!
      .on('nudge', this._nudge);

    return true;
  }


  /**
   * Exits the mode, clearing drawing classes and removing event listeners.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    this.dragNode = null;
    this._reselectIDs = [];
    this._wasMidpoint = false;
    this._dragOffset = [0, 0];

    this._selectedData.clear();

    const context = this.context;
    const scene = context.systems.gfx!.scene!;
    const layer = scene.layers.get('osm')!;
    layer.clearClass('drawing');

    context.behaviors.drag!
      .off('move', this._move)
      .off('end', this._end)
      .off('cancel', this._cancel);

    context.behaviors.mapNudge!
      .off('nudge', this._nudge);
  }


  /**
   *  Gets the latest version the drag node from the graph after any modifications.
   *  Updates `selectedData` collection to include the dragging node
   */
  private _refreshEntities(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;

    this._selectedData.clear();
    this.dragNode = this.dragNode && (graph.hasEntity(this.dragNode.id) as OsmNode | undefined) || null;

    // Bail out if drag node has gone missing
    if (!this.dragNode) {
      this._cancel();
      return;
    }

    this._selectedData.set(this.dragNode.id, this.dragNode);
  }


  /**
   * Move the dragging node
   * @param  eventData - Data received from the drag behavior
   */
  private _move(eventData: EventData): void {
    if (!this.dragNode) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const locations = context.systems.locations;
    const viewport = context.viewport;
    const point = eventData.coord.world;

    // Allow snapping only for OSM Entities in the actual graph (i.e. not Rapid features)
    const dataID = eventData?.target?.dataID;
    const target = dataID ? graph.hasEntity(dataID) : undefined;
    let loc: Vec2 | undefined;

    // Snap to a node
    if (target?.type === 'node' && this._canSnapToNode(target)) {
      const node = target as OsmNode;
      loc = node.loc!;

    // Snap to a way
    } else if (target?.type === 'way') {
      const way = target as OsmWay;
      // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
      const line = way.geoms.parts[0]!.world!.outer as Vec2[];

      // If the dragNode belongs to the way, exclude snapping to adjacent segments.
      const skipSegments = new Set<number>();
      for (let i = 0; i < way.nodes.length; i++) {
        if (way.nodes[i] === this.dragNode.id) {
          skipSegments.add(i);
          skipSegments.add(i + i);
        }
      }

      const choice = vecProject(point, line);
      const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
      const SNAP_DIST = 6;  // hack to avoid snap to fill, see Rapid#719

      if (choice && !skipSegments.has(choice.index) && choice.distance < SNAP_DIST * localScale) {
        loc = projWorldToWgs84(choice.point);
      }
    }

    // No snap - use the coordinate we get from the event
    if (!loc) {
      // The "drag offset" is the difference between where the user grabbed
      // the marker/pin and where the location of the node actually is.
      loc = projWorldToWgs84(vecAdd(point, this._dragOffset));
    }

    if (locations?.isBlockedAt(loc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    editor.perform(actionMoveNode(this.dragNode.id, loc));
    this._refreshEntities();
  }


  /**
   * This event fires on map pans at the edge of the screen.
   * We want to move the dragging node opposite of the pixels panned to keep it in the same place.
   * @param  nudge - [x,y] amount of map pan in pixels
   */
  private _nudge(nudge: Vec2): void {
    if (!this.dragNode) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const locations = context.systems.locations;
    const viewport = context.viewport;
    const t = context.viewport.transform;
    if (t.r) {
      nudge = vecRotate(nudge, -t.r, [0, 0]);   // remove any rotation
    }

    const currPoint = viewport.project(this.dragNode.loc!);
    const destPoint = vecSubtract(currPoint, nudge);
    const loc = viewport.unproject(destPoint);

    if (locations?.isBlockedAt(loc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    editor.perform(actionMoveNode(this.dragNode.id, loc));
    this._refreshEntities();
  }


  /**
   * Complete the drag.
   * This calls `commit` to finalize the staging edit.
   * @param  eventData - Data received from the drag behavior
   */
  private _end(eventData: EventData): void {
    if (!this.dragNode) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;
    const point = eventData.coord!.world;
    const graph = editor.staging.graph;

    // Allow snapping only for OSM Entities in the actual graph (i.e. not Rapid features)
    const dataID = eventData?.target?.dataID;
    const target = dataID ? graph.hasEntity(dataID) : undefined;
    let annotation: string | undefined;

    // Snap to a Node
    if (target?.type === 'node' && this._canSnapToNode(target)) {
      editor.perform(actionConnect([ target.id, this.dragNode.id ]));
      annotation = this._connectAnnotation(target);

    // Snap to a Way
    } else if (target?.type === 'way') {
      const way = target as OsmWay;
      // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
      const line = way.geoms.parts[0]!.world!.outer as Vec2[];

      // If the dragNode belongs to the way, exclude snapping to adjacent segments.
      const skipSegments = new Set<number>();
      for (let i = 0; i < way.nodes.length; i++) {
        if (way.nodes[i] === this.dragNode.id) {
          skipSegments.add(i);
          skipSegments.add(i + i);
        }
      }

      const choice = vecProject(point, line);
      const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
      const SNAP_DIST = 6;  // hack to avoid snap to fill, see Rapid#719

      if (choice && !skipSegments.has(choice.index) && choice.distance < SNAP_DIST * localScale) {
        const edge: [EntityID, EntityID] = [ way.nodes[choice.index - 1], way.nodes[choice.index] ];
        const loc = projWorldToWgs84(choice.point);
        editor.perform(actionAddMidpoint({ loc, edge }, this.dragNode));
        annotation = this._connectAnnotation(way);
      } else {
        annotation = this._moveAnnotation();
      }

    } else if (this._wasMidpoint) {
      annotation = l10n.t('operations.add.annotation.vertex');

    } else {
      annotation = this._moveAnnotation();
    }

    editor.commit({ annotation: annotation!, selectedIDs: [this.dragNode.id] });

    // Choose next mode
    // (Note that if the drag node is gone, select mode will fallback to browse mode)
    if (this._reselectIDs.length) {
      context.enter('select-osm', { selection: { osm: this._reselectIDs }} );
    } else {
      context.enter('select-osm', { selection: { osm: [this.dragNode.id] }} );
    }
  }


  /**
   * Generate the annotation text for a move operation.
   * @return The localized annotation string, or undefined if dragNode is missing
   */
  private _moveAnnotation(): string | undefined {
    if (!this.dragNode) return undefined;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const l10n = context.systems.l10n!;

    const geometry = this.dragNode.geometry(graph);
    return l10n.t(`operations.move.annotation.${geometry}`);
  }


  /**
   * Generate the annotation text for a connect operation.
   * The annotation varies based on the geometries involved (vertex, point, line, etc.)
   * @param  target - The entity we are connecting the dragNode to
   * @return The localized annotation string, or undefined if dragNode/target is missing
   */
  private _connectAnnotation(target: OsmEntity): string | undefined {
    if (!this.dragNode || !target) return undefined;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const l10n = context.systems.l10n!;

    const nodeGeometry = this.dragNode.geometry(graph);
    const targetGeometry = target.geometry(graph);

    if (nodeGeometry === 'vertex' && targetGeometry === 'vertex') {
      const nodeParentWayIDs = graph.parentWays(this.dragNode);
      const targetParentWayIDs = graph.parentWays(target);
      const sharedParentWays = utilArrayIntersection(nodeParentWayIDs, targetParentWayIDs);
      // if both vertices are part of the same way
      if (sharedParentWays.length !== 0) {
        // if the nodes are next to each other, they are merged
        if (sharedParentWays[0].isAdjacent(this.dragNode.id, target.id)) {
          return l10n.t('operations.connect.annotation.from_vertex.to_adjacent_vertex');
        }
        return l10n.t('operations.connect.annotation.from_vertex.to_sibling_vertex');
      }
    }
    return l10n.t(`operations.connect.annotation.from_${nodeGeometry}.to_${targetGeometry}`);
  }


  /**
   * Determine if the drag node can snap to the target node.
   * A vertex can snap to another vertex, or to a node that allows vertices.
   * @param  target - The entity we are considering snapping the node to
   * @return `true` if snapping is allowed, `false` otherwise
   */
  private _canSnapToNode(target: OsmEntity): boolean {
    if (!this.dragNode) return false;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const schema = context.systems.schema;

    return this.dragNode.geometry(graph) !== 'vertex' ||
      (target.geometry(graph) === 'vertex' || !!schema?.allowsVertex(target, graph));
  }


  /**
   * Return to browse mode without doing anything
   * Note that `exit()` will be called immediately after this to perform cleanup.
   */
  private _cancel(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    editor.revert();
    this.context.enter('browse');
  }

}
