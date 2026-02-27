import { describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('AbstractSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an AbstractSystem from a context', () => {
        const a = new Rapid.AbstractSystem(context);
        assert.instanceOf(a, Rapid.AbstractSystem);
        assert.strictEqual(a.id, '');
        assert.strictEqual(a.context, context);
        assert.instanceOf(a.requiredDependencies, Set);
        assert.instanceOf(a.optionalDependencies, Set);
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
      it('pauses and resumes via release token', () => {
        const a = new Rapid.AbstractSystem(context);
        assert.isFalse(a.paused);
        const release = a.pause();
        assert.isTrue(a.paused);
        release();
        assert.isFalse(a.paused);
      });

      it('reference counts multiple pauses', () => {
        const a = new Rapid.AbstractSystem(context);
        assert.isFalse(a.paused);
        const r1 = a.pause();
        const r2 = a.pause();
        assert.isTrue(a.paused);
        r1();
        assert.isTrue(a.paused, 'still paused after first release');
        r2();
        assert.isFalse(a.paused, 'unpaused after second release');
      });

      it('pause returns an idempotent release token', () => {
        const a = new Rapid.AbstractSystem(context);
        const release = a.pause();
        assert.isTrue(a.paused);
        release();
        assert.isFalse(a.paused);
        // calling the token again should be a no-op
        release();
        assert.isFalse(a.paused, 'still unpaused after double release');
      });

      it('multiple release tokens are independent', () => {
        const a = new Rapid.AbstractSystem(context);
        const r1 = a.pause();
        const r2 = a.pause();
        assert.isTrue(a.paused);
        r1();
        assert.isTrue(a.paused, 'still paused — r2 outstanding');
        r2();
        assert.isFalse(a.paused, 'unpaused — all tokens released');
      });

      it('emits "paused" once on transition from unpaused to paused', () => {
        const a = new Rapid.AbstractSystem(context);
        const spyPause = mock();
        a.on('paused', spyPause);

        a.pause();
        assert.lengthOf(spyPause.mock.calls, 1, 'emitted once on first pause');

        a.pause();
        assert.lengthOf(spyPause.mock.calls, 1, 'no extra emit on second pause — already paused');
      });

      it('emits "resumed" once on transition from paused to unpaused', () => {
        const a = new Rapid.AbstractSystem(context);
        const spyResume = mock();
        a.on('resumed', spyResume);

        const r1 = a.pause();
        const r2 = a.pause();
        r1();
        assert.lengthOf(spyResume.mock.calls, 0, 'not yet — still one pause outstanding');

        r2();
        assert.lengthOf(spyResume.mock.calls, 1, 'emitted once when fully unpaused');

        r2();  // extra release of r2
        assert.lengthOf(spyResume.mock.calls, 1, 'no extra emit on double release - already released');
      });

      it('emits "paused" again after a full unpause cycle', () => {
        const a = new Rapid.AbstractSystem(context);
        const spyPause = mock();
        a.on('paused', spyPause);

        const r1 = a.pause();
        assert.lengthOf(spyPause.mock.calls, 1, 'emitted once on first pause');
        r1();
        assert.isFalse(a.paused);

        const r2 = a.pause();
        assert.lengthOf(spyPause.mock.calls, 2, 'emits again after full release cycle');
        r2();
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const a = new Rapid.AbstractSystem(context);
        const prom = a.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const a = new Rapid.AbstractSystem(context);
        a.requiredDependencies.add('missing');
        const prom = a.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const a = new Rapid.AbstractSystem(context);
        const prom = a.initAsync().then(() => a.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(a.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const a = new Rapid.AbstractSystem(context);
        const prom = a.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });

  });
});
