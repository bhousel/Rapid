import { EventEmitter } from 'tseep/lib/ee-safe';
import { select, selection } from 'd3-selection';
import { actionChangePreset } from '../actions/change_preset.ts';
import { Category, Preset } from '../lib/index.ts';
import { operationDelete } from '../operations/delete.js';
import { uiIcon } from './icon.ts';
import { UiPresetIcon } from './UiPresetIcon.ts';
import { UiTagReference } from './UiTagReference.ts';
import { UiTooltip } from './UiTooltip.ts';
import { utilKeybinding, utilNoAuto, utilTotalExtent } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { Vec2 } from '@rapid-sdk/math';

const MAXSEARCH = 50;   // how many search results to show


/**
 * `UiPresetList` renders a searchable list of Presets/Categories that the user can
 * choose from to assign a feature type to the selected entities.
 */
export class UiPresetList extends EventEmitter {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;
  public $list: D3Selection | null;
  public $input: D3Selection | null;

  protected _entityIDs: EntityID[];
  protected _currLoc: Vec2 | null;
  protected _allGeometries: GeometryType[];
  protected _defaults: (Preset | Category)[];
  protected _selectedPresetIDs: Set<string>;
  protected _autofocus: boolean;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // D3 selections
    this.$parent = null;
    this.$list = null;
    this.$input = null;

    this._entityIDs = [];
    this._currLoc = null;
    this._allGeometries = [];
    this._defaults = [];
    this._selectedPresetIDs = new Set<string>();
    this._autofocus = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._drawList = this._drawList.bind(this);
    this._itemKeydown = this._itemKeydown.bind(this);
    this._checkFilteringRules = this._checkFilteringRules.bind(this);
    this._searchInitialKeydown = this._searchInitialKeydown.bind(this);
    this._searchKeydown = this._searchKeydown.bind(this);
    this._searchKeypress = this._searchKeypress.bind(this);
    this._searchInput = this._searchInput.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * @param  $parent - parent selection to render into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;
    const $selection = this.$parent;

    if (!this._entityIDs.length) return;

    const isRTL = l10n.isRTL;

    // Header
    let $header: D3Selection = $selection.selectAll('.header')
      .data([0]);

    // Enter
    const $$header = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('h3')
      .attr('class', 'preset-list-message');

