import { selection, select } from 'd3-selection';
import { Extent, geoSphericalDistance } from '@rapid-sdk/math';
import * as sexagesimal from '@mapbox/sexagesimal';
import { Graph } from '../lib/Graph.ts';
import { createOsmEntity } from '../data/index.ts';
import { uiIcon } from './icon.ts';
import { utilCmd, utilHighlightEntities, utilIsColorValid, utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../data/index.ts';
import type { Tags } from './fields/types.ts';


/** A single result item in the feature search list */
interface SearchResult {
  id: EntityID | number;
  entity?: OsmEntity;
  geometry: string;
  type: string;
  name: string;
  distance?: number;
  location?: [number, number];
  noteID?: string;
  extent?: Extent;
}

/** A raw geocoding result from the Nominatim service */
interface GeocodeResult {
  osm_type?: string;
  osm_id?: string | number;
  class: string;
  type: string;
  display_name: string;
  boundingbox: string[];
}


/**
 * `UiFeatureList` allows users to search for features and display the search results.
 *
 * @example
 *  <div class='feature-list-wrap'>
 *    <div class='header'/>           // Contains the text "Search Features"
 *    <div class='search-header'/>    // Contains the `input` search field
 *    <div class='inspector-body'/>   // Contains the search results
 *  </div>
 */
export class UiFeatureList {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;
  public $featureList: D3Selection | null;
  public $search: D3Selection | null;
  public $list: D3Selection | null;

  protected _geocodeResults: GeocodeResult[] | null | undefined;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._geocodeResults = null;

    // D3 selections
    this.$parent = null;
    this.$featureList = null;
    this.$search = null;
    this.$list = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._clearSearch = this._clearSearch.bind(this);
    this._click = this._click.bind(this);
    this._drawList = this._drawList.bind(this);
    this._focusSearch = this._focusSearch.bind(this);
    this._input = this._input.bind(this);
    this._keydown = this._keydown.bind(this);
    this._keypress = this._keypress.bind(this);
    this._mouseout = this._mouseout.bind(this);
    this._mouseover = this._mouseover.bind(this);
    this._nominatimSearch = this._nominatimSearch.bind(this);

    // Setup event listeners
    context.on('modechange', this._clearSearch);

    const key = utilCmd('⌘F');
    context.keybinding().on(key, this._focusSearch);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;

    // add .feature-list-wrap
    let $featureList: D3Selection = $parent.selectAll('.feature-list-wrap')
      .data([0]);

    const $$featureList = $featureList.enter()
      .append('div')
      .attr('class', 'feature-list-wrap inspector-hidden');  // UiSidebar will manage its visibility

    this.$featureList = $featureList = $featureList.merge($$featureList);


    // add .header
    $featureList.selectAll('.header')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'header fillL')
      .append('h3');

    // update
    $featureList.selectAll('.header h3')
      .text(l10n.t('inspector.feature_list'));


    // add .search-header
    const $$searchWrap = $featureList.selectAll('.search-header')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'search-header');

    $$searchWrap
      .call(uiIcon('#rapid-icon-search'));

    $$searchWrap
      .append('input')
      .attr('type', 'search')
      .call(utilNoAuto)
      .on('keypress', this._keypress)
      .on('keydown', this._keydown)
      .on('input', this._input);

    this.$search = $featureList.selectAll('.search-header input');

    // update
    this.$search
      .attr('placeholder', l10n.t('text.search'));


    // add .inspector-body and .feature-list
    $featureList.selectAll('.inspector-body')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'inspector-body')
      .append('div')
      .attr('class', 'feature-list');

    this.$list = $featureList.selectAll('.feature-list');

    // update
    this._drawList();
  }


  /**
   * redraw the results list
   */
  protected _drawList(): void {
    if (!this.$search || !this.$list) return;  // called too early?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const nominatim = context.services.nominatim;

    const value = this.$search.property('value');
    const results = this._getSearchResults();

    const $list = this.$list;
    $list.classed('filtered', value.length);

    const $$resultsItem = $list.selectAll('.no-results-item')
      .data([0])
      .enter()
      .append('button')
      .property('disabled', true)
      .attr('class', 'no-results-item')
      .call(uiIcon('#rapid-icon-alert', 'pre-text'));

    $$resultsItem.append('span')
      .attr('class', 'entity-name');

    $list.selectAll('.no-results-item .entity-name')
      .text(l10n.t('geocoder.no_results_worldwide'));

    if (nominatim) {
      $list.selectAll('.geocode-item')
        .data([0])
        .enter()
        .append('button')
        .attr('class', 'geocode-item secondary-action')
        .on('click', this._nominatimSearch)
        .append('div')
        .attr('class', 'label')
        .append('span')
        .attr('class', 'entity-name');

      $list.selectAll('.geocode-item .entity-name')
        .text(l10n.t('geocoder.search'));
    }

    $list.selectAll('.no-results-item')
      .style('display', (value.length && !results.length) ? 'block' : 'none');

    $list.selectAll('.geocode-item')
      .style('display', (value && this._geocodeResults === undefined) ? 'block' : 'none');

    $list.selectAll('.feature-list-item')
      .data([-1])
      .remove();

    const $items = $list.selectAll('.feature-list-item')
      .data(results, (d: SearchResult) => d.id);

    const $$items = $items.enter()
      .insert('button', '.geocode-item')
      .attr('class', 'feature-list-item')
      .on('mouseover', this._mouseover)
      .on('mouseout', this._mouseout)
      .on('click', this._click);

    const $$label = $$items
      .append('div')
      .attr('class', 'label');

    $$label
      .each((d: SearchResult, i, nodes) => {
        select(nodes[i])
          .call(uiIcon(`#rapid-icon-${d.geometry}`, 'pre-text'));
      });

    $$label
      .append('span')
      .attr('class', 'entity-type')
      .text((d: SearchResult) => d.type);

    $$label
      .append('span')
      .attr('class', 'entity-name')
      .classed('has-color', (d: SearchResult) => !!this._getColor(d.entity))
      .style('border-color', (d: SearchResult) => this._getColor(d.entity))
      .text((d: SearchResult) => d.name);

    $$items
      .style('opacity', 0)
      .transition()
      .style('opacity', 1);

    $items.order();

    $items.exit()
      .remove();
  }


  /**
   * Handler for the ⌘F shortcut to focus the search input
   * @param [e] - the triggering event, if any
   */
  protected _focusSearch(e?: KeyboardEvent): void {
    if (!this.$search) return;  // called too early?
    if (this.context.mode?.id !== 'browse') return;

    e?.preventDefault();
    const node = this.$search.node() as HTMLElement | null;
    node?.focus();
  }


  /**
   * Handler for keydown event - unfocus the search if user presses `Escape`
   * @param e - the keydown event
   */
  protected _keydown(e: KeyboardEvent): void {
    if (!this.$search) return;  // called too early?

    if (e.keyCode === 27) {  // escape
      (this.$search.node() as HTMLElement).blur();
    }
  }


  /**
   * Handler for keypress events
   * @param e - the keypress event
   */
  protected _keypress(e: KeyboardEvent): void {
    if (!this.$search || !this.$list) return;  // called too early?

    const q = this.$search.property('value');
    const $items = this.$list.selectAll('.feature-list-item');
    if (e.keyCode === 13 && q.length && $items.size()) {  // ↩ Return
      this._click(e as Event, $items.datum() as SearchResult);
    }
  }


  /**
   * Handler for input events - on typing redraw the list
   * @param e - the input event
   */
  protected _input(e: InputEvent): void {
    this._geocodeResults = undefined;
    this._drawList();
  }


  /**
   * Clears the search field and redraws the (now empty) results list
   */
  protected _clearSearch(): void {
    if (!this.$search) return;  // called too early?

    this.$search.property('value', '');
    this._drawList();
  }


  /**
   * If this entity has a color (e.g. a transit route)
   * @param   entity - The OSM Entity to check
   * @result  The color string, if any
   */
  protected _getColor(entity: OsmEntity | undefined): string | null {
    const val = entity?.type === 'relation' && entity?.tags.colour;
    return (val && utilIsColorValid(val)) ? val : null;
  }


  /**
   * Handler for mouseover events on the list items
   * @param  e - the mouseover event
   * @param  d - data bound to the list item
   */
  protected _mouseover(e: MouseEvent, d: SearchResult): void {
    if (!d.id || d.id === -1) return;
    utilHighlightEntities(this.context, [d.id as EntityID], true);
  }


  /**
   * Handler for mouseout events on the list items
   * @param  e - the mouseout event
   * @param  d - data bound to the list item
   */
  protected _mouseout(e: MouseEvent, d: SearchResult): void {
    if (!d.id || d.id === -1) return;
    utilHighlightEntities(this.context, [d.id as EntityID], false);
  }


  /**
   * Handler for click events on the list items,
   * may also be called by the keypress handler
   * @param  e - the click or keypress event
   * @param  d - data bound to the list item
   */
  protected _click(e: Event, d: SearchResult): void {
    e.preventDefault();

    const context = this.context;
    const map = context.systems.map!;

    if (d.location) {
      map.centerZoomEase([d.location[1], d.location[0]], 19);

    } else if (d.id !== -1) {  // looks like an OSM Entity
      utilHighlightEntities(context, [d.id as EntityID], false);
      map.selectEntityID(d.id as EntityID, true);   // select and fit, download first if necessary

    } else if (d.noteID) {  // looks like an OSM Note
      map.selectNoteID(d.noteID);
    }
  }


  /**
   * Search Nominatim, then display those results
   */
  protected _nominatimSearch(): void {
    if (!this.$search) return;  // called too early?

    const nominatim = this.context.services.nominatim;
    if (!nominatim) return;

    const q = this.$search.property('value');

    nominatim.search(q, (err: unknown, results: GeocodeResult[]) => {
      this._geocodeResults = results || [];
      this._drawList();
    });
  }


  /**
   * This does the search
   * @return  Array of search results
   */
  protected _getSearchResults(): SearchResult[] {
    if (!this.$search) return [];  // called too early?

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    const centerLoc = context.viewport.centerLoc();
    const q = this.$search.property('value').toLowerCase();
    let results: SearchResult[] = [];

    if (!q) return results;

    // User typed something that looks like a coordinate pair
    const locationMatch = sexagesimal.pair(q.toUpperCase()) || l10n.dmsMatcher(q);
    if (locationMatch) {
      const loc: [number, number] = [ parseFloat(locationMatch[0]), parseFloat(locationMatch[1]) ];
      results.push({
        id: -1,
        geometry: 'point',
        type: l10n.t('text.location'),
        name: l10n.dmsCoordinatePair([loc[1], loc[0]]),
        location: loc
      });
    }

    // User typed something that looks like an OSM entity id (node/way/relation/note)
    const idMatch = !locationMatch && q.match(/(?:^|\W)(node|way|relation|note|[nwr])\W?0*([1-9]\d*)(?:\W|$)/i);
    if (idMatch) {
      const entityType = idMatch[1].charAt(0);  // n,w,r
      const entityID = idMatch[2];

      if (idMatch[1] === 'note') {
        results.push({
          id: -1,
          noteID: entityID,
          geometry: 'note',
          type: l10n.t('text.note'),
          name: entityID
        });
      } else {
        results.push({
          id: entityType + entityID,
          geometry: entityType === 'n' ? 'point' : entityType === 'w' ? 'line' : 'relation',
          type: l10n.displayType(entityType),
          name: entityID
        });
      }
    }

    // Search for what the user typed in the local and base graphs
    // Gather affected ids
    const graph = editor.staging.graph;
    const base = graph.base.entities;
    const local = graph.local.entities;
    const ids = new Set([...base.keys(), ...local.keys()]);

    let localResults: SearchResult[] = [];
    for (const id of ids) {
      if (local.has(id) && local.get(id) === undefined) continue;  // deleted locally
      const entity = graph.hasEntity(id);
      if (!entity) continue;

      const name = l10n.displayName(entity.tags) || '';
      if (name.toLowerCase().indexOf(q) < 0) continue;

      const matched = schema.match(entity, graph);
      const type = (matched && matched.name) || l10n.displayType(entity.id);
      const extent = (entity as any).extent(graph);   // extent(graph) not typed on the OSM class hierarchy
      const distance = extent ? geoSphericalDistance(centerLoc, extent.center()) : 0;

      localResults.push({
        id: entity.id,
        entity: entity,
        geometry: entity.geometry(graph),
        type: type,
        name: name,
        distance: distance
      });

      if (localResults.length > 100) break;
    }

    localResults = localResults.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    results = results.concat(localResults);


    // Search for what the user typed in geocode results
    for (const d of (this._geocodeResults || [])) {
      if (!d.osm_type || !d.osm_id) continue;    // some results may be missing these - iD#1890

      // Make a temporary OSM Feature so we can preset match and better localize the search result - iD#4725
      const id = `${d.osm_type[0]}${d.osm_id}`;  // e.g. w123
      const tags: Tags = {};
      tags[d.class] = d.type;   // e.g. boundary=administrative

      const attrs: { id: EntityID; type: string; tags: Tags; nodes?: string[] } = { id: id as EntityID, type: d.osm_type, tags: tags };
      if (d.osm_type === 'way') {   // for ways, add some fake closed nodes
        attrs.nodes = ['a','a'];    // so that geometry area is possible
      }

      const tempEntity = createOsmEntity(context, attrs);
      const tempGraph = new Graph(this.context, [tempEntity]);
      const preset = schema.match(tempEntity, tempGraph);
      const type = (preset && preset.name) || l10n.displayType(id);

      results.push({
        id: tempEntity.id,
        geometry: tempEntity.geometry(tempGraph),
        type: type,
        name: d.display_name,
        extent: new Extent(
          [ parseFloat(d.boundingbox[3]), parseFloat(d.boundingbox[0]) ],
          [ parseFloat(d.boundingbox[2]), parseFloat(d.boundingbox[1]) ]
        )
      });
    }

    // If the user just typed a number, offer them some OSM IDs
    if (q.match(/^[0-9]+$/)) {
      results.push({
        id: 'n' + q,
        geometry: 'point',
        type: l10n.t('text.node'),
        name: q
      });
      results.push({
        id: 'w' + q,
        geometry: 'line',
        type: l10n.t('text.way'),
        name: q
      });
      results.push({
        id: 'r' + q,
        geometry: 'relation',
        type: l10n.t('text.relation'),
        name: q
      });
      results.push({
        id: -1,
        noteID: q,
        geometry: 'note',
        type: l10n.t('text.note'),
        name: q
      });
    }

    return results;
  }

}
