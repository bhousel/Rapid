import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { DeleteOperation } from '../../../modules/operations/DeleteOperation.ts';
import { ExtractOperation } from '../../../modules/operations/ExtractOperation.ts';
import { MergeOperation } from '../../../modules/operations/MergeOperation.ts';
import { SplitOperation } from '../../../modules/operations/SplitOperation.ts';
import osmRulesets from '../../../data/osm_rulesets.json5';


// An edit's `selectionAfter` is what redo selects, so it has to be what the operation selects next,
// not what it started from.
describe('operations commit with what they select next', () => {
  let context, editor, entered;

  beforeEach(async () => {
    context = new Rapid.MockContext();
    editor = new Rapid.EditSystem(context);
    const noop = () => {};
    context.systems = {
      editor: editor,
      l10n: { t: id => id, displayLabel: () => '', displayName: () => '', isRTL: () => false, initAsync: () => Promise.resolve(), on: noop },
      map: { centerEase: noop },
      spatial: new Rapid.SpatialSystem(context),
      storage: new Rapid.MockSystem(context)
    };
    context.enter = (modeID, options) => entered.push([modeID, options?.selection]);
    context.hasHiddenConnections = () => false;
    entered = [];
    await editor.initAsync();
    await editor.startAsync();
  });

  function check() {
    assert.lengthOf(entered, 1);
    const [modeID, selection] = entered[0];
    assert.deepEqual(editor.stable.props.selectionAfter, modeID === 'select' ? selection : []);
  }

  it('split: the vertex and the new lines', () => {
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'path' }, version: 1 })
    ]);
    new SplitOperation(context, ['n2']).run();
    check();
    assert.include(entered[0][1], 'n2');
    assert.isAbove(entered[0][1].length, 1);
  });

  it('extract from an area: the new point', async () => {
    const schema = new Rapid.SchemaSystem(context);
    schema.requestedAssetIDs = '';
    context.systems.schema = schema;
    await schema.initAsync();
    schema.merge(osmRulesets);
    schema.match = () => ({ geometries: new Set(['point', 'area']) });   // a preset that can be a point

    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.001, 0.001], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1'], tags: { building: 'yes', shop: 'bakery' }, version: 1 })
    ]);
    new ExtractOperation(context, ['w1']).run();
    check();
    assert.lengthOf(entered[0][1], 1);
    assert.notInclude(entered[0][1], 'w1');   // a new node
  });

  it('merge: the merged line', () => {
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'path' }, version: 1 }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n2', 'n3'], tags: { highway: 'path' }, version: 1 })
    ]);
    new MergeOperation(context, ['w1', 'w2']).run();
    check();
    assert.lengthOf(entered[0][1], 1);
  });

  it('delete a vertex: the next vertex', () => {
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'path' }, version: 1 })
    ]);
    new DeleteOperation(context, ['n2']).run();
    check();
    assert.deepEqual(entered[0][0], 'select');
  });
});
