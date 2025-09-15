import { AbstractData } from './AbstractData.js';


/**
 * GeoJSON
 * This is a wrapper for any kind of arbitrary GeoJSON data.
 * Important:  pass the raw GeoJSON source as a `geojson` property.
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

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    this.updateGeometry();
  }

  /**
   * updateGeometry
   * Forces a recomputation of the internal geometry data.
   * @return  {GeoJSON}  this same data element
   * @abstract
   */
  updateGeometry() {
    this.geoms.setData(this.asGeoJSON());
    return this;
  }

  /**
   * asGeoJSON
   * We expect to find the original GeoJSON source in a `geojson` property.
   * @return  {Object}  GeoJSON representation of this data element
   */
  asGeoJSON() {
    if (this.props.geojson) {
      return Object.assign({}, this.props.geojson, { id: this.id });

    } else {  // fallback
      return {
        type: 'Feature',
        id: this.id,
        properties: this.props,
        geometry: null
      };
    }
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
    return this.props.geojson?.properties || {};
  }

}
