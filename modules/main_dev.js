// Polyfill idle callback functions (for Safari)
globalThis.requestIdleCallback = globalThis.requestIdleCallback ||
  function(cb) {
    var start = Date.now();
    return globalThis.requestAnimationFrame(function() {
      cb({
        didTimeout: false,
        timeRemaining: function() {
          return Math.max(0, 50 - (Date.now() - start));
        }
      });
    });
  };
globalThis.cancelIdleCallback = globalThis.cancelIdleCallback ||
  function(handle) {
    globalThis.cancelAnimationFrame(handle);
  };

import * as RAPID from './index.js';
globalThis.Rapid = { ...RAPID };
globalThis.Rapid.isDebug = true;

// Include rapid-sdk as a single `sdk` namespace.
// (This works because we know there are no name conflicts)
import * as SDKMATH from '@rapid-sdk/math';
import * as SDKUTIL from '@rapid-sdk/util';
globalThis.Rapid.sdk = { ...SDKMATH, ...SDKUTIL };

import * as d3 from 'd3';
globalThis.d3 = d3;

import * as PIXI from 'pixi.js';
globalThis.PIXI = PIXI;

import * as SPECTOR from 'spectorjs';
globalThis.SPECTOR = SPECTOR;