    $$header
      .append('button')
      .attr('class', 'preset-choose')
      .on('click', () => this.emit('cancel'))
      .call(uiIcon(isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward'));

    // update
    $header = $header.merge($$header);
    $header.select('.preset-list-message')
      .text(l10n.t('inspector.choose'));


    // Search box
    let $search: D3Selection = $selection.selectAll('.search-header')
      .data([0]);

    const $$search = $search.enter()
      .append('div')
      .attr('class', 'search-header');

    $$search
      .call(uiIcon('#rapid-icon-search'));

    $$search
      .append('input')
      .attr('class', 'preset-search-input')
      .attr('type', 'search')
      .call(utilNoAuto)
      .on('keydown', this._searchInitialKeydown)
      .on('keypress', this._searchKeypress)
      .on('input', () => {
        if (scheduler) {
          scheduler.debounce('PresetList-searchInput', this._searchInput);
        } else {
          this._searchInput();
        }
      });

    // update
    $search = $search.merge($$search);
    this.$input = $search.selectAll('.preset-search-input');
    this.$input.attr('placeholder', l10n.t('text.search'));

    if (this._autofocus) {
      // Safari 14 doesn't always like to focus immediately, so schedule it with setTimeout
      setTimeout(() => (this.$input?.node() as HTMLElement)?.focus(), 0);
    }


    // Preset List
    const $listWrap: D3Selection = $selection.selectAll('.inspector-body')
      .data([0]);

    // enter
    const $$listWrap = $listWrap.enter()
      .append('div')
      .attr('class', 'inspector-body');

    $$listWrap
      .append('div')
      .attr('class', 'preset-list-main preset-list');

    // update
    this.$list = $listWrap.merge($$listWrap)
      .selectAll('.preset-list-main')
      .call(this._drawList, this._defaults);

    // rebind event listener
    filters.off('filterchange', this._checkFilteringRules);
    filters.on('filterchange', this._checkFilteringRules);
  }


  /**
   * keydown handler for the search field on initial focus.
   * Handles the delete/undo shortcut hacks, then delegates to `_searchKeydown`.
   * @param  e - the keydown event
   */
  protected _searchInitialKeydown(e: KeyboardEvent): void {
    if (!this.$input) return;  // called too soon?

    const context = this.context;
    const editor = context.systems.editor!;
    const el = e.currentTarget as HTMLElement;
    const val = this.$input.property('value');

    // hack to let delete shortcut work when search is autofocused
    if (val.length === 0 &&
      (e.keyCode === utilKeybinding.keyCodes['⌫'] ||
       e.keyCode === utilKeybinding.keyCodes['⌦'])) {
      e.preventDefault();
      e.stopPropagation();
      operationDelete(context, this._entityIDs)();

    // hack to let undo work when search is autofocused
    } else if (val.length === 0 &&
      (e.ctrlKey || e.metaKey) &&
      e.keyCode === utilKeybinding.keyCodes.z) {
      e.preventDefault();
      e.stopPropagation();
      editor.undo();

    } else if (!e.ctrlKey && !e.metaKey) {
      // don't check for delete/undo hack on future keydown events
      select(el).on('keydown', this._searchKeydown);
      this._searchKeydown(e);
    }
  }


  /**
   * keydown handler for the search field.
   * Down arrow moves focus into the preset list.
   * @param  e - the keydown event
   */
  protected _searchKeydown(e: KeyboardEvent): void {
    if (!this.$input || !this.$list) return;  // called too soon?

    if (e.keyCode === utilKeybinding.keyCodes['↓'] &&       // down arrow
      // if insertion point is at the end of the string
      (this.$input.node() as HTMLInputElement).selectionStart === this.$input.property('value').length
    ) {
      e.preventDefault();
      e.stopPropagation();
      // move focus to the first item in the preset list
      const $buttons = this.$list.selectAll('.preset-list-button');
      if (!$buttons.empty()) {
        ($buttons.node() as HTMLElement).focus();
      }
    }
  }


  /**
   * keypress handler for the search field.
   * Return chooses the first item in the list.
   * @param  e - the keypress event
   */
  protected _searchKeypress(e: KeyboardEvent): void {
    if (!this.$list) return;  // called too soon?

    const val = (e.currentTarget as HTMLInputElement).value;
    if (e.keyCode === 13 && val.length) {  // ↩ Return
      const item = this.$list.selectAll('.preset-list-item:first-child').datum() as ListItem;
      item.choose();
    }
  }


  /**
   * Runs the search for the current query and redraws the list.
   */
  protected _searchInput(): void {
    if (!this.$input || !this.$list) return;  // called too soon?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    const query = this.$input.property('value');
    this.$list.classed('filtered', query.length);

    let items: (Preset | Category)[];
    let messageText: string;
    if (query.length) {  // do search
      const fallbackCount = this._allGeometries.length;
      const maxCount = MAXSEARCH - fallbackCount;
      const results = schema.search(query, this._allGeometries, this._currLoc);

      messageText = l10n.t('inspector.results', { n: results.length, search: query });
      items = results.map((result: { id: PresetID }) => {
        const scope = schema.getScope('osm');
        return scope?.presets.get(result.id) ?? scope?.categories.get(result.id);
      }).slice(0, maxCount) as (Preset | Category)[];

      // Append fallback preset(s)
      for (const geom of this._allGeometries) {
        const fallback = schema.getFallback(geom);
        if (fallback) {
          items.push(fallback);
        }
      }

    } else {   // show defaults
      messageText = l10n.t('inspector.choose');
      items = this._defaults;
    }

    this.$list.call(this._drawList, items);

    (this.$parent as D3Selection).selectAll('.preset-list-message')
      .text(messageText);
  }



  /**
   * Draws the list of Presets/Categories.
   * The category items themselves may also contain sublists.
   * @param  $selection  - parent selection to render list items into (in this case, a `div.preset-list`)
   * @param  arr - Categories and Presets to include in the list
   */
  protected _drawList($selection: D3Selection, arr: (Preset | Category)[]): void {
    const data: ListItem[] = [];
    for (const item of arr) {
      if (item instanceof Category) {
        data.push(new CategoryItem(this, item));
      } else if (item instanceof Preset) {
        data.push(new PresetItem(this, item));
      }
    }

    // Select direct descendant list items only...
    // Because `d3.selectAll` uses `element.querySelectorAll`, `:scope` refers to self
    // see https://developer.mozilla.org/en-US/docs/Web/CSS/:scope
    let $items: D3Selection = $selection.selectAll(':scope > .preset-list-item')
      .data(data, (d: ListItem) => d.item.id);

    // exit
    $items.exit()
      .remove();

    // enter
    const $$items = $items.enter()
      .append('div')
      .attr('class', (d: ListItem) => `preset-list-item preset-${d.item.safeid}`)
      .style('opacity', 0)
      .transition()
      .style('opacity', 1);

    // update
    $items = $items.merge($$items as any)
      .order()   // make them match the order of `arr`
      .each((d: ListItem, i, nodes) => select(nodes[i]).call(d.render))
      .classed('current', (d: ListItem) => this._selectedPresetIDs.has(d.item.id));

    this._checkFilteringRules();
  }


  /**
   * keydown handler for the preset list
   * This allows users to use keyboard navigation to focus different items and expand/contract Categories.
   * @param  e - the keydown event
   */
  public _itemKeydown(e: KeyboardEvent): void {
    if (!this.$input) return;  // called too soon?

    const l10n = this.context.systems.l10n!;
    const target = e.currentTarget as HTMLElement;
    const $selection = select(target);

    // the actively focused item
    const $item = select(target.closest('.preset-list-item'));
    const node = $item.node() as HTMLElement;
    const $parentItem = select((node.parentNode as HTMLElement).closest('.preset-list-item'));
    const parentNode = $parentItem.node() as HTMLElement | null;
    const isRTL = l10n.isRTL;

    // arrow down, move focus to the next, lower item
    if (e.keyCode === utilKeybinding.keyCodes['↓']) {
      e.preventDefault();
      e.stopPropagation();

      // the next item in the list at the same level
      let $nextItem = select(node.nextElementSibling);

      // if there is no next item in this list
      if ($nextItem.empty()) {
        if (parentNode) {        // if there is a parent item
          // the item is the last item of a sublist, select the next item at the parent level
          $nextItem = select(parentNode.nextElementSibling);
        }
      } else if ($selection.classed('expanded')) {                           // if the focused item is expanded
        $nextItem = $item.select('.subgrid .preset-list-item:first-child');  // select the first subitem instead
      }

      if (!$nextItem.empty()) {
        ($nextItem.select('.preset-list-button').node() as HTMLElement).focus();    // focus on the next item
      }

    // arrow up, move focus to the previous, higher item
    } else if (e.keyCode === utilKeybinding.keyCodes['↑']) {
      e.preventDefault();
      e.stopPropagation();

      // the previous item in the list at the same level
      let $prevItem = select(node.previousElementSibling);

      // if there is no previous item in this list
      if ($prevItem.empty()) {
        if (!$parentItem.empty()) {   // if there is a parent item
          $prevItem = $parentItem;    // the item is the first subitem of a sublist select the parent item
        }
      } else if ($prevItem.select('.preset-list-button').classed('expanded')) { // if the previous item is expanded
        // select the last subitem of the sublist of the previous item
        $prevItem = $prevItem.select('.subgrid .preset-list-item:last-child');
      }

      if (!$prevItem.empty()) {
        ($prevItem.select('.preset-list-button').node() as HTMLElement).focus();     // focus on the previous item
      } else {
        // the focus is at the top of the list, move focus back to the search field
        (this.$input.node() as HTMLElement).focus();
      }

    // arrow left, move focus to the parent item if there is one
    } else if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '→' : '←']) {
      e.preventDefault();
      e.stopPropagation();
      if (!$parentItem.empty()) {     // if there is a parent item, focus on the parent item
        ($parentItem.select('.preset-list-button').node() as HTMLElement).focus();
      }

    // arrow right, choose this item
    } else if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '←' : '→']) {
      e.preventDefault();
      e.stopPropagation();
      ($item.datum() as ListItem).choose();
    }
  }


  /**
   * Applies the current filtering rules, disabling and tooltipping any hidden presets.
   */
  protected _checkFilteringRules(): void {
    if (!this.$list) return;  // called too soon?

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    if (!this._entityIDs.every(entityID => graph.hasEntity(entityID))) return;

    const $buttons = this.$list.selectAll('.preset-list-button');

    // remove existing tooltips
    $buttons.call(new UiTooltip(context).destroyAny);

    $buttons.each((d: ListItem, i, nodes) => {
      const $selection = select(nodes[i]);

      let filterID;  // check whether this preset would be hidden by the current filtering rules
      for (const geometry of this._allGeometries) {
        filterID = filters.isHiddenPreset(d.item as any, geometry);
        if (filterID) break;
      }

      const isHidden = !!(filterID && !context.inIntro && !this._selectedPresetIDs.has(d.item.id));

      $selection
        .classed('disabled', isHidden);

      if (isHidden) {
        $selection.call(new UiTooltip(context)
          .title(l10n.t('filters.hidden_preset.manual', { features: l10n.t(`filters.${filterID}.description`) }))
          .placement(i < 2 ? 'bottom' : 'top')
          .attach
        );
      }
    });
  }


  /**
   * Get or set whether the search field should autofocus on render.
   * @param  [val] - the flag to set; if omitted, returns the current value
   */
  public autofocus(val?: boolean): any {
    if (!arguments.length) return this._autofocus;
    this._autofocus = val!;
    return this;
  }


  /**
   * Get or set the entities the preset list is choosing a preset for.
   * @param  [val] - array of EntityIDs to set; if omitted, returns the current ids
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;

    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;

    this._entityIDs = val ?? [];
    this._currLoc = null;
    this._allGeometries = [];
    this._defaults = [];
    this._selectedPresetIDs = new Set();

    this.$input?.property('value', '');
    this.$list?.selectAll('.preset-list-item')?.remove();

    if (this._entityIDs.length) {
      const graph = editor.staging.graph;

      // All locations in the selection
      this._currLoc = utilTotalExtent(this._entityIDs, graph).center();

      // All geometries in the selection
      this._allGeometries = this._gatherGeometries();
      this._defaults = schema.getDefaults(this._allGeometries[0], !context.inIntro, this._currLoc).slice(0, 35);

      // match presets
      for (const entityID of this._entityIDs) {
        const matched = schema.match(graph.entity(entityID), graph);
        if (matched) {
          this._selectedPresetIDs.add(matched.id);
        }
      }
    }

    // reset scroll to top
    if (this.$parent) {
      const element = this.$parent.selectAll('.inspector-body').node() as HTMLElement;
      if (element) {
        element.scroll(0, 0);
      }
    }

    return this;
  }


  /**
   * Get or set the presets that should appear selected/current in the list.
   * @param  [val] - array of presets to set; if omitted, returns the current selected ids
   */
  public selected(val?: (Preset | Category)[]): any {
    if (!arguments.length) return this._selectedPresetIDs;

    this._selectedPresetIDs = new Set();

    if (Array.isArray(val)) {
      for (const preset of val) {
        if (preset?.id) {
          this._selectedPresetIDs.add(preset.id);
        }
      }
    }

    return this;
  }


  /**
   * Gather the geometries present on the selected entities.
   * They will be sorted so that the most represented geometries appear earlier in the list.
   */
  protected _gatherGeometries(): GeometryType[] {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    const counts: Record<string, number> = {};

    for (const entityID of this._entityIDs) {
      const entity = graph.entity(entityID);
      let geometry = entity.geometry(graph);
      // Treat entities on addr:interpolation lines as points, not vertices - iD#3241
      if (geometry === 'vertex' && (entity as any).isOnAddressLine(graph)) {
        geometry = 'point';
      }

      if (!counts[geometry]) {
        counts[geometry] = 0;
      }

      counts[geometry] += 1;
    }

    return Object.keys(counts).sort((geom1, geom2) => counts[geom2] - counts[geom1]) as GeometryType[];
  }
}

