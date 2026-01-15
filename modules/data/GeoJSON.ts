import { AbstractData, AbstractDataProps } from './AbstractData.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';


/**
 * Properties for GeoJSON data elements.
 */
export interface GeoJSONProps extends AbstractDataProps {
  /** The raw GeoJSON source data */
  geojson: GeoJSONObject;
  /** Associated service ID (e.g. 'mapillary', 'keepright') */
  serviceID: string;
}


/**
 * GeoJSON
 * This is a wrapper for any kind of arbitrary GeoJSON data.
 * Important:  pass the raw GeoJSON source as a `geojson` property.
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 */
export class GeoJSON extends AbstractData<GeoJSONProps> {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  constructor(otherOrContext: GeoJSON | Context, props: Partial<GeoJSONProps> = {}) {
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
   * @returns this same data element
   */
  updateGeometry(): this {
    this.geoms.setData(this.asGeoJSON());
    return this;
  }

  /**
   * asGeoJSON
   * We expect to find the original GeoJSON source in a `geojson` property.
   * @returns GeoJSON representation of this data element
   */
  asGeoJSON(): GeoJSONObject {
    const geojson = this.props.geojson;
    if (geojson) {
      return Object.assign({}, geojson, { id: this.id });

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
   * @readonly
   */
  get serviceID(): string | undefined {
    return this.props.serviceID;
  }

  /**
   * properties
   * Get the real GeoJSON properties.
   * @readonly
   */
  get properties(): Record<string, unknown> {
    const geojson = this.props.geojson;
    return (geojson as any)?.properties ?? {};
  }

}
