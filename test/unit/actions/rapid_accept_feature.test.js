import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


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


describe('actionRapidAcceptFeature with autoconnect', () => {
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

  // Just what the action uses: the dataset catalog, and what was accepted or ignored already
  class MockRapid extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'rapid';
      this.catalog = new Map();
      this.acceptIDs = new Set();
      this.ignoreIDs = new Set();
    }
  }

  class MockSettings extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'settings';
    }
    get(k) {
      return (k === 'poweruser.autoConnect') ? 'true' : undefined;
    }
    set() {}
    registerLocal() {}
    registerSync() {}
    unregister() {}
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.EditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    rapid:    new MockRapid(context),
    schema:   new Rapid.SchemaSystem(context),
    settings: new MockSettings(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };
  context.services = {
    mock: new MockService(context)
  };

  const props = { serviceID: 'mock', datasetID: 'mock' };
  const residential = { highway: 'residential' };

  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => schema.merge(osmRulesets))
      .then(() => context.startAsync());

    const mockDataset = new Rapid.RapidDataset(context, { id: 'mock', serviceID: 'mock' });
    mockDataset.dictionary = new Rapid.RapidDataDictionary(context);
    mockDataset.dictionary.transforms = [
      { order: 0, function: 'copy', source: '*', target: '*' }   // just copy everything
    ];
    context.systems.rapid.catalog.set(mockDataset.id, mockDataset);
  });

  beforeEach(async () => {
    await context.systems.editor.resetAsync();
  });


  // Accept the external way `w-100`, the way the Rapid inspector does, and return the new way
  function accept() {
    const editor = context.systems.editor;
    const action = Rapid.actionRapidAcceptFeature(extGraph.entity('w-100'));
    editor.perform(action);
    const graph = editor.staging.graph;
    return { graph: graph, way: graph.entity(action.getNewID()) };
  }


  it('connects an end that stops short of a road, and then checks the changed way for crossings', () => {
    // An existing road running north, with a node `n2` about 20 cm north of [0, 0]
    // (a version, so it's the node that's kept when the two are merged)
    context.systems.editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, -0.001], version: '1' }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.000002], version: '1' }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0, 0.001], version: '1' }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: residential, version: '1' })
    ]);

    // A Rapid road from the west that ends about 1 m short of the existing road, at [0, 0].
    // Connecting it merges its end node with `n2`, so the end node it was accepted with is gone.
    extGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-100', loc: [-0.001, 0], ...props }),
      new Rapid.OsmNode(context, { id: 'n-101', loc: [-0.00001, 0], ...props }),
      new Rapid.OsmWay(context, { id: 'w-100', nodes: ['n-100', 'n-101'], tags: residential, ...props })
    ]);

    const { graph, way } = accept();
    assert.strictEqual(way.last(), 'n2');
    assert.sameMembers(graph.parentWays(graph.entity('n2')).map(w => w.id), [way.id, 'w1']);
  });


  it('connects both ends of a road that stop short of the same segment of another road', () => {
    // An existing road running north
    context.systems.editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, -0.001], version: '1' }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.001], version: '1' }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: residential, version: '1' })
    ]);

    // A U-shaped Rapid service road west of it, both ends about 1 m short of the same segment.
    // Connecting the first end splits that segment, so the second end must go into one of its pieces.
    extGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-100', loc: [-0.00001, -0.0002], ...props }),
      new Rapid.OsmNode(context, { id: 'n-101', loc: [-0.0005, -0.0002], ...props }),
      new Rapid.OsmNode(context, { id: 'n-102', loc: [-0.0005, 0.0002], ...props }),
      new Rapid.OsmNode(context, { id: 'n-103', loc: [-0.00001, 0.0002], ...props }),
      new Rapid.OsmWay(context, { id: 'w-100', nodes: ['n-100', 'n-101', 'n-102', 'n-103'], tags: { highway: 'service' }, ...props })
    ]);

    const { graph, way } = accept();
    const road = graph.entity('w1');
    assert.deepEqual(road.nodes, ['n1', way.first(), way.last(), 'n2']);
  });


  it('connects a road that crosses two roads on one of its segments', () => {
    // Two existing roads running north, at lon 0 and lon 0.0005
    context.systems.editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, -0.001] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.001] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: residential }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0005, -0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0005, 0.001] }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4'], tags: residential })
    ]);

    // A Rapid footway from west to east, with one segment that crosses both roads
    extGraph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n-100', loc: [-0.001, 0], ...props }),
      new Rapid.OsmNode(context, { id: 'n-101', loc: [0.0015, 0], ...props }),
      new Rapid.OsmWay(context, { id: 'w-100', nodes: ['n-100', 'n-101'], tags: { highway: 'footway' }, ...props })
    ]);

    const { graph, way } = accept();
    assert.lengthOf(way.nodes, 4);   // a crossing node on each road

    for (const roadID of ['w1', 'w2']) {
      const road = graph.entity(roadID);
      const shared = road.nodes.filter(nodeID => way.nodes.includes(nodeID));
      assert.lengthOf(shared, 1, `the footway is connected to ${roadID}`);
      assert.strictEqual(graph.entity(shared[0]).tags.highway, 'crossing');
    }

    // Every node is part of a way (no node left behind by a fix that no longer fit the graph)
    for (const entity of graph.localEntities().values()) {
      if (entity?.type === 'node') {
        assert.isNotEmpty(graph.parentWays(entity), `${entity.id} is in a way`);
      }
    }
  });
});
