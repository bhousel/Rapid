import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionConnect', () => {
  const context = new Rapid.MockContext();

  it('chooses the first non-new node as the survivor', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b', version: '1'}),
      new Rapid.OsmNode(context, {id: 'c', version: '1'})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['a', 'b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('a'));
    assert.isOk(result.hasEntity('b'));
    assert.isNotOk(result.hasEntity('c'));
  });


  it('chooses the last node as the survivor when all are new', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['a', 'b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('a'));
    assert.isNotOk(result.hasEntity('b'));
    assert.isOk(result.hasEntity('c'));
  });


  it('replaces non-surviving nodes in parent ways', () => {
    // a --- b --- c
    //
    //       e
    //       |
    //       d
    //
    // Connect [e, b].
    //
    // Expected result:
    //
    // a --- b --- c
    //       |
    //       d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
      new Rapid.OsmWay(context, {id: '|', nodes: ['d', 'e']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['e', 'b'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c']);
    assert.deepEqual(result.entity('|').nodes, ['d', 'b']);
  });


  it('handles circular ways', () => {
    // c -- a   d === e
    // |   /
    // |  /
    // | /
    // b
    //
    // Connect [a, d].
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmNode(context, {id: 'e'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c', 'a']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['d', 'e']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['a', 'd'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['d', 'b', 'c', 'd']);
  });


  it('merges adjacent nodes', () => {
    // a --- b --- c
    //
    // Connect [b, c]
    //
    // Expected result:
    //
    // a --- c
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'c']);
    assert.isOk(!result.hasEntity('b'));
  });


  it('merges adjacent nodes with connections', () => {
    // a --- b --- c
    //       |
    //       d
    //
    // Connect [b, c]
    //
    // Expected result:
    //
    // a --- c
    //       |
    //       d
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
      new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'd']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('-').nodes, ['a', 'c']);
    assert.deepEqual(result.entity('|').nodes, ['c', 'd']);
    assert.isNotOk(result.hasEntity('b'));
  });


  it('deletes a degenerate way', () => {
    // a --- b
    //
    // Connect [a, b]
    //
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['a', 'b'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isNotOk(result.hasEntity('-'));
    assert.isNotOk(result.hasEntity('a'));
    assert.isNotOk(result.hasEntity('b'));
  });


  it('merges tags to the surviving node', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a', tags: {a: 'a'}}),
      new Rapid.OsmNode(context, {id: 'b', tags: {b: 'b'}}),
      new Rapid.OsmNode(context, {id: 'c', tags: {c: 'c'}})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['a', 'b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('c').tags, { a: 'a', b: 'b', c: 'c' });
  });


  it('merges memberships to the surviving node', () => {
    const base = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, {id: 'a'}),
      new Rapid.OsmNode(context, {id: 'b'}),
      new Rapid.OsmNode(context, {id: 'c'}),
      new Rapid.OsmNode(context, {id: 'd'}),
      new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
      new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'd']}),
      new Rapid.OsmRelation(context, {id: 'r1', members: [{id: 'b', role: 'r1', type: 'node'}]}),
      new Rapid.OsmRelation(context, {id: 'r2', members: [{id: 'b', role: 'r2', type: 'node'}, {id: 'c', role: 'r2', type: 'node'}]})
    ]);

    const graph = new Rapid.Graph(base);
    const result = Rapid.actionConnect(['b', 'c'])(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.deepEqual(result.entity('r1').members, [{ id: 'c', role: 'r1', type: 'node' }]);
    assert.deepEqual(result.entity('r2').members, [{ id: 'c', role: 'r2', type: 'node' }]);
  });


  describe('disabled', () => {
    it('returns falsy when connecting members of the same relation and same roles', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', members: [
          { id: 'b', type: 'node', role: 'foo' },
          { id: 'c', type: 'node', role: 'foo' }
        ]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.isNotOk(disabled);
    });


    it('returns falsy when connecting members of different relation and different roles', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', members: [{ id: 'b', type: 'node', role: 'foo' } ]}),
        new Rapid.OsmRelation(context, {id: 'r2', members: [{ id: 'c', type: 'node', role: 'bar' } ]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.isNotOk(disabled);
    });


    it('returns \'relation\' when connecting members of the same relation but different roles', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', members: [
          { id: 'b', type: 'node', role: 'foo' },
          { id: 'c', type: 'node', role: 'bar' }
        ]})
      ]);

      const graph = new Rapid.Graph(base);
      const disabled = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.strictEqual(disabled, 'relation');
    });


    it('returns falsy when connecting a node unrelated to the restriction', () => {
      //
      //  a --- b   d ~~~ e        r1:  `no_right_turn`
      //        |                        FROM '-'
      //        |                        VIA  'b'
      //        c                        TO   '|'
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['d', 'e']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_right_turn' }, members: [
          { id: '-', type: 'way', role: 'from' },
          { id: 'b', type: 'node', role: 'via' },
          { id: '|', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      const disabledAD = Rapid.actionConnect(['a', 'd']).disabled(graph);
      assert.isNotOk(disabledAD);
      const disabledBD = Rapid.actionConnect(['b', 'd']).disabled(graph);
      assert.isNotOk(disabledBD);
      const disabledCD = Rapid.actionConnect(['c', 'd']).disabled(graph);
      assert.isNotOk(disabledCD);
    });

    it('returns falsy when connecting nodes that would not break a via-node restriction', () => {
      //
      //  a --- b --- c      r1:  `no_right_turn`
      //              |            FROM '-'
      //              d            VIA  'c'
      //              |            TO   '|'
      //              e
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['c', 'd', 'e']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_right_turn' }, members: [
          { id: '-', type: 'way', role: 'from' },
          { id: 'c', type: 'node', role: 'via' },
          { id: '|', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      // allowed: adjacent connections that don't destroy a way
      const disabledAB = Rapid.actionConnect(['a', 'b']).disabled(graph);
      assert.isNotOk(disabledAB);
      const disabledBC = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.isNotOk(disabledBC);
      const disabledCD = Rapid.actionConnect(['c', 'd']).disabled(graph);
      assert.isNotOk(disabledCD);
      const disabledDE = Rapid.actionConnect(['d', 'e']).disabled(graph);
      assert.isNotOk(disabledDE);
    });


    it('returns falsy when connecting nodes that would not break a via-way restriction', () => {
      //
      //  a --- b --- c      r1:  `no_u_turn`
      //              |            FROM '='
      //              d            VIA  '|'
      //              |            TO   '-'
      //  g === f === e
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmNode(context, {id: 'f'}),
        new Rapid.OsmNode(context, {id: 'g'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['c', 'd', 'e']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['e', 'f', 'g']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [
          { id: '=', type: 'way', role: 'from' },
          { id: '|', type: 'way', role: 'via' },
          { id: '-', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      // allowed: adjacent connections that don't destroy a way
      const disabledAB = Rapid.actionConnect(['a', 'b']).disabled(graph);
      assert.isNotOk(disabledAB);
      const disabledBC = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.isNotOk(disabledBC);
      const disabledCD = Rapid.actionConnect(['c', 'd']).disabled(graph);
      assert.isNotOk(disabledCD);
      const disabledDE = Rapid.actionConnect(['d', 'e']).disabled(graph);
      assert.isNotOk(disabledDE);
      const disabledEF = Rapid.actionConnect(['e', 'f']).disabled(graph);
      assert.isNotOk(disabledEF);
      const disabledFG = Rapid.actionConnect(['f', 'g']).disabled(graph);
      assert.isNotOk(disabledFG);
    });


    it('returns \'restriction\' when connecting nodes that would break a via-node restriction', () => {
      //
      //  a --- b --- c      r1:  `no_right_turn`
      //              |            FROM '-'
      //              d            VIA  'c'
      //              |            TO   '|'
      //              e
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['c', 'd', 'e']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_right_turn' }, members: [
          { id: '-', type: 'way', role: 'from' },
          { id: 'c', type: 'node', role: 'via' },
          { id: '|', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      // prevented:
      // extra connections to the VIA node, or any connections between distinct FROM and TO
      const disabledAC = Rapid.actionConnect(['a', 'c']).disabled(graph);
      assert.strictEqual(disabledAC, 'restriction', 'extra connection FROM-VIA');
      const disabledEC = Rapid.actionConnect(['e', 'c']).disabled(graph);
      assert.strictEqual(disabledEC, 'restriction', 'extra connection TO-VIA');
      const disabledBD = Rapid.actionConnect(['b', 'd']).disabled(graph);
      assert.strictEqual(disabledBD, 'restriction', 'extra connection FROM-TO');
    });


    it('returns falsy when connecting nodes on a via-node u_turn restriction', () => {
      //
      //  a --- b --- c      r1:  `no_u_turn`
      //              |            FROM '-'
      //              d            VIA  'c'
      //              |            TO   '-'
      //              e
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['c', 'd', 'e']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [
          { id: '-', type: 'way', role: 'from' },
          { id: 'c', type: 'node', role: 'via' },
          { id: '-', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      // The u-turn case is one where a connection between FROM-TO should be allowed
      const disabledAB = Rapid.actionConnect(['a', 'b']).disabled(graph);
      assert.isNotOk(disabledAB);
      const disabledBC = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.isNotOk(disabledBC);
    });


    it('returns \'restriction\' when connecting nodes that would break a via-way restriction', () => {
      //
      //  a --- b --- c      r1:  `no_u_turn`
      //              |            FROM '='
      //              d            VIA  '|'
      //              |            TO   '-'
      //  g === f === e
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmNode(context, {id: 'e'}),
        new Rapid.OsmNode(context, {id: 'f'}),
        new Rapid.OsmNode(context, {id: 'g'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['c', 'd', 'e']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['e', 'f', 'g']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [
          { id: '=', type: 'way', role: 'from' },
          { id: '|', type: 'way', role: 'via' },
          { id: '-', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      // prevented:
      // extra connections to any node along VIA way
      const disabledAC = Rapid.actionConnect(['a', 'c']).disabled(graph);
      assert.strictEqual(disabledAC, 'restriction', 'extra connection TO-VIA c');
      const disabledBD = Rapid.actionConnect(['b', 'd']).disabled(graph);
      assert.strictEqual(disabledBD, 'restriction', 'extra connection TO-VIA d');
      const disabledBE = Rapid.actionConnect(['b', 'e']).disabled(graph);
      assert.strictEqual(disabledBE, 'restriction', 'extra connection TO-VIA e');

      const disabledCE = Rapid.actionConnect(['c', 'e']).disabled(graph);
      assert.strictEqual(disabledCE, 'restriction', 'extra connection VIA-VIA');

      const disabledFC = Rapid.actionConnect(['f', 'c']).disabled(graph);
      assert.strictEqual(disabledFC, 'restriction', 'extra connection FROM-VIA c');
      const disabledFD = Rapid.actionConnect(['f', 'd']).disabled(graph);
      assert.strictEqual(disabledFD, 'restriction', 'extra connection FROM-VIA d');
      const disabledGE = Rapid.actionConnect(['g', 'e']).disabled(graph);
      assert.strictEqual(disabledGE, 'restriction', 'extra connection FROM-VIA e');
    });


    it('returns \'restriction\' when connecting would destroy a way in a via-node restriction', () => {
      //
      //  a --- b      r1:  `no_right_turn`
      //        |            FROM '-'
      //        |            VIA  'b'
      //        c            TO   '|'
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_right_turn' }, members: [
          { id: '-', type: 'way', role: 'from' },
          { id: 'b', type: 'node', role: 'via' },
          { id: '|', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      const disabledAB = Rapid.actionConnect(['a', 'b']).disabled(graph);
      assert.strictEqual(disabledAB, 'restriction', 'destroy FROM');
      const disabledBC = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.strictEqual(disabledBC, 'restriction', 'destroy TO');
    });


    it('returns \'restriction\' when connecting would destroy a way in via-way restriction', () => {
      //
      //  a --- b      r1:  `no_u_turn`
      //        |            FROM '='
      //        |            VIA  '|'
      //  d === c            TO   '-'
      //
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a'}),
        new Rapid.OsmNode(context, {id: 'b'}),
        new Rapid.OsmNode(context, {id: 'c'}),
        new Rapid.OsmNode(context, {id: 'd'}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '|', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r1', tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [
          { id: '=', type: 'way', role: 'from' },
          { id: '|', type: 'way', role: 'via' },
          { id: '-', type: 'way', role: 'to' }
        ]})
      ]);
      const graph = new Rapid.Graph(base);

      const disabledAB = Rapid.actionConnect(['a', 'b']).disabled(graph);
      assert.strictEqual(disabledAB, 'restriction', 'destroy TO');
      const disabledBC = Rapid.actionConnect(['b', 'c']).disabled(graph);
      assert.strictEqual(disabledBC, 'restriction', 'destroy VIA');
      const disabledCD = Rapid.actionConnect(['c', 'd']).disabled(graph);
      assert.strictEqual(disabledCD, 'restriction', 'destroy FROM');
    });

  });
});
