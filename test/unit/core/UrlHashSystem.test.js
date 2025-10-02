import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('UrlHashSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    l10n: new Rapid.LocalizationSystem(context),
  };
  context.selectedIDs = () => [];


  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a UrlHashSystem from a context', () => {
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
      it('returns a promise to init', () => {
        const urlhash = new Rapid.UrlHashSystem(context);
        const prom = urlhash.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
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
          .then(val => assert.isTrue(urlhash.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const urlhash = new Rapid.UrlHashSystem(context);
        const prom = urlhash.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _urlhash;

    before(() => {
      _urlhash = new Rapid.UrlHashSystem(context);
      return _urlhash.initAsync().then(() => _urlhash.startAsync());
    });
  });

});
