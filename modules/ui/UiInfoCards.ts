import { selection } from 'd3-selection';
import { UiBackgroundCard } from './cards/UiBackgroundCard.ts';
import { UiHistoryCard } from './cards/UiHistoryCard.ts';
import { UiLocationCard } from './cards/UiLocationCard.ts';
import { UiMeasurementCard } from './cards/UiMeasurementCard.ts';
import { utilCmd } from '../util/cmd.ts';

import type { AbstractUiCard } from './cards/AbstractUiCard.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component acts as the container for the information cards.
 * "Cards" are user interface elements that can float on top of the map
 * and provide extra information about the map or the selection.
 */
export class UiInfoCards {
  public context: Context;

  // Child components
  public BackgroundCard: UiBackgroundCard;
  public HistoryCard: UiHistoryCard;
  public LocationCard: UiLocationCard;
  public MeasurementCard: UiMeasurementCard;
  public cards: AbstractUiCard[];

  // D3 selections
  public $parent: D3Selection | null;

  protected _wasVisible: Set<AbstractUiCard>;
  protected _keys: string | string[] | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._wasVisible = new Set();
    this._keys = null;

    // Create child components
    this.BackgroundCard = new UiBackgroundCard(context);
    this.HistoryCard = new UiHistoryCard(context);
    this.LocationCard = new UiLocationCard(context);
    this.MeasurementCard = new UiMeasurementCard(context);

    // Info Cards
    this.cards = [
      this.BackgroundCard,
      this.HistoryCard,
      this.LocationCard,
      this.MeasurementCard
    ];

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.toggle = this.toggle.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Setup event handlers..
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this._setupKeybinding);
    this._setupKeybinding();
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    // .info-cards container
    let $wrap: D3Selection = $parent.selectAll('.info-cards')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'info-cards');

    $wrap = $wrap.merge($$wrap) as D3Selection;

    for (const Card of this.cards) {
      $wrap.call(Card.render);
    }
  }


  /**
   * Toggles all info cards on/off
   * @param  e? - triggering event (if any)
   */
  public toggle(e?: Event): void {
    e?.preventDefault();

    // Which cards are currently visible?
    const currVisible = new Set<AbstractUiCard>();
    for (const Card of this.cards) {
      if (Card.visible) {
        currVisible.add(Card);
      }
    }

    // Some cards are shown - toggle them off
    if (currVisible.size) {
      this._wasVisible = currVisible;
      for (const Card of currVisible) {
        Card.hide(e);
      }

    // No cards are shown - toggle them on
    } else {
      if (!this._wasVisible.size) {
        this._wasVisible.add(this.MeasurementCard);  // at least 1 should be visible
      }
      for (const Card of this._wasVisible) {
        Card.show(e);
      }
    }

    this.render();
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    // Bind ⌘I to show/hide all cards
    this._keys = [utilCmd('⌘' + l10n.t('shortcuts.command.toggle_all_cards.key'))];
    context.keybinding().on(this._keys, this.toggle);
  }

}
