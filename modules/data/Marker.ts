import { AbstractData, AbstractDataProps } from './AbstractData.ts';
import type { Context } from '../core/types.ts';
import type { GeoJSONObject, GeoJSONProperties, PointGeometry } from '../lib/types.ts';
import type { Vec2 } from './types.ts';


/**
 * Properties for Marker data elements.
 */
export interface MarkerProps extends AbstractDataProps {
  /** Location in WGS84 [lon, lat] */
  loc: Vec2;
  /** Associated service ID (e.g. 'keepright', 'maproulette', 'mapillary') */
  serviceID: string;
  /** Whether this is a new marker */
  isNew: boolean;
}


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
export class Marker extends AbstractData<MarkerProps> {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  constructor(otherOrContext: Marker | Context, props: Partial<MarkerProps> = {}) {
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
   * @returns this same Marker
   */
  updateGeometry(): this {
    this.geoms.setData(this.asGeoJSON());
    return this;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the Marker.
   * Markers are represented by a Feature with a Point geometry.
   * @returns GeoJSON representation of the Marker
   */
  asGeoJSON(): GeoJSONObject {
    let geometry: PointGeometry | null = null;

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
      properties: this.props as GeoJSONProperties,
      geometry: geometry
    };
  }

  /**
   * loc
   * Markers should have a `loc` property to represent the location in WGS84 lat/lon
   * @readonly
   */
  get loc(): Vec2 | undefined {
    return this.props.loc;
  }

  /**
   * serviceID
   * Markers are usually associated with a 'serviceID' string.
   * For example 'keepright', 'maproulette', 'mapillary', etc.
   * @readonly
   */
  get serviceID(): string | undefined {
    return this.props.serviceID;
  }

  /**
   * isNew
   * In the old QAItem class we had some OSM-like code to consider negative ids as new.
   * Instead we'll just set an isNew property for new markers.
   * @readonly
   */
  get isNew(): boolean {
    return this.props.isNew ?? false;
  }

}
