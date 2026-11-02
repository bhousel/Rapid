import { AbstractData, AbstractDataProps } from './AbstractData.ts';
import { Geometry } from '../lib/Geometry.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';


/**
 * Properties for GeoJSON data elements.
 */
export interface GeoJSONProps extends AbstractDataProps {
  /** The raw GeoJSON source data */
  geojson: GeoJSONObject;
  /** Associated serviceID (e.g. 'mapillary', 'keepright') */
  serviceID: ServiceID;
}


/**
 * This is a wrapper for any kind of arbitrary GeoJSON data.
 * Important:  pass the raw GeoJSON source as a `geojson` property.
 *
 * Properties available:
 * - `geoms` - Geometry object (inherited from `AbstractData`)
 * - `props` - Properties object (inherited from `AbstractData`)
 */
export class GeoJSONData<P extends GeoJSONProps = GeoJSONProps> extends AbstractData<P> {

  // The constructor accepts `Partial<P>` for flexibility (e.g. tests),
  // but access sites can trust that required properties exist.
  // `declare` emits no JavaScript — it only refines the type.
  /** Narrows the inherited `Partial<P>` props to `P` */
  public declare props: P;


  /**
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  public constructor(otherOrContext: GeoJSONData<P> | Context, props: Partial<P> = {}) {
    super(otherOrContext, props);

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'geojson-' + this.context.next('geojson');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    this.updateGeometry();
  }

  /**
   * Forces a recomputation of the internal geometry data.
   * It stores a new `Geometry` and leaves the old one untouched, because a renderer may still hold its parts.
   * The constructor calls it. To change a data element, make a new one with `update()` instead: data
   * isn't changed in place.
   * @returns this same data element
   */
  public updateGeometry(): this {
    const geoms = new Geometry(this.context);
    geoms.setData(this.asGeoJSON());
    this.geoms = geoms;
    return this;
  }

  /**
   * We expect to find the original GeoJSON source in a `geojson` property.
   * @returns GeoJSON representation of this data element
   */
  public asGeoJSON(): GeoJSONObject {
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
   * GeoJSON may be associated with a 'serviceID' string.
   * For example 'keepright', 'maproulette', 'mapillary', etc.
   * @return  The service that owns this data element
   * @readonly
   */
  public get serviceID(): ServiceID {
    return this.props.serviceID;
  }

  /**
   * Get the real GeoJSON properties.
   * @return  The GeoJSON feature's `properties` object, or an empty object
   * @readonly
   */
  public get properties(): Record<string, unknown> {
    const geojson = this.props.geojson;
    return (geojson as any)?.properties ?? {};
  }

}
