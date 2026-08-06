import { select, selection } from 'd3-selection';
import { uiCombobox } from '../combobox.js';
import { UiField } from '../UiField.js';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.js';


function stripcolon(s: string): string {
  return s.replace(':', '');
}


/**
 * This UI component displays a cycleway field.
 * This includes subfields for `cycleway:left` and `cycleway:right` and `cycleway:both` values.
 */
export class UiFieldCycleway extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $items: D3Selection | null;
  public $wrap: D3Selection | null;

  protected _tags: Tags;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    // D3 selections
    this.$parent = null;
    this.$items = null;
    this.$wrap = null;

    this._tags = {};

    this.renderContent = this.renderContent.bind(this);
    this._change = this._change.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderContent($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;
    const getOptions = (): { title: string; value: string }[] => this._fieldOptions();

    this.$wrap = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    this.$wrap = this.$wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge(this.$wrap);


    let $div: D3Selection = this.$wrap.selectAll('ul')
      .data([0]);

    $div = $div.enter()
      .append('ul')
      .attr('class', 'rows rows-table')
      .merge($div);

    const keys = ['cycleway:left', 'cycleway:right'];

    this.$items = $div.selectAll('li')
      .data(keys);

    const $$items = this.$items.enter()
      .append('li')
      .attr('class', d => 'labeled-input preset-cycleway-' + stripcolon(d));

    const stringBase = `_tagging.presets.fields.${this.id}.types`;
    $$items
      .append('div')
      .attr('class', 'label preset-label-cycleway')
      .attr('for', d => 'preset-input-cycleway-' + stripcolon(d));

    $$items
      .append('div')
      .attr('class', 'preset-input-cycleway-wrap')
      .append('input')
      .attr('type', 'text')
      .attr('class', d => 'preset-input-cycleway preset-input-' + stripcolon(d))
      .call(utilNoAuto)
      .each(function (this: HTMLInputElement, d) {
        select(this)
          .call(uiCombobox(context, 'cycleway-' + stripcolon(d))
            .data(getOptions())
          );
      });

    this.$items = this.$items.merge($$items);

    // Set localized text on the update selection so it re-localizes on language change.
    this.$items.selectAll('.preset-label-cycleway')
      .html(d => l10n.tHtml(`${stringBase}.${d}`));

    // Update
    this.$wrap.selectAll('.preset-input-cycleway')
      .on('change', this._change)
      .on('blur', this._change);
  }


  /**
   * Handles a change to one of the cycleway inputs and dispatches the tag change.
   * @param d3_event - The triggering DOM event
   * @param key - The cycleway key being changed ('cycleway:left' or 'cycleway:right')
   */
  protected _change(d3_event: Event, key: string): void {
    const context = this.context;

    let newValue: string | undefined = context.cleanTagValue(utilGetSetValue(select(d3_event.currentTarget as HTMLInputElement)) as string);

    // don't override multiple values with blank string
    if (!newValue && (Array.isArray(this._tags.cycleway) || Array.isArray(this._tags[key]))) return;

    if (newValue === 'none' || newValue === '') { newValue = undefined; }

    const otherKey = key === 'cycleway:left' ? 'cycleway:right' : 'cycleway:left';
    let otherValue: string | string[] | undefined = typeof this._tags.cycleway === 'string' ? this._tags.cycleway : this._tags[otherKey];
    if (otherValue && Array.isArray(otherValue)) {
      // we must always have an explicit value for comparison
      otherValue = otherValue[0];
    }
    if (otherValue === 'none' || otherValue === '') { otherValue = undefined; }

    let tag: Tags;

    // If the left and right tags match, use the cycleway tag to tag both
    // sides the same way
    if (newValue === otherValue) {
      tag = {
        cycleway: newValue,
        'cycleway:left': undefined,
        'cycleway:right': undefined
      };
    } else {
      // Always set both left and right as changing one can affect the other
      tag = {
        cycleway: undefined
      };
      tag[key] = newValue;
      tag[otherKey] = otherValue;
    }

    this.emit('change', tag);
  }


  /** Returns the selectable options for this field. */
  public _fieldOptions(): { title: string; value: string }[] {
    const l10n = this.context.systems.l10n!;

    const stringBase = `_tagging.presets.fields.${this.id}.options.`;
    const opts = this.presetField.props.options;
    return opts.map(function (option: string) {
      return {
        title: l10n.t(`${stringBase}.${option}.description`),
        value: option
      };
    });
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$items) return;   // called too early?

    const l10n = this.context.systems.l10n!;
    const placeholder = this.placeholder;

    this._tags = tags;

    // If cycleway is set, use that instead of individual values
    const commonValue = typeof tags.cycleway === 'string' && tags.cycleway;

    (utilGetSetValue(this.$items.selectAll('.preset-input-cycleway'), function (d: string) {
      if (commonValue) return commonValue;
      return !tags.cycleway && typeof tags[d] === 'string' ? tags[d] : '';
    }) as D3Selection)
      .attr('title', function (d: string) {
        if (Array.isArray(tags.cycleway) || Array.isArray(tags[d])) {
          let vals: (string | undefined)[] = [];
          if (Array.isArray(tags.cycleway)) {
            vals = vals.concat(tags.cycleway);
          }
          if (Array.isArray(tags[d])) {
            vals = vals.concat(tags[d] as string[]);
          }
          return vals.filter(Boolean).join('\n');
        }
        return null;
      })
      .attr('placeholder', function (d: string) {
        if (Array.isArray(tags.cycleway) || Array.isArray(tags[d])) {
          return l10n.t('inspector.multiple_values');
        }
        return placeholder;
      })
      .classed('mixed', function (d: string) {
        return Array.isArray(tags.cycleway) || Array.isArray(tags[d]);
      });
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$wrap) return;   // called too early?

    const node = this.$wrap.selectAll('input').node() as HTMLElement | null;
    node?.focus();
  }
}
