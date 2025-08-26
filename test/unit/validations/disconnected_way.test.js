import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationDisconnectedWay', () => {
  let graph;

  // class MockEditSystem {
  //   constructor() {}
  //   initAsync()   { return Promise.resolve(); }
  //   get staging() { return { graph: graph }; }
  //   get tree()    { return tree; }
  // }

  const context = new Rapid.MockContext();
  context.systems = {
    // editor:   new MockEditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    spatial:  new Rapid.SpatialSystem(context)
  };

  const validator = Rapid.validationDisconnectedWay(context);

  beforeEach(() => {
    graph = new Rapid.Graph(context);   // reset
  });


  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues = issues.concat(validator(entity, graph));
    }
    return issues;
  }

  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });


  //
  //  n1
  //
  function createDisconnectedNode(n1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: n1tags });
    const entities = [n1];
    graph = new Rapid.Graph(context, entities);
  }

  it('ignores non-routable node', () => {
    createDisconnectedNode({ amenity: 'bench' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('flags disconnected routable node', () => {
    createDisconnectedNode({ highway: 'elevator' });
    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'disconnected_way',
      subtype:   'highway',
      severity:  'warning',
      entityIds: ['n1']
    };

    assert.deepInclude(issues[0], expected);
  });


  //
  //  n2    w1: [n1, n2]
  //  |
  //  n1
  //
  function createDisconnectedWay(w1tags = {}) {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: w1tags });

    const entities = [n1, n2, w1];
    graph = new Rapid.Graph(context, entities);
  }

  it('ignores non-routable way', () => {
    createDisconnectedWay({ amenity: 'bench' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores non-routable highway', () => {
    createDisconnectedWay({ highway: 'services' });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('flags disconnected routable highway', () => {
    createDisconnectedWay({ highway: 'unclassified' });
    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'disconnected_way',
      subtype:   'highway',
      severity:  'warning',
      entityIds: ['w1']
    };

    assert.deepInclude(issues[0], expected);
  });


  //
  //  n2        w1: [n1, n2]
  //  |         w2: [n1, n3]
  //  n1--n3
  //
  function createConnectedWays(tags = {}) {
    const w1tags = tags.w1 ?? {};
    const w2tags = tags.w2 ?? {};
    const n1tags = tags.n1 ?? {};

    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: n1tags });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0, 1] });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [1, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: w1tags });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n1', 'n3'], tags: w2tags });

    const entities = [n1, n2, n3, w1, w2];
    graph = new Rapid.Graph(context, entities);
  }

  it('flags highway connected only to service area', () => {
    createConnectedWays({
      w1: { highway: 'unclassified' },
      w2: { highway: 'services' }
    });
    const issues = validate();
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'disconnected_way',
      subtype:   'highway',
      severity:  'warning',
      entityIds: ['w1']
    };

    assert.deepInclude(issues[0], expected);
  });

  it('ignores highway connected to entrance vertex', () => {
    createConnectedWays({
      w1: { highway: 'unclassified' },
      n1: { entrance: 'yes' }
    });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores highway connected to parking entrance vertex', () => {
    createConnectedWays({
      w1: { highway: 'unclassified' },
      n1: { amenity: 'parking_entrance' }
    });
    const issues = validate();
    assert.deepEqual(issues, []);
  });

});
