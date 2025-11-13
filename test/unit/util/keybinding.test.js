import { describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilKeybinding', () => {
  it('should return a function', () => {
    const keybinding = Rapid.utilKeybinding('test');
    assert.strictEqual(typeof keybinding, 'function');
  });

  it('should add and remove keybindings', () => {
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('A', () => {});
    keybinding.off('a');
  });

  it('should trigger the correct callback when a key is pressed', () => {
    const callback = mock();
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('A', callback);
    keybinding.trigger({ type: 'keydown', key: 'a' });
    assert.lengthOf(callback.mock.calls, 1);
  });

  it('should not trigger the callback when a different key is pressed', () => {
    const callback = mock();
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('B', callback);
    keybinding.trigger({ type: 'keydown', key: 'a' });
    assert.lengthOf(callback.mock.calls, 0);
  });

  it('if multiple keybindings for the same key, the last one overrides earlier ones', () => {
    const orig = console.warn;
    console.warn = () => {};   // temporarily silence the warning

    return Promise.resolve()
      .then(() => {
        const callback1 = mock();
        const callback2 = mock();
        const keybinding = Rapid.utilKeybinding('test');
        keybinding.on('A', callback1);
        keybinding.on('A', callback2);
        keybinding.trigger({ type: 'keydown', key: 'a' });
        assert.lengthOf(callback1.mock.calls, 0);
        assert.lengthOf(callback2.mock.calls, 1);
      })
      .finally(() => {
        console.warn = orig;  // restore console.warn
      })
  });

  it('should support control modifier key', () => {
    const callback = mock();
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('⌃A', callback);
    keybinding.trigger({ type: 'keydown', key: 'a', ctrlKey: true });
    assert.lengthOf(callback.mock.calls, 1);
  });

  it('should support shift modifier key', () => {
    const callback = mock();
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('⇧A', callback);
    keybinding.trigger({ type: 'keydown', key: 'a', shiftKey: true });
    assert.lengthOf(callback.mock.calls, 1);
  });

  it('should support multiple modifier keys', () => {
    const callback = mock();
    const keybinding = Rapid.utilKeybinding('test');
    keybinding.on('⌃⇧A', callback);
    keybinding.trigger({ type: 'keydown', key: 'a', ctrlKey: true, shiftKey: true });
    assert.lengthOf(callback.mock.calls, 1);
  });
});
