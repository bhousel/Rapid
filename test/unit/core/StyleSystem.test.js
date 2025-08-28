import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('StyleSystem', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets: new Rapid.MockSystem(context)
  };


  describe('constructor', () => {
    it('constructs an StyleSystem from a context', () => {
      const styles = new Rapid.StyleSystem(context);
      assert.instanceOf(styles, Rapid.StyleSystem);
      assert.strictEqual(styles.id, 'styles');
      assert.strictEqual(styles.context, context);
      assert.instanceOf(styles.requiredDependencies, Set);
      assert.instanceOf(styles.optionalDependencies, Set);
      assert.isTrue(styles.autoStart);
    });
  });

  describe('initAsync', () => {
    it('returns an promise to init', () => {
      const styles = new Rapid.StyleSystem(context);
      const prom = styles.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const styles = new Rapid.StyleSystem(context);
      styles.requiredDependencies.add('missing');
      const prom = styles.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const styles = new Rapid.StyleSystem(context);
      const prom = styles.initAsync().then(() => styles.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(styles.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const styles = new Rapid.StyleSystem(context);
      const prom = styles.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });
});
