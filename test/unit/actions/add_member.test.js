import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('actionAddMember', () => {
  const context = new Rapid.MockContext();

  it('adds an member to a relation at the specified index', () => {
    const r = new Rapid.OsmRelation(context, {members: [{id: '1'}, {id: '3'}]});
    const graph = new Rapid.Graph(context, [r]);
    const result = Rapid.actionAddMember(r.id, {id: '2'}, 1)(graph);
    assert.ok(result instanceof Rapid.Graph);
    assert.deepEqual(result.entity(r.id).members, [{id: '1'}, {id: '2'}, {id: '3'}]);
  });

  describe('inserts way members at a sensible index', () => {
    function members(graph) {
      return graph.entity('r').members.map(m => m.id);
    }

    it('handles incomplete relations', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b', 'c']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c','d']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '~', type: 'way'},
          {id: '-', type: 'way'}
        ]})
      ]);

      const result = Rapid.actionAddMember('r', {id: '=', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['~', '-', '=']);
    });

    it('adds the member to a relation with no members', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmRelation(context, {id: 'r'})
      ]);

      const result = Rapid.actionAddMember('r', {id: '-', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-']);
    });

    it('appends the member if the ways are not connecting', () => {
      // Before:  a ---> b
      // After:   a ---> b .. c ===> d
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '-', type: 'way'}
        ]})
      ]);

      const result = Rapid.actionAddMember('r', {id: '=', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-', '=']);
    });

    it('appends the member if the way connects at end', () => {
      // Before:   a ---> b
      // After:    a ---> b ===> c
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '-', type: 'way'}
        ]})
      ]);

      const result = Rapid.actionAddMember('r', {id: '=', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-', '=']);
    });

    it('inserts the member if the way connects at beginning', () => {
      // Before:          b ---> c ~~~> d
      // After:    a ===> b ---> c ~~~> d
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '-', type: 'way'},
          {id: '~', type: 'way'}
        ]})
      ]);

      const result = Rapid.actionAddMember('r', {id: '=', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['=', '-', '~']);
    });

    it('inserts the member if the way connects in middle', () => {
      // Before:  a ---> b  ..  c ~~~> d
      // After:   a ---> b ===> c ~~~> d
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '-', type: 'way'},
          {id: '~', type: 'way'}
        ]})
      ]);

      const result = Rapid.actionAddMember('r', {id: '=', type: 'way'})(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-', '=', '~']);
    });

    it('inserts the member multiple times if insertPair provided (middle)', () => {
      // Before:  a ---> b  ..  c ~~~> d <~~~ c  ..  b <--- a
      // After:   a ---> b ===> c ~~~> d <~~~ c <=== b <--- a
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '-', type: 'way'},
          {id: '~', type: 'way'},
          {id: '~', type: 'way'},
          {id: '-', type: 'way'}
        ]})
      ]);

      const member = { id: '=', type: 'way' };
      const insertPair = {
        originalID: '-',
        insertedID: '=',
        nodes: ['a','b','c']
      };
      const result = Rapid.actionAddMember('r', member, undefined, insertPair)(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-', '=', '~', '~', '=', '-']);
    });

    it('inserts the member multiple times if insertPair provided (beginning/end)', () => {
      // Before:         b <=== c ~~~> d <~~~ c ===> b
      // After:   a <--- b <=== c ~~~> d <~~~ c ===> b ---> a
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'd', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['b', 'a']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['c', 'b']}),
        new Rapid.OsmWay(context, {id: '~', nodes: ['c', 'd']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          {id: '=', type: 'way'},
          {id: '~', type: 'way'},
          {id: '~', type: 'way'},
          {id: '=', type: 'way'}
        ]})
      ]);

      const member = { id: '-', type: 'way' };
      const insertPair = {
        originalID: '=',
        insertedID: '-',
        nodes: ['c','b','a']
      };
      const result = Rapid.actionAddMember('r', member, undefined, insertPair)(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['-', '=', '~', '~', '=', '-']);
    });

    it('keeps stops and platforms ordered before node, way, relation (for PTv2 routes)', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, {id: 'a', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'b', loc: [0, 0]}),
        new Rapid.OsmNode(context, {id: 'c', loc: [0, 0]}),
        new Rapid.OsmWay(context, {id: '-', nodes: ['a', 'b']}),
        new Rapid.OsmWay(context, {id: '=', nodes: ['b', 'c']}),
        new Rapid.OsmRelation(context, {id: 'r', members: [
          { id: 'n1', type: 'node', role: 'stop' },
          { id: 'w1', type: 'way', role: 'platform' },
          { id: 'n2', type: 'node', role: 'stop_entry_only' },
          { id: 'w2', type: 'way', role: 'platform_entry_only' },
          { id: 'n3', type: 'node', role: 'stop_exit_only' },
          { id: 'w3', type: 'way', role: 'platform_exit_only' },
          { id: 'n10', type: 'node', role: 'forward' },
          { id: 'n11', type: 'node', role: 'forward' },
          { id: '-', type: 'way', role: 'forward' },
          { id: 'r1', type: 'relation', role: 'forward' },
          { id: 'n12', type: 'node', role: 'forward' }
        ]})
      ]);

      const result = Rapid.actionAddMember('r', { id: '=', type: 'way', role: 'forward' })(graph);
      assert.ok(result instanceof Rapid.Graph);
      assert.deepEqual(members(result), ['n1', 'w1', 'n2', 'w2', 'n3', 'w3', 'n10', 'n11', 'n12', '-', '=', 'r1']);
    });

  });
});
