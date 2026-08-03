import { AbstractBehavior } from './AbstractBehavior.ts';

import type { Context } from '../Context.ts';
import type { Keybinding } from '../util/keybinding.ts';


/**
 * `KeyOperationBehavior` binds whatever keystroke events trigger an "operation"
 * ("operations" are the things that go on the editing menu)
 */
export class KeyOperationBehavior extends AbstractBehavior {

  /** The operation this behavior is associated with */
  protected _operation: any;
  /** The keybinding handler for document-level key events */
  protected _keybinding: Keybinding | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   * @param  operation - The operation this behavior is associated with
   */
  public constructor(context: Context, operation: any) {
    super(context);
    this.id = `key-${operation.id}`;

    this._operation = operation;
    this._keybinding = null;

    const isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);
    if (!isTestEnvironment) {
      this._keybinding = this.context.keybinding(); // "global" keybinding (on document)
    }

    // Make sure the event handlers have `this` bound correctly
    this._keydown = this._keydown.bind(this);
  }


  /**
   * Bind event handlers
   */
  public enable(): void {
    if (this._enabled) return;

    const operation = this._operation;
    if (operation.available() && operation.keys && this._keybinding) {
      this._keybinding.on(operation.keys, this._keydown);
      this._enabled = true;
    }
  }


  /**
   * Unbind event handlers
   */
  public disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    const operation = this._operation;
    if (operation.keys && this._keybinding) {
      this._keybinding.off(operation.keys);
    }
  }


  /**
   * Handles the keydown event
   * @param  e - A d3 keydown event
   */
  protected _keydown(e: KeyboardEvent): void {
    const context = this.context;
    const operation = this._operation;
    const ui = context.systems.ui!;

    if (operation.availableForKeypress && !operation.availableForKeypress()) return;  // copy paste detail 😕

    e.preventDefault();

    const disabled = operation.disabled();

    if (disabled) {
      ui.Flash.show({
        duration: 4000,
        iconName: `#rapid-operation-${operation.id}`,
        iconClass: 'operation disabled',
        label: operation.tooltip()
      });

    } else {
      ui.Flash.show({
        duration: 2000,
        iconName: `#rapid-operation-${operation.id}`,
        iconClass: 'operation',
        label: operation.annotation() || operation.title
      });

      if (operation.point) {
        operation.point(null);  // copy-paste detail 😕
      }

      operation();  // do the thing
    }
  }

}
