import { after, before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('OsmWay', () => {
  const context = new Rapid.MockContext();
  let _savedAreaKeys;

  before(() => {
    _savedAreaKeys = Rapid.osmAreaKeys;
    Rapid.osmSetAreaKeys({ building: {} });
  });

  after(() => {
    Rapid.osmSetAreaKeys(_savedAreaKeys);
  });

  describe('constructor', () => {
    it('constructs an OsmWay from a context', () => {
      const a = new Rapid.OsmWay(context);
      assert.instanceOf(a, Rapid.OsmWay);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
    });

    it('generates an empty tags object, if unset', () => {
      const a = new Rapid.OsmWay(context);
      assert.deepEqual(a.props.tags, {});
    });

    it('generates an empty nodes Array, if unset', () => {
      const a = new Rapid.OsmWay(context);
      assert.deepEqual(a.props.nodes, []);
    });

    it('generates an id string, if unset', () => {
      const a = new Rapid.OsmWay(context);
      assert.match(a.props.id, /^w-/);
    });

    it('constructs an OsmWay from a context, with props', () => {
      const orig = { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } };
      const a = new Rapid.OsmWay(context, orig);
      assert.instanceOf(a, Rapid.OsmWay);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
    });

    it('constructs an OsmWay from another OsmWay', () => {
      const a = new Rapid.OsmWay(context);
      const b = new Rapid.OsmWay(a);
      assert.instanceOf(b, Rapid.OsmWay);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
    });

    it('constructs an OsmWay from another OsmWay, with props', () => {
      const orig = { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } };
      const a = new Rapid.OsmWay(context, orig);
      const update = { foo: 'bar' };
      const b = new Rapid.OsmWay(a, update);
      assert.instanceOf(b, Rapid.OsmWay);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });
  });

  describe('nodes', () => {
    it('gets nodes', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['n1', 'n2'] });
      assert.deepEqual(w.nodes, ['n1', 'n2']);
    });
  });

  describe('update', () => {
    it('returns a new OsmWay', () => {
      const a = new Rapid.OsmWay(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.OsmWay);
      assert.notStrictEqual(a, b);
    });
  });

  describe('updateSelf', () => {
    it('returns the same OsmWay', () => {
      const a = new Rapid.OsmWay(context);
      const b = a.updateSelf({});
      assert.instanceOf(b, Rapid.OsmWay);
      assert.strictEqual(a, b);
    });
  });

  describe('copy', () => {
    it('returns a new OsmWay', () => {
      const w = new Rapid.OsmWay(context, { id: 'w' });
      const result = w.copy(null, {});
      assert.instanceOf(result, Rapid.OsmWay);
      assert.notStrictEqual(w, result);
    });

    it('adds the new OsmWay to the memo object', () => {
      const w = new Rapid.OsmWay(context, { id: 'w' });
      const copies = {};
      const result = w.copy(null, copies);
      assert.hasAllKeys(copies, ['w']);
      assert.strictEqual(copies.w, result);
    });

    it('returns an existing copy in input object', () => {
      const w = new Rapid.OsmWay(context, { id: 'w' });
      const copies = {};
      const result1 = w.copy(null, copies);
      const result2 = w.copy(null, copies);
      assert.hasAllKeys(copies, ['w']);
      assert.strictEqual(result1, result2);
    });

    it('deep copies nodes', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b'] });
      const graph = new Rapid.Graph(context, [a, b, w]);
      const copies = {};
      w.copy(graph, copies);
      assert.hasAllKeys(copies, ['a', 'b', 'w']);

      const copya = copies.a;
      const copyb = copies.b;
      const copyw = copies.w;
      assert.instanceOf(copya, Rapid.OsmNode);
      assert.instanceOf(copyb, Rapid.OsmNode);
      assert.instanceOf(copyw, Rapid.OsmWay);

      // copies get new ids
      assert.notStrictEqual(copya.id, a.id);
      assert.notStrictEqual(copyb.id, b.id);
      assert.notStrictEqual(copyw.id, w.id);
      assert.deepEqual(copyw.nodes, [copya.id, copyb.id]);
    });

    it('creates only one copy of shared nodes', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'a'] });
      const graph = new Rapid.Graph(context, [a, w]);
      const copies = {};
      w.copy(graph, copies);
      assert.hasAllKeys(copies, ['a', 'w']);

      const copya = copies.a;
      const copyw = copies.w;

      // copies get new ids
      assert.notStrictEqual(copya.id, a.id);
      assert.notStrictEqual(copyw.id, w.id);
      assert.deepEqual(copyw.nodes, [copya.id, copya.id]);
    });
  });


  describe('first', () => {
    it('returns the first node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.strictEqual(w.first(), 'a');
    });
  });

  describe('last', () => {
    it('returns the last node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.strictEqual(w.last(), 'c');
    });
  });

  describe('contains', () => {
    it('returns true if the way contains the given node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.isTrue(w.contains('b'));
    });

    it('returns false if the way does not contain the given node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.isFalse(w.contains('d'));
    });
  });


  describe('affix', () => {
    it('returns \'prefix\' if the way starts with the given node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.strictEqual(w.affix('a'), 'prefix');
    });

    it('returns \'suffix\' if the way ends with the given node', () => {
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.strictEqual(w.affix('c'), 'suffix');
    });

    it('returns falsy if the way does not start or end with the given node', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['a', 'b', 'c'] });
      assert.isNotOk(w1.affix('b'));
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: [] });
      assert.isNotOk(w2.affix('b'));
    });
  });

  describe('extent', () => {
    it('returns the minimal Extent containing all member nodes', () => {
      const node1 = new Rapid.OsmNode(context, { loc: [0, 0] });
      const node2 = new Rapid.OsmNode(context, { loc: [5, 10] });
      let way = new Rapid.OsmWay(context, { nodes: [node1.id, node2.id] });
      const graph = new Rapid.Graph(context, [node1, node2, way]);
      const extent = way.extent(graph);
      assert.isOk(extent.equals(new Rapid.sdk.Extent([0, 0], [5, 10])));
    });
  });

  describe('intersects', () => {
    it('returns true for a way with a node within the given extent', () => {
      const node = new Rapid.OsmNode(context, {loc: [0, 0]});
      const way = new Rapid.OsmWay(context, {nodes: [node.id]});
      const graph = new Rapid.Graph(context, [node, way]);
      const result = way.intersects(new Rapid.sdk.Extent([-5, -5], [5, 5]), graph);
      assert.isTrue(result);
    });

    it('returns false for way with no nodes within the given extent', () => {
      const node = new Rapid.OsmNode(context, {loc: [6, 6]});
      const way = new Rapid.OsmWay(context, {nodes: [node.id]});
      const graph = new Rapid.Graph(context, [node, way]);
      const result = way.intersects(new Rapid.sdk.Extent([-5, -5], [5, 5]), graph);
      assert.isFalse(result);
    });
  });


  describe('isClosed', () => {
    it('returns false when the way contains no nodes', () => {
      const way = new Rapid.OsmWay(context);
      assert.isFalse(way.isClosed());
    });

    it('returns false when the way contains a single node', () => {
      const way = new Rapid.OsmWay(context, { nodes: 'a'.split('') });
      assert.isFalse(way.isClosed());
    });

    it('returns false when the way ends are not equal', () => {
      const way = new Rapid.OsmWay(context, { nodes: 'abc'.split('') });
      assert.isFalse(way.isClosed());
    });

    it('returns true when the way ends are equal', () => {
      const way = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.isTrue(way.isClosed());
    });

    it('returns true when the way contains two of the same node', () => {
      const way = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.isTrue(way.isClosed());
    });
  });


  describe('isConvex', () => {
    it('returns true for convex ways', () => {
      //    d -- e
      //    |     \
      //    |      a
      //    |     /
      //    c -- b
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0.0003, 0.0000] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [-0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0.0002, 0.0002] }),
        new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
      ]);
      assert.isTrue(graph.entity('w').isConvex(graph));
    });


    it('returns false for concave ways', () => {
      //    d -- e
      //    |   /
      //    |  a
      //    |   \
      //    c -- b
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0.0000, 0.0000] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [-0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0.0002, 0.0002] }),
        new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
      ]);
      assert.isFalse(graph.entity('w').isConvex(graph));
    });


    it('returns null for non-closed ways', () => {
      //    d -- e
      //    |
      //    |  a
      //    |   \
      //    c -- b
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0.0000, 0.0000] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [-0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0.0002, 0.0002] }),
        new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'd', 'e'] })
      ]);
      assert.isNull(graph.entity('w').isConvex(graph));
    });


    it('returns null for degenerate ways', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0.0000, 0.0000] }),
        new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'a'] })
      ]);
      assert.isNull(graph.entity('w').isConvex(graph));
    });
  });


  describe('layer', () => {
    it('returns 0 when the way has no tags', () => {
      const way = new Rapid.OsmWay(context);
      assert.strictEqual(way.layer(), 0);
    });

    it('returns 0 when the way has a non numeric layer tag', () => {
      let way = new Rapid.OsmWay(context, { tags: { layer: 'NaN' } });
      assert.strictEqual(way.layer(), 0);
      way = new Rapid.OsmWay(context, { tags: { layer: 'Infinity' } });
      assert.strictEqual(way.layer(), 0);
      way = new Rapid.OsmWay(context, { tags: { layer: 'Foo' } });
      assert.strictEqual(way.layer(), 0);
    });

    it('returns the layer when the way has an explicit layer tag', () => {
      let way = new Rapid.OsmWay(context, { tags: { layer: '2' } });
      assert.strictEqual(way.layer(), 2);
      way = new Rapid.OsmWay(context, { tags: { layer: '-5' } });
      assert.strictEqual(way.layer(), -5);
    });

    it('clamps the layer to within -10, 10', () => {
      let way = new Rapid.OsmWay(context, { tags: { layer: '12' } });
      assert.strictEqual(way.layer(), 10);
      way = new Rapid.OsmWay(context, { tags: { layer: '-15' } });
      assert.strictEqual(way.layer(), -10);
    });

    it('returns 1 for location=overground', () => {
      const way = new Rapid.OsmWay(context, { tags: { location: 'overground' } });
      assert.strictEqual(way.layer(), 1);
    });

    it('returns -1 for covered=yes', () => {
      const way = new Rapid.OsmWay(context, { tags: { covered: 'yes' } });
      assert.strictEqual(way.layer(), -1);
    });

    it('returns -1 for location=underground', () => {
      const way = new Rapid.OsmWay(context, { tags: { location: 'underground' } });
      assert.strictEqual(way.layer(), -1);
    });

    it('returns -10 for location=underwater', () => {
      const way = new Rapid.OsmWay(context, { tags: { location: 'underwater' } });
      assert.strictEqual(way.layer(), -10);
    });

    it('returns 10 for power lines', () => {
      let way = new Rapid.OsmWay(context, { tags: { power: 'line' } });
      assert.strictEqual(way.layer(), 10);
      way = new Rapid.OsmWay(context, { tags: { power: 'minor_line' } });
      assert.strictEqual(way.layer(), 10);
    });

    it('returns 10 for aerialways', () => {
      const way = new Rapid.OsmWay(context, { tags: { aerialway: 'cable_car' } });
      assert.strictEqual(way.layer(), 10);
    });

    it('returns 1 for bridges', () => {
      const way = new Rapid.OsmWay(context, { tags: { bridge: 'yes' } });
      assert.strictEqual(way.layer(), 1);
    });

    it('returns -1 for cuttings', () => {
      const way = new Rapid.OsmWay(context, { tags: { cutting: 'yes' } });
      assert.strictEqual(way.layer(), -1);
    });

    it('returns -1 for tunnels', () => {
      const way = new Rapid.OsmWay(context, { tags: { tunnel: 'yes' } });
      assert.strictEqual(way.layer(), -1);
    });

    it('returns -1 for waterways', () => {
      const way = new Rapid.OsmWay(context, { tags: { waterway: 'stream' } });
      assert.strictEqual(way.layer(), -1);
    });

    it('returns -10 for pipelines', () => {
      const way = new Rapid.OsmWay(context, { tags: { man_made: 'pipeline' } });
      assert.strictEqual(way.layer(), -10);
    });

    it('returns -10 for boundaries', () => {
      const way = new Rapid.OsmWay(context, { tags: { boundary: 'administrative' } });
      assert.strictEqual(way.layer(), -10);
    });
  });


  describe('impliedLineWidthMeters', () => {
    it('returns null when the way has no tags', () => {
      const w = new Rapid.OsmWay(context);
      assert.isNull(w.impliedLineWidthMeters());
    });

    it('returns a value for waterways', () => {
      const w = new Rapid.OsmWay(context, { tags: { waterway: 'river' } });
      assert.strictEqual(w.impliedLineWidthMeters(), 50);
    });

    it('returns a value for railways', () => {
      const w = new Rapid.OsmWay(context, { tags: { railway: 'rail' } });
      assert.strictEqual(w.impliedLineWidthMeters(), 2.5);
    });

    it('returns a value for highways tagged as oneway', () => {
      const w = new Rapid.OsmWay(context, { tags: { highway: 'primary', oneway: 'yes' } });
      assert.strictEqual(w.impliedLineWidthMeters(), 4);
    });

    it('returns a value for highways tagged as bidirectional', () => {
      const w = new Rapid.OsmWay(context, { tags: { highway: 'primary', oneway: 'no' } });
      assert.strictEqual(w.impliedLineWidthMeters(), 8);
    });

    it('returns a value for highways with lane tag', () => {
      const w = new Rapid.OsmWay(context, { tags: { highway: 'primary', lanes: '3' } });
      assert.strictEqual(w.impliedLineWidthMeters(), 12);
    });
  });


  describe('isOneWay', () => {
    it('returns false when the way has no tags', () => {
      const way = new Rapid.OsmWay(context);
      assert.isFalse(way.isOneWay());
    });

    it('returns false when the way has tag oneway=no', () => {
      let way = new Rapid.OsmWay(context, { tags: { oneway: 'no' } });
      assert.isFalse(way.isOneWay(), 'oneway no');
      way = new Rapid.OsmWay(context, { tags: { oneway: '0' } });
      assert.isFalse(way.isOneWay(), 'oneway 0');
    });

    it('returns true when the way has tag oneway=yes', () => {
      let way = new Rapid.OsmWay(context, { tags: { oneway: 'yes' } });
      assert.isTrue(way.isOneWay(), 'oneway yes');
      way = new Rapid.OsmWay(context, { tags: { oneway: '1' } });
      assert.isTrue(way.isOneWay(), 'oneway 1');
      way = new Rapid.OsmWay(context, { tags: { oneway: '-1' } });
      assert.isTrue(way.isOneWay(), 'oneway -1');
    });

    it('returns true when the way has tag oneway=reversible', () => {
      const way = new Rapid.OsmWay(context, { tags: { oneway: 'reversible' } });
      assert.isTrue(way.isOneWay(), 'oneway reversible');
    });

    it('returns true when the way has tag oneway=alternating', () => {
      const way = new Rapid.OsmWay(context, { tags: { oneway: 'alternating' } });
      assert.isTrue(way.isOneWay(), 'oneway alternating');
    });

    it('returns true when the way has implied oneway tag (waterway=river, waterway=stream, etc)', () => {
      let way = new Rapid.OsmWay(context, { tags: { waterway: 'river' } });
      assert.isTrue(way.isOneWay(), 'river');
      way = new Rapid.OsmWay(context, { tags: { waterway: 'stream' } });
      assert.isTrue(way.isOneWay(), 'stream');
      way = new Rapid.OsmWay(context, { tags: { highway: 'motorway' } });
      assert.isTrue(way.isOneWay(), 'motorway');
      way = new Rapid.OsmWay(context, { tags: { junction: 'roundabout' } });
      assert.isTrue(way.isOneWay(), 'roundabout');
      way = new Rapid.OsmWay(context, { tags: { junction: 'circular' } });
      assert.isTrue(way.isOneWay(), 'circular');
    });

    it('returns false when the way does not have implied oneway tag', () => {
      let way = new Rapid.OsmWay(context, { tags: { highway: 'motorway_link' } });
      assert.isFalse(way.isOneWay(), 'motorway_link');
      way = new Rapid.OsmWay(context, { tags: { highway: 'trunk' } });
      assert.isFalse(way.isOneWay(), 'trunk');
      way = new Rapid.OsmWay(context, { tags: { highway: 'trunk_link' } });
      assert.isFalse(way.isOneWay(), 'trunk_link');
      way = new Rapid.OsmWay(context, { tags: { highway: 'primary' } });
      assert.isFalse(way.isOneWay(), 'primary');
      way = new Rapid.OsmWay(context, { tags: { highway: 'primary_link' } });
      assert.isFalse(way.isOneWay(), 'primary_link');
      way = new Rapid.OsmWay(context, { tags: { highway: 'secondary' } });
      assert.isFalse(way.isOneWay(), 'secondary');
      way = new Rapid.OsmWay(context, { tags: { highway: 'secondary_link' } });
      assert.isFalse(way.isOneWay(), 'secondary_link');
      way = new Rapid.OsmWay(context, { tags: { highway: 'tertiary' } });
      assert.isFalse(way.isOneWay(), 'tertiary');
      way = new Rapid.OsmWay(context, { tags: { highway: 'tertiary_link' } });
      assert.isFalse(way.isOneWay(), 'tertiary_link');
      way = new Rapid.OsmWay(context, { tags: { highway: 'unclassified' } });
      assert.isFalse(way.isOneWay(), 'unclassified');
      way = new Rapid.OsmWay(context, { tags: { highway: 'residential' } });
      assert.isFalse(way.isOneWay(), 'residential');
      way = new Rapid.OsmWay(context, { tags: { highway: 'living_street' } });
      assert.isFalse(way.isOneWay(), 'living_street');
      way = new Rapid.OsmWay(context, { tags: { highway: 'service' } });
      assert.isFalse(way.isOneWay(), 'service');
      way = new Rapid.OsmWay(context, { tags: { highway: 'track' } });
      assert.isFalse(way.isOneWay(), 'track');
      way = new Rapid.OsmWay(context, { tags: { highway: 'path' } });
      assert.isFalse(way.isOneWay(), 'path');
    });

    it('returns false when oneway=no overrides implied oneway tag', () => {
      let way = new Rapid.OsmWay(context, { tags: { junction: 'roundabout', oneway: 'no' } });
      assert.isFalse(way.isOneWay(), 'roundabout');
      way = new Rapid.OsmWay(context, { tags: { junction: 'circular', oneway: 'no' } });
      assert.isFalse(way.isOneWay(), 'circular');
      way = new Rapid.OsmWay(context, { tags: { highway: 'motorway', oneway: 'no' } });
      assert.isFalse(way.isOneWay(), 'motorway');
    });
  });


  describe('sidednessIdentifier', () => {
    it('returns tag when the tag has implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'cliff' } });
      assert.strictEqual(way.sidednessIdentifier(), 'natural');
      way = new Rapid.OsmWay(context, { tags: { natural: 'coastline' } });
      assert.strictEqual(way.sidednessIdentifier(), 'coastline');
      way = new Rapid.OsmWay(context, { tags: { barrier: 'retaining_wall' } });
      assert.strictEqual(way.sidednessIdentifier(), 'barrier');
      way = new Rapid.OsmWay(context, { tags: { barrier: 'kerb' } });
      assert.strictEqual(way.sidednessIdentifier(), 'barrier');
      way = new Rapid.OsmWay(context, { tags: { barrier: 'guard_rail' } });
      assert.strictEqual(way.sidednessIdentifier(), 'barrier');
      way = new Rapid.OsmWay(context, { tags: { barrier: 'city_wall' } });
      assert.strictEqual(way.sidednessIdentifier(), 'barrier');
      way = new Rapid.OsmWay(context, { tags: { man_made: 'embankment' } });
      assert.strictEqual(way.sidednessIdentifier(), 'man_made');
      way = new Rapid.OsmWay(context, { tags: { 'abandoned:barrier': 'guard_rail' } });
      assert.strictEqual(way.sidednessIdentifier(), 'barrier');
    });

    it('returns null when tag does not have implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'ridge' } });
      assert.isNull(way.sidednessIdentifier());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'fence' } });
      assert.isNull(way.sidednessIdentifier());
      way = new Rapid.OsmWay(context, { tags: { man_made: 'dyke' } });
      assert.isNull(way.sidednessIdentifier());
      way = new Rapid.OsmWay(context, { tags: { highway: 'motorway' } });
      assert.isNull(way.sidednessIdentifier());
      way = new Rapid.OsmWay(context, { tags: { 'demolished:highway': 'motorway' } });
      assert.isNull(way.sidednessIdentifier());
      way = new Rapid.OsmWay(context, { tags: { 'not:natural': 'cliff' } });
      assert.isNull(way.sidednessIdentifier());
    });
  });


  describe('isSided', () => {
    it('returns false when the way has no tags', () => {
      const way = new Rapid.OsmWay(context);
      assert.isFalse(way.isSided());
    });

    it('returns false when the way has two_sided=yes', () => {
      const way = new Rapid.OsmWay(context, { tags: { two_sided: 'yes' } });
      assert.isFalse(way.isSided());
    });

    it('returns true when the tag has implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'cliff' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { natural: 'coastline' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'retaining_wall' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'kerb' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'guard_rail' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'city_wall' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { man_made: 'embankment' } });
      assert.isTrue(way.isSided());
    });

    it('returns false when two_sided=yes overrides tag with implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'cliff', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { natural: 'coastline', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'retaining_wall', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'kerb', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'guard_rail', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'city_wall', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { man_made: 'embankment', two_sided: 'yes' } });
      assert.isFalse(way.isSided());
    });

    it('returns true when two_sided=no is on tag with implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'cliff', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { natural: 'coastline', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'retaining_wall', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'kerb', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'guard_rail', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'city_wall', two_sided: 'no' } });
      assert.isTrue(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { man_made: 'embankment', two_sided: 'no' } });
      assert.isTrue(way.isSided());
    });

    it('returns false when the tag does not have implied sidedness', () => {
      let way = new Rapid.OsmWay(context, { tags: { natural: 'ridge' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { barrier: 'fence' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { man_made: 'dyke' } });
      assert.isFalse(way.isSided());
      way = new Rapid.OsmWay(context, { tags: { highway: 'motorway' } });
      assert.isFalse(way.isSided());
    });
  });


  describe('isArea', () => {
    it('returns false when the way has no tags', () => {
      const way = new Rapid.OsmWay(context);
      assert.isFalse(way.isArea());
    });

    it('returns true if the way has tag area=yes', () => {
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes' } });
      assert.isTrue(way.isArea());
    });

    it('returns false if the way is closed and has no tags', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'] });
      assert.isFalse(way.isArea());
    });

    it('returns true if the way is closed and has a key in Rapid.osmAreaKeys', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { building: 'yes' } });
      assert.isTrue(way.isArea());
    });

    it('returns true for some highway and railway exceptions', () => {
      let way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { highway: 'services' } });
      assert.isTrue(way.isArea(), 'highway=services');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { highway: 'rest_area' } });
      assert.isTrue(way.isArea(), 'highway=rest_area');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { railway: 'roundhouse' } });
      assert.isTrue(way.isArea(), 'railway=roundhouse');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { railway: 'station' } });
      assert.isTrue(way.isArea(), 'railway=station');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { railway: 'traverser' } });
      assert.isTrue(way.isArea(), 'railway=traverser');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { railway: 'turntable' } });
      assert.isTrue(way.isArea(), 'railway=turntable');
      way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { railway: 'wash' } });
      assert.isTrue(way.isArea(), 'railway=wash');
    });

    it('returns false if the way is closed and has no keys in Rapid.osmAreaKeys', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { a: 'b' } });
      assert.isFalse(way.isArea());
    });

    it('returns false if the way is closed and has tag area=no', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { area: 'no', building: 'yes' } });
      assert.isFalse(way.isArea());
    });

    it('returns false for coastline', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['n1', 'n1'], tags: { natural: 'coastline' } });
      assert.isFalse(way.isArea());
    });
  });


  describe('isDegenerate', () => {
    it('returns true for a linear way with zero or one nodes', () => {
      let way = new Rapid.OsmWay(context, { nodes: [] });
      assert.isTrue(way.isDegenerate());
      way = new Rapid.OsmWay(context, { nodes: ['a'] });
      assert.isTrue(way.isDegenerate());
    });

    it('returns true for a circular way with only one unique node', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['a', 'a'] });
      assert.isTrue(way.isDegenerate());
    });

    it('returns false for a linear way with two or more nodes', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['a', 'b'] });
      assert.isFalse(way.isDegenerate());
    });

    it('returns true for a linear way that doubles back on itself', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'a'] });
      assert.isTrue(way.isDegenerate());
    });

    it('returns true for an area with zero, one, or two unique nodes', () => {
      let way = new Rapid.OsmWay(context, { tags: { area: 'yes' }, nodes: [] });
      assert.isTrue(way.isDegenerate());
      way = new Rapid.OsmWay(context, { tags: { area: 'yes' }, nodes: ['a', 'a'] });
      assert.isTrue(way.isDegenerate());
      way = new Rapid.OsmWay(context, { tags: { area: 'yes' }, nodes: ['a', 'b', 'a'] });
      assert.isTrue(way.isDegenerate());
    });

    it('returns false for an area with three or more unique nodes', () => {
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes' }, nodes: ['a', 'b', 'c', 'a'] });
      assert.isFalse(way.isDegenerate());
    });
  });


  describe('areAdjacent', () => {
    it('returns false for nodes not in the way', () => {
      const way = new Rapid.OsmWay(context);
      assert.isFalse(way.areAdjacent('a', 'b'));
    });

    it('returns false for non-adjacent nodes in the way', () => {
      const way = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c'] });
      assert.isFalse(way.areAdjacent('a', 'c'));
    });

    it('returns true for adjacent nodes in the way (forward)', () => {
      let way = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'd'] });
      assert.isTrue(way.areAdjacent('a', 'b'));
      assert.isTrue(way.areAdjacent('b', 'c'));
      assert.isTrue(way.areAdjacent('c', 'd'));
    });

    it('returns true for adjacent nodes in the way (reverse)', () => {
      let way = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'd'] });
      assert.isTrue(way.areAdjacent('b', 'a'));
      assert.isTrue(way.areAdjacent('c', 'b'));
      assert.isTrue(way.areAdjacent('d', 'c'));
    });
  });


  describe('geometry', () => {
    it('returns \'line\' when the way is not an area', () => {
      const graph = new Rapid.Graph(context);
      const way = new Rapid.OsmWay(context);
      assert.strictEqual(way.geometry(graph), 'line');
    });

    it('returns \'area\' when the way is an area', () => {
      const graph = new Rapid.Graph(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes' } });
      assert.strictEqual(way.geometry(graph), 'area');
    });
  });


  describe('segments', () => {
    it('returns segments for the given way', () => {
      //     a
      //      \
      //  c -- b
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0.0000, 0.0000] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [-0.0002, -0.0002] }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['a', 'b', 'c'] })
      ]);

      const result = graph.entity('w1').segments(graph);
      assert.lengthOf(result, 2);

      const segment0 = result[0];
      assert.deepInclude(segment0, { id: 'w1-0', wayId: 'w1', index: 0, nodes: ['a', 'b'] });
      assert.deepEqual(segment0.extent(graph), new Rapid.sdk.Extent([0.0000, -0.0002], [0.0002, 0.0000]));

      const segment1 = result[1];
      assert.deepInclude(segment1, { id: 'w1-1', wayId: 'w1', index: 1, nodes: ['b', 'c'] });
      assert.deepEqual(segment1.extent(graph), new Rapid.sdk.Extent([-0.0002, -0.0002], [0.0002, -0.0002]));
    });
  });


  describe('close', () => {
    it('returns self for empty way', () => {
      const w = new Rapid.OsmWay(context);
      assert.deepEqual(w.close(), w);
    });

    it('returns self for already closed way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.deepEqual(w1.close(), w1);
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.deepEqual(w2.close(), w2);
    });

    it('closes a way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w1.close().nodes.join(''), 'aba', 'multiple');
      const w2 = new Rapid.OsmWay(context, { nodes: 'a'.split('') });
      assert.strictEqual(w2.close().nodes.join(''), 'aa', 'single');
    });

    it('eliminates duplicate consecutive nodes when closing a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abb'.split('') });
      assert.strictEqual(w1.close().nodes.join(''), 'aba', 'duplicate at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbc'.split('') });
      assert.strictEqual(w2.close().nodes.join(''), 'abca', 'duplicate in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabc'.split('') });
      assert.strictEqual(w3.close().nodes.join(''), 'abca', 'duplicate at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abbbcbb'.split('') });
      assert.strictEqual(w4.close().nodes.join(''), 'abcba', 'duplicates multiple places');
    });
  });


  describe('unclose', () => {
    it('returns self for empty way', () => {
      const w = new Rapid.OsmWay(context);
      assert.deepEqual(w.unclose(), w);
    });

    it('returns self for already unclosed way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'a'.split('') });
      assert.deepEqual(w1.unclose(), w1);
      const w2 = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.deepEqual(w2.unclose(), w2);
    });

    it('uncloses a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w1.unclose().nodes.join(''), 'ab', 'multiple');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w2.unclose().nodes.join(''), 'a', 'single');
    });

    it('eliminates duplicate consecutive nodes when unclosing a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.unclose().nodes.join(''), 'abc', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.unclose().nodes.join(''), 'abc', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.unclose().nodes.join(''), 'abc', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.unclose().nodes.join(''), 'abc', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.unclose().nodes.join(''), 'abcb', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.unclose().nodes.join(''), 'a', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.unclose().nodes.join(''), 'a', 'single node circular with duplicates');
    });
  });


  describe('addNode', () => {
    it('adds a node to an empty way', () => {
      const w = new Rapid.OsmWay(context);
      assert.deepEqual(w.addNode('a').nodes, ['a']);
    });

    it('adds a node to the end of a linear way when index is undefined', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w.addNode('c').nodes.join(''), 'abc');
    });

    it('adds a node before the end connector of a circular way when index is undefined', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w1.addNode('c').nodes.join(''), 'abca', 'circular');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w2.addNode('c').nodes.join(''), 'aca', 'single node circular');
    });

    it('adds an internal node to a linear way at a positive index', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w.addNode('c', 1).nodes.join(''), 'acb');
    });

    it('adds an internal node to a circular way at a positive index', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w1.addNode('c', 1).nodes.join(''), 'acba', 'circular');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w2.addNode('c', 1).nodes.join(''), 'aca', 'single node circular');
    });

    it('adds a leading node to a linear way at index 0', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w.addNode('c', 0).nodes.join(''), 'cab');
    });

    it('adds a leading node to a circular way at index 0, preserving circularity', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w1.addNode('c', 0).nodes.join(''), 'cabc', 'circular');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w2.addNode('c', 0).nodes.join(''), 'cac', 'single node circular');
    });

    it('throws RangeError if index outside of array range for linear way', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.throws(() => w.addNode('c', 3), RangeError, /out of range 0\.\.2/, 'over range');
      assert.throws(() => w.addNode('c', -1), RangeError, /out of range 0\.\.2/, 'under range');
    });

    it('throws RangeError if index outside of array range for circular way', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.throws(() => w.addNode('c', 3), RangeError, /out of range 0\.\.2/, 'over range');
      assert.throws(() => w.addNode('c', -1), RangeError, /out of range 0\.\.2/, 'under range');
    });

    it('eliminates duplicate consecutive nodes when adding to the end of a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abb'.split('') });
      assert.strictEqual(w1.addNode('b').nodes.join(''), 'ab', 'duplicate at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbc'.split('') });
      assert.strictEqual(w2.addNode('c').nodes.join(''), 'abc', 'duplicate in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabc'.split('') });
      assert.strictEqual(w3.addNode('c').nodes.join(''), 'abc', 'duplicate at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abbbcbb'.split('') });
      assert.strictEqual(w4.addNode('b').nodes.join(''), 'abcb', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when adding same node before the end connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.addNode('c').nodes.join(''), 'abca', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.addNode('c').nodes.join(''), 'abca', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.addNode('c').nodes.join(''), 'abca', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.addNode('a').nodes.join(''), 'abca', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.addNode('b').nodes.join(''), 'abcba', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.addNode('a').nodes.join(''), 'aa', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.addNode('a').nodes.join(''), 'aa', 'single node circular with duplicates');
    });

    it('eliminates duplicate consecutive nodes when adding different node before the end connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.addNode('d').nodes.join(''), 'abcda', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.addNode('d').nodes.join(''), 'abcda', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.addNode('d').nodes.join(''), 'abcda', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.addNode('d').nodes.join(''), 'abcda', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.addNode('d').nodes.join(''), 'abcbda', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.addNode('d').nodes.join(''), 'ada', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.addNode('d').nodes.join(''), 'ada', 'single node circular with duplicates');
    });

    it('eliminates duplicate consecutive nodes when adding to the beginning of a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abb'.split('') });
      assert.strictEqual(w1.addNode('a', 0).nodes.join(''), 'ab', 'duplicate at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbc'.split('') });
      assert.strictEqual(w2.addNode('a', 0).nodes.join(''), 'abc', 'duplicate in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabc'.split('') });
      assert.strictEqual(w3.addNode('a', 0).nodes.join(''), 'abc', 'duplicate at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abbbcbb'.split('') });
      assert.strictEqual(w4.addNode('a', 0).nodes.join(''), 'abcb', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when adding same node as beginning connector a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.addNode('a', 0).nodes.join(''), 'abca', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.addNode('a', 0).nodes.join(''), 'abca', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.addNode('a', 0).nodes.join(''), 'abca', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.addNode('a', 0).nodes.join(''), 'abca', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.addNode('a', 0).nodes.join(''), 'abcba', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.addNode('a', 0).nodes.join(''), 'aa', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.addNode('a', 0).nodes.join(''), 'aa', 'single node circular with duplicates');
    });

    it('eliminates duplicate consecutive nodes when adding different node as beginning connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.addNode('d', 0).nodes.join(''), 'dabcd', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.addNode('d', 0).nodes.join(''), 'dabcd', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.addNode('d', 0).nodes.join(''), 'dabcd', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.addNode('d', 0).nodes.join(''), 'dabcd', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.addNode('d', 0).nodes.join(''), 'dabcbd', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.addNode('d', 0).nodes.join(''), 'dad', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.addNode('d', 0).nodes.join(''), 'dad', 'single node circular with duplicates');
    });
  });


  describe('updateNode', () => {
    it('throws RangeError if empty way', () => {
      const w = new Rapid.OsmWay(context);
      assert.throws(() => w.updateNode('d', 0), RangeError, /out of range 0\.\.-1/);
    });

    it('updates an internal node on a linear way at a positive index', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w.updateNode('d', 1).nodes.join(''), 'ad');
    });

    it('updates an internal node on a circular way at a positive index', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w.updateNode('d', 1).nodes.join(''), 'ada', 'circular');
    });

    it('updates a leading node on a linear way at index 0', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.strictEqual(w.updateNode('d', 0).nodes.join(''), 'db');
    });

    it('updates a leading node on a circular way at index 0, preserving circularity', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.strictEqual(w1.updateNode('d', 0).nodes.join(''), 'dbd', 'circular');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w2.updateNode('d', 0).nodes.join(''), 'dd', 'single node circular');
    });

    it('throws RangeError if index outside of array range for linear way', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'ab'.split('') });
      assert.throws(() => w.updateNode('d', 2), RangeError, /out of range 0\.\.1/, 'over range');
      assert.throws(() => w.updateNode('d', -1), RangeError, /out of range 0\.\.1/, 'under range');
    });

    it('throws RangeError if index outside of array range for circular way', () => {
      const w = new Rapid.OsmWay(context, { nodes: 'aba'.split('') });
      assert.throws(() => w.updateNode('d', 3), RangeError, /out of range 0\.\.2/, 'over range');
      assert.throws(() => w.updateNode('d', -1), RangeError, /out of range 0\.\.2/, 'under range');
    });

    it('eliminates duplicate consecutive nodes when updating the end of a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcc'.split('') });
      assert.strictEqual(w1.updateNode('c', 3).nodes.join(''), 'abc', 'duplicate at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbc'.split('') });
      assert.strictEqual(w2.updateNode('c', 3).nodes.join(''), 'abc', 'duplicate in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabc'.split('') });
      assert.strictEqual(w3.updateNode('c', 3).nodes.join(''), 'abc', 'duplicate at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abbbcbb'.split('') });
      assert.strictEqual(w4.updateNode('b', 6).nodes.join(''), 'abcb', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when updating same node before the end connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.updateNode('c', 3).nodes.join(''), 'abca', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.updateNode('c', 3).nodes.join(''), 'abca', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.updateNode('c', 3).nodes.join(''), 'abca', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.updateNode('a', 3).nodes.join(''), 'abca', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.updateNode('b', 6).nodes.join(''), 'abcba', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when updating different node before the end connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.updateNode('d', 3).nodes.join(''), 'abcda', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.updateNode('d', 3).nodes.join(''), 'abda', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.updateNode('d', 3).nodes.join(''), 'abda', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.updateNode('d', 3).nodes.join(''), 'dbcd', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.updateNode('d', 6).nodes.join(''), 'abcbda', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when updating the beginning of a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abb'.split('') });
      assert.strictEqual(w1.updateNode('b', 0).nodes.join(''), 'b', 'duplicate at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbc'.split('') });
      assert.strictEqual(w2.updateNode('b', 0).nodes.join(''), 'bc', 'duplicate in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabc'.split('') });
      assert.strictEqual(w3.updateNode('a', 0).nodes.join(''), 'abc', 'duplicate at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abbbcbb'.split('') });
      assert.strictEqual(w4.updateNode('a', 0).nodes.join(''), 'abcb', 'duplicates multiple places');
    });

    it('eliminates duplicate consecutive nodes when updating same node as beginning connector a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.updateNode('a', 0).nodes.join(''), 'abca', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.updateNode('a', 0).nodes.join(''), 'abca', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.updateNode('a', 0).nodes.join(''), 'abca', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.updateNode('a', 0).nodes.join(''), 'abca', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.updateNode('a', 0).nodes.join(''), 'abcba', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.updateNode('a', 0).nodes.join(''), 'aa', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.updateNode('a', 0).nodes.join(''), 'aa', 'single node circular with duplicates');
    });

    it('eliminates duplicate consecutive nodes when updating different node as beginning connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.updateNode('d', 0).nodes.join(''), 'dbcd', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.updateNode('d', 0).nodes.join(''), 'dbcd', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.updateNode('d', 0).nodes.join(''), 'dbcd', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.updateNode('d', 0).nodes.join(''), 'dbcd', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.updateNode('d', 0).nodes.join(''), 'dbcbd', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.updateNode('d', 0).nodes.join(''), 'dd', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.updateNode('d', 0).nodes.join(''), 'dd', 'single node circular with duplicates');
    });

    it('eliminates duplicate consecutive nodes when updating different node as ending connector of a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcca'.split('') });
      assert.strictEqual(w1.updateNode('d', 4).nodes.join(''), 'dbcd', 'duplicate internal node at end');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abbca'.split('') });
      assert.strictEqual(w2.updateNode('d', 4).nodes.join(''), 'dbcd', 'duplicate internal node in middle');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w3.updateNode('d', 4).nodes.join(''), 'dbcd', 'duplicate connector node at beginning');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w4.updateNode('d', 4).nodes.join(''), 'dbcd', 'duplicate connector node at end');
      const w5 = new Rapid.OsmWay(context, { nodes: 'abbbcbba'.split('') });
      assert.strictEqual(w5.updateNode('d', 7).nodes.join(''), 'dbcbd', 'duplicates multiple places');
      const w6 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w6.updateNode('d', 1).nodes.join(''), 'dd', 'single node circular');
      const w7 = new Rapid.OsmWay(context, { nodes: 'aaa'.split('') });
      assert.strictEqual(w7.updateNode('d', 2).nodes.join(''), 'dd', 'single node circular with duplicates');
    });
  });


  describe('replaceNode', () => {
    it('replaces a node', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'a'.split('') });
      assert.strictEqual(w1.replaceNode('a', 'b').nodes.join(''), 'b', 'single replace, single node');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abc'.split('') });
      assert.strictEqual(w2.replaceNode('b', 'd').nodes.join(''), 'adc', 'single replace, linear');
      const w4 = new Rapid.OsmWay(context, { nodes: 'abca'.split('') });
      assert.strictEqual(w4.replaceNode('b', 'd').nodes.join(''), 'adca', 'single replace, circular');
    });

    it('replaces multiply occurring nodes', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcb'.split('') });
      assert.strictEqual(w1.replaceNode('b', 'd').nodes.join(''), 'adcd', 'multiple replace, linear');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abca'.split('') });
      assert.strictEqual(w2.replaceNode('a', 'd').nodes.join(''), 'dbcd', 'multiple replace, circular');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w3.replaceNode('a', 'd').nodes.join(''), 'dd', 'multiple replace, single node circular');
    });

    it('eliminates duplicate consecutive nodes when replacing along a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abbcd'.split('') });
      assert.strictEqual(w1.replaceNode('c', 'b').nodes.join(''), 'abd', 'duplicate before');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcdd'.split('') });
      assert.strictEqual(w2.replaceNode('c', 'd').nodes.join(''), 'abd', 'duplicate after');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abbcbb'.split('') });
      assert.strictEqual(w3.replaceNode('c', 'b').nodes.join(''), 'ab', 'duplicate before and after');
    });

    it('eliminates duplicate consecutive nodes when replacing internal nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abbcda'.split('') });
      assert.strictEqual(w1.replaceNode('c', 'b').nodes.join(''), 'abda', 'duplicate before');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcdda'.split('') });
      assert.strictEqual(w2.replaceNode('c', 'd').nodes.join(''), 'abda', 'duplicate after');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abbcbba'.split('') });
      assert.strictEqual(w3.replaceNode('c', 'b').nodes.join(''), 'aba', 'duplicate before and after');
    });

    it('eliminates duplicate consecutive nodes when replacing adjacent to connecting nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcda'.split('') });
      assert.strictEqual(w1.replaceNode('d', 'a').nodes.join(''), 'abca', 'before single end connector');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcda'.split('') });
      assert.strictEqual(w2.replaceNode('b', 'a').nodes.join(''), 'acda', 'after single beginning connector');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abcdaa'.split('') });
      assert.strictEqual(w3.replaceNode('d', 'a').nodes.join(''), 'abca', 'before duplicate end connector');
      const w4 = new Rapid.OsmWay(context, { nodes: 'aabcda'.split('') });
      assert.strictEqual(w4.replaceNode('b', 'a').nodes.join(''), 'acda', 'after duplicate beginning connector');
    });

    it('eliminates duplicate consecutive nodes when replacing connecting nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w1.replaceNode('a', 'd').nodes.join(''), 'dbcd', 'duplicate end connector');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w2.replaceNode('a', 'd').nodes.join(''), 'dbcd', 'duplicate beginning connector');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabcaa'.split('') });
      assert.strictEqual(w3.replaceNode('a', 'd').nodes.join(''), 'dbcd', 'duplicate beginning and end connectors');
      const w4 = new Rapid.OsmWay(context, { nodes: 'aabaacaa'.split('') });
      assert.strictEqual(w4.replaceNode('a', 'd').nodes.join(''), 'dbdcd', 'duplicates multiple places');
    });
  });


  describe('removeNode', () => {
    it('removes a node', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'a'.split('') });
      assert.strictEqual(w1.removeNode('a').nodes.join(''), '', 'single remove, single node');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abc'.split('') });
      assert.strictEqual(w2.removeNode('b').nodes.join(''), 'ac', 'single remove, linear');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abca'.split('') });
      assert.strictEqual(w3.removeNode('b').nodes.join(''), 'aca', 'single remove, circular');
      const w4 = new Rapid.OsmWay(context, { nodes: 'aa'.split('') });
      assert.strictEqual(w4.removeNode('a').nodes.join(''), '', 'multiple remove, single node circular');
    });

    it('removes multiply occurring nodes', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcb'.split('') });
      assert.strictEqual(w1.removeNode('b').nodes.join(''), 'ac', 'multiple remove, linear');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcba'.split('') });
      assert.strictEqual(w2.removeNode('b').nodes.join(''), 'aca', 'multiple remove, circular');
    });

    it('eliminates duplicate consecutive nodes when removing along a linear way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abbcd'.split('') });
      assert.strictEqual(w1.removeNode('c').nodes.join(''), 'abd', 'duplicate before');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcdd'.split('') });
      assert.strictEqual(w2.removeNode('c').nodes.join(''), 'abd', 'duplicate after');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abbcbb'.split('') });
      assert.strictEqual(w3.removeNode('c').nodes.join(''), 'ab', 'duplicate before and after');
    });

    it('eliminates duplicate consecutive nodes when removing internal nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abbcda'.split('') });
      assert.strictEqual(w1.removeNode('c').nodes.join(''), 'abda', 'duplicate before');
      const w2 = new Rapid.OsmWay(context, { nodes: 'abcdda'.split('') });
      assert.strictEqual(w2.removeNode('c').nodes.join(''), 'abda', 'duplicate after');
      const w3 = new Rapid.OsmWay(context, { nodes: 'abbcbba'.split('') });
      assert.strictEqual(w3.removeNode('c').nodes.join(''), 'aba', 'duplicate before and after');
    });

    it('eliminates duplicate consecutive nodes when removing adjacent to connecting nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcdaa'.split('') });
      assert.strictEqual(w1.removeNode('d').nodes.join(''), 'abca', 'duplicate end connector');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aabcda'.split('') });
      assert.strictEqual(w2.removeNode('b').nodes.join(''), 'acda', 'duplicate beginning connector');
    });

    it('eliminates duplicate consecutive nodes when removing connecting nodes along a circular way', () => {
      const w1 = new Rapid.OsmWay(context, { nodes: 'abcaa'.split('') });
      assert.strictEqual(w1.removeNode('a').nodes.join(''), 'bcb', 'duplicate end connector');
      const w2 = new Rapid.OsmWay(context, { nodes: 'aabca'.split('') });
      assert.strictEqual(w2.removeNode('a').nodes.join(''), 'bcb', 'duplicate beginning connector');
      const w3 = new Rapid.OsmWay(context, { nodes: 'aabcaa'.split('') });
      assert.strictEqual(w3.removeNode('a').nodes.join(''), 'bcb', 'duplicate beginning and end connectors');
      const w4 = new Rapid.OsmWay(context, { nodes: 'aabaacaa'.split('') });
      assert.strictEqual(w4.removeNode('a').nodes.join(''), 'bcb', 'duplicates multiple places');
    });
  });


  describe('asGeoJSON', () => {
    it('converts a line to a GeoJSON LineString feature', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 2] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 4] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { highway: 'residential' }, nodes: ['n1', 'n2'] });
      const graph = new Rapid.Graph(context, [n1, n2, w1]);
      const result = w1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'w1',
        properties: { highway: 'residential' },
        geometry: {
          type: 'LineString',
          coordinates: [[1, 2], [3, 4]]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('converts an area to a GeoJSON Polygon feature', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 2] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 4] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 6] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { area: 'yes' }, nodes: ['n1', 'n2', 'n3', 'n1'] });
      const graph = new Rapid.Graph(context, [n1, n2, n3, w1]);
      const result = w1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'w1',
        properties: { area: 'yes' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[1, 2], [3, 4], [1, 6], [1, 2]]]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('converts an unclosed area to a GeoJSON LineString feature', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [1, 2] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [3, 4] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 6] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { area: 'yes' }, nodes: ['n1', 'n2', 'n3'] });
      const graph = new Rapid.Graph(context, [n1, n2, n3, w1]);
      const result = w1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'w1',
        properties: { area: 'yes' },
        geometry: {
          type: 'LineString',
          coordinates: [[1, 2], [3, 4], [1, 6]]
        }
      };
      assert.deepEqual(result, expected);
    });

    it('handles Feature with missing geometry', () => {
      const w1 = new Rapid.OsmWay(context, { id: 'w1', tags: { highway: 'residential' }, nodes: [] });
      const graph = new Rapid.Graph(context, [w1]);
      const result = w1.asGeoJSON(graph);
      const expected = {
        type: 'Feature',
        id: 'w1',
        properties: { highway: 'residential' },
        geometry: null
      };
      assert.deepEqual(result, expected);
    });
  });


  describe('asJXON', () => {
    it('converts a way to jxon', () => {
      const w = new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } });
      assert.deepEqual(w.asJXON(), {
        way: {
          '@id': '-1',
          '@version': 0,
          nd: [{ keyAttributes: { ref: '1' } }, { keyAttributes: { ref: '2' } }],
          tag: [{ keyAttributes: { k: 'highway', v: 'residential' } }]
        }
      });
    });

    it('includes changeset if provided', () => {
      const jxon = new Rapid.OsmWay(context).asJXON('1234');
      assert.strictEqual(jxon.way['@changeset'], '1234');
    });
  });


  describe('area', () => {
    it('returns a relative measure of area', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [-0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0.0002, -0.0001] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, -0.0001] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [-0.0004, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0.0004, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0.0004, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'h', loc: [-0.0004, -0.0002] }),
        new Rapid.OsmWay(context, { id: 's', tags: { area: 'yes' }, nodes: ['a', 'b', 'c', 'd', 'a'] }),
        new Rapid.OsmWay(context, { id: 'l', tags: { area: 'yes' }, nodes: ['e', 'f', 'g', 'h', 'e'] })
      ]);

      const s = Math.abs(graph.entity('s').area(graph));
      const l = Math.abs(graph.entity('l').area(graph));
      assert.isOk(s < l);
    });

    it('handles areas wound counterclockwise', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [-0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0.0002, -0.0001] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, -0.0001] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [-0.0004, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0.0004, 0.0002] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0.0004, -0.0002] }),
        new Rapid.OsmNode(context, { id: 'h', loc: [-0.0004, -0.0002] }),
        new Rapid.OsmWay(context, { id: 's', tags: { area: 'yes' }, nodes: ['a', 'd', 'c', 'b', 'a'] }),  // ccw
        new Rapid.OsmWay(context, { id: 'l', tags: { area: 'yes' }, nodes: ['e', 'f', 'g', 'h', 'e'] })
      ]);

      const s = Math.abs(graph.entity('s').area(graph));
      const l = Math.abs(graph.entity('l').area(graph));
      assert.isOk(s < l);
    });

    it('treats unclosed areas as if they were closed', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [-0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0.0002, -0.0001] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [-0.0002, -0.0001] }),
        new Rapid.OsmWay(context, { id: 's', tags: { area: 'yes' }, nodes: ['a', 'b', 'c', 'd', 'a'] }),
        new Rapid.OsmWay(context, { id: 'l', tags: { area: 'yes' }, nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const s = graph.entity('s').area(graph);
      const l = graph.entity('l').area(graph);
      assert.strictEqual(s, l);
    });

    it('returns 0 for degenerate areas', () => {
      const graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [-0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.0002, 0.0001] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0] }),
        new Rapid.OsmWay(context, { id: 'w0', tags: { area: 'yes' }, nodes: [] }),
        new Rapid.OsmWay(context, { id: 'w1', tags: { area: 'yes' }, nodes: ['a'] }),
        new Rapid.OsmWay(context, { id: 'w2', tags: { area: 'yes' }, nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: 'w3', tags: { area: 'yes' }, nodes: ['a', 'c'] })
      ]);

      assert.strictEqual(graph.entity('w0').area(graph), 0);
      assert.strictEqual(graph.entity('w1').area(graph), 0);
      assert.strictEqual(graph.entity('w2').area(graph), 0);
      assert.strictEqual(graph.entity('w3').area(graph), 0);
    });
  });
});
