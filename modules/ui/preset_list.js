import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import debounce from 'lodash-es/debounce.js';

import { actionChangePreset } from '../actions/change_preset.js';
import { Category, Preset } from '../lib/index.js';
import { operationDelete } from '../operations/delete.js';
import { uiIcon } from './icon.js';
import { uiPresetIcon } from './preset_icon.js';
import { uiTagReference } from './tag_reference.js';
import { uiTooltip } from './tooltip.js';
import { utilKeybinding, utilNoAuto, utilRebind, utilTotalExtent } from '../util/index.js';

const MAXSEARCH = 50;   // how many search results to show


export function uiPresetList(context) {
  const editor = context.systems.editor;
  const filters = context.systems.filters;
  const l10n = context.systems.l10n;
  const schema = context.systems.schema;
  const dispatch = d3_dispatch('cancel', 'choose');

  let _selection = null;
  let _entityIDs = [];
  let _currLoc = null;
  let _allGeometries = [];
  let _defaults = [];
  let _selectedPresetIDs = new Set();
  let _autofocus = false;
  let _list = d3_select(null);
  let _input = d3_select(null);


  /**
   * presetList
   * (This is the render function)
   * @param  {d3-selection}  $selection  - parent selection to render into
   */
  function presetList($selection) {
    _selection = $selection;

    if (!_entityIDs.length) return;

    const isRTL = l10n.isRTL();

    // Header
    const $header = $selection.selectAll('.header')
      .data([0]);

    // Enter
    const $$header = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('h3')
      .attr('class', 'preset-list-message')
      .text(l10n.t('inspector.choose'));

    $$header
      .append('button')
      .attr('class', 'preset-choose')
      .on('click', function() { dispatch.call('cancel', this); })
      .call(uiIcon(isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward'));

    const $message = $header.merge($$header)
      .selectAll('.preset-list-message');


    // Search box
    let $search = $selection.selectAll('.search-header')
      .data([0]);

    const $$search = $search.enter()
      .append('div')
      .attr('class', 'search-header');

    $$search
      .call(uiIcon('#rapid-icon-search'));

    $$search
      .append('input')
      .attr('class', 'preset-search-input')
      .attr('placeholder', l10n.t('inspector.search'))
      .attr('type', 'search')
      .call(utilNoAuto)
      .on('keydown', initialKeydown)
      .on('keypress', keypress)
      .on('input', debounce(inputevent));

    // update
    $search = $search.merge($$search);
    _input = $search.selectAll('.preset-search-input');

    if (_autofocus) {
      // Safari 14 doesn't always like to focus immediately, so schedule it with setTimeout
      setTimeout(() => _input.node().focus(), 0);
    }


    // Preset List
    const $listWrap = $selection.selectAll('.inspector-body')
      .data([0]);

    // enter
    const $$listWrap = $listWrap.enter()
      .append('div')
      .attr('class', 'inspector-body');

    $$listWrap
      .append('div')
      .attr('class', 'preset-list-main preset-list');

    // update
    _list = $listWrap.merge($$listWrap)
      .selectAll('.preset-list-main')
      .call(drawList, _defaults);

    // rebind event listener
    filters.off('filterchange', _checkFilteringRules);
    filters.on('filterchange', _checkFilteringRules);


    function initialKeydown(e) {
      const val = _input.property('value');

      // hack to let delete shortcut work when search is autofocused
      if (val.length === 0 &&
        (e.keyCode === utilKeybinding.keyCodes['⌫'] ||
         e.keyCode === utilKeybinding.keyCodes['⌦'])) {
        e.preventDefault();
        e.stopPropagation();
        operationDelete(context, _entityIDs)();

      // hack to let undo work when search is autofocused
      } else if (val.length === 0 &&
        (e.ctrlKey || e.metaKey) &&
        e.keyCode === utilKeybinding.keyCodes.z) {
        e.preventDefault();
        e.stopPropagation();
        editor.undo();

      } else if (!e.ctrlKey && !e.metaKey) {
        // don't check for delete/undo hack on future keydown events
        d3_select(this).on('keydown', keydown);
        keydown.call(this, e);
      }
    }

    function keydown(e) {
      if (e.keyCode === utilKeybinding.keyCodes['↓'] &&       // down arrow
        // if insertion point is at the end of the string
        _input.node().selectionStart === _input.property('value').length
      ) {
        e.preventDefault();
        e.stopPropagation();
        // move focus to the first item in the preset list
        const $buttons = _list.selectAll('.preset-list-button');
        if (!$buttons.empty()) {
          $buttons.node().focus();
        }
      }
    }

    function keypress(e) {
      const val = e.currentTarget.value;
      if (e.keyCode === 13 && val.length) {  // ↩ Return
        const item = _list.selectAll('.preset-list-item:first-child').datum();
        item.choose();
      }
    }

    function inputevent() {
      const query = _input.property('value');
      _list.classed('filtered', query.length);

      let items, messageText;
      if (query.length) {  // do search
        const fallbackCount = _allGeometries.length;
        const maxCount = MAXSEARCH - fallbackCount;
        const results = schema.search(query, _allGeometries, _currLoc);

        messageText = l10n.t('inspector.results', { n: results.length, search: query });
        items = results.map(result => schema.item(result.id)).slice(0, maxCount);

        // Append fallback preset(s)
        for (const geom of _allGeometries) {
          const fallback = schema.getFallback(geom);
          if (fallback) {
            items.push(fallback);
          }
        }

      } else {   // show defaults
        messageText = l10n.t('inspector.choose');
        items = _defaults;
      }

      _list.call(drawList, items);

      $message
        .text(messageText);
    }
  }


  /**
   * drawList
   * Draws the list of Presets/Categories.
   * The category items themselves may also contain sublists.
   * @param  {d3-selection}  $selection  - parent selection to render list items into (in this case, a `div.preset-list`)
   * @param  {Array<Preset|Category>}  arr - Categories and Presets to include in the list
   */
  function drawList($selection, arr) {
    const data = [];
    for (const item of arr) {
      if (item instanceof Category) {
        data.push(new CategoryItem(item));
      } else if (item instanceof Preset) {
        data.push(new PresetItem(item));
      }
    }

    // Select direct descendant list items only...
    // Because `d3.selectAll` uses `element.querySelectorAll`, `:scope` refers to self
    // see https://developer.mozilla.org/en-US/docs/Web/CSS/:scope
    let $items = $selection.selectAll(':scope > .preset-list-item')
      .data(data, d => d.item.id);

    // exit
    $items.exit()
      .remove();

    // enter
    const $$items = $items.enter()
      .append('div')
      .attr('class', d => `preset-list-item preset-${d.item.safeid}`)
      .style('opacity', 0)
      .transition()
      .style('opacity', 1);

    // update
    $items = $items.merge($$items)
      .order()   // make them match the order of `arr`
      .each((d, i, nodes) => d3_select(nodes[i]).call(d.render))
      .classed('current', d => _selectedPresetIDs.has(d.item.id));

    _checkFilteringRules();
  }


  /**
   * itemKeydown
   * keydown handler for the preset list
   * This allows users to use keyboard navigation to focus different items and expand/contract Categories.
   * @param  {KeyboardEvent}   e - the keydown event
   */
  function itemKeydown(e) {
    const target = e.currentTarget;
    const $selection = d3_select(target);

    // the actively focused item
    const $item = d3_select(target.closest('.preset-list-item'));
    const node = $item.node();
    const $parentItem = d3_select(node.parentNode.closest('.preset-list-item'));
    const parentNode = $parentItem.node();
    const isRTL = l10n.isRTL();

    // arrow down, move focus to the next, lower item
    if (e.keyCode === utilKeybinding.keyCodes['↓']) {
      e.preventDefault();
      e.stopPropagation();

      // the next item in the list at the same level
      let $nextItem = d3_select(node.nextElementSibling);

      // if there is no next item in this list
      if ($nextItem.empty()) {
        if (parentNode) {        // if there is a parent item
          // the item is the last item of a sublist, select the next item at the parent level
          $nextItem = d3_select(parentNode.nextElementSibling);
        }
      } else if ($selection.classed('expanded')) {                           // if the focused item is expanded
        $nextItem = $item.select('.subgrid .preset-list-item:first-child');  // select the first subitem instead
      }

      if (!$nextItem.empty()) {
        $nextItem.select('.preset-list-button').node().focus();    // focus on the next item
      }

    // arrow up, move focus to the previous, higher item
    } else if (e.keyCode === utilKeybinding.keyCodes['↑']) {
      e.preventDefault();
      e.stopPropagation();

      // the previous item in the list at the same level
      let $prevItem = d3_select(node.previousElementSibling);

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
        $prevItem.select('.preset-list-button').node().focus();     // focus on the previous item
      } else {
        // the focus is at the top of the list, move focus back to the search field
        _input.node().focus();
      }

    // arrow left, move focus to the parent item if there is one
    } else if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '→' : '←']) {
      e.preventDefault();
      e.stopPropagation();
      if (!$parentItem.empty()) {     // if there is a parent item, focus on the parent item
        $parentItem.select('.preset-list-button').node().focus();
      }

    // arrow right, choose this item
    } else if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '←' : '→']) {
      e.preventDefault();
      e.stopPropagation();
      $item.datum().choose();
    }
  }


  /**
   */
  class CategoryItem {
    constructor(category) {
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


    render($selection) {
      const category = this.item;
      const isRTL = l10n.isRTL();

      const $$wrap = $selection.selectAll(':scope > .preset-list-button-wrap')
        .data([this], d => d.item.id)
        .enter()
        .append('div')
        .attr('class', 'preset-list-button-wrap category');

      const $$button = $$wrap
        .append('button')
        .attr('class', 'preset-list-button')
        .classed('expanded', false)
        .call(uiPresetIcon(context)
          .geometry(_allGeometries.length === 1 && _allGeometries[0])
          .preset(category))
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
        .text(d => d.item.name + '…');

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

    _keydown(e) {
      const isRTL = l10n.isRTL();
      const target = e.currentTarget;
      const $selection = d3_select(target);
      if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '←' : '→']) {  // right arrow, expand the focused item
        e.preventDefault();
        e.stopPropagation();
        if (!$selection.classed('expanded')) {  // if the item isn't expanded
          this._click(e);                       // toggle expansion (expand the item)
        }
      } else if (e.keyCode === utilKeybinding.keyCodes[isRTL ? '→' : '←']) {   // left arrow, collapse the focused item
        e.preventDefault();
        e.stopPropagation();
        if ($selection.classed('expanded')) {   // if the item is expanded
          this._click(e);                       // toggle expansion (collapse the item)
        }
      } else {
        itemKeydown(e);
      }
    }

    _click(e) {
      const isRTL = l10n.isRTL();
      const target = e.currentTarget;
      const $selection = d3_select(target);
      const isExpanded = $selection.classed('expanded');
      const iconName = isExpanded ? (isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward') : '#rapid-icon-down';
      $selection.classed('expanded', !isExpanded);
      $selection.selectAll('div.label-inner svg.icon use').attr('href', iconName);
      this.choose();
    }

    choose() {
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
        const needed = new Set(_allGeometries);
        for (const item of category.presets) {
          if (!needed.isSubsetOf(item.geometries)) continue;  // skip items that don't support all geometries needed
          items.push(item);
        }
        this.sublist.call(drawList, items);
        this.box.transition()
          .duration(200)
          .style('opacity', '1')
          .style('max-height', 200 + items.length * 190 + 'px')
          .style('padding-bottom', '10px');
      }
    }

  }


  /**
   */
  class PresetItem {
    constructor(preset) {
      this.item = preset;
      this.reference = uiTagReference(context, preset.reference());

      // Ensure methods used as callbacks always have `this` bound correctly.
      // (This is also necessary when using `d3-selection.call`)
      this.choose = this.choose.bind(this);
      this.render = this.render.bind(this);
    }

    render($selection) {
      const preset = this.item;

      const $$wrap = $selection.selectAll('.preset-list-button-wrap')
        .data([this], d => d.item.id)
        .enter()
        .append('div')
        .attr('class', 'preset-list-button-wrap');

      const $$button = $$wrap
        .append('button')
        .attr('class', 'preset-list-button')
        .call(uiPresetIcon(context)
          .geometry(_allGeometries.length === 1 && _allGeometries[0])
          .preset(preset))
        .on('click', this.choose)
        .on('keydown', itemKeydown);

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
        .text(d => d);

      $$wrap.call(this.reference.button);
      $selection.call(this.reference.body);
    }


    choose() {
      const item = this.item;
// figure out how to do this without `this`
      // if (d3_select(this).classed('disabled')) return;

      if (!context.inIntro) {
        schema.setMostRecent(item);
      }

      const combinedAction = (graph) => {
        for (const entityID of _entityIDs) {
          const oldPreset = schema.match(graph.entity(entityID), graph);
          graph = actionChangePreset(entityID, oldPreset, item)(graph);
        }
        return graph;
      };

      editor.perform(combinedAction);
      editor.commit({
        annotation: l10n.t('operations.change_tags.annotation'),
        selectedIDs: _entityIDs
      });
      dispatch.call('choose', this, item);
    }

  }


  function _checkFilteringRules() {
    const graph = editor.staging.graph;
    if (!_entityIDs.every(entityID => graph.hasEntity(entityID))) return;

    const $buttons = _list.selectAll('.preset-list-button');

    // remove existing tooltips
    $buttons.call(uiTooltip(context).destroyAny);

    $buttons.each((d, i, nodes) => {
      const $selection = d3_select(nodes[i]);

      let filterID;  // check whether this preset would be hidden by the current filtering rules
      for (const geometry of _allGeometries) {
        filterID = filters.isHiddenPreset(d.item, geometry);
        if (filterID) break;
      }

      const isHidden = filterID && !context.inIntro && !_selectedPresetIDs.has(d.item.id);

      $selection
        .classed('disabled', isHidden);

      if (isHidden) {
        $selection.call(uiTooltip(context)
          .title(l10n.t('filters.hidden_preset.manual', { features: l10n.t(`filters.${filterID}.description`) }))
          .placement(i < 2 ? 'bottom' : 'top')
        );
      }
    });
  }


  presetList.autofocus = function(val) {
    if (!arguments.length) return _autofocus;
    _autofocus = val;
    return presetList;
  };


  presetList.entityIDs = function(val) {
    if (!arguments.length) return _entityIDs;

    _entityIDs = val ?? [];
    _currLoc = null;
    _allGeometries = [];
    _defaults = [];
    _selectedPresetIDs = new Set();
    _input.property('value', '');
    _list.selectAll('.preset-list-item').remove();

    if (_entityIDs.length) {
      const graph = editor.staging.graph;

      // All locations in the selection
      _currLoc = utilTotalExtent(_entityIDs, graph).center();

      // All geometries in the selection
      _allGeometries = _gatherGeometries();
      _defaults = schema.getDefaults(_allGeometries[0], !context.inIntro, _currLoc).slice(0, 35);

      // match presets
      for (const entityID of _entityIDs) {
        const matched = schema.match(graph.entity(entityID), graph);
        if (matched) {
          _selectedPresetIDs.add(matched.id);
        }
      }
    }

    // reset scroll to top
    if (_selection) {
      const element = _selection.selectAll('.inspector-body').node();
      if (element) {
        element.scroll(0, 0);
      }
    }

    return presetList;
  };


  presetList.selected = function(val) {
    if (!arguments.length) return _selectedPresetIDs;

    _selectedPresetIDs = new Set();

    if (Array.isArray(val)) {
      for (const preset of val) {
        if (preset?.id) {
          _selectedPresetIDs.add(preset.id);
        }
      }
    }

    return presetList;
  };


  // Gather the geometries present on the selected entities.
  // They will be sorted so that the most represented geometries appear earlier in the list.
  function _gatherGeometries() {
    const graph = editor.staging.graph;
    let counts = {};

    for (const entityID of _entityIDs) {
      const entity = graph.entity(entityID);
      let geometry = entity.geometry(graph);
      // Treat entities on addr:interpolation lines as points, not vertices - iD#3241
      if (geometry === 'vertex' && entity.isOnAddressLine(graph)) {
        geometry = 'point';
      }

      if (!counts[geometry]) {
        counts[geometry] = 0;
      }

      counts[geometry] += 1;
    }

    return Object.keys(counts).sort((geom1, geom2) => counts[geom2] - counts[geom1]);
  }


  return utilRebind(presetList, dispatch, 'on');
}
