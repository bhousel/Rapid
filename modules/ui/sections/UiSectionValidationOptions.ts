import { AbstractUiSection } from '../AbstractUiSection.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

interface OptionItem {
  key: string;
  values: string[];
}

interface OptionValue {
  key: string;
  value: string;
}


export class UiSectionValidationOptions extends AbstractUiSection {
  public constructor(context: Context) {
    super(context, 'issues-options');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._updateOptionValue = this._updateOptionValue.bind(this);
  }


  /**
   * Renders the "what"/"where" issue filter option radios.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderContent($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    let $wrap: D3Selection = $selection.selectAll('.issues-options-container')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'issues-options-container')
      .merge($wrap);

    const data = [
      { key: 'what', values: ['edited', 'all'] },
      { key: 'where', values: ['visible', 'all'] }
    ];

    let $options: D3Selection = $wrap.selectAll('.issues-option')
      .data(data, (d: OptionItem) => d.key);

    const $$options = $options.enter()
      .append('div')
      .attr('class', (d: OptionItem) => `issues-option issues-option-${d.key}`);

    $$options
      .append('div')
      .attr('class', 'issues-option-title');

    const $$labels = $$options.selectAll('label')
      .data((d: OptionItem) => {
        return d.values.map((val: string) => ({ value: val, key: d.key }) );
      })
      .enter()
      .append('label');

    $$labels
      .append('input')
      .attr('type', 'radio')
      .attr('name', (d: OptionValue) => `issues-option-${d.key}`)
      .attr('value', (d: OptionValue) => d.value)
      .property('checked', (d: OptionValue) => this._getOptions()[d.key] === d.value)
      .on('change', (d3_event, d: OptionValue) => this._updateOptionValue(d3_event, d.key, d.value));

    $$labels
      .append('span');

    // update - set localized text on the update selection so it re-localizes on language change
    $options = $options.merge($$options);

    $options.selectAll('.issues-option-title')
      .text((d: OptionItem) => l10n.t(`issues.options.${d.key}.title`));

    $options.selectAll('label span')
      .text((d: OptionValue) => l10n.t(`issues.options.${d.key}.${d.value}`));
  }


  /**
   * Gets the current issue filter options ('what' and 'where').
   * @return the current option values
   */
  protected _getOptions(): Record<string, string> {
    const settings = this.context.systems.settings;
    return {
      what: settings?.get('validator.what') || 'edited',  // 'all', 'edited'
      where: settings?.get('validator.where') || 'all'    // 'all', 'visible'
    };
  }


  /**
   * Persists a changed option value and triggers revalidation.
   * @param d3_event - the triggering change event
   * @param d - the option key ('what' or 'where')
   * @param val - the new value (read from the event target if omitted)
   */
  protected _updateOptionValue(d3_event: Event, d: string, val?: string): void {
    const settings = this.context.systems.settings;
    const validator = this.context.systems.validator!;

    if (!val && d3_event && d3_event.target) {
      val = d3_event.target.value;
    }

    settings?.set(`validation.${d}`, val as string);

    // I think this is just to get the list to update?
    // Maybe we can have an `optionchanged` event to do this without interrupting the validator
    validator.validateAsync();
  }
}
