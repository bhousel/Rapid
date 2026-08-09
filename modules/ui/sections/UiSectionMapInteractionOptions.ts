import { AbstractUiSection } from './AbstractUiSection.ts';
import { UiTooltip } from '../UiTooltip.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


const MOUSE_WHEEL_OPTIONS = ['auto', 'zoom', 'pan'];


export class UiSectionMapInteractionOptions extends AbstractUiSection {


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'map_interaction');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawListItems = this._drawListItems.bind(this);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('preferences.map_interaction.title');
  }


  /**
   * Renders the mouse-wheel interaction options into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;

    let $options: D3Selection = $selection.selectAll('.mouse-wheel-options')
      .data([0]);

    // Enter
    const $$options = $options.enter()
      .append('div')
      .attr('class', 'mouse-wheel-options');

    $$options
      .append('div')
      .attr('class', 'mouse-wheel-title');

    $$options
      .append('ul')
      .attr('class', 'layer-list mouse-wheel-options-list');

    // Update
    $options = $options.merge($$options);

    // Set localized title on the update selection so it re-localizes on language change.
    $options.select('.mouse-wheel-title')
      .text(l10n.t('preferences.map_interaction.mouse_wheel.title'));

    $options.selectAll('.mouse-wheel-options-list')
      .call(this._drawListItems);
  }


  /**
   * Draws the radio-button list of mouse-wheel interaction modes.
   * @param $selection - d3-selection to the options `ul`
   */
  protected _drawListItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    const isActiveWheelOption = (d: string): boolean => {
      const curr = settings?.get('ui.mouseWheelInteraction') || 'auto';
      return curr === d;
    };

    let $items: D3Selection = $selection.selectAll('li')
      .data(MOUSE_WHEEL_OPTIONS);

    // Exit
    $items.exit()
      .remove();

    // Enter
    const $$items = $items.enter()
      .append('li')
      .call(new UiTooltip(context)
        .title((d: string) => l10n.t(`preferences.map_interaction.mouse_wheel.${d}.tooltip`))
        .placement('top')
        .attach
      );

    const $$label = $$items
      .append('label');

    $$label
      .append('input')
      .attr('type', 'radio')
      .attr('name', 'mouse_wheel')
      .on('change', (d3_event: Event, d: string) => {
        settings?.set('ui.mouseWheelInteraction', d);
        this.renderInner();
      });

    $$label
      .append('span')
      .text((d: string) => l10n.t(`preferences.map_interaction.mouse_wheel.${d}.title`));

    // Update
    $items = $items.merge($$items);

    $items
      .classed('active', isActiveWheelOption)
      .selectAll('input')
      .property('checked', isActiveWheelOption)
      .property('indeterminate', false);
  }
}
