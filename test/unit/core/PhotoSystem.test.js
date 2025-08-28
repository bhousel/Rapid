import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PhotoSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    editor:   new Rapid.MockSystem(context),
    gfx:      new Rapid.MockGfxSystem(context),
    l10n:     new Rapid.MockSystem(context),
    map:      new Rapid.MockSystem(context),
    urlhash:  new Rapid.UrlHashSystem(context),
    ui:       new Rapid.MockSystem(context)
  };


  describe('constructor', () => {
    it('constructs an PhotoSystem from a context', () => {
      const photos = new Rapid.PhotoSystem(context);
      assert.instanceOf(photos, Rapid.PhotoSystem);
      assert.strictEqual(photos.id, 'photos');
      assert.strictEqual(photos.context, context);
      assert.instanceOf(photos.requiredDependencies, Set);
      assert.instanceOf(photos.optionalDependencies, Set);
      assert.isTrue(photos.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const photos = new Rapid.PhotoSystem(context);
      const prom = photos.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const photos = new Rapid.PhotoSystem(context);
      photos.requiredDependencies.add('missing');
      const prom = photos.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const photos = new Rapid.PhotoSystem(context);
      const prom = photos.initAsync().then(() => photos.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(photos.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const photos = new Rapid.PhotoSystem(context);
      const prom = photos.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
