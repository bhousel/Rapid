import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionReverse', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  it('reverses the order of nodes in the way', () => {
    const node1 = new Rapid.OsmNode(context);
    const node2 = new Rapid.OsmNode(context);
    const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id] });
    const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, way]));
    assert.deepEqual(graph.entity(way.id).nodes, [node2.id, node1.id]);
  });


  it('preserves non-directional tags', () => {
    var way = new Rapid.OsmWay(context, { tags: { 'highway': 'residential' } });
    var graph = new Rapid.Graph([way]);

    graph = Rapid.actionReverse(way.id)(graph);
    assert.deepEqual(graph.entity(way.id).tags, { 'highway': 'residential' });
  });

  describe('reverses directional tags on nodes', () => {
    it('reverses relative directions', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'forward' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': 'backward' });
    });


    it('reverses relative directions for arbitrary direction tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:direction': 'forward' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'traffic_sign:direction': 'backward' });
    });


    it('reverses absolute directions, cardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'E' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': 'W' });
    });


    it('reverses absolute directions, intercardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'SE' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': 'NW' });
    });


    it('reverses absolute directions, secondary intercardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'NNE' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': 'SSW' });
    });


    it('reverses absolute directions, 0 degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '0' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': '180' });
    });


    it('reverses absolute directions, positive degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '85.5' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': '265.5' });
    });


    it('reverses absolute directions, positive degrees > 360', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '385.5' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': '205.5' });
    });


    it('reverses absolute directions, negative degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '-85.5' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': '94.5' });
    });


    it('preserves non-directional tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'traffic_sign': 'maxspeed' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'traffic_sign': 'maxspeed' });
    });


    it('preserves non-reversible direction tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'both' } });
      const graph = Rapid.actionReverse(node1.id)(new Rapid.Graph([node1]));
      assert.deepEqual(graph.entity(node1.id).tags, { 'direction': 'both' });
    });
  });

  describe('reverses oneway', () => {
    it('preserves oneway tags', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'oneway': 'yes' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'oneway': 'yes' });
    });


    it('reverses oneway tags if reverseOneway: true is provided', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'yes', tags: { oneway: 'yes' } }),
        new Rapid.OsmWay(context, { id: 'no', tags: { oneway: 'no' } }),
        new Rapid.OsmWay(context, { id: '1', tags: { oneway: '1' } }),
        new Rapid.OsmWay(context, { id: '-1', tags: { oneway: '-1' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('yes', { reverseOneway: true })(graph)
        .entity('yes').tags, { 'oneway': '-1' }, 'yes');
      assert.deepEqual(Rapid.actionReverse('no', { reverseOneway: true })(graph)
        .entity('no').tags, { 'oneway': 'no' }, 'no');
      assert.deepEqual(Rapid.actionReverse('1', { reverseOneway: true })(graph)
        .entity('1').tags, { 'oneway': '-1' }, '1');
      assert.deepEqual(Rapid.actionReverse('-1', { reverseOneway: true })(graph)
        .entity('-1').tags, { 'oneway': 'yes' }, '-1');
    });


    it('ignores other oneway tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'alternating', tags: { oneway: 'alternating' } }),
        new Rapid.OsmWay(context, { id: 'reversible', tags: { oneway: 'reversible' } }),
        new Rapid.OsmWay(context, { id: 'dummy', tags: { oneway: 'dummy' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('alternating', { reverseOneway: true })(graph)
        .entity('alternating').tags, { 'oneway': 'alternating' }, 'alternating');
      assert.deepEqual(Rapid.actionReverse('reversible', { reverseOneway: true })(graph)
        .entity('reversible').tags, { 'oneway': 'reversible' }, 'reversible');
      assert.deepEqual(Rapid.actionReverse('dummy', { reverseOneway: true })(graph)
        .entity('dummy').tags, { 'oneway': 'dummy' }, 'dummy');
    });
  });


  describe('reverses incline', () => {
    it('transforms incline=up ⟺ incline=down', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'incline': 'up' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'incline': 'down' });

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'incline': 'up' });
    });


    it('negates numeric-valued incline tags', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'incline': '5%' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'incline': '-5%' });

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'incline': '5%' });

      way = new Rapid.OsmWay(context, { tags: { 'incline': '.8°' } });
      graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'incline': '-.8°' });
    });
  });


  describe('reverses directional keys on ways', () => {
    it('transforms *:right=* ⟺ *:left=*', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'cycleway:right': 'lane' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'cycleway:left': 'lane' });

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'cycleway:right': 'lane' });
    });


    it('transforms *:right:*=* ⟺ *:left:*=*', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'cycleway:right:surface': 'paved' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'cycleway:left:surface': 'paved' });

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'cycleway:right:surface': 'paved' });
    });


    it('transforms *:forward=* ⟺ *:backward=*', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'maxspeed:forward': '25' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'maxspeed:backward': '25' });

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'maxspeed:forward': '25' });
    });


    it('transforms multiple directional tags', () => {
      var way = new Rapid.OsmWay(context, { tags: { 'maxspeed:forward': '25', 'maxspeed:backward': '30' } });
      var graph = new Rapid.Graph([way]);

      graph = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(graph.entity(way.id).tags, { 'maxspeed:backward': '25', 'maxspeed:forward': '30' });
    });
  });


  describe('reverses directional values on ways', () => {
    it('transforms *=up ⟺ *=down', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'inclineU', tags: { incline: 'up' } }),
        new Rapid.OsmWay(context, { id: 'directionU', tags: { direction: 'up' } }),
        new Rapid.OsmWay(context, { id: 'inclineD', tags: { incline: 'down' } }),
        new Rapid.OsmWay(context, { id: 'directionD', tags: { direction: 'down' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('inclineU')(graph)
        .entity('inclineU').tags, { incline: 'down' }, 'inclineU');
      assert.deepEqual(Rapid.actionReverse('directionU')(graph)
        .entity('directionU').tags, { direction: 'down' }, 'directionU');

      assert.deepEqual(Rapid.actionReverse('inclineD')(graph)
        .entity('inclineD').tags, { incline: 'up' }, 'inclineD');
      assert.deepEqual(Rapid.actionReverse('directionD')(graph)
        .entity('directionD').tags, { direction: 'up' }, 'directionD');
    });


    it('skips *=up ⟺ *=down for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'up' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'up' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'down' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'down' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('name')(graph)
        .entity('name').tags, { name: 'up' }, 'name');
      assert.deepEqual(Rapid.actionReverse('note')(graph)
        .entity('note').tags, { note: 'up' }, 'note');
      assert.deepEqual(Rapid.actionReverse('ref')(graph)
        .entity('ref').tags, { ref: 'down' }, 'ref');
      assert.deepEqual(Rapid.actionReverse('description')(graph)
        .entity('description').tags, { description: 'down' }, 'description');
    });


    it('transforms *=forward ⟺ *=backward', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'conveyingF', tags: { conveying: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'directionF', tags: { direction: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'priorityF', tags: { priority: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'trolley_wireF', tags: { trolley_wire: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'conveyingB', tags: { conveying: 'backward' } }),
        new Rapid.OsmWay(context, { id: 'directionB', tags: { direction: 'backward' } }),
        new Rapid.OsmWay(context, { id: 'priorityB', tags: { priority: 'backward' } }),
        new Rapid.OsmWay(context, { id: 'trolley_wireB', tags: { trolley_wire: 'backward' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('conveyingF')(graph)
        .entity('conveyingF').tags, { conveying: 'backward' }, 'conveyingF');
      assert.deepEqual(Rapid.actionReverse('directionF')(graph)
        .entity('directionF').tags, { direction: 'backward' }, 'directionF');
      assert.deepEqual(Rapid.actionReverse('priorityF')(graph)
        .entity('priorityF').tags, { priority: 'backward' }, 'priorityF');
      assert.deepEqual(Rapid.actionReverse('trolley_wireF')(graph)
        .entity('trolley_wireF').tags, { trolley_wire: 'backward' }, 'trolley_wireF');

      assert.deepEqual(Rapid.actionReverse('conveyingB')(graph)
        .entity('conveyingB').tags, { conveying: 'forward' }, 'conveyingB');
      assert.deepEqual(Rapid.actionReverse('directionB')(graph)
        .entity('directionB').tags, { direction: 'forward' }, 'directionB');
      assert.deepEqual(Rapid.actionReverse('priorityB')(graph)
        .entity('priorityB').tags, { priority: 'forward' }, 'priorityB');
      assert.deepEqual(Rapid.actionReverse('trolley_wireB')(graph)
        .entity('trolley_wireB').tags, { trolley_wire: 'forward' }, 'trolley_wireB');
    });


    it('drops "s" from forwards/backwards when reversing', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'conveyingF', tags: { conveying: 'forwards' } }),
        new Rapid.OsmWay(context, { id: 'conveyingB', tags: { conveying: 'backwards' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('conveyingF')(graph)
        .entity('conveyingF').tags, { conveying: 'backward' }, 'conveyingF');
      assert.deepEqual(Rapid.actionReverse('conveyingB')(graph)
        .entity('conveyingB').tags, { conveying: 'forward' }, 'conveyingB');
    });


    it('skips *=forward ⟺ *=backward for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'forwards' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'backward' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'backwards' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('name')(graph)
        .entity('name').tags, { name: 'forward' }, 'name');
      assert.deepEqual(Rapid.actionReverse('note')(graph)
        .entity('note').tags, { note: 'forwards' }, 'note');
      assert.deepEqual(Rapid.actionReverse('ref')(graph)
        .entity('ref').tags, { ref: 'backward' }, 'ref');
      assert.deepEqual(Rapid.actionReverse('description')(graph)
        .entity('description').tags, { description: 'backwards' }, 'description');
    });


    it('transforms *=right ⟺ *=left', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'sidewalkR', tags: { sidewalk: 'right' } }),
        new Rapid.OsmWay(context, { id: 'sidewalkL', tags: { sidewalk: 'left' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('sidewalkR')(graph)
        .entity('sidewalkR').tags, { sidewalk: 'left' }, 'sidewalkR');
      assert.deepEqual(Rapid.actionReverse('sidewalkL')(graph)
        .entity('sidewalkL').tags, { sidewalk: 'right' }, 'sidewalkL');
    });


    it('skips *=right ⟺ *=left for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'right' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'right' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'left' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'left' } })
      ]);

      assert.deepEqual(Rapid.actionReverse('name')(graph)
        .entity('name').tags, { name: 'right' }, 'name');
      assert.deepEqual(Rapid.actionReverse('note')(graph)
        .entity('note').tags, { note: 'right' }, 'note');
      assert.deepEqual(Rapid.actionReverse('ref')(graph)
        .entity('ref').tags, { ref: 'left' }, 'ref');
      assert.deepEqual(Rapid.actionReverse('description')(graph)
        .entity('description').tags, { description: 'left' }, 'description');
    });
  });


  describe('reverses relation roles', () => {
    it('transforms role=forward ⟺ role=backward in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'n1' }),
        new Rapid.OsmNode(context, { id: 'n2' }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'forward', members: [{ type: 'way', id: 'w1', role: 'forward' }] }),
        new Rapid.OsmRelation(context, { id: 'backward', members: [{ type: 'way', id: 'w1', role: 'backward' }] })
      ]);

      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('forward').members[0].role, 'backward', 'forward');
      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('backward').members[0].role, 'forward', 'backward');
    });


    it('drops "s" from forwards/backwards when reversing', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'n1' }),
        new Rapid.OsmNode(context, { id: 'n2' }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'forwards', members: [{ type: 'way', id: 'w1', role: 'forwards' }] }),
        new Rapid.OsmRelation(context, { id: 'backwards', members: [{ type: 'way', id: 'w1', role: 'backwards' }] })
      ]);

      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('forwards').members[0].role, 'backward', 'forwards');
      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('backwards').members[0].role, 'forward', 'backwards');
    });


    it('doesn\'t transform role=north ⟺ role=south in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'n1' }),
        new Rapid.OsmNode(context, { id: 'n2' }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'north', members: [{ type: 'way', id: 'w1', role: 'north' }] }),
        new Rapid.OsmRelation(context, { id: 'south', members: [{ type: 'way', id: 'w1', role: 'south' }] })
      ]);

      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('north').members[0].role, 'north', 'north');
      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('south').members[0].role, 'south', 'south');
    });


    it('doesn\'t transform role=east ⟺ role=west in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'n1' }),
        new Rapid.OsmNode(context, { id: 'n2' }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'east', members: [{ type: 'way', id: 'w1', role: 'east' }] }),
        new Rapid.OsmRelation(context, { id: 'west', members: [{ type: 'way', id: 'w1', role: 'west' }] })
      ]);

      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('east').members[0].role, 'east', 'east');
      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('west').members[0].role, 'west', 'west');
    });


    it('ignores directionless roles in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmNode(context, { id: 'n1' }),
        new Rapid.OsmNode(context, { id: 'n2' }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'ignore', members: [{ type: 'way', id: 'w1', role: 'ignore' }] }),
        new Rapid.OsmRelation(context, { id: 'empty', members: [{ type: 'way', id: 'w1', role: '' }] })
      ]);

      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('ignore').members[0].role, 'ignore', 'ignore');
      assert.deepEqual(Rapid.actionReverse('w1')(graph)
        .entity('empty').members[0].role, '', 'empty');
    });
  });


  describe('reverses directional values on childnodes', () => {
    it('reverses the direction of a forward facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'direction': 'forward', 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags.direction, 'backward');
    });


    it('reverses the direction of a backward facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'direction': 'backward', 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags.direction, 'forward');
    });


    it('reverses the direction of a left facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'direction': 'left', 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags.direction, 'right');
    });


    it('reverses the direction of a right facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'direction': 'right', 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags.direction, 'left');
    });


    it('does not assign a direction to a directionless stop sign on the way during a reverse', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.equal(target.tags.direction, undefined);
    });


    it('ignores directions other than forward or backward on attached stop sign during a reverse', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'direction': 'empty', 'highway': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags.direction, 'empty');
    });
  });


  describe('reverses directional keys on childnodes', () => {
    it('reverses the direction of a forward facing traffic sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:forward': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_sign:backward'], 'stop');
    });


    it('reverses the direction of a backward facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:backward': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_sign:forward'], 'stop');
    });


    it('reverses the direction of a left facing traffic sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:left': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_sign:right'], 'stop');
    });


    it('reverses the direction of a right facing stop sign on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:right': 'stop' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_sign:left'], 'stop');
    });

    // For issue #4595
    it('reverses the direction of a forward facing traffic_signals on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_signals:direction': 'forward', 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_signals:direction'], 'backward');
    });


    it('reverses the direction of a backward facing traffic_signals on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_signals:direction': 'backward', 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_signals:direction'], 'forward');
    });


    it('reverses the direction of a left facing traffic_signals on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_signals:direction': 'left', 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_signals:direction'], 'right');
    });


    it('reverses the direction of a right facing traffic_signals on the way', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_signals:direction': 'right', 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_signals:direction'], 'left');
    });


    it('does not assign a direction to a directionless traffic_signals on the way during a reverse', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.equal(target.tags['traffic_signals:direction'], undefined);
    });


    it('ignores directions other than forward or backward on attached traffic_signals during a reverse', () => {
      const node1 = new Rapid.OsmNode(context);
      const node2 = new Rapid.OsmNode(context, { tags: { 'traffic_signals:direction': 'empty', 'highway': 'traffic_signals' } });
      const node3 = new Rapid.OsmNode(context);
      const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id, node3.id] });
      const graph = Rapid.actionReverse(way.id)(new Rapid.Graph([node1, node2, node3, way]));
      const target = graph.entity(node2.id);
      assert.deepEqual(target.tags['traffic_signals:direction'], 'empty');
    });
  });
});
