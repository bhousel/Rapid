/* eslint no-extend-native:off */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

// import * as Rapid from '../dist/js/rapid-dev.js';
import '../modules/main_dev.js';

import fetchMock from 'fetch-mock';
window.fetchMock = fetchMock;
window.fetchMock.mockGlobal();

import { assert } from 'chai';
window.assert = assert;

// Try not to load imagery
window.location.hash = '#background=none';

// Force the browser to use mouse events
delete window.PointerEvent;
