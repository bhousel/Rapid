import { beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// All test data here is synthetic: a small street grid generated in code.
// Positions are in meters east (x) and north (y) of an arbitrary origin.
const ORIGIN = [10, 40];

function loc(x, y) {
  return [
    ORIGIN[0] + Rapid.sdk.geoMetersToLon(x, ORIGIN[1]),
    ORIGIN[1] + Rapid.sdk.geoMetersToLat(y)
  ];
}

// Distance between two WGS84 locs, in meters (fine for the short distances used here).
function meters(a, b) {
  const dx = Rapid.sdk.geoLonToMeters(b[0] - a[0], ORIGIN[1]);
  const dy = Rapid.sdk.geoLatToMeters(b[1] - a[1]);
  return Math.hypot(dx, dy);
}

const SIDEWALK = { highway: 'footway', footway: 'sidewalk' };
const CROSSING = { highway: 'footway', footway: 'crossing' };
const RESIDENTIAL = { highway: 'residential' };


describe('ConflationSystem', () => {
  let context, editor, conflation, ds;

  // Adds an OSM way to the editor's base graph, with nodes at the given [x, y] positions.
  // If the last point repeats the first, the way is closed (it reuses the first node).
  function osmWay(id, points, tags) {
    const last = points.at(-1);
    const isClosed = points.length > 2 && last[0] === points[0][0] && last[1] === points[0][1];
    const unique = isClosed ? points.slice(0, -1) : points;

    const nodes = unique.map((p, i) => new Rapid.OsmNode(context, { id: `n${id}-${i}`, loc: loc(...p) }));
    const nodeIDs = nodes.map(n => n.id);
    if (isClosed) nodeIDs.push(nodeIDs[0]);

    const way = new Rapid.OsmWay(context, { id: `w${id}`, nodes: nodeIDs, tags: tags });
    editor.merge([...nodes, way]);
    return way;
  }

  // Makes a new feature, as a custom dataset would load it.
  function feature(id, points, properties) {
    const geojson = {
      type: 'Feature',
      id: id,
      properties: properties,
      geometry: { type: 'LineString', coordinates: points.map(p => loc(...p)) }
    };
    return new Rapid.GeoJSONData(context, { id: id, geojson: geojson });
  }

  // A sidewalk rule like a user might set up.
  function sidewalkRule(overrides = {}) {
    return Object.assign({
      geometry: 'line',
      match: { geometry: 'line', tags: [{ key: 'highway', value: 'footway' }] },
      buffer: 3,
      maxAngle: 30,
      reviewFactor: 2
    }, overrides);
  }

  function enable(rules) {
    ds.conflation = { enabled: true, showMatched: false, rules: rules };
  }


  beforeEach(() => {
    context = new Rapid.MockContext();
    context.systems = {
      editor:   null,
      rapid:    new Rapid.MockSystem(context),
      spatial:  new Rapid.SpatialSystem(context),
      storage:  new Rapid.MockSystem(context)
    };
    editor = context.systems.editor = new Rapid.EditSystem(context);
    conflation = context.systems.conflation = new Rapid.ConflationSystem(context);
    ds = new Rapid.RapidDataset(context, { id: 'test', custom: true });

    return conflation.initAsync()
      .then(() => editor.startAsync())
      .then(() => conflation.startAsync());
  });


  describe('lifecycle', () => {
    it('constructs with the expected id and dependencies', () => {
      assert.strictEqual(conflation.id, 'conflation');
      assert.deepEqual([...conflation.requiredDependencies], ['editor', 'rapid', 'spatial']);
    });

    it('rejects init if a dependency is missing', () => {
      const c = new Rapid.ConflationSystem(context);
      c.requiredDependencies.add('missing');
      return c.initAsync()
        .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });


  describe('defaults', () => {
    it('datasets start with conflation disabled, and one rule per geometry type', () => {
      assert.isFalse(ds.conflation.enabled);
      assert.sameMembers(ds.conflation.rules.map(r => r.geometry), ['line', 'point', 'area']);
    });

    it('returns undefined when conflation is disabled', () => {
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.isUndefined(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)));
    });

    it('returns undefined when no rule applies to the feature', () => {
      enable([sidewalkRule({ match: { tags: [{ key: 'footway', value: 'sidewalk' }] } })]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.isUndefined(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], CROSSING)));
    });
  });


  describe('lines', () => {
    it('a sidewalk offset 1.5 m from an OSM sidewalk is already mapped at a 3 m buffer', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK));
      assert.strictEqual(result.status, 'matched');
      assert.isFalse(result.partial);
      assert.strictEqual(result.score, 1);
      assert.lengthOf(result.runs, 1);

      const best = result.candidates[0];
      assert.strictEqual(best.entityID, 'w1');
      assert.closeTo(best.measures.distance, 1.5, 0.05);
      assert.closeTo(best.measures.angle, 0, 0.01);
      assert.strictEqual(best.measures.overlap, 1);
      assert.isFalse(best.measures.intersects);
    });

    it('the same sidewalk needs review at a 1 m buffer, and is new without review margin', () => {
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      enable([sidewalkRule({ buffer: 1 })]);   // review limit is 2 m
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'uncertain');

      enable([sidewalkRule({ buffer: 1, reviewFactor: 1 })]);
      conflation.invalidate();
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('lines never match OSM areas unless the rule asks for them, like building edges along a sidewalk', () => {
      // A building whose south edge runs along y = 0, 1.5 m from the new sidewalk.
      // (`area=yes` because there is no schema here to say that `building` suggests an area.)
      osmWay(1, [[0, 0], [100, 0], [100, 20], [0, 20], [0, 0]], { building: 'yes', area: 'yes' });
      const a = feature('a', [[0, -1.5], [100, -1.5]], SIDEWALK);

      enable([sidewalkRule({ match: {} })]);   // no geometry or tag conditions
      assert.strictEqual(conflation.getResult(ds, a).status, 'unmatched');

      enable([sidewalkRule({ match: { geometry: 'area' } })]);   // explicitly asked for
      conflation.invalidate();
      assert.strictEqual(conflation.getResult(ds, a).status, 'matched');
    });

    it('the review margin loosens distance only, not the angle limit', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      // Within 6 m (the review distance) the whole way, but at 40° (over the 30° limit).
      const dy = 6 * Math.tan(40 * Math.PI / 180);
      const result = conflation.getResult(ds, feature('a', [[40, 0.5], [46, 0.5 + dy]], SIDEWALK));
      assert.strictEqual(result.status, 'unmatched');
      assert.isFalse(result.boxes.some(b => b.status === 'uncertain'));
    });

    it('matches regardless of line direction', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[100, 1.5], [0, 1.5]], SIDEWALK)).status, 'matched');
    });

    it('a crossing perpendicular to an OSM sidewalk is not matched to it', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('x', [[50, -10], [50, 10]], CROSSING));
      assert.strictEqual(result.status, 'unmatched');
      assert.isEmpty(result.candidates);
    });

    it('OSM features that fail the rule\'s tag conditions are ignored', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], RESIDENTIAL);   // a road, not a footway
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('a partly mapped sidewalk splits into runs, and the new run joins the existing way', () => {
      enable([sidewalkRule()]);
      const way = osmWay(1, [[0, 0], [60, 0]], SIDEWALK);   // OSM sidewalk covers x = 0..60

      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK));
      assert.strictEqual(result.status, 'unmatched');   // there is new data to offer
      assert.isTrue(result.partial);
      assert.deepEqual(result.runs.map(r => r.status), ['matched', 'unmatched']);

      const run = result.runs[1];
      assert.isUndefined(run.endJoin);
      assert.isOk(run.startJoin);
      assert.strictEqual(run.startJoin.wayID, 'w1');
      assert.strictEqual(run.startJoin.nodeID, way.nodes.at(-1));   // reuses the existing end node
      assert.isBelow(meters(run.startJoin.loc, loc(60, 0)), 0.01);

      // The new run starts inside the matched stretch, so it overlaps it a little, and ends at the line's end.
      assert.isBelow(run.coords[0][0], loc(65, 0)[0]);
      assert.isBelow(meters(run.coords.at(-1), loc(150, 1.5)), 0.01);
    });

    it('a new run between two mapped stretches of different ways joins both, reusing their end nodes', () => {
      enable([sidewalkRule()]);
      const w1 = osmWay(1, [[0, 0], [40, 0]], SIDEWALK);
      const w2 = osmWay(2, [[100, 0], [200, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK));
      assert.deepEqual(result.runs.map(r => r.status), ['matched', 'unmatched', 'matched']);

      const run = result.runs[1];
      assert.strictEqual(run.startJoin.wayID, 'w1');
      assert.strictEqual(run.startJoin.nodeID, w1.nodes.at(-1));
      assert.strictEqual(run.endJoin.wayID, 'w2');
      assert.strictEqual(run.endJoin.nodeID, w2.nodes[0]);
    });

    it('where a new line detours away from an OSM way and back, the run joins mid-way', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [200, 0]], SIDEWALK);   // nodes only at x = 0 and x = 200

      const points = [[0, 1.5], [60, 1.5], [62, 20], [78, 20], [80, 1.5], [150, 1.5]];
      const result = conflation.getResult(ds, feature('a', points, SIDEWALK));
      assert.deepEqual(result.runs.map(r => r.status), ['matched', 'unmatched', 'matched']);

      const run = result.runs[1];
      for (const join of [run.startJoin, run.endJoin]) {
        assert.strictEqual(join.wayID, 'w1');
        assert.isUndefined(join.nodeID);   // no node nearby, so a new one will be added to w1
        assert.isBelow(Math.abs(join.loc[1] - ORIGIN[1]), 1e-7);   // on w1, at y = 0
      }
      assert.isBelow(meters(run.startJoin.loc, loc(60, 0)), 0.01);
    });

    it('short misalignment at the end of a match is not reported as new', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      // The new sidewalk overshoots the OSM one by 2 m, less than the buffer.
      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [102, 1.5]], SIDEWALK));
      assert.strictEqual(result.status, 'matched');
      assert.isFalse(result.partial);
    });

    it('scores a partial line by the share of its boxes that are already mapped', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK));
      assert.isAbove(result.score, 0.3);
      assert.isBelow(result.score, 0.5);
      assert.isAbove(result.candidates[0].measures.overlap, 0.35);
      assert.isBelow(result.candidates[0].measures.overlap, 0.5);
    });
  });


  describe('unknown', () => {
    it('reports unknown, and does not cache it, where OSM data is not loaded', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);

      let loaded = false;
      context.services.osm = { isDataLoaded: () => loaded };
      assert.strictEqual(conflation.getResult(ds, a).status, 'unknown');

      loaded = true;
      assert.strictEqual(conflation.getResult(ds, a).status, 'matched');
    });
  });


  describe('caching and invalidation', () => {
    it('caches results', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, a), conflation.getResult(ds, a));
    });

    it('recomputes after an edit: accepting the missing part makes it already mapped, and undo brings it back', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);
      assert.isTrue(conflation.getResult(ds, a).partial);

      const onChange = mock(() => {});
      conflation.on('conflationchange', onChange);

      // Map the rest of the sidewalk, as accepting the new run would.
      const n1 = new Rapid.OsmNode(context, { id: 'n-new-1', loc: loc(60, 0) });
      const n2 = new Rapid.OsmNode(context, { id: 'n-new-2', loc: loc(150, 0) });
      const w = new Rapid.OsmWay(context, { id: 'w-new', nodes: ['n-new-1', 'n-new-2'], tags: SIDEWALK });
      editor.perform(Rapid.actionAddEntity(n1), Rapid.actionAddEntity(n2), Rapid.actionAddEntity(w));
      editor.commit({ annotation: 'mapped the rest' });

      assert.isAbove(onChange.mock.calls.length, 0);
      const after = conflation.getResult(ds, a);
      assert.strictEqual(after.status, 'matched');
      assert.isFalse(after.partial);

      editor.undo();
      assert.isTrue(conflation.getResult(ds, a).partial);
    });

    it('invalidate(datasetID) flushes only that dataset', () => {
      enable([sidewalkRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);
      const first = conflation.getResult(ds, a);

      conflation.invalidate('other');
      assert.strictEqual(conflation.getResult(ds, a), first);

      conflation.invalidate('test');
      assert.notStrictEqual(conflation.getResult(ds, a), first);
    });
  });


  describe('getQueue', () => {
    it('lists features in view that need review', () => {
      enable([sidewalkRule({ buffer: 1 })]);   // 1.5 m offsets need review
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);     // needs review
      const b = feature('b', [[0, 50], [100, 50]], SIDEWALK);       // new
      context.systems.spatial.replaceData(ds.spatialID, [a, b]);

      // Center the viewport on the fixture.
      const viewport = context.viewport;
      viewport.dimensions = [2000, 2000];
      viewport.transform = { x: 0, y: 0, z: 17 };
      const p = viewport.project(loc(50, 25));
      viewport.transform = { x: 1000 - p[0], y: 1000 - p[1], z: 17 };

      const queue = conflation.getQueue(ds);
      assert.deepEqual(queue.map(r => r.dataID), ['a']);
    });
  });

});
