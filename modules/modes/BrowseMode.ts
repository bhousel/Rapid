import { AbstractMode } from './AbstractMode.ts';
import { operationPaste } from '../operations/paste.js';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';

const DEBUG = false;


/**
 * `BrowseMode` is the default mode that the editor is in.
 *  Nothing selected but users can hover or click on things.
 *  - "operations" allowed (right click edit menu) includes Paste only
 */
export class BrowseMode extends AbstractMode {

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'browse';

    // Make sure the event handlers have `this` bound correctly
    this._hover = this._hover.bind(this);
  }


  /**
   * Enters the mode.
   * @return `true` if mode could be entered, `false` if not
   */
  enter(): boolean {
    if (DEBUG) {
      console.log('BrowseMode: entering');  // eslint-disable-line no-console
    }

    const context = this.context;
    const ui = context.systems.ui!;

    this._active = true;

    this.operations = [ operationPaste(context) ];
    context.enableBehaviors(['hover', 'select', 'drag', 'paste', 'lasso', 'mapInteraction']);

    context.behaviors.hover!
      .on('hoverchange', this._hover);

    // Reset sidebar to show "search features"
    // Exception: don't replace the "save-success" screen.
    // Wait for the user to dismiss it or select something else. Rapid#700
    const Sidebar = ui.Sidebar;
    const didJustSave = (Sidebar.$custom && Sidebar.$custom.selectAll('.save-success').size());
    if (!didJustSave) {
      Sidebar.hide();
    }

    // Get focus on the body.
    // I think this was done to remove focus from whatever
    // field the user was using in the sidebar/inspector?
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && typeof activeElement.blur === 'function') {
      activeElement?.blur();
    }

    return true;
  }


  /**
   * Exits the mode, clearing operations and removing event listeners.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    this.operations = [];

    if (DEBUG) {
      console.log('BrowseMode: exiting');  // eslint-disable-line no-console
    }

    this.context.behaviors.hover!
      .off('hoverchange', this._hover);
  }


  /**
   * Changes the cursor styling based on what geometry is hovered
   */
  private _hover(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor;
    const graph = editor!.staging.graph;
    const eventManager = context.systems.gfx!.eventManager!;

    const target = eventData.target;
    const datum = target?.data as { id?: EntityID } | null;
    const entity = datum?.id && graph.hasEntity(datum.id);
    const geom = entity ? entity.geometry(graph) : 'unknown';

    switch (geom) {
      case 'area':
        eventManager.setCursor('areaCursor');
        break;
      case 'line':
        eventManager.setCursor('lineCursor');
        break;
      case 'point':
        eventManager.setCursor('pointCursor');
        break;
      case 'vertex':
        eventManager.setCursor('vertexCursor');
        break;
      default:
        eventManager.setCursor('grab');
        break;
    }
  }
}

