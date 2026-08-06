import { select as d3_select } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { uiTooltip } from './tooltip.ts';

import type { AbstractUiSection } from './sections/AbstractUiSection.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiPane` is the base class for the map panes (Background, Map Data, Issues,
 * Preferences, Help) shown in slide-out drawers. Subclasses set `key`, `label`,
 * `description`, `iconName`, and `sections` in their constructor. A pane renders a
 * toggle button (into the map controls) and its content panel (into the map panes).
 */
export class UiPane {
  public context: Context;
  public id: string;
  public key: string;
  public label: string;
  public description: string;
  public iconName: string;
  public sections: AbstractUiSection[];

  // D3 selections
  public $pane: D3Selection;

  protected _paneTooltip: any;


  /**
   * @param  context - Global shared application context
   * @param  id  - the identifier for the pane
   */
  public constructor(context: Context, id: string) {
    this.context = context;
    this.id = id;
    this.key = '';
    this.label = '';
    this.description = '';
    this.iconName = '';
    this.sections = [];

    this.$pane = d3_select(null);
    this._paneTooltip = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.renderPane = this.renderPane.bind(this);
    this.renderToggleButton = this.renderToggleButton.bind(this);
    this.renderContent = this.renderContent.bind(this);
    this.togglePane = this.togglePane.bind(this);
  }


  /**
   * Hides this pane (via the UiSystem, if present).
   */
  protected _hidePane(): void {
    this.context.systems.ui?.togglePanes();
  }


  /**
   * Toggles this pane open/closed, rerendering its content when shown.
   * @param d3_event - triggering event (if any)
   */
  public togglePane(d3_event?: Event): void {
    const ui = this.context.systems.ui;

    if (d3_event) d3_event.preventDefault();
    this._paneTooltip?.hide();

    const show = !this.$pane.classed('shown');
    ui?.togglePanes(show ? this.$pane : undefined);

    // We are showing the pane, rerender its content
    if (show) {
      this.$pane.selectAll('.pane-content')
        .call(this.renderContent);
    }
  }


  /**
   * Renders this pane's toggle button (with tooltip) into the given selection.
   * @param $selection - A d3-selection to a HTMLElement to render the toggle button into
   */
  public renderToggleButton($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    if (!this._paneTooltip) {
      const isRTL = l10n.isRTL;
      this._paneTooltip = (uiTooltip(context) as any)
        .placement(isRTL ? 'right' : 'left')
        .title(this.description)
        .shortcut(this.key);
    }

    const $control = $selection
      .append('div')
      .attr('class', `map-control map-pane-control ${this.id}-control`);

    $control
      .append('button')
      .on('click', this.togglePane)
      .call(uiIcon(`#${this.iconName}`, 'light'))
      .call(this._paneTooltip);
  }


  /**
   * Renders this pane's content (its sections) into the given selection.
   * Subclasses may override to fully customize the content.
   * @param $selection - A d3-selection to a HTMLElement to render the content into
   */
  public renderContent($selection: D3Selection): void {
    // override to fully customize content
    for (const section of this.sections) {
      $selection.call(section.render);
    }
  }


  /**
   * Renders this pane's drawer (heading + content) into the given selection.
   * @param $selection - A d3-selection to a HTMLElement to render the pane into
   */
  public renderPane($selection: D3Selection): void {
    const context = this.context;

    this.$pane = $selection
      .append('div')
      .attr('class', `fillL map-pane hide ${this.id}-pane`)
      .attr('pane', this.id);

    const $heading = this.$pane
      .append('div')
      .attr('class', 'pane-heading');

    $heading
      .append('h2')
      .text(this.label);

    $heading
      .append('button')
      .on('click', () => this._hidePane())
      .call(uiIcon('#rapid-icon-close'));

    this.$pane
      .append('div')
      .attr('class', 'pane-content')
      .call(this.renderContent);

    if (this.key) {
      context.keybinding().off(this.key);
      context.keybinding().on(this.key, this.togglePane);
    }
  }
}
