import { EventEmitter } from 'tseep/lib/ee-safe';
import { select, selection } from 'd3-selection';
import { vecAdd } from '@rapid-sdk/math';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { MapRouletteTask } from '../services/MapRouletteService.ts';
import type { Vec2 } from '@rapid-sdk/math';


// Constants for layout and positioning
const VIEW_TOP_MARGIN = 85;
const VIEW_BOTTOM_MARGIN = 45;
const VIEW_SIDE_MARGIN = 35;
const MENU_SIDE_MARGIN = 10;
const VERTICAL_PADDING = 4;


/**
 * `UiMapRouletteMenu` renders the right-click action menu for a MapRoulette task.
 * (Fixed / Can't Complete / Already Fixed / Not an Issue). Set `datum`, `anchorLoc`, and
 * `triggerType`, then call `.render($selection)`. Emits `toggled` and `change`.
 */
export class UiMapRouletteMenu extends EventEmitter {
  public context: Context;

  public datum: MapRouletteTask | null;
  public anchorLoc: Vec2;
  public triggerType: string;

  // D3 selections
  public $parent: D3Selection | null;
  public $menu: D3Selection | null;

  protected _oldz: number;
  protected _menuTop: boolean;
  protected _menuHeight: number;
  protected _menuWidth: number;
  protected _mapRouletteApiKey: string | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this.datum = null;
    this.anchorLoc = [0, 0];
    this.triggerType = '';

    // D3 selections
    this.$parent = null;
    this.$menu = null;

    this._oldz = 0;
    this._menuTop = false;
    this._menuHeight = 0;
    this._menuWidth = 0;
    this._mapRouletteApiKey = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this.close = this.close.bind(this);
    this._updatePosition = this._updatePosition.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;

    if (this.triggerType === undefined) {
      this.triggerType = 'rightclick';
    }

    const isTouchMenu = this.triggerType.includes('touch') || this.triggerType.includes('pen');
    this._menuTop = isTouchMenu;

    const showLabels = true;
    const actionTitles = [
      l10n.t('map_data.layers.maproulette.fixed'),
      l10n.t('map_data.layers.maproulette.cantComplete'),
      l10n.t('map_data.layers.maproulette.alreadyFixed'),
      l10n.t('map_data.layers.maproulette.notAnIssue')
    ];
    const buttonHeight = showLabels ? 32 : 34;
    this._menuWidth = showLabels ? 52 + Math.min(120, 6 * Math.max(...actionTitles.map(title => title.length))) : 44;
    this._menuHeight = VERTICAL_PADDING * 2 + 4 * buttonHeight; // 4 actions
    this._oldz = viewport.transform.zoom;

    this.$menu = $parent.selectAll('.maproulette-menu')
      .data([0]);

    const $$menu: D3EnterSelection = this.$menu.enter()
      .append('div')
      .attr('class', 'maproulette-menu')
      .style('padding', VERTICAL_PADDING + 'px 0');

    this.$menu = this.$menu
      .merge($$menu);

    const $buttons: D3Selection = this.$menu.selectAll('.maproulette-menu-item')
      .data(['fixed', 'cantComplete', 'alreadyFixed', 'notAnIssue']);

    const $$buttons: D3EnterSelection = $buttons.enter()
      .append('button')
      .attr('class', (d: string) => `maproulette-menu-item maproulette-menu-item-${d}`)
      .style('height', `${buttonHeight}px`)
      .on('click', (e: PointerEvent, actionId: string) => {
        if (!this._mapRouletteApiKey) {
          this._getApiKey((err: any, apiKey?: string) => {
            if (err) {
              console.error('Error retrieving MapRoulette API key:', err); // eslint-disable-line no-console
              return;
            }
            this._mapRouletteApiKey = apiKey ?? null;
            this._executeAction(actionId, e);
          });
        } else {
          this._executeAction(actionId, e);
        }
        this.close();
      });

    $$buttons.append('div')
      .attr('class', 'icon-wrap')
      .call(uiIcon('', 'operation'));

    $$buttons.append('span')
      .attr('class', 'label')
      .text((actionId: string) => l10n.t(`map_data.layers.maproulette.${actionId}`));

    this._updatePosition();

