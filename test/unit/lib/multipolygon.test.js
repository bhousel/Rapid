import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('multipolygons', () => {
  const context = new Rapid.MockContext();

  describe('osmJoinWays', () => {
    function getIDs(objects) {
      return objects.map(node => node.id);
    }

    it('returns an array of members with nodes properties', () => {
      const node = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const way = new Rapid.OsmWay(context, { id: '-', nodes: ['a'] });
      const member = { id: '-', type: 'way' };
      const graph = new Rapid.Graph(context, [node, way]);
      const result = Rapid.osmJoinWays([member], graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 1);
      assert.deepEqual(getIDs(result[0].nodes), ['a']);
      assert.deepEqual(result[0][0], member);
    });

    it('joins ways (ordered - w1, w2)', () => {
      //
      //  a ---> b ===> c
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] });
      const graph = new Rapid.Graph(context, [a, b, c, w1, w2]);
      const result = Rapid.osmJoinWays([w1, w2], graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], w1);
      assert.deepEqual(result[0][1], w2);
    });

    it('joins ways (unordered - w2, w1)', () => {
      //
      //  a ---> b ===> c
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] });
      const graph = new Rapid.Graph(context, [a, b, c, w1, w2]);
      const result = Rapid.osmJoinWays([w2, w1], graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], w1);
      assert.deepEqual(result[0][1], w2);
    });

    it('joins relation members (ordered -, =)', () => {
      //
      //  a ---> b ===> c
      //  r: ['-', '=']
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '-', type: 'way' },
          { id: '=', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, w1, w2, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], { id: '-', type: 'way' });
      assert.deepEqual(result[0][1], { id: '=', type: 'way' });
    });

    it('joins relation members (ordered =, -)', () => {
      //
      //  a ---> b ===> c
      //  r: ['=', '-']
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '=', type: 'way' },
          { id: '-', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, w1, w2, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);

      assert.isArray(result.actions);
      assert.lengthOf(result.actions, 2);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['c', 'b', 'a']);
      assert.deepEqual(result[0][0], { id: '=', type: 'way' });
      assert.deepEqual(result[0][1], { id: '-', type: 'way' });
    });

    it('returns joined members in the correct order', () => {
      //
      //  a <=== b ---> c ~~~> d
      //  r: ['-', '~', '=']
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['b', 'c'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'a'] });
      const w3 = new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '-', type: 'way' },
          { id: '~', type: 'way' },
          { id: '=', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, d, w1, w2, w3, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);

      assert.isArray(result.actions);
      assert.lengthOf(result.actions, 1);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 3);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c', 'd']);
      assert.deepEqual(result[0][0], { id: '=', type: 'way' });
      assert.deepEqual(result[0][1], { id: '-', type: 'way' });
      assert.deepEqual(result[0][2], { id: '~', type: 'way' });
    });

    it('reverses member tags of reversed segements', () => {
      //
      // Source:
      //   a ---> b <=== c
      // Result:
      //   a ---> b ===> c    (and tags on === reversed)
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['c', 'b'], tags: { 'oneway': 'yes', 'lanes:forward': 2 } });
      const base = new Rapid.Graph(context, [a, b, c, w1, w2]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.osmJoinWays([w1, w2], graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);

      assert.isArray(result.actions);
      assert.lengthOf(result.actions, 1);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);

      assert.instanceOf(result[0][0], Rapid.OsmWay);
      assert.deepEqual(result[0][0].nodes, ['a', 'b']);

      assert.instanceOf(result[0][1], Rapid.OsmWay);
      assert.deepEqual(result[0][1].nodes, ['b', 'c']);
      assert.deepEqual(result[0][1].tags, { 'oneway': '-1', 'lanes:backward': 2 });
    });

    it('reverses the initial segment to preserve member order when joining relation members', () => {
      //
      // Source:
      //   a <--- b ===> c
      // Result:
      //   a ---> b ===> c   (and --- reversed)
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '-', nodes: ['b', 'a'], tags: { 'oneway': 'yes', 'lanes:forward': 2 } });
      const w2 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '-', type: 'way' },
          { id: '=', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, w1, w2, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);

      assert.isArray(result.actions);
      assert.lengthOf(result.actions, 1);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], { id: '-', type: 'way' });
      assert.deepEqual(result[0][1], { id: '=', type: 'way' });
    });

    it('ignores non-way members', () => {
      const node = new Rapid.OsmNode(context, { loc: [0, 0] });
      const member = { id: 'n', type: 'node' };
      const graph = new Rapid.Graph(context, [node]);
      const result = Rapid.osmJoinWays([member], graph);
      assert.deepEqual(result, []);
    });

    it('ignores incomplete members', () => {
      const member = { id: 'w', type: 'way' };
      const graph = new Rapid.Graph(context);
      const result = Rapid.osmJoinWays([member], graph);
      assert.deepEqual(result, []);
    });

    it('returns multiple arrays for disjoint ways', () => {
      //
      //     b
      //    / \
      //   a   c     d ---> e ===> f
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [5, 0] });
      const e = new Rapid.OsmNode(context, { id: 'e', loc: [6, 0] });
      const f = new Rapid.OsmNode(context, { id: 'f', loc: [7, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '/', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '\\', nodes: ['b', 'c'] });
      const w3 = new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'e'] });
      const w4 = new Rapid.OsmWay(context, { id: '=', nodes: ['e', 'f'] });
      const graph = new Rapid.Graph(context, [a, b, c, d, e, f, w1, w2, w3, w4]);
      const result = Rapid.osmJoinWays([w1, w2, w3, w4], graph);

      assert.isArray(result);
      assert.lengthOf(result, 2);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], w1);
      assert.deepEqual(result[0][1], w2);

      assert.isArray(result[1]);
      assert.lengthOf(result[1], 2);
      assert.deepEqual(getIDs(result[1].nodes), ['d', 'e', 'f']);
      assert.deepEqual(result[1][0], w3);
      assert.deepEqual(result[1][1], w4);
    });

    it('returns multiple arrays for disjoint relations', () => {
      //
      //     b
      //    / \
      //   a   c     d ---> e ===> f
      //
      //   r: ['/', '\', '-', '=']
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [5, 0] });
      const e = new Rapid.OsmNode(context, { id: 'e', loc: [6, 0] });
      const f = new Rapid.OsmNode(context, { id: 'f', loc: [7, 0] });
      const w1 = new Rapid.OsmWay(context, { id: '/', nodes: ['a', 'b'] });
      const w2 = new Rapid.OsmWay(context, { id: '\\', nodes: ['b', 'c'] });
      const w3 = new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'e'] });
      const w4 = new Rapid.OsmWay(context, { id: '=', nodes: ['e', 'f'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '/', type: 'way' },
          { id: '\\', type: 'way' },
          { id: '-', type: 'way' },
          { id: '=', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, d, e, f, w1, w2, w3, w4, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 2);
      assert.deepEqual(result.actions, []);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 2);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c']);
      assert.deepEqual(result[0][0], { id: '/', type: 'way' });
      assert.deepEqual(result[0][1], { id: '\\', type: 'way' });

      assert.isArray(result[1]);
      assert.lengthOf(result[1], 2);
      assert.deepEqual(getIDs(result[1].nodes), ['d', 'e', 'f']);
      assert.deepEqual(result[1][0], { id: '-', type: 'way' });
      assert.deepEqual(result[1][1], { id: '=', type: 'way' });
    });

    it('understands doubled-back relation members', () => {
      //
      //                    e
      //                  /   \
      //   a <=== b ---> c ~~~> d
      //
      //   r: ['=', '-', '~', '\', '/', '-', '=']
      //
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [4, 0] });
      const e = new Rapid.OsmNode(context, { id: 'e', loc: [3, 1] });
      const w1 = new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'a'] });
      const w2 = new Rapid.OsmWay(context, { id: '-', nodes: ['b', 'c'] });
      const w3 = new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] });
      const w4 = new Rapid.OsmWay(context, { id: '\\', nodes: ['d', 'e'] });
      const w5 = new Rapid.OsmWay(context, { id: '/', nodes: ['c', 'e'] });
      const r = new Rapid.OsmRelation(context, {
        id: 'r',
        members: [
          { id: '=', type: 'way' },
          { id: '-', type: 'way' },
          { id: '~', type: 'way' },
          { id: '\\', type: 'way' },
          { id: '/', type: 'way' },
          { id: '-', type: 'way' },
          { id: '=', type: 'way' }
        ]
      });
      const graph = new Rapid.Graph(context, [a, b, c, d, e, w1, w2, w3, w4, w5, r]);
      const result = Rapid.osmJoinWays(r.members, graph);

      assert.isArray(result);
      assert.lengthOf(result, 1);

      assert.isArray(result.actions);
      assert.lengthOf(result.actions, 3);

      assert.isArray(result[0]);
      assert.lengthOf(result[0], 7);
      assert.deepEqual(getIDs(result[0].nodes), ['a', 'b', 'c', 'd', 'e', 'c', 'b', 'a']);
      assert.deepEqual(result[0][0], { id: '=', type: 'way' });
      assert.deepEqual(result[0][1], { id: '-', type: 'way' });
      assert.deepEqual(result[0][2], { id: '~', type: 'way' });
      assert.deepEqual(result[0][3], { id: '\\', type: 'way' });
      assert.deepEqual(result[0][4], { id: '/', type: 'way' });
      assert.deepEqual(result[0][5], { id: '-', type: 'way' });
      assert.deepEqual(result[0][6], { id: '=', type: 'way' });
    });
  });
});
