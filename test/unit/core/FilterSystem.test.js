import { beforeAll, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('FilterSystem', () => {

  class MockEditSystem extends Rapid.MockSystem {
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    editor:  new MockEditSystem(context)
  };


  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a FilterSystem from a context', () => {
        const filters = new Rapid.FilterSystem(context);
        assert.instanceOf(filters, Rapid.FilterSystem);
        assert.strictEqual(filters.id, 'filters');
        assert.strictEqual(filters.context, context);
        assert.instanceOf(filters.requiredDependencies, Set);
        assert.instanceOf(filters.optionalDependencies, Set);
        assert.isTrue(filters.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const filters = new Rapid.FilterSystem(context);
        const prom = filters.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const filters = new Rapid.FilterSystem(context);
        filters.requiredDependencies.add('missing');
        const prom = filters.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const filters = new Rapid.FilterSystem(context);
        const prom = filters.initAsync().then(() => filters.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(filters.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const filters = new Rapid.FilterSystem(context);
        const prom = filters.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    const spyFilterChange = mock();
    let _filters;

    beforeAll(() => {
      _filters = new Rapid.FilterSystem(context);
      return _filters.initAsync()
        .then(() => _filters.startAsync())
        .then(() => _filters.on('filterchange', spyFilterChange));
    });


    it('gets keys', () => {
      const keys = _filters.keys;
      assert.deepEqual(keys, [
        'points',        'traffic_roads',
        'service_roads', 'paths',
        'buildings',     'building_parts',
        'indoor',        'landuse',
        'boundaries',    'water',
        'rail',          'pistes',
        'aerialways',    'power',
        'past_future',   'others'
      ]);
    });

    it('gets hidden filters', () => {
      _filters.enableAll();
      let hidden = _filters.hidden;
      assert.instanceOf(hidden, Set);
      assert.strictEqual(hidden.size, 0);

      _filters.disable('water');
      _filters.disable('power');
      hidden = _filters.hidden;
      assert.strictEqual(hidden.size, 2);
      assert.isTrue(hidden.has('water'));
      assert.isTrue(hidden.has('power'));

      _filters.enableAll();
    });

    it('disable', () => {
      _filters.enable('water');  // reset
      spyFilterChange.mockClear();

      _filters.disable('water');
      assert.isFalse(_filters.isEnabled('water'));
      assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchanged called once
    });

    it('disableAll', () => {
      _filters.enableAll();  // reset
      spyFilterChange.mockClear();

      _filters.disableAll();
      for (const k of _filters.keys) {
        assert.isFalse(_filters.isEnabled(k));
      }
      assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchanged called once
    });

    it('enable', () => {
      _filters.disable('water');  // reset
      spyFilterChange.mockClear();

      _filters.enable('water');
      assert.isTrue(_filters.isEnabled('water'));
      assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchanged called once
    });

    it('enableAll', () => {
      _filters.disableAll();  // reset
      spyFilterChange.mockClear();

      _filters.enableAll();
      for (const k of _filters.keys) {
        assert.isTrue(_filters.isEnabled(k));
      }
      assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchanged called once
    });

    describe('toggle', () => {
      it('toggles', () => {
        _filters.enable('water');  // reset
        spyFilterChange.mockClear();

        _filters.toggle('water');
        assert.isFalse(_filters.isEnabled('water'));

        _filters.toggle('water');
        assert.isTrue(_filters.isEnabled('water'));
        assert.lengthOf(spyFilterChange.mock.calls, 2);   // filterchanged called twice
      });
    });


    describe('cache management', () => {
      it('clearEntity clears cache for a single entity', () => {
        const graph = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', tags: { amenity: 'bar' }, version: 1 })
        ]);
        const entity = graph.entity('a');
        const geometry = entity.geometry(graph);

        // First call will populate cache
        _filters.getMatches(entity, graph, geometry);
        assert.isDefined(_filters._cache[entity.key]);

        // Clear should remove from cache
        _filters.clearEntity(entity);
        assert.isUndefined(_filters._cache[entity.key]);
      });

      it('clear clears cache for multiple entities', () => {
        const graph = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', tags: { amenity: 'bar' }, version: 1 }),
          new Rapid.OsmNode(context, { id: 'b', tags: { waterway: 'dock' }, version: 1 })
        ]);
        const a = graph.entity('a');
        const b = graph.entity('b');

        // Populate cache
        _filters.getMatches(a, graph, a.geometry(graph));
        _filters.getMatches(b, graph, b.geometry(graph));
        assert.isDefined(_filters._cache[a.key]);
        assert.isDefined(_filters._cache[b.key]);

        // Clear both
        _filters.clear([a, b]);
        assert.isUndefined(_filters._cache[a.key]);
        assert.isUndefined(_filters._cache[b.key]);
      });
    });


    describe('isHiddenPreset', () => {
      it('returns null when no filters are hidden', () => {
        _filters.enableAll();
        const preset = {
          tags: { amenity: 'bar' },
          setTags: (tags) => ({ ...tags, amenity: 'bar' })
        };
        assert.isNull(_filters.isHiddenPreset(preset, 'point'));
      });

      it('returns null when preset has no tags', () => {
        _filters.disable('points');
        const preset = {
          setTags: (tags) => tags
        };
        assert.isNull(_filters.isHiddenPreset(preset, 'point'));
      });

      it('returns filterID when preset matches a hidden filter', () => {
        _filters.enableAll();
        _filters.disable('water');
        const preset = {
          tags: { natural: 'water' },
          setTags: (tags) => ({ ...tags, natural: 'water', area: 'yes' })
        };
        assert.strictEqual(_filters.isHiddenPreset(preset, 'area'), 'water');
      });

      it('returns null when preset matches an enabled filter', () => {
        _filters.enableAll();
        const preset = {
          tags: { highway: 'residential' },
          setTags: (tags) => ({ ...tags, highway: 'residential' })
        };
        assert.isNull(_filters.isHiddenPreset(preset, 'line'));
      });
    });


    describe('hasHiddenConnections', () => {
      it('returns false when no filters are hidden', () => {
        _filters.enableAll();
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b', version: 1 });
        const way = new Rapid.OsmWay(context, { id: 'w', nodes: [a.id, b.id], tags: { highway: 'residential' }, version: 1 });
        const graph = new Rapid.Graph(context, [a, b, way]);

        assert.isFalse(_filters.hasHiddenConnections(way, graph));
      });

      it('returns true when entity is connected to a hidden way', () => {
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b', version: 1 });
        const c = new Rapid.OsmNode(context, { id: 'c', version: 1 });
        const way1 = new Rapid.OsmWay(context, { id: 'w1', nodes: [a.id, b.id], tags: { highway: 'residential' }, version: 1 });
        const way2 = new Rapid.OsmWay(context, { id: 'w2', nodes: [b.id, c.id], tags: { highway: 'path' }, version: 1 });
        const graph = new Rapid.Graph(context, [a, b, c, way1, way2]);

        _filters.enableAll();
        _filters.disable('paths');

        // way1 should detect connection to hidden way2 (they share node b)
        assert.isTrue(_filters.hasHiddenConnections(way1, graph));
      });

      it('returns false for entities without nodes or connections', () => {
        const way = new Rapid.OsmWay(context, { id: 'w1', tags: { highway: 'residential' }, version: 1 });
        const graph = new Rapid.Graph(context, [way]);

        _filters.enableAll();
        _filters.disable('traffic_roads');

        // way has no connections, so should return false
        assert.isFalse(_filters.hasHiddenConnections(way, graph));
      });

      it('handles midpoint entities', () => {
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b', version: 1 });
        const way = new Rapid.OsmWay(context, { id: 'w', nodes: [a.id, b.id], tags: { highway: 'path' }, version: 1 });
        const graph = new Rapid.Graph(context, [a, b, way]);

        _filters.enableAll();
        _filters.disable('paths');

        const midpoint = { type: 'midpoint', edge: [a.id, b.id] };
        assert.isTrue(_filters.hasHiddenConnections(midpoint, graph));
      });
    });


    describe('filterScene', () => {
      it('returns all entities when no filters are hidden', () => {
        _filters.enableAll();
        const graph = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'point_bar', tags: { amenity: 'bar' }, version: 1 }),
          new Rapid.OsmNode(context, { id: 'point_dock', tags: { waterway: 'dock' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'motorway', tags: { highway: 'motorway' }, version: 1 })
        ]);
        const all = [...graph.base.entities.values()];

        const result = _filters.filterScene(all, graph);
        assert.strictEqual(result.length, 3);
        const stats = _filters.getStats();
        assert.strictEqual(stats.points.count, 0);
        assert.strictEqual(stats.water.count, 0);
        assert.strictEqual(stats.traffic_roads.count, 0);
      });

      it('filters out hidden features and counts them', () => {
        _filters.enableAll();
        _filters.disable('water');
        _filters.disable('power');
        _filters.disable('buildings');

        const graph = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'point_bar', tags: { amenity: 'bar' }, version: 1 }),
          new Rapid.OsmNode(context, { id: 'point_rail', tags: { railway: 'station' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'motorway', tags: { highway: 'motorway' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'building_yes', tags: { area: 'yes', building: 'yes' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'water', tags: { area: 'yes', natural: 'water' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'river', tags: { waterway: 'river' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'power_line', tags: { power: 'line' }, version: 1 }),
          new Rapid.OsmWay(context, { id: 'fence', tags: { barrier: 'fence' }, version: 1 })
        ]);
        const all = [...graph.base.entities.values()];

        const result = _filters.filterScene(all, graph);
        const stats = _filters.getStats();

        // Check that hidden features are counted
        assert.strictEqual(stats.water.count, 2);  // water way + river way
        assert.strictEqual(stats.power.count, 1);  // power_line
        assert.strictEqual(stats.buildings.count, 1);  // building_yes

        // Check that enabled filters have zero count
        assert.strictEqual(stats.points.count, 0);
        assert.strictEqual(stats.traffic_roads.count, 0);
        assert.strictEqual(stats.rail.count, 0);

        // Check that result doesn't include hidden features
        const resultIDs = result.map(e => e.id);
        assert.isTrue(resultIDs.includes('point_bar'));
        assert.isTrue(resultIDs.includes('point_rail'));
        assert.isFalse(resultIDs.includes('building_yes')); // hidden (buildings)
        assert.isFalse(resultIDs.includes('power_line')); // hidden (power)
        assert.isFalse(resultIDs.includes('water'));          // hidden (water)
        assert.isFalse(resultIDs.includes('river'));          // hidden (water)
        assert.isTrue(resultIDs.includes('motorway'));
        assert.isTrue(resultIDs.includes('fence'));
      });

      it('does not count uninteresting vertices', () => {
        _filters.enableAll();
        _filters.disable('paths');

        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b', version: 1 });
        const path = new Rapid.OsmWay(context, { id: 'path', nodes: [a.id, b.id], tags: { highway: 'path' }, version: 1 });
        const graph = new Rapid.Graph(context, [a, b, path]);
        const all = [...graph.base.entities.values()];

        const result = _filters.filterScene(all, graph);
        const stats = _filters.getStats();

        // The path way should be counted
        assert.strictEqual(stats.paths.count, 1);

        // Vertices should not be included in result
        const resultIDs = result.map(e => e.id);
        assert.isFalse(resultIDs.includes('a'));
        assert.isFalse(resultIDs.includes('b'));
        assert.isFalse(resultIDs.includes('path'));
      });
    });


    describe('matching', () => {
      const graph = new Rapid.Graph(context, [
        // Points
        new Rapid.OsmNode(context, { id: 'point_bar', tags: { amenity: 'bar' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_dock', tags: { waterway: 'dock' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_rail_station', tags: { railway: 'station' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_generator', tags: { power: 'generator' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_old_rail_station', tags: { railway: 'station', disused: 'yes' }, version: 1 }),

        // Traffic Roads
        new Rapid.OsmWay(context, { id: 'motorway', tags: { highway: 'motorway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'motorway_link', tags: { highway: 'motorway_link' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'trunk', tags: { highway: 'trunk' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'trunk_link', tags: { highway: 'trunk_link' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'primary', tags: { highway: 'primary' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'primary_link', tags: { highway: 'primary_link' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'secondary', tags: { highway: 'secondary' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'secondary_link', tags: { highway: 'secondary_link' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'tertiary', tags: { highway: 'tertiary' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'tertiary_link', tags: { highway: 'tertiary_link' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'residential', tags: { highway: 'residential' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'unclassified', tags: { highway: 'unclassified' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'living_street', tags: { highway: 'living_street' }, version: 1 }),

        // Service Roads
        new Rapid.OsmWay(context, { id: 'service', tags: { highway: 'service' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'road', tags: { highway: 'road' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'track', tags: { highway: 'track' }, version: 1 }),

        // Paths
        new Rapid.OsmWay(context, { id: 'path', tags: { highway: 'path' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'footway', tags: { highway: 'footway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'cycleway', tags: { highway: 'cycleway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'bridleway', tags: { highway: 'bridleway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'steps', tags: { highway: 'steps' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'pedestrian', tags: { highway: 'pedestrian' }, version: 1 }),

        // Buildings
        new Rapid.OsmWay(context, { id: 'building_yes', tags: { area: 'yes', amenity: 'school', building: 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'building_no', tags: { area: 'yes', amenity: 'school', building: 'no' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'building_part', tags: { 'building:part': 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'building_demolished', tags: { 'demolished:building': 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'garage1', tags: { area: 'yes', amenity: 'parking', parking: 'multi-storey' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'garage2', tags: { area: 'yes', amenity: 'parking', parking: 'sheds' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'garage3', tags: { area: 'yes', amenity: 'parking', parking: 'carports' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'garage4', tags: { area: 'yes', amenity: 'parking', parking: 'garage_boxes' }, version: 1 }),

        // Indoor
        new Rapid.OsmWay(context, { id: 'room', tags: { area: 'yes', indoor: 'room' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'indoor_area', tags: { area: 'yes', indoor: 'area' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'indoor_bar', tags: { area: 'yes', indoor: 'room', amenity: 'bar' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'corridor', tags: { highway: 'corridor', indoor: 'yes' }, version: 1 }),

        // Pistes
        new Rapid.OsmWay(context, { id: 'downhill_piste', tags: { 'piste:type': 'downhill' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'piste_track_combo', tags: { 'piste:type': 'alpine', highway: 'track' }, version: 1 }),

        // Aerialways
        new Rapid.OsmWay(context, { id: 'gondola', tags: { aerialway: 'gondola' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'zip_line', tags: { aerialway: 'zip_line' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'aerialway_platform', tags: { public_transport: 'platform', aerialway: 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'old_aerialway_station', tags: { area: 'yes', aerialway: 'station' }, version: 1 }),

        // Landuse
        new Rapid.OsmWay(context, { id: 'forest', tags: { area: 'yes', landuse: 'forest' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'scrub', tags: { area: 'yes', natural: 'scrub' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'industrial', tags: { area: 'yes', landuse: 'industrial' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'parkinglot', tags: { area: 'yes', amenity: 'parking', parking: 'surface' }, version: 1 }),

        // Landuse Multipolygon
        new Rapid.OsmWay(context, { id: 'outer', version: 1 }),
        new Rapid.OsmWay(context, { id: 'inner1', version: 1 }),
        new Rapid.OsmWay(context, { id: 'inner2', tags: { barrier: 'fence' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'inner3', tags: { highway: 'residential' }, version: 1 }),
        new Rapid.OsmRelation(context, {
          id: 'retail',
          tags: { landuse: 'retail', type: 'multipolygon' },
          members: [
            { id: 'outer', role: 'outer', type: 'way' },
            { id: 'inner1', role: 'inner', type: 'way' },
            { id: 'inner2', role: 'inner', type: 'way' },
            { id: 'inner3', role: 'inner', type: 'way' }
          ],
          version: 1
        }),

        // Boundaries
        new Rapid.OsmWay(context, { id: 'boundary', tags: { boundary: 'administrative' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'boundary_road', tags: { boundary: 'administrative', highway: 'primary' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'boundary_member', version: 1 }),
        new Rapid.OsmWay(context, { id: 'boundary_member2', version: 1 }),

        // Boundary relations
        new Rapid.OsmRelation(context, {
          id: 'boundary_relation',
          tags: { type: 'boundary', boundary: 'administrative' },
          members: [
            { id: 'boundary_member' },
          ],
          version: 1
        }),
        new Rapid.OsmRelation(context, {
          id: 'boundary_relation2',
          tags: { type: 'boundary', boundary: 'administrative' },
          members: [
            // ways can be members of multiple boundary relations
            { id: 'boundary_member' },
            { id: 'boundary_member2' }
          ],
          version: 1
        }),

        // Water
        new Rapid.OsmWay(context, { id: 'water', tags: { area: 'yes', natural: 'water' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'coastline', tags: {natural: 'coastline' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'bay', tags: { area: 'yes', natural: 'bay' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'pond', tags: { area: 'yes', landuse: 'pond' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'basin', tags: { area: 'yes', landuse: 'basin' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'reservoir', tags: { area: 'yes', landuse: 'reservoir' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'salt_pond', tags: { area: 'yes', landuse: 'salt_pond' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'river', tags: { waterway: 'river' }, version: 1 }),

        // Rail
        new Rapid.OsmWay(context, { id: 'railway', tags: { railway: 'rail' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'rail_landuse', tags: { area: 'yes', landuse: 'railway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'rail_disused', tags: { railway: 'disused' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'rail_streetcar', tags: { railway: 'tram', highway: 'residential' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'rail_trail', tags: { railway: 'disused', highway: 'cycleway' }, version: 1 }),

        // Power
        new Rapid.OsmWay(context, { id: 'power_line', tags: { power: 'line' }, version: 1 }),

        // Past/Future
        new Rapid.OsmWay(context, { id: 'motorway_construction', tags: { highway: 'construction', construction: 'motorway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'cycleway_proposed', tags: { highway: 'proposed', proposed: 'cycleway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'landuse_construction', tags: { area: 'yes', landuse: 'construction' }, version: 1 }),

        // Others
        new Rapid.OsmWay(context, { id: 'fence', tags: { barrier: 'fence' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'pipeline', tags: { man_made: 'pipeline' }, version: 1 }),

        // Site relation
        new Rapid.OsmRelation(context, {
          id: 'site',
          tags: { type: 'site' },
          members: [
            { id: 'fence', role: 'perimeter' },
            { id: 'building_yes' }
          ],
          version: 1
        })
      ]);


      function doMatch(filterID, entityIDs) {
        for (const entityID of entityIDs) {
          const entity = graph.entity(entityID);
          const geometry = entity.geometry(graph);
          const matches = _filters.getMatches(entity, graph, geometry);
          assert.isTrue(matches.has(filterID), `doMatch: ${entityID}`);
        }
      }

      function dontMatch(filterID, entityIDs) {
        for (const entityID of entityIDs) {
          const entity = graph.entity(entityID);
          const geometry = entity.geometry(graph);
          const matches = _filters.getMatches(entity, graph, geometry);
          assert.isFalse(matches.has(filterID), `dontMatch: ${entityID}`);
        }
      }


      it('matches points', () => {
        doMatch('points', [
          'point_bar', 'point_dock', 'point_rail_station',
          'point_generator', 'point_old_rail_station'
        ]);

        dontMatch('points', [
          'motorway', 'service', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches traffic roads', () => {
        doMatch('traffic_roads', [
          'motorway', 'motorway_link', 'trunk', 'trunk_link',
          'primary', 'primary_link', 'secondary', 'secondary_link',
          'tertiary', 'tertiary_link', 'residential', 'living_street',
          'unclassified', 'boundary_road', 'inner3'
        ]);

        dontMatch('traffic_roads', [
          'point_bar', 'service', 'road', 'track', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches service roads', () => {
        doMatch('service_roads', [
          'service', 'road', 'track', 'piste_track_combo'
        ]);

        dontMatch('service_roads', [
          'point_bar', 'motorway', 'unclassified', 'living_street',
          'path', 'building_yes', 'forest', 'boundary', 'boundary_member', 'water',
          'railway', 'power_line', 'motorway_construction', 'fence'
        ]);
      });


      it('matches paths', () => {
        doMatch('paths', [
          'path', 'footway', 'cycleway', 'bridleway',
          'steps', 'pedestrian'
        ]);

        dontMatch('paths', [
          'point_bar', 'motorway', 'service', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence', 'corridor'
        ]);
      });


      it('matches buildings', () => {
        doMatch('buildings', [
          'building_yes',
          'garage1', 'garage2', 'garage3', 'garage4'
        ]);

        dontMatch('buildings', [
          'building_no', 'building_demolished', 'point_bar', 'motorway', 'service', 'path',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches building_parts', () => {
        doMatch('building_parts', [
          'building_part'
        ]);

        dontMatch('building_parts', [
          'building_yes',
          'garage1', 'garage2', 'garage3', 'garage4',
          'building_no', 'building_demolished', 'point_bar', 'motorway', 'service', 'path',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches indoor', () => {
        doMatch('indoor', [
          'room', 'indoor_area', 'indoor_bar', 'corridor'
        ]);

        dontMatch('indoor', [
          'downhill_piste', 'piste_track_combo',
          'building_part', 'garage1', 'garage2', 'garage3', 'garage4',
          'building_no', 'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence',
          'inner3', 'forest', 'scrub', 'industrial', 'parkinglot', 'building_no',
          'rail_landuse', 'landuse_construction', 'retail',
          'outer', 'inner1', 'inner2'
        ]);
      });


      it('matches pistes', () => {
        doMatch('pistes', [
          'downhill_piste', 'piste_track_combo'
        ]);

        dontMatch('pistes', [
          'room', 'indoor_area', 'indoor_bar', 'corridor',
          'building_part', 'garage1', 'garage2', 'garage3', 'garage4',
          'building_no', 'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence',
          'inner3', 'forest', 'scrub', 'industrial', 'parkinglot', 'building_no',
          'rail_landuse', 'landuse_construction', 'retail',
          'outer', 'inner1', 'inner2'
        ]);
      });


      it('matches aerialways', () => {
        doMatch('aerialways', [
          'gondola', 'zip_line'
        ]);

        dontMatch('aerialways', [
          'aerialway_platform', 'old_aerialway_station',

          'downhill_piste', 'piste_track_combo',
          'room', 'indoor_area', 'indoor_bar', 'corridor',
          'building_part', 'garage1', 'garage2', 'garage3', 'garage4',
          'building_no', 'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence',
          'inner3', 'forest', 'scrub', 'industrial', 'parkinglot', 'building_no',
          'rail_landuse', 'landuse_construction', 'retail',
          'outer', 'inner1', 'inner2'
        ]);
      });


      it('matches landuse', () => {
        doMatch('landuse', [
          'forest', 'scrub', 'industrial', 'parkinglot', 'building_no',
          'rail_landuse', /*'landuse_construction',*/ 'retail',
          'outer', 'inner1', 'inner2'  // non-interesting members of landuse multipolygon
        ]);

        dontMatch('landuse', [
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence',
          'inner3'   // member of landuse multipolygon, but tagged as highway
        ]);
      });


      it('matches boundaries', () => {
        doMatch('boundaries', [
          'boundary',
          // match ways that are part of boundary relations - #5601
          'boundary_member', 'boundary_member2',
          // relations
          'boundary_relation', 'boundary_relation2'
        ]);

        dontMatch('boundaries', [
          'boundary_road',   // because boundary also used as highway - #4973
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'forest', 'water', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches water', () => {
        doMatch('water', [
          'point_dock', 'water', 'coastline', 'bay', 'pond',
          'basin', 'reservoir', 'salt_pond', 'river'
        ]);

        dontMatch('water', [
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'railway', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches rail', () => {
        doMatch('rail', [
          'point_rail_station', 'railway', 'rail_landuse'
        ]);

        dontMatch('rail', [
          'rail_streetcar', 'rail_trail',  // because rail also used as highway
          'rail_disused', 'point_old_rail_station', 'point_bar', 'motorway', 'service', 'path',
          'building_yes', 'forest', 'boundary', 'boundary_member', 'water', 'power_line',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches power', () => {
        doMatch('power', [
          'point_generator', 'power_line'
        ]);

        dontMatch('power', [
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway',
          'motorway_construction', 'fence'
        ]);
      });


      it('matches past/future', () => {
        doMatch('past_future', [
          'building_demolished', 'point_old_rail_station', 'rail_disused',
          'motorway_construction', 'cycleway_proposed', 'landuse_construction'
        ]);

        dontMatch('past_future', [
          'rail_trail',  // because rail also used as highway
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line', 'fence'
        ]);
      });


      it('matches others', () => {
        doMatch('others', [
          'fence', 'pipeline'
        ]);

        dontMatch('others', [
          'point_bar', 'motorway', 'service', 'path', 'building_yes',
          'forest', 'boundary', 'boundary_member', 'water', 'railway', 'power_line',
          'motorway_construction', 'retail', 'outer', 'inner1', 'inner2', 'inner3'
        ]);
      });
    });


    describe('hiding', () => {
      it('hides child vertices on a hidden way', () => {
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b', version: 1 });
        const w = new Rapid.OsmWay(context, { id: 'w', nodes: [a.id, b.id], tags: { highway: 'path' }, version: 1 });
        const graph = new Rapid.Graph(context, [a, b, w]);
        const geometry = a.geometry(graph);

        _filters.disable('paths');
        assert.strictEqual(_filters.isHiddenVertex(a, graph, geometry), 'paths');
        assert.strictEqual(_filters.isHiddenVertex(b, graph, geometry), 'paths');
        assert.strictEqual(_filters.isHidden(a, graph, geometry), 'paths');
        assert.strictEqual(_filters.isHidden(b, graph, geometry), 'paths');
      });

      it('hides uninteresting (e.g. untagged or "other") member ways on a hidden multipolygon relation', () => {
        const outer = new Rapid.OsmWay(context, { id: 'outer', tags: { area: 'yes', natural: 'wood' }, version: 1 });
        const inner1 = new Rapid.OsmWay(context, { id: 'inner1', tags: { barrier: 'fence' }, version: 1 });
        const inner2 = new Rapid.OsmWay(context, { id: 'inner2', version: 1 });
        const inner3 = new Rapid.OsmWay(context, { id: 'inner3', tags: { highway: 'residential' }, version: 1 });
        const r = new Rapid.OsmRelation(context, {
          id: 'r',
          tags: { type: 'multipolygon' },
          members: [
            { id: outer.id, role: 'outer', type: 'way' },
            { id: inner1.id, role: 'inner', type: 'way' },
            { id: inner2.id, role: 'inner', type: 'way' },
            { id: inner3.id, role: 'inner', type: 'way' }
          ],
          version: 1
        });
        const graph = new Rapid.Graph(context, [outer, inner1, inner2, inner3, r]);

        _filters.disable('landuse');
        assert.strictEqual(_filters.isHidden(outer, graph, outer.geometry(graph)), 'landuse');    // iD#2548
        assert.strictEqual(_filters.isHidden(inner1, graph, inner1.geometry(graph)), 'landuse');  // iD#2548
        assert.strictEqual(_filters.isHidden(inner2, graph, inner2.geometry(graph)), 'landuse');  // iD#2548
        assert.isNull(_filters.isHidden(inner3, graph, inner3.geometry(graph)));                   // iD#2887
      });

      it('hides only versioned entities', () => {
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const b = new Rapid.OsmNode(context, { id: 'b' });
        const graph = new Rapid.Graph(context, [a, b]);
        const ageo = a.geometry(graph);
        const bgeo = b.geometry(graph);

        _filters.disable('points');
        assert.strictEqual(_filters.isHidden(a, graph, ageo), 'points');
        assert.isNull(_filters.isHidden(b, graph, bgeo));
      });

      it('shows a hidden entity if forceVisible', () => {
        const a = new Rapid.OsmNode(context, { id: 'a', version: 1 });
        const graph = new Rapid.Graph(context, [a]);
        const ageo = a.geometry(graph);

        _filters.disable('points');
        _filters.forceVisible(['a']);
        assert.isNull(_filters.isHidden(a, graph, ageo));
      });
    });


    describe('_hashChanged', () => {
      it('does nothing when disable_features param is unchanged', () => {
        _filters.enableAll();  // reset
        spyFilterChange.mockClear();

        const curr = new Map([['other', 'value']]);
        const prev = new Map([['other', 'value']]);
        _filters._hashChanged(curr, prev);
        assert.lengthOf(spyFilterChange.mock.calls, 0);   // No filterchange should occur
      });

      it('handles disable_features param set to a value', () => {
        _filters.enableAll();  // reset
        spyFilterChange.mockClear();

        // 'water' and 'rail' added to the list
        const curr = new Map([['disable_features', 'water,rail']]);
        const prev = new Map();
        _filters._hashChanged(curr, prev);
        assert.isFalse(_filters.isEnabled('water'));
        assert.isFalse(_filters.isEnabled('rail'));
        assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchange emitted
      });

      it('handles disable_features param set to empty string', () => {
        _filters.disable('water');
        _filters.disable('rail');
        spyFilterChange.mockClear();

        // 'water' and 'rail' removed from the list
        const curr = new Map([['disable_features', '']]);
        const prev = new Map([['disable_features', 'water,rail']]);
        _filters._hashChanged(curr, prev);
        assert.isTrue(_filters.isEnabled('water'));
        assert.isTrue(_filters.isEnabled('rail'));
        assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchange emitted
      });

      it('handles disable_features param set to empty string', () => {
        _filters.disable('water');
        spyFilterChange.mockClear();

        // list cleared
        const curr = new Map();
        const prev = new Map([['disable_features', 'water,rail']]);
        _filters._hashChanged(curr, prev);
        assert.isTrue(_filters.isEnabled('water'));
        assert.isTrue(_filters.isEnabled('rail'));
        assert.lengthOf(spyFilterChange.mock.calls, 1);   // filterchange emitted
      });
    });

  });

});
