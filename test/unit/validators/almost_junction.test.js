import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validateAlmostJunction', () => {
  let graph;

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.EditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    schema:   new Rapid.SchemaSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };

  let validator;

  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => schema.merge(osmRulesets))
      .then(() => context.startAsync());

    validator = Rapid.validateAlmostJunction(context);
  });

  beforeEach(async () => {
    await context.systems.editor.resetAsync();
    graph = context.systems.editor.staging.graph;   // empty until entities are loaded
  });


  // Load entities into the editor's spatial caches and refresh the validation graph.
  // The editor keeps the OSM spatial caches (including way segments) in sync,
  //  which is what the validator queries via `editor.waySegments`.
  function load(entities) {
    const editor = context.systems.editor;
    editor.merge(entities);
    graph = editor.staging.graph;
  }


  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues.push(...validator(entity, graph).issues);
    }
    return issues;
  }


  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('flags horizontal and vertical road closer than threshold', () => {
    const entities = [
      // horizontal road
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),

      // vertical road to the west of w1 by 0.00001 longitude degree
      // 5th digit after decimal point has a resolution of ~1 meter
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.42356, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.42356, -0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w1', 'n1', 'w2'],
      loc:       [22.42357, 0],
      data: {
        midId:     'n2',
        edge:      ['n3', 'n4'],
        cross_loc: [22.42356, 0]
      }
    };

    assert.deepInclude(issues[0], expected);
  });


  it.skip('flags horizontal and tilted road closer than threshold', () => {
    const entities = [
      // horizontal road
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),

      // tilted road to the west of w1 by 0.00001 longitude degree
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.423555, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.423565, -0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w1', 'n1', 'w2'],
      loc:       [22.42357, 0],
      data: {
        midId:     'n2',
        edge:      ['n3', 'n4'],
        cross_loc: [22.42356, 0]    // skip this test because floating point precision is off
      }
    };

    assert.deepInclude(issues[0], expected);
  });


  it('ignores horizontal and vertical road further than threshold', () => {
    const entities = [
      // horizontal road
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),

      // vertical road to the west of w1 by 0.00007 longitude degree
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.42350, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.42350, -0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ];

    load(entities);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('ignores horizontal and vertical road closer than threshold, but with noexit tag', () => {
    const entities = [
      // horizontal road
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0], tags: { noexit: 'yes' }}),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),

      // vertical road to the west of w1 by 0.00001 longitude degree
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.42356, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.42356, -0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ];

    load(entities);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('ignores two horizontal roads closer than threshold', () => {
    const entities = [
      // horizontal road
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),

      // another horizontal road to the north of w1 by 0.0001 latitude degree
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.42357, 0.00001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.42367, 0.00001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ];

    load(entities);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('joins close endpoints if insignificant angle change', () => {
    const entities = [
      // Vertical path
      new Rapid.OsmNode(context, { id: 'n1', loc: [0.0003247, 22.4423866] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.0003060, 22.4432671] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'path' }}),

      // Angled path with end node within 4.25m and change of angle <9°
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0003379, 22.4423861] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0004354, 22.4421312] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'path' }})
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w2', 'n3', 'w1']
    };
    assert.deepInclude(issues[0], expected);
  });


  it('won\'t join close endpoints if significant angle change', () => {
    const entities = [
      // Vertical path
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 22.4427453] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 22.4429806] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'path' }}),

      // Horizontal path with end node within 4.25m and change of angle >9°
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0000199, 22.4427801] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0002038, 22.4427801] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'path' }})
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w2', 'n3', 'w1']
    };
    assert.deepInclude(issues[0], expected);
  });


  it('joins close endpoints of the same way', () => {
    const entities = [
      // Square path that ends within 4.25m of itself and change of angle <9°
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 22.4427453] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 22.4429811] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0001923, 22.4429811] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0001923, 22.4427523] }),
      new Rapid.OsmNode(context, { id: 'n5', loc: [0.0000134, 22.4427523] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4', 'n5'], tags: { highway: 'path' }})
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w1', 'n5', 'w1']
    };
    assert.deepInclude(issues[0], expected);
  });


  it('joins to close endpoint with smaller angle change', () => {
    const entities = [
      // Square path with both endpoints near each other
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 22.4427453] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 22.4429810] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0000063, 22.4429810] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0000063, 22.4427483] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4'], tags: { highway: 'path' }}),

      // Horizontal path with end node within 4.25m and change of angle >9° (to both endpoints)
      new Rapid.OsmNode(context, { id: 'n5', loc: [0.0000124, 22.4427458] }),
      new Rapid.OsmNode(context, { id: 'n6', loc: [0.0000445, 22.4427449] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n5', 'n6'], tags: { highway: 'path' }}),
    ];

    load(entities);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w2', 'n5', 'w1']
    };
    assert.deepInclude(issues[0], expected);
  });


  it('skips way segments that are in the spatial index but not in the graph being validated', () => {
    const editor = context.systems.editor;
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),
      new Rapid.OsmNode(context, { id: 'n3', loc: [22.42356, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [22.42356, -0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
    ]);

    // The index also returns a road (and nodes) that only another graph has
    const waySegments = editor.waySegments;
    editor.waySegments = (extent, g) => [
      { wayID: 'w-10', edge: ['n-10', 'n-11'], index: 0 },
      { wayID: 'w2', edge: ['n-12', 'n-13'], index: 0 },
      ...waySegments.call(editor, extent, g)
    ];

    try {
      const issues = validator(graph.entity('w1'), graph).issues;
      assert.lengthOf(issues, 1);
      assert.strictEqual(issues[0].type, 'almost_junction');
      assert.deepEqual(issues[0].entityIds, ['w1', 'n1', 'w2']);
    } finally {
      editor.waySegments = waySegments;
    }
  });


  describe('fixes', () => {
    // `w1` ends about 1 m east of the vertical road `w2`
    function loadNearlyJoined() {
      load([
        new Rapid.OsmNode(context, { id: 'n1', loc: [22.42357, 0] }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [22.42367, 0] }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }}),
        new Rapid.OsmNode(context, { id: 'n3', loc: [22.42356, 0.001] }),
        new Rapid.OsmNode(context, { id: 'n4', loc: [22.42356, -0.001] }),
        new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' }})
      ]);
      const issues = validate();
      assert.lengthOf(issues, 1);
      return issues[0];
    }

    it('connects the road as it is when the fix is clicked', () => {
      const editor = context.systems.editor;
      const issue = loadNearlyJoined();
      const connect = issue.fixes().find(fix => fix.icon === 'rapid-icon-abutment');

      // The user edits twice after the fixes were shown, the second time tagging the end node.
      // (The first edit still goes into the graph the fixes were shown for, the second doesn't.)
      editor.perform(Rapid.actionChangeTags('n2', { note: 'other end' }));
      editor.commit({ stringID: 'tagged n2', selection: ['n2'] });
      editor.perform(Rapid.actionChangeTags('n1', { note: 'end of the road' }));
      editor.commit({ stringID: 'tagged n1', selection: ['n1'] });

      connect.onClick();
      const graph = editor.staging.graph;
      assert.deepEqual(graph.entity('n1').tags, { note: 'end of the road' });
      assert.deepEqual(graph.entity('w2').nodes, ['n3', 'n1', 'n4']);
    });

    it('changes nothing once the end node has moved', () => {
      const editor = context.systems.editor;
      const issue = loadNearlyJoined();
      const connect = issue.fixes().find(fix => fix.icon === 'rapid-icon-abutment');

      // The user drags the end of the road away
      editor.perform(Rapid.actionMoveNode('n1', [22.4236, 0.0005]));
      editor.commit({ stringID: 'moved n1', selection: ['n1'] });
      const moved = editor.staging.graph;

      connect.onClick();
      assert.strictEqual(editor.staging.graph, moved);

      // Same for the autofix (e.g. Autofix All applying it after an earlier fix)
      const [action] = issue.autoArgs;
      const graph = action(new Rapid.Graph(moved));
      assert.deepEqual(graph.entity('n1').loc, [22.4236, 0.0005]);
      assert.deepEqual(graph.entity('w2').nodes, ['n3', 'n4']);
    });

    it('joins close endpoints', () => {
      load([
        // Vertical path
        new Rapid.OsmNode(context, { id: 'n1', loc: [0.0003247, 22.4423866] }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.0003060, 22.4432671] }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'path' }}),
        // Angled path with end node within 4.25m and change of angle <9°
        new Rapid.OsmNode(context, { id: 'n3', loc: [0.0003379, 22.4423861] }),
        new Rapid.OsmNode(context, { id: 'n4', loc: [0.0004354, 22.4421312] }),
        new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'path' }})
      ]);
      const issues = validate();
      assert.lengthOf(issues, 1);

      const [action] = issues[0].autoArgs;
      const result = action(new Rapid.Graph(graph));
      const w1 = result.entity('w1');
      const w2 = result.entity('w2');
      assert.strictEqual(w1.first(), w2.first());   // merged, not a new vertex on `w1`
      assert.lengthOf(w1.nodes, 2);
    });
  });
});
