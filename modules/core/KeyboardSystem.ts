import { select } from 'd3-selection';

import { AbstractSystem } from './AbstractSystem.ts';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { Context } from '../Context.ts';


/** Keyboard modifier key state */
interface KeyModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** A parsed keybinding event specification */
interface KeyMatch {
  /** The `KeyboardEvent.key` value(s) to match (case-insensitive) */
  key: string | string[] | undefined;
  /** Modifier key requirements */
  modifiers: KeyModifiers;
}

/** A registered keybinding entry */
interface KeyBinding {
  /** Unique identifier for this binding, within its scope */
  id: string;
  /** The combo string this binding was registered with (e.g. `'⌘Z'`) */
  combo: string;
  /** Whether to match during the capturing phase */
  capture: boolean;
  /** Callback function to invoke when matched */
  callback: KeybindingCallback;
  /** The parameters to test against an event */
  test: KeyMatch;
  /** Optional remappable command this binding belongs to */
  commandID?: CommandID;
}

/** Options for registering a keybinding */
export interface KeyBindingOpts {
  /** Match during the capturing phase (default `false` = bubbling) */
  capture?: boolean;
  /** Associate this binding with a remappable command (scaffolding for user remapping) */
  commandID?: CommandID;
}

/** A remappable command — a stable identity whose combo can be changed and persisted */
export interface KeyCommand {
  /** Stable identifier for the command (e.g. `'zoom-in'`) */
  commandID: CommandID;
  /** The scope the command's binding lives in */
  scopeID: string;
  /** The combo(s) the command was originally registered with */
  defaultCombos: string[];
  /** The combo(s) the command is currently bound to */
  currentCombos: string[];
  /** The callback invoked when the command fires */
  callback: KeybindingCallback;
  /** Whether the command's binding matches during the capturing phase */
  capture: boolean;
}

/** Partial keyboard event for testing bindings (used by `trigger`) */
export interface KeyEventLike {
  type?: string;
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}

/** Callback function for keybinding events */
export type KeybindingCallback = (evt: KeyboardEvent) => void;


/**
 * A `KeyBindingScope` is a named group of keybindings that can be enabled or disabled together.
 * The `KeyboardSystem` owns the document listeners; a scope just decides *which* bindings are live.
 * This neatly models "these keys are only active while the user is in a certain editing mode":
 * create a scope on enter, `enable()` it, and `disable()` (or remove) it on exit.
 */
export class KeyBindingScope {
  /** Identifier for this scope (e.g. `'global'`, `'select'`, `'modal'`) */
  public readonly id: string;
  /** Whether this scope's bindings currently participate in matching */
  public enabled: boolean;
  /** The bindings registered in this scope, keyed by binding id */
  public readonly bindings: Map<string, KeyBinding>;

  protected _system: KeyboardSystem;

  /**
   * @param system  - The owning `KeyboardSystem`
   * @param id      - Identifier for this scope
   * @param enabled - Whether the scope starts enabled
   */
  public constructor(system: KeyboardSystem, id: string, enabled: boolean) {
    this._system = system;
    this.id = id;
    this.enabled = enabled;
    this.bindings = new Map();
  }

  /**
   * Add one or more keybindings to this scope.
   * Passing a `null`/`undefined` callback removes the binding(s) instead.
   * @param codes    - One or more combo strings (e.g. `'⌘Z'`, `['[', 'pgup']`)
   * @param callback - The function to call when a combo matches
   * @param opts     - Options (`capture`, `commandID`)
   * @return `this` for chaining
   */
  public on(codes: OneOrMore<string>, callback: Nullable<KeybindingCallback>, opts: KeyBindingOpts = {}): this {
    if (typeof callback !== 'function') {
      return this.off(codes, opts);
    }

    const capture = opts.capture ?? false;
    const combos: string[] = [];

    for (const code of utilIterable(codes)) {
      const id = code + (capture ? '-capture' : '-bubble');

      if (this.bindings.has(id)) {
        console.warn(`warning: duplicate keybinding for "${id}"`);  // eslint-disable-line no-console
      }

      this.bindings.set(id, {
        id: id,
        combo: code,
        capture: capture,
        callback: callback,
        test: _parseCombo(code),
        commandID: opts.commandID
      });
      combos.push(code);
    }

    if (opts.commandID) {
      this._system._registerCommand(opts.commandID, this.id, combos, callback, capture);
    }

    return this;
  }

