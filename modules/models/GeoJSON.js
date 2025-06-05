import { AbstractData } from './AbstractData.js';


let _nextid = 1;

/**
 * GeoJSON
 * This is a wrapper for any kind of arbitrary GeoJSON data.
 * Important:  Pass the entire GeoJSON object into props, not just the GeoJSON `properties`!
 *
 * Properties you can access:
 *   `geoms`   GeometryCollection object (inherited from `AbstractData`)
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
    this.geoms.setData(props);

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = `geojson${_nextid++}`;
    }
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}   props - the updated properties
   * @return  {GeoJSON}  a new GeoJSON
   */
  update(props) {
    return new GeoJSON(this, props).touch();
  }

  /**
   * properties
   * Get the real GeoJSON properties
   * @return {Object}
   * @readonly
   */
  get properties() {
    return this.props.properties || {};
  }

}
