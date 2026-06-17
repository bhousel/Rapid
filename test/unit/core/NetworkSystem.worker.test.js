import { afterEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';

import * as WORKER from '../../../modules/core/NetworkSystem.worker.ts';
import * as sample from './NetworkSystem.sample.js';


describe('NetworkSystem.worker listeners', () => {
  const signal = new AbortController().signal;
  let originalFetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = undefined;
    }
    WORKER.reset(undefined, signal);
  });


  describe('networkListeners export', () => {
    it('exports listener IDs', () => {
      assert.hasAllKeys(WORKER.networkListeners, [
        'network:fetchAndParse',
        'network:fetchAndParseMVT',
        'network:fetchAndParseOsmJson',
        'network:fetchAndParseOsmXml',
        'network:reset'
      ]);
    });
  });


  describe('fetchAndParse', () => {
    it('fetches a URL and returns parsed JSON', async () => {
      const body = JSON.stringify({ hello: 'world' });
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(body, {
          headers: { 'content-type': 'application/json' },
        }))
      );

      const result = await WORKER.fetchAndParse({ url: 'https://example.com/data.json' }, signal);
      assert.deepStrictEqual(result, { ok: true, status: 200, value: { hello: 'world' } });
    });

    it('passes RequestInit options to fetch', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock((url, init) => {
        return Promise.resolve(new Response('"ok"', {
          headers: { 'content-type': 'application/json' },
        }));
      });

      await WORKER.fetchAndParse({
        url: 'https://example.com/auth.json',
        init: { headers: { 'Authorization': 'Bearer token' } },
      }, signal);

      const call = globalThis.fetch.mock.calls[0];
      const headers = new Headers(call[1].headers);
      assert.strictEqual(headers.get('authorization'), 'Bearer token');
    });

    it('returns an HTTP-error envelope (does not throw)', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' }))
      );

      const result = await WORKER.fetchAndParse({ url: 'https://example.com/dummy' }, signal);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 404);
      assert.match(result.message, /404/);
    });
  });


  describe('fetchAndParseOsmJson', () => {
    it('fetches and parses OSM JSON response', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(sample.osmJSONResponse), {
          headers: { 'content-type': 'application/json' },
        }))
      );

      const result = await WORKER.fetchAndParseOsmJson({ url: 'https://api.openstreetmap.org/api/0.6/map.json' }, signal);
      assert.isTrue(result.ok);
      assert.isArray(result.value.data);
      assert.isAbove(result.value.data.length, 0, 'should parse at least one element');
    });

    it('passes parser options through', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(sample.osmJSONResponse), {
          headers: { 'content-type': 'application/json' },
        }))
      );

      // skipSeen=false ensures previously-seen nodes are not skipped
      const result = await WORKER.fetchAndParseOsmJson({
        url: 'https://api.openstreetmap.org/api/0.6/map.json',
        parserOptions: { skipSeen: false },
      }, signal);

      assert.isTrue(result.ok);
      assert.isArray(result.value.data);
    });
  });


  describe('fetchAndParseOsmXml', () => {
    it('fetches and parses OSM XML response', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(sample.osmXMLResponse, {
          headers: { 'content-type': 'application/xml' },
        }))
      );

      const result = await WORKER.fetchAndParseOsmXml({ url: 'https://api.openstreetmap.org/api/0.6/map' }, signal);
      assert.isTrue(result.ok);
      assert.isArray(result.value.data);
      assert.isAbove(result.value.data.length, 0, 'should parse at least one element');
    });
  });


  describe('fetchAndParseMVT', () => {
    it('decodes a protobuf-encoded MVT and returns GeoJSON features', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(sample.singlePbf, {
          headers: { 'content-type': 'application/x-protobuf' },
        }))
      );

      const result = await WORKER.fetchAndParseMVT({
        url: 'https://tiles.example.com/14/8647/8192.mvt',
        tileXYZ: sample.tileXYZ
      }, signal);
      assert.isTrue(result.ok);
      const results = result.value;
      assert.isArray(results);
      assert.isAbove(results.length, 0, 'should have at least one feature');

      const first = results[0];
      assert.strictEqual(first.layerID, 'test');
      assert.isObject(first.feature);
      assert.strictEqual(first.feature.type, 'Feature');
      assert.isObject(first.feature.geometry);
    });

    it('returns empty array when fetch returns falsy buffer', async () => {
      originalFetch = globalThis.fetch;
      // Simulate a 204 No Content (utilFetchResponse returns undefined for 204 on JSON)
      // We mock fetchAndParse effectively by returning undefined from fetch+parse
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(null, {
          status: 204,
          headers: { 'content-type': 'application/json' },
        }))
      );

      const results = await WORKER.fetchAndParseMVT({
        url: 'https://tiles.example.com/empty.mvt',
        tileXYZ: sample.tileXYZ
      }, signal);
      assert.isTrue(results.ok);
      assert.isArray(results.value);
      assert.strictEqual(results.value.length, 0);
    });

    it('works with the Mapillary-style multi-layer fixture', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(sample.multiPbf, {
          headers: { 'content-type': 'application/x-protobuf' },
        }))
      );

      const result = await WORKER.fetchAndParseMVT({
        url: 'https://tiles.example.com/14/8647/8192.mvt',
        tileXYZ: sample.tileXYZ
      }, signal);
      assert.isTrue(result.ok);
      const results = result.value;
      assert.isArray(results);

      const layerIDs = [...new Set(results.map(r => r.layerID))];
      assert.includeMembers(layerIDs, ['image', 'sequence']);

      const imageFeatures = results.filter(r => r.layerID === 'image');
      assert.isAbove(imageFeatures.length, 0, 'should have image features');

      const seqFeatures = results.filter(r => r.layerID === 'sequence');
      assert.isAbove(seqFeatures.length, 0, 'should have sequence features');
    });
  });


  describe('reset', () => {
    it('resets internal parser state without throwing', () => {
      // Just verify it doesn't throw — parser internal state is opaque
      assert.doesNotThrow(() => WORKER.reset(undefined, signal));
    });
  });
});
