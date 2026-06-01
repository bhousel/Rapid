import { EventEmitter } from 'tseep';

import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from '../Context.ts';


/**
 * "Modes" are editing tasks that the user are allowed to perform.
 * Each mode is exclusive, i.e only one mode should be active at a time.
 *
 * `AbstractMode` is the base class from which all modes inherit.
 * All modes are event emitters.
 *
 * Properties you can access:
 *   `id` (or `modeID`)   String identifier for the mode (e.g. 'browse')
 *   `active`             `true` if the mode is active, `false` if not.
 *   `operations`         Array of operations allowed on the right-click edit menu
 *   `selectedData`       `Map<DataID, AbstractData>` containing selected data
 */
export class AbstractMode extends EventEmitter {
  public id: ModeID;
  public context: Context;
  // Operations are still untyped (modules/operations not yet converted)
  public operations: object[];

  protected _active: boolean;
  protected _selectedData: Map<DataID, AbstractData>;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.id = '';
    this.context = context;

    this._active = false;
    this._selectedData = new Map();
    this.operations = [];
  }


  /**
   * Every mode should have an `enter` function to peform any necessary setup tasks
   * @param  options - Optional object of options passed to the mode
   * @return `true` if mode could be entered, `false` if not
   */
  public enter(options?: object): boolean {
    this._active = true;
    return true;
  }


  /**
   * Every mode should have a `exit` function to perform any necessary teardown tasks
   */
  public exit(): void {
    this._active = false;
  }


  /**
   * Unique string to identify this Mode.
   * @readonly
   */
  public get modeID(): ModeID {
    return this.id;
  }


  /**
   * Whether the mode is active
   * @readonly
   */
  public get active(): boolean {
    return this._active;
  }


  /**
   * @readonly
   */
  public get selectedData(): Map<DataID, AbstractData> {
    return this._selectedData;
  }


  /**
   * @readonly
   */
  public get selectedIDs(): DataID[] {
    return Array.from(this._selectedData.keys());
  }

}
