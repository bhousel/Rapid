import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionReverse', () => {
  const context = new Rapid.MockContext();

  it('reverses the order of nodes in the way', () => {
    const node1 = new Rapid.OsmNode(context);
    const node2 = new Rapid.OsmNode(context);
    const way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id] });
    const graph = new Rapid.Graph([node1, node2, way]);
    const result = Rapid.actionReverse(way.id)(graph);
    assert.deepEqual(result.entity(way.id).nodes, [node2.id, node1.id]);
  });

  it('preserves non-directional tags', () => {
    const way = new Rapid.OsmWay(context, { tags: { 'highway': 'residential' } });
    const graph = new Rapid.Graph([way]);
    const result = Rapid.actionReverse(way.id)(graph);
    assert.deepEqual(result.entity(way.id).tags, { 'highway': 'residential' });
  });


  describe('reverses directional tags on nodes', () => {
    it('reverses relative directions', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'forward' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': 'backward' });
    });

    it('reverses relative directions for arbitrary direction tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'traffic_sign:direction': 'forward' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'traffic_sign:direction': 'backward' });
    });

    it('reverses absolute directions, cardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'E' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': 'W' });
    });

    it('reverses absolute directions, intercardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'SE' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': 'NW' });
    });

    it('reverses absolute directions, secondary intercardinal compass points', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'NNE' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': 'SSW' });
    });

    it('reverses absolute directions, 0 degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '0' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': '180' });
    });

    it('reverses absolute directions, positive degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '85.5' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': '265.5' });
    });

    it('reverses absolute directions, positive degrees > 360', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '385.5' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': '205.5' });
    });

    it('reverses absolute directions, negative degrees', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': '-85.5' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': '94.5' });
    });

    it('preserves non-directional tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'traffic_sign': 'maxspeed' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'traffic_sign': 'maxspeed' });
    });

    it('preserves non-reversible direction tags', () => {
      const node1 = new Rapid.OsmNode(context, { tags: { 'direction': 'both' } });
      const graph = new Rapid.Graph([node1]);
      const result = Rapid.actionReverse(node1.id)(graph);
      assert.deepEqual(result.entity(node1.id).tags, { 'direction': 'both' });
    });
  });


  describe('reverses oneway', () => {
    it('preserves oneway tags', () => {
      const way = new Rapid.OsmWay(context, { tags: { 'oneway': 'yes' } });
      const graph = new Rapid.Graph([way]);
      const result = Rapid.actionReverse(way.id)(graph);
      assert.deepEqual(result.entity(way.id).tags, { 'oneway': 'yes' });
    });

    it('reverses oneway tags if reverseOneway: true is provided', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'yes', tags: { oneway: 'yes' } }),
        new Rapid.OsmWay(context, { id: 'no', tags: { oneway: 'no' } }),
        new Rapid.OsmWay(context, { id: '1', tags: { oneway: '1' } }),
        new Rapid.OsmWay(context, { id: '-1', tags: { oneway: '-1' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('yes', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('yes').tags, { 'oneway': '-1' }, 'yes');

      result = Rapid.actionReverse('no', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('no').tags, { 'oneway': 'no' }, 'no');

      result = Rapid.actionReverse('1', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('1').tags, { 'oneway': '-1' }, '1');

      result = Rapid.actionReverse('-1', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('-1').tags, { 'oneway': 'yes' }, '-1');
    });

    it('ignores other oneway tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'alternating', tags: { oneway: 'alternating' } }),
        new Rapid.OsmWay(context, { id: 'reversible', tags: { oneway: 'reversible' } }),
        new Rapid.OsmWay(context, { id: 'dummy', tags: { oneway: 'dummy' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('alternating', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('alternating').tags, { 'oneway': 'alternating' }, 'alternating');

      result = Rapid.actionReverse('reversible', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('reversible').tags, { 'oneway': 'reversible' }, 'reversible');

      result = Rapid.actionReverse('dummy', { reverseOneway: true })(result);
      assert.deepEqual(result.entity('dummy').tags, { 'oneway': 'dummy' }, 'dummy');
    });
  });


  describe('reverses incline', () => {
    it('transforms incline=up ⟺ incline=down', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { 'incline': 'up' } });
      const graph = new Rapid.Graph([w1]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('w1').tags, { 'incline': 'down' });

      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('w1').tags, { 'incline': 'up' });
    });

    it('negates numeric-valued incline tags', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { 'incline': '5%' } });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', tags: { 'incline': '.8°' } });
      const graph = new Rapid.Graph([w1, w2]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('w1').tags, { 'incline': '-5%' });

      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('w1').tags, { 'incline': '5%' });

      result = Rapid.actionReverse('w2')(result);
      assert.deepEqual(result.entity('w2').tags, { 'incline': '-.8°' });
    });
  });


  describe('reverses directional keys on ways', () => {
    it('transforms *:right=* ⟺ *:left=*', () => {
      const way = new Rapid.OsmWay(context, { tags: { 'cycleway:right': 'lane' } });
      const graph = new Rapid.Graph([way]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'cycleway:left': 'lane' });

      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'cycleway:right': 'lane' });
    });

    it('transforms *:right:*=* ⟺ *:left:*=*', () => {
      const way = new Rapid.OsmWay(context, { tags: { 'cycleway:right:surface': 'paved' } });
      const graph = new Rapid.Graph([way]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'cycleway:left:surface': 'paved' });

      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'cycleway:right:surface': 'paved' });
    });

    it('transforms *:forward=* ⟺ *:backward=*', () => {
      const way = new Rapid.OsmWay(context, { tags: { 'maxspeed:forward': '25' } });
      const graph = new Rapid.Graph([way]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'maxspeed:backward': '25' });

      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'maxspeed:forward': '25' });
    });

    it('transforms multiple directional tags', () => {
      const way = new Rapid.OsmWay(context, { tags: { 'maxspeed:forward': '25', 'maxspeed:backward': '30' } });
      const graph = new Rapid.Graph([way]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse(way.id)(result);
      assert.deepEqual(result.entity(way.id).tags, { 'maxspeed:backward': '25', 'maxspeed:forward': '30' });
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

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('inclineU')(result);
      assert.deepEqual(result.entity('inclineU').tags, { incline: 'down' }, 'inclineU');

      result = Rapid.actionReverse('directionU')(result);
      assert.deepEqual(result.entity('directionU').tags, { direction: 'down' }, 'directionU');

      result = Rapid.actionReverse('inclineD')(result);
      assert.deepEqual(result.entity('inclineD').tags, { incline: 'up' }, 'inclineD');

      result = Rapid.actionReverse('directionD')(result);
      assert.deepEqual(result.entity('directionD').tags, { direction: 'up' }, 'directionD');
    });

    it('skips *=up ⟺ *=down for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'up' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'up' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'down' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'down' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('name')(result);
      assert.deepEqual(result.entity('name').tags, { name: 'up' }, 'name');

      result = Rapid.actionReverse('note')(result);
      assert.deepEqual(result.entity('note').tags, { note: 'up' }, 'note');

      result = Rapid.actionReverse('ref')(result);
      assert.deepEqual(result.entity('ref').tags, { ref: 'down' }, 'ref');

      result = Rapid.actionReverse('description')(result);
      assert.deepEqual(result.entity('description').tags, { description: 'down' }, 'description');
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

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('conveyingF')(result);
      assert.deepEqual(result.entity('conveyingF').tags, { conveying: 'backward' }, 'conveyingF');
      result = Rapid.actionReverse('directionF')(result);
      assert.deepEqual(result.entity('directionF').tags, { direction: 'backward' }, 'directionF');
      result = Rapid.actionReverse('priorityF')(result);
      assert.deepEqual(result.entity('priorityF').tags, { priority: 'backward' }, 'priorityF');
      result = Rapid.actionReverse('trolley_wireF')(result);
      assert.deepEqual(result.entity('trolley_wireF').tags, { trolley_wire: 'backward' }, 'trolley_wireF');

      result = Rapid.actionReverse('conveyingB')(result);
      assert.deepEqual(result.entity('conveyingB').tags, { conveying: 'forward' }, 'conveyingB');
      result = Rapid.actionReverse('directionB')(result);
      assert.deepEqual(result.entity('directionB').tags, { direction: 'forward' }, 'directionB');
      result = Rapid.actionReverse('priorityB')(result);
      assert.deepEqual(result.entity('priorityB').tags, { priority: 'forward' }, 'priorityB');
      result = Rapid.actionReverse('trolley_wireB')(result);
      assert.deepEqual(result.entity('trolley_wireB').tags, { trolley_wire: 'forward' }, 'trolley_wireB');
    });

    it('drops "s" from forwards/backwards when reversing', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'conveyingF', tags: { conveying: 'forwards' } }),
        new Rapid.OsmWay(context, { id: 'conveyingB', tags: { conveying: 'backwards' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('conveyingF')(result);
      assert.deepEqual(result.entity('conveyingF').tags, { conveying: 'backward' }, 'conveyingF');
      result = Rapid.actionReverse('conveyingB')(result);
      assert.deepEqual(result.entity('conveyingB').tags, { conveying: 'forward' }, 'conveyingB');
    });

    it('skips *=forward ⟺ *=backward for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'forward' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'forwards' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'backward' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'backwards' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('name')(result);
      assert.deepEqual(result.entity('name').tags, { name: 'forward' }, 'name');
      result = Rapid.actionReverse('note')(result);
      assert.deepEqual(result.entity('note').tags, { note: 'forwards' }, 'note');
      result = Rapid.actionReverse('ref')(result);
      assert.deepEqual(result.entity('ref').tags, { ref: 'backward' }, 'ref');
      result = Rapid.actionReverse('description')(result);
      assert.deepEqual(result.entity('description').tags, { description: 'backwards' }, 'description');
    });

    it('transforms *=right ⟺ *=left', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'sidewalkR', tags: { sidewalk: 'right' } }),
        new Rapid.OsmWay(context, { id: 'sidewalkL', tags: { sidewalk: 'left' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('sidewalkR')(result);
      assert.deepEqual(result.entity('sidewalkR').tags, { sidewalk: 'left' }, 'sidewalkR');
      result = Rapid.actionReverse('sidewalkL')(result);
      assert.deepEqual(result.entity('sidewalkL').tags, { sidewalk: 'right' }, 'sidewalkL');
    });

    it('skips *=right ⟺ *=left for ignored tags', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'name', tags: { name: 'right' } }),
        new Rapid.OsmWay(context, { id: 'note', tags: { note: 'right' } }),
        new Rapid.OsmWay(context, { id: 'ref', tags: { ref: 'left' } }),
        new Rapid.OsmWay(context, { id: 'description', tags: { description: 'left' } })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('name')(result);
      assert.deepEqual(result.entity('name').tags, { name: 'right' }, 'name');
      result = Rapid.actionReverse('note')(result);
      assert.deepEqual(result.entity('note').tags, { note: 'right' }, 'note');
      result = Rapid.actionReverse('ref')(result);
      assert.deepEqual(result.entity('ref').tags, { ref: 'left' }, 'ref');
      result = Rapid.actionReverse('description')(result);
      assert.deepEqual(result.entity('description').tags, { description: 'left' }, 'description');
    });
  });


  describe('reverses relation roles', () => {
    it('transforms role=forward ⟺ role=backward in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'w1', nodes: [], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'forward', members: [{ type: 'way', id: 'w1', role: 'forward' }] }),
        new Rapid.OsmRelation(context, { id: 'backward', members: [{ type: 'way', id: 'w1', role: 'backward' }] })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('forward').members[0].role, 'backward', 'forward');
      assert.deepEqual(result.entity('backward').members[0].role, 'forward', 'backward');
    });

    it('drops "s" from forwards/backwards when reversing', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'w1', nodes: [], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'forwards', members: [{ type: 'way', id: 'w1', role: 'forwards' }] }),
        new Rapid.OsmRelation(context, { id: 'backwards', members: [{ type: 'way', id: 'w1', role: 'backwards' }] })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('forwards').members[0].role, 'backward', 'forwards');
      assert.deepEqual(result.entity('backwards').members[0].role, 'forward', 'backwards');
    });

    it('doesn\'t transform role=north ⟺ role=south in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'w1', nodes: [], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'north', members: [{ type: 'way', id: 'w1', role: 'north' }] }),
        new Rapid.OsmRelation(context, { id: 'south', members: [{ type: 'way', id: 'w1', role: 'south' }] })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('north').members[0].role, 'north', 'north');
      assert.deepEqual(result.entity('south').members[0].role, 'south', 'south');
    });

    it('doesn\'t transform role=east ⟺ role=west in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'w1', nodes: [], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'east', members: [{ type: 'way', id: 'w1', role: 'east' }] }),
        new Rapid.OsmRelation(context, { id: 'west', members: [{ type: 'way', id: 'w1', role: 'west' }] })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('east').members[0].role, 'east', 'east');
      assert.deepEqual(result.entity('west').members[0].role, 'west', 'west');
    });

    it('ignores directionless roles in member relations', () => {
      const graph = new Rapid.Graph([
        new Rapid.OsmWay(context, { id: 'w1', nodes: [], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, { id: 'ignore', members: [{ type: 'way', id: 'w1', role: 'ignore' }] }),
        new Rapid.OsmRelation(context, { id: 'empty', members: [{ type: 'way', id: 'w1', role: '' }] })
      ]);

      let result = new Rapid.Graph(graph);
      result = Rapid.actionReverse('w1')(result);
      assert.deepEqual(result.entity('ignore').members[0].role, 'ignore', 'ignore');
      assert.deepEqual(result.entity('empty').members[0].role, '', 'empty');
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

    it('reverses the direction of a forward facing traffic_signals on the way', () => {  // iD#4595
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
