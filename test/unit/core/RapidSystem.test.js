import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('RapidSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:   new Rapid.AssetSystem(context),
    editor:   new Rapid.MockSystem(context),
    l10n:     new Rapid.MockSystem(context),
    map:      new Rapid.MockSystem(context),
    urlhash:  new Rapid.UrlHashSystem(context),
  };


  describe('constructor', () => {
    it('constructs an RapidSystem from a context', () => {
      const rapid = new Rapid.RapidSystem(context);
      assert.instanceOf(rapid, Rapid.RapidSystem);
      assert.strictEqual(rapid.id, 'rapid');
      assert.strictEqual(rapid.context, context);
      assert.instanceOf(rapid.dependencies, Set);
      assert.isTrue(rapid.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const rapid = new Rapid.RapidSystem(context);
      const prom = rapid.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const rapid = new Rapid.RapidSystem(context);
      rapid.dependencies.add('missing');
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
        .then(val => assert.isTrue(rapid.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const rapid = new Rapid.RapidSystem(context);
      const prom = rapid.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
