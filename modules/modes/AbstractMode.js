import { EventEmitter } from 'pixi.js';


/**
 * "Modes" are editing tasks that the user are allowed to perform.
 * Each mode is exclusive, i.e only one mode should be active at a time.
 *
 * `AbstractMode` is the base class from which all modes inherit.
 * All modes are event emitters.
 *
 * Properties you can access:
 *   `id` (or `modeID`)   `String` identifier for the mode (e.g. 'browse')
 *   `active`             `true` if the mode is active, `false` if not.
 *   `operations`         `Array` of operations allowed on the right-click edit menu
 *   `selectedData`       `Map<dataID, data>` containing selected data
 */
export class AbstractMode extends EventEmitter {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super();
    this.id = '';
    this.context = context;

    this._active = false;
    this._selectedData = new Map();
    this.operations = [];
  }


  /**
   * enter
   * Every mode should have an `enter` function to peform any necessary setup tasks
   * @param   {Object}   options -  Optional `Object` of options passed to the mode
   * @return  {boolean}  `true` if mode could be entered, `false` it not
   */
  enter() {
    this._active = true;
    return true;
  }


  /**
   * exit
   * Every mode should have a `exit` function to perform any necessary teardown tasks
   */
  exit() {
    this._active = false;
  }


  /**
   * modeID
   * Unique string to identify this Mode.
   * @return  {string}
   * @readonly
   */
  get modeID() {
    return this.id;
  }


  /**
   * active
   * Whether the mode is active
   * @return {boolean}  `true` if active, `false` if not.
   * @readonly
   */
  get active() {
    return this._active;
  }


  /**
   * selectedData
   * @return  {Map<string,AbstractData>}  selected data
   * @readonly
   */
  get selectedData() {
    return this._selectedData;
  }


  /**
   * selectedIDs
   * @return  {Array<string>}  selected IDs
   * @readonly
   */
  get selectedIDs() {
    return Array.from(this._selectedData.keys());
  }

}

