import { Extent } from '@rapid-sdk/math';
import { Geometry } from '../lib/Geometry.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { DataConstructor } from './types.ts';


/**
 * Properties for AbstractData
 * Base properties shared by all data elements.
 */
export interface AbstractDataProps {
  /** Unique identifier for this data element */
  id?: string;
  /** String describing what kind of data element this is (e.g. 'node', 'way', 'relation') */
  type?: string;
  /** Internal version number, used to detect changes */
  v?: number;
  /** Extra properties are allowed */
  [key: string]: unknown;
}


/**
 * AbstractData is the base class from which all managed data elements inherit.
 * A data element is the internal representation of a piece of map data.
 * It can refer to an OSM Entity or a GeoJSON object.
 * It has a type, geometry, and properties.
 *
 * Data elements are intended to be immutable - the `update()` method will return a new data element.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties available:
 * - `id` (or `dataID`)  Unique string to identify this data element.
 * - `type`              String describing what kind of data element this is (e.g. 'node', 'way', 'relation')
 * - `v`                 Internal version of the data element, can be used to detect changes
 * - `geoms`             Geometry object
 * - `props`             Properties object
 *
 * @template P - The props interface for this data element (must extend AbstractDataProps)
 */
export class AbstractData<P extends AbstractDataProps = AbstractDataProps> {
  /** Unique identifier for this data element */
  public id: string;
  /** Application context */
  public context: Context;
  /** Geometry wrapper containing original and projected data */
  public geoms: Geometry;
  /** Properties object */
  public props: Partial<P>;

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  public constructor(otherOrContext: AbstractData<P> | Context, props: Partial<P> = {}) {
    this.id = '';  // put this first so debug inspect shows it first

    if (otherOrContext instanceof AbstractData) {  // copy other
      const other = otherOrContext;
      this.context = other.context;
      this.props = structuredClone(other.props) as Partial<P>;
      this.geoms = other.geoms.clone();

    } else {
      const context = otherOrContext;
      this.context = context;
      this.props = {};
      this.geoms = new Geometry(context);
    }

    Object.assign(this.props, structuredClone(props));  // override with passed in props

    // For consistency, offer a `this.id` property.
    this.id = this.props.id || '';
  }


  /**
   * Every data element should have a destroy function that frees all the resources
   * Do not use the data element after calling `destroy()`.
   * @abstract
   */
  public destroy(): void {
    this.geoms.destroy();
    this.geoms = null!;
    this.props = null!;
    this.context = null!;
  }

  /**
   * Update the data element's properties and return a new data element.
   * Data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param props - the updated properties
   * @returns a new data element
   */
  public update(props: Partial<P>): this {
    const Type = this.constructor as DataConstructor<this>;
    return new Type(this, props).touch();
  }

  /**
   * Forces a recomputation of the internal geometry data.
   * The Graph param is only needed for OSM data types that require a Graph to know their topology.
   * @param _graph - optional param, used only for some OSM Entities
   * @returns this same data element
   * @abstract
   */
  public updateGeometry(_graph?: Graph): this {
    throw new Error(`Do not call 'updateGeometry' on AbstractData`);
  }

  /**
   * Returns a GeoJSON representation of this data element.
   * @param _graph - optional param, used only for some OSM Entities
   * @returns GeoJSON representation of the data element
   * @abstract
   */
  public asGeoJSON(_graph?: Graph): GeoJSONObject {
    throw new Error(`Do not call 'asGeoJSON' on AbstractData`);
  }

  /**
   * Get an Extent (in WGS84 lon/lat) from this data elemenent's geometry.
   * Note that this may return `undefined` in situations where an Extent could not be determined.
   * (e.g. Called before geometry is ready, Way without nodes, Relation without members, etc.)
   * @returns Extent representing the data element's bounding box, or `undefined`
   */
  public extent(): Extent | undefined {
    return this.geoms?.orig?.extent;
  }

  /**
   * Test if this data element intersects the given other Extent
   * Note that this may return `false` in situations where an Extent could not be determined.
   * (e.g. Called before geometry is ready, Way without nodes, Relation without members, etc.)
   * @param other - the test extent
   * @returns `true` if it intersects, `false` if not
   */
  public intersects(other: Extent): boolean {
    const extent = this.geoms?.orig?.extent;
    return extent?.intersects(other) ?? false;
  }

  /**
   * Bump internal version number in place (typically, forcing a rerender)
   * Note that this version number always increases and is shared by all data elements.
   * We did it this way to avoid situations where you undo to a previous version
   *  you don't want it to increment it back to the same version and appear unchanged.
   * @see Rapid@9ac2776a
   * @returns this data element
   */
  public touch(): this {
    this.props.v = this.context.next('v');
    return this;
  }

  /**
   * A string describing what kind of data element this is (e.g. 'node', 'way', 'relation')
   * The meaning of this type is data-dependant.  For OSM data it will be something like
   *  'node', 'way', 'relation', but for other data may be unset.
   * @return  Type string for this data element
   * @readonly
   */
  public get type(): string {
    return (this.props as Partial<AbstractDataProps>).type ?? '';
  }

  /**
   * Unique string to identify this data element
   * @return  This data element's unique ID
   * @readonly
   */
  public get dataID(): string {
    return this.id;
  }

  /**
   * Internal version of the data element, can be used to detect changes.
   * @return  Version counter
   * @readonly
   */
  public get v(): number {
    return (this.props as Partial<AbstractDataProps>).v || 0;
  }

  /**
   * The 'key' includes both the id and the version
   * @return  Combined `id + version` key string
   * @readonly
   */
  public get key(): string {
    return `${this.id}v${this.v}`;
  }

}
