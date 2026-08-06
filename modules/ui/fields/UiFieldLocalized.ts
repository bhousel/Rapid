import { select, selection } from 'd3-selection';
import { utilArrayUniq, utilUniqueString } from '@rapid-sdk/util';
import { iso1A2Code } from '@rapideditor/country-coder';

import { UiField } from '../UiField.ts';
import { uiIcon } from '../icon.ts';
import { uiTooltip } from '../tooltip.ts';
import { uiCombobox } from '../combobox.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';

import { LANGUAGE_SUFFIX_REGEX } from './types.ts';


interface LanguageItem {
  localName: string;
  nativeName: string;
  code: string;
  label: string;
}

interface MultilingualItem {
  lang: string;
  value: string | string[] | undefined;
}


/**
 * This UI component displays a localized name field.
 * It includes a primary field, a button for "add multilingual",
 * and additional fields for any localized tags such as `name:en`, `name:de`, etc.
 */
export class UiFieldLocalized extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $input: D3Selection | null;
  public $localizedInputs: D3Selection | null;

  protected _countryCode: string | undefined;
  protected _tags: Tags;
  protected _languagesArray: LanguageItem[];
  protected _langCombo: any;
  protected _multilingual: MultilingualItem[];
  protected _buttonTip: any;
  protected _wikiTitles: Record<string, string> | null;

  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    const l10n = context.systems.l10n!;

    // D3 selections
    this.$parent = null;
    this.$input = null;
    this.$localizedInputs = null;

    this._countryCode = undefined;
    this._tags = {};
    this._languagesArray = [];
    this._multilingual = [];
    this._wikiTitles = null;

    this.renderContent = this.renderContent.bind(this);
    this._renderMultilingual = this._renderMultilingual.bind(this);
    this._changeLang = this._changeLang.bind(this);
    this._changeValue = this._changeValue.bind(this);
    this._addNew = this._addNew.bind(this);
    this._getLanguages = this._getLanguages.bind(this);

    // reuse these combos
    this._langCombo = uiCombobox(context, 'localized-lang')
      .fetcher(this._getLanguages)
      .minItems(0);

    this._buttonTip = uiTooltip(context)
      .title(l10n.t('translate.translate'))
      .placement('left');

    this._loadCountryCode();
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

    this._calcLocked();
    const isLocked = this.locked();

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    // enter/update
    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge($wrap);

    this.$input = $wrap.selectAll('.localized-main')
      .data([0]);

    // enter/update
    this.$input = this.$input.enter()
      .append('input')
      .attr('type', 'text')
      .attr('id', this.uid)
      .attr('class', 'localized-main')
      .call(utilNoAuto)
      .merge(this.$input);

    this.$input
      .classed('disabled', !!isLocked)
      .attr('readonly', isLocked || null)
      .on('input', this._change(true))
      .on('blur', this._change())
      .on('change', this._change());


    let $translateButton: D3Selection = $wrap.selectAll('.localized-add')
      .data([0]);

    $translateButton = $translateButton.enter()
      .append('button')
      .attr('class', 'localized-add form-field-button')
      .call(uiIcon('#rapid-icon-plus'))
      .merge($translateButton);

    $translateButton
      .classed('disabled', !!isLocked)
      .call(isLocked ? this._buttonTip.destroy : this._buttonTip)
      .on('click', this._addNew);


    if (this._tags && !this._multilingual.length) {
      this._calcMultilingual(this._tags);
    }

    this.$localizedInputs = $parent.selectAll('.localized-multilingual')
      .data([0]);

    this.$localizedInputs = this.$localizedInputs.enter()
      .append('div')
      .attr('class', 'localized-multilingual')
      .merge(this.$localizedInputs);

    this.$localizedInputs
      .call(this._renderMultilingual);

    this.$localizedInputs.selectAll('button, input')
      .classed('disabled', !!isLocked)
      .attr('readonly', isLocked || null);
  }


  /** Builds the array of languages used to populate the language combobox. */
  protected _buildLanguagesArray(): void {
    const l10n = this.context.systems.l10n!;

    if (this._languagesArray.length) return;  // done already

    // some conversion is needed to ensure correct OSM tags are used
    const replacements: Record<string, string | boolean> = {
      sr: 'sr-Cyrl',      // in OSM, `sr` implies Cyrillic
      'sr-Cyrl': false    // `sr-Cyrl` isn't used in OSM
    };

    for (const code of Object.keys(l10n.languages)) {
      if (replacements[code] === false) continue;
      let metaCode: string = code;
      if (replacements[code]) metaCode = replacements[code] as string;

      const label = l10n.languageName(metaCode);
      const localName = l10n.languageName(metaCode, { localOnly: true });
      const nativeName = l10n.languages[metaCode].nativeName;

      if (label && localName && nativeName) {
        this._languagesArray.push({ code, label, localName, nativeName });
      }
    }
  }


  /** Recomputes whether the field should be locked (e.g. protected suggestion-preset names). */
  protected _calcLocked(): void {
    const editor = this.context.systems.editor!;
    const schema = this.context.systems.schema!;

    const graph = editor.staging.graph;
    // Protect name field for suggestion presets that don't display a brand/operator field
    const isLocked = (this.id === 'name') &&
      this.entityIDs.length &&
      this.entityIDs.some(function(entityID) {
        const entity = graph.hasEntity(entityID);
        if (!entity) return false;

        // Features linked to Wikidata are likely important and should be protected
        if (entity.tags.wikidata) return true;

        // Assume the name has already been confirmed if its source has been researched
        if (entity.tags['name:etymology:wikidata']) return true;

        // Lock the `name` if this is a suggestion preset that assigns the name,
        // and the preset does not display a `brand` or `operator` field.
        // (For presets like hotels, car dealerships, post offices, the `name` should remain editable)
        // see also similar logic in `outdated_tags.ts`
        const preset = schema.match(entity, graph);
        if (preset) {
          const isSuggestion = preset.props.suggestion;
          const fields = preset.fields();
          const showsBrandField = fields.some((d: Field) => d.id === 'brand');
          const showsOperatorField = fields.some((d: Field) => d.id === 'operator');
          const setsName = preset.addTags.name;
          const setsBrandWikidata = preset.addTags['brand:wikidata'];
          const setsOperatorWikidata = preset.addTags['operator:wikidata'];

          return (isSuggestion && setsName && (
            (setsBrandWikidata && !showsBrandField) ||
            (setsOperatorWikidata && !showsOperatorField)
          ));
        }

        return false;
      });

    this.locked(!!isLocked);
  }


  // update _multilingual, maintaining the existing order
  /**
   * Updates `_multilingual` from the given tags, preserving existing order.
   * @param tags - The entity tags to read localized values from
   */
  protected _calcMultilingual(tags: Tags): void {
    const existingLangsOrdered = this._multilingual.map(item => item.lang);
    const existingLangs = new Set(existingLangsOrdered.filter(Boolean));

    for (const k in tags) {
      const m = k.match(LANGUAGE_SUFFIX_REGEX);
      if (m && m[1] === this.key && m[2]) {
        const item = { lang: m[2], value: tags[k] };
        if (existingLangs.has(item.lang)) {
          // update the value
          this._multilingual[existingLangsOrdered.indexOf(item.lang)].value = item.value;
          existingLangs.delete(item.lang);
        } else {
          this._multilingual.push(item);
        }
      }
    }

    // Don't remove items based on deleted tags, since this makes the UI
    // disappear unexpectedly when clearing values - iD#8164
    for (const item of this._multilingual) {
      if (item.lang && existingLangs.has(item.lang)) {
        item.value = '';
      }
    };
  }


  /**
   * Adds a new empty multilingual entry and re-renders the multilingual inputs.
   * @param d3_event - The triggering DOM event
   */
  protected _addNew(d3_event: Event): void {
    if (!this.$localizedInputs) return;   // called too early?

    const l10n = this.context.systems.l10n!;

    d3_event.preventDefault();
    if (this.locked()) return;

    let defaultLang = l10n.languageCode.toLowerCase();
    let langExists = this._multilingual.find(function(datum) { return datum.lang === defaultLang; });
    const isLangEn = defaultLang.indexOf('en') > -1;
    if (isLangEn || langExists) {
      defaultLang = '';
      langExists = this._multilingual.find(function(datum) { return datum.lang === defaultLang; });
    }

    if (!langExists) {
      // prepend the value so it appears at the top
      this._multilingual.unshift({ lang: defaultLang, value: '' });

      this.$localizedInputs
        .call(this._renderMultilingual);
    }
  }


  /**
   * Returns a change handler for the main value input.
   * @param onInput - When true, treats the change as a live input event (no tag-value cleaning)
   * @returns An event handler that dispatches the tag change
   */
  protected _change(onInput?: boolean): (d3_event: Event) => void {
    return (d3_event: Event) => {
      const context = this.context;

      if (this.locked()) {
        d3_event.preventDefault();
        return;
      }

      let val = utilGetSetValue(select(d3_event.currentTarget as HTMLInputElement)) as string;
      if (!onInput) val = context.cleanTagValue(val);

      // don't override multiple values with blank string
      if (!val && Array.isArray(this._tags[this.key])) return;

      const t: Tags = {};

      t[this.key] = val || undefined;
      this.emit('change', t, onInput);
    };
  }


  /**
   * Builds the tag key for a given language suffix.
   * @param lang - The language/locale code
   * @returns The `key:lang` tag key
   */
  protected _key(lang: string): string {
    return this.key + ':' + lang;
  }


  /**
   * Handles a change to a multilingual entry's language, updating the corresponding tags.
   * @param d3_event - The triggering DOM event
   * @param d        - The multilingual entry datum being edited
   */
  protected _changeLang(d3_event: Event, d: MultilingualItem): void {
    const context = this.context;

    // Ensure languages array is built
    this._buildLanguagesArray();

    const tags: Tags = {};

    // make sure unrecognized suffixes are lowercase - iD#7156
    let lang = (utilGetSetValue(select(d3_event.currentTarget as HTMLInputElement)) as string).toLowerCase();

    const language = this._languagesArray.find(function(d) {
      return d.label.toLowerCase() === lang ||
        (d.localName && d.localName.toLowerCase() === lang) ||
        (d.nativeName && d.nativeName.toLowerCase() === lang);
    });
    if (language) lang = language.code;

    if (d.lang && d.lang !== lang) {
      tags[this._key(d.lang)] = undefined;
    }

    const newKey = lang && context.cleanTagKey(this._key(lang));

    const value = utilGetSetValue(select((d3_event.currentTarget as HTMLElement).parentNode as HTMLElement).selectAll('.localized-value'));

    if (newKey && value) {
      tags[newKey] = value;
    } else if (newKey && this._wikiTitles && this._wikiTitles[d.lang]) {
      tags[newKey] = this._wikiTitles[d.lang];
    }

    d.lang = lang;
    this.emit('change', tags);
  }


  /**
   * Handles a change to a multilingual entry's value, updating the corresponding tag.
   * @param d3_event - The triggering DOM event
   * @param d        - The multilingual entry datum being edited
   */
  protected _changeValue(d3_event: Event, d: MultilingualItem): void {
    const context = this.context;

    if (!d.lang) return;
    const value = context.cleanTagValue(utilGetSetValue(select(d3_event.currentTarget as HTMLInputElement)) as string) || undefined;

    // don't override multiple values with blank string
    if (!value && Array.isArray(d.value)) return;

    const t: Tags = {};
    t[this._key(d.lang)] = value;
    d.value = value;
    this.emit('change', t);
  }


  /**
   * Combobox fetcher that returns matching languages for the language input.
   * @param value - The current input text to filter languages by
   * @param cb    - Receives the list of matching language options
   */
  protected _getLanguages(value: string, cb: (data: { value: string }[]) => void): void {
    const l10n = this.context.systems.l10n!;

    // Ensure languages array is built (it may not have been ready earlier)
    this._buildLanguagesArray();

    const v = value.toLowerCase();

    // show the user's language first
    let langCodes = [l10n.localeCode, l10n.languageCode];

    const territoryLanguages = l10n.territoryLanguages as any;
    if (this._countryCode && territoryLanguages[this._countryCode]) {
      langCodes = langCodes.concat(territoryLanguages[this._countryCode]);
    }

    let langItems: LanguageItem[] = [];
    langCodes.forEach((code) => {
      const langItem = this._languagesArray.find(function(item) {
        return item.code === code;
      });
      if (langItem) langItems.push(langItem);
    });
    langItems = utilArrayUniq(langItems.concat(this._languagesArray));

    cb(langItems.filter(function(d) {
      return d.label.toLowerCase().indexOf(v) >= 0 ||
        (d.localName && d.localName.toLowerCase().indexOf(v) >= 0) ||
        (d.nativeName && d.nativeName.toLowerCase().indexOf(v) >= 0) ||
        d.code.toLowerCase().indexOf(v) >= 0;
    }).map(function(d) {
      return { value: d.label };
    }));
  }


  /**
   * Renders the multilingual translation entries into the given selection.
   * @param $selection - A d3-selection to render the multilingual inputs into
   */
  protected _renderMultilingual($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;
    const langCombo = this._langCombo;

    let $entries: D3Selection = $selection.selectAll('div.entry')
      .data(this._multilingual, function(d: MultilingualItem) { return d.lang; });

    $entries.exit()
      .style('top', '0')
      .style('max-height', '240px')
      .transition()
      .duration(200)
      .style('opacity', '0')
      .style('max-height', '0px')
      .remove();

    const $$entries = $entries.enter()
      .append('div')
      .attr('class', 'entry')
      .each((_, index, nodes) => {
        const $wrap: D3Selection = select(nodes[index]);
        const uid = utilUniqueString(String(index));

        const $label: D3Selection = $wrap
          .append('label')
          .attr('class', 'field-label')
          .attr('for', uid);

        const $text: D3Selection = $label
          .append('span')
          .attr('class', 'label-text');

        $text
          .append('span')
          .attr('class', 'label-textvalue');

        $text
          .append('span')
          .attr('class', 'label-textannotation');

        $label
          .append('button')
          .attr('class', 'remove-icon-multilingual')
          .on('click', (d3_event: Event, d: MultilingualItem) => {
            if (this.locked()) return;
            d3_event.preventDefault();

            // remove the UI item manually
            this._multilingual.splice(this._multilingual.indexOf(d), 1);

            const langKey = d.lang && this._key(d.lang);
            if (langKey && langKey in this._tags) {
              delete this._tags[langKey];
              // remove from entity tags
              const t: Tags = {};
              t[langKey] = undefined;
              this.emit('change', t);
              return;
            }

            this._renderMultilingual($selection);
          })
          .call(uiIcon('#rapid-operation-delete'));

        $wrap
          .append('input')
          .attr('class', 'localized-lang')
          .attr('id', uid)
          .attr('type', 'text')
          .on('blur', this._changeLang)
          .on('change', this._changeLang)
          .call(langCombo);

        $wrap
          .append('input')
          .attr('type', 'text')
          .attr('class', 'localized-value')
          .on('blur', this._changeValue)
          .on('change', this._changeValue);
      });

    $$entries
      .style('margin-top', '0px')
      .style('max-height', '0px')
      .style('opacity', '0')
      .transition()
      .duration(200)
      .style('margin-top', '10px')
      .style('max-height', '240px')
      .style('opacity', '1')
      .on('end', function(this: HTMLElement) {
        select(this)
          .style('max-height', '')
          .style('overflow', 'visible');
      });

    $entries = $entries.merge($$entries);

    $entries.order();

    // allow removing the entry UIs even if there isn't a tag to remove
    $entries.classed('present', true);

    // set localized text on the update selection so it re-localizes on language change
    $entries.select('.label-textvalue')
      .html(l10n.tHtml('translate.localized_translation_label'));

    (utilGetSetValue($entries.select('.localized-lang'), (d: MultilingualItem) => {
      const langItem = this._languagesArray.find(function(item) {
        return item.code === d.lang;
      });
      if (langItem) return langItem.label;
      return d.lang;
    }) as D3Selection)
      .attr('placeholder', l10n.t('translate.localized_translation_language'));

    (utilGetSetValue($entries.select('.localized-value'), function(d: MultilingualItem) {
        return typeof d.value === 'string' ? d.value : '';
      }) as D3Selection)
      .attr('title', function(d: MultilingualItem) {
        return Array.isArray(d.value) ? d.value.filter(Boolean).join('\n') : null;
      })
      .attr('placeholder', function(d: MultilingualItem) {
        return Array.isArray(d.value) ? l10n.t('inspector.multiple_values') : l10n.t('translate.localized_translation_name');
      })
      .classed('mixed', function(d: MultilingualItem) {
        return Array.isArray(d.value);
      });
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$input) return;   // called too early?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const wikipedia = context.services.wikipedia as any;

    this._tags = tags;

    // Fetch translations from wikipedia
    if (typeof tags.wikipedia === 'string' && !this._wikiTitles) {
      this._wikiTitles = {};
      const wm = tags.wikipedia.match(/([^:]+):(.+)/);
      if (wm && wm[0] && wm[1]) {
        wikipedia.translations(wm[1], wm[2], (err: any, d: any) => {
          if (err || !d) return;
          this._wikiTitles = d;
        });
      }
    }

    const isMixed = Array.isArray(tags[this.key]);

    (utilGetSetValue(this.$input, typeof tags[this.key] === 'string' ? tags[this.key] as string : '') as D3Selection)
      .attr('title', isMixed ? (tags[this.key] as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : this.placeholder)
      .classed('mixed', isMixed);

    this._calcMultilingual(tags);
    this.renderContent();
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$input) return;   // called too early?
    (this.$input.node() as HTMLElement).focus();
  }


  /** Loads the ISO country code for the current entity's location. */
  protected _loadCountryCode(): void {
    const extent = this.entityExtent;
    const countryCode = extent && iso1A2Code(extent.center());
    this._countryCode = countryCode?.toLowerCase();
  }
}
