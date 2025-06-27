import { AbstractMode } from './AbstractMode.js';
import { Marker } from '../models/Marker.js';

const DEBUG = false;


/**
 * `AddNoteMode`
 * In this mode, we are waiting for the user to place a Note somewhere
 */
export class AddNoteMode extends AbstractMode {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'add-note';

    // Make sure the event handlers have `this` bound correctly
    this._click = this._click.bind(this);
    this._cancel = this._cancel.bind(this);
  }


  /**
   * enter
   * Enters the mode.
   */
  enter() {
    if (DEBUG) {
      console.log('AddNoteMode: entering');  // eslint-disable-line no-console
    }

    this._active = true;
    const context = this.context;
    context.enableBehaviors(['hover', 'draw', 'mapInteraction']);

    context.behaviors.draw
      .on('click', this._click)
      .on('cancel', this._cancel)
      .on('finish', this._cancel);

    return true;
  }


  /**
   * exit
   */
  exit() {
    if (!this._active) return;
    this._active = false;

    if (DEBUG) {
      console.log('AddNoteMode: exiting');  // eslint-disable-line no-console
    }

    const context = this.context;
    context.behaviors.draw
      .off('click', this._click)
      .off('cancel', this._cancel)
      .off('finish', this._cancel);
  }


  /**
   * _click
   * Add a Note at the mouse click coords
   */
  _click(eventData) {
    const context = this.context;
    const osm = context.services.osm;
    const viewport = context.viewport;
    const point = eventData.coord.map;
    const loc = viewport.unproject(point);

    if (!osm) return;

    // pass `null` to generate a new noteID
    const props = { serviceID: 'osm', loc: loc, isNew: true, status: 'open', comments: [] };
    const note = new Marker(context, props);
    osm.replaceNote(note);

    const selection = new Map().set(note.id, note);
    context.enter('select', { selection: selection });
  }


  /**
   * _cancel
   * Return to browse mode without doing anything
   */
  _cancel() {
    this.context.enter('browse');
  }
}
