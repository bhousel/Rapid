import './polyfills.ts';

// Capture the script URL at eval time (document.currentScript is only
// available synchronously during script execution, not later in callbacks).
const _scriptURL = globalThis.document?.currentScript?.src ?? null;

import * as RAPID from './index.js';
globalThis.Rapid = { ...RAPID };
globalThis.Rapid.isDebug = true;
globalThis.Rapid.scriptURL = _scriptURL;

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
