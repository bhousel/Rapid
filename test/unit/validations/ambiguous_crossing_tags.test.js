import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationAmbiguousCrossingTags', () => {
  let graph;

  class MockEditSystem extends Rapid.MockSystem {
    get staging() { return { graph: graph }; }
  }

  const context = new Rapid.MockContext();
  context.systems = {
    editor:     new MockEditSystem(context),
    l10n:       new Rapid.LocalizationSystem(context),
    locations:  new Rapid.LocationSystem(context),
    schema:     new Rapid.SchemaSystem(context),
    spatial:    new Rapid.SpatialSystem(context)
  };

  const validator = Rapid.validationAmbiguousCrossingTags(context);

  beforeAll(() => {
    return Promise.all([
      context.systems.locations.initAsync(),
      context.systems.spatial.initAsync(),
      context.systems.schema.initAsync()
    ]).then(() => {
      context.systems.schema.merge({
        assetID: 'crossings_schema',
        scopes: [{
          scope: 'osm',
          variables: {
            // Highway values for major roads (motor vehicles, classified roads)
            major_highway_values: [
              'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
              'unclassified', 'residential', 'living_street', 'road',
              'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'
            ],

            // Highway values for minor roads (motor vehicles, service/access roads)
            minor_highway_values: [
              'service', 'track', 'busway', 'bus_guideway'
            ],

            // Highway values for paths (no motor vehicles)
            path_highway_values: [
              'path', 'footway', 'cycleway', 'bridleway', 'pedestrian', 'corridor',
              'elevator', 'ladder', 'steps', 'via_ferrata'
            ],

            // Tag keys that should be kept in sync between a crossing way and its child
            // crossing nodes.
            crossing_sync_keys: [
              'crossing', 'crossing_ref', 'crossing:continuous', 'crossing:island',
              'crossing:markings', 'crossing:signals'
            ],

            // A subset of crossing_sync_keys: tags that should be preserved (not deleted)
            // if they are set in one place but not the other.  They function more as
            // attribute/note tags than as defining tags.
            crossing_preserve_keys: [
              'crossing_ref', 'crossing:continuous', 'crossing:island'
            ]
          }
        }]
      });
    });
  });

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


  //
  //      n2       w1:  [n1, n5, n2]  (the foootway)
  //      |        w2:  [n3, n5, n4]  (the road)
  //  n3--n5--n4
  //      |
  //      n1
  //
  function createJunction(tags = {}) {
    const w1Tags = tags.w1 ?? {};
    const w2Tags = tags.w2 ?? {};
    const nTags  = tags.n  ?? {};

    const n5 = new Rapid.OsmNode(context, { id: 'n5', loc: [0,  0], tags: nTags} );

    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, -1] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0,  1] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n5', 'n2'], tags: w1Tags });

    const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [-1, 0] });
    const n4 = new Rapid.OsmNode(context, { id: 'n4', loc: [ 1, 0] });
    const w2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n5',  'n4'], tags: w2Tags });

    const entities = [n1, n2, n3, n4, n5, w1, w2];
    graph = new Rapid.Graph(context, entities);
  }


  function verifySingleCrossingWarning(issues) {
    assert.isArray(issues);
    assert.lengthOf(issues, 1);

    const issue = issues[0];
    assert.strictEqual(issue.type, 'ambiguous_crossing');
    assert.strictEqual(issue.severity, 'warning');
    assert.isArray(issue.entityIds);
    assert.lengthOf(issue.entityIds, 2);
  }


  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('ignores untagged lines that share an untagged crossing node', () => {
    createJunction();
    const issues = validate();
    assert.deepEqual(issues, []);
  });

  it('flags unmarked lines that share a marked crossing node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'unmarked' },
      w2: { highway: 'residential' },
      n:  { 'crossing:markings' : 'yes' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags unmarked lines that share a zebra-marked crossing node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'unmarked' },
      w2: { highway: 'residential' },
      n:  { crossing: 'zebra' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags marked lines that share an unmarked crossing node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'marked' },
      w2: { highway: 'residential' },
      n:  { 'crossing:markings': 'no' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags marked lines and nodes that have a different crossing marking type', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'marked', 'crossing:markings': 'zebra' },
      w2: { highway: 'residential' },
      n:  { 'highway': 'crossing', 'crossing':'marked', 'crossing:markings': 'lines' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags an informal line and marked node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'informal' },
      w2: { highway: 'residential' },
      n:  { 'crossing:markings': 'lines' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags a marked line and informal ladder node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'marked' },
      w2: { highway: 'residential' },
      n:  { 'highway': 'crossing', 'crossing': 'informal' }
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

  it('flags a marked line with bare crossing candidate node', () => {
    createJunction({
      w1: { highway: 'footway', footway: 'crossing', crossing: 'marked' },
      w2: { highway: 'residential' },
      n: {}
    });
    const issues = validate();
    verifySingleCrossingWarning(issues);
  });

});
