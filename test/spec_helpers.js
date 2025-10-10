/* eslint no-extend-native:off */

import { expect } from '../node_modules/chai/index.js';
window.expect = expect;

// Try not to load imagery
window.location.hash = '#background=none';

mocha.setup({
  timeout: 5000,  // 5 sec
  ui: 'bdd',
  globals: [
    '__onmousemove.zoom',
    '__onmouseup.zoom',
    '__onkeydown.select',
    '__onkeyup.select',
    '__onclick.draw',
    '__onclick.draw-block'
  ]
});

delete window.PointerEvent;  // force the browser to use mouse events

window.fetchMock.mockGlobal();
