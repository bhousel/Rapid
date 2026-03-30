import { afterEach, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('NetworkSystem', () => {
  const context = new Rapid.MockContext();
  let network;

  beforeEach(async () => {
    network = new Rapid.NetworkSystem(context);
    await network.initAsync();
    await network.startAsync();
  });

  afterEach(async () => {
    await network.resetAsync();
  });


  // -- lifecycle --

  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a NetworkSystem from a context', () => {
        const sys = new Rapid.NetworkSystem(context);
        assert.instanceOf(sys, Rapid.NetworkSystem);
        assert.strictEqual(sys.id, 'network');
        assert.strictEqual(sys.context, context);
        assert.strictEqual(sys.requiredDependencies.size, 0);
        assert.isTrue(sys.optionalDependencies.has('scheduler'));
        assert.isTrue(sys.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const sys = new Rapid.NetworkSystem(context);
        const prom = sys.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('returns the same promise on subsequent calls', () => {
        const sys = new Rapid.NetworkSystem(context);
        const prom1 = sys.initAsync();
        const prom2 = sys.initAsync();
        assert.strictEqual(prom1, prom2);
        return prom1;
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const sys = new Rapid.NetworkSystem(context);
        const prom = sys.initAsync().then(() => sys.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(sys.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const sys = new Rapid.NetworkSystem(context);
        const prom = sys.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });
    });
  });


  // -- default properties --

  describe('properties', () => {
    it('has a default timeout of 30 seconds', () => {
      assert.strictEqual(network.defaultTimeout, 30_000);
    });

    it('allows setting defaultTimeout', () => {
      network.defaultTimeout = 10_000;
      assert.strictEqual(network.defaultTimeout, 10_000);
    });

    it('clamps negative defaultTimeout to 0', () => {
      network.defaultTimeout = -100;
      assert.strictEqual(network.defaultTimeout, 0);
    });

    it('has a default maxInflight of 100', () => {
      assert.strictEqual(network.maxInflight, 100);
    });

    it('allows setting maxInflight', () => {
      network.maxInflight = 50;
      assert.strictEqual(network.maxInflight, 50);
    });

    it('clamps maxInflight to at least 1', () => {
      network.maxInflight = 0;
      assert.strictEqual(network.maxInflight, 1);
    });
  });


  // -- fetch --

  describe('fetch', () => {
    it('fetches a URL on the main thread and parses the response', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ hello: 'world' }), {
          headers: { 'content-type': 'application/json' },
        }))
      );
      globalThis.fetch = mockFetch;

      const result = await network.fetch('https://example.com/data.json', { timeout: 0 });
      assert.deepStrictEqual(result, { hello: 'world' });
      assert.strictEqual(mockFetch.mock.calls.length, 1);
    });

    it('uses METHOD + URL as the default requestID', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }))
      );
      globalThis.fetch = mockFetch;

      const prom = network.fetch('https://example.com/test.json', { timeout: 0 });
      assert.isTrue(network.isInflight('GET https://example.com/test.json'));
      assert.isFalse(network.isInflight('https://example.com/test.json'));
      await prom;
    });

    it('uses a custom requestID when provided', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }))
      );
      globalThis.fetch = mockFetch;

      const prom = network.fetch('https://example.com/test.json', { requestID: 'my-key', timeout: 0 });
      assert.isTrue(network.isInflight('my-key'));
      assert.isFalse(network.isInflight('GET https://example.com/test.json'));
      await prom;
    });

    it('tracks numInflight correctly', async () => {
      let resolveResponse;
      const mockFetch = mock(() =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        })
      );
      globalThis.fetch = mockFetch;

      assert.strictEqual(network.numInflight, 0);
      const prom = network.fetch('https://example.com/pending.json', { timeout: 0 });
      assert.strictEqual(network.numInflight, 1);

      resolveResponse(new Response('{}', {
        headers: { 'content-type': 'application/json' },
      }));
      await prom;
      assert.strictEqual(network.numInflight, 0);
    });
  });


  // -- deduplication --

  describe('deduplication', () => {
    it('returns the same promise for duplicate keys', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ id: 1 }), {
          headers: { 'content-type': 'application/json' },
        }))
      );
      globalThis.fetch = mockFetch;

      const prom1 = network.fetch('https://example.com/dedup.json', { timeout: 0 });
      const prom2 = network.fetch('https://example.com/dedup.json', { timeout: 0 });
      assert.strictEqual(prom1, prom2);
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      await prom1;
    });
  });


  // -- abort --

  describe('abort', () => {
    it('aborts a specific inflight request by requestID', async () => {
      const mockFetch = mock((url, init) => {
        return new Promise((resolve, reject) => {
          const onAbort = () => { const err = new Error('Aborted'); err.name = 'AbortError'; reject(err); };
          if (init?.signal?.aborted) { onAbort(); return; }
          init?.signal?.addEventListener('abort', onAbort, { once: true });
        });
      });
      globalThis.fetch = mockFetch;

      const prom = network.fetch('https://example.com/slow.json', { requestID: 'slow', timeout: 0 });
      assert.isTrue(network.isInflight('slow'));

      network.abort('slow');

      try {
        await prom;
        assert.fail('should have thrown');
      } catch (e) {
        assert.strictEqual(e.name, 'AbortError');
      }
      assert.isFalse(network.isInflight('slow'));
    });

    it('is a no-op for unknown requestIDs', () => {
      // Should not throw
      network.abort('nonexistent');
    });
  });


  // -- abortAll --

  describe('abortAll', () => {
    it('aborts all inflight requests', async () => {
      const mockFetch = mock((url, init) => {
        return new Promise((resolve, reject) => {
          const onAbort = () => { const err = new Error('Aborted'); err.name = 'AbortError'; reject(err); };
          if (init?.signal?.aborted) { onAbort(); return; }
          init?.signal?.addEventListener('abort', onAbort, { once: true });
        });
      });
      globalThis.fetch = mockFetch;

      const prom1 = network.fetch('https://example.com/a.json', { requestID: 'a', timeout: 0 });
      const prom2 = network.fetch('https://example.com/b.json', { requestID: 'b', timeout: 0 });
      assert.strictEqual(network.numInflight, 2);

      network.abortAll();

      const results = await Promise.allSettled([prom1, prom2]);
      assert.strictEqual(results[0].status, 'rejected');
      assert.strictEqual(results[1].status, 'rejected');
      assert.strictEqual(network.numInflight, 0);
    });
  });


  // -- abortMatching --

  describe('abortMatching', () => {
    it('aborts only requests matching the predicate', async () => {
      let resolveKeep;
      const mockFetch = mock((url, init) => {
        if (url.includes('keep')) {
          return new Promise(resolve => { resolveKeep = resolve; });
        }
        return new Promise((resolve, reject) => {
          const onAbort = () => { const err = new Error('Aborted'); err.name = 'AbortError'; reject(err); };
          if (init?.signal?.aborted) { onAbort(); return; }
          init?.signal?.addEventListener('abort', onAbort, { once: true });
        });
      });
      globalThis.fetch = mockFetch;

      const promAbort = network.fetch('https://example.com/tiles/1', { requestID: 'tile-1', timeout: 0 });
      const promKeep = network.fetch('https://example.com/keep', { requestID: 'keep-1', timeout: 0 });
      assert.strictEqual(network.numInflight, 2);

      network.abortMatching(requestID => requestID.startsWith('tile-'));

      const abortResult = await Promise.allSettled([promAbort]);
      assert.strictEqual(abortResult[0].status, 'rejected');
      assert.isTrue(network.isInflight('keep-1'));

      // Clean up
      resolveKeep(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      await promKeep;
    });
  });


  // -- fetchRaw --

  describe('fetchRaw', () => {
    it('returns the raw Response without parsing', async () => {
      const rawResponse = new Response('raw body text', {
        headers: { 'content-type': 'text/plain' },
      });
      const mockFetch = mock(() => Promise.resolve(rawResponse));
      globalThis.fetch = mockFetch;

      const response = await network.fetchRaw('https://example.com/raw', { timeout: 0 });
      assert.instanceOf(response, Response);
      const text = await response.text();
      assert.strictEqual(text, 'raw body text');
    });

    it('supports dedup for fetchRaw', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('ok')));
      globalThis.fetch = mockFetch;

      const prom1 = network.fetchRaw('https://example.com/raw', { timeout: 0 });
      const prom2 = network.fetchRaw('https://example.com/raw', { timeout: 0 });
      assert.strictEqual(prom1, prom2);
      await prom1;
    });
  });


  // -- concurrency limiting --

  describe('concurrency limiting', () => {
    it('queues requests when at maxInflight', async () => {
      network.maxInflight = 2;
      const resolvers = [];
      const mockFetch = mock(() => {
        return new Promise(resolve => {
          resolvers.push(resolve);
        });
      });
      globalThis.fetch = mockFetch;

      const prom1 = network.fetch('https://example.com/1', { requestID: 'c1', timeout: 0 });
      const prom2 = network.fetch('https://example.com/2', { requestID: 'c2', timeout: 0 });
      const prom3 = network.fetch('https://example.com/3', { requestID: 'c3', timeout: 0 });

      assert.strictEqual(network.numInflight, 3);  // all tracked
      assert.strictEqual(network.numQueued, 1);     // third is queued
      assert.strictEqual(mockFetch.mock.calls.length, 2);  // only 2 dispatched

      // Complete first request → third should drain from queue
      resolvers[0](new Response('{}', { headers: { 'content-type': 'application/json' } }));
      await prom1;

      // Give microtask queue a chance to drain
      await new Promise(r => { setTimeout(r, 10); });

      assert.strictEqual(network.numQueued, 0);
      assert.strictEqual(mockFetch.mock.calls.length, 3);  // all 3 dispatched now

      // Clean up remaining
      resolvers[1](new Response('{}', { headers: { 'content-type': 'application/json' } }));
      resolvers[2](new Response('{}', { headers: { 'content-type': 'application/json' } }));
      await Promise.all([prom2, prom3]);
    });

    it('aborts queued requests without making a network request', async () => {
      network.maxInflight = 1;
      let resolver;
      const mockFetch = mock(() => {
        return new Promise(resolve => { resolver = resolve; });
      });
      globalThis.fetch = mockFetch;

      const prom1 = network.fetch('https://example.com/1', { requestID: 'q1', timeout: 0 });
      const prom2 = network.fetch('https://example.com/2', { requestID: 'q2', timeout: 0 });

      assert.strictEqual(network.numQueued, 1);
      assert.strictEqual(mockFetch.mock.calls.length, 1);  // only first dispatched

      network.abort('q2');
      assert.strictEqual(network.numQueued, 0);

      const r2 = await Promise.allSettled([prom2]);
      assert.strictEqual(r2[0].status, 'rejected');
      assert.strictEqual(r2[0].reason.name, 'AbortError');

      // Still only 1 fetch was made
      assert.strictEqual(mockFetch.mock.calls.length, 1);

      // Clean up
      resolver(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      await prom1;
    });
  });


  // -- custom fetchFn --

  describe('fetchFn option', () => {
    it('uses a custom fetch function when provided', async () => {
      const customFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ auth: true }), {
          headers: { 'content-type': 'application/json' },
        }))
      );

      const result = await network.fetch('https://example.com/auth', {
        fetchFn: customFetch,
        timeout: 0,
      });
      assert.deepStrictEqual(result, { auth: true });
      assert.strictEqual(customFetch.mock.calls.length, 1);
    });
  });


  // -- cleanup after reset --

  describe('resetAsync', () => {
    it('aborts all inflight requests on reset', async () => {
      const mockFetch = mock((url, init) => {
        return new Promise((resolve, reject) => {
          const onAbort = () => { const err = new Error('Aborted'); err.name = 'AbortError'; reject(err); };
          if (init?.signal?.aborted) { onAbort(); return; }
          init?.signal?.addEventListener('abort', onAbort, { once: true });
        });
      });
      globalThis.fetch = mockFetch;

      const prom = network.fetch('https://example.com/reset.json', { requestID: 'reset', timeout: 0 });
      assert.strictEqual(network.numInflight, 1);

      await network.resetAsync();

      const result = await Promise.allSettled([prom]);
      assert.strictEqual(result[0].status, 'rejected');
      assert.strictEqual(network.numInflight, 0);
    });
  });


  // -- inflight cleanup in .finally() --

  describe('inflight cleanup', () => {
    it('removes inflight entry even when fetch rejects with a non-abort error', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('network error')));
      globalThis.fetch = mockFetch;

      const prom = network.fetch('https://example.com/fail.json', { requestID: 'fail', timeout: 0 });
      assert.isTrue(network.isInflight('fail'));

      try {
        await prom;
      } catch {
        // expected
      }
      assert.isFalse(network.isInflight('fail'));
    });
  });
});
