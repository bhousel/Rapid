import type { Vec2 } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';


/**
 * "Operations" are the user-invokable commands that appear on the right-click
 * edit menu (and can be triggered via keyboard shortcuts). Each operation wraps
 * one or more actions and adds availability checks, keybindings, and user-facing
 * labels and tooltips.
 *
 * `AbstractOperation` is the base class from which all operations inherit.
 * An operation is constructed against a specific selection, computes whatever
 * derived state it needs up front, and exposes that state through its methods.
 *
 * Properties available:
 * -  `id` (or `operationID`)  String identifier for the operation (e.g. 'delete')
 * -  `title`                  Localized display title shown on the edit menu
 * -  `keys`                   Keyboard shortcuts that trigger the operation
 * -  `behavior`              `KeyOperationBehavior` that binds those shortcuts (if any)
 * -  `mouseOnly`             `true` if the operation should be hidden from touch/pen menus
 * -  `selectedIDs`           The entityIDs the operation was constructed against
 */
export class AbstractOperation {

  /** Global shared application context */
  public context: Context;
  /** The entityIDs this operation was constructed against */
  public selectedIDs: EntityID[];

  /** Unique string identifier for this operation (e.g. 'delete', 'reflect-long') */
  public id: OperationID;
  /** Localized display title shown on the edit menu */
  public title: string;
  /** Keyboard shortcuts that trigger this operation */
  public keys: string[];
  /** Binds this operation's keyboard shortcuts; some operations have none */
  public behavior?: KeyOperationBehavior;
  /** Whether this operation should be hidden from touch/pen menus */
  public mouseOnly: boolean;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs the operation acts on
   */
  public constructor(context: Context, selectedIDs: EntityID[] = []) {
    this.context = context;
    this.selectedIDs = selectedIDs;

    this.id = '';
    this.title = '';
    this.keys = [];
    this.mouseOnly = false;
  }


  /**
   * Perform the operation. Subclasses override this to do the actual work.
   */
  public run(): void {
    // nothing by default
  }


  /**
   * Whether the operation can be performed on the current selection.
   * @return `true` if the operation is available
   */
  public available(): boolean {
    return false;
  }


  /**
   * Whether the operation is currently disabled, and why.
   * @return A reason string if disabled, or `false` if enabled
   */
  public disabled(): string | false {
    return false;
  }


  /**
   * Localized tooltip describing the operation (or why it is disabled).
   * @return The tooltip text
   */
  public tooltip(): string {
    return '';
  }


  /**
   * Localized undo annotation for the edit the operation performs.
   * @return The annotation text
   */
  public annotation(): string {
    return '';
  }


  /**
   * EntityIDs related to (but not part of) the selection, e.g. the ways that would
   * be affected. Used to highlight features when hovering the menu item.
   * @return The related entityIDs
   */
  public relatedEntityIds(): EntityID[] {
    return [];
  }


  /**
   * Whether the operation should respond to its keyboard shortcut right now.
   * Overridden by operations that need to defer to the browser (e.g. copy when
   * the user has text selected).
   * @return `true` if the keypress should trigger the operation
   */
  public availableForKeypress(): boolean {
    return true;
  }


  /**
   * Records the screen coordinate where the operation was triggered.
   * Overridden by operations that care about the pointer location (e.g. copy).
   * @param  val - The screen coordinate, or `null` to clear it
   */
  public point(val: Vec2 | null): void {
    // nothing by default
  }
}
