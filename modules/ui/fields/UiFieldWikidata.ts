import { select as d3_select } from 'd3-selection';

import { actionChangeTags } from '../../actions/change_tags.js';
import { uiIcon } from '../icon.js';
import { UiField } from '../UiField.js';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';
import { uiCombobox } from '../combobox.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.js';


export class UiFieldWikidata extends UiField {
    public $parent: D3Selection;
    public $searchInput: D3Selection;
    protected _qid: string | null;
    protected _wikidataEntity: any;
    protected _wikiURL: string;
    protected _wikipediaKey: any;
    protected _hintKey: any;
    protected _combobox: any;

    public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
        super(context, presetField, entityIDs, options);

        this.$parent = d3_select(null);
        this.$searchInput = d3_select(null);
        this._qid = null;
        this._wikidataEntity = null;
        this._wikiURL = '';

        this._wikipediaKey = this.keys && this.keys.find(function(key: string) {
            return key.includes('wikipedia');
        });
        this._hintKey = this.key === 'wikidata' ? 'name' : this.key.split(':')[0];

        this._combobox = uiCombobox(context, 'combo-' + this.safeid)
            .caseSensitive(true)
            .minItems(1);

        this.renderContent = this.renderContent.bind(this);
        this._fetchWikidataItems = this._fetchWikidataItems.bind(this);
    }


    /**
     * Renders the field into the given selection.
     * Captures the selection in `this.$parent` on each render so other methods
     *  (e.g. the wikidata lookup callbacks) can re-render the field in place.
     * @param $selection - A d3-selection to the HTMLElement this field renders into
     */
    public renderContent($selection: D3Selection): void {
        const l10n = this.context.systems.l10n!;
        const combobox = this._combobox;

        this.$parent = $selection;

        let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
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
            .on('focus', (d3_event: Event) => {
                const node = d3_select(d3_event.currentTarget as any).node() as HTMLInputElement;
                node.setSelectionRange(0, node.value.length);
            })
            .on('blur', () => {
                this._setLabelForEntity();
            })
            .call(combobox.fetcher(this._fetchWikidataItems));

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
            .on('click', (d3_event: Event) => {
                d3_event.preventDefault();
                if (this._wikiURL) window.open(this._wikiURL, '_blank');
            });

        $searchRow = $searchRow.merge($$searchRow);
        $searchRow.select('button.wiki-link')
            .attr('title', l10n.t('icons.view_on', { domain: 'wikidata.org' }));

        this.$searchInput = $searchRow.select('input');

        const wikidataProperties = ['description', 'identifier'];

        let $items: D3Selection = $list.selectAll('li.labeled-input')
            .data(wikidataProperties);

        // Enter
        const $$enter = $items.enter()
            .append('li')
            .attr('class', function(d) { return 'labeled-input preset-wikidata-' + d; });

        $$enter
            .append('div')
            .attr('class', 'label');

        $$enter
            .append('input')
            .attr('type', 'text')
            .call(utilNoAuto)
            .classed('disabled', 'true' as any)
            .attr('readonly', 'true');

        $$enter
            .append('button')
            .attr('class', 'form-field-button')
            .call(uiIcon('#rapid-operation-copy'))
            .on('click', (d3_event: Event) => {
                d3_event.preventDefault();
                (d3_select((d3_event.currentTarget as any).parentNode)
                    .select('input')
                    .node() as HTMLInputElement)
                    .select();
                document.execCommand('copy');
            });

        // update — set localized text here so it re-localizes on language change
        $items = $items.merge($$enter);
        $items.select('.label')
            .html(function(d) { return l10n.tHtml('wikidata.' + d); });
        $items.select('button.form-field-button')
            .attr('title', l10n.t('icons.copy'));
    }


    /**
     * Fetches Wikidata search results for the combobox.
     * @param q         - The search query; if empty, falls back to other tag values as search terms
     * @param callback  - Receives the list of matching Wikidata items
     */
    protected _fetchWikidataItems(q: string, callback?: (result: any[]) => void): void {
        const editor = this.context.systems.editor!;
        const wikidata = this.context.services.wikidata as any;

        if (!q && this._hintKey) {
            // other tags may be good search terms
            const graph = editor.staging.graph;
            for (const i in this.entityIDs) {
                const entity = graph.hasEntity(this.entityIDs[i]) as any;
                if (entity.tags[this._hintKey]) {
                    q = entity.tags[this._hintKey];
                    break;
                }
            }
        }

        wikidata.itemsForSearchQuery(q, function(err: any, data: any) {
            if (err) return;

            const result = data.map(function(item: any) {
                return {
                    id:    item.id,
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
      const context = this.context;
      const editor = context.systems.editor!;
      const wikidata = context.services.wikidata as any;

      const key = this.key;
      const syncTags: Tags = {};
      syncTags[key] = this._qid ?? undefined;
      this.emit('change', syncTags);

      if (!this._wikipediaKey) return;

      // attempt asynchronous update of wikipedia tag..
      const initGraph = editor.staging.graph;
      const initEntityIDs = this.entityIDs;

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
            if (!asyncTags[this._wikipediaKey]) continue;  // no change
            delete asyncTags[this._wikipediaKey];

          } else {   // replace wikipedia tag
            if (asyncTags[this._wikipediaKey] === newValue) continue;  // no change
            asyncTags[this._wikipediaKey] = newValue;
          }

          editor.perform(actionChangeTags(entityID, asyncTags));
        }

        // do not dispatch.call('change') here, because entity_editor
        // changeTags() is not intended to be called asynchronously
      });
    }


    /** Sets the search input's value to the current Wikidata entity's label. */
    protected _setLabelForEntity(): void {
        let label = '';
        if (this._wikidataEntity) {
            label = this._entityPropertyForDisplay(this._wikidataEntity, 'labels');
            if (label.length === 0) {
                label = this._wikidataEntity.id.toString();
            }
        }
        utilGetSetValue(this.$searchInput, label);
    }


    /**
     * Updates the field UI to reflect the given entity tags.
     * @param tags - The entity tags to display
     */
    public syncTags(tags: Tags): void {
        const l10n = this.context.systems.l10n!;
        const wikidata = this.context.services.wikidata as any;

        const key = this.key;
        const t: any = tags;
        const isMixed = Array.isArray(tags[key]);
        this.$searchInput
            .attr('title', isMixed ? (tags[key] as string[]).filter(Boolean).join('\n') : null)
            .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : '')
            .classed('mixed', isMixed);

        this._qid = typeof tags[key] === 'string' && t[key] || '';

        // not a proper QID
        const unrecognized = (): void => {
            this._wikidataEntity = null;
            this._setLabelForEntity();

            this.$parent.select('.preset-wikidata-description')
                .style('display', 'none');
            this.$parent.select('.preset-wikidata-identifier')
                .style('display', 'none');

            this.$parent.select('button.wiki-link')
                .classed('disabled', true);

            if (this._qid && this._qid !== '') {
                this._wikiURL = 'https://wikidata.org/wiki/Special:Search?search=' + this._qid;
            } else {
                this._wikiURL = '';
            }
        };

        if (!/^Q[0-9]*$/.test(this._qid as string)) {   // not a proper QID
            unrecognized();
            return;
        }

        // QID value in correct format
        this._wikiURL = 'https://wikidata.org/wiki/' + this._qid;
        wikidata.entityByQID(this._qid, (err: any, entity: any) => {
            if (err) {
                unrecognized();
                return;
            }
            this._wikidataEntity = entity;

            this._setLabelForEntity();

            const description = this._entityPropertyForDisplay(entity, 'descriptions');

            this.$parent.select('button.wiki-link')
                .classed('disabled', false);

            this.$parent.select('.preset-wikidata-description')
                .style('display', function(){
                    return description.length > 0 ? 'flex' : 'none';
                })
                .select('input')
                .attr('value', description);

            this.$parent.select('.preset-wikidata-identifier')
                .style('display', function(){
                    return entity.id ? 'flex' : 'none';
                })
                .select('input')
                .attr('value', entity.id);
        });
    }


    /**
     * Returns the best localized value for a Wikidata entity property (e.g. label, description).
     * @param wikidataEntity  - The Wikidata entity object
     * @param propKey         - The property to read (e.g. `labels`, `descriptions`)
     * @returns The value in the user's preferred language, or any available value
     */
    protected _entityPropertyForDisplay(wikidataEntity: any, propKey: string): string {
        const wikidata = this.context.services.wikidata as any;

        if (!wikidataEntity[propKey]) return '';
        const propObj = wikidataEntity[propKey];
        const langKeys = Object.keys(propObj);
        if (langKeys.length === 0) return '';
        // sorted by priority, since we want to show the user's language first if possible
        const langs = wikidata.languagesToQuery();
        for (const i in langs) {
            const lang = langs[i];
            const valueObj = propObj[lang];
            if (valueObj && valueObj.value && valueObj.value.length > 0) return valueObj.value;
        }
        // default to any available value
        return propObj[langKeys[0]].value;
    }


    /** Moves keyboard focus to the field's input. */
    public focus(): void {
        (this.$searchInput.node() as HTMLElement).focus();
    }
}
