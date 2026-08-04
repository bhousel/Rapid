import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';

import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { TagChange, Tags } from './types.ts';


export class UiFieldTextarea extends EventEmitter {
  public context: Context;

  protected _uifield: any;
  public $input: D3Selection;
  protected _tags: Tags;

  /**
   * @param context - Global shared application context
   * @param uifield - The `UiField` wrapper that owns this field internal
   */
  public constructor(context: Context, uifield: any) {
    super();
    this.context = context;
    this._uifield = uifield;

    this.$input = d3_select(null);
    this._tags = {};

    this.render = this.render.bind(this);
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const uifield = this._uifield;

    let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${uifield.type}`)
      .merge($wrap);

    this.$input = $wrap.selectAll('textarea')
      .data([0]);

    this.$input = this.$input.enter()
      .append('textarea')
      .attr('id', uifield.uid)
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
      const context = this.context;
      const key = this._uifield.key;
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
  public tags(tags: Tags): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    this._tags = tags;
    const key = uifield.key;
    const isMixed = Array.isArray(tags[key]);
    const placeholder = isMixed ? l10n.t('inspector.multiple_values') :
      (uifield.placeholder || l10n.t('inspector.unknown'));

    (utilGetSetValue(this.$input, !isMixed && tags[key] ? (tags[key] as string) : '') as D3Selection)
      .attr('title', isMixed ? (tags[key] as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', placeholder)
      .classed('mixed', isMixed);
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    this.$input.node().focus();
  }
}
