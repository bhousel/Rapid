import { select } from 'd3-selection';
import { AbstractUiSection } from './AbstractUiSection.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiSectionGridDisplayOptions` renders options to draw a task grid over the map,
 * but only if `RapidSystem` was started with a rectangular task boundary.
 * This was an experiment that seems to be not used currently.
 */
export class UiSectionGridDisplayOptions extends AbstractUiSection {
  protected _taskWired: boolean;
  protected _$content: D3Selection;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'grid-display-options');

    this._taskWired = false;
    this._$content = select(null);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._renderGrid = this._renderGrid.bind(this);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('background.grid.grids');
  }


  /**
   * Renders the grid options into the disclosure body (only when the task is rectangular).
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const rapid = this.context.systems.rapid!;

    this._$content = $selection;

    // wire once to avoid leaking listeners
    if (!this._taskWired) {
      this._taskWired = true;
      rapid.on('taskchanged', () => {
        if (rapid.isTaskRectangular()) {
          select('.section-grid-display-options').classed('hide', false);
          this._renderGrid(this._$content);
        }
      });
    }

    if (!rapid.isTaskRectangular()) {
      select('.section-grid-display-options').classed('hide', true);
      return;
    }
  }


  /**
   * Draws the radio-button list of grid split options.
   * @param $selection - d3-selection to render the grid list into
   */
  protected _renderGrid($selection: D3Selection): void {
    const context = this.context;
    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;

    const gridData = [
      { numSplit: 0, name: l10n.t('background.grid.no_grid')},
      { numSplit: 2, name: l10n.t('background.grid.n_by_n', { num: 2 }) },
      { numSplit: 3, name: l10n.t('background.grid.n_by_n', { num: 3 }) },
      { numSplit: 4, name: l10n.t('background.grid.n_by_n', { num: 4 }) },
      { numSplit: 5, name: l10n.t('background.grid.n_by_n', { num: 5 }) },
      { numSplit: 6, name: l10n.t('background.grid.n_by_n', { num: 6 }) }
    ];

    const $container: D3Selection = $selection.selectAll('.layer-grid-list')
      .data([0]);

    const $gridList = $container.enter()
      .append('ul')
      .attr('class', 'layer-list layer-grid-list')
      .merge($container);

    const $gridItems = $gridList.selectAll('li')
      .data(gridData, (d: any) => d.name);

    const $$gridItems = $gridItems.enter()
      .insert('li', '.custom-gridsopt')
      .attr('class', 'gridsopt');

    const $$label = $$gridItems.append('label');

    $$label.append('input')
      .attr('type', 'radio')
      .attr('name', 'grids')
      .property('checked', (d: any) => d.numSplit === imagery.numGridSplits)
      .on('change', (d3_event: Event, d: any) => {
        d3_event.preventDefault();
        imagery.numGridSplits = d.numSplit;
      });

    $$label.append('span')
      .text((d: any) => d.name);

    $gridItems.exit()
      .remove();
  }
}
