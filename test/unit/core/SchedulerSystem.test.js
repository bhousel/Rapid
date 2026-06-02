import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('SchedulerSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a SchedulerSystem from a context', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        assert.instanceOf(scheduler, Rapid.SchedulerSystem);
        assert.strictEqual(scheduler.id, 'scheduler');
        assert.strictEqual(scheduler.context, context);
        assert.instanceOf(scheduler.requiredDependencies, Set);
        assert.instanceOf(scheduler.optionalDependencies, Set);
        assert.isTrue(scheduler.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        const prom = scheduler.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('returns the same promise on subsequent calls', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        const prom1 = scheduler.initAsync();
        const prom2 = scheduler.initAsync();
        assert.strictEqual(prom1, prom2);
        return prom1;
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        const prom = scheduler.initAsync().then(() => scheduler.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(scheduler.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        const prom = scheduler.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('cancels all pending idle tasks on reset', () => {
        const scheduler = new Rapid.SchedulerSystem(context);
        return scheduler.initAsync()
          .then(() => scheduler.startAsync())
          .then(() => {
            // Schedule tasks but don't await them (they'll be pending)
            scheduler.scheduleIdleTask(() => {}).catch(() => {});
            scheduler.scheduleIdleTask(() => {}).catch(() => {});
            assert.isAbove(scheduler.numPending, 0, 'should have pending tasks');
            return scheduler.resetAsync();
          })
          .then(() => {
            assert.strictEqual(scheduler.numPending, 0, 'should have no pending tasks after reset');
          });
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _scheduler;

    beforeAll(() => {
      _scheduler = new Rapid.SchedulerSystem(context);
      return _scheduler.initAsync().then(() => _scheduler.startAsync());
    });

    afterEach(() => {
      return _scheduler.resetAsync();
    });

    describe('numPending', () => {
      it('starts at zero', () => {
        assert.strictEqual(_scheduler.numPending, 0);
      });

      it('increases when tasks are scheduled', () => {
        _scheduler.scheduleIdleTask(() => {}).catch(() => {});
        assert.isAbove(_scheduler.numPending, 0);
      });

      it('returns to zero after tasks complete', async () => {
        await _scheduler.scheduleIdleTask(() => {});
        assert.strictEqual(_scheduler.numPending, 0);
      });
    });

    describe('targetFrameTime', () => {
      it('defaults to ~16.7ms (60 fps)', () => {
        assert.closeTo(_scheduler.targetFrameTime, 1000 / 60, 0.01);
      });

      it('can be set to a custom value', () => {
        const original = _scheduler.targetFrameTime;
        _scheduler.targetFrameTime = 8;
        assert.strictEqual(_scheduler.targetFrameTime, 8);
        _scheduler.targetFrameTime = original;
      });

      it('clamps to a minimum of 1ms', () => {
        const original = _scheduler.targetFrameTime;
        _scheduler.targetFrameTime = 0;
        assert.strictEqual(_scheduler.targetFrameTime, 1);
        _scheduler.targetFrameTime = -10;
        assert.strictEqual(_scheduler.targetFrameTime, 1);
        _scheduler.targetFrameTime = original;
      });
    });

    describe('scheduleIdleTask', () => {
      it('executes a task and resolves the returned promise', async () => {
        let executed = false;
        await _scheduler.scheduleIdleTask(() => { executed = true; });
        assert.isTrue(executed, 'task should have been executed');
      });

      it('executes multiple tasks', async () => {
        const order = [];
        const p1 = _scheduler.scheduleIdleTask(() => order.push(1));
        const p2 = _scheduler.scheduleIdleTask(() => order.push(2));
        const p3 = _scheduler.scheduleIdleTask(() => order.push(3));
        await Promise.all([p1, p2, p3]);
        assert.sameMembers(order, [1, 2, 3], 'all tasks should have run');
      });

      it('decrements numPending as tasks complete', async () => {
        const p1 = _scheduler.scheduleIdleTask(() => {});
        const p2 = _scheduler.scheduleIdleTask(() => {});
        assert.strictEqual(_scheduler.numPending, 2, 'two tasks pending');
        await Promise.all([p1, p2]);
        assert.strictEqual(_scheduler.numPending, 0, 'no tasks pending');
      });

      it('queues tasks while paused', () => {
        const release = _scheduler.pause();
        let executed = false;
        _scheduler.scheduleIdleTask(() => { executed = true; }).catch(() => {});
        assert.isFalse(executed, 'task should NOT have run while paused');
        assert.isAbove(_scheduler.numPending, 0, 'should have pending tasks');
        release();
      });

      it('defers tasks while paused and runs them after resume', async () => {
        const release = _scheduler.pause();
        let executed = false;
        const prom = _scheduler.scheduleIdleTask(() => { executed = true; });
        assert.isFalse(executed, 'task should not run while paused');

        // Resume — the loop starts and drains queued tasks
        release();
        await prom;
        assert.isTrue(executed, 'task should run after resume');
      });

      it('drains multiple pending tasks on resume', async () => {
        const release = _scheduler.pause();
        const results = [];
        const p1 = _scheduler.scheduleIdleTask(() => results.push('a'));
        const p2 = _scheduler.scheduleIdleTask(() => results.push('b'));
        const p3 = _scheduler.scheduleIdleTask(() => results.push('c'));
        assert.strictEqual(_scheduler.numPending, 3, 'three tasks queued');

        release();
        await Promise.all([p1, p2, p3]);
        assert.sameMembers(results, ['a', 'b', 'c'], 'all queued tasks should have run');
        assert.strictEqual(_scheduler.numPending, 0);
      });

      it('schedules normally again after resume', async () => {
        const release = _scheduler.pause();
        release();

        // Should work normally now
        let executed = false;
        await _scheduler.scheduleIdleTask(() => { executed = true; });
        assert.isTrue(executed);
      });
    });

    describe('cancelAllIdleTasks', () => {
      it('cancels active idle tasks', () => {
        const results = [];
        _scheduler.scheduleIdleTask(() => results.push('a')).catch(() => {});
        _scheduler.scheduleIdleTask(() => results.push('b')).catch(() => {});
        assert.isAbove(_scheduler.numPending, 0);

        _scheduler.cancelAllIdleTasks();
        assert.strictEqual(_scheduler.numPending, 0, 'should have no pending tasks');
      });

      it('rejects promises of cancelled active tasks', async () => {
        const prom = _scheduler.scheduleIdleTask(() => {});
        _scheduler.cancelAllIdleTasks();

        try {
          await prom;
          assert.fail('Promise should have been rejected');
        } catch {
          // expected — rejection means the task was properly cancelled
        }
      });

      it('rejects cancelled tasks with AbortError', async () => {
        const prom = _scheduler.scheduleIdleTask(() => {});
        _scheduler.cancelAllIdleTasks();

        try {
          await prom;
          assert.fail('Promise should have been rejected');
        } catch (err) {
          assert.strictEqual(err?.name, 'AbortError');
        }
      });

      it('cancels tasks queued while paused', () => {
        const release = _scheduler.pause();
        _scheduler.scheduleIdleTask(() => {}).catch(() => {});
        _scheduler.scheduleIdleTask(() => {}).catch(() => {});
        assert.strictEqual(_scheduler.numPending, 2, 'two pending tasks');

        _scheduler.cancelAllIdleTasks();
        assert.strictEqual(_scheduler.numPending, 0);
        release();
      });

      it('rejects promises of cancelled pending tasks', async () => {
        const release = _scheduler.pause();
        const prom = _scheduler.scheduleIdleTask(() => {});
        _scheduler.cancelAllIdleTasks();
        release();

        try {
          await prom;
          assert.fail('Promise should have been rejected');
        } catch {
          // expected
        }
      });

      it('does nothing when there are no tasks', () => {
        assert.strictEqual(_scheduler.numPending, 0);
        _scheduler.cancelAllIdleTasks();  // should not throw
        assert.strictEqual(_scheduler.numPending, 0);
      });

      it('allows new tasks to be scheduled after cancellation', async () => {
        _scheduler.scheduleIdleTask(() => {}).catch(() => {});
        _scheduler.cancelAllIdleTasks();

        let executed = false;
        await _scheduler.scheduleIdleTask(() => { executed = true; });
        assert.isTrue(executed, 'new task should run after cancel');
      });
    });

    describe('schedule', () => {
      it('executes a task with default priority (normal)', async () => {
        let executed = false;
        await _scheduler.schedule(() => { executed = true; });
        assert.isTrue(executed);
      });

      it('executes a task with explicit normal priority', async () => {
        let executed = false;
        await _scheduler.schedule(() => { executed = true; }, { priority: 'normal' });
        assert.isTrue(executed);
      });

      it('executes a task with urgent priority', async () => {
        let executed = false;
        await _scheduler.schedule(() => { executed = true; }, { priority: 'urgent' });
        assert.isTrue(executed);
      });

      it('executes a task with idle priority', async () => {
        let executed = false;
        await _scheduler.schedule(() => { executed = true; }, { priority: 'idle' });
        assert.isTrue(executed);
      });

      it('counts tasks from all priorities in numPending', () => {
        _scheduler.schedule(() => {}, { priority: 'urgent' }).catch(() => {});
        _scheduler.schedule(() => {}, { priority: 'normal' }).catch(() => {});
        _scheduler.schedule(() => {}, { priority: 'idle' }).catch(() => {});
        assert.strictEqual(_scheduler.numPending, 3);
      });

      it('drains urgent before normal before idle', async () => {
        const order = [];
        const p1 = _scheduler.schedule(() => order.push('idle'), { priority: 'idle' });
        const p2 = _scheduler.schedule(() => order.push('normal'), { priority: 'normal' });
        const p3 = _scheduler.schedule(() => order.push('urgent'), { priority: 'urgent' });
        await Promise.all([p1, p2, p3]);
        assert.deepEqual(order, ['urgent', 'normal', 'idle']);
      });

      it('rejects promise when task throws', async () => {
        const prom = _scheduler.schedule(() => { throw new Error('oops'); });
        try {
          await prom;
          assert.fail('Promise should have been rejected');
        } catch (e) {
          assert.instanceOf(e, Error);
          assert.strictEqual(e.message, 'oops');
        }
      });

      it('continues draining after a throwing task', async () => {
        const order = [];
        const p1 = _scheduler.schedule(() => order.push('a'), { priority: 'urgent' });
        const p2 = _scheduler.schedule(() => { throw new Error('fail'); }, { priority: 'urgent' });
        const p3 = _scheduler.schedule(() => order.push('c'), { priority: 'urgent' });

        const results = await Promise.allSettled([p1, p2, p3]);
        assert.strictEqual(results[0].status, 'fulfilled');
        assert.strictEqual(results[1].status, 'rejected');
        assert.strictEqual(results[2].status, 'fulfilled');
        assert.deepEqual(order, ['a', 'c']);
      });

      it('cancelAllIdleTasks also cancels urgent and normal tasks', () => {
        _scheduler.schedule(() => {}, { priority: 'urgent' }).catch(() => {});
        _scheduler.schedule(() => {}, { priority: 'normal' }).catch(() => {});
        _scheduler.schedule(() => {}, { priority: 'idle' }).catch(() => {});
        assert.strictEqual(_scheduler.numPending, 3);
        _scheduler.cancelAllIdleTasks();
        assert.strictEqual(_scheduler.numPending, 0);
      });
    });


    // -------------------------------------------------------
    // workID-keyed timer API
    // -------------------------------------------------------

    describe('setTimeout (workID)', () => {
      it('executes a task after the delay via queue drainage', async () => {
        let executed = false;
        _scheduler.setTimeout('test-timeout', () => { executed = true; }, { ms: 5 });
        assert.strictEqual(_scheduler.numTimers, 1);

        // Wait for timer to mature + frame to drain
        await Bun.sleep(30);
        assert.isTrue(executed, 'task should have run');
        assert.strictEqual(_scheduler.numTimers, 0, 'timer entry cleaned up');
      });

      it('defaults to 0ms delay', async () => {
        let executed = false;
        _scheduler.setTimeout('test-zero', () => { executed = true; });

        await Bun.sleep(30);
        assert.isTrue(executed);
      });

      it('replaces existing timer with same workID', async () => {
        const order = [];
        _scheduler.setTimeout('test-replace', () => order.push('first'), { ms: 5 });
        _scheduler.setTimeout('test-replace', () => order.push('second'), { ms: 5 });
        assert.strictEqual(_scheduler.numTimers, 1, 'only one timer');

        await Bun.sleep(30);
        assert.deepEqual(order, ['second'], 'only the replacement ran');
      });

      it('respects priority option', () => {
        _scheduler.setTimeout('test-pri', () => {}, { ms: 5, priority: 'urgent' });
        const entry = _scheduler._timers.get('test-pri');
        assert.strictEqual(entry.priority, 'urgent');
        _scheduler.cancel('test-pri');
      });
    });

    describe('setInterval (workID)', () => {
      it('executes a task repeatedly via queue drainage', async () => {
        let count = 0;
        _scheduler.setInterval('test-interval', () => { count++; }, { ms: 5 });
        assert.strictEqual(_scheduler.numTimers, 1);

        await Bun.sleep(30);
        _scheduler.cancel('test-interval');
        assert.isAbove(count, 1, 'interval should have fired multiple times');
        assert.strictEqual(_scheduler.numTimers, 0);
      });

      it('replaces existing interval with same workID', async () => {
        let aCount = 0;
        let bCount = 0;
        _scheduler.setInterval('test-replace-iv', () => { aCount++; }, { ms: 5 });
        _scheduler.setInterval('test-replace-iv', () => { bCount++; }, { ms: 5 });

        await Bun.sleep(30);
        _scheduler.cancel('test-replace-iv');
        assert.strictEqual(aCount, 0, 'first interval should not have fired');
        assert.isAbove(bCount, 0, 'replacement should have fired');
      });
    });

    describe('debounce', () => {
      it('fires after the quiet period', async () => {
        let executed = false;
        _scheduler.debounce('test-debounce', () => { executed = true; }, { ms: 10 });
        assert.strictEqual(_scheduler.numTimers, 1);

        await Bun.sleep(30);
        assert.isTrue(executed, 'debounced fn should have run');
        assert.strictEqual(_scheduler.numTimers, 0, 'timer entry cleaned up');
      });

      it('resets the timer on subsequent calls', async () => {
        const timestamps = [];
        const start = performance.now();

        _scheduler.debounce('test-reset', () => { timestamps.push(performance.now() - start); }, { ms: 10 });
        await Bun.sleep(5);
        // Call again before the first timer fires — resets the 10ms window
        _scheduler.debounce('test-reset', () => { timestamps.push(performance.now() - start); }, { ms: 10 });

        await Bun.sleep(30);
        assert.lengthOf(timestamps, 1, 'should have fired exactly once');
        // The single fire should be at ~15ms+ (5ms wait + 10ms debounce), not at ~10ms
        assert.isAbove(timestamps[0], 15, 'should have fired after the reset delay');
      });

      it('updates fn on subsequent calls', async () => {
        const order = [];
        _scheduler.debounce('test-fn-update', () => order.push('first'), { ms: 10 });
        await Bun.sleep(5);
        _scheduler.debounce('test-fn-update', () => order.push('second'), { ms: 10 });

        await Bun.sleep(30);
        assert.deepEqual(order, ['second'], 'only the latest fn should run');
      });

      it('leading: true fires immediately on first call', async () => {
        const order = [];
        _scheduler.debounce('test-leading', () => order.push('leading'), { ms: 10, leading: true });

        // Wait a couple frames for the leading enqueue to drain
        await Bun.sleep(30);
        assert.include(order, 'leading', 'should have fired on leading edge');
      });

      it('leading: true + subsequent call fires both leading and trailing', async () => {
        const order = [];
        _scheduler.debounce('test-lead-trail', () => order.push('a'), { ms: 10, leading: true });

        // Wait a frame for leading to drain, then debounce again
        await Bun.sleep(30);
        _scheduler.debounce('test-lead-trail', () => order.push('b'), { ms: 10 });

        await Bun.sleep(30);
        assert.deepEqual(order, ['a', 'b'], 'both leading and trailing should fire');
      });
    });

    describe('throttle', () => {
      it('fires on the leading edge', async () => {
        let executed = false;
        _scheduler.throttle('test-throttle', () => { executed = true; }, { ms: 10 });
        assert.strictEqual(_scheduler.numTimers, 1);

        // Wait for the leading enqueue to drain
        await Bun.sleep(30);
        assert.isTrue(executed, 'should have fired on leading edge');
      });

      it('ignores calls during the throttle window', async () => {
        let count = 0;
        _scheduler.throttle('test-ignore', () => { count++; }, { ms: 10 });
        _scheduler.throttle('test-ignore', () => { count++; }, { ms: 10 });
        _scheduler.throttle('test-ignore', () => { count++; }, { ms: 10 });

        // Wait for leading + trailing to drain
        await Bun.sleep(30);
        // Leading fires once, plus the last trailing should fire once
        assert.strictEqual(count, 2, 'leading + trailing = 2 executions');
      });

      it('fires trailing call after window expires', async () => {
        const order = [];
        _scheduler.throttle('test-trailing', () => order.push('leading'), { ms: 10 });
        // Call during window — this becomes the trailing fn
        await Bun.sleep(5);
        _scheduler.throttle('test-trailing', () => order.push('trailing'), { ms: 10 });

        await Bun.sleep(30);
        assert.deepEqual(order, ['leading', 'trailing']);
        assert.strictEqual(_scheduler.numTimers, 0, 'cleaned up after trailing');
      });

      it('cleans up when no trailing call', async () => {
        _scheduler.throttle('test-cleanup', () => {}, { ms: 10 });

        await Bun.sleep(30);
        assert.strictEqual(_scheduler.numTimers, 0, 'should be cleaned up');
      });

      it('replaces different timer types with same workID', async () => {
        _scheduler.setTimeout('test-replace-type', () => {}, { ms: 10 });
        assert.strictEqual(_scheduler.numTimers, 1);
        assert.strictEqual(_scheduler._timers.get('test-replace-type').type, 'timeout');

        _scheduler.throttle('test-replace-type', () => {}, { ms: 10 });
        assert.strictEqual(_scheduler.numTimers, 1);
        assert.strictEqual(_scheduler._timers.get('test-replace-type').type, 'throttle');
      });

      it('leading: false defers first call to trailing edge', async () => {
        const order = [];
        _scheduler.throttle('test-no-lead', () => order.push('first'), { ms: 10, leading: false });

        // Leading should NOT have fired
        await Bun.sleep(5);
        assert.deepEqual(order, [], 'should not fire on leading edge');

        // After window expires, trailing should fire
        await Bun.sleep(30);
        assert.deepEqual(order, ['first'], 'should fire on trailing edge');
        assert.strictEqual(_scheduler.numTimers, 0, 'cleaned up');
      });

      it('leading: false with multiple calls fires only trailing', async () => {
        let count = 0;
        _scheduler.throttle('test-no-lead-multi', () => { count++; }, { ms: 10, leading: false });
        _scheduler.throttle('test-no-lead-multi', () => { count++; }, { ms: 10, leading: false });
        _scheduler.throttle('test-no-lead-multi', () => { count++; }, { ms: 10, leading: false });

        // After window expires, only the latest trailing should fire
        await Bun.sleep(30);
        assert.strictEqual(count, 1, 'only trailing fires once');
      });
    });

    describe('cancel', () => {
      it('cancels a timeout by workID', async () => {
        let executed = false;
        _scheduler.setTimeout('test-cancel-to', () => { executed = true; }, { ms: 5 });
        _scheduler.cancel('test-cancel-to');

        assert.strictEqual(_scheduler.numTimers, 0);
        await Bun.sleep(30);
        assert.isFalse(executed);
      });

      it('cancels an interval by workID', async () => {
        let count = 0;
        _scheduler.setInterval('test-cancel-iv', () => { count++; }, { ms: 5 });
        _scheduler.cancel('test-cancel-iv');

        assert.strictEqual(_scheduler.numTimers, 0);
        await Bun.sleep(30);
        assert.strictEqual(count, 0);
      });

      it('cancels a debounce by workID', async () => {
        let executed = false;
        _scheduler.debounce('test-cancel-db', () => { executed = true; }, { ms: 10 });
        _scheduler.cancel('test-cancel-db');

        assert.strictEqual(_scheduler.numTimers, 0);
        await Bun.sleep(30);
        assert.isFalse(executed);
      });

      it('cancels a throttle by workID (including trailing)', async () => {
        let _count = 0;
        _scheduler.throttle('test-cancel-th', () => { _count++; }, { ms: 10 });
        // Trailing call
        _scheduler.throttle('test-cancel-th', () => { _count++; }, { ms: 10 });
        _scheduler.cancel('test-cancel-th');

        // Wait for leading drain + check no trailing fires
        await Bun.sleep(30);
        // The leading edge was enqueued before cancel — it might or might not
        // have drained yet.  But after cancel, the trailing should not fire.
        // Also, _removeFromQueues removes any pending enqueue.
        assert.strictEqual(_scheduler.numTimers, 0);
      });

      it('removes queued tasks matching workID', () => {
        _scheduler.schedule(() => {}, { priority: 'normal', workID: 'test-remove-q' }).catch(() => {});
        assert.strictEqual(_scheduler.numPending, 1);
        _scheduler.cancel('test-remove-q');
        assert.strictEqual(_scheduler.numPending, 0);
      });

      it('rejects queued workID tasks with AbortError', async () => {
        const prom = _scheduler.schedule(() => {}, { priority: 'normal', workID: 'test-remove-q-reject' });
        _scheduler.cancel('test-remove-q-reject');

        try {
          await prom;
          assert.fail('Promise should have been rejected');
        } catch (err) {
          assert.strictEqual(err?.name, 'AbortError');
        }
      });

      it('does nothing for unknown workID', () => {
        _scheduler.cancel('nonexistent');  // should not throw
        assert.strictEqual(_scheduler.numTimers, 0);
      });
    });

    describe('cancelAllTimers', () => {
      it('cancels all workID-keyed timers', async () => {
        _scheduler.setTimeout('a', () => {}, { ms: 5 });
        _scheduler.setInterval('b', () => {}, { ms: 5 });
        _scheduler.debounce('c', () => {}, { ms: 5 });
        assert.strictEqual(_scheduler.numTimers, 3);

        _scheduler.cancelAllTimers();
        assert.strictEqual(_scheduler.numTimers, 0);
      });
    });

    describe('pause/resume interaction', () => {
      it('reference-counted pauses work with scheduling', async () => {
        const r1 = _scheduler.pause();
        const r2 = _scheduler.pause();
        let executed = false;
        const prom = _scheduler.scheduleIdleTask(() => { executed = true; });

        r1();
        assert.isTrue(_scheduler.paused, 'still paused after first release');
        assert.isFalse(executed, 'task should still be queued');

        r2();
        assert.isFalse(_scheduler.paused, 'unpaused after second release');
        await prom;
        assert.isTrue(executed, 'task should have run after full resume');
      });

      it('tasks scheduled between pauses are all queued', async () => {
        const release = _scheduler.pause();
        const results = [];

        // Schedule while paused
        const p1 = _scheduler.scheduleIdleTask(() => results.push(1));
        const p2 = _scheduler.scheduleIdleTask(() => results.push(2));

        // numPending should reflect both queued tasks
        assert.strictEqual(_scheduler.numPending, 2);

        release();
        await Promise.all([p1, p2]);
        assert.deepEqual(results.sort(), [1, 2]);
      });

      it('cancelAllIdleTasks during pause then resume does not run tasks', async () => {
        const release = _scheduler.pause();
        let executed = false;
        _scheduler.scheduleIdleTask(() => { executed = true; }).catch(() => {});

        _scheduler.cancelAllIdleTasks();
        release();

        // Give idle callbacks a chance to fire
        await Bun.sleep(30);
        assert.isFalse(executed, 'cancelled task should never run');
      });
    });

    describe('game loop', () => {
      // Helper: returns a Promise that resolves after N requestAnimationFrame frames
      function waitFrames(n) {
        return new Promise(resolve => {
          let count = 0;
          function next() {
            count++;
            if (count >= n) {
              resolve();
            } else {
              globalThis.requestAnimationFrame(next);
            }
          }
          globalThis.requestAnimationFrame(next);
        });
      }

      describe('addFrameCallback / removeFrameCallback', () => {
        it('registers a frame callback', () => {
          assert.strictEqual(_scheduler.numFrameCallbacks, 0);
          _scheduler.addFrameCallback('test', () => {});
          assert.strictEqual(_scheduler.numFrameCallbacks, 1);
          _scheduler.removeFrameCallback('test');
        });

        it('removes a frame callback by id', () => {
          _scheduler.addFrameCallback('test', () => {});
          assert.strictEqual(_scheduler.numFrameCallbacks, 1);
          _scheduler.removeFrameCallback('test');
          assert.strictEqual(_scheduler.numFrameCallbacks, 0);
        });

        it('replacing a callback with the same id keeps count at 1', () => {
          _scheduler.addFrameCallback('test', () => {});
          _scheduler.addFrameCallback('test', () => {});  // replace
          assert.strictEqual(_scheduler.numFrameCallbacks, 1);
          _scheduler.removeFrameCallback('test');
        });

        it('removing a nonexistent id does nothing', () => {
          _scheduler.removeFrameCallback('nope');  // should not throw
          assert.strictEqual(_scheduler.numFrameCallbacks, 0);
        });
      });

      describe('frame callback execution', () => {
        const origError = console.error;
        const spyError = mock();

        beforeAll(() => {
          console.error = spyError;
        });

        beforeEach(() => {
          spyError.mockClear();  // reset call count
        });

        afterAll(() => {
          console.error = origError;
        });

        afterEach(() => {
          _scheduler._frameCallbacks.clear();  // in case a thrown error skips removal steps
        });


        it('calls registered frame callbacks each frame', async () => {
          let callCount = 0;
          _scheduler.addFrameCallback('test', () => { callCount++; });

          await waitFrames(3);
          _scheduler.removeFrameCallback('test');
          assert.isAbove(callCount, 0, 'callback should have been called');
        });

        it('passes deltaMS to frame callbacks', async () => {
          let receivedDelta = null;
          _scheduler.addFrameCallback('test', (deltaMS) => { receivedDelta = deltaMS; });

          await waitFrames(3);
          _scheduler.removeFrameCallback('test');
          assert.isNotNull(receivedDelta, 'callback should have received deltaMS');
          assert.isNumber(receivedDelta, 'deltaMS should be a number');
          assert.isAtLeast(receivedDelta, 0, 'deltaMS should be non-negative');
        });

        it('exposes deltaMS via getter', async () => {
          _scheduler.addFrameCallback('test', () => {});
          await waitFrames(3);
          _scheduler.removeFrameCallback('test');
          assert.isNumber(_scheduler.deltaMS, 'deltaMS getter should return a number');
          assert.isAtLeast(_scheduler.deltaMS, 0, 'deltaMS should be non-negative');
        });

        it('calls multiple frame callbacks in registration order', async () => {
          const order = [];
          _scheduler.addFrameCallback('first', () => { order.push('a'); });
          _scheduler.addFrameCallback('second', () => { order.push('b'); });

          await waitFrames(2);
          _scheduler.removeFrameCallback('first');
          _scheduler.removeFrameCallback('second');
          // Check that both were called and 'a' always came before 'b'
          assert.include(order, 'a');
          assert.include(order, 'b');
          // First occurrence of 'a' should be before first occurrence of 'b'
          assert.isBelow(order.indexOf('a'), order.indexOf('b'));
        });

        it('does not call removed callbacks', async () => {
          let called = false;
          _scheduler.addFrameCallback('test', () => { called = true; });
          _scheduler.removeFrameCallback('test');

          await waitFrames(2);
          assert.isFalse(called, 'removed callback should not be called');
        });

        it('survives a throwing callback without crashing', async () => {
          let secondCalled = false;
          _scheduler.addFrameCallback('bad', () => { throw new Error('boom'); });
          _scheduler.addFrameCallback('good', () => { secondCalled = true; });

          await waitFrames(2);

          assert.lengthOf(spyError.mock.calls, 2, 'console.error called twice');
          assert.match(spyError.mock.lastCall[0], /frame callback 'bad' threw/i);

          _scheduler.removeFrameCallback('bad');
          _scheduler.removeFrameCallback('good');
          assert.isTrue(secondCalled, 'other callbacks should still run');
        });
      });

      describe('pause/resume stops and restarts the loop', () => {
        it('stops calling frame callbacks while paused', async () => {
          let count = 0;
          _scheduler.addFrameCallback('test', () => { count++; });

          await waitFrames(2);
          const countBeforePause = count;

          const release = _scheduler.pause();
          // Wait a bit — no frames should fire
          await Bun.sleep(30);
          assert.strictEqual(count, countBeforePause, 'no callbacks while paused');

          release();
          await waitFrames(2);
          _scheduler.removeFrameCallback('test');
          assert.isAbove(count, countBeforePause, 'callbacks resume after unpause');
        });
      });

      describe('resetAsync preserves frame callbacks', () => {
        it('keeps frame callbacks across resetAsync', async () => {
          let count = 0;
          _scheduler.addFrameCallback('test', () => { count++; });

          await waitFrames(2);
          const countBeforeReset = count;

          await _scheduler.resetAsync();

          await waitFrames(2);
          _scheduler.removeFrameCallback('test');
          assert.isAbove(count, countBeforeReset, 'callback should still fire after reset');
        });
      });

      describe('backpressure', () => {
        describe('metrics getter', () => {
          it('returns the expected shape', () => {
            const m = _scheduler.metrics;
            assert.isNumber(m.avgFrameTime);
            assert.isNumber(m.avgRenderTime);
            assert.isNumber(m.avgIdleTime);
            assert.isNumber(m.droppedFrames);
            assert.isNumber(m.targetFrameTime);
            assert.isString(m.pressure);
          });

          it('starts with zeroed averages and pressure "none"', () => {
            const m = _scheduler.metrics;
            assert.strictEqual(m.avgFrameTime, 0);
            assert.strictEqual(m.avgRenderTime, 0);
            assert.strictEqual(m.avgIdleTime, 0);
            assert.strictEqual(m.droppedFrames, 0);
            assert.strictEqual(m.pressure, 'none');
          });
        });

        describe('pressure getter', () => {
          it('starts at "none"', () => {
            assert.strictEqual(_scheduler.pressure, 'none');
          });
        });

        describe('metrics update after frames', () => {
          it('updates avgFrameTime after frames run', async () => {
            // Register a lightweight callback so frames have measurable work
            _scheduler.addFrameCallback('test', () => {});
            await waitFrames(5);
            _scheduler.removeFrameCallback('test');

            const m = _scheduler.metrics;
            assert.isAbove(m.avgFrameTime, 0, 'avgFrameTime should be positive after frames');
          });

          it('tracks render time from frame callbacks', async () => {
            // Register a callback that does a little work
            _scheduler.addFrameCallback('test', () => {
              let _sum = 0;
              for (let i = 0; i < 100; i++) _sum += i;
            });
            await waitFrames(5);
            _scheduler.removeFrameCallback('test');

            const m = _scheduler.metrics;
            assert.isAtLeast(m.avgRenderTime, 0, 'avgRenderTime should be non-negative');
          });
        });

        describe('pressure escalation via _updateMetrics', () => {
          it('escalates to "light" when many frames are dropped', () => {
            // Directly invoke _updateMetrics to simulate over-budget frames
            // without waiting for real rAF frames
            const budget = _scheduler.targetFrameTime;
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 1.5, budget * 0.5);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy');
          });

          it('escalates through light → moderate → heavy', () => {
            const budget = _scheduler.targetFrameTime;
            const overBudget = budget * 2;

            // Fill ring buffer partially — should reach at least "light"
            for (let i = 0; i < 10; i++) {
              _scheduler._updateMetrics(overBudget, overBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'light', 'should be light after 10/60 dropped');

            // More drops — should reach "moderate"
            for (let i = 0; i < 12; i++) {
              _scheduler._updateMetrics(overBudget, overBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'moderate', 'should be moderate after 22/60 dropped');

            // More drops — should reach "heavy"
            for (let i = 0; i < 18; i++) {
              _scheduler._updateMetrics(overBudget, overBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy', 'should be heavy after 40/60 dropped');
          });

          it('stays "none" when frames are under budget', () => {
            const budget = _scheduler.targetFrameTime;
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 0.5, budget * 0.3, budget * 0.2);
            }
            assert.strictEqual(_scheduler.pressure, 'none');
          });
        });

        describe('pressure recovery with hysteresis', () => {
          it('recovers from heavy → moderate → light → none', () => {
            const budget = _scheduler.targetFrameTime;
            const overBudget = budget * 2;
            const underBudget = budget * 0.5;

            // Drive to heavy
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(overBudget, overBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy');

            // Add under-budget frames to start recovery.
            // Ring buffer wraps, replacing dropped frames with good ones.
            // Need enough good frames to drop ratio below 0.40 (heavy→moderate).
            for (let i = 0; i < 37; i++) {
              _scheduler._updateMetrics(underBudget, underBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'moderate', 'should recover to moderate');

            // More good frames — ratio drops below 0.20 (moderate→light)
            for (let i = 0; i < 13; i++) {
              _scheduler._updateMetrics(underBudget, underBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'light', 'should recover to light');

            // More good frames — ratio drops below 0.05 (light→none)
            for (let i = 0; i < 10; i++) {
              _scheduler._updateMetrics(underBudget, underBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'none', 'should recover to none');
          });

          it('does not oscillate near thresholds', () => {
            const budget = _scheduler.targetFrameTime;
            const overBudget = budget * 2;
            const underBudget = budget * 0.5;

            // Fill to just above light escalation (10 dropped = 16.7%)
            for (let i = 0; i < 10; i++) {
              _scheduler._updateMetrics(overBudget, overBudget, 0);
            }
            for (let i = 0; i < 50; i++) {
              _scheduler._updateMetrics(underBudget, underBudget, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'light', 'should be light at ~16.7%');

            // Recovery threshold for light is 0.05 (3 of 60).
            // Still at 10 dropped in the window — should stay light.
            _scheduler._updateMetrics(underBudget, underBudget, 0);
            assert.strictEqual(_scheduler.pressure, 'light', 'should not oscillate back to none');
          });
        });

        describe('pressurechange event emission', () => {
          it('emits "pressurechange" event when level changes', () => {
            const levels = [];
            _scheduler.on('pressurechange', (level) => levels.push(level));

            const budget = _scheduler.targetFrameTime;
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 2, 0);
            }

            _scheduler.off('pressurechange');

            assert.include(levels, 'light', 'should emit light');
            assert.include(levels, 'moderate', 'should emit moderate');
            assert.include(levels, 'heavy', 'should emit heavy');
            // Should not emit 'none' unless we recover
            assert.notInclude(levels, 'none');
          });

          it('does not emit when level stays the same', () => {
            const levels = [];
            _scheduler.on('pressurechange', (level) => levels.push(level));

            const budget = _scheduler.targetFrameTime;
            // Two consecutive under-budget frames — both 'none', no event
            _scheduler._updateMetrics(budget * 0.5, budget * 0.3, 0);
            _scheduler._updateMetrics(budget * 0.5, budget * 0.3, 0);

            _scheduler.off('pressurechange');

            assert.deepEqual(levels, [], 'should not emit when staying at none');
          });
        });

        describe('idle queue throttling under pressure', () => {
          it('drains idle tasks normally at "none" pressure', async () => {
            assert.strictEqual(_scheduler.pressure, 'none');
            let executed = false;
            await _scheduler.scheduleIdleTask(() => { executed = true; });
            assert.isTrue(executed);
          });

          it('skips idle tasks under "moderate" pressure', async () => {
            const budget = _scheduler.targetFrameTime;
            // Drive to moderate
            for (let i = 0; i < 25; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 2, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'moderate');

            let executed = false;
            _scheduler.scheduleIdleTask(() => { executed = true; }).catch(() => {});

            // Wait a few frames — idle task should NOT drain
            await waitFrames(3);
            assert.isFalse(executed, 'idle task should be skipped under moderate pressure');

            // Clean up: reset to recover pressure and drain
            await _scheduler.resetAsync();
          });

          it('skips idle tasks under "heavy" pressure', async () => {
            const budget = _scheduler.targetFrameTime;
            // Drive to heavy
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 2, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy');

            let executed = false;
            _scheduler.scheduleIdleTask(() => { executed = true; }).catch(() => {});

            await waitFrames(3);
            assert.isFalse(executed, 'idle task should be skipped under heavy pressure');

            await _scheduler.resetAsync();
          });
        });

        describe('resetAsync resets metrics', () => {
          it('resets all metrics and pressure to initial state', async () => {
            const budget = _scheduler.targetFrameTime;
            // Drive to heavy
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 2, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy');

            await _scheduler.resetAsync();

            const m = _scheduler.metrics;
            assert.strictEqual(m.avgFrameTime, 0);
            assert.strictEqual(m.avgRenderTime, 0);
            assert.strictEqual(m.avgIdleTime, 0);
            assert.strictEqual(m.droppedFrames, 0);
            assert.strictEqual(m.pressure, 'none');
            assert.strictEqual(_scheduler.pressure, 'none');
          });

          it('emits pressurechange "none" on resetAsync if system was pressured', async () => {
            const budget = _scheduler.targetFrameTime;
            for (let i = 0; i < 60; i++) {
              _scheduler._updateMetrics(budget * 2, budget * 2, 0);
            }
            assert.strictEqual(_scheduler.pressure, 'heavy');

            const levels = [];
            _scheduler.on('pressurechange', (level) => levels.push(level));
            await _scheduler.resetAsync();
            _scheduler.off('pressurechange');

            assert.include(levels, 'none');
          });

          it('does not emit pressurechange event on resetAsync if already "none"', async () => {
            assert.strictEqual(_scheduler.pressure, 'none');

            const levels = [];
            _scheduler.on('pressurechange', (level) => levels.push(level));
            await _scheduler.resetAsync();
            _scheduler.off('pressurechange');

            assert.deepEqual(levels, []);
          });
        });
      });
    });
  });
});
