import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionDisconnect', () => {
  const context = new Rapid.MockContext();

  it('replaces the node with a new node in all but the first way', () => {
    // Situation:
    //    a --- b --- c
    //          |
    //          d
    // Disconnect at b.
    //
    // Expected result:
    //    a --- b --- c
    //
    //          *
    //          |
    //          d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
      new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('|').nodes, ['d', '*']);
  });


  it('disconnects only the ways specified by limitWays', () => {
    // Situation:
    //    a --- b === c
    //          |
    //          d
    // Disconnect - at b.
    //
    // Expected result:
    //    a --- *  b === c
    //             |
    //             d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
      new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*').limitWays(['-'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', '*']);
    assert.deepEqual(result.entity('=').nodes, ['b', 'c']);
    assert.deepEqual(result.entity('|').nodes, ['d', 'b']);
  });


  it('keeps a closed line closed, when being disconnected at the closing node', () => {
    // Situation:
    //    a === b -- c
    //          |    |
    //          e -- d
    //
    // Disconnect - at b
    //
    // Expected result:
    //    a === b * -- c
    //            |    |
    //            e -- d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'c', 'd', 'e', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('=').nodes, ['a', 'b']);
    assert.deepEqual(result.entity('-').nodes, ['*', 'c', 'd', 'e', '*']);   // still closed
  });


  it('disconnects the closing node of a linear way (not area)', () => {
    // Situation:
    //  a --- b
    //   \   /
    //    \ /
    //     c
    // Disconnect at a
    //
    // Expected result:
    //  a --- b
    //        |
    //  * --- c
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmWay(context, {id: 'w', nodes: ['a', 'b', 'c', 'a']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('a', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w').nodes, ['a', 'b', 'c', '*']);
  });


  it('disconnects a shared non-closing node in an area without breaking the area', () => {
    // Situation:
    //  a -- b -- c
    //       |    |
    //       e -- d
    //
    // An area that is connected to itself (not normally allowed)
    // Disconnect at b
    //
    // Expected Result:
    //  a -- b -- c
    //  |         |
    //  * -- e -- d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: 'w', nodes: ['a', 'b', 'c', 'd', 'e', 'b', 'a'], tags: {area: 'yes'}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w').nodes, ['a', 'b', 'c', 'd', 'e', '*', 'a']);  // still closed
  });


  it('disconnects the closing node of an area without breaking the area', () => {
    // Situation:
    // a --- b --- d
    //  \   / \   /
    //   \ /   \ /
    //    c     e
    // 2 areas: a-b-c-a  and  b-d-e-b
    //
    // Disconnect at b
    //
    // Expected Result:
    // a --- b   * --- d
    //  \   /     \   /
    //   \ /       \ /
    //    c         e
    // 2 areas: a-b-c-a  and  *-d-e-*

    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: 'w1', nodes: ['a', 'b', 'c', 'a'], tags: {area: 'yes'}}),
      new Rapid.OsmWay(context, {id: 'w2', nodes: ['b', 'd', 'e', 'b'], tags: {area: 'yes'}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').nodes, ['a', 'b', 'c', 'a']);  // still closed
    assert.deepEqual(result.entity('w2').nodes, ['*', 'd', 'e', '*']);  // still closed
  });


  it('disconnects multiple closing nodes of multiple areas without breaking the areas', () => {
    // Situation:
    // a --- b --- d
    //  \   / \   /
    //   \ /   \ /
    //    c     e
    // 2 areas: b-c-a-b  and  b-d-e-b
    //
    // Disconnect at b
    //
    // Expected Result:
    // a --- b   * --- d
    //  \   /     \   /
    //   \ /       \ /
    //    c         e
    // 2 areas: b-c-a-b  and  *-d-e-*

    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: 'w1', nodes: ['b', 'c', 'a', 'b'], tags: {area: 'yes'}}),
      new Rapid.OsmWay(context, {id: 'w2', nodes: ['b', 'd', 'e', 'b'], tags: {area: 'yes'}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').nodes, ['b', 'c', 'a', 'b']);  // still closed
    assert.deepEqual(result.entity('w2').nodes, ['*', 'd', 'e', '*']);  // still closed
  });


  it('copies location and tags to the new nodes', () => {
    const tags = { highway: 'traffic_signals' };
    const loc = [1, 2];
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b', loc: loc, tags: tags}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
      new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionDisconnect('b', '*')(graph);
    assert.instanceOf(result, Rapid.Graph);

    const resultB = result.hasEntity('b');
    const resultStar = result.hasEntity('*');
    assert.instanceOf(resultB, Rapid.OsmNode);
    assert.instanceOf(resultStar, Rapid.OsmNode);

    assert.deepEqual(resultB.loc, resultStar.loc);
    assert.notStrictEqual(resultB.loc, resultStar.loc);

    assert.deepEqual(resultB.tags, resultStar.tags);
    assert.notStrictEqual(resultB.tags, resultStar.tags);
  });


  describe('disabled', () => {
    it('returns \'not_connected\' for a node shared by less than two ways', () => {
      const base = new Rapid.Graph(context, [new Rapid.OsmNode(context, {id: 'a'})]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('a').disabled(graph);
      assert.strictEqual(disabled, 'not_connected');
    });

    it('returns falsy for the closing node in a closed line', () => {
      //  a --- b
      //  |     |
      //  d --- c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: 'w', nodes: ['a', 'b', 'c', 'd', 'a']})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('a').disabled(graph);
      assert.notOk(disabled);
    });

    it('returns not_connected for the closing node in a closed area', () => {
      //  a --- b
      //  |     |
      //  d --- c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: 'w', nodes: ['a', 'b', 'c', 'd', 'a'], tags: {area: 'yes'}})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('a').disabled(graph);
      assert.strictEqual(disabled, 'not_connected');
    });

    it('returns falsy for a shared non-closing node in an area', () => {
      //  a --- b --- c
      //        |     |
      //        e --- d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmWay(context, {id: 'w', nodes: ['a', 'b', 'c', 'd', 'e', 'b', 'a'], tags: {area: 'yes'}})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('b').disabled(graph);
      assert.notOk(disabled);
    });

    it('returns falsy for a node shared by two or more ways', () => {
      //  a --- b --- c
      //        |
      //        d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('b').disabled(graph);
      assert.notOk(disabled);
    });

    it('returns falsy for an intersection of two ways with way specified by limitWays', () => {
      //  a --- b === c
      //        |
      //        d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('b').limitWays(['-']).disabled(graph);
      assert.notOk(disabled);
    });


    it('returns \'relation\' for a node connecting any two members of the same relation', () => {
      // Covers restriction relations, routes, multipolygons.
      // a --- b === c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [{ id: '-' }, { id: '=' }]})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('b').disabled(graph);
      assert.strictEqual(disabled, 'relation');
    });

    it('returns falsy for a node connecting two members of an unaffected relation', () => {
      //  a --- b === c
      //        |
      //        d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [{ id: '-' }, { id: '=' }]})
      ]);
      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionDisconnect('b').limitWays(['|']).disabled(graph);
      assert.notOk(disabled);
    });
  });
});
