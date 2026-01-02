import { select } from 'd3-selection';

import type { D3Selection } from '../core/types.ts';
import { type OneOrMore, utilIterable } from './iterable.ts';


/** Keyboard modifier key state */
interface KeyModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** A parsed keybinding event specification */
interface KeybindingEvent {
  /** The key name(s) to match (preferred) */
  key: string | string[] | undefined;
  /** The keyCode to match (fallback for older browsers) */
  keyCode: number;
  /** Modifier key requirements */
  modifiers: KeyModifiers;
}

/** A registered keybinding entry */
interface KeyBinding {
  /** Unique identifier for this binding */
  id: string;
  /** Whether to capture during capturing phase */
  capture: boolean | undefined;
  /** Callback function to invoke when matched */
  callback: KeybindingCallback;
  /** The parsed event specification */
  event: KeybindingEvent;
}

/** Partial keyboard event for testing bindings */
interface KeyEventLike {
  type?: string;
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}

/** Callback function for keybinding events */
export type KeybindingCallback = (evt: KeyEventLike) => void;

/** The keybinding instance returned by utilKeybinding */
export interface Keybinding {
  /** Bind keybinding to a D3 selection (defaults to document) */
  (selection?: D3Selection): Keybinding;
  /** Unbind all keybindings from a D3 selection */
  unbind(selection?: D3Selection): Keybinding;
  /** Clear all registered keybindings */
  clear(): Keybinding;
  /** Manually trigger a keypress event (useful for testing) */
  trigger(event: KeyEventLike): void;
  /** Remove one or more keycode bindings */
  off(codes: OneOrMore<string>, capture?: boolean): Keybinding;
  /** Add one or more keycode bindings */
  on(codes: OneOrMore<string>, callback: KeybindingCallback | null | undefined, capture?: boolean): Keybinding;
}


/**
 * utilKeybinding
 * Creates a keybinding handler for keyboard shortcuts.
 * @param namespace - Unique namespace for event listeners
 * @returns A keybinding instance
 */
