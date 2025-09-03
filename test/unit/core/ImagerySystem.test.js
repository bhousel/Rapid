import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('ImagerySystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    l10n:     new Rapid.LocalizationSystem(context)
  };

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an ImagerySystem from a context', () => {
        const imagery = new Rapid.ImagerySystem(context);
        assert.instanceOf(imagery, Rapid.ImagerySystem);
        assert.strictEqual(imagery.id, 'imagery');
        assert.strictEqual(imagery.context, context);
        assert.instanceOf(imagery.requiredDependencies, Set);
        assert.instanceOf(imagery.optionalDependencies, Set);
        assert.isTrue(imagery.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const imagery = new Rapid.ImagerySystem(context);
        imagery.requiredDependencies.add('missing');
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
          .then(val => assert.isTrue(imagery.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const imagery = new Rapid.ImagerySystem(context);
        const prom = imagery.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _imagery;

    before(() => {
      _imagery = new Rapid.ImagerySystem(context);
      return _imagery.initAsync().then(() => _imagery.startAsync());
    });
  });

});
