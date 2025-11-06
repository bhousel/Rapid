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
globalThis.Rapid.isDebug = false;
