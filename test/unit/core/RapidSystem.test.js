import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('RapidSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an RapidSystem from a context', () => {
        const rapid = new Rapid.RapidSystem(context);
        assert.instanceOf(rapid, Rapid.RapidSystem);
        assert.strictEqual(rapid.id, 'rapid');
        assert.strictEqual(rapid.context, context);
        assert.instanceOf(rapid.requiredDependencies, Set);
        assert.instanceOf(rapid.optionalDependencies, Set);
        assert.isTrue(rapid.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const rapid = new Rapid.RapidSystem(context);
        rapid.requiredDependencies.add('missing');
        const prom = rapid.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.initAsync().then(() => rapid.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(rapid.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const rapid = new Rapid.RapidSystem(context);
        const prom = rapid.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _rapid;

    before(() => {
      _rapid = new Rapid.RapidSystem(context);
      return _rapid.initAsync().then(() => _rapid.startAsync());
    });
  });

});
