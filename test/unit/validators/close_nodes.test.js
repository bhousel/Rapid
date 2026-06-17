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
});
