import { vecEqual, vecLength, vecRotate, vecSubtract } from '@rapid-sdk/math';

import { AbstractMode } from './AbstractMode.ts';
import { actionAddEntity } from '../actions/add_entity.ts';
import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { actionAddVertex } from '../actions/add_vertex.ts';
import { actionMoveNode } from '../actions/move_node.ts';
import { geoChooseEdge } from '../geo/geom.js';
import { OsmNode, OsmWay } from '../data/index.ts';

import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmTags } from '../data/types.ts';
import type { Vec2 } from '@rapid-sdk/math';

const DEBUG = false;


/** Options for entering `DrawLineMode` */
export interface DrawLineModeOptions {
  /** Node ID to continue from */
  continueNodeID?: EntityID;
  /** Way ID to continue from */
  continueWayID?: EntityID;
}


/** Snapshot state for undo/redo support */
interface DrawLineSnapshot {
  drawWayID: EntityID;
  insertIndex: number | undefined;
  firstNodeID: EntityID;
  lastNodeID: EntityID;
}


/**
 * In `DrawLineMode`, we are drawing a new line or continuing an existing line.
 */
export class DrawLineMode extends AbstractMode {
  /** Default tags for new ways */
  defaultTags: OsmTags;
  /** The draw way just contains the way that we are drawing */
  drawWayID: EntityID | null;
  /** The draw node is temporary and just follows the pointer */
  drawNodeID: EntityID | null;
  /** The first real node in the draw way */
  firstNodeID: EntityID | null;
  /** The last real node in the draw way (the draw node is after/before this one) */
  lastNodeID: EntityID | null;

  // So for a draw way like:
  //
  //  A -> B -> C -> D
  //
  // A is the firstNode
  // C is the lastNode
  // D is the drawNode, temporary and will be rolled back in `exit()`
  // A or C can be clicked on to finish the way

  /** _insertIndex determines where new nodes get added (see `OsmWay.addNode()`) `0` = beginning, `undefined` = end */
  private _insertIndex: number | undefined;
  /** The history index when we start drawing */
  private _editIndex: number | null;
  /** Watch coordinates to determine if we have moved enough */
  private _lastPoint: Vec2 | null;
  /**
   * To deal with undo/redo, we take snapshots on every commit, keyed to the stable graph.
   * If we ever find ourself in an edit where we can't retrieve this information, leave `DrawLineMode`.
   * This means we've undo/redoed into an edit where the user wasn't drawing lines.
   * It's kinda hack, but I dont know what else to do right now.
   */
  private _snapshots: Map<Graph, DrawLineSnapshot>;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'draw-line';

    this.defaultTags = {};
    this.drawWayID = null;
    this.drawNodeID = null;
    this.firstNodeID = null;
    this.lastNodeID = null;

    this._insertIndex = undefined;
    this._editIndex = null;
    this._lastPoint = null;
    this._snapshots = new Map();

