import { selection } from 'd3-selection';
import { UiField } from '../UiField.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { TagChange, Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';


/**
 * This UI component displays a textarea field.
 */
export class UiFieldTextarea extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $input: D3Selection | null;

  protected _tags: Tags;


  /**
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

    this._tags = {};

    this.renderContent = this.renderContent.bind(this);
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
      .attr('class', `form-field-input-wrap form-field-input-${this.type}`)
      .merge($wrap);

    this.$input = $wrap.selectAll('textarea')
      .data([0]);

    this.$input = this.$input.enter()
      .append('textarea')
      .attr('id', this.uid)
      .call(utilNoAuto)
      .on('input', this._change(true))
      .on('blur', this._change())
      .on('change', this._change())
      .merge(this.$input);
  }


  /**
   * Returns a handler that dispatches a tag change from the current textarea value.
   * @param onInput - `true` while typing (skips value cleaning); omit on blur/change
   * @return An event handler function
   */
  protected _change(onInput?: boolean): () => void {
    return () => {
      if (!this.$input) return;   // called too early?

      const context = this.context;
      const key = this.key;
      let val = utilGetSetValue(this.$input) as string;
      if (!onInput) val = context.cleanTagValue(val);

      // don't override multiple values with blank string
      if (!val && Array.isArray(this._tags[key])) return;

      const t: TagChange = {};
      t[key] = val || undefined;
      this.emit('change', t, onInput);
    };
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
    const isMixed = Array.isArray(tags[key]);
    const placeholder = isMixed ? l10n.t('inspector.multiple_values') :
      (this.placeholder || l10n.t('text.unknown'));

    (utilGetSetValue(this.$input, !isMixed && tags[key] ? (tags[key] as string) : '') as D3Selection)
      .attr('title', isMixed ? (tags[key] as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', placeholder)
      .classed('mixed', isMixed);
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$input) return;   // called too early?
    const node = this.$input.node() as HTMLInputElement | null;
    node?.focus();
  }
}