export function utilKeybinding(namespace: string): Keybinding {
  let _keybindings: Record<string, KeyBinding> = {};


  /**
   * testBindings
   * Test whether the given event matches any known keybinding.
   * IF so, it calls the bound callback function.
   * @param  evt          - the Event to test
   * @param  isCapturing  - `true` if capturing phase, `false` if bubbling phase
   * @return `true` if something matched, `false` if not
   */
  function testBindings(evt: KeyEventLike, isCapturing: boolean = false): boolean {
    const bindings = [...Object.values(_keybindings)];

    // Most key shortcuts will accept either lower or uppercase ('h' or 'H'),
    // so we don't strictly match on the shift key, but we prioritize
    // shifted keybindings first, and fallback to unshifted only if no match.
    // (This lets us differentiate between '←'/'⇧←' or '⌘Z'/'⌘⇧Z')

    // Match shifted keybindings first...
    for (const binding of bindings) {
      if (!binding.event.modifiers.shiftKey) continue;  // no shift
      if (!!binding.capture !== isCapturing) continue;
      if (testBinding(evt, binding.event, true)) {
        binding.callback(evt);
        return true;  // match a max of one binding per event
      }
    }

    // Then unshifted keybindings...
    for (const binding of bindings) {
      if (binding.event.modifiers.shiftKey) continue;   // shift
      if (!!binding.capture !== isCapturing) continue;
      if (testBinding(evt, binding.event, false)) {
        binding.callback(evt);
        return true;
      }
    }

    return false;
  }


  /**
   * testBinding
   * Test whether the given event matches the given binding.
   * @param  evt        - the Event to test
   * @param  check      - the keybinding to check
   * @param  testShift  - whether to require the Shift key to match
   * @return `true` if a match, `false` if not
   */
  function testBinding(evt: KeyEventLike, check: KeybindingEvent, testShift: boolean): boolean {
    let isMatch = false;
    let tryKey: string | undefined;
    let tryKeyCode: number | undefined;

    // Prefer a match on `KeyboardEvent.key`, if it is a string within ISO-Latin-1
    // Note that `key` might be a string like 'Tab' or 'Esc' or a key like 'A'
    if (typeof evt.key === 'string' && evt.key.length > 0 && evt.key.charCodeAt(0) <= 255) {
      tryKey = evt.key.toLowerCase();
    }
    // Fallback to a match on `KeyboardEvent.keyCode` (older browsers, non-Latin key, Cyrillic?)
    if (typeof evt.keyCode === 'number' && evt.keyCode !== 0) {
      tryKeyCode = evt.keyCode;
    }

    // First, test `key` if possible
    if (tryKey !== undefined && check.key) {
      const arr = Array.isArray(check.key) ? check.key : [check.key];
      isMatch = arr.some(s => s.toLowerCase() === tryKey);
    }
    // Fallback, test `keyCode`, if possible
    if (!isMatch && tryKeyCode !== undefined && check.keyCode) {
      isMatch = (tryKeyCode === check.keyCode);
    }

    if (!isMatch) return false;

    // Test modifier keys
    if (!(evt.ctrlKey && evt.altKey)) {  // if both are set, assume AltGr and skip it - iD#4096
      if (evt.ctrlKey !== check.modifiers.ctrlKey) return false;
      if (evt.altKey !== check.modifiers.altKey) return false;
    }
    if (evt.metaKey !== check.modifiers.metaKey) return false;
    if (testShift && evt.shiftKey !== check.modifiers.shiftKey) return false;

    return true;
  }


  function capture(evt: KeyboardEvent): void {
    testBindings(evt, true);
  }


  function bubble(evt: KeyboardEvent): void {
    const tagName = select(evt.target as Element).node()?.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
      return;
    }
    testBindings(evt, false);
  }


  function keybinding(selection?: D3Selection): Keybinding {
    const sel = selection ?? select(document);
    sel.on('keydown.capture.' + namespace, capture as any, true);
    sel.on('keydown.bubble.' + namespace, bubble as any, false);
    return keybinding;
  }

  // was: keybinding.off()
  keybinding.unbind = function(selection?: D3Selection): Keybinding {
    _keybindings = {};
    const sel = selection ?? select(document);
    sel.on('keydown.capture.' + namespace, null);
    sel.on('keydown.bubble.' + namespace, null);
    return keybinding;
  };


  keybinding.clear = function(): Keybinding {
    _keybindings = {};
    return keybinding;
  };


  // Manually trigger a keypress, useful for testing
  keybinding.trigger = function(event: KeyEventLike): void {
    const evt: KeyEventLike = {
      type: event.type || 'keydown',
      key: event.key,
      keyCode: event.keyCode,
      shiftKey: event.shiftKey || false,
      ctrlKey: event.ctrlKey || false,
      altKey: event.altKey || false,
      metaKey: event.metaKey || false
    };
    testBindings(evt, false);
  };


  // Remove one or more keycode bindings.
  keybinding.off = function(codes: OneOrMore<string>, capture?: boolean): Keybinding {
    for (const code of utilIterable(codes)) {
      const id = code + (capture ? '-capture' : '-bubble');
      delete _keybindings[id];
    }
    return keybinding;
  };


  // Add one or more keycode bindings.
  keybinding.on = function(
    codes: OneOrMore<string>,
    callback: KeybindingCallback | null | undefined,
    capture?: boolean
  ): Keybinding {
    if (typeof callback !== 'function') {
      return keybinding.off(codes, capture);
    }

    for (const code of utilIterable(codes)) {
      const id = code + (capture ? '-capture' : '-bubble');
      const binding: KeyBinding = {
        id: id,
        capture: capture,
        callback: callback,
        event: {
          key: undefined,  // preferred
          keyCode: 0,      // fallback
          modifiers: {
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false
          }
        }
      };

      if (_keybindings[id]) {
        console.warn(`warning: duplicate keybinding for "${id}"`); // eslint-disable-line no-console
      }

      _keybindings[id] = binding;

      const matches = code.toLowerCase().match(/(?:(?:[^+⇧⌃⌥⌘])+|[⇧⌃⌥⌘]|\+\+|^\+$)/g);
      if (matches) {
        for (let j = 0; j < matches.length; j++) {
          // Normalise matching errors
          if (matches[j] === '++') matches[j] = '+';

          if (matches[j] in utilKeybinding.modifierCodes) {
            const modCode = utilKeybinding.modifierCodes[matches[j]];
            const prop = utilKeybinding.modifierProperties[modCode] as keyof KeyModifiers;
            binding.event.modifiers[prop] = true;
          } else {
            binding.event.key = utilKeybinding.keys[matches[j]] || matches[j];
            if (matches[j] in utilKeybinding.keyCodes) {
              binding.event.keyCode = utilKeybinding.keyCodes[matches[j]];
            }
          }
        }
      }
    }

    return keybinding;
  };


  return keybinding;
}


/*
 * See https://github.com/keithamus/jwerty
 * Watch out: The '⌃' symbol U+2303 is not the same as the carat symbol '^' U+005E
 * see https://wincent.com/wiki/Unicode_representations_of_modifier_keys
 */

