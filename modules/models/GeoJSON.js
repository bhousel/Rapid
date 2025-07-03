import { AbstractData } from './AbstractData.js';


/**
 * GeoJSON
 * This is a wrapper for any kind of arbitrary GeoJSON data.
 * Important:  Pass the entire GeoJSON object into props, not just the GeoJSON `properties`!
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 */
export class GeoJSON extends AbstractData {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'geojson-' + this.context.next('geojson');
    }

    this.updateGeometry();
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}   props - the updated properties
   * @return  {GeoJSON}  a new GeoJSON data element
   */
  update(props) {
    return new GeoJSON(this, props).touch();
  }

  /**
   * updateGeometry
   * Forces a recomputation of the internal geometry data.
   * @return  {GeoJSON}  this same data element
   * @abstract
   */
  updateGeometry() {
    this.geoms.setData(this.props);
    return this;
  }

  /**
   * asGeoJSON
   * For compatibility with other data elements, this just returns the original
   *  GeoJSON data, which we have stored in `props`.
   * @return  {Object}  GeoJSON representation of this data element
   */
  asGeoJSON() {
    return this.props;
  }

  /**
   * serviceID
   * GeoJSON may be associated with a 'serviceID' string.
   * For example 'keepright', 'maproulette', 'mapillary', etc.
   * @return  {string?}
   * @readonly
   */
  get serviceID() {
    return this.props.serviceID;
  }

  /**
   * properties
   * Get the real GeoJSON properties.
   * @return  {Object}
   * @readonly
   */
  get properties() {
    return this.props.properties || {};
  }

}
