import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('UrlHashSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n: new Rapid.LocalizationSystem(context),
  };
  context.selectedIDs = () => [];


  describe('constructor', () => {
    it('constructs an UrlHashSystem from a context', () => {
      const urlhash = new Rapid.UrlHashSystem(context);
      assert.instanceOf(urlhash, Rapid.UrlHashSystem);
      assert.strictEqual(urlhash.id, 'urlhash');
      assert.strictEqual(urlhash.context, context);
      assert.instanceOf(urlhash.requiredDependencies, Set);
      assert.instanceOf(urlhash.optionalDependencies, Set);
      assert.isTrue(urlhash.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const urlhash = new Rapid.UrlHashSystem(context);
      const prom = urlhash.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const urlhash = new Rapid.UrlHashSystem(context);
      urlhash.requiredDependencies.add('missing');
      const prom = urlhash.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const urlhash = new Rapid.UrlHashSystem(context);
      const prom = urlhash.initAsync().then(() => urlhash.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(urlhash.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const urlhash = new Rapid.UrlHashSystem(context);
      const prom = urlhash.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