/** Union type for CategoryItem and PresetItem (the objects bound as D3 data in the preset list) */
type ListItem = CategoryItem | PresetItem;


/**
 * A list item representing a Category (which can be expanded to reveal a sublist of Presets).
 */
class CategoryItem {
  public list: any;
  public box: D3Selection | null;
  public sublist: D3Selection | null;
  public shown: boolean;
  public item: Category;

  /**
   * @param  list - the owning `UiPresetList`
   * @param  category - the Category this item represents
   */
  public constructor(list: any, category: Category) {
    this.list = list;
    this.box = null;
    this.sublist = null;
    this.shown = false;
    this.item = category;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this._click = this._click.bind(this);
    this._keydown = this._keydown.bind(this);
  }


  /**
   * Renders into the given selection.
   * A fresh instance is created and rendered per row/use, so it renders into
   *  `$selection` rather than capturing `$parent`.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  public render($selection: D3Selection): void {
    const list = this.list;
    const context = list.context;
    const l10n = context.systems.l10n!;
    const category = this.item;
    const isRTL = l10n.isRTL;

    const $$wrap = $selection.selectAll(':scope > .preset-list-button-wrap')
      .data([this], (d: CategoryItem) => d.item.id)
      .enter()
      .append('div')
      .attr('class', 'preset-list-button-wrap category');

    const $$button = $$wrap
      .append('button')
      .attr('class', 'preset-list-button')
      .classed('expanded', false)
      .call(new UiPresetIcon(context)
        .geometry(list._allGeometries.length === 1 && list._allGeometries[0])
        .preset(category).render)
      .on('click', this._click)
      .on('keydown', this._keydown);

    const $$label = $$button
      .append('div')
      .attr('class', 'label')
      .append('div')
      .attr('class', 'label-inner');

    $$label
      .append('div')
      .attr('class', 'namepart')
      .call(uiIcon((isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward'), 'inline'))
      .append('span')
      .text((d: CategoryItem) => d.item.name + '…');

    this.box = $selection
      .append('div')
      .attr('class', 'subgrid')
      .style('max-height', '0px')
      .style('opacity', 0);

    this.box
      .append('div')
      .attr('class', 'arrow');

    this.sublist = this.box
      .append('div')
      .attr('class', 'preset-list preset-list-sub fillL3');
  }

  /**
   * keydown handler for a category item - expands/collapses or delegates to the list.
   * @param  e - the keydown event
   */
  protected _keydown(e: KeyboardEvent): void {
    const l10n = this.list.context.systems.l10n!;
    const target = e.currentTarget as HTMLElement;
    const $selection = select(target);
    if (e.keyCode === utilKeybinding.keyCodes[l10n.isRTL ? '←' : '→']) {  // right arrow, expand the focused item
      e.preventDefault();
      e.stopPropagation();
      if (!$selection.classed('expanded')) {  // if the item isn't expanded
        this._click(e);                       // toggle expansion (expand the item)
      }
    } else if (e.keyCode === utilKeybinding.keyCodes[l10n.isRTL ? '→' : '←']) {   // left arrow, collapse the focused item
      e.preventDefault();
      e.stopPropagation();
      if ($selection.classed('expanded')) {   // if the item is expanded
        this._click(e);                       // toggle expansion (collapse the item)
      }
    } else {
      this.list._itemKeydown(e);
    }
  }

