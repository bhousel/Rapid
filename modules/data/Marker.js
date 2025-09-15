import { AbstractData } from './AbstractData.js';


/**
 * Marker
 * This is a wrapper for any kind of arbitrary point data that appears on the map.
 * Markers are associated with a service where we fetched them from.
 * This used to be called "QAItem".
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 */
export class Marker extends AbstractData {

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
      this.props.id = 'marker-' + this.context.next('marker');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    this.updateGeometry();
  }

  /**
   * updateGeometry
   * Forces a recomputation of the internal geometry data.
   * @return  {Marker}  this same Marker
   * @abstract
   */
  updateGeometry() {
    this.geoms.setData(this.asGeoJSON());
    return this;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the Marker.
   * Markers are represented by a Feature with a Point geometry.
   * @return  {Object}  GeoJSON representation of the Marker
   */
  asGeoJSON() {
    let geometry = null;

    const coords = this.loc;
    if (Array.isArray(coords) && coords.length >= 2) {
      geometry = {
        type: 'Point',
        coordinates: coords
      };
    }

    return {
      type: 'Feature',
      id: this.id,
      properties: this.props,
      geometry: geometry
    };
  }

  /**
   * loc
   * Markers should have a `loc` property to represent the location in WGS84 lat/lon
   * @readonly
   */
  get loc() {
    return this.props.loc;
  }

  /**
   * serviceID
   * Markers are usually associated with a 'serviceID' string.
   * For example 'keepright', 'maproulette', 'mapillary', etc.
   * @return  {string?}
   * @readonly
   */
  get serviceID() {
    return this.props.serviceID;
  }

  /**
   * isNew
   * In the old QAItem class we had some OSM-like code to consider negative ids as new.
   * Instead we'll just set an isNew property for new markers.
   * @return  {boolean}
   * @readonly
   */
  get isNew() {
    return this.props.isNew || false;
  }

}
