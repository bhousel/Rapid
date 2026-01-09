import { /* utilArrayGroupBy,*/ utilArrayUnion } from '@rapid-sdk/util';

import { AbstractSystem } from './AbstractSystem.ts';
import { osmLifecyclePrefixes } from '../lib/tags.ts';

import type { Context } from './types.ts';
import type { Tags } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmRelation, OsmWay } from '../data/index.js';


/** Geometry type for entities */
type Geometry = 'point' | 'vertex' | 'line' | 'area' | 'relation';

/** Filter match function signature */
type FilterMatchFn = (tags: Tags, geometry?: Geometry) => boolean;


/** Single filter stat */
interface FilterStat {
  enabled: boolean;
  count: number;
}

/** Stats collected for all filters, keyed by filterID */
type FilterStats = Record<string, FilterStat>;


/** Cached data for an entity */
interface EntityCache {
  parents: OsmEntity[] | null;
  matches: Set<string> | null;
}


/** A preset-like object for isHiddenPreset */
interface PresetLike {
  tags?: Tags;
  setTags: (tags: Tags, geometry: Geometry) => Tags;
}


const traffic_roads: Record<string, boolean> = {
  'motorway': true,
  'motorway_link': true,
  'trunk': true,
  'trunk_link': true,
  'primary': true,
  'primary_link': true,
  'secondary': true,
  'secondary_link': true,
  'tertiary': true,
  'tertiary_link': true,
  'residential': true,
  'unclassified': true,
  'living_street': true
};

const service_roads: Record<string, boolean> = {
  'busway': true,
  'service': true,
  'road': true,
  'track': true
};

const paths: Record<string, boolean> = {
  'path': true,
  'footway': true,
  'cycleway': true,
  'bridleway': true,
  'steps': true,
  'pedestrian': true
};



/**
 * A filter with a match function, enabled state, and count.
 */
class Filter {
  /** The match function that tests tags and geometry */
  match: FilterMatchFn;
  /** true = shown, false = hidden */
  enabled: boolean;
  /** Number of objects currently filtered */
  count: number;

  constructor(fn: FilterMatchFn) {
    this.match = fn;
    this.enabled = true;
    this.count = 0;
  }
}


/**
 * `FilterSystem` maintains matching and filtering rules.
 * Each `Filter` is basically a filter function that returns true if an entity matches.
 * The code in here is relatively "hot", as it gets run against every entity.
 *
 * Events available:
 *   `filterchange`   Fires whenever user changes the enabled/disabled filters
 */
export class FilterSystem extends AbstractSystem {
  /** Map of filterID to Filter */
  private _filters: Map<string, Filter>;
  /** Set of filterIDs to hide */
  private _hidden: Set<string>;
  /** Set of entityIDs to force visible */
  private _forceVisible: Set<string>;
  /** Cache of entity.key to matched filterIDs */
  private _cache: Record<string, EntityCache>;
//  private _deferred: Set<number>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'filters';
    this.requiredDependencies = new Set(['editor']);
    this.optionalDependencies = new Set(['gfx', 'storage', 'urlhash']);

    this._filters = new Map();        // Map(filterID -> Filter)
    this._hidden = new Set();         // Set(filterID) to hide
    this._forceVisible = new Set();   // Set(entityIDs) to show
    this._cache = {};                 // Cache of entity.key to matched filterIDs
//    this._deferred = new Set();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashchange = this._hashchange.bind(this);
    this._filterChanged = this._filterChanged.bind(this);