  /**
   * Remove one or more keybindings from this scope.
   * @param codes - One or more combo strings to remove
   * @param opts  - Options (`capture` must match how the binding was registered)
   * @return `this` for chaining
   */
  public off(codes: OneOrMore<string>, opts: KeyBindingOpts = {}): this {
    const capture = opts.capture ?? false;
    for (const code of utilIterable(codes)) {
      const id = code + (capture ? '-capture' : '-bubble');
      this.bindings.delete(id);
    }
    return this;
  }

  /**
   * Remove all keybindings from this scope.
   * @return `this` for chaining
   */
  public clear(): this {
    this.bindings.clear();
    return this;
  }

  /**
   * Enable this scope so its bindings participate in matching.
   * @return `this` for chaining
   */
  public enable(): this {
    this.enabled = true;
    return this;
  }

  /**
   * Disable this scope so its bindings are ignored (but not forgotten).
   * @return `this` for chaining
   */
  public disable(): this {
    this.enabled = false;
    return this;
  }
}


/**
 * The `KeyboardSystem` manages Rapid's keyboard shortcuts.
 *
 * It installs a single pair of `keydown` listeners (capture + bubble) on the document and
 * dispatches events to a set of {@link KeyBindingScope}s. A built-in `global` scope backs the
 * system's own `on`/`off`/`clear` methods; components that need isolated, toggleable bindings
 * (modes, modals) create their own scope with `scope(id)`.
 *
 * Combos are written in MacOS style (e.g. `'⌘Z'`, `'⇧←'`) — see {@link utilCmd} for converting to
 * the current platform. Matching is driven entirely by `KeyboardEvent.key` (case-insensitive).
 *
 * Events available:
 * - `bindingschange` - Fires when a command is rebound via `rebind()`
 */
export class KeyboardSystem extends AbstractSystem {

  /** All scopes, keyed by scope id.  Always contains the `global` scope. */
  protected _scopes: Map<string, KeyBindingScope>;
  /** The built-in scope backing the system's own `on`/`off`/`clear` */
  protected _global: KeyBindingScope;
  /** Remappable commands, keyed by commandID (scaffolding for user remapping) */
  protected _commands: Map<CommandID, KeyCommand>;
  /** Whether the document listeners are currently installed */
  protected _listening: boolean;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'keyboard';
    this.requiredDependencies = new Set<SystemID>();
    this.optionalDependencies = new Set<SystemID>(['settings']);

    this._scopes = new Map();
    this._commands = new Map();
    this._listening = false;

    this._global = new KeyBindingScope(this, 'global', true);
    this._scopes.set('global', this._global);

