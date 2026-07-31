import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { iso1A2Code } from '@rapideditor/country-coder';

import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';
import { uiIcon } from '../icon.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { TagChange, Tags } from './types.ts';

export {
  UiFieldText as UiFieldUrl,
  UiFieldText as UiFieldIdentifier,
  UiFieldText as UiFieldNumber,
  UiFieldText as UiFieldTel,
  UiFieldText as UiFieldEmail
};


export class UiFieldText {
  public context: Context;
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  protected _uifield: any;
  public $input: D3Selection;
  public $outlinkButton: D3Selection;
  protected _entityIDs: EntityID[];
  protected _tags: Tags;
  protected _phoneFormats: Record<string, string>;

  /**
   * @param context - Global shared application context
   * @param uifield - The `UiField` wrapper that owns this field internal
   */
  public constructor(context: Context, uifield: any) {
    this.context = context;
    this._uifield = uifield;

    this.$input = d3_select(null);
    this.$outlinkButton = d3_select(null);
    this._entityIDs = [];
    this._tags = {};
    this._phoneFormats = {};

    this.render = this.render.bind(this);

    this.dispatch = d3_dispatch('change');
    utilRebind(this as any, this.dispatch, 'on');

    if (uifield.type === 'tel') {
      const assets = context.systems.assets!;
      assets.loadAssetAsync('phone_formats')
        .then((d: any) => {
          this._phoneFormats = d.phoneFormats;
          this._updatePhonePlaceholder();
        })
        .catch((e: any) => console.error(e));  // eslint-disable-line
    }
  }