  /**
   * click handler for a category item - toggles the expand/collapse icon and expansion.
   * @param  e - the click event
   */
  protected _click(e: MouseEvent | KeyboardEvent): void {
    const l10n = this.list.context.systems.l10n!;
    const isRTL = l10n.isRTL;
    const target = e.currentTarget as HTMLElement;
    const $selection = select(target);
    const isExpanded = $selection.classed('expanded');
    const iconName = isExpanded ? (isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward') : '#rapid-icon-down';
    $selection.classed('expanded', !isExpanded);
    $selection.selectAll('div.label-inner svg.icon use').attr('href', iconName);
    this.choose();
  }

  /**
   * Toggles the category's sublist open or closed.
   */
  public choose(): void {
    const list = this.list;
    const category = this.item;
    if (!this.box || !this.sublist) return;

    if (this.shown) {
      this.shown = false;
      this.box.transition()
        .duration(200)
        .style('opacity', '0')
        .style('max-height', '0px')
        .style('padding-bottom', '0px');

    } else {
      this.shown = true;
      const items = [];
      const needed = new Set(list._allGeometries);
      for (const item of category.presets) {
        if (!(needed as any).isSubsetOf(item.geometries)) continue;  // skip items that don't support all geometries needed
        items.push(item);
      }
      this.sublist.call(list._drawList, items);
      this.box.transition()
        .duration(200)
        .style('opacity', '1')
        .style('max-height', 200 + items.length * 190 + 'px')
        .style('padding-bottom', '10px');
    }
  }
}


/**
 * A list item representing a single Preset.
 */
class PresetItem {
  public list: any;
  public item: Preset;
  public reference: UiTagReference;

