import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('SpatialSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an SpatialSystem from a context', () => {
        const spatial = new Rapid.SpatialSystem(context);
        assert.instanceOf(spatial, Rapid.SpatialSystem);
        assert.strictEqual(spatial.id, 'spatial');
        assert.strictEqual(spatial.context, context);
        assert.instanceOf(spatial.requiredDependencies, Set);
        assert.instanceOf(spatial.optionalDependencies, Set);
        assert.isTrue(spatial.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const spatial = new Rapid.SpatialSystem(context);
        spatial.requiredDependencies.add('missing');
        const prom = spatial.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.initAsync().then(() => spatial.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(spatial.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const spatial = new Rapid.SpatialSystem(context);
        const prom = spatial.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _spatial;

    before(() => {
      _spatial = new Rapid.SpatialSystem(context);
      return _spatial.initAsync().then(() => _spatial.startAsync());
    });
  });

});
