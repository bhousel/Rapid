import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionRapidAcceptFeature', () => {

  let extGraph;

  class MockService extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'mock';
    }
    graph() {
      return extGraph;
    }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    rapid: new Rapid.RapidSystem(context)
  };
  context.services = {
    mock: new MockService(context)
  };

  // The external data should appear to come from our mock service
  const props = { serviceID: 'mock', datasetID: 'mock' };

  beforeAll(() => {
    return context.prepareAsync()
      .then(() => {
        const rapid = context.systems.rapid;
        const mockDataset = new Rapid.RapidDataset(context, { id: 'mock', serviceID: 'mock' });
        mockDataset.dictionary = new Rapid.RapidDataDictionary(context);
        mockDataset.dictionary.transforms = [
          { order: 0, function: 'copy', source: '*', target: '*' }   // just copy everything
        ];

        rapid.catalog.set(mockDataset.id, mockDataset);
      });
  });


  it('accepts a node', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0], ...props });
    extGraph = new Rapid.Graph(context, [n1]);

    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature(n1)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('n-1'));
  });

  it('accepts a way', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0], ...props });
    const n2 = new Rapid.OsmNode(context, { id: 'n-2', loc: [1, 1], ...props });
    const w1 = new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1', 'n-2'], ...props });
    extGraph = new Rapid.Graph(context, [n1, n2, w1]);

    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature(w1)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('w-1'));
  });

  it('accepts a relation', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0], ...props });
    const w1 = new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1'], ...props });
    const r1 = new Rapid.OsmRelation(context, { id: 'r-1', members: [{ id: 'w-1' }], ...props });
    extGraph = new Rapid.Graph(context, [n1, w1, r1]);

    const base = new Rapid.Graph(context);
    const graph = new Rapid.Graph(base);
    const result = Rapid.actionRapidAcceptFeature(r1)(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.isOk(result.hasEntity('r-1'));
  });
});
