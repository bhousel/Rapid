import './polyfills.ts';

// Capture the script URL at eval time (document.currentScript is only
// available synchronously during script execution, not later in callbacks).
const _scriptURL = globalThis.document?.currentScript?.src ?? null;

import * as RAPID from './index.js';
globalThis.Rapid = { ...RAPID };
globalThis.Rapid.isDebug = false;
globalThis.Rapid.scriptURL = _scriptURL;