    // When creating the menu only, `$$wrap` will have something in it.
    if ($$menu.size()) {
      gfx.on('move', this._updatePosition);
      this.emit('toggled', true);
    }
  }


  /** Executes the specified action based on the user's selection. */
  protected _executeAction(actionId: string, e: Event): void {
    switch (actionId) {
      case 'fixed':
        this._fixedIt(e, this.datum!);
        break;
      case 'cantComplete':
        this._cantComplete(e, this.datum!);
        break;
      case 'alreadyFixed':
        this._alreadyFixed(e, this.datum!);
        break;
      case 'notAnIssue':
        this._notAnIssue(e, this.datum!);
        break;
    }
  }


  /** Updates the position of the menu based on the viewport and anchor location. */
  protected _updatePosition(): void {
    if (!this.$menu || this.$menu.empty()) return;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;

    if (this._oldz !== viewport.transform.zoom) {
      this.close();
      return;
    }

    const anchor = viewport.project(this.anchorLoc, true);
    const surfaceRect = gfx.surface.getBoundingClientRect();

    if (anchor[0] < 0 || anchor[0] > surfaceRect.width || anchor[1] < 0 || anchor[1] > surfaceRect.height) {
      this.close();
      return;
    }

    // Determines whether the menu should be displayed on the left or right.
    const displayOnLeft = (): boolean => {
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

    const menuLeft = displayOnLeft();
    const offset: Vec2 = [0, 0];

    offset[0] = menuLeft ? -1 * (MENU_SIDE_MARGIN + this._menuWidth) : MENU_SIDE_MARGIN;

    if (this._menuTop) {
      if (anchor[1] - this._menuHeight < VIEW_TOP_MARGIN) {
        offset[1] = -anchor[1] + VIEW_TOP_MARGIN;
      } else {
        offset[1] = -this._menuHeight;
      }
    } else {
      if (anchor[1] + this._menuHeight > (surfaceRect.height - VIEW_BOTTOM_MARGIN)) {
        offset[1] = -anchor[1] - this._menuHeight + surfaceRect.height - VIEW_BOTTOM_MARGIN;
      } else {
        offset[1] = 0;
      }
    }

    const [left, top] = vecAdd(anchor, offset);
    this.$menu
      .style('left', `${left}px`)
      .style('top', `${top}px`);
  }


  protected _fixedIt(e: Event, d: MapRouletteTask): void {
    d.props._status = 1;
    this._submitTask(e, d);
  }

  protected _cantComplete(e: Event, d: MapRouletteTask): void {
    d.props._status = 6;
    this._submitTask(e, d);
  }

  protected _alreadyFixed(e: Event, d: MapRouletteTask): void {
    d.props._status = 5;
    this._submitTask(e, d);
  }

  protected _notAnIssue(e: Event, d: MapRouletteTask): void {
    d.props._status = 2;
    this._submitTask(e, d);
  }


  /** Submits the task to MapRoulette with the updated status. */
  protected _submitTask(e: Event, d: MapRouletteTask): void {
    const context = this.context;
    const maproulette = context.services.maproulette!;
    const osm = context.services.osm!;

    if (!d) {
      console.error('No task to submit'); // eslint-disable-line no-console
      return;
    }

    const userID = (osm as any)._userDetails.id;

    if (maproulette) {
      const props = d.props as any;
      props.taskStatus = props._status;
      props.mapRouletteApiKey = this._mapRouletteApiKey;

      const $commentInput = select('.new-comment-input');
      if ($commentInput.empty()) {
        d.props.comment = '';
      } else {
        d.props.comment = ($commentInput.property('value') as string).trim();
      }

      d.props.taskId = d.props.id;
      d.props.userId = userID;
      maproulette.postUpdate(d, (err: any, item: any) => {
        if (err) {
          console.error(err);  // eslint-disable-line no-console
          return;
        }
        this.emit('change', item);
        if (maproulette.nearbyTaskEnabled) {
          maproulette.flyToNearbyTask(d);
        }
      });
    }
  }


  /** Retrieves the MapRoulette API key from the user's preferences. */
  protected _getApiKey(callback: (err: unknown, apiKey?: string) => void): void {
    const osm = this.context.services.osm!;
    (osm as any).loadMapRouletteKey((err: any, preferences: any) => {
      if (typeof callback === 'function') {
        if (err) {
          callback(err);
        } else {
          callback(null, preferences.maproulette_apikey_v2);
        }
      }
    });
  }


  /** Closes the MapRoulette menu and cleans up event listeners. */
  public close(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;

    gfx.off('move', this._updatePosition);

    this.$menu?.remove();
    this.$menu = null;

    this.emit('toggled', false);

    (context.systems.ui as any)._showsMapRouletteMenu = false; // Reset state
  }
}
