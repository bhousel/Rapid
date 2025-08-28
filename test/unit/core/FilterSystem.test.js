import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('FilterSystem', () => {

  class MockEditSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
    }
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:  new MockEditSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    map:     new Rapid.MockSystem(context),
    storage: new Rapid.StorageSystem(context),
    urlhash: new Rapid.UrlHashSystem(context)
  };

  let _filters;

  beforeEach(() => {
    _filters = new Rapid.FilterSystem(context);
    return _filters.initAsync();
  });


  describe('constructor', () => {
    it('constructs an FilterSystem from a context', () => {
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
    it('returns an promise to init', () => {
      const filters = new Rapid.FilterSystem(context);
      const prom = filters.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const filters = new Rapid.FilterSystem(context);
      filters.requiredDependencies.add('missing');
      const prom = filters.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const filters = new Rapid.FilterSystem(context);
      const prom = filters.initAsync().then(() => filters.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(filters.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const filters = new Rapid.FilterSystem(context);
      const prom = filters.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
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

  it('disable', () => {
    _filters.disable('water');
    assert.isFalse(_filters.isEnabled('water'));
  });

  it('disableAll', () => {
    _filters.disableAll();
    for (const k of _filters.keys) {
      assert.isFalse(_filters.isEnabled(k));
    }
  });

  it('enable', () => {
    _filters.disable('water');
    _filters.enable('water');
    assert.isTrue(_filters.isEnabled('water'));
  });

  it('enableAll', () => {
    _filters.disableAll();
    _filters.enableAll();
    for (const k of _filters.keys) {
      assert.isTrue(_filters.isEnabled(k));
    }
  });

  describe('toggle', () => {
    it('toggles', () => {
      _filters.toggle('water');
      assert.isFalse(_filters.isEnabled('water'));

      _filters.toggle('water');
      assert.isTrue(_filters.isEnabled('water'));
    });
  });


// This previously counted all the features,
// but currently it only counts the hidden features
// so the counts are wrong
  describe.skip('#filterScene', () => {
    it('counts hidden features', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'point_bar', tags: { amenity: 'bar' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_dock', tags: { waterway: 'dock' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_rail_station', tags: { railway: 'station' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_generator', tags: { power: 'generator' }, version: 1 }),
        new Rapid.OsmNode(context, { id: 'point_old_rail_station', tags: { railway: 'station', disused: 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'motorway', tags: { highway: 'motorway' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'building_yes', tags: { area: 'yes', amenity: 'school', building: 'yes' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'boundary', tags: { boundary: 'administrative' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'fence', tags: { barrier: 'fence' }, version: 1 })
      ]);
      const all = [...graph.base.entities.values()];

      _filters.filterScene(all, graph);
      const stats = _filters.getStats();

      assert.strictEqual(stats.boundaries, 1);
      assert.strictEqual(stats.buildings, 1);
      assert.strictEqual(stats.landuse, 0);
      assert.strictEqual(stats.traffic_roads, 1);
      assert.strictEqual(stats.service_roads, 0);
      assert.strictEqual(stats.others, 1);
      assert.strictEqual(stats.past_future, 1);
      assert.strictEqual(stats.paths, 0);
      assert.strictEqual(stats.points, 5);
      assert.strictEqual(stats.power, 1);
      assert.strictEqual(stats.rail, 2);
      assert.strictEqual(stats.water, 1);
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

});
