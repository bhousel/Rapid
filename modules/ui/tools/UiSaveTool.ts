import { selection } from 'd3-selection';
import { interpolateRgb } from 'd3-interpolate';
import { uiIcon } from '../icon.ts';
import { UiTooltip } from '../UiTooltip.ts';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * A toolbar section for the save button
 */
export class UiSaveTool {
  public context: Context;
  public id: string;
  public stringID: string;
  public key: string;
  public Tooltip: UiTooltip;

  // D3 selections
  public $parent: D3Selection | null;

  protected _numChanges: number;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.id = 'save';
    this.stringID = 'text.save';
    this.key = utilCmd('⌘S');

    this._numChanges = 0;

    // Create child components
    this.Tooltip = new UiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);

    // Event listeners
    const editor = context.systems.editor!;
    context.on('modechange', this.render);
    editor.on('stablechange', this.render);
    context.keybinding().on(this.key, this.choose, true /* capture */);
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

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const numChanges = editor.difference().summary().size;

    this.Tooltip
      .placement('bottom')
      .scrollContainer(context.container().select('.map-toolbar'))
      .title(l10n.t(numChanges > 0 ? 'save.help' : 'save.no_changes'))
      .shortcut(this.key);

    // Button
    let $button: D3Selection = $parent.selectAll('button.save')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'save disabled bar-button')
      .on('click', this.choose)
      .call(this.Tooltip.attach)
      .call(uiIcon('#rapid-icon-save'));

    $$button
      .append('span')
      .attr('class', 'count')
      .attr('aria-hidden', 'true')
      .text('0');

    // update
    $button = $button.merge($$button);

    $button
      .classed('disabled', this.isDisabled())
      .style('background', this.bgColor(numChanges) as string);

    $button.selectAll('span.count')
      .text(numChanges);

    if (this.isSaving()) {
      $button.call(this.Tooltip.hide);
    }
  }


  /**
   * Is the user currently already saving?
   * @return  `true` if saving, `false` if not
   */
  public isSaving(): boolean {
    const context = this.context;
    return context.mode?.id === 'save';
  }


  /**
   * The button is disabled when there are no user changes to save
   * @return  `true` if disabled, `false` if enabled
   */
  public isDisabled(): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    return (context.inIntro || !editor.hasChanges() || this.isSaving());
  }


  /**
   * Chooses this item (usually because the user clicked on its button).
   * @param [e] - the triggering event, if any
   */
  public choose(e?: Event): void {
    e?.preventDefault();
    if (this.isDisabled()) return;

    //  // consider: there are no tooltips for touch interactions so flash feedback instead
    // if (isDisabled) {
    //   context.systems.ui.Flash
    //     .duration(2000)
    //     .iconName('#rapid-icon-save')
    //     .iconClass('disabled')
    //     .label(l10n.t('save.no_changes'))();
    // }
    // lastPointerUpType = null;

    this.context.enter('save');
  }


  /**
   * Choose a background color that gets increasingly red to remind the use to save.
   * @param   numChanges - the number of pending changes
   * @return  a CSS color string, or `null` when there are no changes
   */
  public bgColor(numChanges: number): string | null {
    let step;
    if (numChanges === 0) {
      return null;
    } else if (numChanges <= 50) {
      step = numChanges / 50;
      return interpolateRgb('#fff', '#ff8')(step);  // white -> yellow
    } else {
      step = Math.min((numChanges - 50) / 50, 1.0);
      return interpolateRgb('#ff8', '#f88')(step);  // yellow -> red
    }
  }

}
