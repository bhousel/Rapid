import { afterEach, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('DragAndDropSystem', () => {
  let context;
  let dragdrop;

  function makeFile(name, type = '') {
    return new File(['x'], name, { type });
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    dragdrop = new Rapid.DragAndDropSystem(context);
    context.systems.dragdrop = dragdrop;
  });

  afterEach(() => {
    for (const id of dragdrop.consumerIDs) dragdrop.unregister(id);
  });


  describe('lifecycle', () => {
    it('constructs a DragAndDropSystem from a context', () => {
      const dd = new Rapid.DragAndDropSystem(context);
      assert.instanceOf(dd, Rapid.DragAndDropSystem);
      assert.strictEqual(dd.id, 'dragdrop');
    });

    it('inits and starts (no-op without a DOM container)', async () => {
      await dragdrop.initAsync();
      await dragdrop.startAsync();
      assert.isTrue(dragdrop.started);
    });
  });


  describe('registry', () => {
    it('registers and unregisters consumers', () => {
      dragdrop.register({ id: 'a', priority: 0, handle() {} });
      assert.include(dragdrop.consumerIDs, 'a');
      dragdrop.unregister('a');
      assert.notInclude(dragdrop.consumerIDs, 'a');
    });

    it('throws when a consumer has no id', () => {
      assert.throws(() => dragdrop.register({ priority: 0, handle() {} }), /requires an id/);
    });

    it('replaces a consumer registered with the same id', () => {
      dragdrop.register({ id: 'a', priority: 0, handle() {} });
      dragdrop.register({ id: 'a', priority: 5, handle() {} });
      assert.lengthOf(dragdrop.consumerIDs.filter(id => id === 'a'), 1);
    });
  });


  describe('file categorization', () => {
    async function kindOf(name, type = '') {
      let seen;
      dragdrop.register({
        id: 'probe', priority: 0,
        handle: (p) => { seen = p.files[0].kind; p.claim(); }
      });
      await dragdrop.dropFilesAsync([makeFile(name, type)]);
      return seen;
    }

    it('classifies geo-data files as data', async () => {
      assert.strictEqual(await kindOf('x.geojson'), 'data');
      assert.strictEqual(await kindOf('x.gpx'), 'data');
      assert.strictEqual(await kindOf('x.kml'), 'data');
      assert.strictEqual(await kindOf('x.json'), 'data');
    });

    it('classifies image files as image', async () => {
      assert.strictEqual(await kindOf('x.jpg'), 'image');
      assert.strictEqual(await kindOf('photo.PNG'), 'image');
      assert.strictEqual(await kindOf('noext', 'image/jpeg'), 'image');
    });

    it('classifies unknown files as other', async () => {
      assert.strictEqual(await kindOf('notes.txt'), 'other');
      assert.strictEqual(await kindOf('archive.zip'), 'other');
    });

    it('exposes data/images convenience subsets and lowercased extension', async () => {
      let payload;
      dragdrop.register({ id: 'probe', priority: 0, handle: (p) => { payload = p; p.claim(); } });
      await dragdrop.dropFilesAsync([makeFile('a.GeoJSON'), makeFile('b.png'), makeFile('c.txt')]);

      assert.lengthOf(payload.files, 3);
      assert.deepEqual(payload.data.map(d => d.file.name), ['a.GeoJSON']);
      assert.deepEqual(payload.images.map(d => d.file.name), ['b.png']);
      assert.strictEqual(payload.data[0].extension, '.geojson');
    });
  });


  describe('claim routing', () => {
    it('offers consumers in descending priority order, first claimer wins', async () => {
      const calls = [];
      dragdrop.register({ id: 'low', priority: 0, handle: (p) => { calls.push('low'); p.claim(); } });
      dragdrop.register({ id: 'high', priority: 100, handle: (p) => { calls.push('high'); p.claim(); } });

      await dragdrop.dropFilesAsync([makeFile('x.geojson')]);
      assert.deepEqual(calls, ['high']);   // high ran and claimed; low never offered
    });

    it('falls through to the next consumer when a higher one declines', async () => {
      const calls = [];
      dragdrop.register({ id: 'low', priority: 0, handle: (p) => { calls.push('low'); p.claim(); } });
      dragdrop.register({ id: 'high', priority: 100, handle: () => { calls.push('high'); /* declines */ } });

      await dragdrop.dropFilesAsync([makeFile('x.geojson')]);
      assert.deepEqual(calls, ['high', 'low']);   // high inspected+declined, low claimed
    });

    it('does nothing when no consumer claims', async () => {
      let ran = false;
      dragdrop.register({ id: 'peek', priority: 0, handle: () => { ran = true; /* never claims */ } });
      await dragdrop.dropFilesAsync([makeFile('x.geojson')]);
      assert.isTrue(ran);   // it was offered, but nothing happened downstream (no claim)
    });

    it('skips handle when the sync accepts pre-filter returns false', async () => {
      let handled = false;
      dragdrop.register({
        id: 'images-only', priority: 0,
        accepts: (p) => p.images.length > 0,
        handle: (p) => { handled = true; p.claim(); }
      });
      await dragdrop.dropFilesAsync([makeFile('x.geojson')]);   // no images
      assert.isFalse(handled);
    });

    it('awaits an async handle before checking the claim', async () => {
      const calls = [];
      dragdrop.register({
        id: 'high', priority: 100,
        handle: async (p) => {
          await new Promise(r => { setTimeout(r, 5); });
          calls.push('high');
          p.claim();
        }
      });
      dragdrop.register({ id: 'low', priority: 0, handle: (p) => { calls.push('low'); p.claim(); } });

      await dragdrop.dropFilesAsync([makeFile('x.geojson')]);
      assert.deepEqual(calls, ['high']);   // low was not called — async claim was awaited
    });

    it('passes all dropped files so a consumer can pick', async () => {
      let names;
      dragdrop.register({
        id: 'probe', priority: 0,
        handle: (p) => { names = p.files.map(d => d.file.name); p.claim(); }
      });
      await dragdrop.dropFilesAsync([makeFile('a.geojson'), makeFile('b.gpx')]);
      assert.deepEqual(names, ['a.geojson', 'b.gpx']);
    });

    it('does nothing for an empty drop', async () => {
      let ran = false;
      dragdrop.register({ id: 'probe', priority: 0, handle: () => { ran = true; } });
      await dragdrop.dropFilesAsync([]);
      assert.isFalse(ran);
    });
  });


  describe('concurrent drops', () => {
    it('ignores a second drop while one is being processed', async () => {
      const handled = [];
      dragdrop.register({
        id: 'slow', priority: 0,
        handle: async (p) => {
          await new Promise(r => { setTimeout(r, 20); });
          handled.push(p.files[0].file.name);
          p.claim();
        }
      });

      const first = dragdrop.dropFilesAsync([makeFile('first.geojson')]);
      const second = dragdrop.dropFilesAsync([makeFile('second.geojson')]);   // arrives mid-processing
      await Promise.all([first, second]);

      assert.deepEqual(handled, ['first.geojson']);   // second was ignored
    });
  });
});
