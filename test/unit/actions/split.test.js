import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionSplit', () => {
  const context = new Rapid.MockContext();

  describe('#disabled', () => {
    it('returns falsy for a non-end node of a single way', () => {
      //
      //  a ---> b ---> c         split at 'b' not disabled
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
      ]);

      assert.isNotOk(Rapid.actionSplit('b').disabled(graph));
    });

    it('returns falsy for an intersection of two ways', () => {
      //
      //         c
      //         |
      //  a ---> * ---> b         split at '*' not disabled
      //         |
      //         d
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: '*', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', '*', 'b'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['c', '*', 'd'] })
      ]);

      assert.isNotOk(Rapid.actionSplit('*').disabled(graph));
    });

    it('returns falsy for an intersection of two ways with parent way specified', () => {
      //
      //         c
      //         |
      //  a ---> * ---> b         split '-' at '*' not disabled
      //         |
      //         d
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: '*', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', '*', 'b'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['c', '*', 'd'] })
      ]);

      assert.isNotOk(Rapid.actionSplit('*').limitWays(['-']).disabled(graph));
    });

    it('returns falsy for a self-intersection', () => {
      //
      //  b -- c
      //  |   /
      //  |  /                    split '-' at 'a' not disabled
      //  | /
      //  a -- b
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 2] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [1, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'a', 'd'] })
      ]);

      assert.isNotOk(Rapid.actionSplit('a').disabled(graph));
    });

    it('returns \'not_eligible\' for the first node of a single way', () => {
      //
      //  a ---> b                split at 'a' disabled - 'not eligible'
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] })
      ]);
      assert.strictEqual(Rapid.actionSplit('a').disabled(graph), 'not_eligible');
    });

    it('returns \'not_eligible\' for the last node of a single way', () => {
      //
      //  a ---> b                split at 'b' disabled - 'not eligible'
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] })
      ]);
      assert.strictEqual(Rapid.actionSplit('b').disabled(graph), 'not_eligible');
    });

    it('returns \'not_eligible\' for an intersection of two ways with non-parent way specified', () => {
      //
      //         c
      //         |
      //  a ---> * ---> b         split '-' and '=' at '*' disabled - 'not eligible'
      //         |                (there is no '=' here)
      //         d
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: '*', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', '*', 'b'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['c', '*', 'd'] })
      ]);

      assert.strictEqual(Rapid.actionSplit('*').limitWays(['-', '=']).disabled(graph), 'not_eligible');
    });
  });


  describe('ways', () => {
    it('creates a new way with the appropriate nodes', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
      ]);

      const result = Rapid.actionSplit('b', ['='])(graph);

      assert.deepEqual(result.entity('-').nodes, ['a', 'b']);
      assert.deepEqual(result.entity('=').nodes, ['b', 'c']);
    });

    it('copies tags to the new way', () => {
      const tags = { highway: 'residential' };
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'], tags: tags })
      ]);

      const result = Rapid.actionSplit('b', ['='])(graph);

      assert.deepEqual(result.entity('-').tags, tags);
      assert.deepEqual(result.entity('=').tags, tags);
    });

    it('splits a way at a T-junction', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['d', 'b'] })
      ]);

      const result = Rapid.actionSplit('b', ['='])(graph);

      assert.deepEqual(result.entity('-').nodes, ['a', 'b']);
      assert.deepEqual(result.entity('=').nodes, ['b', 'c']);
      assert.deepEqual(result.entity('|').nodes, ['d', 'b']);
    });

    it('splits multiple ways at an intersection', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: '*', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', '*', 'b'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['c', '*', 'd'] })
      ]);

      const result = Rapid.actionSplit('*', ['=', '¦'])(graph);

      assert.deepEqual(result.entity('-').nodes, ['a', '*']);
      assert.deepEqual(result.entity('=').nodes, ['*', 'b']);
      assert.deepEqual(result.entity('|').nodes, ['c', '*']);
      assert.deepEqual(result.entity('¦').nodes, ['*', 'd']);
    });

    it('splits the specified ways at an intersection', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: '*', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', '*', 'b'] }),
        new Rapid.OsmWay(context, { id: '|', nodes: ['c', '*', 'd'] })
      ]);

      const g1 = Rapid.actionSplit('*', ['=']).limitWays(['-'])(new Rapid.Graph(graph));
      assert.deepEqual(g1.entity('-').nodes, ['a', '*']);
      assert.deepEqual(g1.entity('=').nodes, ['*', 'b']);
      assert.deepEqual(g1.entity('|').nodes, ['c', '*', 'd']);

      const g2 = Rapid.actionSplit('*', ['¦']).limitWays(['|'])(new Rapid.Graph(graph));
      assert.deepEqual(g2.entity('-').nodes, ['a', '*', 'b']);
      assert.deepEqual(g2.entity('|').nodes, ['c', '*']);
      assert.deepEqual(g2.entity('¦').nodes, ['*', 'd']);

      const g3 = Rapid.actionSplit('*', ['=', '¦']).limitWays(['-', '|'])(new Rapid.Graph(graph));
      assert.deepEqual(g3.entity('-').nodes, ['a', '*']);
      assert.deepEqual(g3.entity('=').nodes, ['*', 'b']);
      assert.deepEqual(g3.entity('|').nodes, ['c', '*']);
      assert.deepEqual(g3.entity('¦').nodes, ['*', 'd']);
    });

    it('splits self-intersecting ways', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 2] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'a', 'd'] })
      ]);

      const result = Rapid.actionSplit('a', ['='])(graph);

      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'a']);
      assert.deepEqual(result.entity('=').nodes, ['a', 'd']);
    });

    it('splits a closed way at the given point and its antipode', () => {
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const g1 = Rapid.actionSplit('a', ['='])(new Rapid.Graph(graph));
      assert.deepEqual(g1.entity('-').nodes, ['c', 'd', 'a']);
      assert.deepEqual(g1.entity('=').nodes, ['a', 'b', 'c']);

      const g2 = Rapid.actionSplit('b', ['='])(new Rapid.Graph(graph));
      assert.deepEqual(g2.entity('-').nodes, ['b', 'c', 'd']);
      assert.deepEqual(g2.entity('=').nodes, ['d', 'a', 'b']);

      const g3 = Rapid.actionSplit('c', ['='])(new Rapid.Graph(graph));
      assert.deepEqual(g3.entity('-').nodes, ['c', 'd', 'a']);
      assert.deepEqual(g3.entity('=').nodes, ['a', 'b', 'c']);

      const g4 = Rapid.actionSplit('d', ['='])(new Rapid.Graph(graph));
      assert.deepEqual(g4.entity('-').nodes, ['b', 'c', 'd']);
      assert.deepEqual(g4.entity('=').nodes, ['d', 'a', 'b']);
    });
  });


  describe('relations', () => {

    function members(graph) {
      return graph.entity('r').members.map(m => m.id);
    }

    it('handles incomplete relations', () => {
      //
      // Situation:
      //    a ---> b ---> c         split at 'b'
      //    Relation: ['~', '-']
      //
      // Expected result:
      //    a ---> b ===> c
      //    Relation: ['~', '-', '=']
      //
      let graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '~', type: 'way' },
            { id: '-', type: 'way' }
          ]
        })
      ]);

      graph = Rapid.actionSplit('b', ['='])(graph);
      assert.deepEqual(members(graph), ['~', '-', '=']);
    });


    describe('member ordering', () => {

      it('adds the new way to parent relations (simple)', () => {
        //
        // Situation:
        //    a ---> b ---> c         split at 'b'
        //    Relation: ['-']
        //
        // Expected result:
        //    a ---> b ===> c
        //    Relation: ['-', '=']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way', role: 'forward' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);

        assert.deepEqual(graph.entity('r').members, [
          { id: '-', type: 'way', role: 'forward' },
          { id: '=', type: 'way', role: 'forward' }
        ]);
      });

      it('adds the new way to parent relations (forward order)', () => {
        //
        // Situation:
        //    a ---> b ---> c ~~~> d        split at 'b'
        //    Relation: ['-', '~']
        //
        // Expected result:
        //    a ---> b ===> c ~~~> d
        //    Relation: ['-', '=', '~']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '~', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['-', '=', '~']);
      });

      it('adds the new way to parent relations (reverse order)', () => {
        //
        // Situation:
        //    a ---> b ---> c ~~~> d        split at 'b'
        //    Relation: ['~', '-']
        //
        // Expected result:
        //    a ---> b ===> c ~~~> d
        //    Relation: ['~', '=', '-']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '~', type: 'way' },
              { id: '-', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['~', '=', '-']);
      });

      it('reorders members as node, way, relation (for Public Transport routing)', () => {
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: 'n1', type: 'node', role: 'forward' },
              { id: '-', type: 'way', role: 'forward' },
              { id: 'r1', type: 'relation', role: 'forward' },
              { id: 'n2', type: 'node', role: 'forward' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);

        assert.deepEqual(graph.entity('r').members, [
          { id: 'n1', type: 'node', role: 'forward' },
          { id: 'n2', type: 'node', role: 'forward' },
          { id: '-', type: 'way', role: 'forward' },
          { id: '=', type: 'way', role: 'forward' },
          { id: 'r1', type: 'relation', role: 'forward' }
        ]);
      });
    });


    describe('splitting out-and-back routes', () => {
      it('splits out-and-back1 route at b', () => {
        //
        // Situation:
        //    a ---> b ---> c ~~~> d                split at 'b'
        //    Relation: ['-', '~', '~', '-']
        //
        // Expected result:
        //    a ---> b ===> c ~~~> d
        //    Relation: ['-', '=', '~', '~', '=', '-']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '~', type: 'way' },
              { id: '~', type: 'way' },
              { id: '-', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['-', '=', '~', '~', '=', '-']);
      });

      it('splits out-and-back2 route at b', () => {
        //
        // Situation:
        //    a <--- b <--- c ~~~> d                split at 'b'
        //    Relation: ['-', '~', '~', '-']
        //
        // Expected result:
        //    a <=== b <--- c ~~~> d
        //    Relation: ['=', '-', '~', '~', '-', '=']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['c', 'b', 'a'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '~', type: 'way' },
              { id: '~', type: 'way' },
              { id: '-', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['=', '-', '~', '~', '-', '=']);
      });

      it('splits out-and-back3 route at b', () => {
        //
        // Situation:
        //    a ---> b ---> c <~~~ d                split at 'b'
        //    Relation: ['-', '~', '~', '-']
        //
        // Expected result:
        //    a ---> b ===> c <~~~ d
        //    Relation: ['-', '=', '~', '~', '=', '-']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'c'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '~', type: 'way' },
              { id: '~', type: 'way' },
              { id: '-', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['-', '=', '~', '~', '=', '-']);
      });

      it('splits out-and-back4 route at b', () => {
        //
        // Situation:
        //    a <--- b <--- c <~~~ d                split at 'b'
        //    Relation: ['-', '~', '~', '-']
        //
        // Expected result:
        //    a <=== b <--- c <~~~ d
        //    Relation: ['=', '-', '~', '~', '-', '=']
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['c', 'b', 'a'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'c'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '~', type: 'way' },
              { id: '~', type: 'way' },
              { id: '-', type: 'way' }
            ]
          })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);
        assert.deepEqual(members(graph), ['=', '-', '~', '~', '-', '=']);
      });
    });


    describe('splitting hat routes', () => {
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 1] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] });
      const e = new Rapid.OsmNode(context, { id: 'e', loc: [4, 0] });
      it('splits hat1a route at c', () => {
        //
        // Expected result:
        //          ###> c >***
        //          #         *
        //    a --> b ~~~~~~> d ==> e
        //
        //    Relation: ['-', '#', '*', '~', '#', '*', '=']
        //
        let graph = new Rapid.Graph([
          a, b, c, d, e,
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
          new Rapid.OsmWay(context, { id: '#', nodes: ['b', 'c', 'd'] }),
          new Rapid.OsmWay(context, { id: '~', nodes: ['b', 'd'] }),
          new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
          new Rapid.OsmRelation(context, {
            id: 'r',
            members: [
              { id: '-', type: 'way' },
              { id: '#', type: 'way' },
              { id: '~', type: 'way' },
              { id: '#', type: 'way' },
              { id: '=', type: 'way' }
            ]
          })
        ]);
        graph = Rapid.actionSplit('c', ['*'])(graph);
        assert.deepEqual(members(graph), ['-', '#', '*', '~', '#', '*', '=']);
      });
      //
      // Situation:
      //          ###> c >###
      //          #         #
      //    a --> b ~~~~~~> d ==> e
      //
      //    Relation: ['-', '#', '~', '#', '=']
      //
      const hat1a = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['b', 'd'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //          ###> c >###
      //          #         #
      //    a --> b ~~~~~~> d ==> e
      //
      //    Relation: ['-', '~', '#', '~', '=']
      //
      const hat1b = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['b', 'd'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //          ###< c <###
      //          #         #
      //    a --> b ~~~~~~> d ==> e
      //
      //    Relation: ['-', '#', '~', '#', '=']
      //
      const hat2 = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['d', 'c', 'b'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['b', 'd'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //          ###< c <###
      //          #         #
      //    a --> b <~~~~~~ d ==> e
      //
      //    Relation: ['-', '#', '~', '#', '=']
      //
      const hat3 = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['d', 'c', 'b'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'b'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //          ###> c >###
      //          #         #
      //    a --> b <~~~~~~ d ==> e
      //
      //    Relation: ['-', '#', '~', '#', '=']
      //
      const hat4 = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'b'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['d', 'e'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //          ###> c >###
      //          #         #
      //    a <-- b ~~~~~~> d <== e
      //
      //    Relation: ['-', '#', '~', '#', '=']
      //
      const hat5 = new Rapid.Graph([
        a, b, c, d, e,
        new Rapid.OsmWay(context, { id: '-', nodes: ['b', 'a'] }),
        new Rapid.OsmWay(context, { id: '#', nodes: ['b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['b', 'd'] }),
        new Rapid.OsmWay(context, { id: '=', nodes: ['e', 'd'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '-', type: 'way' },
            { id: '#', type: 'way' },
            { id: '~', type: 'way' },
            { id: '#', type: 'way' },
            { id: '=', type: 'way' }
          ]
        })
      ]);

      it('splits hat1a route at c', () => {
        //
        // Expected result:
        //          ###> c >***
        //          #         *
        //    a --> b ~~~~~~> d ==> e
        //
        //    Relation: ['-', '#', '*', '~', '#', '*', '=']
        //
        let graph = new Rapid.Graph(hat1a);
        graph = Rapid.actionSplit('c', ['*'])(graph);
        assert.deepEqual(graph.entity('#').nodes, ['b', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'd']);
        assert.deepEqual(members(graph), ['-', '#', '*', '~', '#', '*', '=']);
      });

      it('splits hat1b route at c', () => {
        //
        // Expected result:
        //          ###> c >***
        //          #         *
        //    a --> b ~~~~~~> d ==> e
        //
        //    Relation: ['-', '~', '*', '#', '~', '=']
        //
        let graph = new Rapid.Graph(hat1b);
        graph = Rapid.actionSplit('c', ['*'])(graph);

        assert.deepEqual(graph.entity('#').nodes, ['b', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'd']);
        assert.deepEqual(members(graph), ['-', '~', '*', '#', '~', '=']);
      });

      it('splits hat2 route at c', () => {
        //
        // Expected result:
        //          ***< c <###
        //          *         #
        //    a --> b ~~~~~~> d ==> e
        //
        //    Relation: ['-', '*', '#', '~', '*', '#', '=']
        //
        let graph = new Rapid.Graph(hat2);
        graph = Rapid.actionSplit('c', ['*'])(graph);

        assert.deepEqual(graph.entity('#').nodes, ['d', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'b']);
        assert.deepEqual(members(graph), ['-', '*', '#', '~', '*', '#', '=']);
      });

      it('splits hat3 route at c', () => {
        //
        // Expected result:
        //          ***< c <###
        //          *         #
        //    a --> b <~~~~~~ d ==> e
        //
        //    Relation: ['-', '*', '#', '~', '*', '#', '=']
        //
        let graph = new Rapid.Graph(hat3);
        graph = Rapid.actionSplit('c', ['*'])(graph);

        assert.deepEqual(graph.entity('#').nodes, ['d', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'b']);
        assert.deepEqual(members(graph), ['-', '*', '#', '~', '*', '#', '=']);
      });

      it('splits hat4 route at c', () => {
        //
        // Expected result:
        //          ###> c >***
        //          #         *
        //    a --> b <~~~~~~ d ==> e
        //
        //    Relation: ['-', '*', '#', '~', '*', '#', '=']
        //
        let graph = new Rapid.Graph(hat4);
        graph = Rapid.actionSplit('c', ['*'])(graph);

        assert.deepEqual(graph.entity('#').nodes, ['b', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'd']);
        assert.deepEqual(members(graph), ['-', '#', '*', '~', '#', '*', '=']);
      });

      it('splits hat5 route at c', () => {
        //
        // Expected result:
        //          ###> c >***
        //          #         *
        //    a <-- b ~~~~~~> d <== e
        //
        //    Relation: ['-', '#', '*', '~', '#', '*', '=']
        //
        let graph = new Rapid.Graph(hat5);
        graph = Rapid.actionSplit('c', ['*'])(graph);

        assert.deepEqual(graph.entity('#').nodes, ['b', 'c']);
        assert.deepEqual(graph.entity('*').nodes, ['c', 'd']);
        assert.deepEqual(members(graph), ['-', '#', '*', '~', '#', '*', '=']);
      });

    });


    describe('splitting spoon routes', () => {
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [0, 1] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [1, 1] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [1, 0] });
      const e = new Rapid.OsmNode(context, { id: 'e', loc: [2, 0] });
      const f = new Rapid.OsmNode(context, { id: 'f', loc: [3, 0] });
      //
      // Situation:
      //    b --> c
      //    |     |
      //    a <-- d ~~~> e ~~~> f
      //
      //    Relation: ['~', '-', '~']
      //
      const spoon1 = new Rapid.Graph([
        a, b, c, d, e, f,
        new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'a', 'b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'e', 'f'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '~', type: 'way' },
            { id: '-', type: 'way' },
            { id: '~', type: 'way' }
          ]
        })
      ]);

      //
      // Situation:
      //    b <-- c
      //    |     |
      //    a --> d ~~~> e ~~~> f
      //
      //    Relation: ['~', '-', '~']
      //
      const spoon2 = new Rapid.Graph([
        a, b, c, d, e, f,
        new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'c', 'b', 'a', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'e', 'f'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '~', type: 'way' },
            { id: '-', type: 'way' },
            { id: '~', type: 'way' }
          ]
        })
      ]);
      //
      // Situation:
      //    b --> c
      //    |     |
      //    a <-- d <~~~ e <~~~ f
      //
      //    Relation: ['~', '-', '~']
      //
      const spoon3 = new Rapid.Graph([
        a, b, c, d, e, f,
        new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'a', 'b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['f', 'e', 'd'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '~', type: 'way' },
            { id: '-', type: 'way' },
            { id: '~', type: 'way' }
          ]
        })
      ]);
      //
      // Situation:
      //    b <-- c
      //    |     |
      //    a --> d <~~~ e <~~~ f
      //
      //    Relation: ['~', '-', '~']
      //
      const spoon4 = new Rapid.Graph([
        a, b, c, d, e, f,
        new Rapid.OsmWay(context, { id: '-', nodes: ['d', 'c', 'b', 'a', 'd'] }),
        new Rapid.OsmWay(context, { id: '~', nodes: ['f', 'e', 'd'] }),
        new Rapid.OsmRelation(context, {
          id: 'r',
          members: [
            { id: '~', type: 'way' },
            { id: '-', type: 'way' },
            { id: '~', type: 'way' }
          ]
        })
      ]);

      it('splits spoon1 route at d', () => {
        //
        // Expected result:
        //    b ==> c
        //    |     ‖
        //    a <-- d ~~~> e ~~~> f
        //
        //    Relation: ['~', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon1);
        graph = Rapid.actionSplit('d', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'a', 'b']);
        assert.deepEqual(graph.entity('=').nodes, ['b', 'c', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['d', 'e', 'f']);
        assert.deepEqual(members(graph), ['~', '-', '=', '~']);
      });

      it('splits spoon2 route at d', () => {
        //
        // Expected result:
        //    b <== c
        //    |     ‖
        //    a --> d ~~~> e ~~~> f
        //
        //    Relation: ['~', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon2);
        graph = Rapid.actionSplit('d', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['b', 'a', 'd']);
        assert.deepEqual(graph.entity('=').nodes, ['d', 'c', 'b']);
        assert.deepEqual(graph.entity('~').nodes, ['d', 'e', 'f']);
        assert.deepEqual(members(graph), ['~', '-', '=', '~']);
      });

      it('splits spoon3 route at d', () => {
        //
        // Expected result:
        //    b ==> c
        //    |     ‖
        //    a <-- d <~~~ e <~~~ f
        //
        //    Relation: ['~', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon3);
        graph = Rapid.actionSplit('d', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'a', 'b']);
        assert.deepEqual(graph.entity('=').nodes, ['b', 'c', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['f', 'e', 'd']);
        assert.deepEqual(members(graph), ['~', '-', '=', '~']);
      });

      it('splits spoon4 route at d', () => {
        //
        // Expected result:
        //    b <== c
        //    |     ‖
        //    a --> d <~~~ e <~~~ f
        //
        //    Relation: ['~', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon4);
        graph = Rapid.actionSplit('d', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['b', 'a', 'd']);
        assert.deepEqual(graph.entity('=').nodes, ['d', 'c', 'b']);
        assert.deepEqual(graph.entity('~').nodes, ['f', 'e', 'd']);
        assert.deepEqual(members(graph), ['~', '-', '=', '~']);
      });

      it('splits spoon1 route at e', () => {
        //
        // Expected result:
        //    b --> c
        //    |     |
        //    a <-- d ~~~> e ===> f
        //
        //    Relation: ['=', '~', '-', '~', '=']
        //
        let graph = new Rapid.Graph(spoon1);
        graph = Rapid.actionSplit('e', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'a', 'b', 'c', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['d', 'e']);
        assert.deepEqual(graph.entity('=').nodes, ['e', 'f']);
        assert.deepEqual(members(graph), ['=', '~', '-', '~', '=']);
      });

      it('splits spoon2 route at e', () => {
        //
        // Expected result:
        //    b <-- c
        //    |     |
        //    a --> d ~~~> e ===> f
        //
        //    Relation: ['=', '~', '-', '~', '=']
        //
        let graph = new Rapid.Graph(spoon2);
        graph = Rapid.actionSplit('e', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'c', 'b', 'a', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['d', 'e']);
        assert.deepEqual(graph.entity('=').nodes, ['e', 'f']);
        assert.deepEqual(members(graph), ['=', '~', '-', '~', '=']);
      });

      it('splits spoon3 route at e', () => {
        //
        // Expected result:
        //    b --> c
        //    |     |
        //    a <-- d <=== e <~~~ f
        //
        //    Relation: ['~', '=', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon3);
        graph = Rapid.actionSplit('e', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'a', 'b', 'c', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['f', 'e']);
        assert.deepEqual(graph.entity('=').nodes, ['e', 'd']);
        assert.deepEqual(members(graph), ['~', '=', '-', '=', '~']);
      });

      it('splits spoon4 route at e', () => {
        //
        // Expected result:
        //    b <-- c
        //    |     |
        //    a --> d <=== e <~~~ f
        //
        //    Relation: ['~', '=', '-', '=', '~']
        //
        let graph = new Rapid.Graph(spoon4);
        graph = Rapid.actionSplit('e', ['='])(graph);

        assert.deepEqual(graph.entity('-').nodes, ['d', 'c', 'b', 'a', 'd']);
        assert.deepEqual(graph.entity('~').nodes, ['f', 'e']);
        assert.deepEqual(graph.entity('=').nodes, ['e', 'd']);
        assert.deepEqual(members(graph), ['~', '=', '-', '=', '~']);
      });
    });


    describe('type = multipolygon', () => {
      it('splits an area by converting it to a multipolygon', () => {
        // Situation:
        //    a ---- b
        //    |      |
        //    d ---- c
        //
        // Split at a.
        //
        // Expected result:
        //    a ---- b
        //    ||     |
        //    d ==== c
        //
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 1] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 0] }),
          new Rapid.OsmWay(context, { id: '-', tags: { area: 'yes' }, nodes: ['a', 'b', 'c', 'd', 'a'] })
        ]);

        graph = Rapid.actionSplit('a', ['='])(graph);
        assert.deepEqual(graph.entity('-').tags, {});
        assert.deepEqual(graph.entity('=').tags, {});
        assert.strictEqual(graph.parentRelations(graph.entity('-')).length, 1, 'graph.entity("-") has one parent relation');

        const relation = graph.parentRelations(graph.entity('-'))[0];
        assert.deepEqual(relation.tags, { type: 'multipolygon', area: 'yes' });
        assert.deepEqual(relation.members, [
          { id: '-', role: 'outer', type: 'way' },
          { id: '=', role: 'outer', type: 'way' }
        ]);
      });

      it('splits only the line of a node shared by a line and an area', () => {
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 1] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [1, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
          new Rapid.OsmWay(context, { id: '=', nodes: ['a', 'b', 'c', 'a'], tags: { area: 'yes' } })
        ]);

        graph = Rapid.actionSplit('b', ['~'])(graph);

