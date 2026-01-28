/* eslint no-extend-native:off */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

import fetchMock from 'fetch-mock';
window.fetchMock = fetchMock;
window.fetchMock.mockGlobal();

import { assert } from 'chai';
window.assert = assert;

// Try not to load imagery
window.location.hash = '#background=none';

// Force the browser to use mouse events
delete window.PointerEvent;

// Dynamic import the Rapid code.
// This should happen after all the static imports and above code has run.
// The reason is because `spectorjs` has side-effects involving `window`,
// so happy-dom must be imported and registered first.
await import('../modules/main_dev.js');
