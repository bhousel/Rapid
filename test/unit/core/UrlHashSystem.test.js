import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('UrlHashSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
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
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const urlhash = new Rapid.UrlHashSystem(context);
        urlhash.requiredDependencies.add('missing');
        const prom = urlhash.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const urlhash = new Rapid.UrlHashSystem(context);
        const prom = urlhash.initAsync().then(() => urlhash.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(urlhash.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const urlhash = new Rapid.UrlHashSystem(context);
        const prom = urlhash.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _urlhash;

    beforeAll(() => {
      _urlhash = new Rapid.UrlHashSystem(context);
      return _urlhash.initAsync().then(() => _urlhash.startAsync());
    });

    describe('initialHashParams', () => {
      it('returns the initial hash parameters', () => {
        const params = _urlhash.initialHashParams;
        assert.instanceOf(params, Map);
      });

      it('returns a consistent reference', () => {
        const params1 = _urlhash.initialHashParams;
        const params2 = _urlhash.initialHashParams;
        assert.strictEqual(params1, params2);
      });
    });

    describe('getParam / setParam', () => {
      it('returns undefined for non-existent parameters', () => {
        assert.isUndefined(_urlhash.getParam('nonexistent-param-12345'));
      });

      it('can set and get a parameter', () => {
        _urlhash.setParam('test-key', 'test-value');
        assert.strictEqual(_urlhash.getParam('test-key'), 'test-value');
        _urlhash.setParam('test-key', undefined); // cleanup
      });

      it('can update an existing parameter', () => {
        _urlhash.setParam('update-key', 'original');
        assert.strictEqual(_urlhash.getParam('update-key'), 'original');
        _urlhash.setParam('update-key', 'updated');
        assert.strictEqual(_urlhash.getParam('update-key'), 'updated');
        _urlhash.setParam('update-key', undefined); // cleanup
      });

      it('can store empty string values', () => {
        _urlhash.setParam('empty-key', '');
        assert.strictEqual(_urlhash.getParam('empty-key'), '');
        _urlhash.setParam('empty-key', undefined); // cleanup
      });

      it('deletes parameter when set to undefined', () => {
        _urlhash.setParam('delete-key', 'value');
        assert.strictEqual(_urlhash.getParam('delete-key'), 'value');
        _urlhash.setParam('delete-key', undefined);
        assert.isUndefined(_urlhash.getParam('delete-key'));
      });

      it('deletes parameter when set to null', () => {
        _urlhash.setParam('null-key', 'value');
        assert.strictEqual(_urlhash.getParam('null-key'), 'value');
        _urlhash.setParam('null-key', null);
        assert.isUndefined(_urlhash.getParam('null-key'));
      });

      it('deletes parameter when set to string "undefined"', () => {
        _urlhash.setParam('undefined-key', 'value');
        _urlhash.setParam('undefined-key', 'undefined');
        assert.isUndefined(_urlhash.getParam('undefined-key'));
      });

      it('deletes parameter when set to string "null"', () => {
        _urlhash.setParam('null-str-key', 'value');
        _urlhash.setParam('null-str-key', 'null');
        assert.isUndefined(_urlhash.getParam('null-str-key'));
      });

      it('ignores non-string keys', () => {
        const before = _urlhash.getParam('test');
        _urlhash.setParam(123, 'value'); // invalid key type
        const after = _urlhash.getParam('test');
        assert.strictEqual(before, after);
      });

      it('can set multiple independent parameters', () => {
        _urlhash.setParam('param1', 'value1');
        _urlhash.setParam('param2', 'value2');
        _urlhash.setParam('param3', 'value3');
        assert.strictEqual(_urlhash.getParam('param1'), 'value1');
        assert.strictEqual(_urlhash.getParam('param2'), 'value2');
        assert.strictEqual(_urlhash.getParam('param3'), 'value3');
        // cleanup
        _urlhash.setParam('param1', undefined);
        _urlhash.setParam('param2', undefined);
        _urlhash.setParam('param3', undefined);
      });
    });

    describe('pause / resume', () => {
      it('can be paused', () => {
        _urlhash.pause();
        // System is paused - setting params shouldn't trigger updates
        _urlhash.setParam('paused-key', 'paused-value');
        assert.strictEqual(_urlhash.getParam('paused-key'), 'paused-value');
        _urlhash.resume(); // restore
        _urlhash.setParam('paused-key', undefined); // cleanup
      });

      it('can be resumed after pausing', () => {
        _urlhash.pause();
        _urlhash.resume();
        // Should work normally after resume
        _urlhash.setParam('resumed-key', 'resumed-value');
        assert.strictEqual(_urlhash.getParam('resumed-key'), 'resumed-value');
        _urlhash.setParam('resumed-key', undefined); // cleanup
      });
    });

    describe('doUpdateTitle', () => {
      it('can disable title updates', () => {
        const originalValue = _urlhash.doUpdateTitle;
        _urlhash.doUpdateTitle = false;
        assert.isFalse(_urlhash.doUpdateTitle);
        _urlhash.doUpdateTitle = originalValue; // restore
      });

      it('can enable title updates', () => {
        const originalValue = _urlhash.doUpdateTitle;
        _urlhash.doUpdateTitle = true;
        assert.isTrue(_urlhash.doUpdateTitle);
        _urlhash.doUpdateTitle = originalValue; // restore
      });
    });

    describe('titleBase', () => {
      it('has a default title', () => {
        assert.strictEqual(_urlhash.titleBase, 'Rapid');
      });

      it('can set a custom title', () => {
        const original = _urlhash.titleBase;
        _urlhash.titleBase = 'Custom Title';
        assert.strictEqual(_urlhash.titleBase, 'Custom Title');
        _urlhash.titleBase = original; // restore
      });
    });
  });

});
