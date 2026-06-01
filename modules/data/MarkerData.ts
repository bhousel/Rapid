import { AbstractData, AbstractDataProps } from './AbstractData.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Properties for Marker data elements.
 */
export interface MarkerProps extends AbstractDataProps {
  /** Location in WGS84 [lon, lat] */
  loc: Vec2;
  /** Associated service ID (e.g. 'keepright', 'maproulette', 'mapillary') */
  serviceID: ServiceID;
  /** Whether this is a new marker */
  isNew: boolean;
}


/**
 * This is a wrapper for any kind of arbitrary point data that appears on the map.
 * Markers are associated with a service where we fetched them from.
 * This used to be called "QAItem".
 *
 * Properties available:
 * - `geoms`   Geometry object (inherited from `AbstractData`)
 * - `props`   Properties object (inherited from `AbstractData`)
 */
export class MarkerData<P extends MarkerProps = MarkerProps> extends AbstractData<P> {

  // Narrow `props` from `Partial<P>` to `P`.
  // The constructor accepts `Partial<P>` for flexibility (e.g. tests),
  // but access sites can trust that required properties exist.
  // `declare` emits no JavaScript — it only refines the type.
  /** Narrows the inherited `Partial<P>` props to `P`; no JS is emitted — type-only. */
  public declare props: P;

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  public constructor(otherOrContext: MarkerData<P> | Context, props: Partial<P> = {}) {
    super(otherOrContext, props);

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'marker-' + this.context.next('marker');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    this.updateGeometry();
  }

  /**
   * Forces a recomputation of the internal geometry data.
   * @returns this same Marker
   */
  public updateGeometry(): this {
    this.geoms.setData(this.asGeoJSON());
    return this;
  }

  /**
   * Returns a GeoJSON representation of the Marker.
   * Markers are represented by a Feature with a Point geometry.
   * @returns GeoJSON representation of the Marker
   */
  public asGeoJSON(): GeoJSONObject {
    let geometry: GeoJSON.Point | null = null;

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
   * Markers should have a `loc` property to represent the location in WGS84 lat/lon
   * @return  `[lon, lat]` coordinate pair
   * @readonly
   */
  public get loc(): Vec2 {
    return this.props.loc;
  }

  /**
   * Markers are usually associated with a 'serviceID' string.
   * For example 'keepright', 'maproulette', 'mapillary', etc.
   * @return  The service that owns this marker
   * @readonly
   */
  public get serviceID(): ServiceID {
    return this.props.serviceID;
  }

  /**
   * In the old QAItem class we had some OSM-like code to consider negative ids as new.
   * Instead we'll just set an isNew property for new markers.
   * @return  `true` if this marker represents a newly created item
   * @readonly
   */
  public get isNew(): boolean {
    return this.props.isNew ?? false;
  }

}
