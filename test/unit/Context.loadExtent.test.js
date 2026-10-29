import { describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../modules/headless.js';
import { Context } from '../../modules/Context.ts';

// Context's extent loading, against a stand-in context (a real one needs every system).
describe('Context.loadExtentAsync', () => {
  const extent = new Rapid.sdk.Extent([-74.1, 40.6], [-74, 40.7]);
  const results = { data: [{ type: 'node', id: 'n1' }] };

  function standIn() {
    const ctx = Object.create(Context.prototype);
    ctx._keptExtents = new Map();
    ctx._resetPromise = null;
    ctx.systems = { editor: { merge: mock(), resetAsync: () => Promise.resolve() } };
    ctx.services = { osm: { loadExtentAsync: mock(() => Promise.resolve(results)), resetAsync: () => Promise.resolve() } };
    return ctx;
  }

  it('loads an extent and merges it into the editor', () => {
    const ctx = standIn();
    return ctx.loadExtentAsync(extent, { timeout: 120000 })
      .then(() => {
        assert.deepEqual(ctx.services.osm.loadExtentAsync.mock.calls[0], [extent, { timeout: 120000 }]);
        assert.deepEqual(ctx.systems.editor.merge.mock.calls[0], [results.data]);
      });
  });

  it('loads a kept extent again after each reset, until cleared', () => {
    const ctx = standIn();
    return ctx.loadExtentAsync(extent, { keep: true })
      .then(() => ctx.resetAsync())
      .then(() => assert.strictEqual(ctx.services.osm.loadExtentAsync.mock.calls.length, 2))
      .then(() => {
        ctx.clearKeptExtents();
        return ctx.resetAsync();
      })
      .then(() => assert.strictEqual(ctx.services.osm.loadExtentAsync.mock.calls.length, 2));
  });

  it('does nothing without an OSM service', () => {
    const ctx = standIn();
    ctx.services = {};
    return ctx.loadExtentAsync(extent).then(() => assert.strictEqual(ctx.systems.editor.merge.mock.calls.length, 0));
  });
});
