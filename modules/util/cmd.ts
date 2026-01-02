import { utilDetect } from './detect.ts';
import type { Context } from '../core/types.ts';


/** A key combo symbol like '⌘', '⇧', '⌥', '⌃' */
type KeySymbol = string;

/** Minimal interface for the localization system's translate method */
interface L10nSystem {
  t(stringID: string, replacements?: Record<string, string>, locale?: string): string;
}

/** Interface for the utilCmd function with its display method */
interface UtilCmdFunction {
  /**
   * Convert a key combo from MacOS style to the current platform.
   * On MacOS, no change. On Windows/Linux, converts Command to Control (e.g. ⌘Z -> ⌃Z).
   * @param combo - The key combo in MacOS style
   * @returns The key combo converted for the current platform
   */
  (combo: string): string;

  /**
   * Return a display-focused string for a given key character.
   * On Mac, includes the symbol and word. On other systems, only the word.
   * @param context - The application context for localization
   * @param char - A single key character symbol
   * @returns The display string for the key
   */
  display: (context: Context, char: KeySymbol) => string;
}

/**
 * Throughout Rapid we specify key combos in MacOS style.
 * This helper converts a key combo to the key combo for the system the user is on:
 * - on MacOS, no change
 * - on Windows/Linux, convert Command to Control, for example, ⌘Z -> ⌃Z
 *
 * Watch out: The '⌃' symbol U+2303 is not the same as the carat symbol '^' U+005E
 * @see https://wincent.com/wiki/Unicode_representations_of_modifier_keys
 */
export const utilCmd: UtilCmdFunction = Object.assign(
  function(combo: string): string {
    const detected = utilDetect();

    if (detected.os === 'mac') {
      return combo;
    }

    if (detected.os === 'win') {
      if (combo === '⌘⇧Z') return '⌃Y';  // special handling for Redo on Windows
    }

    return combo.replace('⌘', '⌃');
  },
  {
    display(context: Context, char: KeySymbol): string {
      if (char.length !== 1) return char;  // Ignore if multiple chars, like "F11"

      const l10n = context.systems.l10n as unknown as L10nSystem;
      const detected = utilDetect();
      const mac = (detected.os === 'mac');
      const replacements: Record<KeySymbol, string> = {
        '⌘': mac ? '⌘ ' + l10n.t('shortcuts.key.cmd')    : l10n.t('shortcuts.key.ctrl'),
        '⇧': mac ? '⇧ ' + l10n.t('shortcuts.key.shift')  : l10n.t('shortcuts.key.shift'),
        '⌥': mac ? '⌥ ' + l10n.t('shortcuts.key.option') : l10n.t('shortcuts.key.alt'),
        '⌃': mac ? '⌃ ' + l10n.t('shortcuts.key.ctrl')   : l10n.t('shortcuts.key.ctrl'),
        '⌫': mac ? '⌫ ' + l10n.t('shortcuts.key.delete') : l10n.t('shortcuts.key.backspace'),
        '⌦': mac ? '⌦ ' + l10n.t('shortcuts.key.del')    : l10n.t('shortcuts.key.del'),
        '↖': mac ? '↖ ' + l10n.t('shortcuts.key.pgup')   : l10n.t('shortcuts.key.pgup'),
        '↘': mac ? '↘ ' + l10n.t('shortcuts.key.pgdn')   : l10n.t('shortcuts.key.pgdn'),
        '⇞': mac ? '⇞ ' + l10n.t('shortcuts.key.home')   : l10n.t('shortcuts.key.home'),
        '⇟': mac ? '⇟ ' + l10n.t('shortcuts.key.end')    : l10n.t('shortcuts.key.end'),
        '↵': mac ? '⏎ ' + l10n.t('shortcuts.key.return') : l10n.t('shortcuts.key.enter'),
        '⎋': mac ? '⎋ ' + l10n.t('shortcuts.key.esc')    : l10n.t('shortcuts.key.esc'),
        '☰': mac ? '☰ ' + l10n.t('shortcuts.key.menu')  : l10n.t('shortcuts.key.menu'),
      };

      return replacements[char] || char;
    }
  }
);
