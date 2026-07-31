import { AbstractUiSection } from '../AbstractUiSection.js';
import { uiTooltip } from '../tooltip.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiSectionMapFeatures extends AbstractUiSection {
  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'filters');

    const filters = context.systems.filters!;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawListItems = this._drawListItems.bind(this);

    filters.on('filterchange', this.reRender);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('filters.title');
  }


  /**
   * Renders the feature filter list into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;

    let $container: D3Selection = $selection.selectAll('.layer-feature-list-container')
      .data([0]);

    const $$container = $container.enter()
      .append('div')
      .attr('class', 'layer-feature-list-container');

    $$container
      .append('ul')
      .attr('class', 'layer-list layer-feature-list');

    const $$footer = $$container
      .append('div')
      .attr('class', 'feature-list-links section-footer');

    $$footer
      .append('a')
      .attr('class', 'feature-list-link disable-all')
      .attr('href', '#')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        filters.disableAll();
      });

    $$footer
      .append('a')
      .attr('class', 'feature-list-link enable-all')
      .attr('href', '#')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        filters.enableAll();
      });

    // Update
    $container = $container
      .merge($$container);

    // Set localized link text on the update selection so it re-localizes on language change.
    $container.select('.feature-list-link.disable-all')
      .text(l10n.t('issues.disable_all'));
    $container.select('.feature-list-link.enable-all')
      .text(l10n.t('issues.enable_all'));

    $container.selectAll('.layer-feature-list')
      .call(this._drawListItems);
  }


  /**
   * Draws the list of toggleable map feature filters.
   * @param $selection - d3-selection to the feature list `ul`
   */
  protected _drawListItems($selection: D3Selection): void {
    const context = this.context;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;

    const showsFeature = (d: string): boolean => filters.isEnabled(d);

    let $items: D3Selection = $selection.selectAll('li')
      .data(filters.keys);

    // Exit
    $items.exit()
      .remove();

    // Enter
    const $$enter = $items.enter()
      .append('li')
      .call((uiTooltip(context) as any)
        .title((d: string) => l10n.t(`filters.${d}.tooltip`))
        .placement('top')
      );

    const $$label = $$enter
      .append('label');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .attr('name', 'feature')
      .on('change', (d3_event: Event, d: string) => filters.toggle(d));

    $$label
      .append('span')
      .text((d: string) => l10n.t(`filters.${d}.description`));

    // Update
    $items = $items
      .merge($$enter);

    $items
      .classed('active', showsFeature)
      .selectAll('input')
      .property('checked', showsFeature);
  }
}
