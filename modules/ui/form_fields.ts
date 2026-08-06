import { select as d3_select } from 'd3-selection';
import { uiCombobox } from './combobox.ts';
import { utilGetSetValue, utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiField } from './UiField.ts';


/** A form-fields control (callable + fluent), renders a set of fields into a selection. */
export interface UiFormFields {
  ($selection: D3Selection): void;
  fieldsArr(): UiField[];
  fieldsArr(val: UiField[]): UiFormFields;
  state(): string;
  state(val: string): UiFormFields;
  klass(): string;
  klass(val: string): UiFormFields;
}


/**
 * Renders a list of shown fields, plus a "more fields" combobox for adding hidden ones.
 * Configure with the fluent methods, then render via `$selection.call(formFields)`.
 *
 * @param context - Global shared application context
 * @return the form-fields control
 */
export function uiFormFields(context: Context): UiFormFields {
  const l10n = context.systems.l10n!;
  const moreCombo = uiCombobox(context, 'more-fields').minItems(1);
  let _uifields: UiField[] = [];
  let _lastPlaceholder = '';
  let _state = '';
  let _klass = '';


  const formFields = function($selection: D3Selection): void {
    const allowedFields = _uifields.filter(uifield => uifield.isAllowed());
    const shown = allowedFields.filter(uifield => uifield.isShown());
    const notShown = allowedFields.filter(uifield => !uifield.isShown());

    let $container: D3Selection = $selection.selectAll('.form-fields-container')
      .data([0]);

    $container = $container.enter()
      .append('div')
      .attr('class', 'form-fields-container ' + (_klass || ''))
      .merge($container);


    let $fields: D3Selection = $container.selectAll('.wrap-form-field')
      .data(shown, (d: UiField) => (d.id + (d.entityIDs ? d.entityIDs.join() : '')));

    $fields.exit()
      .remove();

    // Enter
    const $$fields = $fields.enter()
      .append('div')
      .attr('class', (d: UiField) => `wrap-form-field wrap-form-field-${d.safeid}`);

    // Update
    $fields = $fields
      .merge($$fields);

    $fields
      .order()
      .each((d: UiField, i, nodes) => {
        d3_select(nodes[i]).call(d.render);
      });


    const labels: string[] = [];
    const moreFields = notShown.map(uifield => {
      const label = uifield.label;
      labels.push(label);

      let terms = uifield.terms;
      if (uifield.key)  terms.push(uifield.key);
      if (uifield.keys) terms = terms.concat(uifield.keys);

      return {
        display: uifield.label,
        value: label,
        title: label,
        field: uifield,
        terms: terms
      };
    });


    const placeholder = labels.slice(0, 3).join(', ') + ((labels.length > 3) ? '…' : '');

    let $more: D3Selection = $selection.selectAll('.more-fields')
      .data((_state === 'hover' || moreFields.length === 0) ? [] : [0]);

    $more.exit()
      .remove();

    const $$more = $more.enter()
      .append('div')
      .attr('class', 'more-fields')
      .append('label');

    $$more
      .append('span')
      .text(l10n.t('inspector.add_fields'));

    $more = $more
      .merge($$more);


    let $input: D3Selection = $more.selectAll('.value')
      .data([0]);

    $input.exit()
      .remove();

    $input = $input.enter()
      .append('input')
      .attr('class', 'value')
      .attr('type', 'text')
      .attr('placeholder', placeholder)
      .call(utilNoAuto)
      .merge($input);

    $input
      .call(utilGetSetValue, '')
      .call(moreCombo
        .data(moreFields)
        .on('accept', (d: any) => {
          if (!d) return;  // user entered something that was not matched
          const uifield = d.field;
          uifield.show();
          $selection.call(formFields);  // rerender
          uifield.focus();
        })
      );

    // avoid updating placeholder excessively (triggers style recalc)
    if (_lastPlaceholder !== placeholder) {
      $input.attr('placeholder', placeholder);
      _lastPlaceholder = placeholder;
    }
  } as UiFormFields;


  formFields.fieldsArr = function(val?: UiField[]): any {
    if (!arguments.length) return _uifields;
    _uifields = val || [];
    return formFields;
  };

  formFields.state = function(val?: string): any {
    if (!arguments.length) return _state;
    _state = val as string;
    return formFields;
  };

  formFields.klass = function(val?: string): any {
    if (!arguments.length) return _klass;
    _klass = val as string;
    return formFields;
  };


  return formFields;
}
