import { EventEmitter } from 'tseep/lib/ee-safe';
import { marked } from 'marked';
import { uiIcon } from './icon.ts';
import { UiCombobox } from './UiCombobox.ts';
import { UiModal } from './UiModal.ts';
import { utilNoAuto, utilSafeURL, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';

const MAXRESULTS = 100;


/**
 * `UiRapidCatalog` is a Modal control where the user can browse the
 * catalog of Rapid datasets.
 *
 * Events available:
 * - `done`:  Fires when the user is finished and they are closing this Modal
 */
export class UiRapidCatalog extends EventEmitter {
  public context: Context;

  // Child components
  public CategoryCombo: UiCombobox;
  public Modal: UiModal | null;

  protected _filterText: string | null;
  protected _filterCategory: string | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._filterText = null;
    this._filterCategory = null;

    // Child components
    this.CategoryCombo = new UiCombobox(context, 'rapid-dark');
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderDatasets = this.renderDatasets.bind(this);
    this.sortCategories = this.sortCategories.bind(this);
    this.sortDatasets = this.sortDatasets.bind(this);
    this.toggleDataset = this.toggleDataset.bind(this);
    this.highlight = this.highlight.bind(this);

    // Setup event handlers
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this.render);
  }


  /**
   * This shows the catalog if it isn't already being shown.
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;

    if (this.Modal?.isShown) return;

    this.Modal = new UiModal(context).show();
    this.Modal.$modal!
      .attr('class', 'modal rapid-modal wide modal-catalog');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();
  }


  /**
   * Dismisses and removes the Modal, if it exists.
   * @param [e] - the triggering event, if any
   */
  public close(e?: Event): void {
    e?.preventDefault();
    this.Modal?.close();
  }


  /**
   * Emits a 'done' event and cleans up the Modal.
   * All the various ways of closing the Modal end up here.
   */
  protected _done(): void {
    this.emit('done');
    this.Modal = null;
    this._filterText = null;
    this._filterCategory = null;
  }


  /**
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - the owned modal is always the parent.
   */
  public render(): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.Modal.$content!;

    /* Heading section */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    const $$heading: D3EnterSelection = $heading.enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('div')
      .attr('class', 'modal-heading-icon')
      .call(uiIcon('#rapid-icon-data', 'icon-30'));

    const $$headingText: D3EnterSelection = $$heading
      .append('div')
      .attr('class', 'modal-heading-text');

    $$headingText
      .append('h1');

    $$headingText
      .append('div')
      .attr('class', 'rapid-catalog-heading-about');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading-text h1')
      .text(l10n.t('rapid_catalog.heading'));

    $heading.selectAll('.rapid-catalog-heading-about')
      .html(utilSanitizeHTML(marked.parse(l10n.t('rapid_catalog.about_the_catalog')) as string));

    $heading.selectAll('.rapid-catalog-heading-about a')
      .attr('target', '_blank');   // make sure the markdown links go to a new page


    /* Filter section */
    let $filter: D3Selection = $content.selectAll('.rapid-catalog-filter')
      .data([0]);

    // enter
    const $$filter: D3EnterSelection = $filter.enter()
      .append('div')
      .attr('class', 'modal-section rapid-catalog-filter');

    const $$filterSearch: D3EnterSelection = $$filter
      .append('div')
      .attr('class', 'rapid-catalog-filter-search-wrap');

    $$filterSearch
      .call(uiIcon('#fas-filter', 'inline'));

    $$filterSearch
      .append('input')
      .attr('class', 'rapid-catalog-filter-search')
      .call(utilNoAuto)
      .on('input', (e: InputEvent) => {
        const element = e.currentTarget as HTMLInputElement;
        const val = (element && element.value) || '';
        this._filterText = val.trim().toLowerCase();
        $datasets.call(this.renderDatasets);
      });

    // set focus (but only on enter)
    const inputNode = $$filterSearch.selectAll('.rapid-catalog-filter-search').node() as HTMLElement | null;
    inputNode?.focus();

    const $$filterType: D3EnterSelection = $$filter
      .append('div')
      .attr('class', 'rapid-catalog-filter-type-wrap');

    $$filterType
      .append('input')
      .attr('class', 'rapid-catalog-filter-type')
      .call(utilNoAuto)
      .call(this.CategoryCombo.attach)
      .on('blur change', (e: Event) => {
        const element = e.currentTarget as HTMLInputElement;
        const val = (element && element.value) || '';
        const data = this.CategoryCombo.data();
        if (data.some(item => item.value === val)) {  // only allow picking values from the list
          this._filterCategory = val;
        } else {
          element.value = '';
          this._filterCategory = null;
        }
        $datasets.call(this.renderDatasets);
      });

    $$filter
      .append('div')
      .attr('class', 'rapid-catalog-filter-clear')
      .append('a')
      .attr('href', '#')
      .on('click', (e: PointerEvent) => {
        e.preventDefault();
        const element = e.currentTarget as HTMLElement;
        element.blur();
        $content.selectAll('input').property('value', '');
        this._filterText = null;
        this._filterCategory = null;
        $datasets.call(this.renderDatasets);
      });

    $$filter
      .append('div')
      .attr('class', 'rapid-catalog-filter-results');

    // update
    $filter = $filter.merge($$filter);

    $filter.selectAll('.rapid-catalog-filter-search')
      .attr('placeholder', l10n.t('rapid_catalog.filter_datasets'));

    $filter.selectAll('.rapid-catalog-filter-type')
      .attr('placeholder', l10n.t('rapid_catalog.any_type'));

    $filter.selectAll('.rapid-catalog-filter-clear > a')
      .text(l10n.t('rapid_catalog.clear_filters'));


    /* Dataset section */
    let $datasets: D3Selection = $content.selectAll('.rapid-catalog-datasets-section')
      .data([0]);

    // enter
    const $$datasets: D3EnterSelection = $datasets.enter()
      .append('div')
      .attr('class', 'modal-section rapid-catalog-datasets-section');

    $$datasets
      .append('div')
      .attr('class', 'rapid-catalog-datasets-status');

    $$datasets
      .append('div')
      .attr('class', 'rapid-catalog-datasets');

    // update
    $datasets = $datasets.merge($$datasets);

    $datasets
      .call(this.renderDatasets);


    /* OK Button */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons: D3EnterSelection = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click', this.close);

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons.selectAll('.button')
      .text(l10n.t('text.okay'));
  }


  /**
   * Renders datasets details into the `.rapid-catalog-datasets-section` div.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderDatasets($selection: D3Selection): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;
    const settings = context.systems.settings;
    const $content = this.Modal.$content!;

    const showPreview = rapid.isPoweruser() && settings?.get('poweruser.previewDatasets') === 'true';

    const $status: D3Selection = $selection.selectAll('.rapid-catalog-datasets-status');
    const $results: D3Selection = $selection.selectAll('.rapid-catalog-datasets');

    if (!rapid.catalog.size) {
      $results.classed('hide', true);
      $status.classed('hide', false).text(l10n.t('rapid_catalog.no_datasets'));
      return;
    }

    $results.classed('hide', false);
    $status.classed('hide', true);

    // Update categories combo
    // (redo it every time, in case the user toggles preview datasets on/off)
    const categories = new Set(rapid.categories);  // make copy
    if (!showPreview) {
      categories.delete('preview');
    }

    const comboData = [...categories].sort().map(d => {
      const display = l10n.t(`rapid_catalog.category.${d}`, { default: d });
      const item = { display: display, title: d, value: d };
      if (d === 'preview') {
        item.display = `${display} <span class="dataset-beta beta"></span>`;
      }
      return item;
    });

    this.CategoryCombo.data(comboData);

    // Gather datasets..
    let count = 0;
    const datasets = [...rapid.catalog.values()]
      .filter(d => !d.hidden && (showPreview || !d.beta))
      .sort(this.sortDatasets);

    // Apply filters..
    for (const d of datasets) {
      const label = d.getLabel().toLowerCase();
      const description = d.getDescription().toLowerCase();

      if (this._filterText && !label.includes(this._filterText) && !description.includes(this._filterText)) {
        d.filtered = true;   // filterText not found anywhere in `label` or `description`
        continue;
      }
      if (this._filterCategory && !(d.categories.has(this._filterCategory))) {
        d.filtered = true;   // filterCategory not found anywhere in `categories`
        continue;
      }

      d.filtered = (++count > MAXRESULTS);
    }

    // The datasets
    let $datasets: D3Selection = $results.selectAll('.rapid-catalog-dataset')
      .data(datasets, (d: RapidDataset) => d.id);

    // exit
    $datasets.exit()
      .remove();

    // enter
    const $$datasets: D3EnterSelection = $datasets.enter()
      .append('div')
      .attr('class', 'rapid-catalog-dataset');

    const $$label: D3EnterSelection = $$datasets
      .append('div')
      .attr('class', 'dataset-label');

    $$label
      .append('div')
      .attr('class', 'dataset-name');

    const $$categories: D3EnterSelection = $$label
      .append('div')
      .attr('class', 'dataset-categories');

    $$categories.selectAll('.dataset-category')
      .data((d: RapidDataset) => {
        const categories = new Set(d.categories);  // make copy
        if (d.beta) categories.add('preview');     // make sure beta datasets have 'preview' category
        return [...categories].sort(this.sortCategories);
      }, (d: any) => d)
      .enter()
      .append('div')
      .attr('class', (d: string) => {
        // include 'beta' class for preview category
        return `dataset-category dataset-category-${d}` + (d === 'preview' ? ' beta' : '');
      });

    $$label
      .append('div')
      .attr('class', 'dataset-snippet');

    const $$link: D3EnterSelection = $$label
      .filter((d: RapidDataset) => !!d.itemUrl)
      .append('div')
      .attr('class', 'dataset-more-info')
      .append('a')
      .attr('class', 'dataset-link')
      .attr('target', '_blank')
      .attr('href', (d: RapidDataset) => utilSafeURL(d.itemUrl));

    $$link
      .append('span')
      .attr('class', 'dataset-link-text');

    $$link
      .call(uiIcon('#rapid-icon-out-link', 'inline'));

    $$label
      .append('div')
      .attr('class', 'dataset-added-text');

    $$label
      .append('button')
      .attr('class', 'dataset-action')
      .on('click', this.toggleDataset);

    const $$thumbnail: D3EnterSelection = $$datasets
      .append('div')
      .attr('class', 'dataset-thumb');

    $$thumbnail
      .append('img')
      .attr('class', 'dataset-thumbnail');

    // update
    $datasets = $datasets.merge($$datasets).order();

    $datasets
      .classed('added', (d: RapidDataset) => d.added)
      .classed('hide', (d: RapidDataset) => d.filtered);

    $datasets.selectAll('.dataset-name')
      .html(d => this.highlight(this._filterText, d.getLabel()));

    $datasets.selectAll('.dataset-link-text')
      .text(l10n.t('rapid_catalog.more_info'));

    $datasets.selectAll('.dataset-category')
      .text((d: string) => {
        if (d === 'preview') return '';
        const star = (d === 'featured') ? '\u2b50 ' : '';   // 2b50 = emoji star
        const text = l10n.t(`rapid_catalog.category.${d}`, { default: d });
        return star + text;
      });

    $datasets.selectAll('.dataset-category-preview')
      .attr('title', l10n.t('rapid_poweruser.beta'));  // alt text

    $datasets.selectAll('.dataset-snippet')
      .html(d => this.highlight(this._filterText, d.getDescription()));

    $datasets.selectAll('.dataset-thumbnail')
      .classed('inverted', (d: RapidDataset) => d.categories.has('esri'))  // invert colors from light->dark
      .style('background', (d: RapidDataset) => d.categories.has('esri') ? null : d.color)
      .attr('src', (d: RapidDataset) => utilSafeURL(d.thumbnailUrl));

    $datasets.selectAll('.dataset-added-text')
      .text((d: RapidDataset) => d.added ? '\u2705 ' + l10n.t('rapid_catalog.dataset_added') : '');  // 2705 = emoji check

    $datasets.selectAll('.dataset-action')
      .text((d: RapidDataset) => d.added ? l10n.t('rapid_catalog.remove_dataset') : l10n.t('rapid_catalog.add_dataset'));

    // update the count
    const n = datasets.filter((d: RapidDataset) => !d.filtered).length;
    const gt = (count > MAXRESULTS) ? '>' : '';
    $content.selectAll('.rapid-catalog-filter-results')
      .text(l10n.t('rapid_catalog.datasets_found', { n: n, gt: gt }));
  }


  /**
   * Sort the datasets in the catalog.
   * Featured datasets first, all others sort by name.
   * @param  a - first dataset to compare
   * @param  b - second dataset to compare
   * @return comparison result: -1, 0, 1
   */
  public sortDatasets(a: RapidDataset, b: RapidDataset): number {
    return (a.featured && !b.featured) ? -1
      : (b.featured && !a.featured) ? 1
      : a.label.localeCompare(b.label);
  }


  /**
   * Sort the categories that appear on a dataset card.
   * Featured before everything else, preview after everything else, all others sort alphabetically.
   * @param  a - first category to compare
   * @param  b - second category to compare
   * @return comparison result: -1, 0, 1
   */
  public sortCategories(a: string, b: string): number {
    return (a === 'featured' && b !== 'featured') ? -1
      : (b === 'featured' && a !== 'featured') ? 1
      : (a === 'preview' && b !== 'preview') ? 1
      : (b === 'preview' && a !== 'preview') ? -1
      : a.localeCompare(b);
  }


  /**
   * Toggles the given dataset between added/removed.
   * @param  [e] - the triggering event, if any
   * @param  d - bound datum (the dataset in this case)
   */
  public toggleDataset(e: Event, d: RapidDataset) {
    const context = this.context;
    const rapid = context.systems.rapid!;
    const addedIDs = rapid.addedDatasetIDs;

    if (addedIDs.has(d.id)) {
      rapid.removeDatasets(d.id);  // remove from menu and disable/uncheck
    } else {
      rapid.enableDatasets(d.id);  // add to menu and enable/check
      // If adding an Esri building dataset, disable the Microsoft buildings to avoid clutter
      if (d.categories.has('esri') && d.categories.has('buildings') && addedIDs.has('msBuildings')) {
        rapid.disableDatasets('msBuildings');
      }
    }
    context.enter('browse');   // return to browse mode (in case something was selected)
    this.render();
  }


  /**
   * Wraps occurrences of `needle` within `haystack` in `<mark>` tags for highlighting.
   * @param  needle - the search text to highlight (if any)
   * @param  haystack - the text to search within
   * @return An HTML string with matches wrapped in `<mark>` tags
   */
  public highlight(needle: any, haystack: any) {
    let html = utilSanitizeHTML(haystack);
    if (needle) {
      const re = new RegExp('\(' + _escapeRegex(needle) + '\)', 'gi');
      html = html.replace(re, '<mark>$1</mark>');
    }

    return html;

    function _escapeRegex(s: any) {
      return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
  }

}
