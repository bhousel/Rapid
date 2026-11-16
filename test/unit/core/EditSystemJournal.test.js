import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// Step 1 of design/graph-geometry.md: `EditSystem` emits from the graphs' journals, not snapshots.
// These tests compare what it emits, and its session difference, with full scans of copied graphs.

async function makeEditor() {
  const context = new Rapid.MockContext();
  const spatial = new Rapid.SpatialSystem(context);
  context.systems = {
    spatial: spatial,
    storage: new Rapid.MockSystem(context)
  };
  const editor = new Rapid.EditSystem(context);
  context.systems.editor = editor;
  await editor.initAsync();
  await editor.startAsync();
  return { context, editor, spatial };
}

// A small seeded PRNG, so a failure can be reproduced.
function makeRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function changeKeys(difference) {
  return [...difference.changes.keys()].sort();
}

// Watches the editor's events. On each emit, it checks the emitted Difference against a full scan
// from a copy of the graph kept at the previous emit.
function watchEmits(editor) {
  const state = {
    stagingCopy: new Rapid.Graph(editor.staging.graph),
    stableCopy: new Rapid.Graph(editor.stable.graph),
    errors: [],
    emits: 0
  };

  editor.on('stagingchange', difference => {
    const expected = new Rapid.Difference(state.stagingCopy, editor.staging.graph);
    if (changeKeys(difference).join() !== changeKeys(expected).join()) {
      state.errors.push(`stagingchange: emitted [${changeKeys(difference)}], expected [${changeKeys(expected)}]`);
    }
    state.stagingCopy = new Rapid.Graph(editor.staging.graph);
    state.emits++;
  });

  editor.on('stablechange', difference => {
    const expected = new Rapid.Difference(state.stableCopy, editor.stable.graph);
    if (changeKeys(difference).join() !== changeKeys(expected).join()) {
      state.errors.push(`stablechange: emitted [${changeKeys(difference)}], expected [${changeKeys(expected)}]`);
    }
    state.stableCopy = new Rapid.Graph(editor.stable.graph);
  });

  return state;
}

function assertSessionDifference(editor, message) {
  const expected = new Rapid.Difference(editor.base.graph, editor.stable.graph);
  const actual = editor.difference();
  assert.deepEqual(changeKeys(actual), changeKeys(expected), `changes: ${message}`);
  assert.deepEqual([...actual.complete().keys()].sort(), [...expected.complete().keys()].sort(), `complete: ${message}`);
  assert.strictEqual(actual.summary().size, expected.summary().size, `summary: ${message}`);
}

function assertIndexMatchesGeometry(editor, spatial, message) {
  const graph = editor.staging.graph;

  // Staging's local index holds staging's own shapes.
  const items = spatial.getCache('editor_staging').items;
  for (const [entityID, item] of items) {
    const entity = graph.hasEntity(entityID);
    if (!entity || entity.type === 'node') continue;
    const extent = graph.geometry(entity).world.extent;
    const actual = [item.minX, item.minY, item.maxX, item.maxY].map(n => Math.round(n * 1000));
    const expected = [extent.min[0], extent.min[1], extent.max[0], extent.max[1]].map(n => Math.round(n * 1000));
    assert.deepEqual(actual, expected, `index box of ${entityID}: ${message}`);
  }

  // A search over each entity's own box finds it, as it is in staging, and nothing deleted.
  const entityIDs = new Set([...graph.base.entities.keys(), ...graph.localEntities().keys()]);
  for (const entityID of entityIDs) {
    const entity = graph.hasEntity(entityID);
    const extent = entity && graph.geometry(entity).world?.extent;
    if (!extent) continue;
    const found = editor.entitiesInBox(extent.bbox(), graph);
    assert.include(found, entity, `search for ${entityID}: ${message}`);
    for (const other of found) {
      assert.strictEqual(graph.hasEntity(other.id), other, `search for ${entityID} found ${other.key}: ${message}`);
    }
  }
}


