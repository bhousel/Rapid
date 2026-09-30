import { describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('KeyboardSystem', () => {

  function makeKeyboard() {
    const context = new Rapid.MockContext();
    return new Rapid.KeyboardSystem(context);
  }


  describe('lifecycle', () => {
    it('constructs a KeyboardSystem from a context', () => {
      const context = new Rapid.MockContext();
      const keyboard = new Rapid.KeyboardSystem(context);
      assert.instanceOf(keyboard, Rapid.KeyboardSystem);
      assert.strictEqual(keyboard.id, 'keyboard');
      assert.strictEqual(keyboard.context, context);
      assert.instanceOf(keyboard.requiredDependencies, Set);
      assert.instanceOf(keyboard.optionalDependencies, Set);
    });

    it('provides a built-in enabled `global` scope', () => {
      const keyboard = makeKeyboard();
      assert.strictEqual(keyboard.global.id, 'global');
      assert.isTrue(keyboard.global.enabled);
    });

    it('startAsync resolves', () => {
      const keyboard = makeKeyboard();
      return keyboard.startAsync()
        .then(() => assert.isTrue(keyboard.started));
    });
  });


  describe('binding + matching', () => {
    it('triggers the callback when a key is pressed', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback);
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 1);
    });

    it('does not trigger the callback for a different key', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('B', callback);
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('removes a binding via off()', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback);
      keyboard.global.off('A');
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('removes a binding when on() is passed a null callback', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback);
      keyboard.global.on('A', null);
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('the last binding for the same key overrides earlier ones', () => {
      const orig = console.warn;
      console.warn = () => {};   // temporarily silence the duplicate warning
      try {
        const callback1 = mock();
        const callback2 = mock();
        const keyboard = makeKeyboard();
        keyboard.global.on('A', callback1);
        keyboard.global.on('A', callback2);
        keyboard.trigger({ type: 'keydown', key: 'a' });
        assert.lengthOf(callback1.mock.calls, 0);
        assert.lengthOf(callback2.mock.calls, 1);
      } finally {
        console.warn = orig;
      }
    });

    it('triggers only one binding per event', () => {
      const cb1 = mock();
      const cb2 = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', cb1);
      keyboard.global.on('B', cb2);
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(cb1.mock.calls, 1);
      assert.lengthOf(cb2.mock.calls, 0);
    });

    it('resolves named keys (e.g. `esc` -> `Escape`)', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('esc', callback);
      keyboard.trigger({ type: 'keydown', key: 'Escape' });
      assert.lengthOf(callback.mock.calls, 1);
    });
  });


  describe('modifier keys', () => {
    it('supports the control modifier', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('⌃A', callback);
      keyboard.trigger({ type: 'keydown', key: 'a', ctrlKey: true });
      assert.lengthOf(callback.mock.calls, 1);
    });

    it('supports the shift modifier', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('⇧A', callback);
      keyboard.trigger({ type: 'keydown', key: 'a', shiftKey: true });
      assert.lengthOf(callback.mock.calls, 1);
    });

    it('supports multiple modifiers', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('⌃⇧A', callback);
      keyboard.trigger({ type: 'keydown', key: 'a', ctrlKey: true, shiftKey: true });
      assert.lengthOf(callback.mock.calls, 1);
    });

    it('prioritizes a shifted binding over an unshifted one', () => {
      const shifted = mock();
      const unshifted = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('←', unshifted);
      keyboard.global.on('⇧←', shifted);
      keyboard.trigger({ type: 'keydown', key: 'ArrowLeft', shiftKey: true });
      assert.lengthOf(shifted.mock.calls, 1);
      assert.lengthOf(unshifted.mock.calls, 0);
    });

    it('does not require shift when the binding is unshifted', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback);
      keyboard.trigger({ type: 'keydown', key: 'A', shiftKey: true });
      assert.lengthOf(callback.mock.calls, 1);
    });
  });


  describe('scopes', () => {
    it('named scopes start disabled', () => {
      const keyboard = makeKeyboard();
      const scope = keyboard.scope('mode');
      assert.strictEqual(scope.id, 'mode');
      assert.isFalse(scope.enabled);
    });

    it('scope() returns the same scope for the same id', () => {
      const keyboard = makeKeyboard();
      assert.strictEqual(keyboard.scope('mode'), keyboard.scope('mode'));
    });

    it('a disabled scope does not match', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.scope('mode').on('A', callback);   // not enabled
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('an enabled scope matches', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.scope('mode').on('A', callback).enable();
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 1);
    });

    it('disable() stops a scope from matching', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      const scope = keyboard.scope('mode').on('A', callback).enable();
      scope.disable();
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('removeScope() discards a scope entirely', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.scope('mode').on('A', callback).enable();
      keyboard.removeScope('mode');
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('removeScope() cannot remove the global scope', () => {
      const keyboard = makeKeyboard();
      const global = keyboard.global;
      keyboard.removeScope('global');
      assert.strictEqual(keyboard.global, global);
    });

    it('fires at most one binding per event across scopes', () => {
      const globalCb = mock();
      const scopeCb = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', globalCb);
      keyboard.scope('mode').on('A', scopeCb).enable();
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.strictEqual(globalCb.mock.calls.length + scopeCb.mock.calls.length, 1);
    });
  });


  describe('capture vs bubble', () => {
    it('a capture binding is not matched during a bubble trigger', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback, { capture: true });
      keyboard.trigger({ type: 'keydown', key: 'a' });   // trigger() runs the bubble phase
      assert.lengthOf(callback.mock.calls, 0);
    });

    it('a bubble binding matches during a bubble trigger', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('A', callback, { capture: false });
      keyboard.trigger({ type: 'keydown', key: 'a' });
      assert.lengthOf(callback.mock.calls, 1);
    });
  });


  describe('remappable commands (phase 1)', () => {
    it('registers a command when a binding declares a commandID', () => {
      const keyboard = makeKeyboard();
      keyboard.global.on('⌘J', mock(), { commandID: 'do-thing' });
      const command = keyboard.getCommand('do-thing');
      assert.isOk(command);
      assert.strictEqual(command.commandID, 'do-thing');
      assert.deepStrictEqual(command.defaultCombos, ['⌘J']);
      assert.deepStrictEqual(command.currentCombos, ['⌘J']);
    });

    it('rebind() changes the matched combo and preserves the default', () => {
      const callback = mock();
      const keyboard = makeKeyboard();
      keyboard.global.on('⌘J', callback, { commandID: 'do-thing' });

      const ok = keyboard.rebind('do-thing', '⌘K');
      assert.isTrue(ok);

      // old combo no longer fires
      keyboard.trigger({ type: 'keydown', key: 'j', metaKey: true });
      assert.lengthOf(callback.mock.calls, 0);

      // new combo fires
      keyboard.trigger({ type: 'keydown', key: 'k', metaKey: true });
      assert.lengthOf(callback.mock.calls, 1);

      const command = keyboard.getCommand('do-thing');
      assert.deepStrictEqual(command.defaultCombos, ['⌘J']);
      assert.deepStrictEqual(command.currentCombos, ['⌘K']);
    });

    it('rebind() emits a `bindingschange` event', () => {
      const listener = mock();
      const keyboard = makeKeyboard();
      keyboard.on('bindingschange', listener);
      keyboard.global.on('⌘J', mock(), { commandID: 'do-thing' });
      keyboard.rebind('do-thing', '⌘K');
      assert.lengthOf(listener.mock.calls, 1);
    });

    it('rebind() returns false for an unknown command', () => {
      const keyboard = makeKeyboard();
      assert.isFalse(keyboard.rebind('nope', '⌘K'));
    });
  });
});
