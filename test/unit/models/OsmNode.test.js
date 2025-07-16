import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('OsmNode', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs an OsmNode from a context', () => {
      const a = new Rapid.OsmNode(context);
      assert.instanceOf(a, Rapid.OsmNode);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
    });

    it('generates an empty tags object, if unset', () => {
      const a = new Rapid.OsmNode(context);
      assert.deepEqual(a.props.tags, {});
    });

    it('generates an id string, if unset', () => {
      const a = new Rapid.OsmNode(context);
      assert.match(a.props.id, /^n-/);
    });

    it('constructs an OsmNode from a context, with props', () => {
      const orig = { id: 'n1', tags: { amenity: 'cafe' } };
      const a = new Rapid.OsmNode(context, orig);
      assert.instanceOf(a, Rapid.OsmNode);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
      assert.deepInclude(a.props, orig);
    });

    it('constructs an OsmNode from another OsmNode', () => {
      const a = new Rapid.OsmNode(context);
      const b = new Rapid.OsmNode(a);
      assert.instanceOf(b, Rapid.OsmNode);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
    });

    it('constructs an OsmNode from another OsmNode, with props', () => {
      const orig = { id: 'n1', tags: { amenity: 'cafe' } };
      const a = new Rapid.OsmNode(context, orig);
      const update = { foo: 'bar' };
      const b = new Rapid.OsmNode(a, update);
      assert.instanceOf(b, Rapid.OsmNode);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });
  });

  describe('loc', () => {
    it('gets loc, if set', () => {
      const n = new Rapid.OsmNode(context, { id: 'n', loc: [0, 0] });
      assert.deepEqual(n.loc, [0, 0]);
    });

    it('gets undefined, if not set', () => {
      const n = new Rapid.OsmNode(context, { id: 'n' });
      assert.isUndefined(n.loc);
    });
  });

  describe('update', () => {
    it('returns a new OsmNode', () => {
      const a = new Rapid.OsmNode(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.OsmNode);
      assert.notStrictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.OsmNode(context);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
      assert.notStrictEqual(b.props, update);   // cloned, not ===
      assert.deepInclude(b.props, update);
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.OsmNode(context);
      const b = a.update();
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
    });

    it('preserves existing properties', () => {
      const orig = { id: 'n1', tags: { amenity: 'cafe' } };
      const a = new Rapid.OsmNode(context, orig);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);   // new object, not ===
      assert.notStrictEqual(b.props, update);    // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.OsmNode(context);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.doesNotHaveAnyKeys(b.props, ['constructor', '__proto__', 'toString']);
    });

    it('updates v', () => {
      const a = new Rapid.OsmNode(context);
      const v1 = a.v;
      const b = a.update({});
      assert.isAbove(b.v, v1);
    });
  });


  describe('asGeoJSON', () => {
    it('converts to a GeoJSON Point Feature', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', tags: { amenity: 'cafe' }, loc: [1, 2] });
      const result = n1.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'n1',
        properties: { amenity: 'cafe' },
        geometry: {
          type: 'Point',
          coordinates: [1, 2]
        }
      };

      assert.deepEqual(result, expected);
    });

    it('handles GeoJSON Point Feature with missing location', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', tags: { amenity: 'cafe' }, loc: null });
      const result = n1.asGeoJSON();
      const expected = {
        type: 'Feature',
        id: 'n1',
        properties: { amenity: 'cafe' },
        geometry: null
      };

      assert.deepEqual(result, expected);
    });
  });


  describe('asJXON', () => {
    it('converts a node to jxon', () => {
      const n = new Rapid.OsmNode(context, { id: 'n-1', loc: [-77, 38], tags: { amenity: 'cafe' } });
      assert.deepEqual(n.asJXON(), {
        node: {
          '@id': '-1',
          '@lon': -77,
          '@lat': 38,
          '@version': 0,
          tag: [{ keyAttributes: { k: 'amenity', v: 'cafe' } }]
        }
      });
    });

    it('includes changeset if provided', () => {
      const jxon = new Rapid.OsmNode(context, { loc: [0, 0] }).asJXON('1234');
      assert.strictEqual(jxon.node['@changeset'], '1234');
    });
  });


  describe('extent', () => {
    it('returns a point extent', () => {
      const node = new Rapid.OsmNode(context, { loc: [5, 10] });
      const extent = node.extent();
      assert.deepEqual(extent, new Rapid.sdk.Extent([5, 10], [5, 10]));
    });
  });


  describe('intersects', () => {
    it('returns true for a node within the given extent', () => {
      const node = new Rapid.OsmNode(context, { loc: [0, 0] });
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.strictEqual(node.intersects(extent), true);
    });

    it('returns false for a node outside the given extent', () => {
      const node = new Rapid.OsmNode(context, { loc: [6, 6] });
      const extent = new Rapid.sdk.Extent([-5, -5], [5, 5]);
      assert.strictEqual(node.intersects(extent), false);
    });
  });


  describe('geometry', () => {
    it('returns \'vertex\' if the node is a member of any way', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id] });
      const graph = new Rapid.Graph([n, w]);
      assert.strictEqual(n.geometry(graph), 'vertex');
    });

    it('returns \'point\' if the node is not a member of any way', () => {
      const n = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph([n]);
      assert.strictEqual(n.geometry(graph), 'point');
    });
  });


  describe('isEndpoint', () => {
    it('returns true for a node at an endpoint along a linear way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const n3 = new Rapid.OsmNode(context, { id: 'n3' });
      const w1 = new Rapid.OsmWay(context, { nodes: ['n1', 'n2', 'n3'] });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.isTrue(n1.isEndpoint(graph), 'linear way, beginning node');
      assert.isFalse(n2.isEndpoint(graph), 'linear way, middle node');
      assert.isTrue(n3.isEndpoint(graph), 'linear way, ending node');
    });

    it('returns false for nodes along a circular way', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2' });
      const n3 = new Rapid.OsmNode(context, { id: 'n3' });
      const w1 = new Rapid.OsmWay(context, { nodes: ['n1', 'n2', 'n3', 'n1'] });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.isFalse(n1.isEndpoint(graph), 'circular way, connector node');
      assert.isFalse(n2.isEndpoint(graph), 'circular way, middle node');
      assert.isFalse(n3.isEndpoint(graph), 'circular way, ending node');
    });
  });


  describe('isConnected', () => {
    it('returns true for a node with multiple parent ways, at least one interesting', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isConnected(graph));
    });

    it('returns false for a node with only area parent ways', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { area: 'yes' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { area: 'yes' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isFalse(n.isConnected(graph));
    });

    it('returns false for a node with only uninteresting parent ways', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id] });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isFalse(n.isConnected(graph));
    });

    it('returns false for a standalone node on a single parent way', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id] });
      const graph = new Rapid.Graph([n, w]);
      assert.isFalse(n.isConnected(graph));
    });

    it('returns true for a self-intersecting node on a single parent way', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const c = new Rapid.OsmNode(context, { id: 'c' });
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'b'] });
      const graph = new Rapid.Graph([a, b, c, w]);
      assert.isTrue(b.isConnected(graph));
    });

    it('returns false for the connecting node of a closed way', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const c = new Rapid.OsmNode(context, { id: 'c' });
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'a'] });
      const graph = new Rapid.Graph([a, b, c, w]);
      assert.isFalse(a.isConnected(graph));
    });
  });


  describe('isShared', () => {
    it('returns false a node with no parents', () => {
      const n = new Rapid.OsmNode(context);
      const graph = new Rapid.Graph([n]);
      assert.isFalse(n.isShared(graph));
    });

    it('returns true a node with multiple parents', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id] });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id] });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isShared(graph));
    });

    it('returns true for a self-intersecting node on a single parent way', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const c = new Rapid.OsmNode(context, { id: 'c' });
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'b'] });
      const graph = new Rapid.Graph([a, b, c, w]);
      assert.isTrue(b.isShared(graph));
    });

    it('returns false for the connecting node of a closed way', () => {
      const a = new Rapid.OsmNode(context, { id: 'a' });
      const b = new Rapid.OsmNode(context, { id: 'b' });
      const c = new Rapid.OsmNode(context, { id: 'c' });
      const w = new Rapid.OsmWay(context, { nodes: ['a', 'b', 'c', 'a'] });
      const graph = new Rapid.Graph([a, b, c, w]);
      assert.isFalse(a.isShared(graph));
    });
  });


  describe('parentIntersectionWays', () => {
    it('returns a parent highway', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n, w]);
      assert.deepEqual(n.parentIntersectionWays(graph), [w]);
    });

    it('returns a parent waterway', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { waterway: 'river' } });
      const graph = new Rapid.Graph([n, w]);
      assert.deepEqual(n.parentIntersectionWays(graph), [w]);
    });

    it('returns a parent railway', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { railway: 'rail' } });
      const graph = new Rapid.Graph([n, w]);
      assert.deepEqual(n.parentIntersectionWays(graph), [w]);
    });

    it('returns a parent aeroway', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { aeroway: 'taxiway' } });
      const graph = new Rapid.Graph([n, w]);
      assert.deepEqual(n.parentIntersectionWays(graph), [w]);
    });

    it('returns multiple parent ways', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { railway: 'rail' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.deepEqual(n.parentIntersectionWays(graph), [w1, w2]);
    });

    it('ignores other types of parent ways', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { barrier: 'kerb' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { 'addr:interpolation': 'odd' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.deepEqual(n.parentIntersectionWays(graph), []);
    });
  });


  describe('isIntersection', () => {
    it('returns true for a node shared by more than one highway', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isIntersection(graph));
    });

    it('returns true for a node shared by more than one waterway', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { waterway: 'river' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { waterway: 'river' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isIntersection(graph));
    });

    it('returns true for a node shared by different types', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { railway: 'rail' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isIntersection(graph));
    });

    it('returns false for a node with just one parent', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n, w]);
      assert.isFalse(n.isIntersection(graph));
    });

    it('returns false for a node with parents of the wrong type', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { barrier: 'kerb' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { 'addr:interpolation': 'odd' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isFalse(n.isIntersection(graph));
    });
  });


  describe('isHighwayIntersection', () => {
    it('returns true for a node shared by more than one highway', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isTrue(n.isHighwayIntersection(graph));
    });

    it('returns false for a node shared by more than one waterway', () => {
      const n = new Rapid.OsmNode(context);
      const w1 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { waterway: 'river' } });
      const w2 = new Rapid.OsmWay(context, { nodes: [n.id], tags: { waterway: 'river' } });
      const graph = new Rapid.Graph([n, w1, w2]);
      assert.isFalse(n.isHighwayIntersection(graph));
    });
  });


  describe('isOnAddressLine', () => {
    it('returns true for a node on an address line', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { 'addr:interpolation': 'odd' } });
      const graph = new Rapid.Graph([n, w]);
      assert.isTrue(n.isOnAddressLine(graph));
    });

    it('returns false for a node not on an address line', () => {
      const n = new Rapid.OsmNode(context);
      const w = new Rapid.OsmWay(context, { nodes: [n.id], tags: { 'waterway': 'river' } });
      const graph = new Rapid.Graph([n, w]);
      assert.isFalse(n.isOnAddressLine(graph));
    });
  });


  describe('isDegenerate', () => {
    it('returns true if node has invalid loc', () => {
      assert.isTrue(new Rapid.OsmNode(context).isDegenerate(), 'no loc');
      assert.isTrue(new Rapid.OsmNode(context, { loc: '' }).isDegenerate(), 'empty string loc');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [] }).isDegenerate(), 'empty array loc');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0] }).isDegenerate(), '1-array loc');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0, 0, 0] }).isDegenerate(), '3-array loc');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [-181, 0] }).isDegenerate(), '< min lon');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [181, 0] }).isDegenerate(), '> max lon');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0, -91] }).isDegenerate(), '< min lat');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0, 91] }).isDegenerate(), '> max lat');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [Infinity, 0] }).isDegenerate(), 'Infinity lon');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0, Infinity] }).isDegenerate(), 'Infinity lat');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [NaN, 0] }).isDegenerate(), 'NaN lon');
      assert.isTrue(new Rapid.OsmNode(context, { loc: [0, NaN] }).isDegenerate(), 'NaN lat');
    });

    it('returns false if node has valid loc', () => {
      assert.isFalse(new Rapid.OsmNode(context, { loc: [0, 0] }).isDegenerate(), '2-array loc');
      assert.isFalse(new Rapid.OsmNode(context, { loc: [-180, 0] }).isDegenerate(), 'min lon');
      assert.isFalse(new Rapid.OsmNode(context, { loc: [180, 0] }).isDegenerate(), 'max lon');
      assert.isFalse(new Rapid.OsmNode(context, { loc: [0, -90] }).isDegenerate(), 'min lat');
      assert.isFalse(new Rapid.OsmNode(context, { loc: [0, 90] }).isDegenerate(), 'max lat');
    });
  });


  describe('directions', () => {
    const viewport = {
      project: val => val,
      unproject: val => val
    };

    it('returns empty array if no direction tag', () => {
      const n1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: {} });
      const graph = new Rapid.Graph([n1]);
      assert.deepEqual(n1.directions(graph, viewport), [], 'no direction tag');
    });

    it('returns empty array if nonsense direction tag', () => {
      const n1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'blah' } });
      const n2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '' } });
      const n3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NaN' } });
      const n4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'eastwest' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4]);

      assert.deepEqual(n1.directions(graph, viewport), [], 'nonsense direction tag');
      assert.deepEqual(n2.directions(graph, viewport), [], 'empty string direction tag');
      assert.deepEqual(n3.directions(graph, viewport), [], 'NaN direction tag');
      assert.deepEqual(n4.directions(graph, viewport), [], 'eastwest direction tag');
    });

    it('supports numeric direction tag', () => {
      const n1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '0' } });
      const n2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '45' } });
      const n3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '-45' } });
      const n4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '360' } });
      const n5 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '1000' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5]);

      assert.deepEqual(n1.directions(graph, viewport), [0], 'numeric 0');
      assert.deepEqual(n2.directions(graph, viewport), [45], 'numeric 45');
      assert.deepEqual(n3.directions(graph, viewport), [-45], 'numeric -45');
      assert.deepEqual(n4.directions(graph, viewport), [360], 'numeric 360');
      assert.deepEqual(n5.directions(graph, viewport), [1000], 'numeric 1000');
    });

    it('supports cardinal direction tags (test abbreviated and mixed case)', () => {
      const nodeN1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'n' } });
      const nodeN2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'N' } });
      const nodeN3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'north' } });
      const nodeN4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NOrth' } });

      const nodeNNE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'nne' } });
      const nodeNNE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NnE' } });
      const nodeNNE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'northnortheast' } });
      const nodeNNE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NOrthnorTHEast' } });

      const nodeNE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'ne' } });
      const nodeNE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'nE' } });
      const nodeNE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'northeast' } });
      const nodeNE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'norTHEast' } });

      const nodeENE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'ene' } });
      const nodeENE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'EnE' } });
      const nodeENE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'eastnortheast' } });
      const nodeENE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'EAstnorTHEast' } });

      const nodeE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'e' } });
      const nodeE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'E' } });
      const nodeE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'east' } });
      const nodeE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'EAst' } });

      const nodeESE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'ese' } });
      const nodeESE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'EsE' } });
      const nodeESE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'eastsoutheast' } });
      const nodeESE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'EAstsouTHEast' } });

      const nodeSE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'se' } });
      const nodeSE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'sE' } });
      const nodeSE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'southeast' } });
      const nodeSE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'souTHEast' } });

      const nodeSSE1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'sse' } });
      const nodeSSE2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'SsE' } });
      const nodeSSE3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'southsoutheast' } });
      const nodeSSE4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'SOuthsouTHEast' } });

      const nodeS1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 's' } });
      const nodeS2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'S' } });
      const nodeS3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'south' } });
      const nodeS4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'SOuth' } });

      const nodeSSW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'ssw' } });
      const nodeSSW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'SsW' } });
      const nodeSSW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'southsouthwest' } });
      const nodeSSW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'SOuthsouTHWest' } });

      const nodeSW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'sw' } });
      const nodeSW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'sW' } });
      const nodeSW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'southwest' } });
      const nodeSW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'souTHWest' } });

      const nodeWSW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'wsw' } });
      const nodeWSW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'WsW' } });
      const nodeWSW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'westsouthwest' } });
      const nodeWSW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'WEstsouTHWest' } });

      const nodeW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'w' } });
      const nodeW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'W' } });
      const nodeW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'west' } });
      const nodeW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'WEst' } });

      const nodeWNW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'wnw' } });
      const nodeWNW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'WnW' } });
      const nodeWNW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'westnorthwest' } });
      const nodeWNW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'WEstnorTHWest' } });

      const nodeNW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'nw' } });
      const nodeNW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'nW' } });
      const nodeNW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'northwest' } });
      const nodeNW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'norTHWest' } });

      const nodeNNW1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'nnw' } });
      const nodeNNW2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NnW' } });
      const nodeNNW3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'northnorthwest' } });
      const nodeNNW4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'NOrthnorTHWest' } });

      const graph = new Rapid.Graph([
        nodeN1, nodeN2, nodeN3, nodeN4,
        nodeNNE1, nodeNNE2, nodeNNE3, nodeNNE4,
        nodeNE1, nodeNE2, nodeNE3, nodeNE4,
        nodeENE1, nodeENE2, nodeENE3, nodeENE4,
        nodeE1, nodeE2, nodeE3, nodeE4,
        nodeESE1, nodeESE2, nodeESE3, nodeESE4,
        nodeSE1, nodeSE2, nodeSE3, nodeSE4,
        nodeSSE1, nodeSSE2, nodeSSE3, nodeSSE4,
        nodeS1, nodeS2, nodeS3, nodeS4,
        nodeSSW1, nodeSSW2, nodeSSW3, nodeSSW4,
        nodeSW1, nodeSW2, nodeSW3, nodeSW4,
        nodeWSW1, nodeWSW2, nodeWSW3, nodeWSW4,
        nodeW1, nodeW2, nodeW3, nodeW4,
        nodeWNW1, nodeWNW2, nodeWNW3, nodeWNW4,
        nodeNW1, nodeNW2, nodeNW3, nodeNW4,
        nodeNNW1, nodeNNW2, nodeNNW3, nodeNNW4
      ]);

      assert.deepEqual(nodeN1.directions(graph, viewport), [0], 'cardinal n');
      assert.deepEqual(nodeN2.directions(graph, viewport), [0], 'cardinal N');
      assert.deepEqual(nodeN3.directions(graph, viewport), [0], 'cardinal north');
      assert.deepEqual(nodeN4.directions(graph, viewport), [0], 'cardinal NOrth');

      assert.deepEqual(nodeNNE1.directions(graph, viewport), [22], 'cardinal nne');
      assert.deepEqual(nodeNNE2.directions(graph, viewport), [22], 'cardinal NnE');
      assert.deepEqual(nodeNNE3.directions(graph, viewport), [22], 'cardinal northnortheast');
      assert.deepEqual(nodeNNE4.directions(graph, viewport), [22], 'cardinal NOrthnorTHEast');

      assert.deepEqual(nodeNE1.directions(graph, viewport), [45], 'cardinal ne');
      assert.deepEqual(nodeNE2.directions(graph, viewport), [45], 'cardinal nE');
      assert.deepEqual(nodeNE3.directions(graph, viewport), [45], 'cardinal northeast');
      assert.deepEqual(nodeNE4.directions(graph, viewport), [45], 'cardinal norTHEast');

      assert.deepEqual(nodeENE1.directions(graph, viewport), [67], 'cardinal ene');
      assert.deepEqual(nodeENE2.directions(graph, viewport), [67], 'cardinal EnE');
      assert.deepEqual(nodeENE3.directions(graph, viewport), [67], 'cardinal eastnortheast');
      assert.deepEqual(nodeENE4.directions(graph, viewport), [67], 'cardinal EAstnorTHEast');

      assert.deepEqual(nodeE1.directions(graph, viewport), [90], 'cardinal e');
      assert.deepEqual(nodeE2.directions(graph, viewport), [90], 'cardinal E');
      assert.deepEqual(nodeE3.directions(graph, viewport), [90], 'cardinal east');
      assert.deepEqual(nodeE4.directions(graph, viewport), [90], 'cardinal EAst');

      assert.deepEqual(nodeESE1.directions(graph, viewport), [112], 'cardinal ese');
      assert.deepEqual(nodeESE2.directions(graph, viewport), [112], 'cardinal EsE');
      assert.deepEqual(nodeESE3.directions(graph, viewport), [112], 'cardinal eastsoutheast');
      assert.deepEqual(nodeESE4.directions(graph, viewport), [112], 'cardinal EAstsouTHEast');

      assert.deepEqual(nodeSE1.directions(graph, viewport), [135], 'cardinal se');
      assert.deepEqual(nodeSE2.directions(graph, viewport), [135], 'cardinal sE');
      assert.deepEqual(nodeSE3.directions(graph, viewport), [135], 'cardinal southeast');
      assert.deepEqual(nodeSE4.directions(graph, viewport), [135], 'cardinal souTHEast');

      assert.deepEqual(nodeSSE1.directions(graph, viewport), [157], 'cardinal sse');
      assert.deepEqual(nodeSSE2.directions(graph, viewport), [157], 'cardinal SsE');
      assert.deepEqual(nodeSSE3.directions(graph, viewport), [157], 'cardinal southsoutheast');
      assert.deepEqual(nodeSSE4.directions(graph, viewport), [157], 'cardinal SouthsouTHEast');

      assert.deepEqual(nodeS2.directions(graph, viewport), [180], 'cardinal S');
      assert.deepEqual(nodeS3.directions(graph, viewport), [180], 'cardinal south');
      assert.deepEqual(nodeS4.directions(graph, viewport), [180], 'cardinal SOuth');

      assert.deepEqual(nodeSSW1.directions(graph, viewport), [202], 'cardinal ssw');
      assert.deepEqual(nodeSSW2.directions(graph, viewport), [202], 'cardinal SsW');
      assert.deepEqual(nodeSSW3.directions(graph, viewport), [202], 'cardinal southsouthwest');
      assert.deepEqual(nodeSSW4.directions(graph, viewport), [202], 'cardinal SouthsouTHWest');

      assert.deepEqual(nodeSW1.directions(graph, viewport), [225], 'cardinal sw');
      assert.deepEqual(nodeSW2.directions(graph, viewport), [225], 'cardinal sW');
      assert.deepEqual(nodeSW3.directions(graph, viewport), [225], 'cardinal southwest');
      assert.deepEqual(nodeSW4.directions(graph, viewport), [225], 'cardinal souTHWest');

      assert.deepEqual(nodeWSW1.directions(graph, viewport), [247], 'cardinal wsw');
      assert.deepEqual(nodeWSW2.directions(graph, viewport), [247], 'cardinal WsW');
      assert.deepEqual(nodeWSW3.directions(graph, viewport), [247], 'cardinal westsouthwest');
      assert.deepEqual(nodeWSW4.directions(graph, viewport), [247], 'cardinal WEstsouTHWest');

      assert.deepEqual(nodeW1.directions(graph, viewport), [270], 'cardinal w');
      assert.deepEqual(nodeW2.directions(graph, viewport), [270], 'cardinal W');
      assert.deepEqual(nodeW3.directions(graph, viewport), [270], 'cardinal west');
      assert.deepEqual(nodeW4.directions(graph, viewport), [270], 'cardinal WEst');

      assert.deepEqual(nodeWNW1.directions(graph, viewport), [292], 'cardinal wnw');
      assert.deepEqual(nodeWNW2.directions(graph, viewport), [292], 'cardinal WnW');
      assert.deepEqual(nodeWNW3.directions(graph, viewport), [292], 'cardinal westnorthwest');
      assert.deepEqual(nodeWNW4.directions(graph, viewport), [292], 'cardinal WEstnorTHWest');

      assert.deepEqual(nodeNW1.directions(graph, viewport), [315], 'cardinal nw');
      assert.deepEqual(nodeNW2.directions(graph, viewport), [315], 'cardinal nW');
      assert.deepEqual(nodeNW3.directions(graph, viewport), [315], 'cardinal northwest');
      assert.deepEqual(nodeNW4.directions(graph, viewport), [315], 'cardinal norTHWest');

      assert.deepEqual(nodeNNW1.directions(graph, viewport), [337], 'cardinal nnw');
      assert.deepEqual(nodeNNW2.directions(graph, viewport), [337], 'cardinal NnW');
      assert.deepEqual(nodeNNW3.directions(graph, viewport), [337], 'cardinal northnorthwest');
      assert.deepEqual(nodeNNW4.directions(graph, viewport), [337], 'cardinal NOrthnorTHWest');
    });

    it('returns empty if junction node is missing a location', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', tags: { direction: 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), []);
    });

    it('returns empty if neighbor node is missing a location', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1' });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { direction: 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), []);
    });

    it('supports direction=forward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { direction: 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [270]);
    });

    it('supports direction=backward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'direction': 'backward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90]);
    });

    it('supports direction=both', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'direction': 'both' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports direction=all', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'direction': 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports traffic_signals:direction=forward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'traffic_signals:direction': 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [270]);
    });

    it('supports traffic_signals:direction=backward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'traffic_signals:direction': 'backward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90]);
    });

    it('supports traffic_signals:direction=both', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'traffic_signals:direction': 'both' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports traffic_signals:direction=all', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'traffic_signals:direction': 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports railway:signal:direction=forward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'railway:signal:direction': 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [270]);
    });

    it('supports railway:signal:direction=backward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'railway:signal:direction': 'backward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90]);
    });

    it('supports railway:signal:direction=both', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'railway:signal:direction': 'both' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports railway:signal:direction=all', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'railway:signal:direction': 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports camera:direction=forward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'camera:direction': 'forward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [270]);
    });

    it('supports camera:direction=backward', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'camera:direction': 'backward' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90]);
    });

    it('supports camera:direction=both', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'camera:direction': 'both' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('supports camera:direction=all', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'camera:direction': 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('returns directions for an all-way stop at a highway interstction', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'highway': 'stop', 'stop': 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, -1] });
      const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5, w1, w2]);
      assert.deepEqual(n2.directions(graph, viewport), [0, 90, 180, 270]);
    });

    it('does not return directions for an all-way stop not at a highway interstction', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0], tags: { 'highway': 'stop', 'stop': 'all' } });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0] });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0], tags: { 'highway': 'stop', 'stop': 'all' } });
      const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, -1], tags: { 'highway': 'stop', 'stop': 'all' } });
      const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0, 1], tags: { 'highway': 'stop', 'stop': 'all' } });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5, w1, w2]);
      assert.deepEqual(n2.directions(graph, viewport), []);
    });

    it('supports multiple directions delimited by ;', () => {
      const n1 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '0;45' } });
      const n2 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: '45;north' } });
      const n3 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'north;east' } });
      const n4 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 'n;s;e;w' } });
      const n5 = new Rapid.OsmNode(context, { loc: [0, 0], tags: { direction: 's;wat' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5]);

      assert.deepEqual(n1.directions(graph, viewport), [0, 45], 'numeric 0, numeric 45');
      assert.deepEqual(n2.directions(graph, viewport), [0, 45], 'numeric 45, cardinal north');
      assert.deepEqual(n3.directions(graph, viewport), [0, 90], 'cardinal north and east');
      assert.deepEqual(n4.directions(graph, viewport), [0, 90, 180, 270], 'cardinal n,s,e,w');
      assert.deepEqual(n5.directions(graph, viewport), [180], 'cardinal 180 and nonsense');
    });

    it('supports mixing textual, cardinal, numeric directions, delimited by ;', () => {
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { 'camera:direction': 'both;ne;60' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const graph = new Rapid.Graph([n1, n2, n3, w1]);
      assert.deepEqual(n2.directions(graph, viewport), [45, 60, 90, 270]);
    });

    it('does not return directions for non-routable line way', () => {
      //          n4
      //           |
      //    n1 -- n2 -- n3
      //           |
      //          n5
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { direction: 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, 1] });
      const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0, -1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5'], tags: { natural: 'coastline' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5, w1, w2]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

    it('does not return directions for non-routable area way', () => {
      //          n4 ------- n7
      //           |         |
      //    n1 -- n2 -- n3   |
      //           |         |
      //          n5 ------- n6
      const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, 0] });
      const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], tags: { direction: 'all' } });
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
      const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, 1] });
      const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0, -1] });
      const n6 = new Rapid.OsmNode(context, { id: 'n6', loc: [0, -1] });
      const n7 = new Rapid.OsmNode(context, { id: 'n7', loc: [0, -1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
      const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n4', 'n2', 'n5', 'n6', 'n7', 'n4'], tags: { highway: 'services' } });
      const graph = new Rapid.Graph([n1, n2, n3, n4, n5, n6, n7, w1, w2]);
      assert.deepEqual(n2.directions(graph, viewport), [90, 270]);
    });

  });

});
