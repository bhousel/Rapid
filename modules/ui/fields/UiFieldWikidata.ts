import { select, selection } from 'd3-selection';
import { actionChangeTags } from '../../actions/change_tags.ts';
import { uiIcon } from '../icon.ts';
import { UiField } from '../UiField.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';
import { UiCombobox } from '../UiCombobox.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';


/**
 * This UI component displays a wikidata field.
 * It includes subfields for the value and a button to open Wikidata.
 */
export class UiFieldWikidata extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $searchInput: D3Selection | null;

  protected _qid: string | null;
  protected _wikidataEntity: Record<string, unknown> | null;
  protected _wikiURL: string;
  protected _wikipediaKey: string | undefined;
  protected _hintKey: string | undefined;
  protected _combobox: any;


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
    this.$searchInput = null;

    this._qid = null;
    this._wikidataEntity = null;
    this._wikiURL = '';

    this._wikipediaKey = this.keys && this.keys.find(key => key.includes('wikipedia'));
    this._hintKey = this.key === 'wikidata' ? 'name' : this.key.split(':')[0];

    this._combobox = new UiCombobox(context, `combo-${this.safeid}`)
      .caseSensitive(true)
      .minItems(1);

    this.renderContent = this.renderContent.bind(this);
    this._fetchWikidataItems = this._fetchWikidataItems.bind(this);
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

    const l10n = this.context.systems.l10n!;
    const combobox = this._combobox;

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge($wrap);


    let $list: D3Selection = $wrap.selectAll('ul')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'rows')
      .merge($list);

    let $searchRow: D3Selection = $list.selectAll('li.wikidata-search')
      .data([0]);

    const $$searchRow = $searchRow.enter()
      .append('li')
      .attr('class', 'wikidata-search');

    $$searchRow
      .append('input')
      .attr('type', 'text')
      .attr('id', this.uid)
      .style('flex', '1')
      .call(utilNoAuto)
      .on('focus', (e: Event) => {
        const node = select(e.currentTarget as HTMLInputElement).node() as HTMLInputElement;
        node.setSelectionRange(0, node.value.length);
      })
      .on('blur', () => {
        this._setLabelForEntity();
      })
      .call(combobox.fetcher(this._fetchWikidataItems).attach);

    combobox.on('accept', (d: any) => {
      if (d) {
        this._qid = d.id;
        this._change();
      }
    }).on('cancel', () => {
      this._setLabelForEntity();
    });

    $$searchRow
      .append('button')
      .attr('class', 'form-field-button wiki-link')
      .call(uiIcon('#rapid-icon-out-link'))
      .on('click', (e: PointerEvent) => {
        e.preventDefault();
        if (this._wikiURL) window.open(this._wikiURL, '_blank');
      });

    $searchRow = $searchRow.merge($$searchRow);
    $searchRow.select('button.wiki-link')
      .attr('title', l10n.t('icons.view_on', { domain: 'wikidata.org' }));

    this.$searchInput = $searchRow.select('input');

    const fieldNames = ['description', 'identifier'];
    let $items: D3Selection = $list.selectAll('li.labeled-input')
      .data(fieldNames);

    // Enter
    const $$items = $items.enter()
      .append('li')
      .attr('class', (d: string) => `labeled-input preset-wikidata-${d}`);

    $$items
      .append('div')
      .attr('class', 'label');

    $$items
      .append('input')
      .attr('type', 'text')
      .call(utilNoAuto)
      .classed('disabled', true)
      .attr('readonly', 'true');

    $$items
      .append('button')
      .attr('class', 'form-field-button')
      .call(uiIcon('#rapid-operation-copy'))
      .on('click', (e: PointerEvent) => {
        e.preventDefault();
        (select((e.currentTarget as HTMLElement).parentNode as HTMLElement)
          .select('input')
          .node() as HTMLInputElement)
          .select();
        document.execCommand('copy');
      });

    // update
    $items = $items.merge($$items);

    $items.select('.label')
      .text((d: string) => l10n.t(`wikidata.${d}`));
    $items.select('button.form-field-button')
      .attr('title', l10n.t('icons.copy'));
  }


  /**
   * Fetches Wikidata search results for the combobox.
   * @param q         - The search query; if empty, falls back to other tag values as search terms
   * @param callback  - Receives the list of matching Wikidata items
   */
  protected _fetchWikidataItems(q: string, callback?: (result: { id: string; value: string; title: string; terms: string[] }[]) => void): void {
    const editor = this.context.systems.editor!;
    const wikidata = this.context.services.wikidata!;

    if (!q && this._hintKey) {
      // other tags may be good search terms
      const graph = editor.staging.graph;
      for (const i in this.entityIDs) {
        const entity = graph.hasEntity(this.entityIDs[i]);
        if (!entity) continue;
        if (entity.tags[this._hintKey]) {
          q = entity.tags[this._hintKey];
          break;
        }
      }
    }

    wikidata.itemsForSearchQuery(q, function (err: any, data: any) {
      if (err) return;

      const result = data.map(function (item: any) {
        return {
          id: item.id,
          value: item.label + ' (' + item.id + ')',
          title: item.description,
          terms: item.aliases
        };
      });

      callback?.(result);
    });
  }


  /** Dispatches the current QID as a tag change, and attempts an async wikipedia tag update. */
  protected _change(): void {
    if (!this._wikipediaKey) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const wikidata = context.services.wikidata!;

    const key = this.key;
    const wpkey = this._wikipediaKey;

    const syncTags: Tags = {};
    syncTags[key] = this._qid ?? undefined;
    this.emit('change', syncTags);


    // Attempt asynchronous update of wikipedia tag..
    const initGraph = editor.staging.graph;
    const initEntityIDs = this.entityIDs;

    if (!this._qid) return;
    wikidata.entityByQID(this._qid, (err: any, result: any) => {
      if (err || !result?.sitelinks) return;

      // If graph has changed, we can't apply this update.
      const graph = editor.staging.graph;
      if (graph !== initGraph) return;

      // Wikipedia sites can be in a bunch of languages.
      // We'll try to match the user's preferred languages first.
      const langs = new Set(wikidata.languagesToQuery());

      // use the label and description languages as fallbacks
      for (const key of ['labels', 'descriptions']) {
        if (!result[key]) continue;
        const moreLangs = Object.keys(result[key]);
        if (moreLangs.length === 0) continue;
        langs.add(moreLangs[0]);
      }

      let newValue: string | null | undefined;
      let foundPreferred = false;

      for (const lang of langs) {
        const siteID = (lang as string).replace('-', '_') + 'wiki';
        if (result.sitelinks[siteID]) {
          foundPreferred = true;
          newValue = lang + ':' + result.sitelinks[siteID].title;
          break;
        }
      }

      // No wikipedia sites available in the user's language or the fallback languages,
      // default to any wikipedia sitelink
      if (!foundPreferred) {
        const wikiSiteKeys = Object.keys(result.sitelinks).filter(site => site.endsWith('wiki'));

        if (wikiSiteKeys.length === 0) {  // if no wikipedia pages are linked to this wikidata entity, delete the tag
          newValue = null;
        } else {
          const key = wikiSiteKeys[0];
          const lang = key.slice(0, -4).replace('_', '-');
          newValue = lang + ':' + result.sitelinks[key].title;
        }
      }

      if (newValue) {
        newValue = context.cleanTagValue(newValue);
      }

      if (typeof newValue === 'undefined') return;

      for (const entityID of initEntityIDs) {
        const entity = graph.entity(entityID);
        const asyncTags = { ...entity.tags };  // shallow copy

        if (newValue === null) {  // remove wikipedia tag
          if (!asyncTags[wpkey]) continue;  // no change
          delete asyncTags[wpkey];

        } else {   // replace wikipedia tag
          if (asyncTags[wpkey] === newValue) continue;  // no change
          asyncTags[wpkey] = newValue;
        }

        editor.perform(actionChangeTags(entityID, asyncTags));
      }

      // do not dispatch.call('change') here, because entity_editor
      // changeTags() is not intended to be called asynchronously
    });
  }


  /** Sets the search input's value to the current Wikidata entity's label. */
  protected _setLabelForEntity(): void {
    if (!this.$searchInput) return;   // called too early?

    let label = '';
    if (this._wikidataEntity) {
      label = this._entityPropertyForDisplay(this._wikidataEntity, 'labels');
      const qid = this._wikidataEntity.id as string | null;
      if (qid && label.length === 0) {
        label = qid.toString();
      }
    }
    utilGetSetValue(this.$searchInput, label);
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$searchInput) return;   // called too early?

    const l10n = this.context.systems.l10n!;
    const wikidata = this.context.services.wikidata!;

    const key = this.key;
    const val = tags[key];

    const isMixed = Array.isArray(val);
    this.$searchInput
      .attr('title', isMixed ? (val as string[]).filter(Boolean).join('\n') : null)
      .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : '')
      .classed('mixed', isMixed);

    this._qid = (isMixed ? '' : val) || '';


    if (!/^Q[0-9]*$/.test(this._qid)) {   // not a proper QID
      this._unrecognized();
      return;
    }

    // QID value in correct format
    this._wikiURL = 'https://wikidata.org/wiki/' + this._qid;
    wikidata.entityByQID(this._qid, (err: any, entity: any) => {
      if (!this.$parent || err) {
        this._unrecognized();
        return;
      }
      this._wikidataEntity = entity;

      this._setLabelForEntity();

      const description = this._entityPropertyForDisplay(entity, 'descriptions');

      this.$parent.select('button.wiki-link')
        .classed('disabled', false);

      this.$parent.select('.preset-wikidata-description')
        .style('display', function () {
          return description.length > 0 ? 'flex' : 'none';
        })
        .select('input')
        .attr('value', description);

      this.$parent.select('.preset-wikidata-identifier')
        .style('display', function () {
          return entity.id ? 'flex' : 'none';
        })
        .select('input')
        .attr('value', entity.id);
    });
  }


  /**
   * Not a proper QID - disable the fields
   */
  protected _unrecognized(): void {
    if (!this.$parent) return;   // called too early?

    this._wikidataEntity = null;
    this._setLabelForEntity();

    this.$parent.select('.preset-wikidata-description')
      .style('display', 'none');
    this.$parent.select('.preset-wikidata-identifier')
      .style('display', 'none');

    this.$parent.select('button.wiki-link')
      .classed('disabled', true);

    if (this._qid !== '') {
      this._wikiURL = `https://wikidata.org/wiki/Special:Search?search=${this._qid}`;
    } else {
      this._wikiURL = '';
    }
  }


  /**
   * Returns the best localized value for a Wikidata entity property (e.g. label, description).
   * @param wikidataEntity  - The Wikidata entity object
   * @param propKey         - The property to read (e.g. `labels`, `descriptions`)
   * @returns The value in the user's preferred language, or any available value
   */
  protected _entityPropertyForDisplay(wikidataEntity: Record<string, unknown>, propKey: string): string {
    const wikidata = this.context.services.wikidata!;

    const propObj = wikidataEntity[propKey] as any;
    if (!propObj) return '';

    const langKeys = Object.keys(propObj);
    if (langKeys.length === 0) return '';

    // sorted by priority, since we want to show the user's language first if possible
    const langs = wikidata.languagesToQuery();
    for (const lang of langs) {
      const valueObj = propObj[lang];
      if (valueObj && valueObj.value && valueObj.value.length > 0) return valueObj.value;
    }
    // default to any available value
    return propObj[langKeys[0]].value;
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$searchInput) return;   // called too early?
    const node = this.$searchInput.node() as HTMLInputElement | null;
    node?.focus();
  }
}
