import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { strict as assert } from 'bun:assert';
import * as Rapid from '../../../modules/headless.js';


describe('utilDetect', () => {
  let origNavigator;

  beforeAll(() => {
    origNavigator = globalThis.navigator;
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,  // restore original
      configurable: true,
      writable: true
    });
  });

  beforeEach(() => {
    // Bypass the read-only restriction by redefining the property
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        languages: ['en-US', 'en'],
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      },
      configurable: true, // Allows it to be changed or deleted again later
      writable: true
    });
  });

  it('should detect the browser and version', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
    globalThis.navigator.userAgent = ua;
    const detected = Rapid.utilDetect(true);
    assert.strictEqual(detected.browser, 'Chrome');
    assert.strictEqual(detected.version, '58.0');
  });

  it('should detect the os and platform', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
    globalThis.navigator.userAgent = ua;
    const detected = Rapid.utilDetect(true);
    assert.strictEqual(detected.os, 'win');
    assert.strictEqual(detected.platform, 'Windows');
  });

  it('should detect the locale', () => {
    globalThis.navigator.languages = ['es'];
    const detected = Rapid.utilDetect(true);
    assert.ok(detected.locales.includes('es'));
  });
});
