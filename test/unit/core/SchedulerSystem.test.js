import { beforeAll, afterEach, describe, it } from 'bun:test';
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
        assert.strictEqual(scheduler.requiredDependencies.size, 0);
        assert.strictEqual(scheduler.optionalDependencies.size, 0);
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

        // Resume — the 'resumed' event triggers _drainPending
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
        await new Promise(resolve => { setTimeout(resolve, 60); });
        assert.isFalse(executed, 'cancelled task should never run');
      });
    });
  });
});
