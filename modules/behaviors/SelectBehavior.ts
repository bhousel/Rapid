import { AbstractBehavior } from './AbstractBehavior.ts';
import { MapInteractionBehavior } from './MapInteractionBehavior.ts';
import { GeoJSONData, MarkerData, OsmEntity, OsmNode, OsmWay } from '../data/index.ts';
import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { projWorldToWgs84, vecLength, vecProject } from '@rapid-sdk/math';
import { utilDetect } from '../util/detect.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from '../Context.ts';
import type { EventData } from './AbstractBehavior.ts';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { Vec2 } from '@rapid-sdk/math';

const NEAR_TOLERANCE = 4;
const FAR_TOLERANCE = 12;


/**
 * `SelectBehavior` listens to pointer events and selects items that are clicked on.
 *
 * Properties available:
 *   `enabled`      `true` if the event handlers are enabled, `false` if not.
 *   `lastDown`     `eventData` Object for the most recent down event
 *   `lastUp`       `eventData` Object for the most recent up event (to detect dbl clicks)
 *   `lastMove`     `eventData` Object for the most recent move event
 *   `lastSpace`    `eventData` Object for the most recent move event used to trigger a spacebar click
 *   `lastClick`    `eventData` Object for the most recent click event
 */
export class SelectBehavior extends AbstractBehavior {

  /** EventData for the most recent pointerdown event */
  public lastDown: EventData | null;
  /** EventData for the most recent pointerup event (used for double-click detection) */
  public lastUp: EventData | null;
  /** EventData for the most recent pointermove event */
  public lastMove: EventData | null;
  /** EventData for the most recent spacebar press (used for spacebar clicking) */
  public lastSpace: EventData | null;
  /** EventData for the most recent successful click event */
  public lastClick: EventData | null;

  /** Set of entity IDs for multi-selection (Shift+click) */
  protected _multiSelection: Set<EntityID>;
  /** Whether spacebar clicking is temporarily disabled */
  protected _spaceClickDisabled: boolean;
  /** Whether the context menu is currently shown */
  protected _showsMenu: boolean;
  /** Whether the MapRoulette menu is currently shown */
  protected _showsMapRouletteMenu: boolean;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'select';