    // Make sure the event handlers have `this` bound correctly
    this._cancel = this._cancel.bind(this);
    this._click = this._click.bind(this);
    this._finish = this._finish.bind(this);
    this._hover = this._hover.bind(this);
    this._move = this._move.bind(this);
    this._nudge = this._nudge.bind(this);
    this._restoreSnapshot = this._restoreSnapshot.bind(this);
  }


  /**
   * Enters the mode.
   * Draw a new line, or optionally continue an existing line.
   * @param  options - Optional options object
   * @return `true` if the mode can be entered, `false` if not
   */
  enter(options: DrawLineModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const graph = editor.staging.graph;
    const eventManager = gfx.eventManager!;

    const continueNodeID = options.continueNodeID;
    const continueWayID = options.continueWayID;
    const continueNode = continueNodeID && graph.hasEntity(continueNodeID);
    const continueWay = continueWayID && graph.hasEntity(continueWayID);

    // If either parameter is present, make sure they are both valid
    if (continueNode || continueWay) {
      if (!(continueNode instanceof OsmNode)) return false;
      if (!(continueWay instanceof OsmWay)) return false;

      if (DEBUG) {
        console.log(`DrawLineMode: entering, continuing line ${continueWay.id}`);  // eslint-disable-line no-console
      }

    } else {    // Start a new line
      if (DEBUG) {
        console.log('DrawLineMode: entering');  // eslint-disable-line no-console
      }
    }

    this._active = true;

    this.drawWayID = null;
    this.drawNodeID = null;
    this.lastNodeID = null;
    this.firstNodeID = null;
    this._insertIndex = undefined;
    this._lastPoint = null;
    this._selectedData.clear();

    eventManager.setCursor('crosshair');

    context.enableBehaviors(['hover', 'draw', 'mapInteraction', 'mapNudge']);

    context.behaviors.hover!
      .on('hoverchange', this._hover);

    context.behaviors.draw!
      .on('move', this._move)
      .on('click', this._click)
      .on('finish', this._finish)
      .on('cancel', this._cancel);

    context.behaviors.mapNudge!
      .on('nudge', this._nudge);

    editor
      .on('historyjump', this._restoreSnapshot);

    context.behaviors.mapInteraction!.doubleClickEnabled = false;

    editor.setCheckpoint('beginDraw');
    this._editIndex = editor.index;

    // If we are continuing, the drawWay is the way being continued..
    if (continueNode && continueWay) {
      const continueFromStart = (continueWay.affix(continueNode.id) === 'prefix');
      const oppositeNodeID = (continueFromStart ? continueWay.last() : continueWay.first())!;
      this._insertIndex = (continueFromStart ? 0 : undefined);
      this.drawWayID = continueWayID!;
      this.lastNodeID = continueNodeID!;
      this.firstNodeID = oppositeNodeID;
      this._addDrawNode();
      this._refreshEntities();
    }

    return true;
  }


  /**
   * Exits the mode, cleaning up the draw state and reverting any incomplete work.
   * If the draw way is invalid or degenerate, rolls back to the state before drawing started.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    if (DEBUG) {
      console.log('DrawLineMode: exiting');  // eslint-disable-line no-console
    }

    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const layer = gfx.scene!.layers.get('osm')!;
    const eventManager = gfx.eventManager!;

    eventManager.setCursor('grab');

    context.behaviors.hover!
      .off('hoverchange', this._hover);

    context.behaviors.draw!
      .off('move', this._move)
      .off('click', this._click)
      .off('finish', this._finish)
      .off('cancel', this._cancel);

    context.behaviors.mapNudge!
      .off('nudge', this._nudge);

    editor
      .off('historyjump', this._restoreSnapshot);

    editor.beginTransaction();
    editor.revert();    // revert work-in-progress, i.e. the temporary drawing node

    // Confirm that the draw way exists and is valid..
    // If any issues, revert back to how things were before we started.
    const graph = editor.stable.graph;
    const drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) : undefined;
    if (!drawWay || drawWay.isDegenerate()) {
      if (DEBUG) {
        console.log('DrawLineMode: draw way invalid, rolling back');  // eslint-disable-line no-console
      }
      if (editor.index > this._editIndex!) {
        while (editor.index !== this._editIndex) {
          editor.undo();
        }
      } else if (editor.index < this._editIndex!) {
        editor.restoreCheckpoint('beginDraw');
      }
    }

    this.drawWayID = null;
    this.drawNodeID = null;
    this.lastNodeID = null;
    this.firstNodeID = null;
    this._insertIndex = undefined;
    this._editIndex = null;
    this._lastPoint = null;

    this._selectedData.clear();

    layer.clearClass('drawing');

    globalThis.setTimeout(() => {
      context.behaviors.mapInteraction!.doubleClickEnabled = true;
    }, 1000);

    editor.endTransaction();
  }


  /**
   * Confirms that the drawing entities all exist in the graph after any modifications.
   * Updates `selectedData` collection to include the draw way
   * Updates `drawing` class for items that need it
   */
  private _refreshEntities(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const layer = gfx.scene!.layers.get('osm')!;

    layer.clearClass('drawing');
    this._selectedData.clear();

    const graph = editor.staging.graph;
    const drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) : undefined;
    const drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) : undefined;
    const lastNode = this.lastNodeID ? graph.hasEntity(this.lastNodeID) : undefined;
    const firstNode = this.firstNodeID ? graph.hasEntity(this.firstNodeID) : undefined;

    // Sanity check - Bail out if any of these are missing.
    if (!drawWay || !lastNode || !firstNode) {
      this._cancel();
      return;
    }

    // `drawNode` may or may not exist, it will be recreated after the user moves the pointer.
    if (drawNode) {
      layer.setClass('drawing', drawNode.id);

      // Nudging at the edge of the map is allowed after the drawNode exists.
      context.behaviors.mapNudge!.allow();
    }

    // todo - we do want to allow connecting a line to itself in some situations
    layer.setClass('drawing', drawWay.id);
    this._selectedData.set(drawWay.id, drawWay);
  }


  /**
   * An annotation is a text associated with the edit, such as "Started a line".
   * @return String such as "Started a line", or undefined if the drawWay is incomplete
   */
  private _getAnnotation(): string | undefined {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    const drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) as OsmWay | undefined : undefined;
    const length = drawWay?.nodes?.length ?? 0;
    if (length < 2) return undefined;

    const which = length > 2 ? 'continue' : 'start';
    return l10n.t(`operations.${which}.annotation.line`);
  }


  /**
   * Move the draw node, or create one if needed.
   * @param eventData - Object containing data about the event and what was targeted
   */
  private _move(eventData: EventData): void {
    if (!this.drawWayID) return;  // haven't started drawing yet

    const context = this.context;
    const editor = context.systems.editor!;
    const viewport = context.viewport;

    const point = eventData.coord.map;
    let loc = viewport.unproject(point);

    // How much has the pointer moved?
    const dist = this._lastPoint ? vecLength(point, this._lastPoint) : 0;
    this._lastPoint = point;

    let graph = editor.staging.graph;
    let drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) : undefined;

    editor.beginTransaction();

    // If the draw node has gone missing (probably due to undo/redo), replace it.
    // We check distance to account for the situation where the user is undoing/redoing.
    // Exit out of here if the user is just hitting keys and not actually moving the pointer.
    // (counterintuitively:  we will still receive 'move' events if the user is
    //  just hitting modifier keys without moving!  This is to handle snap/unsnap.)
    if (!drawNode) {
      if (dist > 1) {  // The user is moving the pointer so we really need a draw node!
        drawNode = this._addDrawNode();
        graph = editor.staging.graph;
      } else {         // Never mind, the user is undoing/redoing - not moving!
        editor.endTransaction();
        return;
      }
    }

    // Calculate snap, if any..
    // Allow snapping only for OSM Entities in the current graph (i.e. not Rapid features)
    const dataID = eventData?.target?.dataID;
    const target = dataID ? graph.hasEntity(dataID) : undefined;

    // Snap to a node
    if (target?.type === 'node') {
      const node = target as OsmNode;
      loc = node.loc!;

    // Snap to a way
    } else if (target?.type === 'way') {
      const way = target as OsmWay;
      const edgeChoice = geoChooseEdge(graph.childNodes(way), point, viewport, drawNode.id);
      const SNAP_DIST = 6;  // hack to avoid snap to fill, see Rapid#719
      if (edgeChoice && edgeChoice.distance < SNAP_DIST) {
        loc = edgeChoice.loc;
      }
    }

    editor.perform(actionMoveNode(drawNode.id, loc));

    this._refreshEntities();
    editor.endTransaction();
  }


  /**
   * This event fires on map pans at the edge of the screen.
   * We want to move the drawing node opposite of the pixels panned to keep it in the same place.
   * @param nudge - [x,y] amount of map pan in pixels
   */
  private _nudge(nudge: Vec2): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const locations = context.systems.locations;
    const viewport = context.viewport;

    const graph = editor.staging.graph;
    const t = context.viewport.transform;
    if (t.r) {
      nudge = vecRotate(nudge, -t.r, [0, 0]);   // remove any rotation
    }

    const drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) as OsmNode | undefined : undefined;
    if (!drawNode) return;

    const currPoint = viewport.project(drawNode.loc!);
    const destPoint = vecSubtract(currPoint, nudge);
    const loc = viewport.unproject(destPoint);

    if (locations?.isBlockedAt(loc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    editor.perform(actionMoveNode(drawNode.id, loc));
    this._refreshEntities();
  }


  /**
   * Process whatever the user clicked on.
   * @param eventData - Object containing data about the event and what was targeted
   */
  private _click(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const locations = context.systems.locations;
    const viewport = context.viewport;

    const point = eventData.coord.map;
    let loc = viewport.unproject(point);

    if (locations?.isBlockedAt(loc)) return;   // editing is blocked here

    const eventManager = gfx.eventManager!;
    eventManager.setCursor('crosshair');

    let graph = editor.staging.graph;
    const drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) as OsmNode | undefined : undefined;

    // Start transaction now - if we are making a draw node, we want it included.
    editor.beginTransaction();

    // If draw node has gone missing (probably due to undo/redo), replace it.
    // Note that we don't need the distance checking code here that we have in `_move()`.
    // If we receive a 'click', we really do need a draw node now!
    if (this.drawWayID && !drawNode) {
      this._addDrawNode();
      graph = editor.staging.graph;
    }

    // Calculate snap, if any..
    // Allow snapping only for OSM Entities in the current graph (i.e. not Rapid features)
    const dataID = eventData?.target?.dataID;
    const target = dataID ? graph.hasEntity(dataID) : undefined;

    let node: OsmNode | undefined;
    let edge: [EntityID, EntityID] | undefined;

    // Snap to a node
    if (target?.type === 'node') {
      node = target as OsmNode;
      loc = node.loc!;

    // Snap to a way
    } else if (target?.type === 'way') {
      const way = target as OsmWay;
      const edgeChoice = geoChooseEdge(graph.childNodes(way), point, viewport, this.drawNodeID ?? undefined);
      const SNAP_DIST = 6;  // hack to avoid snap to fill, see Rapid#719
      if (edgeChoice && edgeChoice.distance < SNAP_DIST) {
        loc = edgeChoice.loc;
        edge = [ way.nodes[edgeChoice.index - 1], way.nodes[edgeChoice.index] ];
      }
    }

    // Handle whatever was clicked on.
    // The `_click?` functions below are responsible for calling `_refreshEntities()` and `endTransaction()`
    // because in certain situations we will be finishing the line and jumping right into `exit()`
    if (node) {
      this._clickNode(loc, node);
    } else if (edge) {
      this._clickWay(loc, edge);
    } else {
      this._clickLoc(loc);
    }
    // in other words... do not put code here - we might have already exited the mode!
  }


  /**
   * Clicked on nothing, create a node at given `loc`.
   */
  private _clickLoc(loc: Vec2): void {
    const EPSILON = 1e-6;
    const context = this.context;
    const editor = context.systems.editor!;

    const graph = editor.staging.graph;
    let drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) as OsmWay | undefined : undefined;
    let drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) as OsmNode | undefined : undefined;
    const lastNode = this.lastNodeID ? graph.hasEntity(this.lastNodeID) as OsmNode | undefined : undefined;
    let firstNode = this.firstNodeID ? graph.hasEntity(this.firstNodeID) as OsmNode | undefined : undefined;

    // Extend line by adding vertex at `loc`...
    if (drawWay) {
      // The draw node is at the first or last node, try to finish the line.
      // (Normally this situation would be caught in `_clickNode`, maybe the user held down modifier key?)
      if (vecEqual(loc, lastNode!.loc!, EPSILON) || vecEqual(loc, firstNode!.loc!, EPSILON)) {
        this._finish();
        return;
      }

      if (DEBUG) {
        console.log(`DrawLineMode: _clickLoc, extending line to ${loc}`);  // eslint-disable-line no-console
      }

      // If the line has enough segments, commit the work in progress so we can undo/redo to it.
      const annotation = this._getAnnotation();
      if (annotation) {
        editor.commit({ annotation: annotation, selectedIDs: [drawWay.id] });
        this._takeSnapshot(firstNode!.id, drawNode!.id);
      }

      // Replace draw node
      this.lastNodeID = drawNode!.id;
      this._addDrawNode(loc);


    // Start a new line at `loc`...
    } else {
      if (DEBUG) {
        console.log(`DrawLineMode: _clickLoc, starting line at ${loc}`);  // eslint-disable-line no-console
      }
      firstNode = new OsmNode(context, { loc: loc });
      drawNode = new OsmNode(context, { loc: loc });
      drawWay = new OsmWay(context, { tags: this.defaultTags, nodes: [ firstNode.id, drawNode.id ] });

      this.firstNodeID = firstNode.id;
      this.lastNodeID = firstNode.id;
      this.drawNodeID = drawNode.id;
      this.drawWayID = drawWay.id;

      editor.perform(
        actionAddEntity(firstNode),  // Create first node
        actionAddEntity(drawNode),   // Create new draw node (end)
        actionAddEntity(drawWay)     // Create new draw way
      );
    }

    this._refreshEntities();
    editor.endTransaction();
  }


  /**
   * Clicked on an target way, add a midpoint along the `edge` at given `loc`.
   */
  private _clickWay(loc: Vec2, edge: [EntityID, EntityID]): void {
    const EPSILON = 1e-6;
    const context = this.context;
    const editor = context.systems.editor!;
    const midpoint: Midpoint = { loc, edge };

    const graph = editor.staging.graph;
    let drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) as OsmWay | undefined : undefined;
    let drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) as OsmNode | undefined : undefined;
    const lastNode = this.lastNodeID ? graph.hasEntity(this.lastNodeID) as OsmNode | undefined : undefined;
    let firstNode = this.firstNodeID ? graph.hasEntity(this.firstNodeID) as OsmNode | undefined : undefined;

    // Extend line by adding vertex as midpoint along target edge...
    if (drawWay) {
      // The drawNode is at the first or last node, try to finish the line.
      // (Normally this situation would be caught in `_clickNode`, maybe the user held down modifier key?)
      if (vecEqual(loc, lastNode!.loc!, EPSILON) || vecEqual(loc, firstNode!.loc!, EPSILON)) {
        this._finish();
        return;
      }

      if (DEBUG) {
        console.log(`DrawLineMode: _clickWay, extending line to edge ${edge}`);  // eslint-disable-line no-console
      }

      editor.perform(
        actionMoveNode(drawNode!.id, loc),       // Finalize position of draw node at `loc`
        actionAddMidpoint(midpoint, drawNode!)   // Add draw node as a midpoint on target edge
      );

      // If the line has enough segments, commit the work in progress so we can undo/redo to it.
      const annotation = this._getAnnotation();
      if (annotation) {
        editor.commit({ annotation: annotation, selectedIDs: [drawWay.id] });
        this._takeSnapshot(firstNode!.id, drawNode!.id);
      }

      // Replace draw node
      this.lastNodeID = drawNode!.id;
      this._addDrawNode(loc);


    // Start a new line at `loc` on target edge...
    } else {
      if (DEBUG) {
        console.log(`DrawLineMode: _clickWay, starting line at edge ${edge}`);  // eslint-disable-line no-console
      }

      firstNode = new OsmNode(context, { loc: loc });
      drawNode = new OsmNode(context, { loc: loc });
      drawWay = new OsmWay(context, { tags: this.defaultTags, nodes: [ firstNode.id, drawNode.id ] });

      this.firstNodeID = firstNode.id;
      this.lastNodeID = firstNode.id;
      this.drawNodeID = drawNode.id;
      this.drawWayID = drawWay.id;

      editor.perform(
        actionAddEntity(firstNode),              // Create first node
        actionAddEntity(drawNode),               // Create new draw node (end)
        actionAddEntity(drawWay),                // Create new draw way
        actionAddMidpoint(midpoint, firstNode)   // Add first node as midpoint on target edge
      );
    }

    this._refreshEntities();
    editor.endTransaction();
  }


  /**
   * Clicked on a target node, include that node in the line we are drawing.
   */
  private _clickNode(loc: Vec2, targetNode: OsmNode): void {
    const EPSILON = 1e-6;
    const context = this.context;
    const editor = context.systems.editor!;

    const graph = editor.staging.graph;
    let drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) as OsmWay | undefined : undefined;
    let drawNode = this.drawNodeID ? graph.hasEntity(this.drawNodeID) as OsmNode | undefined : undefined;
    const lastNode = this.lastNodeID ? graph.hasEntity(this.lastNodeID) as OsmNode | undefined : undefined;
    const firstNode = this.firstNodeID ? graph.hasEntity(this.firstNodeID) as OsmNode | undefined : undefined;

    // Extend line by reusing target node as a vertex...
    // (Note that we don't need to replace the draw node in this scenario)
    if (drawWay) {

      // Target node is the last node - finish the line here.
      if (targetNode.id === lastNode!.id || vecEqual(loc, lastNode!.loc!, EPSILON)) {
        this._finish();
        return;
      }

      if (DEBUG) {
        console.log(`DrawLineMode: _clickNode, extending line to ${targetNode.id}`);  // eslint-disable-line no-console
      }

      editor.perform(
        this._actionRemoveDrawNode(drawWay, drawNode!),                // Remove the draw node from the draw way
        actionAddVertex(drawWay.id, targetNode.id, this._insertIndex)  // Add target node to draw way
      );

      // If the line has enough segments, commit the work in progress so we can undo/redo to it.
      const annotation = this._getAnnotation();
      if (annotation) {
        editor.commit({ annotation: annotation, selectedIDs: [drawWay.id] });
        this._takeSnapshot(firstNode!.id, targetNode.id);
      }

      // Target node is the first node - we just closed the line and can finish it.
      if (targetNode.id === firstNode!.id || vecEqual(loc, firstNode!.loc!, EPSILON)) {
        this._finish();
        return;

      // Target node is some other node - put the draw node back and continue drawing..
      } else {
        this.lastNodeID = targetNode.id;
        editor.perform(
          actionAddEntity(drawNode!),
          actionAddVertex(drawWay.id, drawNode!.id, this._insertIndex)
        );
      }

    // Start a new line at target node...
    } else {
      if (DEBUG) {
        console.log(`DrawLineMode: _clickNode, starting line at ${targetNode.id}`);  // eslint-disable-line no-console
      }

      drawNode = new OsmNode(context, { loc: loc });
      drawWay = new OsmWay(context, { tags: this.defaultTags, nodes: [ targetNode.id, drawNode.id ] });

      this.firstNodeID = targetNode.id;
      this.lastNodeID = targetNode.id;
      this.drawNodeID = drawNode.id;
      this.drawWayID = drawWay.id;

      editor.perform(
        actionAddEntity(drawNode),   // Create new draw node (end)
        actionAddEntity(drawWay)     // Create new draw way
      );
    }

    this._refreshEntities();
    editor.endTransaction();
  }


  /**
   * Creates an action that removes the draw node from the draw way.
   * This is used when we want to reuse an existing node as a vertex.
   * @param  drawWay - The way being drawn
   * @param  drawNode - The temporary draw node to remove
   * @return An action function that modifies the graph
   */
  private _actionRemoveDrawNode(drawWay: OsmWay, drawNode: OsmNode): Action {
    return (graph: Graph): Graph => {
      const way = graph.entity(drawWay.id) as OsmWay;
      return graph.replace(way.removeNode(drawNode.id)).remove(drawNode);
    };
  }


  /**
   * Creates a new draw node and adds it to the draw way.
   * The draw node follows the pointer as the user moves it.
   * @param  loc - Optional location for the node; defaults to current mouse location
   * @return The newly created draw node
   */
  private _addDrawNode(loc?: Vec2): OsmNode {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;

    const drawNode = new OsmNode(context, { loc: loc ?? map.mouseLoc() });
    this.drawNodeID = drawNode.id;

    editor.perform(
      actionAddEntity(drawNode),                                        // Create new draw node
      actionAddVertex(this.drawWayID!, drawNode.id, this._insertIndex)  // Add new draw node to draw way
    );

    return drawNode;
  }


  /**
   * Done drawing, select the draw way or return to browse mode.
   * Note that `exit()` will be called immediately after this to perform cleanup.
   */
  private _finish(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const drawWay = this.drawWayID ? graph.hasEntity(this.drawWayID) : undefined;

    if (drawWay) {
      if (DEBUG) {
        console.log(`DrawLineMode: _finish, drawWay.id = ${drawWay.id}`);  // eslint-disable-line no-console
      }
      const isNewFeature = (Object.keys(drawWay.tags).length === 0);  // no tags
      context.enter('select-osm', { selection: { osm: [drawWay.id] }, newFeature: isNewFeature });
    } else {
      context.enter('browse');
    }
  }


  /**
   * Cancel all drawing and return to browse mode.
   * Note that `exit()` will be called immediately after this to perform cleanup.
   */
  private _cancel(): void {
    if (DEBUG) {
      console.log(`DrawLineMode: _cancel`);  // eslint-disable-line no-console
    }
    // Nulling the draw way will cause `exit()` to revert back
    // to the way things were before we started drawing.
    this.drawWayID = null;
    this.context.enter('browse');
  }


  /**
   * To deal with undo/redo, we take snapshots of the drawing entityIDs after every commit, keyed to the stable graph.
   * If we ever find ourself in an edit where we can't retrieve this information, leave `DrawLineMode`.
   * This means we've undo/redoed into an edit where the user wasn't drawing the same line.
   */
  private _takeSnapshot(firstNodeID: EntityID, lastNodeID: EntityID): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.stable.graph;

    const snapshot: DrawLineSnapshot = {
      drawWayID:   this.drawWayID!,
      insertIndex: this._insertIndex,
      firstNodeID: firstNodeID,
      lastNodeID:  lastNodeID
    };

    this._snapshots.set(graph, snapshot);
  }


  /**
   * This gets called after undo/redo/restore.
   * Here we attempt to restore the drawing entityIDs from a snapshot.
   * If we ever find ourself in an edit where we can't retrieve this information, leave `DrawLineMode`.
   * This means we've undo/redoed into an edit where the user wasn't drawing the same line.
   */
  private _restoreSnapshot(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.stable.graph;
    const snapshot = this._snapshots.get(graph);

    // If we have undo/redoed into a state where we are drawing this same line,
    // restore the state and stay in `DrawLineMode`.
    if (snapshot && snapshot.drawWayID === this.drawWayID) {
      this._insertIndex = snapshot.insertIndex;
      this.firstNodeID = snapshot.firstNodeID;
      this.lastNodeID = snapshot.lastNodeID;
      this.drawNodeID = null;   // will be recreated after the user moves the pointer
      this._refreshEntities();

    } else {   // Otherwise, return to select or browse mode (MapSystem has similar code to this)
      const checkIDs = editor.stable.selectedIDs ?? [];
      const selectedIDs = checkIDs.filter(entityID => graph.hasEntity(entityID));
      if (selectedIDs.length) {
        context.enter('select-osm', { selection: { osm: selectedIDs }} );
      } else {
        context.enter('browse');
      }
    }
  }

  /**
   * Changes the cursor styling based on what geometry is hovered
   */
  private _hover(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;

    const graph = editor.staging.graph;
    const eventManager = gfx.eventManager!;

    const dataID = eventData.target?.dataID;
    const entity = dataID ? graph.hasEntity(dataID) : undefined;
    const geom = entity?.geometry(graph) ?? 'unknown';

    switch (geom) {
      case 'line':
        eventManager.setCursor('connectLineCursor');
        break;
      case 'vertex':
        eventManager.setCursor('connectVertexCursor');
        break;
      default:
        eventManager.setCursor('crosshair');
    }
  }
}
