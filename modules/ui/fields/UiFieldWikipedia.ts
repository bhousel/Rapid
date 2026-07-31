import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { actionChangeTags } from '../../actions/change_tags.js';
import { uiIcon } from '../icon.js';
import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Tags } from './types.ts';


export class UiFieldWikipedia {
  public context: Context;
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  public static supportsMultiselection = false;

  protected _uifield: any;
  public $langInput: D3Selection;
  public $titleInput: D3Selection;
  protected _wikiURL: string;
  protected _entityIDs: EntityID[];
  protected _tags: Tags;
  protected _dataWikipedia: any[];
  protected _langCombo: any;
  protected _titleCombo: any;

  public constructor(context: Context, uifield: any) {
    const assets = context.systems.assets!;

    this.context = context;
    this._uifield = uifield;

    this.$langInput = d3_select(null);
    this.$titleInput = d3_select(null);
    this._wikiURL = '';
    this._entityIDs = [];
    this._tags = {};
    this._dataWikipedia = [];

    this.render = this.render.bind(this);
    this._changeLang = this._changeLang.bind(this);

    assets.loadAssetAsync('wmf_sitematrix')
      .then((d: any) => {
        this._dataWikipedia = d;
        if (!this.$langInput.empty()) this._updateForTags(this._tags);
      })
      .catch((e: any) => console.error(e));  // eslint-disable-line

    this._langCombo = uiCombobox(context, 'wikipedia-lang')
      .fetcher((value, callback) => {
        const v = value.toLowerCase();
        callback(this._dataWikipedia
          .filter((d: any) => {
            return d[0].toLowerCase().indexOf(v) >= 0 ||
              d[1].toLowerCase().indexOf(v) >= 0 ||
              d[2].toLowerCase().indexOf(v) >= 0;
          })
          .map((d: any) => ({ value: d[1] }))
        );
      });

    this._titleCombo = uiCombobox(context, 'wikipedia-title')
      .fetcher((value, callback) => {
        const editor = context.systems.editor!;
        const wikipedia = context.services.wikipedia as any;

        if (!value) {
          value = '';
          const graph = editor.staging.graph;
          for (const i in this._entityIDs) {
            const entity = graph.hasEntity(this._entityIDs[i]) as any;
            if (entity.tags.name) {
              value = entity.tags.name;
              break;
            }
          }
        }
        const searchfn = value.length > 7 ? wikipedia.search : wikipedia.suggestions;
        searchfn(this._language()[2], value, (query: any, data: any) => {
          callback( data.map((d: any) => ({ value: d })) );
        });
      });

    this.dispatch = d3_dispatch('change');
    utilRebind(this as any, this.dispatch, 'on');
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

    let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${uifield.type}`)
      .merge($wrap);


    let $langContainer: D3Selection = $wrap.selectAll('.wiki-lang-container')
      .data([0]);

    $langContainer = $langContainer.enter()
      .append('div')
      .attr('class', 'wiki-lang-container')
      .merge($langContainer);


    this.$langInput = $langContainer.selectAll('input.wiki-lang')
      .data([0]);

    this.$langInput = this.$langInput.enter()
      .append('input')
      .attr('type', 'text')
      .attr('class', 'wiki-lang')
      .call(utilNoAuto)
      .call(this._langCombo)
      .merge(this.$langInput);

    this.$langInput
      .attr('placeholder', l10n.t('translate.localized_translation_language'))
      .on('blur', this._changeLang)
      .on('change', this._changeLang);


    let $titleContainer: D3Selection = $wrap.selectAll('.wiki-title-container')
      .data([0]);

    $titleContainer = $titleContainer.enter()
      .append('div')
      .attr('class', 'wiki-title-container')
      .merge($titleContainer);

    this.$titleInput = $titleContainer.selectAll('input.wiki-title')
      .data([0]);

    this.$titleInput = this.$titleInput.enter()
      .append('input')
      .attr('type', 'text')
      .attr('class', 'wiki-title')
      .attr('id', uifield.uid)
      .call(utilNoAuto)
      .call(this._titleCombo)
      .merge(this.$titleInput);

    this.$titleInput
      .on('blur', () => {
        this._change(true);
      })
      .on('change', () => {
        this._change(false);
      });


    let $link: D3Selection = $titleContainer.selectAll('.wiki-link')
      .data([0]);

    $link = $link.enter()
      .append('button')
      .attr('class', 'form-field-button wiki-link')
      .call(uiIcon('#rapid-icon-out-link'))
      .merge($link);

    $link
      .attr('title', l10n.t('icons.view_on', { domain: 'wikipedia.org' }))
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        if (this._wikiURL) window.open(this._wikiURL, '_blank');
      });
  }


  /**
   * Returns the Wikipedia language info row for Rapid's current locale.
   * @param skipEnglishFallback - When true, returns empty strings instead of falling back to English
   * @returns A `[localName, nativeName, code]` language info row
   */
  protected _defaultLanguageInfo(skipEnglishFallback?: boolean): string[] {
    const l10n = this.context.systems.l10n!;
    const langCode = l10n.languageCode.toLowerCase();

    for (const i in this._dataWikipedia) {
      const d = this._dataWikipedia[i];
      // default to the language of Rapid's current locale
      if (d[2] === langCode) return d;
    }

    // fallback to English
    return skipEnglishFallback ? ['', '', ''] : ['English', 'English', 'en'];
  }


  /**
   * Returns the Wikipedia language info row for the language currently shown in the UI.
   * @param skipEnglishFallback - When true, skips the English fallback if the language isn't recognized
   * @returns A `[localName, nativeName, code]` language info row
   */
  protected _language(skipEnglishFallback?: boolean): string[] {
    const value = (utilGetSetValue(this.$langInput) as string).toLowerCase();

    for (const i in this._dataWikipedia) {
      const d = this._dataWikipedia[i];
      // return the language already set in the UI, if supported
      if (d[0].toLowerCase() === value ||
        d[1].toLowerCase() === value ||
        d[2] === value) return d;
    }

    // fallback to English
    return this._defaultLanguageInfo(skipEnglishFallback);
  }


  /** Normalizes the language input to the native language name, then applies the change. */
  protected _changeLang(): void {
    utilGetSetValue(this.$langInput, this._language()[1]);
    this._change(true);
  }


  /**
   * Dispatches the current wikipedia tag change, and optionally an async wikidata tag update.
   * @param skipWikidata - When true, skips the asynchronous wikidata tag lookup
   */
  protected _change(skipWikidata?: boolean): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const wikidata = context.services.wikidata as any;

    let value = utilGetSetValue(this.$titleInput) as string;
    const m = value.match(/https?:\/\/([-a-z]+)\.wikipedia\.org\/(?:wiki|\1-[-a-z]+)\/([^#]+)(?:#(.+))?/);
    const langInfo = m && this._dataWikipedia.find((d: any) => m[1] === d[2]);
    const syncTags: Tags = {};

    if (langInfo) {
      const nativeLangName = langInfo[1];
      // Normalize title http://www.mediawiki.org/wiki/API:Query#Title_normalization
      value = decodeURIComponent(m![2]).replace(/_/g, ' ');
      if (m![3]) {
        // try {
        // leave this out for now - iD#6232
          // Best-effort `anchordecode:` implementation
          // anchor = decodeURIComponent(m[3].replace(/\.([0-9A-F]{2})/g, '%$1'));
        // } catch (e) {
        const anchor = decodeURIComponent(m![3]);
        // }
        value += '#' + anchor.replace(/_/g, ' ');
      }
      value = value.slice(0, 1).toUpperCase() + value.slice(1);
      utilGetSetValue(this.$langInput, nativeLangName);
      utilGetSetValue(this.$titleInput, value);
    }

    if (value) {
      syncTags.wikipedia = context.cleanTagValue(this._language()[2] + ':' + value);
    } else {
      syncTags.wikipedia = undefined;
    }

    this.dispatch.call('change', this, syncTags);


    if (skipWikidata || !value || !this._language()[2]) return;

    // attempt asynchronous update of wikidata tag..
    const initGraph = editor.staging.graph;
    const initEntityIDs = this._entityIDs;

    wikidata.itemsByTitle(this._language()[2], value, (err: any, data: any) => {
      if (err || !data || !Object.keys(data).length) return;

      // If graph has changed, we can't apply this update.
      const graph = editor.staging.graph;
      if (graph !== initGraph) return;

      const qids = Object.keys(data);
      const value = qids && qids.find(id => id.match(/^Q\d+$/));

      for (const entityID of initEntityIDs) {
        const entity = graph.entity(entityID);
        const asyncTags: any = { ...entity.tags };  // shallow copy
        if (asyncTags.wikidata !== value) {
          asyncTags.wikidata = value;
          editor.perform(actionChangeTags(entityID, asyncTags));
        }
      }
      // do not dispatch.call('change') here, because entity_editor
      // changeTags() is not intended to be called asynchronously
    });
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public tags(tags: Tags): void {
    this._tags = tags;
    this._updateForTags(tags);
  }


  /**
   * Updates the language/title inputs and view link from the given tags.
   * @param tags - The entity tags to read the wikipedia value from
   */
  protected _updateForTags(tags: Tags): void {
    const uifield = this._uifield;
    const key = uifield.key;
    const value = typeof tags[key] === 'string' ? tags[key] as string : '';
    // Expect tag format of `tagLang:tagArticleTitle`, e.g. `fr:Paris`, with
    // optional suffix of `#anchor`
    const m = value.match(/([^:]+):([^#]+)(?:#(.+))?/);
    const tagLang = m && m[1];
    const tagArticleTitle = m && m[2];
    const anchor = m && m[3];
    const tagLangInfo = tagLang && this._dataWikipedia.find((d: any) => tagLang === d[2]);

    // value in correct format
    if (tagLangInfo) {
      const nativeLangName = tagLangInfo[1];
      utilGetSetValue(this.$langInput, nativeLangName);
      utilGetSetValue(this.$titleInput, tagArticleTitle + (anchor ? ('#' + anchor) : ''));

      const path = this.encodePath(tagArticleTitle as string, anchor);
      this._wikiURL = `https://${tagLang}.wikipedia.org/wiki/${path}`;

    // unrecognized value format
    } else {
      utilGetSetValue(this.$titleInput, value);
      if (value && value !== '') {
        utilGetSetValue(this.$langInput, '');
        const defaultLangInfo = this._defaultLanguageInfo();
        this._wikiURL = `https://${defaultLangInfo[2]}.wikipedia.org/w/index.php?fulltext=1&search=${value}`;
      } else {
        const shownOrDefaultLangInfo = this._language(true /* skipEnglishFallback */);
        utilGetSetValue(this.$langInput, shownOrDefaultLangInfo[1]);
        this._wikiURL = '';
      }
    }
  }


  /**
   * Builds the URL path fragment for a Wikipedia article title and optional anchor.
   * @param tagArticleTitle - The article title
   * @param anchor          - An optional anchor/section, or null
   * @returns The URL-encoded path fragment
   */
  public encodePath(tagArticleTitle: string, anchor: string | null): string {
    const underscoredTitle = tagArticleTitle.replace(/ /g, '_');
    const uriEncodedUnderscoredTitle = encodeURIComponent(underscoredTitle);
    const uriEncodedAnchorFragment = this.encodeURIAnchorFragment(anchor);
    return `${uriEncodedUnderscoredTitle}${uriEncodedAnchorFragment}`;
  }


  /**
   * Encodes an anchor string into a URL fragment (`#...`).
   * @param anchor - The anchor text, or null
   * @returns The encoded `#fragment`, or an empty string when no anchor
   */
  public encodeURIAnchorFragment(anchor: string | null): string {
    if (!anchor) return '';
    const underscoredAnchor = anchor.replace(/ /g, '_');
    return '#' + encodeURIComponent(underscoredAnchor);
  }


  /**
   * Gets or sets the entity IDs this field is editing.
   * @param val - The entity IDs to set; if omitted, acts as a getter
   * @returns The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    return this;
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    (this.$titleInput.node() as HTMLElement).focus();
  }
}
