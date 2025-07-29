import { Geometry } from './Geometry.js';


/**
 * AbstractData is the base class from which all managed data elements inherit.
 * A data element is the internal representation of a piece of map data.
 * It can refer to an OSM Entity or a GeoJSON object.
 * It has a type, geometry, and properties (in OSM, these are the tags).
 *
 * Data elements are intended to be immutable - the `update()` method will return a new data element.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties you can access:
 *   `id`      Unique string to identify this data element (elsewhere, referred to as the `dataID`)
 *   `type`    String describing what kind of data element this is (e.g. 'node', 'way', 'relation')
 *   `v`       Internal version of the data element, can be used to detect changes
 *   `geoms`   Geometry object
 *   `props`   Properties object
 */
export class AbstractData {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    this._id = '';  // put this first so debug inspect shows it first

    if (otherOrContext instanceof AbstractData) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this.props = globalThis.structuredClone(other.props);
      this.geoms = other.geoms.clone();

    } else {
      const context = otherOrContext;
      this.context = context;
      this.props = {};
      this.geoms = new Geometry(context);
    }

    Object.assign(this.props, globalThis.structuredClone(props));  // override with passed in props
  }


  /**
   * destroy
   * Every data element should have a destroy function that frees all the resources
   * Do not use the data element after calling `destroy()`.
   * @abstract
   */
  destroy() {
    this.geoms.destroy();
    this.geoms = null;
    this.props = null;
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * Data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}        props - the updated properties
   * @return  {AbstractData}  a new data element
   * @abstract
   */
  update(props = {}) {
    throw new Error(`Do not call 'update' on AbstractData`);
  }

  /**
   * updateSelf
   * Like `update` but it modifies the current data element's properties in-place.
   * This will also update the data element's `v` internal version number.
   * `updateSelf` is slightly more performant for situations where you don't need
   * immutability and don't mind mutating the data element.
   *
   * A warning for OSM Entities - this can circumvent `updateGeometry`.
   * So you shouldn't `updateSelf` for OsmNodes where to try to change it's `loc`.
   * And you shouldn't `updateSelf` for any entity after it has been added to a Graph.
   *
   * @param   {Object}        props - the updated properties
   * @return  {AbstractData}  this same data element
   */
  updateSelf(props = {}) {
    Object.assign(this.props, globalThis.structuredClone(props));  // override with passed in props
    this.touch();
    return this;
  }

  /**
   * updateGeometry
   * Forces a recomputation of the internal geometry data.
   * The Graph param is only needed for OSM data types that require a Graph to know their topology.
   * @param   {Graph}         graph - the Graph that holds the information needed
   * @return  {AbstractData}  this same data element
   * @abstract
   */
  updateGeometry(graph) {
    throw new Error(`Do not call 'updateGeometry' on AbstractData`);
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of this data element.
   * @param   {Graph?}  graph - optional param, used only for some OSM Entities
   * @return  {Object}  GeoJSON representation of the OsmNode
   * @abstract
   */
  asGeoJSON() {
    throw new Error(`Do not call 'asGeoJSON' on AbstractData`);
  }

  /**
   * extent
   * Get an Extent (in WGS84 lon/lat) from this data elemenent's geometry.
   * Note that this may return `null` in situations where an Extent could not be determined.
   * (e.g. Called before geometry is ready, Way without nodes, Relation without members, etc.)
   * @return  {Extent}  Extent representing the data element's bounding box, or `null`
   */
  extent() {
    return this.geoms.orig?.extent;
  }

  /**
   * intersects
   * Test if this data element intersects the given other Extent
   * Note that this may return `false` in situations where an Extent could not be determined.
   * (e.g. Called before geometry is ready, Way without nodes, Relation without members, etc.)
   * @param   {Extent}   other - the test extent
   * @return  {boolean}  `true` if it intersects, `false` if not
   */
  intersects(other) {
    const extent = this.geoms.orig?.extent;
    return extent?.intersects(other) ?? false;
  }

  /**
   * touch
   * Bump internal version number in place (typically, forcing a rerender)
   * Note that this version number always increases and is shared by all data elements.
   * We did it this way to avoid situations where you undo to a previous version
   *  you don't want it to increment it back to the same version and appear unchanged.
   * @see Rapid@9ac2776a
   * @return  {AbstractData}  this data element
   */
  touch() {
    this.props.v = this.context.next('v');
    return this;
  }

  /**
   * type
   * A string describing what kind of data element this is (e.g. 'node', 'way', 'relation')
   * The meaning of this type is data-dependant.  For OSM data it will be something like
   *  'node', 'way', 'relation', but for other data may be unset.
   * @return  {string}  string describing what kind of data element this is
   * @readonly
   */
  get type() {
    return this.props.type ?? '';
  }

  /**
   * id
   * Unique string to identify this data element (elsewhere, referred to as the `dataID`)
   * @return  {string}
   * @readonly
   */
  get id() {
    return this.props.id ?? '';
  }

  /**
   * v
   * Internal version of the data element, can be used to detect changes.
   * @return  {number}
   * @readonly
   */
  get v() {
    return this.props.v || 0;
  }

  /**
   * key
   * The 'key' includes both the id and the version
   * @return   {string}  The id and the version, for example "n1v0"
   * @readonly
   */
  get key() {
    return `${this.id}v${this.v}`;
  }

}
