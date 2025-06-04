import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


describe('actionExtract', () => {
  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();
  const viewport = context.viewport;

  it('extracts a node from the graph', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const graph = new Rapid.Graph([n1]);
    const action = Rapid.actionExtract('n1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a way from the graph', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a relation', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1', type: 'node' }, { id: 'n2', type: 'node' }] });
    const graph = new Rapid.Graph([n1, n2, r1]);
    const action = Rapid.actionExtract('n1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a linear way', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'building': 'yes' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a closed way', () => {
    // Graph: n1 -- n2 -- n3 -- n4 -- n1 (closed way)
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 1] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, 1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'] });
    const graph = new Rapid.Graph([n1, n2, n3, n4, w1]);
    const action = Rapid.actionExtract('n1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a way with no points', () => {
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: [] });
    const graph = new Rapid.Graph([w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    assert.equal(extractedNodeID, undefined);
    assert.equal(result, graph);   // Assert that the graph is unchanged
  });

  it('extracts a node from a way with one point', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    const graph = new Rapid.Graph([n1, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a way with two points', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with indoor tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { indoor: 'corridor' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with building tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { building: 'yes', height: '10' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with source tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { source: 'test_source' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with wheelchair tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { wheelchair: 'yes' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:housenumber tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:housenumber': '123' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with area tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { area: 'yes' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with level tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { level: '1' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:postcode tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:postcode': '12345' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:city tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:city': 'Test City' } });
    const graph = new Rapid.Graph([n1, n2, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with more than two points', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'] });
    const graph = new Rapid.Graph([n1, n2, n3, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.deepEqual(extractedNode.loc, [1, 0]);
  });

  it('extracts a node from a closed way with Polygon geometry', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [-1, -1] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [-1, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 1] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [1, -1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'] });
    const graph = new Rapid.Graph([n1, n2, n3, n4, w1]);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = result.hasEntity(extractedNodeID);
    assert.ok(extractedNode instanceof Rapid.OsmNode);
    assert.ok(Rapid.sdk.vecEqual(extractedNode.loc, [0, 0], 1e-6));
  });

});