// todo bhousel 4/17/24 - I commented these out in 7c737eec but can't remember why
// Need to look into it and find out what this part was supposed to test.
// (The area `=` does not split, which is what we want)
//        assert.deepEqual(graph.entity('-').nodes, ['b', 'c'], 'graph.entity("-").nodes should be ["b", "c"]');
//        assert.deepEqual(graph.entity('~').nodes, ['a', 'b'], 'graph.entity("~").nodes should be ["a", "b"]');
        assert.deepEqual(graph.entity('=').nodes, ['a', 'b', 'c', 'a'], 'graph.entity("=").nodes should be ["a", "b", "c", "a"]');
        assert.strictEqual(graph.parentRelations(graph.entity('=')).length, 0, 'graph.entity("=") should have no parent relations');
      });

      it('converts simple multipolygon to a proper multipolygon', () => {
        let graph = new Rapid.Graph([
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 1] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, 1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [1, 0] }),
          new Rapid.OsmWay(context, { 'id': '-', nodes: ['a', 'b', 'c', 'a'], tags: { area: 'yes' } }),
          new Rapid.OsmRelation(context, { id: 'r', members: [{ id: '-', type: 'way', role: 'outer' }], tags: { type: 'multipolygon' } })
        ]);

        graph = Rapid.actionSplit('b', ['='])(graph);

        assert.deepEqual(graph.entity('-').tags, {});
        assert.deepEqual(graph.entity('r').tags, { type: 'multipolygon', area: 'yes' });
        const ids = graph.entity('r').members.map(m => m.id);
        assert.deepEqual(ids, ['-', '=']);
      });
    });

    ['restriction', 'restriction:bus', 'manoeuvre'].forEach(function(type) {
      describe('type = ' + type, function() {

        it('updates a restriction\'s \'from\' role - via node', () => {
          // Situation:
          //    a ----> b ----> c ~~~~ d
          // A restriction from ---- to ~~~~ via node c.
          //
          // Split at b.
          //
          // Expected result:
          //    a ----> b ====> c ~~~~ d
          // A restriction from ==== to ~~~~ via node c.
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '-', role: 'from', type: 'way' },
                { id: '~', role: 'to', type: 'way' },
                { id: 'c', role: 'via', type: 'node' }
              ]
            })
          ]);
          graph = Rapid.actionSplit('b', ['='])(graph);
          assert.deepEqual(graph.entity('r').members, [
            { id: '=', role: 'from', type: 'way' },
            { id: '~', role: 'to', type: 'way' },
            { id: 'c', role: 'via', type: 'node' }
          ]);
        });

        it('updates a restriction\'s \'to\' role - via node', () => {
          //
          // Situation:
          //    a ----> b ----> c ~~~~ d
          // A restriction from ~~~~ to ---- via node c.
          //
          // Split at b.
          //
          // Expected result:
          //    a ----> b ====> c ~~~~ d
          // A restriction from ~~~~ to ==== via node c.
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '~', role: 'from', type: 'way' },
                { id: '-', role: 'to', type: 'way' },
                { id: 'c', role: 'via', type: 'node' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '~', role: 'from', type: 'way' },
            { id: '=', role: 'to', type: 'way' },
            { id: 'c', role: 'via', type: 'node' }
          ]);
        });

        it('updates both \'to\' and \'from\' roles for via-node u-turn restrictions', () => {
          //
          // Situation:
          //    a ----> b ----> c ~~~~ d
          // A restriction from ---- to ---- via node c.
          //
          // Split at b.
          //
          // Expected result:
          //    a ----> b ====> c ~~~~ d
          // A restriction from ==== to ==== via node c.
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '-', role: 'from', type: 'way' },
                { id: '-', role: 'to', type: 'way' },
                { id: 'c', role: 'via', type: 'node' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '=', role: 'from', type: 'way' },
            { id: '=', role: 'to', type: 'way' },
            { id: 'c', role: 'via', type: 'node' }
          ]);
        });

        it('updates a restriction\'s \'from\' role - via way', () => {
          //
          // Situation:
          //            e <~~~~ d
          //                    |
          //                    |
          //    a ----> b ----> c
          //
          // A restriction from ---- to ~~~~ via way |
          //
          // Split at b.
          //
          // Expected result:
          //            e <~~~~ d
          //                    |
          //                    |
          //    a ----> b ====> c
          //
          // A restriction from ==== to ~~~~ via way |
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmNode(context, { id: 'e' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '|', nodes: ['c', 'd'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'e'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '-', role: 'from', type: 'way' },
                { id: '~', role: 'to', type: 'way' },
                { id: '|', role: 'via', type: 'way' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '=', role: 'from', type: 'way' },
            { id: '~', role: 'to', type: 'way' },
            { id: '|', role: 'via', type: 'way' }
          ]);
        });

        it('updates a restriction\'s \'to\' role - via way', () => {
          //
          // Situation:
          //            e <~~~~ d
          //                    |
          //                    |
          //    a ----> b ----> c
          //
          // A restriction from ~~~~ to ---- via way |
          //
          // Split at b.
          //
          // Expected result:
          //            e <~~~~ d
          //                    |
          //                    |
          //    a ----> b ====> c
          //
          // A restriction from ~~~~ to ==== via way |
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmNode(context, { id: 'e' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '|', nodes: ['c', 'd'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['d', 'e'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '~', role: 'from', type: 'way' },
                { id: '-', role: 'to', type: 'way' },
                { id: '|', role: 'via', type: 'way' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '~', role: 'from', type: 'way' },
            { id: '=', role: 'to', type: 'way' },
            { id: '|', role: 'via', type: 'way' }
          ]);
        });

        it('updates a restriction\'s \'via\' role when splitting via way', () => {
          //
          // Situation:
          //    d               e
          //    |               ‖
          //    |               ‖
          //    a ----> b ----> c
          //
          // A restriction from | to ‖ via way ----
          //
          // Split at b.
          //
          // Expected result:
          //    d               e
          //    |               ‖
          //    |               ‖
          //    a ----> b ====> c
          //
          // A restriction from | to ‖ via ways ----, ====
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmNode(context, { id: 'e' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] }),
            new Rapid.OsmWay(context, { id: '|', nodes: ['d', 'a'] }),
            new Rapid.OsmWay(context, { id: '‖', nodes: ['e', 'c'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '|', role: 'from', type: 'way' },
                { id: '-', role: 'via', type: 'way' },
                { id: '‖', role: 'to', type: 'way' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '|', role: 'from', type: 'way' },
            { id: '-', role: 'via', type: 'way' },
            { id: '=', role: 'via', type: 'way' },
            { id: '‖', role: 'to', type: 'way' }
          ]);
        });

        it('leaves unaffected restrictions unchanged', () => {
          //
          // Situation:
          //    a <---- b <---- c ~~~~ d
          // A restriction from ---- to ~~~~ via c.
          //
          // Split at b.
          //
          // Expected result:
          //    a <==== b <---- c ~~~~ d
          // A restriction from ---- to ~~~~ via c.
          //
          let graph = new Rapid.Graph([
            new Rapid.OsmNode(context, { id: 'a' }),
            new Rapid.OsmNode(context, { id: 'b' }),
            new Rapid.OsmNode(context, { id: 'c' }),
            new Rapid.OsmNode(context, { id: 'd' }),
            new Rapid.OsmWay(context, { id: '-', nodes: ['c', 'b', 'a'] }),
            new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
            new Rapid.OsmRelation(context, {
              id: 'r',
              tags: { type: type },
              members: [
                { id: '-', role: 'from', type: 'way' },
                { id: '~', role: 'to', type: 'way' },
                { id: 'c', role: 'via', type: 'node' }
              ]
            })
          ]);

          graph = Rapid.actionSplit('b', ['='])(graph);

          assert.deepEqual(graph.entity('r').members, [
            { id: '-', role: 'from', type: 'way' },
            { id: '~', role: 'to', type: 'way' },
            { id: 'c', role: 'via', type: 'node' }
          ]);
        });
      });
    });
  });
});
