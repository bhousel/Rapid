import { before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// TODO FIX Tree.waySegments
describe.skip('validationCrossingWays', () => {
  let graph, tree;

  class MockEditSystem {
    constructor() {}
    initAsync()   { return Promise.resolve(); }
    get staging() { return { graph: graph }; }
    get tree()    { return tree; }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new MockEditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    spatial:  new Rapid.SpatialSystem(context)
  };

  const validator = Rapid.validationCrossingWays(context);


  before(() => {
    return context.systems.spatial.initAsync();
  });

  beforeEach(() => {
    graph = new Rapid.Graph(context);       // reset
    tree = new Rapid.Tree(graph, 'test');   // reset
    return context.systems.spatial.resetAsync();
  });


  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues = issues.concat(validator(entity, graph));
    }
    return issues;
  }


  //
  //      n2          w1:  [n1, n2]
  //      |           w2:  [n3, n4]
  //  n3--|--n4
  //      |
  //      n1
  //
  function createWaysWithOneCrossingPoint(w1tags = {}, w2tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -1] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: w1tags });

    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1, 0] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1, 0] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: w2tags });

    const entities = [n1, n2, n3, n4, w1, w2];
    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);
  }


  function verifySingleCrossingIssue(issues, connectionTags) {
    // each entity must produce an identical issue
    assert.isArray(issues);
    assert.lengthOf(issues, 2);
    assert.strictEqual(issues[0].id, issues[1].id);

    for (const issue of issues) {
      assert.strictEqual(issue.type, 'crossing_ways');
      assert.strictEqual(issue.severity, 'warning');
      assert.isArray(issue.entityIds);
      assert.lengthOf(issue.entityIds, 2);
      assert.deepEqual(issue.loc, [0, 0]);
      assert.deepEqual(issue.data.connectionTags, connectionTags);
    }
  }

  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores untagged line crossing untagged line', () => {
    createWaysWithOneCrossingPoint({}, {});
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing abandoned railway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { railway: 'abandoned' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing non-rail railway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { railway: 'yard' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing non-water waterway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { waterway: 'fuel' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing non-building building', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { building: 'no' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing non-routable highway', () => {
    createWaysWithOneCrossingPoint({ highway: 'services' }, { highway: 'residential' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  // legit crossing cases
  it('ignores roads crossing roads on different layers', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', layer: '0' }, { highway: 'residential', layer: '1'});
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road tunnel crossing road', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', tunnel: 'yes', layer: '-1' }, { highway: 'residential' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing railway bridge', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { railway: 'rail', bridge: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road bridge crossing waterway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', bridge: 'yes' }, { waterway: 'river' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road crossing building on different layers', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', layer: '-1' }, { building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores railway crossing railway bridge', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail', bridge: 'yes' }, { railway: 'rail' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores railway bridge crossing railway bridge on different layers', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail', bridge: 'yes', layer: '2' }, { railway: 'rail', bridge: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores railway crossing waterway tunnel', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail' }, { waterway: 'river', tunnel: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores railway crossing building on different layers', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail', layer: '-1' }, { building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores waterway crossing waterway tunnel', () => {
    createWaysWithOneCrossingPoint({ waterway: 'canal', tunnel: 'yes' }, { waterway: 'river' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores waterway crossing building on different layers', () => {
    createWaysWithOneCrossingPoint({ waterway: 'river', layer: '-1' }, { building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores building crossing building on different layers', () => {
    createWaysWithOneCrossingPoint({ building: 'yes' }, { building: 'yes', layer: '1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores corridor crossing corridor on different levels', () => {
    createWaysWithOneCrossingPoint({ highway: 'corridor', level: '0' }, { highway: 'corridor', level: '1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores a routable aeroway crossing a non-routable aeroway', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'taxiway' }, { aeroway: 'aerodrome' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a road tunnel', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { highway: 'trunk', tunnel: 'yes', layer: '-1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a road bridge', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { highway: 'trunk', bridge: 'yes', layer: '1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a rail tunnel', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { railway: 'track', tunnel: 'yes', layer: '-1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a rail bridge', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { railway: 'track', bridge: 'yes', layer: '1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway bridge crossing a road', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway', bridge: 'yes', layer: '2' }, { highway: 'trunk', layer: '1' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway bridge crossing a railway', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway', bridge: 'yes', layer: '1' }, { railway: 'track' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a culvert', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'taxiway' }, { waterway: 'ditch', tunnel: 'culvert', layer: -1 });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores an aeroway crossing a building on a different layer', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { building: 'yes', layer: '0.5' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  // warning crossing cases between ways
  it('flags road crossing road', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { highway: 'residential' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags road crossing footway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { highway: 'footway' });
    verifySingleCrossingIssue(validate(), { highway: 'crossing'});
  });

  it('flags road crossing cycleway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { highway: 'cycleway' });
    verifySingleCrossingIssue(validate(), { highway: 'crossing'});
  });

  it('flags road crossing marked crossing', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { highway: 'footway', footway: 'crossing', crossing: 'marked' });
    verifySingleCrossingIssue(validate(), { highway: 'crossing' });
  });

  it('flags road crossing unmarked crossing', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { highway: 'footway', footway: 'crossing', crossing: 'unmarked' });
    verifySingleCrossingIssue(validate(), { highway: 'crossing' });
  });

  it('flags road=track crossing footway', () => {
    createWaysWithOneCrossingPoint({ highway: 'track' }, { highway: 'footway' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags cycleway crossing cycleway', () => {
    createWaysWithOneCrossingPoint({ highway: 'cycleway' }, { highway: 'cycleway' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags cycleway crossing footway', () => {
    createWaysWithOneCrossingPoint({ highway: 'cycleway' }, { highway: 'footway' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags footway crossing footway', () => {
    createWaysWithOneCrossingPoint({ highway: 'footway' }, { highway: 'footway' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags road crossing railway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { railway: 'rail' });
    verifySingleCrossingIssue(validate(), { railway: 'level_crossing' });
  });

  it('flags footway crossing railway', () => {
    createWaysWithOneCrossingPoint({ highway: 'footway' }, { railway: 'rail' });
    verifySingleCrossingIssue(validate(), { railway: 'crossing' });
  });

  it('flags cycleway crossing railway', () => {
    createWaysWithOneCrossingPoint({ highway: 'cycleway' }, { railway: 'rail' });
    verifySingleCrossingIssue(validate(), { railway: 'crossing' });
  });

  it('flags minor road crossing waterway', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { waterway: 'river' });
    verifySingleCrossingIssue(validate(), { ford: 'yes' });
  });

  it('flags major road crossing waterway', () => {
    createWaysWithOneCrossingPoint({ highway: 'motorway' }, { waterway: 'river' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags road crossing building', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential' }, { building: 'yes' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags railway crossing railway', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail' }, { railway: 'rail' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags railway crossing waterway', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail' }, { waterway: 'river' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags road bridge crossing road bridge on the same layer', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', bridge: 'yes' }, { highway: 'tertiary', bridge: 'yes' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags road bridge crossing aqueduct on the same layer', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', bridge: 'yes' }, { waterway: 'canal', bridge: 'aqueduct' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags road tunnel crossing waterway tunnel on the same layer', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', tunnel: 'yes' }, { waterway: 'canal', tunnel: 'yes' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags railway bridge crossing road bridge on the same layer', () => {
    createWaysWithOneCrossingPoint({ highway: 'residential', bridge: 'yes' }, { railway: 'rail', bridge: 'yes' });
    verifySingleCrossingIssue(validate(), { railway: 'level_crossing' });
  });

  it('flags railway crossing building', () => {
    createWaysWithOneCrossingPoint({ railway: 'rail' }, { building: 'yes' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags waterway crossing waterway', () => {
    createWaysWithOneCrossingPoint({ waterway: 'canal' }, { waterway: 'canal' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags waterway tunnel crossing waterway tunnel on the same layer', () => {
    createWaysWithOneCrossingPoint({ waterway: 'canal', tunnel: 'yes' }, { waterway: 'canal', tunnel: 'yes' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags waterway crossing building', () => {
    createWaysWithOneCrossingPoint({ waterway: 'river' }, { building: 'yes' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags building crossing building', () => {
    createWaysWithOneCrossingPoint({ building: 'yes' }, { building: 'yes' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags corridor crossing corridor on the same level', () => {
    createWaysWithOneCrossingPoint({ highway: 'corridor', level: '0' }, { highway: 'corridor', level: '0' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags an aeroway crosing another aeroway', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { aeroway: 'taxiway' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags an aeroway crosing a major road', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { highway: 'motorway' });
    verifySingleCrossingIssue(validate(), { aeroway: 'aircraft_crossing' });
  });

  it('flags an aeroway crosing a service road', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { highway: 'service' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags an aeroway crosing a path', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { highway: 'corridor' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags an aeroway crosing a railway', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'taxiway' }, { railway: 'disused' });
    verifySingleCrossingIssue(validate(), { aeroway: 'aircraft_crossing', railway: 'level_crossing' });
  });

  it('flags an aeroway crosing a waterway', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { waterway: 'canal' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags an aeroway crosing a building', () => {
    createWaysWithOneCrossingPoint({ aeroway: 'runway' }, { building: 'hangar' });
    verifySingleCrossingIssue(validate(), null);
  });


  //
  //      n2
  //      |
  //  n3--|--n4
  //      |  |
  //  n6--|--n5
  //      |
  //      n1
  //
  function createWaysWithTwoCrossingPoints() {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -2] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  2] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }});

    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1,  1] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1,  1] });
    const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [ 1, -1] });
    const n6 = new Rapid.OsmNode(context, { id: 'n6', loc: [-1, -1] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4', 'n5', 'n6'], tags: { highway: 'residential' }});

    const entities = [n1, n2, n3, n4, n5, n6, w1, w2];
    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);
  }

  it('flags road crossing road twice', () => {
    createWaysWithTwoCrossingPoints();
    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 4);

    let issue = issues[0];
    assert.strictEqual(issue.type, 'crossing_ways');
    assert.deepEqual(issue.entityIds, ['w1', 'w2']);
    assert.deepEqual(issue.loc, [0, 1]);

    issue = issues[1];
    assert.strictEqual(issue.type, 'crossing_ways');
    assert.deepEqual(issue.entityIds, ['w1', 'w2']);
    assert.deepEqual(issue.loc, [0, -1]);

    issue = issues[2];
    assert.strictEqual(issue.type, 'crossing_ways');
    assert.deepEqual(issue.entityIds, ['w2', 'w1']);
    assert.deepEqual(issue.loc, [0, 1]);

    issue = issues[3];
    assert.strictEqual(issue.type, 'crossing_ways');
    assert.deepEqual(issue.entityIds, ['w2', 'w1']);
    assert.deepEqual(issue.loc, [0, -1]);
  });


  //
  // n6-----n5
  //  |  n2 |
  //  |  |  |
  // n3--|--n4
  //     |
  //     n1
  //
  function createWayAndRelationWithOneCrossingPoint(w1tags = {}, r1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -1] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: w1tags });

    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1, 0] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1, 0] });
    const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [ 1, 3] });
    const n6 = new Rapid.OsmNode(context, { id: 'n6', loc: [-1, 3] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4', 'n5'], tags: {} });
    const w3 = new Rapid.OsmWay(context, { id: 'w3', nodes: ['n5', 'n6', 'n3'], tags: {} });
    const r1 = new Rapid.OsmRelation(context, {id: 'r-1', members: [{ id: 'w2', type: 'way' }, { id: 'w3', type: 'way' }], tags: r1tags });

    const entities = [n1, n2, n3, n4, n5, n6, w1, w2, w3, r1];
    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);
  }

  it('ignores road line crossing relation with building=yes without a type', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'residential' }, { building: 'yes' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road line crossing type=building relation', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'residential' }, { building: 'yes', type: 'building' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores road line crossing waterway multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'residential' }, { waterway: 'river', type: 'multipolygon' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('flags road line crossing building multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'residential' }, { building: 'yes', type: 'multipolygon' });
    verifySingleCrossingIssue(validate(), null);
  });

  it('flags footway line crossing footway multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'footway' }, { highway: 'footway', type: 'multipolygon' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags road line crossing footway multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ highway: 'residential' }, { highway: 'footway', type: 'multipolygon' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags railway line crossing footway multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ railway: 'tram' }, { highway: 'footway', type: 'multipolygon' });
    verifySingleCrossingIssue(validate(), {});
  });

  it('flags waterway line crossing footway multipolygon relation', () => {
    createWayAndRelationWithOneCrossingPoint({ waterway: 'stream' }, { highway: 'footway', type: 'multipolygon' });
    verifySingleCrossingIssue(validate(), {});
  });

});
