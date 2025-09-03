import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PhotoSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
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
      it('returns a promise to init', () => {
        const photos = new Rapid.PhotoSystem(context);
        const prom = photos.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
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
          .then(val => assert.isTrue(photos.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const photos = new Rapid.PhotoSystem(context);
        const prom = photos.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _photos;

    before(() => {
      _photos = new Rapid.PhotoSystem(context);
      return _photos.initAsync().then(() => _photos.startAsync());
    });
  });

});
