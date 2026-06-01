import { AbstractBehavior } from './AbstractBehavior.ts';
import { Extent, geomPointInPolygon, vecLength } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { EventData } from './AbstractBehavior.ts';
import type { FederatedPointerEvent } from 'pixi.js';
import type { OsmNode } from '../data/types.ts';
import type { PixiLayerMapUI } from '../pixi/PixiLayerMapUI.ts';
import type { Vec2 } from '@rapid-sdk/math';

const MOVE_TOLERANCE = 2;


/**
 * `LassoBehavior` listens to pointer events and tries to
 *  create a lasso for selecting OSM features.
 *
 * If it's able to do this, it sends the lasso polygon data to the map ui layer
 * and on completeion enters select mode with the OSM features selected.
 */
export class LassoBehavior extends AbstractBehavior {

  /** EventData for the most recent pointerdown event */
  public lastDown: EventData | null;
  /** EventData for the most recent pointermove event */
  public lastMove: EventData | null;

  /** The bounding extent of the lasso polygon in world coordinates */
  protected _extent: Extent | null;
  /** Array of world coords recorded while lassoing */
  protected _coords: Vec2[];


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'lasso';

    this.lastDown = null;
    this.lastMove = null;
    this._extent = null;
    this._coords = [];   // Array of world coordindates that we record while lassoing.

    this._pointercancel = this._pointercancel.bind(this);
    this._pointerdown = this._pointerdown.bind(this);
    this._pointermove = this._pointermove.bind(this);
    this._pointerup = this._pointerup.bind(this);
  }


  /**
   * Bind event handlers
   */
  public enable(): void {
    if (this._enabled) return;
    this._enabled = true;

    this.lastDown = null;
    this.lastMove = null;
    this._extent = null;

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.on('pointercancel', this._pointercancel);
    eventManager.on('pointerdown', this._pointerdown);
    eventManager.on('pointermove', this._pointermove);
    eventManager.on('pointerup', this._pointerup);
  }


  /**
   * Unbind event handlers
   */
  public disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    this.lastDown = null;
    this.lastMove = null;
    this._extent = null;

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.off('pointercancel', this._pointercancel);
    eventManager.off('pointerdown', this._pointerdown);
    eventManager.off('pointermove', this._pointermove);
    eventManager.off('pointerup', this._pointerup);
  }


  /**
   * Handler for pointerdown events - starts the lasso.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointerdown(e: FederatedPointerEvent): void {
    if (this.lastDown) return;  // a pointer is already down

    // Ignore it if we are not over the canvas
    // (e.g. sidebar, out of browser window, over a button, toolbar, modal)
    const context = this.context;
    const gfx = context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    if (!eventManager.pointerOverRenderer) return;

    const modifiers = eventManager.modifierKeys;
    if (modifiers.has('Shift')) {
      const coord = eventManager.coord.world;
      const down = this._getEventData(e);
      this.lastDown = down;
      this._extent = new Extent(coord);
      this._coords = [coord, coord];
    }
  }


  /**
   * Handler for pointermove events - continues the lasso.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointermove(e: FederatedPointerEvent): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    if (!eventManager.pointerOverRenderer) return;

    const move = this._getEventData(e);
    const down = this.lastDown;
    const modifiers = eventManager.modifierKeys;

    if (modifiers.has('Shift') && down && down.id === move.id) {   // same pointer as down
      const last = this.lastMove ?? this.lastDown!;
      const dist = vecLength(last.coord.screen, move.coord.screen);  // distance in screen pixels

      if (dist >= MOVE_TOLERANCE) {  // if moved enough, record another point
        this.lastMove = move;

        // Update geometry and extent.
        const coord = move.coord.world;
        this._extent = this._extent!.extend(new Extent(coord));
        this._coords.push(coord);

        // Update the lasso data and schedule a redraw.
        const mapUILayer = gfx.scene!.layers.get('map-ui') as PixiLayerMapUI;
        mapUILayer.lassoData = this._coords;
        gfx.immediateRedraw();
      }
    }
  }


  /**
   * Handler for pointerup events - completes the lasso and selects the points inside it.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointerup(e: FederatedPointerEvent): void {
    const down = this.lastDown;
    const up = this._getEventData(e);
    if (!down || down.id !== up.id) return;  // not down, or different pointer

    this.lastDown = null;  // prepare for the next `pointerdown`

    const context = this.context;
    const gfx = context.systems.gfx!;

    // Clear the lasso and schedule a redraw.
    const mapUILayer = gfx.scene!.layers.get('map-ui') as PixiLayerMapUI;
    mapUILayer.lassoData = null;
    gfx.immediateRedraw();

    const ids = this._lassoed();
    this._extent = null;
    this._coords = [];

    if (ids.length) {
      this.context.enter('select-osm', { selection: { osm: ids }} );
    }
  }


  /**
   * Handler for pointercancel events.
   */
  protected _pointercancel(): void {
    this.lastDown = null;  // prepare for the next `pointerdown`

    const context = this.context;
    const gfx = context.systems.gfx!;

    // Clear the lasso and schedule a redraw.
    const mapUILayer = gfx.scene!.layers.get('map-ui') as PixiLayerMapUI;
    mapUILayer.lassoData = null;
    gfx.immediateRedraw();

    this._extent = null;
    this._coords = [];
  }


  /**
   * Returns array of entity IDs that are within the lasso polygon
   * @return  Array of entity IDs
   */
  protected _lassoed(): EntityID[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;
    const locations = context.systems.locations!;
    const spatial = context.systems.spatial!;
    const entityIDs: EntityID[] = [];

    if (!this.context.editable() || !this._extent || !this._coords.length) return [];

    // Gather OsmNodes within the lasso.
    const hits = spatial.getDataAtBox('osm', this._extent.bbox());
    for (const hit of hits) {
      const node = hit.contents as OsmNode;
      if (node.type !== 'node') continue;

      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord) continue;

      if (!geomPointInPolygon(coord, this._coords)) continue;
      if (filters.isHidden(node, graph, node.geometry(graph))) continue;
      if (locations.isBlockedAt(node.loc!)) continue;

      entityIDs.push(node.id);
    }

    return entityIDs;
  }

}