  /** Determines whether the field should be locked (protected `*:wikidata` companion values). */
  protected _calcLocked(): void {
    const editor = this.context.systems.editor!;
    const schema = this.context.systems.schema!;
    const uifield = this._uifield;

    const graph = editor.staging.graph;
    // Protect certain fields that have a companion `*:wikidata` value
    const lockable = ['brand', 'network', 'operator', 'flag'];
    const isLocked = lockable.includes(uifield.id) && this._entityIDs.length && this._entityIDs.some(entityID => {
      const entity = graph.hasEntity(entityID);
      if (!entity) return false;

      // Features linked to Wikidata are likely important and should be protected
      if (entity.tags.wikidata) return true;

      const preset = schema.match(entity, graph);
      const isSuggestion = preset?.suggestion;

      // Lock the field if there is a value and a companion `*:wikidata` value
      const which = uifield.id;   // 'brand', 'network', 'operator', 'flag'
      return isSuggestion && !!entity.tags[which] && !!entity.tags[which + ':wikidata'];
    });

    uifield.locked(isLocked);
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uifield = this._uifield;
    const presetField = uifield.presetField;

    this._calcLocked();
    const isLocked = uifield.locked();

    let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${uifield.type}`)
      .merge($wrap);

    this.$input = $wrap.selectAll('input')
      .data([0]);

    this.$input = this.$input.enter()
      .append('input')
      .attr('type', uifield.type === 'identifier' || uifield.type === 'roadheight' ? 'text' : uifield.type)
      .attr('id', uifield.uid)
      .classed(uifield.type, true)
      .call(utilNoAuto)
      .merge(this.$input);

    this.$input
      .classed('disabled', !!isLocked)
      .attr('readonly', isLocked || null)
      .on('input', this._change(true))
      .on('blur', this._change())
      .on('change', this._change());


    if (uifield.type === 'tel') {
      this._updatePhonePlaceholder();

    } else if (uifield.type === 'number') {
      this.$input.attr('type', 'text');

      const inc = +(presetField.props.increment || 1);
      const $buttons: D3Selection = $wrap.selectAll('.increment, .decrement')
        .data(l10n.isRTL ? [inc, -inc] : [-inc, inc]);

      $buttons.enter()
        .append('button')
        .attr('class', function(d) {
          const which = (d > 0) ? 'increment' : 'decrement';
          return `form-field-button ${which}`;
        })
        .merge($buttons)
        .on('click', (d3_event: Event, d: number) => {
          d3_event.preventDefault();
          const raw_vals = this.$input.node().value || '0';
          let vals = raw_vals.split(';');
          vals = vals.map((v: string) => {
            const num = parseFloat(v.trim());
            return isFinite(num) ? this._clamped(num + d) : v.trim();
          });
          this.$input.node().value = vals.join(';');
          this._change()();
        });

    } else if (uifield.type === 'identifier' && presetField.props.urlFormat && presetField.props.pattern) {
      this.$input.attr('type', 'text');

      this.$outlinkButton = $wrap.selectAll('.foreign-id-permalink')
        .data([0]);

      this.$outlinkButton = this.$outlinkButton.enter()
        .append('button')
        .call(uiIcon('#rapid-icon-out-link'))
        .attr('class', 'form-field-button foreign-id-permalink')
        .on('click', (d3_event: Event) => {
          d3_event.preventDefault();
          const value = this._validIdentifierValueForLink();
          if (value) {
            const url = presetField.props.urlFormat.replace(/{value}/, encodeURIComponent(value));
            window.open(url, '_blank');
          }
        })
        .merge(this.$outlinkButton);

      // Set localized title on the update selection so it re-localizes on language change.
      this.$outlinkButton
        .attr('title', () => {
          const domainResults = /^https?:\/\/(.{1,}?)\//.exec(presetField.props.urlFormat);
          if (domainResults && domainResults.length >= 2 && domainResults[1]) {
            const domain = domainResults[1];
            return l10n.t('icons.view_on', { domain: domain });
          }
          return '';
        });

    } else if (uifield.type === 'url') {
      this.$input.attr('type', 'text');

      this.$outlinkButton = $wrap.selectAll('.foreign-id-permalink')
        .data([0]);

      this.$outlinkButton = this.$outlinkButton.enter()
        .append('button')
        .call(uiIcon('#rapid-icon-out-link'))
        .attr('class', 'form-field-button foreign-id-permalink')
        .on('click', (d3_event: Event) => {
          d3_event.preventDefault();
          const value = this._validIdentifierValueForLink();
          if (value) window.open(value, '_blank');
        })
        .merge(this.$outlinkButton);

      // Set localized title on the update selection so it re-localizes on language change.
      this.$outlinkButton
        .attr('title', () => l10n.t('icons.visit_website'));
    }
  }


  /** Updates the field's placeholder to the phone-number format for the current country. */
  protected _updatePhonePlaceholder(): void {
    const uifield = this._uifield;
    if (this.$input.empty() || !Object.keys(this._phoneFormats).length) return;

    const extent = uifield.entityExtent;
    const countryCode = extent && iso1A2Code(extent.center());
    const format = countryCode && this._phoneFormats[countryCode.toLowerCase()];
    if (format) this.$input.attr('placeholder', format);
  }


  /**
   * Returns the current input value if it is a valid target for the outlink, else `null`.
   * @return The link value, or `null` if the value is not valid
   */
  protected _validIdentifierValueForLink(): any {
    const uifield = this._uifield;
    const pattern = uifield.presetField.props.pattern;
    const value = (utilGetSetValue(this.$input) as string).trim().split(';')[0];

    if (uifield.type === 'url' && /^https?:\/\//i.test(value)) return value;
    if (uifield.type === 'identifier' && pattern) {
      return value && value.match(new RegExp(pattern));
    }
    return null;
  }


  // clamp number to min/max
  /**
   * Clamps a number to the field's configured min/max values.
   * @param num - The number to clamp
   * @return The clamped number
   */
  protected _clamped(num: number): number {
    const presetField = this._uifield.presetField;
    if (presetField.props.minValue !== undefined) {
      num = Math.max(num, presetField.props.minValue);
    }
    if (presetField.props.maxValue !== undefined) {
      num = Math.min(num, presetField.props.maxValue);
    }
    return num;
  }


  /**
   * Returns a handler that dispatches a tag change from the current input value.
   * @param onInput - `true` while typing (skips value cleaning); omit on blur/change
   * @return An event handler function
   */
  protected _change(onInput?: boolean): () => void {
    return () => {
      const context = this.context;
      const uifield = this._uifield;
      const key = uifield.key;
      const tagChange: TagChange = {};
      let val = utilGetSetValue(this.$input) as string;
      if (!onInput) val = context.cleanTagValue(val);

      // don't override multiple values with blank string
      if (!val && Array.isArray(this._tags[key])) return;

      if (!onInput) {
        if (uifield.type === 'number' && val) {
          let vals = val.split(';');
          vals = vals.map(v => {
            const num = parseFloat(v.trim());
            return isFinite(num) ? String(this._clamped(num)) : v.trim();
          });
          val = vals.join(';');
        }
        utilGetSetValue(this.$input, val);
      }
      tagChange[key] = val || undefined;
      this.dispatch.call('change', this, tagChange, onInput);
    };
  }


  /**
   * Gets or sets the entity IDs this field applies to.
   * @param val - The new entity IDs, or omit to get the current IDs
   * @return The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    return this;
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

    (utilGetSetValue(this.$input, !isMixed && tags[key] ? (tags[key] as string) : '') as D3Selection)
      .attr('title', isMixed ? (tags[key] as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : (uifield.placeholder || l10n.t('inspector.unknown')))
      .classed('mixed', isMixed);

    if (this.$outlinkButton && !this.$outlinkButton.empty()) {
      const disabled = !this._validIdentifierValueForLink();
      this.$outlinkButton.classed('disabled', disabled);
    }
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    const node = this.$input.node();
    if (node) node.focus();
  }
}