    // hardcode the filters for now
    this._filters.set('points',          new Filter(this._isPoint.bind(this)));
    this._filters.set('traffic_roads',   new Filter(this._isTrafficRoad.bind(this)));
    this._filters.set('service_roads',   new Filter(this._isServiceRoad.bind(this)));
    this._filters.set('paths',           new Filter(this._isPath.bind(this)));
    this._filters.set('buildings',       new Filter(this._isBuilding.bind(this)));
    this._filters.set('building_parts',  new Filter(this._isBuildingPart.bind(this)));
    this._filters.set('indoor',          new Filter(this._isIndoor.bind(this)));
    this._filters.set('landuse',         new Filter(this._isLanduse.bind(this)));
    this._filters.set('boundaries',      new Filter(this._isBoundary.bind(this)));
    this._filters.set('water',           new Filter(this._isWater.bind(this)));
    this._filters.set('rail',            new Filter(this._isRail.bind(this)));
    this._filters.set('pistes',          new Filter(this._isPiste.bind(this)));
    this._filters.set('aerialways',      new Filter(this._isAerialway.bind(this)));
    this._filters.set('power',           new Filter(this._isPower.bind(this)));
    this._filters.set('past_future',     new Filter(this._isPastFuture.bind(this)));
    this._filters.set('others',          new Filter(this._isOther.bind(this)));
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const urlhash = context.systems.urlhash as any;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [ urlhash?.initAsync() ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Setup event handlers..
        urlhash?.on('hashchange', this._hashchange);
      });

//    // warm up the feature matching cache upon merging fetched data
//    const editor = this.context.systems.editor;
//    editor.on('merge.features', function(newEntities) {
//      if (!newEntities) return;
//      var handle = window.requestIdleCallback(function() {
//        var graph = editor.staging.graph;
//        var types = utilArrayGroupBy(newEntities, 'type');
//        // ensure that getMatches is called on relations before ways
//        var entities = [].concat(types.relation || [], types.way || [], types.node || []);
//        for (var i = 0; i < entities.length; i++) {
//          var geometry = entities[i].geometry(graph);
//          this.getMatches(entities[i], graph, geometry);
//        }
//      });
//      this._deferred.add(handle);
//    });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const storage = context.systems.storage;
    const urlhash = context.systems.urlhash as any;

    // Take filter values from urlhash first, localstorage second,
    // Default to having boundaries hidden
    const toHide = urlhash?.getParam('disable_features') ?? storage?.getItem('disabled-features') ?? 'boundaries';
    const filterIDs = toHide.replace(/;/g, ',').split(',').map((s: string) => s.trim()).filter(Boolean);
    for (const filterID of filterIDs) {
      this._hidden.add(filterID);
      const filter = this._filters.get(filterID);
      if (filter) {
        filter.enabled = false;
      }
    }
    this._filterChanged();
    this._started = true;

    return this._startPromise = super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
//    for (const handle of this._deferred) {
//      window.cancelIdleCallback(handle);
//    }
//    this._deferred.clear();
    this._cache = {};
    this._forceVisible.clear();
    return Promise.resolve();
  }


  /**
   * keys
   */
  get keys(): string[] {
    return [...this._filters.keys()];
  }


  /**
   * hidden
   * @return Set of hidden filterIDs
   */
  get hidden(): Set<string> {
    return this._hidden;
  }


  /**
   * isEnabled
   * @param filterID - Filter ID to check
   * @return true/false
   */
  isEnabled(filterID: string): boolean {
    const filter = this._filters.get(filterID);
    return filter?.enabled ?? false;
  }


  /**
   * enable
   * Enables the given filter
   * @param filterID - Filter ID to enable
   */
  enable(filterID: string): void {
    const filter = this._filters.get(filterID);
    if (filter && !filter.enabled) {
      filter.enabled = true;
      this._filterChanged();
    }
  }


  /**
   * enableAll
   * Enables all filters
   */
  enableAll(): void {
    let didChange = false;
    for (const filter of this._filters.values()) {
      if (!filter.enabled) {
        didChange = true;
        filter.enabled = true;
      }
    }
    if (didChange) {
      this._filterChanged();
    }
  }


  /**
   * disable
   * Disables the given filter
   * @param filterID - Filter ID to disable
   */
  disable(filterID: string): void {
    const filter = this._filters.get(filterID);
    if (filter?.enabled) {
      filter.enabled = false;
      this._filterChanged();
    }
  }


  /**
   * disableAll
   * Disables all filters
   */
  disableAll(): void {
    let didChange = false;
    for (const filter of this._filters.values()) {
      if (filter.enabled) {
        didChange = true;
        filter.enabled = false;
      }
    }
    if (didChange) {
      this._filterChanged();
    }
  }


  /**
   * toggle
   * Toggles the given filter between enabled/disabled states
   * @param filterID - Filter ID to toggle
   */
  toggle(filterID: string): void {
    const filter = this._filters.get(filterID);
    if (!filter) return;

    filter.enabled = !filter.enabled;
    this._filterChanged();
  }