    this._multiSelection = new Set<EntityID>();
    this._spaceClickDisabled = false;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    // Make sure the event handlers have `this` bound correctly
    this._cancelLongPress = this._cancelLongPress.bind(this);
    this._doLongPress = this._doLongPress.bind(this);
    this._keydown = this._keydown.bind(this);
    this._keyup = this._keyup.bind(this);
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
    this._multiSelection.clear();
    this._spaceClickDisabled = false;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.on('keydown', this._keydown);
    eventManager.on('keyup', this._keyup);
    eventManager.on('pointerdown', this._pointerdown);
    eventManager.on('pointermove', this._pointermove);
    eventManager.on('pointerup', this._pointerup);
    eventManager.on('pointercancel', this._pointercancel);
  }


  /**
   * Unbind event handlers
   */
  public disable(): void {
    if (!this._enabled) return;

    this._enabled = false;
    this._multiSelection.clear();
    this._spaceClickDisabled = false;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    this._cancelLongPress();

    const gfx = this.context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    eventManager.off('keydown', this._keydown);
    eventManager.off('keyup', this._keyup);
    eventManager.off('pointerdown', this._pointerdown);
    eventManager.off('pointermove', this._pointermove);
    eventManager.off('pointerup', this._pointerup);
    eventManager.off('pointercancel', this._pointercancel);
  }


  /**
   * Handler for keydown events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  protected _keydown(e: KeyboardEvent): void {
    // if any key is pressed the user is probably doing something other than long-pressing
    this._cancelLongPress();

    const context = this.context;

    // Escape key
    if (['Escape', 'Esc'].includes(e.key)) {
      if (context.container().select('.combobox').size()) return;
      e.preventDefault();
      context.enter('browse');
      return;

    } else if (e.key === 'ContextMenu') {
      e.preventDefault();
      this._doContextMenu();
      return;

    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    } else if (!this._spaceClickDisabled && [' ', 'Spacebar'].includes(e.key)) {
      // ignore spacebar events during text input
      const activeNode = document.activeElement;
      if (activeNode && new Set<string>(['INPUT', 'TEXTAREA']).has(activeNode.nodeName)) return;
      e.preventDefault();
      e.stopPropagation();
      this._spacebar();
    }
  }


  /**
   * Handler for keyup events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  protected _keyup(e: KeyboardEvent): void {
    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    if (this._spaceClickDisabled && [' ', 'Spacebar'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      this._spaceClickDisabled = false;
    }
  }


  /**
   * Handler for pointerdown events.  Note that you can get multiples of these
   * if the user taps with multiple fingers. We lock in the first one in `lastDown`.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointerdown(e: FederatedPointerEvent): void {
    if (this.lastDown) return;  // a pointer is already down

    const context = this.context;
    const scheduler = context.systems.scheduler!;
    const ui = context.systems.ui;

    ui?.closeEditMenu();
    this._showsMenu = false;

    ui?.closeMapRouletteMenu();
    this._showsMapRouletteMenu = false;

    const down = this._getEventData(e);
    this.lastDown = down;
    this.lastClick = null;

    this._cancelLongPress();

    // For touch devices, we want to make sure that the context menu is accessible via long press.
    if (e.pointerType === 'touch') {
      scheduler.setTimeout('longpress', () => this._doLongPress(down), { ms: 750 });
    }
  }


  /**
   * Handler for pointermove events.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointermove(e: FederatedPointerEvent): void {
    const move = this._getEventData(e);
    this.lastMove = move;

    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    if (this._spaceClickDisabled && this.lastSpace) {
      const dist = vecLength(move.coord.screen, this.lastSpace.coord.screen);
      if (dist > FAR_TOLERANCE) {     // pointer moved far enough
        this._spaceClickDisabled = false;
      }
    }

    // If the pointer moves too much, we consider it as a drag, not a click, and set `isCancelled=true`
    const down = this.lastDown;
    if (down && !down.isCancelled && down.id === move.id) {
      const dist = vecLength(down.coord.screen, move.coord.screen);
      if (dist >= NEAR_TOLERANCE) {
        down.isCancelled = true;
      }
    }
  }


  /**
   * Handler for pointerup events.
   * @param  e - A Pixi FederatedPointerEvent
   */
  protected _pointerup(e: FederatedPointerEvent): void {
    const down = this.lastDown;
    const up = this._getEventData(e);
    if (!down || down.id !== up.id) return;  // not down, or different pointer

    this.lastDown = null;  // prepare for the next `pointerdown`

    if (down.isCancelled) return;   // was cancelled already by moving too much

    const context = this.context;
    const ui = context.systems.ui;

    const dist = vecLength(down.coord.screen, up.coord.screen);
    const updist = vecLength(up.coord.screen, this.lastUp ? this.lastUp.coord.screen : [0, 0]);
    const lClick = (up.event as PointerEvent).button === 0;

    // Second left-click nearby, targeting the same target, within half a second of the last up event.
    // We got ourselves a double click!
    if (lClick && this.lastUp?.target?.dataID && updist < NEAR_TOLERANCE && this.lastUp?.target?.dataID === up.target?.dataID && up.time - (this.lastUp ? this.lastUp.time : 0) < 500) {
      this.lastClick = this.lastUp = up;  // We will accept this as a double-click
      this._doDoubleClick();

    } else if (dist < NEAR_TOLERANCE || (dist < FAR_TOLERANCE && up.time - down.time < 500)) {
      this.lastClick = this.lastUp = up;  // We will accept this as a click

      if ((up.event as PointerEvent).button === 2) {   // right click
        if (!context.selectedIDs().includes(down.target!.dataID!)) {
          this._doSelect();    // Select it first, if needed
        }
        const target = down.target;
        if ((target?.data as any)?.serviceID === 'maproulette') {
          const anchorPoint = up.coord.screen;
          ui?.showMapRouletteMenu(anchorPoint, 'rightclick');
        } else {
          this._doContextMenu(); // Then show the context menu.
        }

      } else {
        this._doSelect();
      }
    }
  }


  /**
   * Handler for pointercancel events.
   */
  protected _pointercancel(): void {
    // Here we can throw away the down data to prepare for another `pointerdown`.
    // After pointercancel, there should be no more `pointermove` or `pointerup` events.
    this.lastDown = null;
  }


  /**
   * Handler for `keydown` events of the spacebar. We use these to simulate clicks.
   * Note that the spacebar will repeat, so we can get many of these.
   */
  protected _spacebar(): void {
    if (this._spaceClickDisabled) return;

    // For spacebar clicks we will use the last move event as the trigger
    if (!this.lastMove) return;

    // Becase spacebar events will repeat if you keep it held down,
    // user must move pointer or lift spacebar to allow another spacebar click.
    // So we disable further spacebar clicks until one of those things happens.
    this._spaceClickDisabled = true;
    this.lastSpace = this.lastMove;
    this.lastClick = this.lastMove;   // We will accept this as a click
    this._doSelect();
  }


  /**
   * Once we have determined that the user has clicked, this is where we handle that click.
   */
  protected _doSelect(): void {
    if (!this._enabled || !this.lastClick) return;  // nothing to do

    this._cancelLongPress();

    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const graph = editor.staging.graph;
    const photos = context.systems.photos;
    const scheduler = context.systems.scheduler!;
    const eventManager = gfx.eventManager!;

    const modifiers = eventManager.modifierKeys;
    const isMac = utilDetect().os === 'mac';
    const disableSnap = modifiers.has('Alt') || modifiers.has('Meta') || (!isMac && modifiers.has('Control'));
    const isMultiselect = modifiers.has('Shift');
    const eventData: EventData = { ...this.lastClick };  // shallow copy

    // If a modifier key is down, discard the target to prevent snap/hover.
    if (disableSnap) {
      eventData.target = null;
    }

    // Determine what we clicked on and switch modes..
    const target = eventData.target;
    let data = target?.data;
    let dataID = target?.dataID;
    const layerID = target?.layerID || null;
    const serviceID = (data?.props?.serviceID || '') as ServiceID;

    // If we're clicking on something real, we want to pause doubleclick zooms
    if (data) {
      const behavior = context.behaviors.mapInteraction as MapInteractionBehavior;
      behavior.doubleClickEnabled = false;
      scheduler.setTimeout('doubleclick-enable', () => behavior.doubleClickEnabled = true, { ms: 500 });
    }

    // Clicked a midpoint..
    // Treat a click on a midpoint as if clicking on its parent way
    if (data?.type === 'midpoint') {
      const wayID = data.props.wayID as EntityID;
      data = graph.hasEntity(wayID);
      dataID = data?.id;
    }

    // Clicked on nothing, or an edit block polygon..
    if (!data || data.type === 'block') {
      if (context.mode?.id !== 'browse' && !this._multiSelection.size && !isMultiselect) {
        context.enter('browse');
      }
      return;

    // Clicked on a photo..
    } else if (photos && data.type === 'photo') {
      photos.selectPhoto(layerID, dataID);
      return;

    // Clicked a selectable non-OSM feature..
    } else if (
      ['mapwithai', 'esri', 'overture'].includes(serviceID) ||    // Clicked Rapid data..
      data instanceof GeoJSONData ||  // Clicked Custom Data (e.g. gpx track)..
      data instanceof MarkerData      // Clicked a MarkerData (OSM Note, KeepRight, Osmose, Maproulette)..
    ) {
      const selection = new Map<DataID, AbstractData>().set(dataID!, data);
      context.enter('select', { selection: selection });
      return;

    // Clicked an OSM feature..
    } else if (data instanceof OsmEntity) {
      let selectedIDs = context.selectedIDs();

      if (!isMultiselect) {
        if (!this._showsMenu || selectedIDs.length <= 1 || !selectedIDs.includes(dataID!)) {
          // Always re-enter select mode even if the entity is already
          // selected since listeners may expect `context.enter` events,
          // e.g. in the walkthrough
          context.enter('select-osm', { selection: { osm: [dataID!] }} );
        }
      } else {
        if (selectedIDs.includes(dataID!)) {   // already in the selectedIDs..
          if (!this._showsMenu) {
            selectedIDs = selectedIDs.filter(id => id !== dataID);      // deselect it..
            context.enter('select-osm', { selection: { osm: selectedIDs }} );
          }
        } else {                        // not already in selectedIDs...
          selectedIDs.push(dataID!);    // select it..
          context.enter('select-osm', { selection: { osm: selectedIDs }} );
        }
      }
      return;
    }
  }


  /**
   * Cancel any scheduled longpress handler
   */
  protected _cancelLongPress(): void {
    const scheduler = this.context.systems.scheduler!;

    scheduler.cancel('longpress');
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;
  }


  /**
   * Called a short time after pointerdown.
   * If we're still down, treat it as a click + contextmenu.
   * @param  down - EventData Object for the original down event
   */
  protected _doLongPress(down: EventData): void {
    if (this.lastDown === down && !down.isCancelled) {   // still down
      this.lastClick = down;    // We will accept this as a click
      down.isCancelled = true;  // cancel it so that we don't get *another* click when the user lifts up
      this._doSelect();
      this._doContextMenu();
    }
  }


  /**
   * Once we have had two 'ups' in a row we need to see if anything special needs to be done to the entity being clicked on.
   * If it's a way or an area, we need to add a node wherever they clicked:
   * - If it's on a bare part of the way
   * - If they double clicked right on a midpoint.
   */
  protected _doDoubleClick(): void {
    if (!this._enabled || !this.lastUp) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n;

    const point = this.lastUp.coord.world;
    const data: any = this.lastUp.target?.data;

    const isOSMWay = data instanceof OsmWay && !data.props.fbID;
    const isMidpoint = data instanceof MarkerData && data?.type === 'midpoint';

    let loc: Vec2 | undefined;
    let edge: [EntityID, EntityID] | undefined;

    if (isOSMWay) {
      const way = data as OsmWay;
      // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
      const line = way.geoms.parts[0]!.world!.outer as Vec2[];
      const choice = vecProject(point, line);
      if (choice) {
        loc = projWorldToWgs84(choice.point);
        edge = [ way.nodes[choice.index - 1], way.nodes[choice.index] ];
      }

    } else if (isMidpoint) {
      loc = data.props.loc;
      edge = data.props.edge;
    }

    if (loc && edge) {
      editor.perform(actionAddMidpoint({ loc, edge } as Midpoint, new OsmNode(context)));
      editor.commit({
        annotation: l10n!.t('operations.add.annotation.vertex'),
        selectedIDs: context.selectedIDs()   // keep the parent way selected
      });
    }

  }

  /**
   * Once we have determined that the user wants the contextmenu, this is where we handle that.
   * We get into here from `_pointerup`, `_keydown`, or `_doLongPress`
   * Uses whatever is in `this.lastClick` as the target for the menu.
   */
  protected _doContextMenu(): void {
    if (!this._enabled || !this.lastClick) return;  // nothing to do

    const context = this.context;
    const gfx = context.systems.gfx!;
    const eventManager = gfx.eventManager!;
    const ui = context.systems.ui;

    const modifiers = eventManager.modifierKeys;
    const isMac = utilDetect().os === 'mac';
    const disableSnap = modifiers.has('Alt') || modifiers.has('Meta') || (!isMac && modifiers.has('Control'));
    const eventData: EventData = { ...this.lastClick };  // shallow copy

    // If a modifier key is down, discard the target to prevent snap/hover.
    if (disableSnap) {
      eventData.target = null;
    }
    const target = eventData.target;
    const data = target?.data;
    // Check if the clicked item is a MapRoulette task
    if (data instanceof MarkerData && data.serviceID === 'maproulette') {
      const anchorPoint = eventData.coord.screen;
      if (this._showsMapRouletteMenu) {
        ui?.closeMapRouletteMenu();
        this._showsMapRouletteMenu = false;
      } else {
        ui?.showMapRouletteMenu(anchorPoint, 'rightclick');
        this._showsMapRouletteMenu = true;
      }
      return;
    }
    if (this._showsMenu) {   // menu is on, toggle it off
      ui?.closeEditMenu();
      this._showsMenu = false;

    } else {                 // menu is off, toggle it on
      // Only attempt to display the context menu if we're focused on a non-Rapid OSM Entity.
      this._showsMenu = true;
      ui?.showEditMenu(eventData.coord.map, 'rightclick');
    }
  }

}
