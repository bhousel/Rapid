import { Geometry } from './Geometry.js';


// Global version sequence used by all features
// We did it this way to avoid the situation where you undo a feature
// to a previous version and then increment it back to the same version.
// see Rapid@9ac2776a
let _nextv = 0;


/**
 * AbstractDataFeature is the base class from which all Data Features inherit.
 * A "data feature" is the internal representation of a piece of map data.
 * It has a type, geometry, and properties (in OSM, these are the tags).
 *
 * Data Features are intended to be immutable - the `update()` method will return a new Feature.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties you can access:
 *   `dataID`  Unique string to use for the name of this Data Feature
 *   `type`    String describing what kind of Data Feature this is ('node', 'way', 'relation')
 *   `v`       Version of the Feature, can be used to detect changes
 */
export class AbstractDataFeature {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Properties to assign to the feature
   * @abstract
   */
  constructor(context, props) {
    this.type = 'unknown';
    this.context = context;
    this.dataID = -1;
    this.v = -1;

    this.geometry = new Geometry(context);
    this.props = new Map();  // Map<string,any>
  }


  /**
   * destroy
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   * @abstract
   */
  destroy() {
  }


  /**
   * update
   * Update the Feature's properties and return a new Feature
   * @abstract
   * @param   {Object}    props
   * @return  {AbstractDataFeature}
   * @abstract
   */
  update(props) {
    return this;  // override in derived class
  }


  /**
   * updateSelf
   * Like `update` but it modifies the Feature's properties in-place.
   * This option is slightly more performant for situations where you don't mind mutating the Feature
   * @abstract
   * @param   {Object}  props
   * @return  this feature
   */
  updateSelf(props) {
    return this;
  }


  /**
   * touch
   * Bump internal version number in place (forcing a rerender)
   * @return  this feature
   */
  touch() {
    this.v = _nextv++;
    return this;
  }

  /**
   * Data Feature ID
   * @return   {string} - the dataID
   * @readonly
   */
  get id() {
    return this.dataID;
  }

}
