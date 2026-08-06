import { selection } from 'd3-selection';
import { roadSpeedUnit } from '@rapideditor/country-coder';
import { UiField } from '../UiField.js';
import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.js';


const metricValues = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const imperialValues = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];


function comboValues(d: any): { value: string; title: string } {
  return {
    value: d.toString(),
    title: d.toString()
  };
}


/**
 * This UI component displays a roadspeed field.
 * It includes a main field for the speed value, and a combo for the units (mph or kph).
 */
export class UiFieldRoadspeed extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $input: D3Selection | null;
  public $unitInput: D3Selection | null;

  protected _tags: Tags;
  protected _isImperial: boolean;
  protected _speedCombo: any;
  protected _unitCombo: any;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - the original Field tracked by the SchemaSystem
   * @param entityIDs - the entities this field applies to
   * @param options - field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    // D3 selections
    this.$parent = null;
    this.$input = null;
    this.$unitInput = null;

    this._tags = {};
    this._isImperial = false;

    this._speedCombo = uiCombobox(context, 'roadspeed');
    this._unitCombo = uiCombobox(context, 'roadspeed-unit')
      .data(['km/h', 'mph'].map(comboValues));

    this.renderContent = this.renderContent.bind(this);
    this._change = this._change.bind(this);
    this._changeUnits = this._changeUnits.bind(this);
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

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge($wrap);


    this.$input = $wrap.selectAll('input.roadspeed-number')
      .data([0]);

    this.$input = this.$input.enter()
      .append('input')
      .attr('type', 'text')
      .attr('class', 'roadspeed-number')
      .attr('id', this.uid)
      .call(utilNoAuto)
      .call(this._speedCombo)
      .merge(this.$input);

    this.$input
      .on('change', this._change)
      .on('blur', this._change);

    const loc = this.entityExtent!.center();
    this._isImperial = roadSpeedUnit(loc) === 'mph';

    this.$unitInput = $wrap.selectAll('input.roadspeed-unit')
      .data([0]);

    this.$unitInput = this.$unitInput.enter()
      .append('input')
      .attr('type', 'text')
      .attr('class', 'roadspeed-unit')
      .call(this._unitCombo)
      .merge(this.$unitInput);

    this.$unitInput
      .on('blur', this._changeUnits)
      .on('change', this._changeUnits);
  }


  /** Toggles between metric and imperial units, then applies the change. */
  protected _changeUnits(): void {
    if (!this.$unitInput) return;   // called too early?

    this._isImperial = utilGetSetValue(this.$unitInput) === 'mph';
    utilGetSetValue(this.$unitInput, this._isImperial ? 'mph' : 'km/h');
    this._setUnitSuggestions();
    this._change();
  }


  /** Updates the speed combobox suggestions to match the current unit system. */
  protected _setUnitSuggestions(): void {
    if (!this.$unitInput) return;   // called too early?
    this._speedCombo.data((this._isImperial ? imperialValues : metricValues).map(comboValues));
    utilGetSetValue(this.$unitInput, this._isImperial ? 'mph' : 'km/h');
  }


  /** Dispatches the current roadspeed value as a tag change. */
  protected _change(): void {
    if (!this.$input) return;   // called too early?

    const context = this.context;

    const tag: Tags = {};
    const value = (utilGetSetValue(this.$input) as string).trim();
    const key = this.key;

    // don't override multiple values with blank string
    if (!value && Array.isArray(this._tags[key])) return;

    if (!value) {
      tag[key] = undefined;
    } else if (isNaN(value as any) || !this._isImperial) {
      tag[key] = context.cleanTagValue(value);
    } else {
      tag[key] = context.cleanTagValue(value + ' mph');
    }

    this.emit('change', tag);
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$input) return;   // called too early?

    const l10n = this.context.systems.l10n!;

    this._tags = tags;
    const key = this.key;

    let value: any = tags[key];
    const isMixed = Array.isArray(value);

    if (!isMixed) {
      if (value && value.indexOf('mph') >= 0) {
        value = parseInt(value, 10).toString();
        this._isImperial = true;
      } else if (value) {
        this._isImperial = false;
      }
    }

    this._setUnitSuggestions();

    (utilGetSetValue(this.$input, typeof value === 'string' ? value : '') as D3Selection)
      .attr('title', isMixed ? (value as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : this.placeholder)
      .classed('mixed', isMixed);
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$input) return;   // called too early?
    this.$input.node().focus();
  }
}
