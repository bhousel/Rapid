import { utilArrayUnion, utilUnicodeCharsTruncated } from '@rapid-sdk/util';

import { AbstractData, AbstractDataProps } from './AbstractData.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmTags } from './types.ts';


/**
 * Properties for OsmEntity data elements.
 */
export interface OsmEntityProps extends AbstractDataProps {
  /** OSM tags as key-value string pairs */
  tags?: OsmTags;
  /** OSM visibility attribute - objects with visible=false are considered deleted */
  visible?: boolean;
  /** OSM version attribute, used for conflict detection */
  version?: number;
  /** OSM user who last edited this entity */
  user?: string;
  /** OSM changeset ID */
  changeset?: string;
  /** Timestamp of last edit */
  timestamp?: string;
}


/** Type for the transients cache - maps entity keys to their cached computed values */
type TransientCache = Map<string, Map<string, unknown>>;


/**
 * Here is where we put logic that is common to OSM data elements.
 * Aside from the `props`, OSM data elements all contain a special `tags` object.
 *
 * OSM Entities are intended to be immutable - the `update()` method will return a new Entity.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 *   `tags`    Object containing key-value string pairs for the OSM tags
 */
export class OsmEntity extends AbstractData<OsmEntityProps> {
  /** Cache for memoizing expensive calculations, shared between copies */
  _transients: TransientCache;

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  constructor(otherOrContext: OsmEntity | Context, props: Partial<OsmEntityProps> = {}) {
    super(otherOrContext, props);

    // "transients" are a cache where we memoize expensive calculations.
    // They previously lived in the Graph, however we churn through Graphs
    // pretty frequently, so they now live with the OsmEntities themselves.
    // The transients cache is shared between entities that copy from other entities.
    // For this to work, the Entity must be touched if there is a meaningful
    // change in the Graph that will cause the computed property to change.
    if (otherOrContext instanceof AbstractData) {  // copy other
      const other = otherOrContext as OsmEntity;
      this._transients = other._transients;

    } else {
      this._transients = new Map();
    }

    // Idea: Store tags in a proto-less object to avoid collisions with
    //  reserved words in JavaScript objects, see iD#3044
    // Good idea, but this won't survive `structuredClone` or other
    //  serialize/deserialize tricks like JSON.parse/JSON.stringify
    if (!this.props.tags) {
      // this.props.tags = Object.create(null);
      this.props.tags = {};
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id || '';
  }

  /**
   * Every data element should have a destroy function that frees all the resources
   * Do not use the data element after calling `destroy()`.
   */
  destroy(): void {
    super.destroy();
    this._transients = null!;
  }

  /**
   * OSM geometry can be complicated.
   * Nodes are easy because they represent a single coordinate.
   * But the other data types require topology information from a Graph.
   * This function allows the calling code to recompute the geometry after the Graph has been updated.
   * @param graph - the Graph that holds the topology needed
   * @returns this same OsmEntity
   */
  updateGeometry(graph?: Graph): this {
    // this.touch();
    this._transients.clear();
    this.geoms.setData(this.asGeoJSON(graph));
    return this;
  }

  /**
   * Returns a GeoJSON representation of this data element.
   * (For generic OsmEntity, this currently returns an unlocated Feature)
   * @param _graph - optional param, used only for some OSM Entities
   * @returns GeoJSON representation of this data element
   */
  asGeoJSON(_graph?: Graph): GeoJSONObject {
    return {
      type: 'Feature',
      id: this.id,
      properties: this.tags,
      geometry: null
    };
  }

  /**
   * Returns a JSON representation of this data element.
   * For OSM Entities, this is used to serialize the Entity into the backup history.
   * @returns JSON representation of this data element
   */
  asJSON(): Partial<OsmEntityProps> {
    return { ...this.props };
  }

  /**
   * Returns a JXON representation of the data element.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param _changesetID - optional changeset ID to include in the output
   * @returns JXON representation of the OsmEntity
   */
  asJXON(_changesetID?: string): Record<string, unknown> {
    throw new Error(`Do not call 'asJXON' on OSMEntity`);
  }

  /**
   * Returns 'point', 'line', 'vertex', 'area, or 'relation' depending on the data type.
   * @param graph - the Graph that holds the topology needed
   * @returns 'point', 'line', 'vertex', 'area, or 'relation' depending on the data type
   */
  geometry(graph: Graph): GeometryType {
    throw new Error(`Do not call 'geometry' on OsmEntity`);
  }

  /**
   * Makes a (mostly) deep copy of an OSM Entity.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * Note that this function is subclassed, so that Ways and Relations can copy their child data too.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param _fromGraph - The Graph that owns the source object (needed for some data types)
   * @param memo - An Object to store seen copies (to prevent circular/infinite copying)
   * @returns a copy of this OsmEntity
   */
  copy(_fromGraph: Graph, memo: Record<EntityID, OsmEntity> = {}): OsmEntity {
    if (memo[this.id]) {
      return memo[this.id];
    }
    const Type = this.constructor as new (other: OsmEntity, props: Partial<OsmEntityProps>) => OsmEntity;
    const copy = new Type(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;
    return copy;
  }

  /**
   * Stores a computed property for this Entity.
   * We're essentially implementing "memoization" for the provided function.
   * @param k - String cache key to lookup the computed value (e.g. 'extent')
   * @param fn - Function that performs the computation
   * @returns The result of the function call
   */
  transient<T>(k: string, fn: () => T): T {
    const entityKey = this.key;
    let cache = this._transients.get(entityKey);
    if (!cache) {
      cache = new Map();
      this._transients.set(entityKey, cache);
    }

    let v = cache.get(k);
    if (v !== undefined) return v as T;  // return cached

    v = fn();   // compute value
    cache.set(k, v);
    return v as T;
  }

  /**
   * Tags are the `key=value` pairs of strings that assign meaning to an OSM element.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Tag
   * @readonly
   */
  get tags(): OsmTags {
    return this.props.tags ?? {};
  }

  /**
   * This is the OSM `visibility` attribute.
   * Objects with `visibility=false` are considered deleted.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   */
  get visible(): boolean {
    return this.props.visible ?? true;
  }
  set visible(val: boolean) {
    this.props.visible = val;
  }

  /**
   * This is the OSM `version` attribute, used for conflict detection.
   * When updating an OSM object, its version must match the value on the server,
   *  otherwise the editing API will raise a conflict.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   */
  get version(): number | undefined {
    return this.props.version;
  }
  set version(val: number | undefined) {
    this.props.version = val!;
  }


  /**
   * Get the entity type from an entity ID.
   * @param id - Entity ID (e.g. 'n123', 'w456', 'r789', 'c1')
   * @returns The entity type string
   */
  static type(id: string): string | undefined {
    const types: Record<string, string> = {
      'c': 'changeset', 'n': 'node', 'w': 'way', 'r': 'relation'
    };
    return types[id[0]];
  }

  /**
   * Convert OSM type and numeric ID to entity ID format.
   * @param type - Entity type ('node', 'way', 'relation', 'changeset')
   * @param id - Numeric OSM ID
   * @returns Entity ID (e.g. 'n123')
   */
  static fromOSM(type: string, id: string | number): EntityID {
    return type[0] + id;
  }

  /**
   * Extract the numeric OSM ID from an entity ID.
   * @param id - Entity ID (e.g. 'n123')
   * @returns Numeric ID as string (e.g. '123')
   */
  static toOSM(id: EntityID): string {
    return id.slice(1);
  }

  /**
   * Compare entities by their OSM ID for sorting.
   * Orders existing entities oldest-first, new entities newest-first.
   * @param a - First entity
   * @param b - Second entity
   * @returns Comparison result for sorting
   */
  static creationOrder(a: OsmEntity, b: OsmEntity): number {
    const aId = parseInt(OsmEntity.toOSM(a.id), 10);
    const bId = parseInt(OsmEntity.toOSM(b.id), 10);

    if (aId < 0 || bId < 0) return aId - bId;
    return bId - aId;
  }


  /**
   * This returns just the numeric part of the entityID.
   * @returns The numeric OSM ID as a string
   */
  osmId(): string {
    return OsmEntity.toOSM(this.props.id ?? '');
  }

  /**
   * By convention, negative numbers are used for new Entities, and positive numbers are used for existing entities.
   * @returns `true` if the Entity is new, `false` if the entity was downloaded from OSM.
   */
  isNew(): boolean {
    return parseInt(this.osmId(), 10) < 0;
  }

  /**
   * This merges the given tags into this Entity's existing tags.
   * When tags have different values, it attempts to convert them into a multi valued tag
   *   such as `key=val1;val2`, without overflowing the tag character limit.
   * @param tags - Tags to merge into this entity
   * @returns A new Entity copied from this Entity, but with the updated tags
   */
  mergeTags(tags: OsmTags): this {
    const merged: OsmTags = { ...this.props.tags };  // shallow copy
    let changed = false;
    for (const k in tags) {
      const t1 = merged[k];
      const t2 = tags[k];
      if (!t1) {
        changed = true;
        merged[k] = t2;
      } else if (k === 'building') {
        if (t2 === 'yes') {
          continue;
        } else if (t1 === 'yes') {
          changed = true;
          merged[k] = t2;
        }
      } else if (t1 !== t2) {
        changed = true;
        merged[k] = utilUnicodeCharsTruncated(
          utilArrayUnion(t1.split(/;\s*/), t2.split(/;\s*/)).join(';'),
          255 // avoid exceeding character limit; see also services/osm.js -> maxCharsForTagValue()
        );
      }
    }
    return changed ? this.update({ tags: merged }) : this;
  }

  /**
   * Returns `true` if this Entity is a member of any parent Relations.
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this Entity has parent Relations, `false` if not
   */
  hasParentRelations(graph: Graph): boolean {
    return graph.parentRelations(this).length > 0;
  }

  /**
   * Returns `true` if this Entity has tags other than `area=yes/no`.
   * @returns `true` if this Entity has non-geometry tags, `false` if not
   */
  hasNonGeometryTags(): boolean {
    for (const k of Object.keys(this.tags)) {
      if (k !== 'area') return true;
    }
    return false;
  }

  /**
   * By convention, some tags are more for storing metadata and can be safely ignored.
   * (For example, `source`, `created_by`, etc).
   * Checks the 'uninteresting' ruleset from the 'osm' schema scope.
   * @param key - The tag key to check
   * @returns `true` if the tag key is "interesting", `false` if it is metadata/uninteresting
   */
  isInterestingTag(key: string): boolean {
    const context = this.context;
    const schema = context.systems.schema;
    const uninteresting = schema?.getScope('osm')?.rulesets?.get('uninteresting');
    if (uninteresting) {
      return !uninteresting.match({ [key]: true });
    }
    return true;  // if no ruleset available, assume all tags are interesting
  }

  /**
   * By convention, some tags are more for storing metadata and can be safely ignored.
   * (For example, `source`, `created_by`, etc).
   * @returns `true` if this Entity has "interesting" tags, `false` if not
   */
  hasInterestingTags(): boolean {
    for (const k of Object.keys(this.tags)) {
      if (this.isInterestingTag(k)) return true;
    }
    return false;
  }

  /**
   * Is this Entity a highway intersection?
   * For most Entities this returns `false`, but is overridden in `OsmNode`.
   * @param _graph - the Graph that holds the topology needed
   * @returns `true` if this Entity is an intersection of parent highways, `false` if not
   */
  isHighwayIntersection(_graph?: Graph): boolean {
    return false;
  }

  /**
   * Each Entity has a way of checking whether it is degenerate (aka invalid) or not.
   * For generic Entities, this returns `true`, but should be overridden with proper logic in the derived classes.
   * @param _graph - the Graph that holds the topology needed
   * @returns `true` if this Entity is degenerate, `false` if not
   */
  isDegenerate(_graph?: Graph): boolean {
    return true;
  }

}