    // Ensure methods used as event listeners always have `this` bound correctly.
    this._keydownCapture = this._keydownCapture.bind(this);
    this._keydownBubble = this._keydownBubble.bind(this);
  }


  /**
   * Called after all core objects have been initialized.
   * Installs the document `keydown` listeners.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    this._listen();
    this._started = true;
    return this._startPromise = Promise.resolve();
  }


  /**
   * The built-in `global` keybinding scope — the default home for application-wide shortcuts.
   * Register global shortcuts with `keyboard.global.on(codes, callback)`.
   *
   * (Registration lives on the scope rather than the system because the system is an
   * `EventEmitter`, whose `on`/`off` are reserved for event subscription like `bindingschange`.)
   * @readonly
   */
  public get global(): KeyBindingScope {
    return this._global;
  }

  /**
   * Get (or lazily create) a named scope.
   * Newly-created scopes start **disabled** — call `enable()` when the bindings should go live.
   * @param id - Identifier for the scope
   * @return The `KeyBindingScope`
   */
  public scope(id: string): KeyBindingScope {
    let scope = this._scopes.get(id);
    if (!scope) {
      scope = new KeyBindingScope(this, id, false);
      this._scopes.set(id, scope);
    }
    return scope;
  }

  /**
   * Remove a named scope entirely, discarding its bindings.
   * The built-in `global` scope cannot be removed.
   * @param id - Identifier for the scope to remove
   */
  public removeScope(id: string): void {
    if (id === 'global') return;
    this._scopes.delete(id);
  }


  /**
   * The set of combo tokens that should be treated as "plus" (zoom in).
   * @readonly
   */
  public get plusKeys(): string[] {
    return PLUS_KEYS;
  }

  /**
   * The set of combo tokens that should be treated as "minus" (zoom out).
   * @readonly
   */
  public get minusKeys(): string[] {
    return MINUS_KEYS;
  }


  /**
   * Look up a remappable command by id.
   * @param commandID - The command identifier
   * @return The `KeyCommand`, or `undefined` if not registered
   */
  public getCommand(commandID: CommandID): KeyCommand | undefined {
    return this._commands.get(commandID);
  }

  /**
   * All currently-registered remappable commands.
   * @readonly
   */
  public get commands(): KeyCommand[] {
    return [...this._commands.values()];
  }

  /**
   * Change the combo a command is bound to.
   * This is the seam a future remapping UI (and persistence) will call.
   * @param commandID - The command to rebind
   * @param combo     - The new combo string (e.g. `'⌘J'`)
   * @return `true` if the command existed and was rebound
   */
  public rebind(commandID: CommandID, combo: string): boolean {
    const command = this._commands.get(commandID);
    if (!command) return false;

    const scope = this._scopes.get(command.scopeID);
    if (!scope) return false;

    const opts: KeyBindingOpts = { capture: command.capture };
    scope.off(command.currentCombos, opts);
    command.currentCombos = [combo];
    scope.on(combo, command.callback, { ...opts, commandID });   // `on` refreshes the command entry

    this.emit('bindingschange');
    return true;
  }

  /**
   * Register (or refresh) a remappable command.  Called by `KeyBindingScope.on` when a binding
   * is registered with a `commandID`.
   * @param commandID - The command identifier
   * @param scopeID   - The scope the binding lives in
   * @param combos    - The combo(s) the binding was registered with
   * @param callback  - The callback invoked when the command fires
   * @param capture   - Whether the binding matches during the capturing phase
   */
  public _registerCommand(
    commandID: CommandID, scopeID: string, combos: string[], callback: KeybindingCallback, capture: boolean
  ): void {
    const existing = this._commands.get(commandID);
    this._commands.set(commandID, {
      commandID: commandID,
      scopeID: scopeID,
      defaultCombos: existing?.defaultCombos ?? combos,
      currentCombos: combos,
      callback: callback,
      capture: capture
    });
  }


  /**
   * Manually trigger a keypress, useful for testing.
   * @param  event - A partial keyboard event describing the keypress
   * @return `true` if a binding matched
   */
  public trigger(event: KeyEventLike): boolean {
    return this._testBindings(_makeKeyboardEvent(event), false);
  }


  /**
   * Install the document `keydown` listeners (capture + bubble).
   * No-op when there is no `document` (e.g. headless/CLI) or when already listening.
   */
  protected _listen(): void {
    if (this._listening) return;

    // No-op without a functional DOM (headless/CLI, or a partial `document` under some test runtimes)
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    const $document = select(document);
    $document.on('keydown.keyboard-capture', this._keydownCapture, true);
    $document.on('keydown.keyboard-bubble', this._keydownBubble, false);
    this._listening = true;
  }


  /**
   * Capture-phase `keydown` handler — tests capture bindings.
   * @param evt - The keyboard event
   */
  protected _keydownCapture(evt: KeyboardEvent): void {
    this._testBindings(evt, true);
  }


  /**
   * Bubble-phase `keydown` handler — tests bubble bindings, ignoring events from form fields.
   * @param evt - The keyboard event
   */
  protected _keydownBubble(evt: KeyboardEvent): void {
    const tagName = (evt.target as Element | null)?.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') return;
    this._testBindings(evt, false);
  }


  /**
   * Test the given event against every binding in every enabled scope.
   * If one matches, its callback is invoked (at most one binding fires per event).
   * @param  evt         - The event to test
   * @param  isCapturing - `true` for the capturing phase, `false` for bubbling
   * @return `true` if something matched
   */
  protected _testBindings(evt: KeyboardEvent, isCapturing: boolean): boolean {
    // Gather all bindings from enabled scopes.
    const bindings: KeyBinding[] = [];
    for (const scope of this._scopes.values()) {
      if (!scope.enabled) continue;
      for (const binding of scope.bindings.values()) {
        if (binding.capture !== isCapturing) continue;
        bindings.push(binding);
      }
    }

    // Most key shortcuts will accept either lower or uppercase ('h' or 'H'),
    // so we don't strictly match on the shift key, but we prioritize
    // shifted keybindings first, and fallback to unshifted only if no match.
    // (This lets us differentiate between '←'/'⇧←' or '⌘Z'/'⌘⇧Z')

    // Match shifted keybindings first...
    for (const binding of bindings) {
      if (!binding.test.modifiers.shiftKey) continue;   // no shift
      if (_testBinding(evt, binding.test, true)) {
        binding.callback(evt);
        return true;   // match a max of one binding per event
      }
    }

    // Then unshifted keybindings...
    for (const binding of bindings) {
      if (binding.test.modifiers.shiftKey) continue;    // shift
      if (_testBinding(evt, binding.test, false)) {
        binding.callback(evt);
        return true;
      }
    }

    return false;
  }
}


