import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('AbstractSystem', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs an AbstractSystem from a context', () => {
      const a = new Rapid.AbstractSystem(context);
      assert.instanceOf(a, Rapid.AbstractSystem);
      assert.strictEqual(a.id, '');
      assert.strictEqual(a.context, context);
      assert.deepEqual(a.dependencies, new Set());
      assert.isTrue(a.autoStart);
    });
  });

  describe('getters', () => {
    it('gets the systemID/serviceID', () => {
      const a = new Rapid.AbstractSystem(context);
      a.id = 'test';
      assert.strictEqual(a.systemID, 'test');
      assert.strictEqual(a.serviceID, 'test');
    });
  });

  describe('pause/resume', () => {
    it('pauses and resumes', () => {
      const a = new Rapid.AbstractSystem(context);
      assert.isFalse(a.paused);
      a.pause();
      assert.isTrue(a.paused);
      a.resume();
      assert.isFalse(a.paused);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const a = new Rapid.AbstractSystem(context);
      const prom = a.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const a = new Rapid.AbstractSystem(context);
      a.dependencies.add('missing');
      const prom = a.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const a = new Rapid.AbstractSystem(context);
      const prom = a.initAsync().then(() => a.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(a.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const a = new Rapid.AbstractSystem(context);
      const prom = a.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

});
