import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// Bugs from design/graph-geometry.md ("Bugs found while measuring") that later rollout steps fix.
// Each test is a `todo` until its step lands: bun runs them only with `--todo`, and they fail today.
// When a step lands, drop `.todo` from its tests.
//
// Readers move to `graph.geometry(entity)` / `graph.extent(entity)` in step 2, and step 4 makes
// `entity.geoms` throw on ways and relations, so these helpers ask the graph when it can answer.

function extentIn(graph, entity) {
  return (typeof graph.extent === 'function') ? graph.extent(entity) : entity.extent();
}

function geometryIn(graph, entity) {
  return (typeof graph.geometry === 'function') ? graph.geometry(entity) : entity.geoms;
}

function rounded(extent) {
  return [...extent.min, ...extent.max].map(n => Math.round(n * 1e6) / 1e6 + 0);   // `+ 0` turns -0 into 0
}

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

function indexBox(spatial, spatialID, id) {
  const item = spatial.getCache(spatialID).items.get(id);
  return item ? [item.minX, item.minY, item.maxX, item.maxY].map(n => Math.round(n)) : null;
}


describe('Graph bugs pinned for later steps', () => {

  describe('step 1: change journal', () => {
    it('step 1: commit builds nested relations members first', () => {
      const context = new Rapid.MockContext();
      const base = new Rapid.Graph(context);
      // A border way in a country boundary and its state subarea.
      // The country has the lower ID, so the base caches list it first.
      base.rebase([
        new Rapid.OsmNode(context, { id: 'p1', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'p2', loc: [0, 10] }),
        new Rapid.OsmNode(context, { id: 'p3', loc: [10, 10] }),
        new Rapid.OsmWay(context, { id: 'wb', nodes: ['p1', 'p2', 'p3'], tags: { boundary: 'administrative' } }),
        new Rapid.OsmRelation(context, {
          id: 'r1',
          tags: { type: 'boundary', boundary: 'administrative', admin_level: '2' },
          members: [{ id: 'wb', type: 'way', role: 'outer' }, { id: 'r2', type: 'relation', role: 'subarea' }]
        }),
        new Rapid.OsmRelation(context, {
          id: 'r2',
          tags: { type: 'boundary', boundary: 'administrative', admin_level: '4' },
          members: [{ id: 'wb', type: 'way', role: 'outer' }]
        })
      ], [], false);

      const staging = new Rapid.Graph(base);
      Rapid.actionMoveNode('p3', [5, 5])(staging);
      staging.commit();

      assert.deepEqual(rounded(extentIn(staging, staging.entity('r2'))), [0, 0, 5, 10]);
      assert.deepEqual(rounded(extentIn(staging, staging.entity('r1'))), [0, 0, 5, 10]);
    });

    it('step 1: complete() includes the members of a changed route relation', () => {
      const context = new Rapid.MockContext();
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.001, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b'], tags: { highway: 'residential' } }),
        new Rapid.OsmRelation(context, {
          id: 'r1',
          tags: { type: 'route', route: 'bus' },
          members: [{ id: '-', type: 'way', role: '' }]
        })
      ]);

      // The user adds node `b` to the bus route as a stop.
      const head = new Rapid.Graph(base);
      head.replace(head.entity('r1').addMember({ id: 'b', type: 'node', role: 'stop' })).commit();

      assert.isTrue(new Rapid.Difference(base, head).complete().has('b'));
    });

    it('step 1: after undo, the staging index has the way where it is drawn', async () => {
      const { editor, spatial } = await makeEditor();
      editor.merge([
        new Rapid.OsmNode(editor.context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(editor.context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(editor.context, { id: 'w1', nodes: ['n1', 'n2'], version: 1, tags: { highway: 'residential' } })
      ]);
      const start = indexBox(spatial, 'editor_staging', 'w1');

      editor.perform(Rapid.actionMoveNode('n2', [0.01, 0.01]));
      editor.commit({ stringID: 'move' });
      assert.notDeepEqual(indexBox(spatial, 'editor_staging', 'w1'), start);

      editor.undo();
      const graph = editor.staging.graph;
      const w1 = graph.entity('w1');
      assert.deepEqual(indexBox(spatial, 'editor_staging', 'w1'), start);
      assert.deepEqual(rounded(extentIn(graph, w1)), [0, 0, 0.001, 0]);
    });

    it('step 1: after a revert (MoveMode), the staging index has the way where it is drawn', async () => {
      const { editor, spatial } = await makeEditor();
      editor.merge([
        new Rapid.OsmNode(editor.context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(editor.context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(editor.context, { id: 'w1', nodes: ['n1', 'n2'], version: 1, tags: { highway: 'residential' } })
      ]);
      const start = indexBox(spatial, 'editor_staging', 'w1');

      // MoveMode reverts the last frame before it performs the next one.
      editor.perform(Rapid.actionMoveNode('n2', [0.01, 0.01]));
      editor.revert();
      assert.deepEqual(indexBox(spatial, 'editor_staging', 'w1'), start);
      assert.deepEqual(rounded(extentIn(editor.staging.graph, editor.staging.graph.entity('w1'))), [0, 0, 0.001, 0]);
    });

    it('step 1: a perform takes no snapshots of the graph', async () => {
      const { editor } = await makeEditor();
      editor.merge([
        new Rapid.OsmNode(editor.context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(editor.context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmNode(editor.context, { id: 'n3', loc: [0.001, 0.001], version: 1 }),
        new Rapid.OsmWay(editor.context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n1'], tags: { building: 'yes' }, version: 1 })
      ]);

      const proto = Rapid.Graph.prototype;
      const original = proto.snapshot;
      let snapshots = 0;
      if (original) {
        proto.snapshot = function(...args) {
          snapshots++;
          return original.apply(this, args);
        };
      }
      try {
        editor.perform(Rapid.actionMoveNode('n2', [0.0011, 0]));   // one drag pointermove
      } finally {
        if (original) proto.snapshot = original;
      }

      assert.strictEqual(editor.staging.graph.entity('n2').loc[0], 0.0011);
      assert.strictEqual(snapshots, 0);
    });
  });


  describe('step 2: memos keyed by their graph inputs', () => {
    function setupVertex() {
      const context = new Rapid.MockContext();
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const c = new Rapid.OsmNode(context, { id: 'c', loc: [2, 0] });
      const d = new Rapid.OsmNode(context, { id: 'd', loc: [1, 1] });
      const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['a', 'b', 'c'], tags: { highway: 'residential' } });
      const base = new Rapid.Graph(context, [a, b, c, d, w1]);
      const staging = new Rapid.Graph(base);
      // The user draws a new road starting at `b` (`b` itself is unchanged, so both graphs hold it)
      // and one from `d`, which was a standalone point.
      staging.replace(new Rapid.OsmWay(context, { id: 'w2', nodes: ['b', 'd'], tags: { highway: 'residential' } }));
      staging.commit();
      return { base, staging, b, d };
    }

    it('step 2: node geometry (point or vertex) answers for the graph asked', () => {
      const { base, staging, d } = setupVertex();
      assert.strictEqual(staging.entity('d'), d);
      assert.strictEqual(d.geometry(base), 'point');
      assert.strictEqual(d.geometry(staging), 'vertex');
    });

    it('step 2: isEndpoint answers for the graph asked', () => {
      const { base, staging, b } = setupVertex();
      assert.isFalse(b.isEndpoint(base));
      assert.isTrue(b.isEndpoint(staging));
    });

    it('step 2: presetMatch answers for the graph asked', () => {
      const context = new Rapid.MockContext();
      const schema = new Rapid.SchemaSystem(context);
      context.systems.schema = schema;
      schema.resetAll();
      schema.merge({ assetID: 'mini', scopes: [{ scope: 'osm', presets: {
        'highway/crossing': { tags: { highway: 'crossing' }, geometry: ['vertex'], name: 'Crossing' }
      }}]});

      // A crossing node that is a standalone point in base and a vertex in staging
      const x = new Rapid.OsmNode(context, { id: 'x', loc: [9, 9], tags: { highway: 'crossing' } });
      const y = new Rapid.OsmNode(context, { id: 'y', loc: [9, 8] });
      const base = new Rapid.Graph(context, [x, y]);
      const staging = new Rapid.Graph(base);
      staging.replace(new Rapid.OsmWay(context, { id: 'w9', nodes: ['x', 'y'], tags: { highway: 'footway' } }));
      staging.commit();

      assert.strictEqual(schema.match(x, base)?.id, 'point');
      assert.strictEqual(schema.match(x, staging)?.id, 'highway/crossing');
    });

    it('step 2: presetMatch sees a schema change', () => {
      const context = new Rapid.MockContext();
      const schema = new Rapid.SchemaSystem(context);
      context.systems.schema = schema;
      schema.resetAll();
      schema.merge({ assetID: 's1', scopes: [{ scope: 'osm', presets: {
        'building': { tags: { building: '*' }, geometry: ['area'], name: 'Building' }
      }}]});

      const p = new Rapid.OsmNode(context, { id: 'p', loc: [0, 0], tags: { building: 'yes' } });
      const graph = new Rapid.Graph(context, [p]);
      assert.strictEqual(schema.match(p, graph)?.id, 'point');

      schema.merge({ assetID: 's2', scopes: [{ scope: 'osm', presets: {
        'building_point': { tags: { building: '*' }, geometry: ['point'], name: 'Building Point', matchScore: 2 }
      }}]});
      assert.strictEqual(schema.match(p, graph)?.id, 'building_point');
    });
  });


  describe('step 3: graphs share structure', () => {
    it.todo('step 3: parentWays works after a forced update of a way the user deleted', async () => {
      const { editor } = await makeEditor();
      const context = editor.context;
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }, version: 1 })
      ]);
      editor.perform(Rapid.actionDeleteWay('w1'));
      editor.commit({ stringID: 'deleted' });

      // The uploader keeps the user's deletion of a way another mapper extended.
      editor.updateBase([
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' }, version: 2 }),
        new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 })
      ]);

      const staging = editor.staging.graph;
      assert.isUndefined(staging.hasEntity('w1'));
      const n3 = staging.entity('n3');
      assert.deepEqual(staging.parentWays(n3).map(way => way.id), []);
    });
  });


  describe('step 1: operation counts', () => {
    it('step 1: a perform does work that does not grow with the number of edits', async () => {
      // Count the Map entries visited (copied, diffed, scanned) during one drag pointermove.
      const proto = Map.prototype;
      const originals = {
        iterator: proto[Symbol.iterator],
        entries: proto.entries,
        keys: proto.keys,
        values: proto.values,
        forEach: proto.forEach
      };
      let visited = 0;
      function* counting(iter) {
        for (const item of iter) {
          visited++;
          yield item;
        }
      }
      function countMapVisits(fn) {
        visited = 0;
        proto[Symbol.iterator] = function() { return counting(originals.iterator.call(this)); };
        proto.entries = function() { return counting(originals.entries.call(this)); };
        proto.keys = function() { return counting(originals.keys.call(this)); };
        proto.values = function() { return counting(originals.values.call(this)); };
        proto.forEach = function(cb, thisArg) {
          return originals.forEach.call(this, (...args) => { visited++; cb.apply(thisArg, args); });
        };
        try {
          fn();
        } finally {
          proto[Symbol.iterator] = originals.iterator;
          proto.entries = originals.entries;
          proto.keys = originals.keys;
          proto.values = originals.values;
          proto.forEach = originals.forEach;
        }
        return visited;
      }

      const { editor } = await makeEditor();
      const context = editor.context;
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }, version: 1 })
      ]);

      let next = 0;
      function addEdits(count) {
        const nodes = [];
        for (let i = 0; i < count; i++) {
          nodes.push(new Rapid.OsmNode(context, { id: `n-${++next}`, loc: [1 + i * 1e-5, 1] }));
        }
        editor.perform(graph => graph.replace(nodes));
        editor.commit({ stringID: 'add nodes' });
      }

      addEdits(200);
      let x = 0.0011;
      const small = countMapVisits(() => editor.perform(Rapid.actionMoveNode('n2', [x += 0.0001, 0])));
      addEdits(1800);
      const large = countMapVisits(() => editor.perform(Rapid.actionMoveNode('n2', [x += 0.0001, 0])));

      assert.strictEqual(editor.staging.graph.entity('n2').loc[0], x);
      // 10x the edits; the work for one perform should stay about the same.
      assert.isBelow(large, small * 2, `visited ${small} Map entries at 200 edits, ${large} at 2000`);
    });
  });


  describe('step 4: derived data in records', () => {
    it.todo('step 4: a way keeps its shape in base and stable while staging moves its node', () => {
      const context = new Rapid.MockContext();
      const a = new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] });
      const b = new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] });
      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b'] });
      const base = new Rapid.Graph(context, [a, b, w]);
      const stable = new Rapid.Graph(base);
      const staging = new Rapid.Graph(stable);

      staging.replace(b.move([5, 5]));
      staging.commit();

      assert.deepEqual(rounded(extentIn(staging, staging.entity('w'))), [0, 0, 5, 5]);
      assert.deepEqual(rounded(extentIn(stable, stable.entity('w'))), [0, 0, 1, 0]);
      assert.deepEqual(rounded(extentIn(base, base.entity('w'))), [0, 0, 1, 0]);
    });

    it.todo('step 4: validators on stable see stable\'s shapes while the user drags in staging', async () => {
      const { editor } = await makeEditor();
      const context = editor.context;
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }, version: 1 })
      ]);

      editor.perform(Rapid.actionMoveNode('n2', [0.01, 0.01]));   // not committed yet

      const stable = editor.stable.graph;
      const staging = editor.staging.graph;
      assert.deepEqual(rounded(extentIn(staging, staging.entity('w1'))), [0, 0, 0.01, 0.01]);
      assert.deepEqual(rounded(extentIn(stable, stable.entity('w1'))), [0, 0, 0.001, 0]);
    });
  });


  describe('step 5: rebase and schema changes', () => {
    it.todo('step 5: a multipolygon gets the members that arrive in a later tile', () => {
      const context = new Rapid.MockContext();
      const base = new Rapid.Graph(context);
      // First tile: the relation and its first outer ring
      base.rebase([
        new Rapid.OsmNode(context, { id: 'a1', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'a2', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'a3', loc: [1, 1] }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['a1', 'a2', 'a3', 'a1'] }),
        new Rapid.OsmRelation(context, {
          id: 'r1',
          tags: { type: 'multipolygon', building: 'yes' },
          members: [{ id: 'w1', type: 'way', role: 'outer' }, { id: 'w2', type: 'way', role: 'outer' }]
        })
      ], [], false);
      const staging = new Rapid.Graph(base);

      // Second tile: the other outer ring
      base.rebase([
        new Rapid.OsmNode(context, { id: 'b1', loc: [5, 5] }),
        new Rapid.OsmNode(context, { id: 'b2', loc: [6, 5] }),
        new Rapid.OsmNode(context, { id: 'b3', loc: [6, 6] }),
        new Rapid.OsmWay(context, { id: 'w2', nodes: ['b1', 'b2', 'b3', 'b1'] })
      ], [staging], false);

      for (const graph of [base, staging]) {
        const r1 = graph.entity('r1');
        assert.lengthOf(geometryIn(graph, r1).parts, 2);
        assert.deepEqual(rounded(extentIn(graph, r1)), [0, 0, 6, 6]);
      }
    });

    it.todo('step 5: a downloaded way through a node the user moved has the moved shape', async () => {
      const { editor } = await makeEditor();
      const context = editor.context;
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }, version: 1 })
      ]);
      editor.perform(Rapid.actionMoveNode('n2', [0.002, 0.002]));
      editor.commit({ stringID: 'move' });

      // A later tile brings a way through the moved node.
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n3', loc: [0.003, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w2', nodes: ['n2', 'n3'], tags: { highway: 'service' }, version: 1 })
      ]);

      for (const graph of [editor.stable.graph, editor.staging.graph]) {
        const w2 = graph.entity('w2');
        assert.deepEqual(rounded(extentIn(graph, w2)), [0.002, 0, 0.003, 0.002]);
      }
      const base = editor.base.graph;
      assert.deepEqual(rounded(extentIn(base, base.entity('w2'))), [0.001, 0, 0.003, 0]);
    });

    it.todo('step 5: a building is an area after the schema reloads', () => {
      const context = new Rapid.MockContext();
      const schema = new Rapid.SchemaSystem(context);
      context.systems.schema = schema;
      const buildingSchema = (assetID) => ({ assetID: assetID, scopes: [{ scope: 'osm', presets: {
        'building': { tags: { building: '*' }, geometry: ['area'], name: 'Building' }
      }}]});
      schema.resetAll();
      schema.merge(buildingSchema('s1'));

      const w = new Rapid.OsmWay(context, { id: 'w', nodes: ['a', 'b', 'c', 'a'], tags: { building: 'yes' } });
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [1, 1] }),
        w
      ]);
      const staging = new Rapid.Graph(base);
      // The parts of EditSystem that `SchemaSystem.resetAll` reads
      context.systems.editor = { base: { graph: base }, staging: { graph: staging }, _history: [] };
      assert.strictEqual(geometryIn(base, w).parts[0].type, 'Polygon');

      // A runtime schema reload (e.g. a locale change) resets, then the assets load again.
      schema.resetAll();
      schema.merge(buildingSchema('s2'));

      assert.strictEqual(w.geometry(base), 'area');
      assert.strictEqual(geometryIn(base, w).parts[0].type, 'Polygon');
    });

    it.todo('step 5: merging remote changes into a way emits a merge for the nodes it pulls in', async () => {
      const { editor, spatial } = await makeEditor();
      const context = editor.context;
      editor.merge([
        new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], version: 1 }),
        new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0], version: 1 }),
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' }, version: 1 })
      ]);
      editor.perform(Rapid.actionChangeTags('w1', { highway: 'residential', name: 'Main Street' }));
      editor.commit({ stringID: 'name it' });

      // Another mapper extended the way with a new node.
      const n3 = new Rapid.OsmNode(context, { id: 'n3', loc: [0.002, 0], version: 1 });
      const remoteGraph = new Rapid.Graph(context, [
        editor.base.graph.entity('n1'),
        editor.base.graph.entity('n2'),
        n3,
        new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' }, version: 2 })
      ]);

      const mergedIDs = new Set();
      editor.on('merge', ids => { for (const id of ids) mergedIDs.add(id); });
      const action = Rapid.actionMergeRemoteChanges('w1', {
        localGraph: editor.staging.graph,
        remoteGraph: remoteGraph,
        discardTags: { created_by: true }
      });
      editor.perform(action);

      const staging = editor.staging.graph;
      assert.deepEqual(action.conflicts(), []);
      assert.deepEqual(staging.entity('w1').nodes, ['n1', 'n2', 'n3']);
      assert.isTrue(mergedIDs.has('n3'));

      // The rebase put n3 in the base graph, so the base and stable indexes should have it too.
      assert.isOk(editor.base.graph.hasEntity('n3'));
      assert.isNotNull(indexBox(spatial, 'editor_base', 'n3'));
      assert.isNotNull(indexBox(spatial, 'editor_stable', 'n3'));
      // The staging index has w1 where it's drawn now, reaching n3.
      assert.deepEqual(indexBox(spatial, 'editor_staging', 'w1')[2], indexBox(spatial, 'editor_staging', 'n3')[2]);
    });
  });

});