/**
 * Parse a combo string (e.g. `'⌘⇧Z'`, `'pgup'`) into a testable `KeyMatch`.
 * @param  code - The combo string
 * @return The parsed match specification
 */
function _parseCombo(code: string): KeyMatch {
  const test: KeyMatch = {
    key: undefined,
    modifiers: { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }
  };

  const matches = code.toLowerCase().match(/(?:(?:[^+⇧⌃⌥⌘])+|[⇧⌃⌥⌘]|\+\+|^\+$)/g);
  if (matches) {
    for (let token of matches) {
      if (token === '++') token = '+';   // normalise matching errors

      const prop = MODIFIER_MAP[token];
      if (prop) {
        test.modifiers[prop] = true;
      } else {
        test.key = KEYS[token] ?? token;
      }
    }
  }

  return test;
}


/**
 * Test whether the given event matches the given binding.
 * @param  evt       - The event to test
 * @param  check     - The keybinding to check against
 * @param  testShift - Whether to require the Shift key state to match
 * @return `true` if a match
 */
function _testBinding(evt: KeyboardEvent, check: KeyMatch, testShift: boolean): boolean {
  // Match on `KeyboardEvent.key` (case-insensitive).
  // Note that `key` might be a string like 'Tab' or 'Escape' or a printable key like 'A'.
  // (`event.code` would be the path to physical-key / layout-independent matching, if ever needed.)
  if (typeof evt.key !== 'string' || evt.key.length === 0) return false;
  if (!check.key) return false;

  const tryKey = evt.key.toLowerCase();
  const keys = Array.isArray(check.key) ? check.key : [check.key];
  if (!keys.some(s => s.toLowerCase() === tryKey)) return false;

  // Test modifier keys
  if (!(evt.ctrlKey && evt.altKey)) {   // if both are set, assume AltGr and skip it - iD#4096
    if (evt.ctrlKey !== check.modifiers.ctrlKey) return false;
    if (evt.altKey !== check.modifiers.altKey) return false;
  }
  if (evt.metaKey !== check.modifiers.metaKey) return false;
  if (testShift && evt.shiftKey !== check.modifiers.shiftKey) return false;

  return true;
}