  /**
   * @param  list - the owning `UiPresetList`
   * @param  preset - the Preset this item represents
   */
  public constructor(list: any, preset: Preset) {
    this.list = list;
    this.item = preset;
    this.reference = new UiTagReference(list.context, preset.reference());

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
  }

  /**
   * Renders into the given selection.
   * A fresh instance is created and rendered per row/use, so it renders into
   *  `$selection` rather than capturing `$parent`.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  public render($selection: D3Selection): void {
    const list = this.list;
    const context = list.context;
    const preset = this.item;

    const $$wrap = $selection.selectAll('.preset-list-button-wrap')
      .data([this], (d: PresetItem) => d.item.id)
      .enter()
      .append('div')
      .attr('class', 'preset-list-button-wrap');

    const $$button = $$wrap
      .append('button')
      .attr('class', 'preset-list-button')
      .call(new UiPresetIcon(context)
        .geometry(list._allGeometries.length === 1 && list._allGeometries[0])
        .preset(preset).render)
      .on('click', this.choose)
      .on('keydown', list._itemKeydown);

    const $$label = $$button
      .append('div')
      .attr('class', 'label')
      .append('div')
      .attr('class', 'label-inner');

    const nameparts = [
      preset.name,
      preset.subtitle()
    ].filter(Boolean);

    $$label.selectAll('.namepart')
      .data(nameparts)
      .enter()
      .append('div')
      .attr('class', 'namepart')
      .text((d: string) => d);

    $$wrap.call(this.reference.button);
    $selection.call(this.reference.body);
  }


  /**
   * Chooses this preset, applying it to the selected entities.
   */
  public choose(): void {
    const list = this.list;
    const context = list.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const item = this.item;

    if (!context.inIntro) {
      schema.setMostRecent(item);
    }

    const combinedAction = (graph: Graph) => {
      for (const entityID of list._entityIDs) {
        const oldPreset = schema.match(graph.entity(entityID), graph);
        graph = actionChangePreset(entityID, oldPreset, item)(graph);
      }
      return graph;
    };

    editor.perform(combinedAction);
    editor.commit({
      annotation: l10n.t('operations.change_tags.annotation'),
      selectedIDs: list._entityIDs
    });
    list.emit('choose', item);
  }
}
