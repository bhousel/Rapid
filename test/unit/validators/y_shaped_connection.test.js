import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validateYShapedConnection', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.EditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    schema:   new Rapid.SchemaSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };
  context.enter = () => {};

  let validator;
  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => schema.merge(osmRulesets))
      .then(() => context.startAsync());

    validator = Rapid.validateYShapedConnection(context);
  });

  beforeEach(async () => {
    await context.systems.editor.resetAsync();
  });

  // A new road `w-1` joins the existing road `w1` at `c`, through a node `e` about 8 m before it
  function makeYShape(extraEntities = []) {
    const editor = context.systems.editor;
    const road = { highway: 'residential' };
    editor.merge([
      new Rapid.OsmNode(context, { id: 'w1a', loc: [-0.001, 0], version: '1' }),
      new Rapid.OsmNode(context, { id: 'c',   loc: [0, 0], version: '1' }),
      new Rapid.OsmNode(context, { id: 'w1b', loc: [0.001, 0], version: '1' }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['w1a', 'c', 'w1b'], tags: road, version: '1' })
    ]);
    editor.perform(graph => {
      graph.replace(new Rapid.OsmNode(context, { id: 'n-1', loc: [0, -0.001] }));
      graph.replace(new Rapid.OsmNode(context, { id: 'n-2', loc: [0.00005, -0.00005] }));
      graph.replace(new Rapid.OsmNode(context, { id: 'n-3', loc: [0.001, 0.0001] }));
      graph.replace(new Rapid.OsmWay(context, { id: 'w-1', nodes: ['n-1', 'n-2', 'c', 'n-3'], tags: road }));
      for (const entity of extraEntities) {
        graph.replace(entity);
      }
      return graph;
    });
    editor.commit({ annotation: 'drew a road' });
    return editor.stable.graph;
  }

  it('flags a node that makes a short edge at a Y-shaped connection, and offers to delete it', () => {
    const graph = makeYShape();
    const issues = validator(graph.entity('n-2'), graph).issues;
    assert.lengthOf(issues, 1);
    assert.deepEqual(issues[0].entityIds, ['n-2']);
    assert.strictEqual(issues[0].dynamicFixes()[0].icon, 'rapid-operation-delete');

    assert.deepEqual(validator(graph.entity('n-1'), graph).issues, []);
  });

  it('suggests moving the node instead when another way shares it', () => {
    const graph = makeYShape([
      new Rapid.OsmNode(context, { id: 'n-4', loc: [0.0005, -0.0005] }),
      new Rapid.OsmWay(context, { id: 'w-2', nodes: ['n-2', 'n-4'], tags: { barrier: 'fence' } })
    ]);
    const issues = validator(graph.entity('n-2'), graph).issues;
    assert.lengthOf(issues, 1);
    const fix = issues[0].dynamicFixes()[0];
    assert.strictEqual(fix.icon, 'rapid-operation-move');
    assert.isUndefined(fix.onClick);
  });

  it('deletes the node from the current graph', () => {
    const editor = context.systems.editor;
    const graph = makeYShape();
    const [issue] = validator(graph.entity('n-2'), graph).issues;
    issue.dynamicFixes()[0].onClick();

    const result = editor.stable.graph;
    assert.isUndefined(result.hasEntity('n-2'));
    assert.deepEqual(result.entity('w-1').nodes, ['n-1', 'c', 'n-3']);
  });

});
