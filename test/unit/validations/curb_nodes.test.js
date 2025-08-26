import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationCurbNodes', () => {
  let graph;

  class MockEditSystem {
    constructor() {}
    initAsync()   { return Promise.resolve(); }
    get staging() { return { graph: graph }; }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new MockEditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    spatial:  new Rapid.SpatialSystem(context)
  };

  const validator = Rapid.validationCurbNodes(context);

  beforeEach(() => {
    graph = new Rapid.Graph(context);      // reset
  });


  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues = issues.concat(validator(entity, graph));
    }
    return issues;
  }


  function createSingleCrossing(w1tags = {}, w2tags = {}, n1tags = {}, n2tags = {}) {
    //
    //      n2       w1:  [n1, n5, n2]  (the foootway)
    //      |        w2:  [n3, n5, n4]  (the road)
    //  n3--n5--n4
    //      |
    //      n1
    //
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -1], tags: n1tags });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  1], tags: n2tags });
    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1, 0] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1, 0] });
    const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0,  0] });   // road-crossing junction
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n5', 'n2'], tags: w1tags });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n5', 'n4'], tags: w2tags });
    const entities = [n1, n2, n3, n4, n5, w1, w2];
    graph = new Rapid.Graph(context, entities);
  }

  function verifySingleCurbNodeIssue(issues) {
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const expected = {
      type:      'curb_nodes',
      severity:  'suggestion',
      entityIds: ['w1']
    };

    assert.deepInclude(issues[0], expected);
  }


  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores untagged line crossing untagged line', () => {
    createSingleCrossing();  // no tags
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  for (const type of ['primary', 'secondary', 'tertiary', 'residential']) {
    it(`flags missing curb nodes on a crossing way and ${type} road`, () => {
      createSingleCrossing(
        { highway: 'footway', footway: 'crossing' },
        { highway: type }
      );
      const issues = validate();
      verifySingleCurbNodeIssue(issues);
    });
  }

  it('ignores a crossing way with `barrier=kerb` tags at both ends', () => {
    createSingleCrossing(
      { highway: 'footway', footway: 'crossing' },
      { highway: 'residential' },
      { barrier: 'kerb' },
      { barrier: 'kerb' }
    );
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores a crossing way with `kerb=*` tags at both ends', () => {
    createSingleCrossing(
      { highway: 'footway', footway: 'crossing' },
      { highway: 'residential' },
      { kerb: 'no' },
      { kerb: 'maybe' }
    );
    const issues = validate();
    assert.deepEqual(issues, []);
  });

});
