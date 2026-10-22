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
const LIVING_STREET = { highway: 'living_street' };
const PATH = { highway: 'path' };
const RESIDENTIAL = { highway: 'residential' };
const RAILWAY = { railway: 'rail' };


describe('ConflationSystem', () => {
  let context, editor, conflation, ds, acted;

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

  // Makes a source feature, as a custom dataset would load it.
  function feature(id, points, properties) {
    const geojson = {
      type: 'Feature',
      id: id,
      properties: properties,
      geometry: { type: 'LineString', coordinates: points.map(p => loc(...p)) }
    };
    return new Rapid.GeoJSONData(context, { id: id, datasetID: 'test', geojson: geojson });
  }

  // A line rule like a user might set up: "same" within 3 m / 30°, "near" within 6 m / 30°.
  // By default the target must be a footway.
  function lineRule(overrides = {}) {
    return Object.assign({
      source: { geometry: 'line' },
      target: { geometry: 'line', props: [{ key: 'highway', value: 'footway' }] },
      sameDist: 3,
      sameAngle: 30,
      nearDist: 6,
      nearAngle: 30
    }, overrides);
  }

  function enable(rules) {
    ds.conflated = true;
    ds.conflation = { showMatched: false, rules: rules };
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

    // The ranges of lines that the user accepted or ignored, by data ID (see `RapidSystem.actedRanges`)
    acted = new Map();
    context.systems.rapid.actedRanges = (dataID) => acted.get(dataID) ?? [];
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
    it('datasets start with conflation disabled, and one rule per geometry type with no property conditions', () => {
      assert.isFalse(ds.conflated);
      assert.isFalse(conflation.isEnabled(ds));
      assert.sameMembers(ds.conflation.rules.map(r => r.source.geometry), ['line', 'point', 'area']);
      for (const rule of ds.conflation.rules) {
        assert.strictEqual(rule.target.geometry, rule.source.geometry);
        assert.isUndefined(rule.source.props);
        assert.isUndefined(rule.target.props);
      }
    });

    it('returns undefined when conflation is disabled', () => {
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.isUndefined(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)));
    });

    it('returns undefined when no rule covers the source geometry', () => {
      enable([{ source: { geometry: 'point' }, target: { geometry: 'point' }, sameDist: 3 }]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.isUndefined(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)));
    });
  });


  describe('rules', () => {
    // The three requests that the rule shape was designed around, from least to most specific.

    it('"a nearby line counts, regardless of tagging"', () => {
      enable([lineRule({ target: { geometry: 'line' } })]);
      osmWay(1, [[0, 0], [100, 0]], RAILWAY);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'matched');
    });

    it('"both have a highway tag, any value"', () => {
      const both = [{ key: 'highway' }];
      enable([lineRule({ source: { geometry: 'line', props: both }, target: { geometry: 'line', props: both } })]);
      osmWay(1, [[0, 0], [100, 0]], LIVING_STREET);
      osmWay(2, [[0, 50], [100, 50]], RAILWAY);

      // sidewalk vs living street: both have `highway`, so this is a positive match
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'matched');
      // sidewalk vs railway: the railway has no `highway`
      assert.strictEqual(conflation.getResult(ds, feature('b', [[0, 51.5], [100, 51.5]], SIDEWALK)).status, 'unmatched');
    });

    it('"both have the same highway value"', () => {
      enable([lineRule({ target: { geometry: 'line' }, sameKeys: ['highway'] })]);
      osmWay(1, [[0, 0], [100, 0]], LIVING_STREET);
      osmWay(2, [[0, 50], [100, 50]], SIDEWALK);

      // sidewalk vs living street: different `highway` values, so a negative match
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
      // sidewalk vs sidewalk
      assert.strictEqual(conflation.getResult(ds, feature('b', [[0, 51.5], [100, 51.5]], SIDEWALK)).status, 'matched');
      // a source without `highway` can't agree with anything on it
      assert.strictEqual(conflation.getResult(ds, feature('c', [[0, 51.5], [100, 51.5]], {})).status, 'unmatched');
    });

    it('sameKeys can require several keys to agree, so a crossing never matches a sidewalk', () => {
      enable([lineRule({ target: { geometry: 'line' }, sameKeys: ['highway', 'footway'] })]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], CROSSING)).status, 'unmatched');
      assert.strictEqual(conflation.getResult(ds, feature('b', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'matched');
    });

    it('a source that fails the source conditions is still tested, and comes out new', () => {
      enable([lineRule({ source: { geometry: 'line', props: [{ key: 'highway', value: 'footway' }] } })]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], LIVING_STREET));
      assert.isOk(result);
      assert.strictEqual(result.status, 'unmatched');
    });

    it('any one rule saying "same" is enough (OR across rules)', () => {
      enable([
        lineRule({ target: { geometry: 'line' }, sameKeys: ['highway'] }),
        lineRule({   // the source's `living_street` counts as the target's `path` or `footway`
          source: { geometry: 'line', props: [{ key: 'highway', value: 'living_street' }] },
          target: { geometry: 'line', props: [{ key: 'highway', op: 'in', value: ['path', 'footway'] }] }
        })
      ]);
      osmWay(1, [[0, 0], [100, 0]], PATH);

      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], LIVING_STREET)).status, 'matched');
      assert.strictEqual(conflation.getResult(ds, feature('b', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('target conditions can exclude features, like private ways', () => {
      enable([lineRule({ target: { geometry: 'line', props: [{ key: 'access', op: '!=', value: 'private' }] } })]);
      osmWay(1, [[0, 0], [100, 0]], { ...SIDEWALK, access: 'private' });
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('target conditions use the OSM feature\'s tags', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], RESIDENTIAL);   // a road, not a footway
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('source conditions use the tags after the data mapping', () => {
      ds.dictionary = new Rapid.RapidDataDictionary(context);
      ds.dictionary.transforms = [{ order: 0, function: 'copy', source: 'TYPE', target: 'highway' }];
      enable([lineRule({ source: { geometry: 'line', props: [{ key: 'highway', value: 'footway' }] } })]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], { TYPE: 'footway' })).status, 'matched');
    });
  });


  describe('lines', () => {
    it('a sidewalk offset 1.5 m from an OSM sidewalk is the same at sameDist 3', () => {
      enable([lineRule()]);
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

    it('the same sidewalk is near at sameDist 1 / nearDist 2, and new with no near band', () => {
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      enable([lineRule({ sameDist: 1, nearDist: 2 })]);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'uncertain');

      enable([lineRule({ sameDist: 1, nearDist: undefined })]);   // nearDist defaults to sameDist
      conflation.invalidate();
      assert.strictEqual(conflation.getResult(ds, feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK)).status, 'unmatched');
    });

    it('lines never match OSM areas unless the target asks for them, like building edges along a sidewalk', () => {
      // A building whose south edge runs along y = 0, 1.5 m from the new sidewalk.
      // (`area=yes` because there is no schema here to say that `building` suggests an area.)
      osmWay(1, [[0, 0], [100, 0], [100, 20], [0, 20], [0, 0]], { building: 'yes', area: 'yes' });
      const a = feature('a', [[0, -1.5], [100, -1.5]], SIDEWALK);

      enable([lineRule({ target: { geometry: 'line' } })]);
      assert.strictEqual(conflation.getResult(ds, a).status, 'unmatched');

      enable([lineRule({ target: { geometry: 'area' } })]);   // explicitly asked for
      conflation.invalidate();
      assert.strictEqual(conflation.getResult(ds, a).status, 'matched');
    });

    it('treats untagged multipolygon outers as their relation, an area', () => {
      // A building drawn as one multipolygon with two untagged closed outers, side by side.
      osmWay(1, [[0, 0], [50, 0], [50, 20], [0, 20], [0, 0]]);
      osmWay(2, [[50, 0], [100, 0], [100, 20], [50, 20], [50, 0]]);
      const mp = new Rapid.OsmRelation(context, {
        id: 'r1',
        tags: { type: 'multipolygon', building: 'retail' },
        members: [{ id: 'w1', type: 'way', role: 'outer' }, { id: 'w2', type: 'way', role: 'outer' }]
      });
      editor.merge([mp]);
      const a = feature('a', [[0, -1.5], [100, -1.5]], SIDEWALK);

      enable([lineRule({ target: { geometry: 'line' } })]);   // a line target, no tag conditions
      assert.strictEqual(conflation.getResult(ds, a).status, 'unmatched');

      enable([lineRule({ target: { geometry: 'area' } })]);   // explicitly asked for areas
      conflation.invalidate();
      const result = conflation.getResult(ds, a);
      assert.strictEqual(result.status, 'matched');
      assert.lengthOf(result.candidates, 1);   // both outers count as one feature, the relation
      assert.strictEqual(result.candidates[0].entityID, 'r1');
      assert.strictEqual(result.candidates[0].measures.overlap, 1);
      assert.sameMembers([...new Set(result.boxes.flatMap(b => b.wayIDs))], ['w1', 'w2']);
    });

    it('does not join a new run to the edge of an area', () => {
      osmWay(1, [[0, 0], [50, 0], [50, 20], [0, 20], [0, 0]], { building: 'yes', area: 'yes' });
      const a = feature('a', [[0, -1.5], [150, -1.5]], SIDEWALK);

      enable([lineRule({ target: { geometry: 'area' } })]);
      const result = conflation.getResult(ds, a);
      assert.isTrue(result.partial);
      const run = result.runs.find(r => r.status === 'unmatched');
      assert.isUndefined(run.startJoin);   // matched an area, so nothing to connect to
    });

    it('nearAngle defaults to sameAngle, so a line within nearDist but at 40° is new', () => {
      enable([lineRule({ nearAngle: undefined })]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      // Within 6 m (nearDist) the whole way, but at 40° (over the 30° limit).
      const dy = 6 * Math.tan(40 * Math.PI / 180);
      const a = feature('a', [[40, 0.5], [46, 0.5 + dy]], SIDEWALK);
      let result = conflation.getResult(ds, a);
      assert.strictEqual(result.status, 'unmatched');
      assert.isFalse(result.boxes.some(b => b.status === 'uncertain'));

      // A looser nearAngle makes it near.
      enable([lineRule({ nearAngle: 60 })]);
      conflation.invalidate();
      result = conflation.getResult(ds, a);
      assert.isTrue(result.boxes.some(b => b.status === 'uncertain'));
    });

    it('matches regardless of line direction', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, feature('a', [[100, 1.5], [0, 1.5]], SIDEWALK)).status, 'matched');
    });

    it('a crossing perpendicular to an OSM sidewalk is not matched to it', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('x', [[50, -10], [50, 10]], CROSSING));
      assert.strictEqual(result.status, 'unmatched');
      assert.isEmpty(result.candidates);
    });

    it('a partly mapped sidewalk splits into runs, and the new run joins the existing way', () => {
      enable([lineRule()]);
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
      enable([lineRule()]);
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
      enable([lineRule()]);
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
      // Beside the turn at x = 60. (Headings are measured over a window about one sample spacing long,
      // so near a sharp turn the boundary lands a little before the vertex.)
      assert.isBelow(meters(run.startJoin.loc, loc(60, 0)), 0.5);
    });

    it('a run is trimmed to its join, so it never reaches past where it connects', () => {
      // An OSM sidewalk heading north-northeast from J = (60,0), with a node M 1.1 m along it.
      // u is its direction, and n the normal on the west side.
      const u = [1 / Math.sqrt(5), 2 / Math.sqrt(5)];
      const n = [-2 / Math.sqrt(5), 1 / Math.sqrt(5)];
      const along = (s, offset = 0) => [60 + s * u[0] + offset * n[0], s * u[1] + offset * n[1]];
      const way = osmWay(1, [along(0), along(1.1), along(33.5)], SIDEWALK);   // nodes J, M, K

      // A new sidewalk runs east, then turns to run beside the OSM one, 1 m to the west.
      // The turn is at s = -1, just before the OSM sidewalk starts at J.
      enable([lineRule()]);
      const a = feature('a', [[0, along(-1, 1)[1]], along(-1, 1), along(20, 1)], SIDEWALK);
      const result = conflation.getResult(ds, a);
      assert.deepEqual(result.runs.map(r => r.status), ['unmatched', 'matched']);

      const run = result.runs[0];
      assert.strictEqual(run.endJoin.nodeID, way.nodes[0]);   // snapped to J, where the OSM sidewalk starts
      // The run ends at the turn, where the mapped stretch begins, and doesn't reach along beside it.
      assert.isBelow(meters(run.coords.at(-1), loc(...along(-1, 1))), 0.2);
      assert.isAbove(meters(run.coords.at(-1), loc(...along(0, 1))), 0.5);
    });

    it('a stub shorter than sameDist is judged by distance only, since its heading means nothing', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      // A 1 cm stub, perpendicular to the OSM sidewalk, at a junction 0.3 m from it.
      const stub = conflation.getResult(ds, feature('s', [[50, 0.3], [50, 0.31]], SIDEWALK));
      assert.strictEqual(stub.status, 'matched');
      assert.isUndefined(stub.runs[0].startJoin);

      // Stubs aren't thrown away: one with nothing nearby is still new.
      const far = conflation.getResult(ds, feature('f', [[50, 20], [50, 20.01]], SIDEWALK));
      assert.strictEqual(far.status, 'unmatched');
    });

    it('short misalignment at the end of a match is not reported as new', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);

      // The new sidewalk overshoots the OSM one by 2 m, less than sameDist.
      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [102, 1.5]], SIDEWALK));
      assert.strictEqual(result.status, 'matched');
      assert.isFalse(result.partial);
    });

    it('scores a partial line by the share of its samples that are already mapped', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);

      const result = conflation.getResult(ds, feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK));
      assert.isAbove(result.score, 0.3);
      assert.isBelow(result.score, 0.5);
      assert.isAbove(result.candidates[0].measures.overlap, 0.35);
      assert.isBelow(result.candidates[0].measures.overlap, 0.5);
    });
  });


  describe('accepting', () => {
    // The accept action looks the dataset up in the Rapid catalog, and needs a data mapping.
    function setupAccept() {
      ds.dictionary = new Rapid.RapidDataDictionary(context);
      ds.dictionary.transforms = [{ order: 0, function: 'copy', source: '*', target: '*' }];
      context.systems.rapid.catalog = new Map([[ds.id, ds]]);
    }

    // Accepts a datum the way the Rapid inspector does, and returns the new way.
    function accept(datum) {
      const action = Rapid.actionRapidAcceptFeature(datum, conflation.getJoins(ds, datum));
      editor.perform(action);
      editor.commit({ annotation: 'accepted' });
      return editor.stable.graph.entity(action.getNewID());
    }

    it('a new run of a partly mapped line has its own data, carrying its joins', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);

      const result = conflation.getResult(ds, a);
      const [matchedRun, newRun] = result.runs;
      assert.isUndefined(matchedRun.datum);
      assert.instanceOf(newRun.datum, Rapid.GeoJSONData);
      assert.strictEqual(newRun.datum.id, Rapid.pieceID('a', newRun.range));
      assert.strictEqual(newRun.datum.props.sourceID, 'a');
      assert.strictEqual(newRun.datum.props.datasetID, 'test');
      assert.deepEqual(newRun.datum.properties, SIDEWALK);
      assert.deepEqual(conflation.getJoins(ds, newRun.datum), { start: newRun.startJoin, end: newRun.endJoin });
    });

    it('accepting the missing part of a sidewalk joins it to the part that exists', () => {
      setupAccept();
      enable([lineRule()]);
      const existing = osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);
      const newRun = conflation.getResult(ds, a).runs[1];

      const way = accept(newRun.datum);
      assert.strictEqual(way.first(), existing.nodes.at(-1));   // reuses the existing sidewalk's end node
      assert.deepEqual(way.tags, SIDEWALK);
      const lastNode = editor.stable.graph.entity(way.last());
      assert.isBelow(meters(lastNode.loc, loc(150, 1.5)), 0.01);

      // Now the whole line is already mapped.
      const after = conflation.getResult(ds, a);
      assert.strictEqual(after.status, 'matched');
      assert.isFalse(after.partial);
    });

    it('where there is no node to reuse, the join adds one to the existing way', () => {
      setupAccept();
      enable([lineRule()]);
      osmWay(1, [[0, 0], [200, 0]], SIDEWALK);   // nodes only at x = 0 and x = 200

      const points = [[0, 1.5], [60, 1.5], [62, 20], [78, 20], [80, 1.5], [150, 1.5]];
      const a = feature('a', points, SIDEWALK);
      const detour = conflation.getResult(ds, a).runs[1];
      assert.isOk(detour.startJoin.edge);

      const way = accept(detour.datum);
      const existing = editor.stable.graph.entity('w1');
      assert.lengthOf(existing.nodes, 4);   // two new nodes on the existing sidewalk
      assert.include(existing.nodes, way.first());
      assert.include(existing.nodes, way.last());
      assert.isBelow(meters(editor.stable.graph.entity(way.first()).loc, loc(60, 0)), 0.5);   // beside the turn
    });

    it('a crossing joins the sidewalks at both of its ends', () => {
      setupAccept();
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      osmWay(2, [[0, 20], [100, 20]], SIDEWALK);
      const x = feature('x', [[50, 0.5], [50, 19.5]], CROSSING);

      const result = conflation.getResult(ds, x);
      assert.strictEqual(result.status, 'unmatched');
      assert.lengthOf(result.runs, 1);
      assert.strictEqual(result.runs[0].startJoin.wayID, 'w1');
      assert.strictEqual(result.runs[0].endJoin.wayID, 'w2');

      const way = accept(x);   // the whole line, joins from `getJoins`
      const graph = editor.stable.graph;
      assert.include(graph.entity('w1').nodes, way.first());
      assert.include(graph.entity('w2').nodes, way.last());
      assert.isBelow(meters(graph.entity(way.first()).loc, loc(50, 0)), 0.01);
      assert.isBelow(meters(graph.entity(way.last()).loc, loc(50, 20)), 0.01);
    });

    it('line ends only join target lines that some rule allows', () => {
      enable([lineRule()]);   // targets must be footways
      osmWay(1, [[0, 0], [100, 0]], RESIDENTIAL);
      const x = feature('x', [[50, 0.5], [50, 19.5]], CROSSING);
      assert.isUndefined(conflation.getResult(ds, x).runs[0].startJoin);
    });

    it('a join that no longer fits the graph is skipped, and the line is still accepted', () => {
      setupAccept();
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);
      const newRun = conflation.getResult(ds, a).runs[1];

      editor.perform(Rapid.actionDeleteWay('w1'));   // the existing sidewalk goes away first
      editor.commit({ annotation: 'deleted w1' });

      const way = accept(newRun.datum);
      assert.isOk(way);
      assert.lengthOf(way.nodes, 2);
      assert.notInclude(way.nodes, 'n1-1');
    });
  });


  describe('unknown', () => {
    it('reports unknown, and does not cache it, where OSM data is not loaded', () => {
      enable([lineRule()]);
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
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, a), conflation.getResult(ds, a));
    });

    it('recomputes after an edit: accepting the missing part makes it already mapped, and undo brings it back', () => {
      enable([lineRule()]);
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

    it('picks up a rule edited in place after invalidate()', () => {
      enable([lineRule({ target: { geometry: 'line' } })]);   // no tag conditions yet
      osmWay(1, [[0, 0], [100, 0]], RESIDENTIAL);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);
      assert.strictEqual(conflation.getResult(ds, a).status, 'matched');   // matches the road

      // Edit the same rule object, the way a user might in the console or settings UI.
      ds.conflation.rules[0].target.props = [{ key: 'highway', value: 'footway' }];
      conflation.invalidate();
      assert.strictEqual(conflation.getResult(ds, a).status, 'unmatched');
    });

    it('invalidate(datasetID) flushes only that dataset', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [100, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [100, 1.5]], SIDEWALK);
      const first = conflation.getResult(ds, a);

      conflation.invalidate('other');
      assert.strictEqual(conflation.getResult(ds, a), first);

      conflation.invalidate('test');
      assert.notStrictEqual(conflation.getResult(ds, a), first);
    });
  });


  describe('piece IDs', () => {
    it('pieceID adds the range along the line, rounded to 4 decimals, and parsePieceID splits it again', () => {
      const id = Rapid.pieceID('test:k1:0', [0.123456, 1]);
      assert.strictEqual(id, 'test:k1:0@0.1235-1');
      assert.deepEqual(Rapid.parsePieceID(id), { dataID: 'test:k1:0', range: [0.1235, 1] });
    });

    it('parsePieceID rejects ids that are not pieces, or have a range that makes no sense', () => {
      assert.isUndefined(Rapid.parsePieceID('test:k1:0'));
      assert.isUndefined(Rapid.parsePieceID('test:k1:0@0.5-0.2'));
      assert.isUndefined(Rapid.parsePieceID('test:k1:0@0-1.5'));
      assert.isUndefined(Rapid.parsePieceID('test:k1:0@0.5-0.5'));
    });

    it('a new line is one run over all of it, with no data of its own (the line itself is accepted)', () => {
      enable([lineRule()]);
      const result = conflation.getResult(ds, feature('a', [[0, 0], [100, 0]], SIDEWALK));
      assert.lengthOf(result.runs, 1);
      assert.deepEqual(result.runs[0].range, [0, 1]);
      assert.isUndefined(result.runs[0].datum);
    });

    it('a run\'s id is the same each time it is computed from the same data', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);

      const first = conflation.getResult(ds, a).runs[1];
      assert.closeTo(first.range[0], 60 / 150, 0.02);
      assert.strictEqual(first.range[1], 1);

      conflation.invalidate();
      const second = conflation.getResult(ds, a).runs[1];
      assert.notStrictEqual(second, first);
      assert.strictEqual(second.datum.id, first.datum.id);
    });
  });


  describe('acted ranges', () => {
    it('a run the user accepted drops out, even though the line now matches there', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);
      const newRun = conflation.getResult(ds, a).runs[1];

      // Accepted: the new run is in OSM now, and the user acted on its range.
      osmWay(2, [[60, 0], [150, 0]], SIDEWALK);
      acted.set('a', [newRun.range]);
      conflation.invalidate();

      const after = conflation.getResult(ds, a);
      assert.deepEqual(after.runs.map(r => r.status), ['matched']);
      assert.isBelow(after.runs[0].range[1], newRun.range[0] + 1e-9);
    });

    it('the rest of a partly ignored line is its own run, which joins nothing where it was cut', () => {
      enable([lineRule()]);
      const a = feature('a', [[0, 0], [100, 0]], SIDEWALK);
      acted.set('a', [[0.5, 1]]);

      const runs = conflation.getResult(ds, a).runs;
      assert.lengthOf(runs, 1);
      assert.deepEqual(runs[0].range, [0, 0.5]);
      assert.strictEqual(runs[0].datum.id, 'a@0-0.5');
      assert.isUndefined(runs[0].endJoin);
      assert.isBelow(meters(runs[0].coords.at(-1), loc(50, 0)), 0.01);
    });

    it('a line acted on in full has no runs, matched or not', () => {
      enable([lineRule()]);
      osmWay(1, [[0, 0], [60, 0]], SIDEWALK);
      const a = feature('a', [[0, 1.5], [150, 1.5]], SIDEWALK);
      acted.set('a', [[0, 1]]);
      assert.lengthOf(conflation.getResult(ds, a).runs, 0);
    });

    it('drops a sliver left over that is shorter than the sample spacing', () => {
      enable([lineRule()]);   // sameDist 3, so samples are 3 m apart
      const a = feature('a', [[0, 0], [100, 0]], SIDEWALK);
      acted.set('a', [[0, 0.99]]);   // leaves 1 m
      assert.lengthOf(conflation.getResult(ds, a).runs, 0);
    });
  });


  describe('getQueue', () => {
    it('lists features in view that need review', () => {
      enable([lineRule({ sameDist: 1, nearDist: 2 })]);   // 1.5 m offsets are near
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
