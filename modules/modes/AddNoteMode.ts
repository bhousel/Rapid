import { AbstractMode } from './AbstractMode.ts';
import { MarkerData } from '../data/MarkerData.ts';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { OsmNoteProps, OsmNote } from '../services/OsmService.ts';

const DEBUG = false;


/**
 * In `AddNoteMode`, we are waiting for the user to place a Note somewhere
 */
export class AddNoteMode extends AbstractMode {

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'add-note';

    // Make sure the event handlers have `this` bound correctly
    this._click = this._click.bind(this);
    this._cancel = this._cancel.bind(this);
  }


  /**
   * Enters the mode.
   * @return `true` if mode could be entered, `false` if not
   */
  enter(): boolean {
    if (DEBUG) {
      console.log('AddNoteMode: entering');  // eslint-disable-line no-console
    }

    this._active = true;
    const context = this.context;
    context.enableBehaviors(['hover', 'draw', 'mapInteraction']);

    context.behaviors.draw!
      .on('click', this._click)
      .on('cancel', this._cancel)
      .on('finish', this._cancel);

    return true;
  }


  /**
   * Exits the mode, removing event listeners from draw behavior.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    if (DEBUG) {
      console.log('AddNoteMode: exiting');  // eslint-disable-line no-console
    }

    const context = this.context;
    context.behaviors.draw!
      .off('click', this._click)
      .off('cancel', this._cancel)
      .off('finish', this._cancel);
  }


  /**
   * Add a Note at the mouse click coords
   */
  private _click(eventData: EventData): void {
    const context = this.context;
    const osm = context.services.osm as any;
    const viewport = context.viewport;
    const point = eventData.coord.map;
    const loc = viewport.unproject(point);

    if (!osm) return;

    // pass `null` to generate a new noteID
    const props: Partial<OsmNoteProps> = { serviceID: 'osm' as ServiceID, loc: loc, isNew: true, status: 'open', comments: [] };
    const note: OsmNote = new MarkerData(context, props);
    osm.replaceNote(note);

    const selection = new Map().set(note.id, note);
    context.enter('select', { selection: selection });
  }


  /**
   * Return to browse mode without doing anything
   */
  private _cancel(): void {
    this.context.enter('browse');
  }
}