/** Static properties attached to utilKeybinding */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace utilKeybinding {
  /** Map modifier key symbols/names to keycodes */
  export const modifierCodes: Record<string, number> = {
    // Shift key, ⇧
    '⇧': 16, shift: 16,
    // Control key, ⌃
    '⌃': 17, ctrl: 17,
    // Alt key, on Mac: '⌥ Option'
    '⌥': 18, alt: 18, option: 18,
    // Meta key, on Mac: '⌘ Command', on Windows 'Win', on Linux 'Super'
    '⌘': 91, meta: 91, cmd: 91, 'super': 91, win: 91
  };

  /** Map modifier keycodes to property names */
  export const modifierProperties: Record<number, string> = {
    16: 'shiftKey',
    17: 'ctrlKey',
    18: 'altKey',
    91: 'metaKey'
  };

  /** Keys that represent "plus" */
  export const plusKeys: string[] = ['+', 'ffplus', '=', 'ffequals', '≠', '±'];

  /** Keys that represent "minus" */
  export const minusKeys: string[] = ['_', '-', 'ffminus', 'dash', '–', '—'];

  /** Map key symbols/names to KeyboardEvent.key values */
  export const keys: Record<string, string | string[]> = {
  '↩': 'Enter', '↵': 'Enter', '⏎': 'Enter', 'return': 'Enter', enter: 'Enter', '⌅': 'Enter',
  // Pause/Break key
  'pause': 'Pause', 'pause-break': 'Pause',
  // Caps Lock key, ⇪
  '⇪': 'CapsLock', caps: 'CapsLock', 'caps-lock': 'CapsLock',
  // Escape key, on Mac: ⎋, on Windows: Esc
  '⎋': ['Escape', 'Esc'], escape: ['Escape', 'Esc'], esc: ['Escape', 'Esc'],
  // Space key
  space: [' ', 'Spacebar'],
  // Page-Up key, or pgup, on Mac: ↖
  '↖': 'PageUp', pgup: 'PageUp', 'page-up': 'PageUp',
  // Page-Down key, or pgdown, on Mac: ↘
  '↘': 'PageDown', pgdown: 'PageDown', 'page-down': 'PageDown',
  // END key, on Mac: ⇟
  '⇟': 'End', end: 'End',
  // HOME key, on Mac: ⇞
  '⇞': 'Home', home: 'Home',
  // Insert key, or ins
  ins: 'Insert', insert: 'Insert',
  // Delete key, on Mac: ⌦ (Delete)
  '⌦': ['Delete', 'Del'], del: ['Delete', 'Del'], 'delete': ['Delete', 'Del'],
  // Left Arrow Key, or ←
  '←': ['ArrowLeft', 'Left'], left: ['ArrowLeft', 'Left'], 'arrow-left': ['ArrowLeft', 'Left'],
  // Up Arrow Key, or ↑
  '↑': ['ArrowUp', 'Up'], up: ['ArrowUp', 'Up'], 'arrow-up': ['ArrowUp', 'Up'],
  // Right Arrow Key, or →
  '→': ['ArrowRight', 'Right'], right: ['ArrowRight', 'Right'], 'arrow-right': ['ArrowRight', 'Right'],
  // Up Arrow Key, or ↓
  '↓': ['ArrowDown', 'Down'], down: ['ArrowDown', 'Down'], 'arrow-down': ['ArrowDown', 'Down'],
  // odities, stuff for backward compatibility (browsers and code):
  // Num-Multiply, or *
  '*': ['*', 'Multiply'], star: ['*', 'Multiply'], asterisk: ['*', 'Multiply'], multiply: ['*', 'Multiply'],
  // Num-Plus or +
  '+': ['+', 'Add'], 'plus': ['+', 'Add'],
  // Num-Subtract, or -
  '-': ['-', 'Subtract'], subtract: ['-', 'Subtract'], 'dash': ['-', 'Subtract'],
  // Semicolon
  semicolon: ';',
  // = or equals
  equals: '=',
  // Comma, or ,
  comma: ',',
  // Period, or ., or full-stop
  period: '.', 'full-stop': '.',
  // Slash, or /, or forward-slash
  slash: '/', 'forward-slash': '/',
  // Tick, or `, or back-quote
  tick: '`', 'back-quote': '`',
  // Open bracket, or [
  'open-bracket': '[',
  // Back slash, or \
  'back-slash': '\\',
  // Close backet, or ]
  'close-bracket': ']',
  // Apostrophe, or Quote, or '
  quote: '\'', apostrophe: '\'',
  // NUMPAD 0-9
  'num-0': '0',
  'num-1': '1',
  'num-2': '2',
  'num-3': '3',
  'num-4': '4',
  'num-5': '5',
  'num-6': '6',
  'num-7': '7',
  'num-8': '8',
  'num-9': '9',
  // F1-F25
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  f13: 'F13',
  f14: 'F14',
  f15: 'F15',
  f16: 'F16',
  f17: 'F17',
  f18: 'F18',
  f19: 'F19',
  f20: 'F20',
  f21: 'F21',
  f22: 'F22',
  f23: 'F23',
  f24: 'F24',
  f25: 'F25'
  };

  /** Map key symbols/names to keycodes (fallback for older browsers) */
  export const keyCodes: Record<string | number, number> = {
    // Backspace key, on Mac: ⌫ (Backspace)
    '⌫': 8, backspace: 8,
    // Tab Key, on Mac: ⇥ (Tab), on Windows ⇥⇥
    '⇥': 9, '⇆': 9, tab: 9,
    // Return key, ↩
    '↩': 13, '↵': 13, '⏎': 13, 'return': 13, enter: 13, '⌅': 13,
    // Pause/Break key
    'pause': 19, 'pause-break': 19,
    // Caps Lock key, ⇪
    '⇪': 20, caps: 20, 'caps-lock': 20,
    // Escape key, on Mac: ⎋, on Windows: Esc
    '⎋': 27, escape: 27, esc: 27,
    // Space key
    space: 32,
    // Page-Up key, or pgup, on Mac: ↖
    '↖': 33, pgup: 33, 'page-up': 33,
    // Page-Down key, or pgdown, on Mac: ↘
    '↘': 34, pgdown: 34, 'page-down': 34,
    // END key, on Mac: ⇟
    '⇟': 35, end: 35,
    // HOME key, on Mac: ⇞
    '⇞': 36, home: 36,
    // Insert key, or ins
    ins: 45, insert: 45,
    // Delete key, on Mac: ⌦ (Delete)
    '⌦': 46, del: 46, 'delete': 46,
    // Left Arrow Key, or ←
    '←': 37, left: 37, 'arrow-left': 37,
    // Up Arrow Key, or ↑
    '↑': 38, up: 38, 'arrow-up': 38,
    // Right Arrow Key, or →
    '→': 39, right: 39, 'arrow-right': 39,
    // Up Arrow Key, or ↓
    '↓': 40, down: 40, 'arrow-down': 40,
    // odities, printing characters that come out wrong:
    // Firefox Equals
    'ffequals': 61,
    // Num-Multiply, or *
    '*': 106, star: 106, asterisk: 106, multiply: 106,
    // Num-Plus or +
    '+': 107, 'plus': 107,
    // Num-Subtract, or -
    '-': 109, subtract: 109,
    // Vertical Bar / Pipe
    '|': 124,
    // Firefox Plus
    'ffplus': 171,
    // Firefox Minus
    'ffminus': 173,
    // Semicolon
    ';': 186, semicolon: 186,
    // = or equals
    '=': 187, 'equals': 187,
    // Comma, or ,
    ',': 188, comma: 188,
    // Dash / Underscore key
    'dash': 189,
    // Period, or ., or full-stop
    '.': 190, period: 190, 'full-stop': 190,
    // Slash, or /, or forward-slash
    '/': 191, slash: 191, 'forward-slash': 191,
    // Tick, or `, or back-quote
    '`': 192, tick: 192, 'back-quote': 192,
    // Open bracket, or [
    '[': 219, 'open-bracket': 219,
    // Back slash, or \
    '\\': 220, 'back-slash': 220,
    // Close backet, or ]
    ']': 221, 'close-bracket': 221,
    // Apostrophe, or Quote, or '
    '\'': 222, quote: 222, apostrophe: 222
  };

  // NUMPAD 0-9
  let i = 95;
  let n = 0;
  while (++i < 106) {
    keyCodes['num-' + n] = i;
    ++n;
  }

  // 0-9
  i = 47;
  n = 0;
  while (++i < 58) {
    keyCodes[n] = i;
    ++n;
  }

  // F1-F25
  i = 111;
  n = 1;
  while (++i < 136) {
    keyCodes['f' + n] = i;
    ++n;
  }

  // a-z
  i = 64;
  while (++i < 91) {
    keyCodes[String.fromCharCode(i).toLowerCase()] = i;
  }
}
