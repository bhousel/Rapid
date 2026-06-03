import { AbstractMode } from './AbstractMode.ts';
import { projWorldToWgs84, vecAdd, vecRotate, vecSubtract } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { MarkerData } from '../data/MarkerData.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Options for entering `DragNoteMode` */
interface DragNoteModeOptions {
  /** The ID of the note to drag */
  noteID?: DataID;
}


/**
 *  In `DragNoteMode`, the user has started dragging a new, unsaved OSM Note.
 */
export class DragNoteMode extends AbstractMode {

  /** The note (MarkerData) being dragged, or null if not dragging */
  public dragNote: MarkerData | null;

  /** Difference between where the pin is, and where on the pin the user clicked */
  protected _dragOffset: Vec2;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'drag-note';

    this.dragNote = null;    // The note being dragged
    this._dragOffset = [0, 0];

    // Make sure the event handlers have `this` bound correctly
    this._move = this._move.bind(this);
    this._end = this._end.bind(this);
    this._cancel = this._cancel.bind(this);
    this._nudge = this._nudge.bind(this);
  }


  /**
   * Enters the mode.
   * @param  options - Optional object of options passed to the new mode
   * @return `true` if the mode can be entered, `false` if not
   */
  public enter(options: DragNoteModeOptions = {}): boolean {
    const context = this.context;
    const osm = context.services.osm as any;
    if (!osm) return false;

    const noteID = options.noteID;
    const note = osm.getNote(noteID) as MarkerData | undefined;
    if (!note?.loc) return false;

    this._active = true;
    this.dragNote = note;
    this._selectedData.set(this.dragNote.id, this.dragNote);

    // Calculate dragOffset, to correct for where "on the pin" the user grabbed the target.
    const startCoord = note.geoms.parts[0]!.world!.coords as Vec2;  // A marker should have a single world coord
    const clickCoord = context.behaviors.drag!.lastDown!.coord.world;
    this._dragOffset = vecSubtract(startCoord, clickCoord);

    context.enableBehaviors(['drag', 'mapNudge']);
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
   * Exits the mode, clearing state and removing event listeners.
   */
  public exit(): void {
    if (!this._active) return;
    this._active = false;

    this.dragNote = null;
    this._dragOffset = [0, 0];
    this._selectedData.clear();

    const context = this.context;
    context.behaviors.drag!
      .off('move', this._move)
      .off('end', this._end)
      .off('cancel', this._cancel);

    context.behaviors.mapNudge!
      .off('nudge', this._nudge);
  }


  /**
   * Move the dragging node
   * @param  eventData - Data received from the drag behavior
   */
  protected _move(eventData: EventData): void {
    if (!this.dragNote) return;

    const context = this.context;
    const locations = context.systems.locations;
    const gfx = context.systems.gfx;
    const osm = context.services.osm;
    const point = eventData.coord.world;

    // The "drag offset" is the difference between where the user grabbed
    // the marker/pin and where the location of the node actually is.
    const loc = projWorldToWgs84(vecAdd(point, this._dragOffset));

    if (locations?.isBlockedAt(loc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    this.dragNote = this.dragNote.update({ loc: loc });
    osm?.replaceNote(this.dragNote);
    this._selectedData.set(this.dragNote.id, this.dragNote);

    // Force a redraw - there is no event for notes that would tell the map to redraw.
    // (unlike with dragging osm features around, where editsystem emits `stagingchanged` events)
    gfx?.immediateRedraw();
  }


  /**
   * This event fires on map pans at the edge of the screen.
   * We want to move the dragging note opposite of the pixels panned to keep it in the same place.
   * @param  nudge - [x,y] amount of map pan in pixels
   */
  protected _nudge(nudge: Vec2): void {
    if (!this.dragNote || !this.dragNote.loc) return;

    const context = this.context;
    const osm = context.services.osm as any;
    const locations = context.systems.locations;
    const viewport = context.viewport;
    const t = context.viewport.transform;
    if (t.r) {
      nudge = vecRotate(nudge, -t.r, [0, 0]);   // remove any rotation
    }

    const currPoint = viewport.project(this.dragNote.loc);
    const destPoint = vecSubtract(currPoint, nudge);
    const loc = viewport.unproject(destPoint);

    if (locations?.isBlockedAt(loc)) {  // editing is blocked here
      this._cancel();
      return;
    }

    this.dragNote = this.dragNote.update({ loc: loc });
    osm.replaceNote(this.dragNote);
    this._selectedData.set(this.dragNote.id, this.dragNote);
  }


  /**
   * Complete the drag and keep the note selected.
   * Note that `exit()` will be called immediately after this to perform cleanup.
   */
  protected _end(): void {
    if (this.dragNote) {
      const selection = new Map<DataID, MarkerData>().set(this.dragNote.id, this.dragNote);
      this.context.enter('select', { selection: selection });
    } else {
      this.context.enter('browse');
    }
  }


  /**
   * Return to browse mode
   * Note that `exit()` will be called immediately after this to perform cleanup.
   */
  protected _cancel(): void {
    this.context.enter('browse');
  }
}