// stats are gathered by `filterScene()` now
//
//  /**
//   * resetStats
//   * Resets all stats and emits a `filterchange` event
//   */
//  resetStats() {
//    for (const filter of this._filters.values()) {
//      filter.count = 0;
//    }
//    this.emit('filterchange');
//  }

//  /**
//   * gatherStats
//   * Gathers all filter stats for the given scene
//   * @param   {Array<Entity>  d - Array of entities to test
//   * @param   {Graph}         graph
//   */
//  gatherStats(d, graph) {
//    const types = utilArrayGroupBy(d, 'type');
//    const entities = [].concat(types.relation || [], types.way || [], types.node || []);
//
//    for (const filter of this._filters.values()) {   // reset stats
//      filter.count = 0;
//    }
//
//    for (const entity of entities) {
//      const geometry = entity.geometry(graph);
//      const matchedKeys = Object.keys(this.getMatches(entity, graph, geometry));
//      for (const filterID of matchedKeys) {
//        const filter = this._filters.get(filterID);
//        filter.count++;
//      }
//    }
//  }


  /**
   * getStats
   * This returns stats about which filters are currently enabled,
   *  and how many entities in the scene are filtered.
   * @return  Result object
   */
  getStats(): FilterStats {
    const result: FilterStats = {};
    for (const [filterID, filter] of this._filters) {
      result[filterID] = {
        enabled: filter.enabled,
        count:   filter.count
      };
    }
    return result;
  }


  /**
   * clear
   * Clears the cache of entity matches for the given entities
   * @param entities - Entities to clear cache
   */
  clear(entities: OsmEntity[]): void {
    for (const entity of entities) {
      this.clearEntity(entity);
    }
  }


  /**
   * clearEntity
   * Clears the cache of entity matches for a single entity
   * @param entity - Entity to clear
   */
  clearEntity(entity: OsmEntity): void {
    const ekey = entity.key;
    delete this._cache[ekey];
  }


  /**
   * getMatches
   * Matches a single entity against the filters
   * @param entity - The Entity to test
   * @param graph - Graph
   * @param geometry - geometry of the Entity ('point', 'line', 'vertex', 'area', 'relation')
   * @return A Set containing the matched filterIDs
   */
  getMatches(entity: OsmEntity, graph: Graph, geometry: Geometry): Set<string> {
    // skip - vertexes are hidden based on whatever filters their parent ways have matched
    if (geometry === 'vertex') return new Set();
    // skip - most relations don't have a geometry worth checking
    // (note that multipolygons are considered 'area' geometry not 'relation')
    if (geometry === 'relation' && entity.tags.type !== 'boundary') return new Set();

    const ekey = entity.key;
    let cached = this._cache[ekey];
    if (!cached) {
      this._cache[ekey] = cached = { parents: null, matches: null };
    }
    if (cached.matches) {    // done already
      return cached.matches;
    }

    // If this entity has parents, make sure the parents are matched first.
    // see iD#2548, iD#2887
    const parents = cached.parents || this.getParents(entity, graph, geometry);
    if (parents.length) {
      for (const parent of parents) {
        const pkey = parent.key;
        const pmatches = this._cache[pkey]?.matches;
        if (pmatches) continue;  // parent matching was done already
        this.getMatches(parent, graph, parent.geometry(graph) as Geometry);  // recurse up
      }
    }

    let matches = new Set<string>();
    for (const [filterID, filter] of this._filters) {
      if (filterID === 'others') {     // 'others' matches last
        if (matches.size) continue;    // skip if we matched something better already

        // Handle situations where a way should match whatever its parent relation matched.
        // - hasn't matched other 'interesting' filters AND
        //   - belongs only to a single multipolygon relation  OR
        //   - belongs only to boundary relations
        // see iD#2548, iD#2887
        if (entity.type === 'way' && (
          (parents.length === 1 && (parents[0] as OsmRelation).isMultipolygon?.()) ||
          (parents.length > 0 && parents.every(parent => parent.tags.type === 'boundary'))
        )) {
          const pkey = parents[0].key;
          const pmatches = this._cache[pkey]?.matches;
          if (pmatches) {
            matches = new Set(pmatches);  // copy
            continue;
          }
        }
      }

      if (filter.match(entity.tags, geometry)) {
        matches.add(filterID);
      }
    }

    cached.matches = matches;
    return matches;
  }


  /**
   * getParents
   * Returns parentWays of vertexes or parentRelations of other geometry types
   * @param entity - The Entity to test
   * @param graph - Graph
   * @param geometry - geometry of the Entity ('point', 'line', 'vertex', 'area', 'relation')
   * @return An array of parent entities
   */
  getParents(entity: OsmEntity, graph: Graph, geometry: Geometry): OsmEntity[] {
    if (geometry === 'point') return [];

    const ekey = entity.key;
    let cached = this._cache[ekey];
    if (!cached) {
      this._cache[ekey] = cached = { parents: null, matches: null };
    }

    if (!cached.parents) {
      let parents: OsmEntity[];
      if (geometry === 'vertex') {
        parents = graph.parentWays(entity);
      } else {   // 'line', 'area', 'relation'
        parents = graph.parentRelations(entity);
      }
      cached.parents = parents;
    }

    return cached.parents;
  }


  /**
   * isHiddenPreset
   * Checks whether a given preset would be hidden by the current filtering rules
   * @param preset - The Preset to test
   * @param geometry - geometry of the Preset ('point', 'line', 'vertex', 'area', 'relation')
   * @return The first `filterID` which causes the Preset to be hidden, or `null`
   */
  isHiddenPreset(preset: PresetLike, geometry: Geometry): string | null {
    if (!this._hidden.size) return null;
    if (!preset.tags) return null;

    const tags = preset.setTags({}, geometry);
    for (const [filterID, filter] of this._filters) {
      if (filter.match(tags, geometry)) {
        if (this._hidden.has(filterID)) {
          return filterID;
        }
        return null;
      }
    }
    return null;
  }


  /**
   * isHiddenFeature
   * Checks whether a given Entity would be hidden by the current filtering rules.
   * Important note:  In OSM a feature can be several things, so there might be multiple matches.
   * We only consider a feature hidden of _all_ of the matched rules are hidden.
   * @param entity - The Entity to test
   * @param graph - Graph
   * @param geometry - geometry of the Entity ('point', 'line', 'vertex', 'area', 'relation')
   * @return The first `filterID` which causes the Entity to be hidden, or `null`
   */
  isHiddenFeature(entity: OsmEntity, graph: Graph, geometry: Geometry): string | null {
    if (!this._hidden.size) return null;
    if (!entity.version) return null;
    if (this._forceVisible.has(entity.id)) return null;

    const filterIDs = [...this.getMatches(entity, graph, geometry)];
    if (filterIDs.length && filterIDs.every(filterID => this._hidden.has(filterID))) {
      return filterIDs[0];
    } else {
      return null;
    }
  }


  /**
   * isHiddenVertex
   * Checks whether a given child entity would be hidden by the current filtering rules
   * We only consider a child hidden of _all_ of the matched parent features are hidden.
   * @param entity - The Entity to test
   * @param graph - Graph
   * @return The first `filterID` which causes the Entity to be hidden, or `null`
   */
  isHiddenVertex(entity: OsmEntity, graph: Graph): string | null {
    if (!this._hidden.size) return null;
    if (!entity.version) return null;
    if (this._forceVisible.has(entity.id)) return null;

    const parents = this.getParents(entity, graph, 'vertex');
    if (!parents.length) return null;

    let filterID: string | null = null;
    for (const parent of parents) {
      const parentFilterID = this.isHidden(parent, graph, parent.geometry(graph) as Geometry);
      if (!parentFilterID) return null;  // parent is not hidden
      if (!filterID) filterID = parentFilterID;  // keep the first one
    }
    return filterID;
  }


  /**
   * hasHiddenConnections
   * Checks whether a given entity is connected to a feature that is hidden
   * @param entity - The Entity to test
   * @param graph - Graph
   * @return true/false
   */
  hasHiddenConnections(entity: OsmEntity, graph: Graph): boolean {
    if (!this._hidden.size) return false;

    let childNodes: OsmEntity[];
    let connections: OsmEntity[];
    if (entity.type === 'midpoint') {
      childNodes = [graph.entity((entity as any).edge[0]), graph.entity((entity as any).edge[1])];
      connections = [];
    } else {
      childNodes = (entity as any).nodes ? graph.childNodes(entity as OsmWay) : [];
      connections = this.getParents(entity, graph, entity.geometry(graph) as Geometry);
    }

    // Gather other parentWays connected to this entity's childnodes..
    for (const child of childNodes) {
      const parents = graph.parentWays(child);
      connections = utilArrayUnion(connections, parents);
    }

    return connections.some(other => this.isHidden(other, graph, other.geometry(graph) as Geometry));
  }


  /**
   * isHidden
   * Checks whether a given entity is hidden
   * @param entity - The Entity to test
   * @param graph - Graph
   * @param geometry - geometry of the Entity ('point', 'line', 'vertex', 'area', 'relation')
   * @return The first `filterID` which causes the Entity to be hidden, or `null`
   */
  isHidden(entity: OsmEntity, graph: Graph, geometry: Geometry): string | null {
    if (!this._hidden.size) return null;
    if (!entity.version) return null;

    if (geometry === 'vertex') {
      return this.isHiddenVertex(entity, graph);
    } else {
      return this.isHiddenFeature(entity, graph, geometry);
    }
  }


  /**
   * filterScene
   * Returns a result Array containing the non-hidden entities.
   * This function also gathers the stats about how many entities are
   * being filtered by the enabled filter rules.
   * @param entities - the Entities to test
   * @param graph - Graph
   * @return Array of non-hidden entities
   */
  filterScene(entities: OsmEntity[], graph: Graph): OsmEntity[] {
    for (const filter of this._filters.values()) {
      filter.count = 0;
    }

    if (!this._hidden.size) return entities;  // no filters enabled

    const results: OsmEntity[] = [];
    for (const entity of entities) {
      const geometry = entity.geometry(graph) as Geometry;
      const filterID = this.isHidden(entity, graph, geometry);
      if (filterID) {
        // don't count uninteresting vertices
        const ignore = (geometry === 'vertex' && !entity.hasInterestingTags());
        if (!ignore) {
          const filter = this._filters.get(filterID);
          if (filter) filter.count++;
        }
      } else {
        results.push(entity);
      }
    }

    return results;
  }


  /**
   * forceVisible
   * Adds the given entityIDs to the `_forceVisible` Set
   * This is usually done temporarily so that users can see stuff as they edit
   * that might otherwise be hidden
   * @param entityIDs - Array of Entity ids
   */
  forceVisible(entityIDs: string[]): void {
    this._forceVisible = new Set();

    const editor = this.context.systems.editor as any;
    const graph = editor.staging.graph;

    for (const entityID of entityIDs) {
      this._forceVisible.add(entityID);

      const entity = graph.hasEntity(entityID);
      if (entity?.type === 'relation') {  // include relation members (one level deep)
        for (const member of entity.members) {
          this._forceVisible.add(member.id);
        }
      }
    }
  }


  /**
   * _hashchange
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  _hashchange(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // disable_features
    const newDisable = currParams.get('disable_features');
    const oldDisable = prevParams.get('disable_features');
    if (newDisable !== oldDisable) {
      let toDisableIDs = new Set<string>();
      if (typeof newDisable === 'string') {
        toDisableIDs = new Set(newDisable.replace(/;/g, ',').split(','));
      }

      let didChange = false;
      for (const [filterID, filter] of this._filters) {
        if (filter.enabled && toDisableIDs.has(filterID)) {
          filter.enabled = false;
          didChange = true;
        } else if (!filter.enabled && !toDisableIDs.has(filterID)) {
          filter.enabled = true;
          didChange = true;
        }
      }

      if (didChange) {
        this._filterChanged();
      }
    }
  }


  /**
   * _filterChanged
   * Called whenever the enabled/disabled filters change.
   * Used to push changes in state to the urlhash and the localStorage,
   *   then trigger a redraw, and emit a 'filterchange' event.
   */
  _filterChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx as any;
    const storage = context.systems.storage;
    const urlhash = context.systems.urlhash as any;

    // gather hidden
    this._hidden = new Set();
    for (const [filterID, filter] of this._filters) {
      if (!filter.enabled) {
        this._hidden.add(filterID);
      }
    }
    const filterIDs = [...this._hidden].join(',');

    // update url hash
    urlhash?.setParam('disable_features', filterIDs.length ? filterIDs : null);

    // update localstorage
    storage?.setItem('disabled-features', filterIDs);

    gfx?.immediateRedraw();
    this.emit('filterchange');
  }


  // matchers

  _isPoint(tags: Tags, geometry?: Geometry): boolean {
    return geometry === 'point';
  }

  _isTrafficRoad(tags: Tags): boolean {
    return !!traffic_roads[tags.highway as string];
  }

  _isServiceRoad(tags: Tags): boolean {
    return !!service_roads[tags.highway as string];
  }

  _isPath(tags: Tags): boolean {
    return !!paths[tags.highway as string];
  }

  _isBuilding(tags: Tags): boolean {
    return (
      (!!tags.building && tags.building !== 'no') ||
      tags.parking === 'multi-storey' ||
      tags.parking === 'sheds' ||
      tags.parking === 'carports' ||
      tags.parking === 'garage_boxes'
    ) && !this._isPastFuture(tags);
  }

  _isBuildingPart(tags: Tags): boolean {
    return !!tags['building:part'];
  }

  _isIndoor(tags: Tags): boolean {
    return !!tags.indoor;
  }

  _isLanduse(tags: Tags, geometry?: Geometry): boolean {
    return geometry === 'area' &&
      !this._isBuilding(tags) &&
      !this._isBuildingPart(tags) &&
      !this._isIndoor(tags) &&
      !this._isWater(tags) &&
      !this._isAerialway(tags) &&
      !this._isPastFuture(tags);
  }

  _isBoundary(tags: Tags): boolean {
    return (
      !!tags.boundary
    ) && !(
      traffic_roads[tags.highway as string] ||
      service_roads[tags.highway as string] ||
      paths[tags.highway as string] ||
      tags.waterway ||
      tags.railway ||
      tags.landuse ||
      tags.natural ||
      tags.building ||
      tags.power
    );
  }

  _isWater(tags: Tags): boolean {
    return (
      !!tags.waterway ||
      tags.natural === 'water' ||
      tags.natural === 'coastline' ||
      tags.natural === 'bay' ||
      tags.landuse === 'pond' ||
      tags.landuse === 'basin' ||
      tags.landuse === 'reservoir' ||
      tags.landuse === 'salt_pond'
    ) && !this._isPastFuture(tags);
  }

  _isRail(tags: Tags): boolean {
    return (
      !!tags.railway || tags.landuse === 'railway'
    ) && !(
      traffic_roads[tags.highway as string] ||
      service_roads[tags.highway as string] ||
      paths[tags.highway as string]
    ) && !this._isPastFuture(tags);
  }

  _isPiste(tags: Tags): boolean {
    return !!tags['piste:type'];
  }

  _isAerialway(tags: Tags): boolean {
    return !!tags.aerialway &&
      tags.aerialway !== 'yes' &&
      tags.aerialway !== 'station';
  }

  _isPower(tags: Tags): boolean {
    return !!tags.power && !this._isPastFuture(tags);
  }

  // contains a past/future tag, but not in active use as a road/path/cycleway/etc..
  _isPastFuture(tags: Tags): boolean {
    if (traffic_roads[tags.highway as string] || service_roads[tags.highway as string] || paths[tags.highway as string]) {
      return false;
    }

    for (const [k, v] of Object.entries(tags)) {
      if (osmLifecyclePrefixes[k] || osmLifecyclePrefixes[v as string]) return true;

      const parts = k.split(':');
      if (parts.length === 1) continue;
      if (osmLifecyclePrefixes[parts[0]]) return true;
    }

    return false;
  }

  // Lines or areas that don't match another feature filter.
  // IMPORTANT: The 'others' feature must be the last one defined,
  // so that code in getMatches can skip this test if someting else was matched.
  _isOther(tags: Tags, geometry?: Geometry): boolean {
    return (geometry === 'line' || geometry === 'area');
  }
}
