import { afterEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';

import * as WORKER from '../../../modules/services/OsmService.worker.ts';
import { n1 as jsonN1, n2 as jsonN2 } from '../data/parsers/OsmJSONParser.sample.js';
import { n1 as xmlN1, n2 as xmlN2 } from '../data/parsers/OsmXMLParser.sample.js';


describe('OsmService.worker listeners', () => {
  const signal = new AbortController().signal;
  let originalFetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = undefined;
    }
  });


  describe('osmServiceListeners export', () => {
    it('exports listener IDs', () => {
      assert.hasAllKeys(WORKER.osmServiceListeners, [
        'osmService:fetchAndParse'
      ]);
    });
  });


  describe('fetchAndParse (JSON format)', () => {
    it('returns ok result with parsed OSM JSON data', async () => {
      const osmResponse = { elements: [jsonN1, jsonN2] };
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(osmResponse), {
          headers: { 'content-type': 'application/json' },
        }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map.json',
        format: 'json',
      }, signal);

      assert.isTrue(result.ok);
      assert.isObject(result.value);
      assert.isArray(result.value.data);
      assert.isAbove(result.value.data.length, 0, 'should parse at least one element');
    });

    it('passes parser options through', async () => {
      const osmResponse = { elements: [jsonN1] };
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(osmResponse), {
          headers: { 'content-type': 'application/json' },
        }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map.json',
        format: 'json',
      }, signal);

      assert.isTrue(result.ok);
      assert.isArray(result.value.data);
    });

    it('passes RequestInit options to fetch', async () => {
      const osmResponse = { elements: [jsonN1] };
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock((url, init) => {
        return Promise.resolve(new Response(JSON.stringify(osmResponse), {
          headers: { 'content-type': 'application/json' },
        }));
      });

      await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map.json',
        format: 'json',
        init: { headers: { 'Authorization': 'Bearer token' } },
      }, signal);

      const call = globalThis.fetch.mock.calls[0];
      const headers = new Headers(call[1].headers);
      assert.strictEqual(headers.get('authorization'), 'Bearer token');
    });
  });


  describe('fetchAndParse (XML format)', () => {
    it('returns ok result with parsed OSM XML data', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  ${xmlN1}
  ${xmlN2}
</osm>`;

      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(xml, {
          headers: { 'content-type': 'application/xml' },
        }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map',
        format: 'xml',
      }, signal);

      assert.isTrue(result.ok);
      assert.isObject(result.value);
      assert.isArray(result.value.data);
      assert.isAbove(result.value.data.length, 0, 'should parse at least one element');
    });
  });


  describe('fetchAndParse (HTTP errors)', () => {
    it('returns error result with status details on 404', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/node/dummy',
        format: 'json',
      }, signal);

      assert.isFalse(result.ok);
      assert.strictEqual(result.status, 404);
      assert.strictEqual(result.statusText, 'Not Found');
      assert.strictEqual(result.message, '404 Not Found');
      assert.strictEqual(result.body, 'Not Found');
    });

    it('returns error result with status details on 403', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/changeset/create',
        format: 'xml',
      }, signal);

      assert.isFalse(result.ok);
      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.statusText, 'Forbidden');
    });

    it('returns error result with rate-limit body on 429', async () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Rate limit exceeded. Please try again later.', {
          status: 429,
          statusText: 'Too Many Requests',
        }))
      );

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map',
        format: 'json',
      }, signal);

      assert.isFalse(result.ok);
      assert.strictEqual(result.status, 429);
      assert.include(result.body, 'Rate limit');
    });

    it('handles unreadable response body gracefully', async () => {
      originalFetch = globalThis.fetch;
      // Create a non-ok response whose body has already been consumed
      const consumed = new Response('body', { status: 500, statusText: 'Internal Server Error' });
      await consumed.text();  // consume the body so .text() will throw on retry

      globalThis.fetch = mock(() => Promise.resolve(consumed));

      const result = await WORKER.fetchAndParse({
        url: 'https://api.openstreetmap.org/api/0.6/map',
        format: 'json',
      }, signal);

      assert.isFalse(result.ok);
      assert.strictEqual(result.status, 500);
      // body should fall back to empty string when body is unreadable
      assert.strictEqual(result.body, '');
    });
  });


  describe('repeated requests', () => {
    it('returns previously parsed elements on every request', async () => {
      const osmResponse = { elements: [jsonN1] };
      originalFetch = globalThis.fetch;

      const counts = [];
      for (let i = 0; i < 2; i++) {
        globalThis.fetch = mock(() =>
          Promise.resolve(new Response(JSON.stringify(osmResponse), {
            headers: { 'content-type': 'application/json' },
          }))
        );
        const result = await WORKER.fetchAndParse({
          url: 'https://api.openstreetmap.org/api/0.6/map.json',
          format: 'json',
        }, signal);
        assert.isTrue(result.ok);
        counts.push(result.value.data.length);
      }

      assert.deepEqual(counts, [1, 1]);
    });
  });
});
