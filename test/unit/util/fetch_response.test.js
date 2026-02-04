import { describe, it } from 'bun:test';
import { strict as assert } from 'bun:assert';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './fetch_response.sample.js';


describe('utilFetchResponse', () => {
  it('should handle successful JSON response', async () => {
    // Mock a successful fetch response with JSON content
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.json',
      headers: {
        get: () => 'application/json'
      },
      json: () => Promise.resolve({ key: 'value' })
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, { key: 'value' });
  });

  it('should throw FetchError for unsuccessful response', async () => {
    // Mock an unsuccessful fetch response
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      url: 'http://example.com/data.json',
      headers: {
        get: () => 'application/json'
      }
    };

    try {
      await Rapid.utilFetchResponse(mockResponse);
      assert.fail('Expected utilFetchResponse to throw');
    } catch (err) {
      assert(err instanceof Rapid.FetchError);
      assert.strictEqual(err.status, 404);
      assert.strictEqual(err.statusText, 'Not Found');
    }
  });

  it('should handle JSON5 response with explicit content-type', async () => {
    // Mock a successful fetch response with JSON5 content
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.json5',
      headers: {
        get: () => 'application/json5'
      },
      text: () => Promise.resolve(sample.json5WithComments)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, sample.json5Expected);
  });

  it('should handle JSON5 response with file extension inference', async () => {
    // Mock a response with no content-type header, inferred from .json5 extension
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/config/styles.json5',
      headers: {
        get: () => null  // No content-type header
      },
      text: () => Promise.resolve(sample.json5WithHex)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, sample.json5HexExpected);
  });

  it('should handle JSONC response with explicit content-type', async () => {
    // Mock a successful fetch response with JSONC content
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.jsonc',
      headers: {
        get: () => 'application/jsonc'
      },
      text: () => Promise.resolve(sample.jsoncWithComments)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, sample.jsoncExpected);
  });

  it('should handle JSONC response with file extension inference', async () => {
    // Mock a response with no content-type header, inferred from .jsonc extension
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/settings.jsonc',
      headers: {
        get: () => ''  // Empty content-type
      },
      text: () => Promise.resolve(sample.jsoncNested)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, sample.jsoncNestedExpected);
  });

  it('should handle 204 No Content for JSON5', async () => {
    const mockResponse = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      url: 'http://example.com/data.json5',
      headers: {
        get: () => 'application/json5'
      }
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, undefined);
  });

  it('should handle 204 No Content for JSONC', async () => {
    const mockResponse = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      url: 'http://example.com/data.jsonc',
      headers: {
        get: () => 'application/jsonc'
      }
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, undefined);
  });

  it('should infer application/json from .geojson extension', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.geojson',
      headers: {
        get: () => null
      },
      json: () => Promise.resolve(sample.geojsonExpected)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.deepStrictEqual(result, sample.geojsonExpected);
  });

  it('should handle XML response with application/xml content-type', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.xml',
      headers: {
        get: () => 'application/xml'
      },
      text: () => Promise.resolve(sample.xmlData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);  // Should return a Document
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should infer application/xml from .xml extension', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.xml',
      headers: {
        get: () => ''
      },
      text: () => Promise.resolve(sample.xmlData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should handle SVG with image/svg+xml content-type', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/image.svg',
      headers: {
        get: () => 'image/svg+xml'
      },
      text: () => Promise.resolve(sample.svgData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should infer image/svg+xml from .svg extension', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/icon.svg',
      headers: {
        get: () => null
      },
      text: () => Promise.resolve(sample.svgData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should handle HTML with text/html content-type', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/page.html',
      headers: {
        get: () => 'text/html'
      },
      text: () => Promise.resolve(sample.htmlData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should infer text/html from .html extension', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/page.html',
      headers: {
        get: () => ''
      },
      text: () => Promise.resolve(sample.htmlData)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert(result);
    assert.strictEqual(result.constructor.name, 'Document');
  });

  it('should handle protobuf with application/protobuf content-type', async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.pbf',
      headers: {
        get: () => 'application/protobuf'
      },
      arrayBuffer: () => Promise.resolve(arrayBuffer)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, arrayBuffer);
  });

  it('should infer application/protobuf from .pbf extension', async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/tiles/14/8192/8647.pbf',
      headers: {
        get: () => null
      },
      arrayBuffer: () => Promise.resolve(arrayBuffer)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, arrayBuffer);
  });

  it('should infer application/protobuf from .mvt extension', async () => {
    const arrayBuffer = new Uint8Array([5, 6, 7, 8]).buffer;
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/tiles/14/8192/8647.mvt',
      headers: {
        get: () => ''
      },
      arrayBuffer: () => Promise.resolve(arrayBuffer)
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, arrayBuffer);
  });

  it('should default to text/plain for unknown extensions', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'http://example.com/data.xyz',
      headers: {
        get: () => null
      },
      text: () => Promise.resolve('plain text content')
    };

    const result = await Rapid.utilFetchResponse(mockResponse);
    assert.strictEqual(result, 'plain text content');
  });
});
