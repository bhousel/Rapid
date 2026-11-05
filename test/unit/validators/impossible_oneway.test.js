import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('validateImpossibleOneway', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.EditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    schema:   new Rapid.SchemaSystem(context),
    spatial:  new Rapid.SpatialSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };
  context.editable = () => true;

  let entered;
  context.enter = (...args) => entered.push(args);

  let validator;
  beforeAll(async () => {
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    await context.initAsync()
      .then(() => schema.merge(osmRulesets))
      .then(() => context.startAsync());

    context.services = { osm: { isDataLoaded: () => true } };   // after starting, it's only a stub
    validator = Rapid.validateImpossibleOneway(context);
  });

  beforeEach(async () => {
    await context.systems.editor.resetAsync();
    entered = [];
  });

  // Two oneways `w1` and `w2` that both end at `n2`, so nothing can leave there
  function loadTailToTail() {
    const editor = context.systems.editor;
    const oneway = { highway: 'residential', oneway: 'yes' };
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [-0.001, 0], version: '1' }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0, 0], version: '1' }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.001, 0], version: '1' }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: oneway, version: '1' }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n2'], tags: oneway, version: '1' })
    ]);

    const graph = editor.staging.graph;
    const issues = validator(graph.entity('w1'), graph).issues;
    const issue = issues.find(issue => issue.entityIds[1] === 'n2');
    assert.ok(issue);
    return issue;
  }

  function continueFix(issue) {
    return issue.fixes().find(fix => fix.icon?.startsWith('rapid-operation-continue'));
  }


  it('flags oneways that end at the same node', () => {
    const issue = loadTailToTail();
    assert.strictEqual(issue.type, 'impossible_oneway');
    assert.deepEqual(issue.entityIds, ['w1', 'n2']);
  });

  it('continues drawing the road from its end', () => {
    const issue = loadTailToTail();
    continueFix(issue).onClick();
    assert.deepEqual(entered, [['draw-line', { continueWayID: 'w1', continueNodeID: 'n2' }]]);
  });

  it('doesn\'t continue drawing from a node that isn\'t the end of the road anymore', () => {
    const editor = context.systems.editor;
    const issue = loadTailToTail();
    const fix = continueFix(issue);

    // The user draws the road further after the fixes were shown
    const node = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0.001] });
    editor.perform(Rapid.actionAddEntity(node), Rapid.actionAddVertex('w1', 'n-1'));
    editor.commit({ stringID: 'extended w1', selectionAfter: ['w1'] });

    fix.onClick();
    assert.deepEqual(entered, []);
  });
});
