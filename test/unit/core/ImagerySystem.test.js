import { after, before, describe, it } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('ImagerySystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    editor:   new Rapid.MockSystem(context),
    gfx:      new Rapid.MockGfxSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    map:      new Rapid.MockSystem(context),
    storage:  new Rapid.StorageSystem(context),
    urlhash:  new Rapid.UrlHashSystem(context)
  };


  describe('constructor', () => {
    it('constructs an ImagerySystem from a context', () => {
      const imagery = new Rapid.ImagerySystem(context);
      assert.instanceOf(imagery, Rapid.ImagerySystem);
      assert.strictEqual(imagery.id, 'imagery');
      assert.strictEqual(imagery.context, context);
      assert.instanceOf(imagery.dependencies, Set);
      assert.isTrue(imagery.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const imagery = new Rapid.ImagerySystem(context);
      const prom = imagery.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const imagery = new Rapid.ImagerySystem(context);
      imagery.dependencies.add('missing');
      const prom = imagery.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const imagery = new Rapid.ImagerySystem(context);
      const prom = imagery.initAsync().then(() => imagery.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(imagery.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const imagery = new Rapid.ImagerySystem(context);
      const prom = imagery.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
