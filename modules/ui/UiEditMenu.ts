import { select as d3_select } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { vecAdd } from '@rapid-sdk/math';

import { uiTooltip } from './tooltip.js';
import { uiIcon } from './icon.js';
import { utilHighlightEntities } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';

/** Minimal interface for an operation bound as data in the edit menu */
interface Operation {
  id: OperationID;
  title: string;
  mouseOnly?: boolean;
  disabled(): string | null | false;
  tooltip(): string;
  keys?: string[];
  relatedEntityIds?(): EntityID[];
}


const VIEW_TOP_MARGIN = 85;     // viewport top margin
const VIEW_BOTTOM_MARGIN = 45;  // viewport bottom margin
const VIEW_SIDE_MARGIN = 35;    // viewport side margin
const MENU_SIDE_MARGIN = 10;    // offset the menu slightly from the target location
const VERTICAL_PADDING = 4;     // hardcode these values to make menu positioning easier
const TOOLTIP_WIDTH = 210;      // see also `.edit-menu .tooltip` CSS; include margin


/**
 * The `UiEditMenu` renders the context menu of operations shown when the user
 * right-clicks / long-presses a selected feature. Set `anchorLoc()`, `triggerType()`,
 * and `operations()`, then call `.render($selection)`. Call `close()` to dismiss it.
 * Emits `toggled`.
 */
export class UiEditMenu extends EventEmitter {
  public context: Context;

  // Menu state, these are locked in when menu is initially shown
  // but needed later if the menu is repositioned
  protected _menu: D3Selection;
  protected _operations: Operation[];
  protected _tooltips: Map<OperationID, any>;   // Map(id -> tooltip)
  protected _anchorLoc: Vec2;              // Array [lon,lat] wgs84 coordinate where the menu should be anchored
  protected _oldz: number;
  protected _triggerType: string;          // 'touch', 'pen', or 'rightclick'
  protected _menuTop: boolean;
  protected _menuHeight: number;
  protected _menuWidth: number;
  protected _lastPointerUpType: string | null;

