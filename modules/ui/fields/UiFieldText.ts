import { selection } from 'd3-selection';
import { iso1A2Code } from '@rapideditor/country-coder';
import { UiField } from '../UiField.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';
import { uiIcon } from '../icon.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { TagChange, Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';

export {
  UiFieldText as UiFieldUrl,
  UiFieldText as UiFieldIdentifier,
  UiFieldText as UiFieldNumber,
  UiFieldText as UiFieldTel,
  UiFieldText as UiFieldEmail
};


/**
 * This UI component displays an input text field.
 * There are several variants:
 * - 'text':
 * - 'url':
 * - 'email':
 * - 'tel':
 * - 'identifier':
 * - 'number':
 */
export class UiFieldText extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $input: D3Selection | null;
  public $outlinkButton: D3Selection | null;

  protected _tags: Tags;
  protected _phoneFormats: Record<string, string>;


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
    this.$outlinkButton = null;

    this._tags = {};
    this._phoneFormats = {};

    this.renderContent = this.renderContent.bind(this);

    if (this.type === 'tel') {
      const assets = context.systems.assets!;
      assets.loadAssetAsync('phone_formats')
        .then((d: any) => {
          this._phoneFormats = d.phoneFormats;
          this._updatePhonePlaceholder();
        })
        .catch((e: unknown) => console.error(e));  // eslint-disable-line
    }
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
    const presetField = this.presetField;

    this._calcLocked();
    const isLocked = this.locked();

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${this.type}`)
      .merge($wrap);

    this.$input = $wrap.selectAll('input')
      .data([0]);

    this.$input = this.$input.enter()
      .append('input')
      .attr('type', this.type === 'identifier' || this.type === 'roadheight' ? 'text' : this.type)
      .attr('id', this.uid)
      .classed(this.type, true)
      .call(utilNoAuto)
      .merge(this.$input);

    this.$input
      .classed('disabled', !!isLocked)
      .attr('readonly', isLocked || null)
      .on('input', this._change(true))
      .on('blur', this._change())
      .on('change', this._change());


    if (this.type === 'tel') {
      this._updatePhonePlaceholder();

    } else if (this.type === 'number') {
      this.$input.attr('type', 'text');

      const inc = +(presetField.props.increment || 1);
      const $buttons: D3Selection = $wrap.selectAll('.increment, .decrement')
        .data(l10n.isRTL ? [inc, -inc] : [-inc, inc]);

      $buttons.enter()
        .append('button')
        .attr('class', function (d) {
          const which = (d > 0) ? 'increment' : 'decrement';
          return `form-field-button ${which}`;
        })
        .merge($buttons)
        .on('click', (d3_event: Event, d: number) => {
          d3_event.preventDefault();
          const raw_vals = this.$input!.node().value || '0';
          let vals = raw_vals.split(';');
          vals = vals.map((v: string) => {
            const num = parseFloat(v.trim());
            return isFinite(num) ? this._clamped(num + d) : v.trim();
          });
          this.$input!.node().value = vals.join(';');
          this._change()();
        });

    } else if (this.type === 'identifier' && presetField.props.urlFormat && presetField.props.pattern) {
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

    } else if (this.type === 'url') {
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


  /** Determines whether the field should be locked (protected `*:wikidata` companion values). */
  protected _calcLocked(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const graph = editor.staging.graph;

    // Protect certain fields that have a companion `*:wikidata` value
    const lockable = ['brand', 'network', 'operator', 'flag'];
    const isLocked = lockable.includes(this.id) && this.entityIDs.length && this.entityIDs.some(entityID => {
      const entity = graph.hasEntity(entityID);
      if (!entity) return false;

      // Features linked to Wikidata are likely important and should be protected
      if (entity.tags.wikidata) return true;

      const preset = schema.match(entity, graph);
      const isSuggestion = preset?.suggestion;

      // Lock the field if there is a value and a companion `*:wikidata` value
      const which = this.id;   // 'brand', 'network', 'operator', 'flag'
      return isSuggestion && !!entity.tags[which] && !!entity.tags[which + ':wikidata'];
    });

    this.locked(!!isLocked);
  }


  /** Updates the field's placeholder to the phone-number format for the current country. */
  protected _updatePhonePlaceholder(): void {
    if (!this.$input) return;   // called too early?
    if (this.$input.empty() || !Object.keys(this._phoneFormats).length) return;

    const extent = this.entityExtent;
    const countryCode = extent && iso1A2Code(extent.center());
    const format = countryCode && this._phoneFormats[countryCode.toLowerCase()];
    if (format) this.$input.attr('placeholder', format);
  }


  /**
   * Returns the current input value if it is a valid target for the outlink, else `null`.
   * @return The link value, or `null` if the value is not valid
   */
  protected _validIdentifierValueForLink(): any {
    if (!this.$input) return;   // called too early?
    const pattern = this.presetField.props.pattern;
    const value = (utilGetSetValue(this.$input) as string).trim().split(';')[0];

    if (this.type === 'url' && /^https?:\/\//i.test(value)) return value;
    if (this.type === 'identifier' && pattern) {
      return value && value.match(new RegExp(pattern));
    }
    return null;
  }


  /**
   * Clamps a number to the field's configured min/max values.
   * @param num - The number to clamp
   * @return The clamped number
   */
  protected _clamped(num: number): number {
    const presetField = this.presetField;
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
      if (!this.$input) return;   // called too early?
      const context = this.context;
      const key = this.key;
      const tagChange: TagChange = {};
      let val = utilGetSetValue(this.$input) as string;
      if (!onInput) val = context.cleanTagValue(val);

      // don't override multiple values with blank string
      if (!val && Array.isArray(this._tags[key])) return;

      if (!onInput) {
        if (this.type === 'number' && val) {
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
      this.emit('change', tagChange, onInput);
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

    (utilGetSetValue(this.$input, !isMixed && tags[key] ? (tags[key] as string) : '') as D3Selection)
      .attr('title', isMixed ? (tags[key] as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : (this.placeholder || l10n.t('inspector.unknown')))
      .classed('mixed', isMixed);

    if (this.$outlinkButton && !this.$outlinkButton.empty()) {
      const disabled = !this._validIdentifierValueForLink();
      this.$outlinkButton.classed('disabled', disabled);
    }
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$input) return;   // called too early?
    const node = this.$input.node() as HTMLInputElement | null;
    node?.focus();
  }
}
