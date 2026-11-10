import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validateCloseNodes', () => {
  let graph;

  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.EditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    schema:   new Rapid.SchemaSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };

  let validator;

  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => schema.merge(osmRulesets))
      .then(() => context.startAsync());

    validator = Rapid.validateCloseNodes(context);
  });

  beforeEach(async () => {
    await context.systems.editor.resetAsync();
    graph = context.systems.editor.staging.graph;
  });


  // Load entities into the editor's spatial caches and refresh the validation graph.
  function load(entities) {
    const editor = context.systems.editor;
    editor.merge(entities);
    graph = editor.staging.graph;
  }

  function validate() {
    const entities = [ ...graph.base.entities.values() ];

    let issues = [];
    for (const entity of entities) {
      issues.push(...validator(entity, graph).issues);
    }
    return issues;
  }


  it('has no errors on init', () => {
    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('flags two detached points closer than the threshold', () => {
    // ~0.11m apart, well within the 0.2m detached-point threshold
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { amenity: 'bench' }}),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.000001], tags: { amenity: 'bench' }})
    ]);

    const issues = validate();
    // each node finds the other, so two issues
    assert.isArray(issues);
    assert.lengthOf(issues, 2);

    for (const issue of issues) {
      assert.strictEqual(issue.type, 'close_nodes');
      assert.strictEqual(issue.subtype, 'detached');
      assert.strictEqual(issue.severity, 'warning');
      assert.sameMembers(issue.entityIds, ['n1', 'n2']);
    }
  });


  it('flags two vertices of a way closer than the threshold, the same issue from either one', () => {
    // n2 and n3 are ~0.06m apart, in a road about 33m long
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.0001, 0] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.0001005, 0] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.0003, 0] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4'], tags: { highway: 'residential' }})
    ]);

    const fromN2 = validator(graph.entity('n2'), graph).issues;   // n3 is the node after it
    const fromN3 = validator(graph.entity('n3'), graph).issues;   // n2 is the node before it
    assert.lengthOf(fromN2, 1);
    assert.lengthOf(fromN3, 1);
    assert.strictEqual(fromN2[0].subtype, 'vertices');
    assert.deepEqual(fromN2[0].entityIds, ['w1', 'n2', 'n3']);
    assert.strictEqual(fromN3[0].id, fromN2[0].id);
    assert.lengthOf(validator(graph.entity('n1'), graph).issues, 0);
  });


  it('ignores two detached points beyond the threshold', () => {
    // ~1.1m apart, outside the 0.2m threshold (and outside the spatial query box)
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { amenity: 'bench' }}),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.00001], tags: { amenity: 'bench' }})
    ]);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('ignores close detached points tagged as stolperstein', () => {
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { 'memorial:type': 'stolperstein' }}),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.000001], tags: { 'memorial:type': 'stolperstein' }})
    ]);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('ignores close detached points on different levels', () => {
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { amenity: 'bench', level: '0' }}),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0.000001], tags: { amenity: 'bench', level: '1' }})
    ]);

    const issues = validate();
    assert.deepEqual(issues, []);
  });


  it('ignores close points that are in the spatial index but not in the graph being validated', () => {
    const editor = context.systems.editor;
    load([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: { amenity: 'bench' }})
    ]);
    const before = new Rapid.Graph(graph);   // an older graph, which gets the staging index

    // The user adds a bench right next to `n1`
    editor.perform(Rapid.actionAddEntity(new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0.000001], tags: { amenity: 'bench' }})));
    assert.lengthOf(validator(before.entity('n1'), editor.staging.graph).issues, 1);

    // `n-1` isn't in the older graph
    assert.deepEqual(validator(before.entity('n1'), before).issues, []);
  });
});
