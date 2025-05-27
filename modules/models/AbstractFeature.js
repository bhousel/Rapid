import { Geometry } from './Geometry.js';


// Global version sequence used by all features
// We did it this way to avoid the situation where you undo a feature
// to a previous version and then increment it back to the same version.
// see Rapid@9ac2776a
let _nextv = 1;

// // Clone a {Map|Object} to a {Map}.
// function toMap(src) {
//   if (src instanceof Map) return new Map(src);
//   if (src instanceof Object) return new Map(Object.entries(src));
//   return new Map();
// }


/**
 * AbstractFeature is the base class from which all data Features inherit.
 * A "data feature" is the internal representation of a piece of map data.
 * It has a type, geometry, and properties (in OSM, these are the tags).
 *
 * Data Features are intended to be immutable - the `update()` method will return a new Feature.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties you can access:
 *   `id`      Unique string to use for the name of this Data Feature
 *   `type`    String describing what kind of Data Feature this is ('node', 'way', 'relation')
 *   `v`       Version of the Feature, can be used to detect changes
 *   `geom`    Geometry object
 *   `props`   Properties object
 */
export class AbstractFeature {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    if (otherOrContext instanceof AbstractFeature) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this.props = globalThis.structuredClone(other.props);
      this.geom = other.geom.clone();

    } else {
      const context = otherOrContext;
      this.context = context;
      this.props = {};
      this.geom = new Geometry(context);
    }

    Object.assign(this.props, props);  // override with passed in props
    // this._assignProps();
  }


  // /**
  //  * _assignProps
  //  * Some of the props we receive are special
  //  * We'll move them out of the props object into their own properties.
  //  */
  // _assignProps() {
  //   for (const [k, v] of Object.entries(this.props)) {
  //     if (k === 'id') {
  //       this.id = v;
  //       delete this.props.id;

  //     } else if (k === 'type') {
  //       delete this.props.type;

  //     } else if (v === undefined) {
  //       delete this.props[k];
  //     }
  //   }
  // }


  /**
   * destroy
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   * @abstract
   */
  destroy() {
    this.geom.destroy();
    this.geom = null;
    this.props = null;
  }

  /**
   * clone
   * Clone (deep copy) this Feature into a new Feature.
   * @return    A deep copy of the feature
   * @abstract
   */
  clone() {
    throw new Error(`Do not call 'clone' on AbstractFeature`);
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature
   * @param   {Object}  props
   * @return  this
   * @abstract
   */
  update(props) {
    throw new Error(`Do not call 'update' on AbstractFeature`);
  }

  /**
   * updateSelf
   * Like `update` but it modifies the Feature's properties in-place.
   * This option is slightly more performant for situations where you don't mind mutating the Feature
   * @param   {Object}  props
   * @return  this
   * @abstract
   */
  updateSelf(props) {
    throw new Error(`Do not call 'updateSelf' on AbstractFeature`);
  }

  /**
   * touch
   * Bump internal version number in place (forcing a rerender)
   * @return  this feature
   */
  touch() {
    this.props.v = _nextv++;
    return this;
  }

  /**
   * type
   * @return   {string}
   */
  get type() {
    return this.props.type ?? '';
  }
  set type(val) {
    this.props.type = val;
  }

  /**
   * id
   * @return   {string}
   */
  get id() {
    return this.props.id ?? '';
  }
  set id(val) {
    this.props.id = val;
  }

  /**
   * v
   * @return   {number}
   */
  get v() {
    return this.props.v || 0;
  }
  set v(val) {
    this.props.v = val;
  }

  /**
   * key
   * The 'key' includes both the id and the version
   * @return   {string}
   * @readonly
   */
  get key() {
    return `${this.props.id}v${this.props.v}`;
  }
}
