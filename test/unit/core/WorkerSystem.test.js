import { afterEach, beforeAll, describe, it, mock, spyOn } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('WorkerSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a WorkerSystem from a context', () => {
        const worker = new Rapid.WorkerSystem(context);
        assert.instanceOf(worker, Rapid.WorkerSystem);
        assert.strictEqual(worker.id, 'worker');
        assert.strictEqual(worker.context, context);
        assert.instanceOf(worker.requiredDependencies, Set);
        assert.instanceOf(worker.optionalDependencies, Set);
        assert.isTrue(worker.autoStart);
      });

      it('auto-detects workerURL from context.scriptURL', () => {
        const ctx = new Rapid.MockContext();
        ctx.scriptURL = 'https://cdn.example.com/js/rapid.js';

        const worker = new Rapid.WorkerSystem(ctx);
        assert.strictEqual(worker.workerURL, 'https://cdn.example.com/js/rapid-worker.js');
      });

      it('detects minified worker URL from minified script URL', () => {
        const ctx = new Rapid.MockContext();
        ctx.scriptURL = 'https://cdn.example.com/js/rapid.min.js';

        const worker = new Rapid.WorkerSystem(ctx);
        assert.strictEqual(worker.workerURL, 'https://cdn.example.com/js/rapid-worker.min.js');
      });

      it('sets workerURL to null when context.scriptURL is not set', () => {
        const ctx = new Rapid.MockContext();
        // scriptURL is undefined by default on MockContext
        const worker = new Rapid.WorkerSystem(ctx);
        assert.isNull(worker.workerURL);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const worker = new Rapid.WorkerSystem(context);
        const prom = worker.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const worker = new Rapid.WorkerSystem(context);
        const prom = worker.initAsync().then(() => worker.startAsync());
        assert.instanceOf(prom, Promise);
        return prom;
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const worker = new Rapid.WorkerSystem(context);
        const prom = worker.initAsync()
          .then(() => worker.startAsync())
          .then(() => worker.resetAsync());
        assert.instanceOf(prom, Promise);
        return prom;
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _worker;

    beforeAll(() => {
      _worker = new Rapid.WorkerSystem(context);
      return _worker.initAsync().then(() => _worker.startAsync());
    });

    afterEach(() => {
      return _worker.resetAsync();
    });


    describe('listener registry', () => {
      it('registers and retrieves a listener', () => {
        const listener = (data, signal) => data;
        _worker.registerListener('test:echo', listener);
        assert.strictEqual(_worker.getListener('test:echo'), listener);
      });

      it('returns undefined for unregistered listener', () => {
        assert.isUndefined(_worker.getListener('nonexistent'));
      });

      it('unregisters a listener', () => {
        const listener = (data, signal) => data;
        _worker.registerListener('test:remove', listener);
        assert.strictEqual(_worker.getListener('test:remove'), listener);
        _worker.unregisterListener('test:remove');
        assert.isUndefined(_worker.getListener('test:remove'));
      });
    });


    describe('worker pool', () => {
      const workerURL = new URL('../../../modules/worker.ts', import.meta.url).href;

      afterEach(async () => {
        _worker.terminateWorkers();
        _worker.workerURL = null;
        await _worker.resetAsync();
      });

      describe('workerURL', () => {
        it('starts as null', () => {
          assert.isNull(_worker.workerURL);
        });

        it('can be set and read back', () => {
          _worker.workerURL = workerURL;
          assert.strictEqual(_worker.workerURL, workerURL);
        });
      });

      describe('maxWorkers', () => {
        it('defaults to 2', () => {
          assert.strictEqual(_worker.maxWorkers, 2);
        });

        it('can be changed', () => {
          _worker.maxWorkers = 4;
          assert.strictEqual(_worker.maxWorkers, 4);
          _worker.maxWorkers = 2;  // reset
        });

        it('clamps to at least 1', () => {
          _worker.maxWorkers = 0;
          assert.strictEqual(_worker.maxWorkers, 1);
          _worker.maxWorkers = 2;  // reset
        });
      });

      describe('numWorkers', () => {
        it('starts at 0', () => {
          assert.strictEqual(_worker.numWorkers, 0);
        });
      });

      describe('dispatch', () => {
        it('rejects if workerURL is not set', async () => {
          try {
            await _worker.dispatch('ping', 'hello');
            assert.fail('should have rejected');
          } catch (e) {
            assert.match(e.message, /workerURL not set/);
          }
        });

        it('dispatches a ping task and receives the echoed result', async () => {
          _worker.workerURL = workerURL;
          const result = await _worker.dispatch('ping', 'hello');
          assert.strictEqual(result, 'hello');
        });

        it('spawns a worker lazily on first task', async () => {
          _worker.workerURL = workerURL;
          assert.strictEqual(_worker.numWorkers, 0);
          const p = _worker.dispatch('ping', 42);
          assert.strictEqual(_worker.numWorkers, 1);
          await p;
        });

        it('handles complex serializable data', async () => {
          _worker.workerURL = workerURL;
          const input = { key: 'value', arr: [1, 2, 3], nested: { deep: true } };
          const result = await _worker.dispatch('ping', input);
          assert.deepEqual(result, input);
        });

        it('rejects when task type is unknown', async () => {
          _worker.workerURL = workerURL;
          try {
            await _worker.dispatch('nonexistent', {});
            assert.fail('should have rejected');
          } catch (e) {
            assert.match(e.message, /Unknown listener/);
          }
        });

        it('handles multiple concurrent tasks', async () => {
          _worker.workerURL = workerURL;
          const results = await Promise.all([
            _worker.dispatch('ping', 'a'),
            _worker.dispatch('ping', 'b'),
            _worker.dispatch('ping', 'c'),
          ]);
          assert.deepEqual(results, ['a', 'b', 'c']);
        });

        it('tracks pending requests', async () => {
          _worker.workerURL = workerURL;
          assert.strictEqual(_worker.numPendingRequests, 0);
          const p = _worker.dispatch('ping', 1);
          assert.strictEqual(_worker.numPendingRequests, 1);
          await p;
          assert.strictEqual(_worker.numPendingRequests, 0);
        });
      });

      describe('worker pool sizing', () => {
        it('does not exceed maxWorkers', async () => {
          _worker.workerURL = workerURL;
          _worker.maxWorkers = 2;

          // Dispatch more tasks than maxWorkers
          const promises = [];
          for (let i = 0; i < 5; i++) {
            promises.push(_worker.dispatch('ping', i));
          }
          assert.isAtMost(_worker.numWorkers, 2);
          await Promise.all(promises);
        });

        it('round-robins across workers', async () => {
          _worker.workerURL = workerURL;
          _worker.maxWorkers = 2;

          // First task spawns worker 0, second spawns worker 1, third reuses worker 0
          await _worker.dispatch('ping', 1);
          assert.strictEqual(_worker.numWorkers, 1);
          await _worker.dispatch('ping', 2);
          assert.strictEqual(_worker.numWorkers, 2);
          await _worker.dispatch('ping', 3);
          assert.strictEqual(_worker.numWorkers, 2, 'should not spawn a third');
        });
      });

      describe('terminateWorkers', () => {
        it('terminates all workers and resets pool', async () => {
          _worker.workerURL = workerURL;
          await _worker.dispatch('ping', 1);
          assert.isAbove(_worker.numWorkers, 0);

          _worker.terminateWorkers();
          assert.strictEqual(_worker.numWorkers, 0);
          assert.strictEqual(_worker.numPendingRequests, 0);
        });

        it('rejects pending requests on terminate', async () => {
          _worker.workerURL = workerURL;
          _worker.maxWorkers = 1;

          // Start a task but terminate before it resolves
          const p = _worker.dispatch('ping', 'doomed');
          _worker.terminateWorkers();

          try {
            await p;
            assert.fail('should have rejected');
          } catch (e) {
            assert.match(e.message, /worker terminated/);
          }
        });
      });

      describe('abort signal support', () => {
        it('rejects immediately if signal is already aborted', async () => {
          _worker.workerURL = workerURL;
          const controller = new AbortController();
          controller.abort();

          try {
            await _worker.dispatch('ping', 'hello', controller.signal);
            assert.fail('should have rejected');
          } catch (e) {
            assert.strictEqual(e.name, 'AbortError');
          }
        });

        it('rejects when signal fires after dispatch', async () => {
          _worker.workerURL = workerURL;
          const controller = new AbortController();

          // Use a task that takes some time — ping is fast, so abort right away
          const prom = _worker.dispatch('ping', 'hello', controller.signal);
          controller.abort();

          try {
            await prom;
            // If ping resolved before abort, that's okay — it's a race
          } catch (e) {
            assert.strictEqual(e.name, 'AbortError');
          }
          assert.strictEqual(_worker.numPendingRequests, 0);
        });

        it('cleans up pending request when signal aborts', async () => {
          _worker.workerURL = workerURL;
          _worker.maxWorkers = 1;
          const controller = new AbortController();

          assert.strictEqual(_worker.numPendingRequests, 0);
          const prom = _worker.dispatch('ping', 'test', controller.signal);
          // May or may not still be pending (ping is fast)
          controller.abort();

          try { await prom; } catch { /* expected */ }
          assert.strictEqual(_worker.numPendingRequests, 0);
        });

        it('sends cancel message to the correct worker', async () => {
          _worker.workerURL = workerURL;
          _worker.maxWorkers = 1;
          const controller = new AbortController();

          // Dispatch and immediately cancel — the worker gets '{type: cancel}'
          const prom = _worker.dispatch('ping', 'cancel-me', controller.signal);
          controller.abort();

          try {
            await prom;
          } catch (e) {
            assert.strictEqual(e.name, 'AbortError');
          }
        });
      });


      describe('resultPriority (scheduler deferred resolution)', () => {
        it('resolves immediately when no SchedulerSystem is available', async () => {
          _worker.workerURL = workerURL;
          // MockContext doesn't provide context.systems.scheduler, so the
          // fallback path (resolve immediately) should fire.
          const result = await _worker.dispatch('ping', 'deferred', undefined, { resultPriority: 'normal' });
          assert.strictEqual(result, 'deferred');
        });

        it('defers resolution through when SchedulerSystem exists', async () => {
          _worker.workerURL = workerURL;
          const scheduler = new Rapid.SchedulerSystem(context);
          const scheduleSpy = spyOn(scheduler, 'schedule');

          context.systems.scheduler = scheduler;
          await scheduler.initAsync().then(() => scheduler.startAsync());

          try {
            const prom = _worker.dispatch('ping', 'defer-me', undefined, { resultPriority: 'idle' });
            const result = await prom;

            // The scheduler should have been used...
            assert.lengthOf(scheduleSpy.mock.calls, 1, 'scheduler.schedule should have been called');
            const call = scheduleSpy.mock.calls[0];
            assert.typeOf(call[0], 'function');
            assert.deepEqual(call[1], { priority: 'idle' });

            assert.strictEqual(result, 'defer-me');  // ...and we get the ping response from the worker
          } finally {
            delete context.systems.scheduler;
          }
        });

        it('rejects with AbortError upon SchedulerSystem task cancellation', async () => {
          _worker.workerURL = workerURL;
          const scheduler = new Rapid.SchedulerSystem(context);
          const origSchedule = scheduler.schedule.bind(scheduler);
          const mockSchedule = mock((...args) => {
            const prom = origSchedule(args);  // schedule it..
            scheduler.cancelAllIdleTasks();   // but cancel immediately
            return prom;
          });
          scheduler.schedule = mockSchedule;

          context.systems.scheduler = scheduler;
          await scheduler.initAsync().then(() => scheduler.startAsync());

          try {
            const prom = _worker.dispatch('ping', 'defer-me', undefined, { resultPriority: 'idle' });
            await prom;
            assert.fail('Promise should have been rejected');

          } catch (err) {
            // The scheduler should have been used...
            assert.lengthOf(mockSchedule.mock.calls, 1, 'scheduler.schedule should have been called');
            const call = mockSchedule.mock.calls[0];
            assert.typeOf(call[0], 'function');
            assert.deepEqual(call[1], { priority: 'idle' });

            assert.strictEqual(err?.name, 'AbortError');  // ...but the scheduler cancelled it
          } finally {
            delete context.systems.scheduler;
          }
        });
      });

    });
  });
});