describe('EditSystem journal', () => {

  it('emits the same changes as a full scan, through random edits', async () => {
    for (const seed of [1, 2, 3]) {
      const { context, editor, spatial } = await makeEditor();
      const random = makeRandom(seed);
      const pick = arr => arr[Math.floor(random() * arr.length)];

      const nodes = [];
      for (let i = 0; i < 12; i++) {
        nodes.push(new Rapid.OsmNode(context, { id: `n${i}`, loc: [i * 0.001, (i % 3) * 0.001], version: 1 }));
      }
      editor.merge([
        ...nodes,
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n0', 'n1', 'n2', 'n3'], tags: { highway: 'residential' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'w2', nodes: ['n3', 'n4', 'n5'], tags: { highway: 'residential' }, version: 1 }),
        new Rapid.OsmWay(context, { id: 'w3', nodes: ['n6', 'n7', 'n8', 'n6'], tags: { building: 'yes' }, version: 1 }),
        new Rapid.OsmRelation(context, { id: 'r1', tags: { type: 'route' }, members: [{ id: 'w1', type: 'way' }, { id: 'w2', type: 'way' }], version: 1 }),
        new Rapid.OsmRelation(context, { id: 'r2', tags: { type: 'route_master' }, members: [{ id: 'r1', type: 'relation' }], version: 1 })
      ]);

      const watch = watchEmits(editor);
      let next = 100;

      const actions = {
        move: () => {
          const node = pick(nodes);
          if (!editor.staging.graph.hasEntity(node.id)) return;
          editor.perform(Rapid.actionMoveNode(node.id, [random() * 0.01, random() * 0.01]));
        },
        tag: () => {
          const entityID = pick(['w1', 'w2', 'w3', 'r1', 'n9']);
          if (!editor.staging.graph.hasEntity(entityID)) return;
          editor.perform(Rapid.actionChangeTags(entityID, { name: `x${Math.floor(random() * 3)}` }));
        },
        addNode: () => {
          const wayID = pick(['w1', 'w2']);
          if (!editor.staging.graph.hasEntity(wayID)) return;
          const node = new Rapid.OsmNode(context, { id: `n-${next++}`, loc: [random() * 0.01, random() * 0.01] });
          editor.perform(Rapid.actionAddEntity(node), Rapid.actionAddVertex(wayID, node.id, 1));
        },
        member: () => {
          if (!editor.staging.graph.hasEntity('r1') || !editor.staging.graph.hasEntity('w3')) return;
          editor.perform(Rapid.actionAddMember('r1', { id: 'w3', type: 'way', role: '' }));
        },
        deleteNode: () => {
          const node = pick(nodes);
          if (!editor.staging.graph.hasEntity(node.id)) return;
          editor.perform(Rapid.actionDeleteNode(node.id));
        },
        commit: () => editor.commit({ stringID: 'edit' }),
        commitAppend: () => { if (editor.index > 0) editor.commitAppend({ stringID: 'edit' }); },
        revert: () => editor.revert(),
        undo: () => editor.undo(),
        redo: () => editor.redo(),
        checkpoint: () => editor.setCheckpoint('cp'),
        restore: () => editor.restoreCheckpoint('cp'),
        transaction: () => {
          editor.beginTransaction();
          actions.move();
          editor.commit({ stringID: 'edit' });
          actions.tag();
          editor.undo();
          actions.move();
          editor.endTransaction();
        }
      };
      const names = Object.keys(actions);

      for (let step = 0; step < 150; step++) {
        const name = pick(names);
        actions[name]();
        const message = `seed ${seed}, step ${step} (${name})`;
        assert.deepEqual(watch.errors, [], message);
        assertSessionDifference(editor, message);
        assertIndexMatchesGeometry(editor, spatial, message);
      }
      assert.isAbove(watch.emits, 50);
    }
  });

  it('rolls staging back when an action throws, and emits nothing', async () => {
    const { context, editor } = await makeEditor();
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], version: 1 })
    ]);
    const w1 = editor.staging.graph.entity('w1');
    const extent = editor.staging.graph.extent(w1).rectangle();

    let emits = 0;
    editor.on('stagingchange', () => emits++);

    const throwing = graph => {
      graph.replace(graph.entity('n2').move([5, 5]));
      graph.commit();
      graph.remove(graph.entity('n1'));
      throw new Error('boom');
    };
    assert.throws(() => editor.perform(throwing), /boom/);

    const graph = editor.staging.graph;
    assert.strictEqual(emits, 0);
    assert.isFalse(graph.isLocal('n1'));
    assert.isFalse(graph.isLocal('n2'));
    assert.deepEqual(graph.entity('n2').loc, [0.001, 0]);
    assert.deepEqual(graph.parentWays(graph.entity('n1')).map(way => way.id), ['w1']);
    assert.deepEqual(graph.extent(w1).rectangle(), extent);

    // The next perform is clean.
    editor.perform(Rapid.actionMoveNode('n1', [0, 0.001]));
    assert.deepEqual(editor.staging.graph.entity('n1').loc, [0, 0.001]);
  });

  it('keeps its original error when an action creates and removes an entity, then throws', async () => {
    const { context, editor } = await makeEditor();
    const n1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0] });
    const throwing = graph => {
      graph.replace(n1).remove(n1);
      throw new Error('original');
    };
    assert.throws(() => editor.perform(throwing), /original/);
    assert.isUndefined(editor.staging.graph.hasEntity('n-1'));
  });

  it('stops listing an edit as created when a tile adds it to base later', async () => {
    const editorA = await makeEditor();
    const data = ctx => [
      new Rapid.OsmNode(ctx, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(ctx, { id: 'n2', loc: [0.001, 0], version: 1 })
    ];
    editorA.editor.merge(data(editorA.context));
    editorA.editor.perform(Rapid.actionMoveNode('n1', [0, 0.001]));
    editorA.editor.commit({ stringID: 'move' });
    const backup = editorA.editor.toBackup();

    // Restored before its base entities can be fetched (there's no OSM service here)
    const { context, editor } = await makeEditor();
    await editor.fromBackupAsync(backup);
    editor.merge(data(context));
    editor.perform(Rapid.actionMoveNode('n2', [0.002, 0]));
    editor.commit({ stringID: 'move2' });

    assertSessionDifference(editor, 'after the tile arrives');
    assert.deepEqual(editor.changes().created, []);
  });

  it('freezes the graphs in the history', async () => {
    const { context, editor } = await makeEditor();
    editor.merge([new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 })]);
    editor.perform(Rapid.actionMoveNode('n1', [0, 0.001]));
    editor.commit({ stringID: 'move' });

    const stable = editor.stable.graph;
    assert.isTrue(stable.isFrozen);
    assert.throws(() => stable.replace(stable.entity('n1').move([1, 1])), /frozen/);
  });

  it('restores a deleted node that downloaded data uses, everywhere (iD#2085)', async () => {
    const { context, editor } = await makeEditor();
    editor.merge([new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 })]);
    editor.perform(Rapid.actionDeleteNode('n1'));
    editor.commit({ stringID: 'delete' });
    assert.isTrue(editor.difference().changes.has('n1'));

    const emitted = [];
    editor.on('stagingchange', difference => emitted.push(...difference.changes.keys()));

    editor.merge([
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], version: 1 })
    ]);

    assert.isOk(editor.stable.graph.hasEntity('n1'));
    assert.isOk(editor.staging.graph.hasEntity('n1'));
    assert.include(emitted, 'n1');
    assert.isFalse(editor.difference().changes.has('n1'));
    const box = editor.staging.graph.geometry(editor.staging.graph.entity('n1')).world.extent.bbox();
    for (const graph of [editor.stable.graph, editor.staging.graph]) {
      assert.include(editor.entitiesInBox(box, graph).map(entity => entity.id), 'n1');
    }
  });


  // A road through n2, and a way arriving later that also uses n2
  async function makeRoad() {
    const { context, editor } = await makeEditor();
    editor.merge([
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], version: 1 })
    ]);
    const arrive = () => editor.merge([
      new Rapid.OsmNode(context, { id: 'n4', loc: [0.001, 0.001], version: 1 }),
      new Rapid.OsmWay(context, { id: 'w2', nodes: ['n2', 'n4'], version: 1 })
    ]);
    return { editor, arrive };
  }

  it('restores a deleted node in an edit the user undid, so redoing it is complete (iD#2085)', async () => {
    const { editor, arrive } = await makeRoad();
    editor.perform(Rapid.actionDeleteNode('n2'));
    editor.commit({ stringID: 'delete' });
    editor.undo();
    arrive();
    editor.redo();

    const graph = editor.stable.graph;
    assert.isOk(graph.hasEntity('n2'));
    assert.deepEqual(graph.childNodes(graph.entity('w2')).map(node => node.id), ['n2', 'n4']);
    assert.deepEqual(graph.entity('w1').nodes, ['n1', 'n3']);   // the user's edit to w1 stays
    assert.deepEqual(graph.verify(), []);
  });

  it('restores a deleted node in an edit kept in a checkpoint (iD#2085)', async () => {
    const { editor, arrive } = await makeRoad();
    editor.perform(Rapid.actionDeleteNode('n2'));
    editor.commit({ stringID: 'delete' });
    editor.setCheckpoint('kept');
    editor.undo();
    editor.perform(Rapid.actionNoop());
    editor.commit({ stringID: 'other' });   // the deleting edit is now only in the checkpoint
    arrive();
    editor.restoreCheckpoint('kept');

    const graph = editor.stable.graph;
    assert.deepEqual(graph.childNodes(graph.entity('w2')).map(node => node.id), ['n2', 'n4']);
    assert.deepEqual(graph.verify(), []);
  });
});
