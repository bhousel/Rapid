import { select as d3_select } from 'd3-selection';
import { geoMetersToOffset, geoOffsetToMeters } from '@rapid-sdk/math';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiIcon } from '../icon.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';


const DIRECTIONS: [string, Vec2][] = [
  ['top', [0, -0.5]],
  ['left', [-0.5, 0]],
  ['right', [0.5, 0]],
  ['bottom', [0, 0.5]]
];


export class UiSectionBackgroundOffset extends AbstractUiSection {
  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'background-offset');

    const imagery = context.systems.imagery!;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._updateValue = this._updateValue.bind(this);
    this._inputOffset = this._inputOffset.bind(this);
    this._pointerdown = this._pointerdown.bind(this);

    imagery.on('imagerychange', this._updateValue);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('background.fix_misalignment');
  }


  /**
   * Reads the current imagery offset and reflects it in the input field and reset button.
   */
  protected _updateValue(): void {
    const context = this.context;
    const imagery = context.systems.imagery!;

    const meters = geoOffsetToMeters(imagery.offset);
    const x = +meters[0].toFixed(2);
    const y = +meters[1].toFixed(2);

    context.container().selectAll('.nudge-inner-rect')
      .select('input')
      .classed('error', false)
      .property('value', `${x},${y}`);

    context.container().selectAll('.nudge-reset')
      .classed('disabled', (x === 0 && y === 0));
  }


  /**
   * Resets the imagery offset back to zero.
   */
  protected _resetOffset(): void {
    const imagery = this.context.systems.imagery!;
    imagery.offset = [0, 0];
    this._updateValue();
  }


  /**
   * Nudges the imagery offset by the given direction vector.
   * @param d - direction vector to nudge by
   */
  protected _nudge(d: Vec2): void {
    const imagery = this.context.systems.imagery!;
    imagery.nudge(d);
    this._updateValue();
  }


  /**
   * Handles manual entry of an offset in the input field.
   * @param d3_event - the input change event
   */
  protected _inputOffset(d3_event: Event): void {
    const imagery = this.context.systems.imagery!;

    const $input = d3_select(d3_event.target as any);
    let val: any = ($input.node() as HTMLInputElement).value;

    if (val === '') return this._resetOffset();

    val = val.replace(/;/g, ',').split(',').map((n: any) => {
      // if n is NaN, it will always get mapped to false.
      return !isNaN(n) && n;
    });

    if (val.length !== 2 || !val[0] || !val[1]) {
      $input.classed('error', true);
      return;
    }

    imagery.offset = geoMetersToOffset(val);
    this._updateValue();
  }


  /**
   * Begins a drag-to-nudge gesture on the outer rect.
   * @param d3_event - the pointerdown event
   */
  protected _pointerdown(d3_event: PointerEvent): void {
    const context = this.context;

    if (d3_event.button !== 0) return;
    const input = context.container().selectAll('.nudge-inner-rect > input').node();
    if (d3_event.target === input) return;   // we are dragging in the input field, not the outer rect

    let origin: Vec2 = [d3_event.clientX, d3_event.clientY];
    const pointerId = d3_event.pointerId || 'mouse';

    context.container()
      .append('div')
      .attr('class', 'nudge-surface');

    const pointermove = (d3_event: PointerEvent): void => {
      if (pointerId !== (d3_event.pointerId || 'mouse')) return;

      const latest: Vec2 = [d3_event.clientX, d3_event.clientY];
      const delta: Vec2 = [
        -(origin[0] - latest[0]) / 4,
        -(origin[1] - latest[1]) / 4
      ];

      origin = latest;
      this._nudge(delta);
    };

    const pointerup = (d3_event: PointerEvent): void => {
      if (pointerId !== (d3_event.pointerId || 'mouse')) return;
      if (d3_event.button !== 0) return;

      context.container().selectAll('.nudge-surface')
        .remove();

      d3_select(window)
        .on('.drag-bg-offset', null);
    };

    d3_select(window)
      .on('pointermove.drag-bg-offset', pointermove)
      .on('pointerup.drag-bg-offset', pointerup)
      .on('pointercancel.drag-bg-offset', pointerup);
  }


  /**
   * Renders the nudge controls into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;

    let $container: D3Selection = $selection.selectAll('.nudge-container')
      .data([0]);

    const $$container = $container.enter()
      .append('div')
      .attr('class', 'nudge-container');

    $$container
      .append('div')
      .attr('class', 'nudge-instructions');

    const $$nudgeWrap = $$container
      .append('div')
      .attr('class', 'nudge-controls-wrap');

    const $$nudge = $$nudgeWrap
      .append('div')
      .attr('class', 'nudge-outer-rect')
      .on('pointerdown', this._pointerdown);

    $$nudge
      .append('div')
      .attr('class', 'nudge-inner-rect')
      .append('input')
      .attr('type', 'text')
      .on('change', this._inputOffset);

    $$nudgeWrap
      .append('div')
      .selectAll('button')
      .data(DIRECTIONS).enter()
      .append('button')
      .attr('class', (d: any) => `${d[0]} nudge`)
      .attr('tabindex', -1)
      .on('click', (d3_event: Event, d: any) => this._nudge(d[1]));

    $$nudgeWrap
      .append('button')
      .attr('class', 'nudge-reset disabled')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        this._resetOffset();
      })
      .call(uiIcon('#rapid-icon-' + (l10n.isRTL ? 'redo' : 'undo')));

    // update
    $container = $container.merge($$container);

    // Set localized text/title on the update selection so they re-localize on language change.
    $container.select('.nudge-instructions')
      .text(l10n.t('background.offset'));
    $container.select('.nudge-reset')
      .attr('title', l10n.t('background.reset'));

    this._updateValue();
  }
}
