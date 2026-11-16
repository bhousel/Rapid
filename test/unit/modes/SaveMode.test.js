import { afterEach, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { SaveMode } from '../../../modules/modes/SaveMode.ts';
import { UiSuccess } from '../../../modules/ui/UiSuccess.ts';


describe('SaveMode', () => {
  // A mode with stand-ins for what the upload results use (no DOM, no network)
  let context, mode, escapeOn, entered, resets, timers;
  const origSetTimeout = globalThis.setTimeout;
  const origCommunityIndex = UiSuccess.prototype._getCommunityIndexAsync;

  beforeEach(() => {
    escapeOn = false;
    entered = [];
    resets = 0;
    timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
    UiSuccess.prototype._getCommunityIndexAsync = () => Promise.resolve({});

    context = new Rapid.MockContext();
    const scope = {
      on: () => scope,
      enable: () => { escapeOn = true; return scope; },
      disable: () => { escapeOn = false; return scope; }
    };
    context.systems = {
      keyboard: { scope: () => scope },
      ui: { Sidebar: { show: () => {} } }
    };
    context.resetAsync = () => { resets++; return Promise.resolve(); };
    context.enter = modeID => entered.push(modeID);

    mode = new SaveMode(context);
    mode._showLoading = () => {};
    mode._hideLoading = () => {};
    mode._keybindingOn();   // as `enter()` does
  });

  afterEach(() => {
    globalThis.setTimeout = origSetTimeout;
    UiSuccess.prototype._getCommunityIndexAsync = origCommunityIndex;
  });


  it('after a successful upload, Escape stays off until the reset, which returns to browse mode', async () => {
    mode._saveStarted();
    assert.isFalse(escapeOn);

    mode._resultSuccess({});   // the uploader emits 'resultSuccess', then 'saveEnded'
    mode._saveEnded();
    assert.isFalse(escapeOn, 'Escape would leave save mode with the uploaded edits still in the history');
    assert.deepEqual(entered, []);

    assert.lengthOf(timers, 1);
    timers[0].fn();            // the delay before the reset
    await Promise.resolve();
    assert.strictEqual(resets, 1);
    assert.deepEqual(entered, ['browse']);
  });

  it('after a failed upload, Escape works again', () => {
    mode._saveStarted();
    mode._saveEnded();
    assert.isTrue(escapeOn);
  });
});