/**
 * Build a `KeyboardEvent` (or a plain lookalike, in environments without `KeyboardEvent`)
 * from a partial event description.  Used by `trigger` for testing.
 * @param  event - The partial event description
 * @return A `KeyboardEvent`-shaped object
 */
function _makeKeyboardEvent(event: KeyEventLike): KeyboardEvent {
  const type = event.type ?? 'keydown';
  const key = event.key ?? '';
  const modifiers = {
    shiftKey: event.shiftKey ?? false,
    ctrlKey: event.ctrlKey ?? false,
    altKey: event.altKey ?? false,
    metaKey: event.metaKey ?? false
  };

  if (typeof KeyboardEvent === 'function') {
    return new KeyboardEvent(type, { key, ...modifiers });
  }

  // Fallback for environments without KeyboardEvent (e.g. unit tests without a DOM)
  return { type, key, ...modifiers } as KeyboardEvent;
}


/*
 * See https://github.com/keithamus/jwerty
 * Watch out: The '⌃' symbol U+2303 is not the same as the carat symbol '^' U+005E
 * see https://wincent.com/wiki/Unicode_representations_of_modifier_keys
 */

/** Map modifier key symbols/names directly to their `KeyModifiers` property */
const MODIFIER_MAP: Record<string, keyof KeyModifiers> = {
  // Shift key, ⇧
  '⇧': 'shiftKey', shift: 'shiftKey',
  // Control key, ⌃
  '⌃': 'ctrlKey', ctrl: 'ctrlKey',
  // Alt key, on Mac: '⌥ Option'
  '⌥': 'altKey', alt: 'altKey', option: 'altKey',
  // Meta key, on Mac: '⌘ Command', on Windows 'Win', on Linux 'Super'
  '⌘': 'metaKey', meta: 'metaKey', cmd: 'metaKey', 'super': 'metaKey', win: 'metaKey'
};

/** Combo tokens that represent "plus" (used for zoom-in shortcuts) */
const PLUS_KEYS: string[] = ['+', 'ffplus', '=', 'ffequals', '≠', '±'];

/** Combo tokens that represent "minus" (used for zoom-out shortcuts) */
const MINUS_KEYS: string[] = ['_', '-', 'ffminus', 'dash', '–', '—'];

/** Map combo tokens (symbols/names) to `KeyboardEvent.key` value(s) */
const KEYS: Record<string, string | string[]> = {
  '↩': 'Enter', '↵': 'Enter', '⏎': 'Enter', 'return': 'Enter', enter: 'Enter', '⌅': 'Enter',
  // Pause/Break key
  'pause': 'Pause', 'pause-break': 'Pause',
  // Caps Lock key, ⇪
  '⇪': 'CapsLock', caps: 'CapsLock', 'caps-lock': 'CapsLock',
  // Escape key, on Mac: ⎋, on Windows: Esc
  '⎋': ['Escape', 'Esc'], escape: ['Escape', 'Esc'], esc: ['Escape', 'Esc'],
  // Backspace key, on Mac: ⌫
  '⌫': ['Backspace', 'Delete'], backspace: ['Backspace', 'Delete'],
  // Tab key, on Mac: ⇥
  '⇥': 'Tab', '⇆': 'Tab', tab: 'Tab',
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
  // Down Arrow Key, or ↓
  '↓': ['ArrowDown', 'Down'], down: ['ArrowDown', 'Down'], 'arrow-down': ['ArrowDown', 'Down'],
  // oddities, stuff for backward compatibility (browsers and code):
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
  // Close bracket, or ]
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
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5',
  f6: 'F6', f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10',
  f11: 'F11', f12: 'F12', f13: 'F13', f14: 'F14', f15: 'F15',
  f16: 'F16', f17: 'F17', f18: 'F18', f19: 'F19', f20: 'F20',
  f21: 'F21', f22: 'F22', f23: 'F23', f24: 'F24', f25: 'F25'
};
