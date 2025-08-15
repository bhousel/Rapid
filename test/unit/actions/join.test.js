import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionJoin', () => {
  const context = new Rapid.MockContext();

  describe('#disabled', () => {
    it('returns falsy for ways that share an end/start node', () => {
      // a --> b ==> c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for ways that share a start/end node', () => {
      // a <-- b <== c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'a']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b']})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for ways that share a start/start node', () => {
      // a <-- b ==> c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'a']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for ways that share an end/end node', () => {
      // a --> b <== c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b']})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for more than two ways when connected, regardless of order', () => {
      // a --> b ==> c ~~> d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [6,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['c', 'd']})
      ]);

      const graph = new Rapid.Graph(base);
      assert.isNotOk(Rapid.actionJoin(['-', '=', '~']).disabled(graph));
      assert.isNotOk(Rapid.actionJoin(['-', '~', '=']).disabled(graph));
      assert.isNotOk(Rapid.actionJoin(['=', '-', '~']).disabled(graph));
      assert.isNotOk(Rapid.actionJoin(['=', '~', '-']).disabled(graph));
      assert.isNotOk(Rapid.actionJoin(['~', '=', '-']).disabled(graph));
      assert.isNotOk(Rapid.actionJoin(['~', '-', '=']).disabled(graph));
    });

    it('returns \'not_eligible\' for non-line geometries', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['a']).disabled(graph);
      assert.strictEqual(disabled, 'not_eligible');
    });

    it('returns \'not_adjacent\' for ways that don\'t share the necessary nodes', () => {
      // a -- b -- c
      //      |
      //      d
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [2,2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'd']})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.strictEqual(disabled, 'not_adjacent');
    });

    for (const type of ['restriction', 'connectivity']) {
      it(`returns ${type} in situations where a ${type} relation would be damaged (a)`, () => {
        // a --> b ==> c
        // from: -
        // to: =
        // via: b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
          new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
          new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
          new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
          new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
          new Rapid.OsmRelation(context, {id: 'r', tags: {'type': type}, members: [
            {type: 'way', id: '-', role: 'from'},
            {type: 'way', id: '=', role: 'to'},
            {type: 'node', id: 'b', role: 'via'}
          ]})
        ]);

        const graph = new Rapid.Graph(base);
        const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
        assert.strictEqual(disabled, type);
      });

      it(`returns ${type} in situations where a ${type} relation would be damaged (b)`, () => {
        // a --> b ==> c
        //       |
        //       d
        // from: -
        // to: |
        // via: b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
          new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
          new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
          new Rapid.OsmNode(context, {id: 'd', loc: [2,2]}),
          new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
          new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
          new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'd']}),
          new Rapid.OsmRelation(context, {id: 'r', tags: {'type': type}, members: [
            {type: 'way', id: '-', role: 'from'},
            {type: 'way', id: '|', role: 'to'},
            {type: 'node', id: 'b', role: 'via'}
          ]})
        ]);

        const graph = new Rapid.Graph(base);
        const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
        assert.strictEqual(disabled, type);
      });

      it(`returns falsy in situations where a ${type} relation would not be damaged (a)`, () => {
        // a --> b ==> c
        // |
        // d
        // from: -
        // to: |
        // via: a
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
          new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
          new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
          new Rapid.OsmNode(context, {id: 'd', loc: [0,2]}),
          new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
          new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
          new Rapid.OsmWay(context, {id: '|', nodes: ['a', 'd']}),
          new Rapid.OsmRelation(context, {id: 'r', tags: {'type': type}, members: [
            {type: 'way', id: '-', role: 'from'},
            {type: 'way', id: '|', role: 'to'},
            {type: 'node', id: 'a', role: 'via'}
          ]})
        ]);

        const graph = new Rapid.Graph(base);
        const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
        assert.isNotOk(disabled);
      });

      it(`returns falsy in situations where a ${type} relation would not be damaged (b)`, () => {
        //       d
        //       |
        // a --> b ==> c
        //        \
        //         e
        // from: |
        // to: \
        // via: b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
          new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
          new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
          new Rapid.OsmNode(context, {id: 'd', loc: [2,-2]}),
          new Rapid.OsmNode(context, {id: 'e', loc: [3,2]}),
          new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
          new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
          new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'b']}),
          new Rapid.OsmWay(context, {id: '\\', nodes: ['b', 'e']}),
          new Rapid.OsmRelation(context, {id: 'r', tags: {'type': type}, members: [
            {type: 'way', id: '|', role: 'from'},
            {type: 'way', id: '\\', role: 'to'},
            {type: 'node', id: 'b', role: 'via'}
          ]})
        ]);

        const graph = new Rapid.Graph(base);
        const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
        assert.isNotOk(disabled);
      });
    }

    it('returns \'conflicting_relations\' when a relation would be extended', () => {
      // a --> b ==> c
      // members: -
      // not member: =
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r', tags: {}, members: [
          {type: 'way', id: '-'},
        ]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.strictEqual(disabled, 'conflicting_relations');
    });

    it('returns \'conflicting_relations\' when a relation would be forked', () => {
      // a --> b ==> c
      //       |
      //       d
      // members: -, =
      // not member: |
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [2,2]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', tags: {}, members: [
          {type: 'way', id: '-'},
          {type: 'way', id: '='},
        ]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '|']).disabled(graph);
      assert.strictEqual(disabled, 'conflicting_relations');
    });

    it('returns falsy if they belong to same order-independent relations (same ordering)', () => {
      // a --> b ==> c
      // both '-' and '=' are members of r1, r2
      // r1, r2 are not restriction or connectivity relations
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: {}, members: []}),
        new Rapid.OsmRelation(context, {id: 'r2', tags: {}, members: []})
      ]);
      let graph = new Rapid.Graph(base);

      // Add members '-', and '=' in same order
      let r1 = graph.entity('r1');
      let r2 = graph.entity('r2');

      r1 = r1.addMember({type: 'way', id: '-'});
      r2 = r2.addMember({type: 'way', id: '-'});
      graph = graph.replace([r1, r2]);

      r1 = r1.addMember({type: 'way', id: '='});
      r2 = r2.addMember({type: 'way', id: '='});
      graph = graph.replace([r1, r2]);

      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy if they belong to same order-independent relations (different ordering)', () => {
      // a --> b ==> c
      // both '-' and '=' are members of r1, r2
      // r1, r2 are not restriction or connectivity relations
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: {}, members: []}),
        new Rapid.OsmRelation(context, {id: 'r2', tags: {}, members: []})
      ]);
      let graph = new Rapid.Graph(base);

      // Add members '-', and '=' in opposite order
      // Do it this way to get `graph.parentRelations` to return out-of-order results?
      let r1 = graph.entity('r1');
      let r2 = graph.entity('r2');

      r1 = r1.addMember({type: 'way', id: '-'});
      r2 = r2.addMember({type: 'way', id: '='});
      graph = graph.replace([r1, r2]);

      r1 = r1.addMember({type: 'way', id: '='});
      r2 = r2.addMember({type: 'way', id: '-'});
      graph = graph.replace([r1, r2]);

      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns \'paths_intersect\' if resulting way intersects itself', () => {
      //   d
      //   |
      // a --- b
      //   |  /
      //   | /
      //   c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0,10]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [5,5]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [-5,5]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'd']}),
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.strictEqual(disabled, 'paths_intersect');
    });

    it('returns \'conflicting_tags\' for two entities that have conflicting tags', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: {highway: 'primary'}}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c'], tags: {highway: 'secondary'}})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.strictEqual(disabled, 'conflicting_tags');
    });

    it('takes tag reversals into account when calculating conflicts', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: {'oneway': 'yes'}}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b'], tags: {'oneway': '-1'}})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for exceptions to tag conflicts: missing tag', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: {highway: 'primary'}}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c'], tags: {}})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });

    it('returns falsy for exceptions to tag conflicts: uninteresting tag', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: {'tiger:cfcc': 'A41'}}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c'], tags: {'tiger:cfcc': 'A42'}})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionJoin(['-', '=']).disabled(graph);
      assert.isNotOk(disabled);
    });
  });


  it('joins a --> b ==> c', () => {
    // Expected result:
    // a --> b --> c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.isNotOk(result.hasEntity('='));
  });

  it('joins a <-- b <== c', () => {
    // Expected result:
    // a <-- b <-- c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['c', 'b', 'a']);
    assert.isNotOk(result.hasEntity('='));
  });

  it('joins a <-- b ==> c', () => {
    // Expected result:
    // a --> b --> c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'a'], tags: {'lanes:forward': 2}}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['c', 'b', 'a']);
    assert.deepEqual(result.entity('-').tags, {'lanes:forward': 2});
    assert.isNotOk(result.hasEntity('='));
  });

  it('joins a --> b <== c', () => {
    // Expected result:
    // a --> b --> c
    // tags on === reversed
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b'], tags: {'lanes:forward': 2}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('-').tags, {'lanes:backward': 2});
    assert.isNotOk(result.hasEntity('='));
  });

  it('joins a --> b <== c <++ d **> e', () => {
    // Expected result:
    // a --> b --> c --> d --> e
    // tags on === reversed
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [6,0]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [8,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b'], tags: {'lanes:forward': 2}}),
      new Rapid.OsmWay(context, {id: '+', nodes: ['d', 'c']}),
      new Rapid.OsmWay(context, {id: '*', nodes: ['d', 'e'], tags: {'lanes:backward': 2}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '=', '+', '*'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(result.entity('-').tags, {'lanes:backward': 2});
    assert.isNotOk(result.hasEntity('='));
    assert.isNotOk(result.hasEntity('+'));
    assert.isNotOk(result.hasEntity('*'));
  });

  it('prefers to choose an existing way as the survivor', () => {
    // a --> b ==> c ++> d
    // --- is new, === is existing, +++ is new
    // Expected result:
    // a ==> b ==> c ==> d
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [6,0]}),
      new Rapid.OsmWay(context, {id: 'w-1', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: 'w1', nodes: ['b', 'c']}),
      new Rapid.OsmWay(context, {id: 'w-2', nodes: ['c', 'd']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['w-1', 'w1', 'w-2'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('w1').nodes, ['a', 'b', 'c', 'd']);
    assert.isNotOk(result.hasEntity('w-1'));
    assert.isNotOk(result.hasEntity('w-2'));
  });

  it('prefers to choose the oldest way as the survivor', () => {
    // n1 ==> n2 ++> n3 --> n4
    // ==> is existing, ++> is existing, --> is new
    // Expected result:
    // n1 ==> n2 ==> n3 ==> n4
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [0,0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [2,0] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [4,0] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [6,0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n2', 'n3'] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1', 'n2'] }),
      new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n3', 'n4'] })
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['w2', 'w1', 'w-1'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    // way 1 is the oldest (it has the lower id) so it kept that one
    assert.deepEqual(result.entity('w1').nodes, ['n1', 'n2', 'n3', 'n4']);
    assert.isNotOk(result.hasEntity('w-1'));
    assert.isNotOk(result.hasEntity('w2'));
  });

  it('merges tags', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [6,0]}),
      new Rapid.OsmNode(context, {id: 'e', loc: [8,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: {a: 'a', b: '-', c: 'c'}}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c'], tags: {a: 'a', b: '=', d: 'd'}}),
      new Rapid.OsmWay(context, {id: '+', nodes: ['c', 'd'], tags: {a: 'a', b: '=', e: 'e'}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '=', '+'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').tags, {a: 'a', b: '-;=', c: 'c', d: 'd', e: 'e'});
    assert.isNotOk(result.hasEntity('='));
    assert.isNotOk(result.hasEntity('+'));
  });

  it('preserves sidedness of start segment, co-directional lines', () => {
    // a -----> b =====> c
    //   v v v
    //
    //  Expected result:
    // a -----> b -----> c
    //   v v v    v v v
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: { natural: 'cliff' }}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('-').tags, { natural: 'cliff' });
    assert.isNotOk(result.hasEntity('='));
  });

  it('preserves sidedness of end segment, co-directional lines', () => {
    // a -----> b =====> c
    //            v v v
    //
    //  Expected result:
    // a =====> b =====> c
    //   v v v    v v v
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c'], tags: { natural: 'cliff' }})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('=').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('=').tags, { natural: 'cliff' });
    assert.isNotOk(result.hasEntity('-'));
  });

  it('preserves sidedness of start segment, contra-directional lines', () => {
    // a -----> b <===== c
    //   v v v
    //
    //  Expected result:
    // a -----> b -----> c
    //   v v v    v v v
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b'], tags: { natural: 'cliff' }}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('-').tags, { natural: 'cliff' });
    assert.isNotOk(result.hasEntity('='));
  });

  it('preserves sidedness of end segment, contra-directional lines', () => {
    // a -----> b <===== c
    //             v v v
    //
    //  Expected result:
    // a <===== b <===== c
    //    v v v    v v v
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b'], tags: { natural: 'cliff' }})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('=').nodes, ['c', 'b', 'a']);
    assert.deepEqual(result.entity('=').tags, { natural: 'cliff' });
    assert.isNotOk(result.hasEntity('-'));
  });


  it('merges relations', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [2,0]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [4,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
      new Rapid.OsmRelation(context, {id: 'r1', members: [
        {id: '=', role: 'r1', type: 'way'}
      ]}),
      new Rapid.OsmRelation(context, {id: 'r2', members: [
        {id: '=', role: 'r2', type: 'way'},
        {id: '-', role: 'r2', type: 'way'}
      ]})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('r1').members, [ {id: '-', role: 'r1', type: 'way'} ]);
    assert.deepEqual(result.entity('r2').members, [ {id: '-', role: 'r2', type: 'way'} ]);
  });

  it('preserves duplicate route segments in relations', () => {
    //
    // Situation:
    //    a ---> b ===> c ~~~~> d                        join '-' and '='
    //    Relation: ['-', '=', '~', '~', '=', '-']
    //
    // Expected result:
    //    a ---> b ---> c ~~~~> d
    //    Relation: ['-', '~', '~', '-']
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
      new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] }),
      new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
      new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'] }),
      new Rapid.OsmWay(context, { id: '=', nodes: ['b', 'c'] }),
      new Rapid.OsmWay(context, { id: '~', nodes: ['c', 'd'] }),
      new Rapid.OsmRelation(context, {id: 'r', members: [
        {id: '-', role: 'forward', type: 'way'},
        {id: '=', role: 'forward', type: 'way'},
        {id: '~', role: 'forward', type: 'way'},
        {id: '~', role: 'forward', type: 'way'},
        {id: '=', role: 'forward', type: 'way'},
        {id: '-', role: 'forward', type: 'way'}
      ]})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('~').nodes, ['c', 'd']);
    assert.deepEqual(result.entity('r').members, [
      {id: '-', role: 'forward', type: 'way'},
      {id: '~', role: 'forward', type: 'way'},
      {id: '~', role: 'forward', type: 'way'},
      {id: '-', role: 'forward', type: 'way'}
    ]);
  });

  it('collapses resultant single-member multipolygon into basic area', () => {
    // Situation:
    // b --> c
    // |#####|
    // |# r #|
    // |#####|
    // a <== d
    //
    //  Expected result:
    // a --> b
    // |#####|
    // |#####|
    // |#####|
    // d <-- c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [0,2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2,2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [2,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['d', 'a']}),
      new Rapid.OsmRelation(context, {id: 'r', tags: { type: 'multipolygon', man_made: 'pier' }, members: [
        {id: '-', role: 'outer', type: 'way'},
        {id: '=', role: 'outer', type: 'way'}
      ]})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'a']);
    assert.deepEqual(result.entity('-').tags, { man_made: 'pier', area: 'yes' });
    assert.isNotOk(result.hasEntity('='));
    assert.isNotOk(result.hasEntity('r'));
  });

  it('does not collapse resultant single-member multipolygon into basic area when tags conflict', () => {
    // Situation:
    // b --> c
    // |#####|
    // |# r #|
    // |#####|
    // a <== d
    //
    //  Expected result:
    // a --> b
    // |#####|
    // |# r #|
    // |#####|
    // d <-- c
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', loc: [0,0]}),
      new Rapid.OsmNode(context, {id: 'b', loc: [0,2]}),
      new Rapid.OsmNode(context, {id: 'c', loc: [2,2]}),
      new Rapid.OsmNode(context, {id: 'd', loc: [2,0]}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'd'], tags: { surface: 'paved' }}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['d', 'a']}),
      new Rapid.OsmRelation(context, {id: 'r', members: [
        {id: '-', role: 'outer', type: 'way'},
        {id: '=', role: 'outer', type: 'way'}
      ], tags: {
        type: 'multipolygon',
        man_made: 'pier',
        surface: 'wood'
      }})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionJoin(['-', '='])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'a']);
    assert.deepEqual(result.entity('-').tags, { surface: 'paved' });
    assert.isNotOk(result.hasEntity('='));
    assert.deepEqual(result.entity('r').tags, { type: 'multipolygon', man_made: 'pier', surface: 'wood' });
  });

});
