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
  viewport.project = (val) => val;
  viewport.unproject = (val) => val;

  let graph;

  beforeEach(() => {
    graph = new Rapid.Graph();
  });

  afterEach(() => {
    graph = null;
  });


  it('extracts a node from the graph', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    graph = graph.replace(n1);

    const action = Rapid.actionExtract('n1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a way from the graph', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    graph = graph.replace(n1).replace(n2).replace(w1);

    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);

    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a relation', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const r1 = new Rapid.OsmRelation(context, { id: 'r1', members: [{ id: 'n1', type: 'node' }, { id: 'n2', type: 'node' }] });
    graph = graph.replace(n1).replace(n2).replace(r1);

    const action = Rapid.actionExtract('n1', viewport);
    graph = action(graph);

    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a linear way', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'building': 'yes' } });
    graph = graph.replace(n1).replace(n2).replace(w1);

    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);

    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a closed way', () => {
    // Graph: n1 -- n2 -- n3 -- n4 -- n1 (closed way)
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 1] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [0, 1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'] });
    graph = graph.replace(n1).replace(n2).replace(n3).replace(n4).replace(w1);

    const action = Rapid.actionExtract('n1', viewport);
    graph = action(graph);

    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a way with no points', () => {
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: [] });
    graph = graph.replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    const result = action(graph);
    // Assert that the graph is unchanged
    assert.equal(result, graph);
  });

  it('extracts a node from a way with one point', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
    graph = graph.replace(n1).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0, 0]);
  });

  it('extracts a node from a way with two points', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with indoor tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { indoor: 'corridor' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with building tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { building: 'yes', height: '10' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with source tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { source: 'test_source' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with wheelchair tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { wheelchair: 'yes' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:housenumber tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:housenumber': '123' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with area tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { area: 'yes' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with level tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { level: '1' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:postcode tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:postcode': '12345' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with addr:city tag', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { 'addr:city': 'Test City' } });
    graph = graph.replace(n1).replace(n2).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [0.5, 0]);
  });

  it('extracts a node from a way with more than two points', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'] });
    graph = graph.replace(n1).replace(n2).replace(n3).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [1, 0]);
  });

  it('extracts a node from a closed way with Polygon geometry', () => {
    // Graph: n1 -- n2 -- n3 -- n1 (closed way)
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [2, 0] });
    let w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1'] });

    // Mock asGeoJSON to return a GeoJSON object with type property set to 'Polygon'
    w1.asGeoJSON = () => ({ type: 'Polygon', coordinates: [[n1.loc, n2.loc, n3.loc, n1.loc]] });

    graph = graph.replace(n1).replace(n2).replace(n3).replace(w1);
    const action = Rapid.actionExtract('w1', viewport);
    graph = action(graph);
    const extractedNodeID = action.getExtractedNodeID();
    const extractedNode = graph.entity(extractedNodeID);
    assert.deepEqual(extractedNode.loc, [1, 0]);
  });

});
