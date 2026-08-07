import { select, selection } from 'd3-selection';
import { uiCombobox } from './combobox.ts';
import { utilGetSetValue, utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiField } from './UiField.ts';


/**
 * Renders a list of shown fields, plus a "more fields" combobox for adding hidden ones.
 */
export class UiFormFields {
  public context: Context;
  public fieldsArr: UiField[];
  public state: string;
  public klass: string;

  // D3 selections
  public $parent: D3Selection | null;

  protected _moreCombo: any;
  protected _lastPlaceholder: string;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // D3 selections
    this.$parent = null;

    this.fieldsArr = [];
    this.state = '';
    this.klass = '';

    this._moreCombo = uiCombobox(context, 'more-fields').minItems(1);
    this._lastPlaceholder = '';

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;

    const allowedFields = this.fieldsArr.filter(uifield => uifield.isAllowed());
    const shown = allowedFields.filter(uifield => uifield.isShown());
    const notShown = allowedFields.filter(uifield => !uifield.isShown());

    let $container: D3Selection = $parent.selectAll('.form-fields-container')
      .data([0]);

    $container = $container.enter()
      .append('div')
      .attr('class', 'form-fields-container ' + (this.klass || ''))
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
        select(nodes[i]).call(d.render);
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

    let $more: D3Selection = $parent.selectAll('.more-fields')
      .data((this.state === 'hover' || moreFields.length === 0) ? [] : [0]);

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
      .call(this._moreCombo
        .data(moreFields)
        .on('accept', (d: any) => {
          if (!d) return;  // user entered something that was not matched
          const uifield = d.field;
          uifield.show();
          this.render();
          uifield.focus();
        })
      );

    // avoid updating placeholder excessively (triggers style recalc)
    if (this._lastPlaceholder !== placeholder) {
      $input.attr('placeholder', placeholder);
      this._lastPlaceholder = placeholder;
    }
  }

}
