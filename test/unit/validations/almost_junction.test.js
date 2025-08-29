import { before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// TODO FIX Tree.waySegments
describe.skip('validationAlmostJunction', () => {
  let graph, tree;

  class MockEditSystem extends Rapid.MockSystem {
    get staging() { return { graph: graph }; }
    get tree()    { return tree; }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new MockEditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    spatial:  new Rapid.SpatialSystem(context)
  };

  const validator = Rapid.validationAlmostJunction(context);


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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w1', 'n1', 'w2'],
      loc:       [22.42357, 0],
      data: {
        edge:      ['n3', 'n4'],
        cross_loc: [22.42356, 0]
      }
    };

    assert.deepInclude(issues[0], expected);
  });


  it('flags horizontal and tilted road closer than threshold', () => {
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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:     'almost_junction',
      subtype:  'highway-highway',
      entityIds: ['w1', 'n1', 'w2'],
      loc:       [22.42357, 0],
      data: {
        edge:      ['n3', 'n4'],
        cross_loc: [22.42356, 0]
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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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

    graph = new Rapid.Graph(context, entities);
    tree = new Rapid.Tree(graph, 'test');
    tree.rebase(entities, true);

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
});
