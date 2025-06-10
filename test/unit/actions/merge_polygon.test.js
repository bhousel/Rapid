import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionMergePolygon', () => {
  const context = new Rapid.MockContext();
  let graph;

  //                                  n15
  //                                / |
  //                               /  |
  //                           n13 -- n14
  //  n3 ---------------- n2
  //   | n7 ---------- n6 |
  //   |  | n11 -- n10 |  |
  //   |  |   |    |   |  |
  //   |  |  n8 -- n9  |  |
  //   | n4 ---------- n5 |
  //  n0 ---------------- n1
  //

  beforeEach(() => {
    graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n0', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n1', loc: [5, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [5, 5] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0, 5] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [1, 1] }),
      new Rapid.OsmNode(context, { id: 'n5', loc: [4, 1] }),
      new Rapid.OsmNode(context, { id: 'n6', loc: [4, 4] }),
      new Rapid.OsmNode(context, { id: 'n7', loc: [1, 4] }),
      new Rapid.OsmNode(context, { id: 'n8', loc: [2, 2] }),
      new Rapid.OsmNode(context, { id: 'n9', loc: [3, 2] }),
      new Rapid.OsmNode(context, { id: 'n10', loc: [3, 3] }),
      new Rapid.OsmNode(context, { id: 'n11', loc: [2, 3] }),
      new Rapid.OsmNode(context, { id: 'n13', loc: [8, 8] }),
      new Rapid.OsmNode(context, { id: 'n14', loc: [8, 9] }),
      new Rapid.OsmNode(context, { id: 'n15', loc: [9, 9] }),
      new Rapid.OsmWay(context, { id: 'w0', nodes: ['n0', 'n1', 'n2', 'n3', 'n0'] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n4', 'n5', 'n6', 'n7', 'n4'] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n8', 'n9', 'n10', 'n11', 'n8'] }),
      new Rapid.OsmWay(context, { id: 'w3', nodes: ['n4', 'n5', 'n6'] }),
      new Rapid.OsmWay(context, { id: 'w4', nodes: ['n6', 'n7', 'n4'] }),
      new Rapid.OsmWay(context, { id: 'w5', nodes: ['n13', 'n14', 'n15', 'n13'] })
    ]);
  });


  it('creates a multipolygon from two closed ways', () => {
    const result = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph);
    assert.ok(result instanceof Rapid.Graph);

    const r = result.hasEntity('r');
    assert.ok(r instanceof Rapid.OsmRelation);
    assert.equal(r.geometry(result), 'area');
    assert.ok(r.isMultipolygon());
    assert.equal(r.members.length, 2);

    const m0 = r.memberById('w0');
    assert.equal(m0.role, 'outer');
    assert.equal(m0.type, 'way');

    const m1 = r.memberById('w1');
    assert.equal(m1.role, 'inner');
    assert.equal(m1.type, 'way');
  });


  it('creates a multipolygon from a closed way and a multipolygon relation', () => {
    const graph2 = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph);
    assert.ok(graph2 instanceof Rapid.Graph);
    const result = Rapid.actionMergePolygon(['r', 'w2'])(graph2);
    assert.ok(result instanceof Rapid.Graph);

    const r = result.hasEntity('r');
    assert.ok(r instanceof Rapid.OsmRelation);
    assert.equal(r.members.length, 3);
  });


  it('creates a multipolygon from two multipolygon relations', () => {
    const graph2 = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph);
    assert.ok(graph2 instanceof Rapid.Graph);
    const graph3 = Rapid.actionMergePolygon(['w2', 'w5'], 'r2')(graph2);
    assert.ok(graph3 instanceof Rapid.Graph);
    const result = Rapid.actionMergePolygon(['r', 'r2'])(graph3);
    assert.ok(result instanceof Rapid.Graph);

    // Delete the other relation
    assert.ok(!result.hasEntity('r2'));

    const r = result.hasEntity('r');
    assert.ok(r instanceof Rapid.OsmRelation);

    assert.equal(r.memberById('w0').role, 'outer');
    assert.equal(r.memberById('w1').role, 'inner');
    assert.equal(r.memberById('w2').role, 'outer');
    assert.equal(r.memberById('w5').role, 'outer');
  });


  it('merges multipolygon tags', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'multipolygon', a: 'a' } }),
      new Rapid.OsmRelation(context, { id: 'r2', tags: { type: 'multipolygon', b: 'b' } })
    ]);

    const result = Rapid.actionMergePolygon(['r1', 'r2'])(graph);
    const r = result.entity('r1');
    assert.deepEqual(r.tags, { type: 'multipolygon', a: 'a', b: 'b' });
  });


  it('merges tags from closed outer ways', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'], tags: { building: 'yes' } })
    ]);

    const result = Rapid.actionMergePolygon(['w1'], 'r')(graph);
    const r = result.entity('r');
    assert.deepEqual(r.tags, { type: 'multipolygon', building: 'yes' });
  });


  it('merges no tags from unclosed outer ways', () => {
    const r1 = new Rapid.OsmRelation(context, {id: 'r1', tags: {type: 'multipolygon'}});
    const r2 = new Rapid.OsmRelation(context, {id: 'r2', tags: {type: 'multipolygon'},
      members: [
        { type: 'way', role: 'outer', id: 'w3' },
        { type: 'way', role: 'outer', id: 'w4' }
      ]});

    const graph2 = graph
      .replace(graph.entity('w3').update({ tags: { 'natural': 'water' }}))
      .replace(r1)
      .replace(r2);

    const result = Rapid.actionMergePolygon(['r1', 'r2'])(graph2);
    assert.ok(result instanceof Rapid.Graph);
    assert.equal(result.entity('w3').tags.natural, 'water');
    assert.equal(result.entity('r1').tags.natural, undefined);
  });


  it('does not merge tags from unclosed outer ways', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { building: 'yes' } })
    ]);

    const result = Rapid.actionMergePolygon(['w1'], 'r')(graph);
    const w = result.entity('w1');
    assert.deepEqual(w.tags, { building: 'yes' });
  });


  it('merges no tags from inner ways', () => {
    const graph2 = graph.replace(graph.entity('w1').update({ tags: { 'natural': 'water' }}));

    const result = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph2);
    assert.ok(result instanceof Rapid.Graph);
    assert.equal(result.entity('w1').tags.natural, 'water');
    assert.equal(result.entity('r').tags.natural, undefined);
  });


  it('does not merge tags from inner ways', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.5, 0.5] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.5, -0.5] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'], tags: { building: 'yes' } }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4', 'n3'] })
    ]);

    const result = Rapid.actionMergePolygon(['w1', 'w2'], 'r')(graph);
    const w = result.entity('w2');
    assert.deepEqual(w.tags, {});
  });


  it('doesn\'t copy area tags from ways', () => {
    const graph2 = graph.replace(graph.entity('w0').update({ tags: { 'area': 'yes' }}));

    const result = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph2);
    assert.ok(result instanceof Rapid.Graph);
    assert.equal(result.entity('r').tags.area, undefined);
  });


  it('does not copy area tags from ways', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'], tags: { area: 'yes' } })
    ]);

    const result = Rapid.actionMergePolygon(['w1'], 'r')(graph);
    const r = result.entity('r');
    assert.deepEqual(r.tags, { type: 'multipolygon' });
  });


  it('creates a multipolygon with two disjunct outer rings', () => {
    const result = Rapid.actionMergePolygon(['w0', 'w5'], 'r')(graph);
    assert.ok(result instanceof Rapid.Graph);

    const r = result.entity('r');
    assert.equal(r.memberById('w0').role, 'outer');
    assert.equal(r.memberById('w5').role, 'outer');
  });


  it('creates a multipolygon with an island in a hole', () => {
    const graph2 = Rapid.actionMergePolygon(['w0', 'w1'], 'r')(graph);
    assert.ok(graph2 instanceof Rapid.Graph);
    const result = Rapid.actionMergePolygon(['r', 'w2'])(graph2);
    assert.ok(result instanceof Rapid.Graph);

    const r = result.entity('r');
    assert.equal(r.memberById('w0').role, 'outer');
    assert.equal(r.memberById('w1').role, 'inner');
    assert.equal(r.memberById('w2').role, 'outer');
  });


  it('extends a multipolygon with multi-way rings', () => {
    const graph2 = graph.replace(
      new Rapid.OsmRelation(context, { id: 'r', tags: { type: 'multipolygon' }, members: [
        { type: 'way', role: 'outer', id: 'w0' },
        { type: 'way', role: 'inner', id: 'w3' },
        { type: 'way', role: 'inner', id: 'w4' }
      ]})
    );

    const result = Rapid.actionMergePolygon(['r', 'w2'])(graph2);
    assert.ok(result instanceof Rapid.Graph);

    const r = result.entity('r');
    assert.equal(r.memberById('w0').role, 'outer');
    assert.equal(r.memberById('w2').role, 'outer');
    assert.equal(r.memberById('w3').role, 'inner');
    assert.equal(r.memberById('w4').role, 'inner');
  });


  it('disables action when there are other entities', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] }),  // This is an 'other' entity
      new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'multipolygon' } })
    ]);

    const action = Rapid.actionMergePolygon(['w1', 'r1']);
    const disabled = action.disabled(graph);
    assert.equal(disabled, 'not_eligible');
  });


  it('disables action when there are less than two closedWay and multipolygon entities', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'] })  // This is a 'closedWay' entity
    ]);

    const action = Rapid.actionMergePolygon(['w1']);
    const disabled = action.disabled(graph);
    assert.equal(disabled, 'not_eligible');
  });


  it('disables action when creating a new multipolygon would be redundant', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'] }),  // This is a 'closedWay' entity
      new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'multipolygon' }, members: [{ type: 'way', id: 'w1' }] })  // This is a 'multipolygon' entity
    ]);

    const action = Rapid.actionMergePolygon(['w1', 'r1']);
    const disabled = action.disabled(graph);
    assert.equal(disabled, 'not_eligible');
  });


  it('disables action when a way is already a member of a multipolygon', () => {
    const graph = new Rapid.Graph([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n1'] }),  // This is a 'closedWay' entity
      new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'multipolygon' }, members: [{ type: 'way', id: 'w1' }] })  // This is a 'multipolygon' entity
    ]);

    const action = Rapid.actionMergePolygon(['w1', 'r1']);
    const disabled = action.disabled(graph);
    assert.equal(disabled, 'not_eligible');
  });
});
