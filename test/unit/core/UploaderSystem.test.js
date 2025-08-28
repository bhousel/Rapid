import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('UploaderSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    editor:   new Rapid.MockSystem(context),
    l10n:     new Rapid.MockSystem(context),
    spatial:  new Rapid.MockSystem(context)
  };


  describe('constructor', () => {
    it('constructs an UploaderSystem from a context', () => {
      const uploader = new Rapid.UploaderSystem(context);
      assert.instanceOf(uploader, Rapid.UploaderSystem);
      assert.strictEqual(uploader.id, 'uploader');
      assert.strictEqual(uploader.context, context);
      assert.instanceOf(uploader.requiredDependencies, Set);
      assert.instanceOf(uploader.optionalDependencies, Set);
      assert.isTrue(uploader.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const uploader = new Rapid.UploaderSystem(context);
      const prom = uploader.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const uploader = new Rapid.UploaderSystem(context);
      uploader.requiredDependencies.add('missing');
      const prom = uploader.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const uploader = new Rapid.UploaderSystem(context);
      const prom = uploader.initAsync().then(() => uploader.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(uploader.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const uploader = new Rapid.UploaderSystem(context);
      const prom = uploader.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
