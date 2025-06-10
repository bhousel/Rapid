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

    this.geoms.setData(this.asGeoJSON());
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}   props - the updated properties
   * @return  {Marker}  a new Marker
   */
  update(props) {
    return new Marker(this, props).touch();
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the Marker.
   * Markers are represented by a Feature with a Point geometry.
   * @return  {Object}  GeoJSON representation of the Marker
   */
  asGeoJSON() {
    const coords = this.loc;
    if (Array.isArray(coords) && coords.length >= 2) {
      return {
        type: 'Feature',
        id: this.id,
        properties: this.props,
        geometry: {
          type: 'Point',
          coordinates: coords
        }
      };
    } else {
      return {};
    }
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
   * Instead we'll just set an isNew property for a marker that didn't arrive with an id.
   * @return  {boolean}
   * @readonly
   */
  get isNew() {
    return this.props.isNew || false;
  }

}
