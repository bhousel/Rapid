import { AbstractUiSection } from './AbstractUiSection.ts';

import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


interface OptionField {
  key: 'what' | 'where';
  values: string[];
}

interface OptionValue {
  key: 'what' | 'where';
  value: string;
}


export class UiSectionValidationOptions extends AbstractUiSection {

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'issues-options');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._isChecked = this._isChecked.bind(this);
    this._setOptionValue = this._setOptionValue.bind(this);
  }


  /**
   * Renders the "what" / "where" issue filter option radios.
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

    const fields: OptionField[] = [
      { key: 'what', values: ['edited', 'all'] },
      { key: 'where', values: ['visible', 'all'] }
    ];

    let $options: D3Selection = $wrap.selectAll('.issues-option')
      .data(fields, (d: OptionField) => d.key);

    const $$options: D3EnterSelection = $options.enter()
      .append('div')
      .attr('class', (d: OptionField) => `issues-option issues-option-${d.key}`);

    $$options
      .append('div')
      .attr('class', 'issues-option-title');

    const $$labels: D3EnterSelection = $$options.selectAll('label')
      .data((d: OptionField) => d.values.map((val: string) => ({ key: d.key, value: val })))
      .enter()
      .append('label');

    $$labels
      .append('input')
      .attr('type', 'radio')
      .attr('name', (d: OptionValue) => `issues-option-${d.key}`)
      .attr('value', (d: OptionValue) => d.value)
      .property('checked', this._isChecked)
      .on('change', this._setOptionValue);

    $$labels
      .append('span');

    // update - set localized text on the update selection so it re-localizes on language change
    $options = $options.merge($$options);

    $options.selectAll('.issues-option-title')
      .text((d: OptionField) => l10n.t(`issues.options.${d.key}.title`));

    $options.selectAll('label span')
      .text((d: OptionValue) => l10n.t(`issues.options.${d.key}.${d.value}`));
  }


  /**
   * Returns true if the given option key/value is the selected one.
   * The current validation options are persisted in the SettingsSystem.
   * @param  The OptionValue (key/value) being tested
   * @return `true` if selected, `false` if not
   */
  protected _isChecked(d: OptionValue): boolean {
    const settings = this.context.systems.settings;

    const whatVal = settings?.get('validator.what') || 'edited';   // 'all', 'edited'
    const whereVal = settings?.get('validator.where') || 'all';    // 'all', 'visible'

    return (d.key === 'what') ? d.value === whatVal
      : (d.key === 'where') ? d.value === whereVal
      : false;
  }


  /**
   * Persists the chosen option value in the SettingsSystem.
   * @param e - Triggering change event
   * @param d - The OptionValue (key/value) chosen
   */
  protected _setOptionValue(e: Event, d: OptionValue): void {
    const settings = this.context.systems.settings;

    const val = (e.target as HTMLInputElement).value;
    settings?.set(`validator.${d.key}`, val);
  }
}