  /** Creates a new edit menu bound to the shared application context. */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._menu = d3_select(null);
    this._operations = [];
    this._tooltips = new Map();
    this._anchorLoc = [0, 0];
    this._oldz = 0;
    this._triggerType = '';
    this._menuTop = false;
    this._menuHeight = 0;
    this._menuWidth = 0;
    this._lastPointerUpType = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this.close = this.close.bind(this);
    this._updatePosition = this._updatePosition.bind(this);
    this._click = this._click.bind(this);
    this._pointerup = this._pointerup.bind(this);
  }


  /**
   * Renders the menu into the given overlay selection.
   * The menu is rebuilt and repositioned into the overlay each time it is shown, so it
   *  renders into `$selection` rather than capturing `$parent`.
   * @param $selection - A d3-selection to the overlay this menu renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const map = context.systems.map!;
    const viewport = context.viewport;

    if (this._triggerType === undefined) {
      this._triggerType = 'rightclick';
    }

    const isTouchMenu = this._triggerType.includes('touch') || this._triggerType.includes('pen');
    const ops = this._operations.filter((op: Operation) => !isTouchMenu || !op.mouseOnly);
    if (!ops.length) return;

    // Position the menu above the anchor for stylus and finger input
    // since the mapper's hand likely obscures the screen below the anchor
    this._menuTop = isTouchMenu;

    // Show labels for touch input since there aren't hover tooltips
    // bhousel 8/10/22 - show always, this menu just looks better with labels
    const showLabels = true; // isTouchMenu;

    const buttonHeight = showLabels ? 32 : 34;
    if (showLabels) {
      // Get a general idea of the width based on the length of the label
      this._menuWidth = 52 + Math.min(120, 6 * Math.max(...ops.map((op: Operation) => op.title.length)));
    } else {
      this._menuWidth = 44;
    }

    this._menuHeight = VERTICAL_PADDING * 2 + ops.length * buttonHeight;
    this._oldz = viewport.transform.zoom;

    const $wrap: D3Selection = $selection.selectAll('.edit-menu')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'edit-menu')
      .classed('touch-menu', isTouchMenu)
      .style('padding', VERTICAL_PADDING + 'px 0');

    this._menu = $wrap.merge($$wrap);

    let $buttons: D3Selection = this._menu.selectAll('.edit-menu-item')
      .data(ops, (d: Operation) => d.id);

    // Exit
    $buttons.exit()
      .remove();

    // Enter
    const $$buttons = $buttons.enter()
      .append('button')
      .attr('class', (d: Operation) => `edit-menu-item edit-menu-item-${d.id}`)
      .style('height', `${buttonHeight}px`)
      .on('click', this._click)
      // don't listen for `mouseup` because we only care about non-mouse pointer types
      .on('pointerup', this._pointerup)
      .on('pointerdown mousedown', (d3_event: Event) => {
        // don't let button presses also act as map input - iD#1869
        d3_event.stopPropagation();
      })
      .on('mouseenter.highlight', (d3_event: Event, d: Operation) => {
        if (!d.relatedEntityIds || d3_select(d3_event.currentTarget as HTMLElement).classed('disabled')) return;
        utilHighlightEntities(context, d.relatedEntityIds(), true);
      })
      .on('mouseleave.highlight', (d3_event: Event, d: Operation) => {
        if (!d.relatedEntityIds) return;
        utilHighlightEntities(context, d.relatedEntityIds(), false);
      });

    // create placeholder icon, label, tooltip
    $$buttons.each((d: Operation, i: number, nodes: ArrayLike<HTMLElement>) => {
      const $button = d3_select(nodes[i]);

      $button
        .append('div')
        .attr('class', 'icon-wrap')
        .call(uiIcon('', 'operation'));

      if (showLabels) {
        $button
          .append('span')
          .attr('class', 'label');
      }

      const tooltip = uiTooltip(context);
      this._tooltips.set(d.id, tooltip);
      $button
        .call(tooltip);
    });


    // Update
    $buttons = $buttons.merge($$buttons);

    // refresh with current data
    $buttons.each((d: Operation, i: number, nodes: ArrayLike<HTMLElement>) => {
      const $button = d3_select(nodes[i]);

      $button
        .classed('disabled', (d: Operation) => !!d.disabled());

      $button.selectAll('.icon-wrap use')
        .attr('href', `#rapid-operation-${d.id}`);

      $button.selectAll('.label')
        .text((d: Operation) => d.title);

      const tooltip = this._tooltips.get(d.id);
      if (tooltip) {
        tooltip
          .heading(d.title)
          .title(d.tooltip())
          .shortcut(d.keys[0]);  // display the first key combo, if there are alternates
      }
    });

    // Update menu position (and keep it updated as the map moves)
    this._updatePosition();
    map.off('move', this._updatePosition);
    map.on('move', this._updatePosition);

    this.emit('toggled', true);
  }


  /**
   * Records the pointer type of the last `pointerup` (called before `click`).
   * @param d3_event - the `pointerup` event
   */
  protected _pointerup(d3_event: PointerEvent): void {
    this._lastPointerUpType = d3_event.pointerType;
  }


  /**
   * Handles a click on a menu item, running the operation (or flashing feedback if disabled).
   * @param d3_event - the triggering event
   * @param operation - the operation bound to the clicked item
   */
  protected _click(d3_event: Event, operation: Operation): void {
    const context = this.context;
    const ui = context.systems.ui;

    d3_event.stopPropagation();

    if (operation.relatedEntityIds) {
      utilHighlightEntities(context, operation.relatedEntityIds(), false);
    }

    if (operation.disabled()) {
      if (this._lastPointerUpType === 'touch' || this._lastPointerUpType === 'pen') {
        // there are no tooltips for touch interactions so flash feedback instead
        ui?.Flash.show({
          duration: 4000,
          iconName: `#rapid-operation-${operation.id}`,
          iconClass: 'operation disabled',
          label: operation.tooltip()
        });
      }
    } else {
      if (this._lastPointerUpType === 'touch' || this._lastPointerUpType === 'pen') {
        ui?.Flash.show({
          duration: 2000,
          iconName: `#rapid-operation-${operation.id}`,
          iconClass: 'operation',
          label: operation.annotation() || operation.title
        });
      }

      operation();
      this.close();
    }
    this._lastPointerUpType = null;
  }


  /**
   * Called whenever the map moves so that the menu can be repostioned to match the map.
   */
  protected _updatePosition(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;

    if (!this._menu || this._menu.empty()) return;

    // close the menu if the zoom has changed
    // (this is because the menu will scale with the supersurface and look wrong)
    if (this._oldz !== viewport.transform.zoom) {
      this.close();
      return;
    }

    const anchor = viewport.project(this._anchorLoc, true);  // convert wgs84 [lon,lat] to screen [x,y]
    const surfaceRect = gfx.surface.getBoundingClientRect();

    // close the menu if it's gone offscreen
    if (anchor[0] < 0 || anchor[0] > surfaceRect.width || anchor[1] < 0 || anchor[1] > surfaceRect.height) {
      this.close();
      return;
    }

    const displayOnLeft = (surfaceRect: DOMRect): boolean => {
      const isRTL = l10n.isRTL;
      if (isRTL) {  // right to left
        if ((anchor[0] - MENU_SIDE_MARGIN - this._menuWidth) < VIEW_SIDE_MARGIN) {
          return false;  // left menu would be too close to the left viewport edge, go right
        } else {
          return true;   // prefer left menu
        }
      } else {  // left to right
        if ((anchor[0] + MENU_SIDE_MARGIN + this._menuWidth) > (surfaceRect.width - VIEW_SIDE_MARGIN)) {
          return true;   // right menu would be too close to the right viewport edge, go left
        } else {
          return false;  // prefer right menu
        }
      }
    };


    const tooltipPosition = (surfaceRect: DOMRect, menuLeft: boolean): string => {
      const isRTL = l10n.isRTL;
      if (isRTL) {  // right to left
        if (!menuLeft) {
          return 'right';
        }
        if ((anchor[0] - MENU_SIDE_MARGIN - this._menuWidth - TOOLTIP_WIDTH) < VIEW_SIDE_MARGIN) {
          // left tooltips would be too close to the left viewport edge, go right
          return 'right';
        }
        return 'left';

      } else {  // left to right
        if (menuLeft) {
          // if there's not room for a right-side menu then there definitely
          // isn't room for right-side tooltips
          return 'left';
        }
        if ((anchor[0] + MENU_SIDE_MARGIN + this._menuWidth + TOOLTIP_WIDTH) > (surfaceRect.width - VIEW_SIDE_MARGIN)) {
          // right tooltips would be too close to the right viewport edge, go left
          return 'left';
        }
        return 'right';
      }
    };

    const menuLeft = displayOnLeft(surfaceRect);
    const offset: Vec2 = [0, 0];

    offset[0] = menuLeft ? -1 * (MENU_SIDE_MARGIN + this._menuWidth) : MENU_SIDE_MARGIN;

    if (this._menuTop) {
      if (anchor[1] - this._menuHeight < VIEW_TOP_MARGIN) {
        // menu is near top viewport edge, shift downward
        offset[1] = -anchor[1] + VIEW_TOP_MARGIN;
      } else {
        offset[1] = -this._menuHeight;
      }
    } else {
      if (anchor[1] + this._menuHeight > (surfaceRect.height - VIEW_BOTTOM_MARGIN)) {
        // menu is near bottom viewport edge, shift upwards
        offset[1] = -anchor[1] - this._menuHeight + surfaceRect.height - VIEW_BOTTOM_MARGIN;
      } else {
        offset[1] = 0;
      }
    }

    const [left, top] = vecAdd(anchor, offset);
    this._menu
      .style('left', `${left}px`)
      .style('top', `${top}px`);

    const tooltipSide = tooltipPosition(surfaceRect, menuLeft);
    for (const tip of this._tooltips.values()) {
      tip.placement(tooltipSide);
      if (tip.isShown()) {
        tip.updateContent();  // refresh it
      }
    }
  }


  /**
   * This removes the menu and unbinds the event handlers
   */
  public close(): void {
    const context = this.context;
    const map = context.systems.map!;

    map.off('move', this._updatePosition);

    this._menu.remove();
    this._tooltips.clear();

    this.emit('toggled', false);
  }


  /**
   * Array [lon,lat] wgs84 coordinate where the menu should be anchored
   * @param val - the anchor location to set; omit to get the current value
   */
  public anchorLoc(val?: any): any {
    if (val === undefined) return this._anchorLoc;
    this._anchorLoc = val;
    return this;
  }


  /**
   * String  'touch', 'pen', or 'rightclick' that triggered the menu
   * @param val - the trigger type to set; omit to get the current value
   */
  public triggerType(val?: any): any {
    if (val === undefined) return this._triggerType;
    this._triggerType = val;
    return this;
  }


  /**
   * Array of operations requested to appear on the menu
   * Some operations may be skipped if we've detected pen/touch input
   * @param val - the operations to set; omit to get the current value
   */
  public operations(val?: Operation[]): any {
    if (val === undefined) return this._operations;
    this._operations = val;
    return this;
  }
}
