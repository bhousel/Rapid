import { utilArrayUnion, utilUnicodeCharsTruncated } from '@rapid-sdk/util';

import { AbstractData } from './AbstractData.js';
import { osmIsInterestingTag } from './tags.js';


/**
 * OsmEntity
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
export class OsmEntity extends AbstractData {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);

    // "transients" are a cache where we memoize expensive calculations.
    // They previously lived in the Graph, however we churn through Graphs
    // pretty frequently, so they now live with the OsmEntities themselves.
    // The transients cache is shared between entities that copy from other entities.
    // For this to work, the Entity must be touched if there is a meaningful
    // change in the Graph that will cause the computed property to change.
    if (otherOrContext instanceof AbstractData) {  // copy other
      const other = otherOrContext;
      this._transients = other._transients;

    } else {
      this._transients = new Map();  // Map<entityKey, Map<k,v>>
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
   * destroy
   * Every data element should have a destroy function that frees all the resources
   * Do not use the data element after calling `destroy()`.
   * @abstract
   */
  destroy() {
    super.destroy();
    this._transients = null;
  }

  /**
   * updateGeometry
   * OSM geometry can be complicated.
   * Nodes are easy because they represent a single coordinate.
   * But the other data types require topology information from a Graph.
   * This function allows the calling code to recompute the geometry after the Graph has been updated.
   * @param   {Graph}      graph - the Graph that holds the topology needed
   * @return  {OsmEntity}  this same OsmEntity
   * @abstract
   */
  updateGeometry(graph) {
    // this.touch();
    this._transients.clear();
    this.geoms.setData(this.asGeoJSON(graph));
    return this;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of this data element.
   * (For generic OsmEntity, this currently returns an unlocated Feature)
   * @param   {Graph?}  graph - optional param, used only for some OSM Entities
   * @return  {Object}  GeoJSON representation of this data element
   * @abstract
   */
  asGeoJSON() {
    return {
      type: 'Feature',
      id: this.id,
      properties: this.tags,
      geometry: null
    };
  }

  /**
   * asJSON
   * Returns a JSON representation of this data element.
   * For OSM Entities, this is used to serialize the Entity into the backup history.
   * @return  {Object}  JSON representation of this data element
   */
  asJSON() {
    return Object.assign({}, this.props);
  }

  /**
   * asJXON
   * Returns a JXON representation of the data element.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param   {string}  changesetID - optional changeset ID to include in the output
   * @return  {Object}  JXON representation of the OsmWay
   * @abstract
   */
  asJXON(changesetID) {
    throw new Error(`Do not call 'asJXON' on OSMEntity`);
  }

  /**
   * copy
   * Makes a (mostly) deep copy of an OSM Entity.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * Note that this function is subclassed, so that Ways and Relations can copy their child data too.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param   {Graph}      fromGraph - The Graph that owns the source object (needed for some data types)
   * @param   {Object}     memo      - An Object to store seen copies (to prevent circular/infinite copying)
   * @return  {OsmEntity}  a copy of this OsmEntity
   */
  copy(fromGraph, memo = {}) {
    if (memo[this.id]) {
      return memo[this.id];
    }
    const Type = this.constructor;
    const copy = new Type(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;
    return copy;
  }

  /**
   * transient
   * Stores a computed property for this Entity.
   * We're essentially implementating "memoization" for the provided function.
   * @param   {string}    k - String cache key to lookup the computed value (e.g. 'extent')
   * @param   {function}  fn  - Function that performs the computation
   * @return  {*}         The result of the function call
   */
  transient(k, fn) {
    const entityKey = this.key;
    let cache = this._transients.get(entityKey);
    if (!cache) {
      cache = new Map();   // Map<entityKey, Map<k,v>>
      this._transients.set(entityKey, cache);
    }

    let v = cache.get(k);
    if (v !== undefined) return v;  // return cached

    v = fn();   // compute value
    cache.set(k, v);
    return v;
  }

  /**
   * tags
   * Tags are the `key=value` pairs of strings that assign meaning to an OSM element.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Tag
   * @return  {Object}
   * @readonly
   */
  get tags() {
    return this.props.tags;
  }

  /**
   * visible
   * This is the OSM `visibility` attribute.
   * Objects with `visibility=false` are considered deleted.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   * @return  {boolean}
   */
  get visible() {
    return this.props.visible ?? true;
  }
  set visible(val) {
    this.props.visible = val;
  }

  /**
   * version
   * This is the OSM `version` attribute, used for conflict detection.
   * When updating an OSM object, its version must match the value on the server,
   *  otherwise the editing API will raise a conflict.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   * @return  {string}
   */
  get version() {
    return this.props.version;
  }
  set version(val) {
    this.props.version = val;
  }


  static type(id) {
    return {
      'c': 'changeset', 'n': 'node', 'w': 'way', 'r': 'relation'
    }[id[0]];
  }

  // converts 'node', '-1' to 'n-1'
  static fromOSM(type, id) {
    return type[0] + id;
  }

  // converts 'n-1' to '-1'
  static toOSM(id) {
    return id.slice(1);
  }

  // compare entities by their osm id
  static creationOrder(a, b) {
    const aId = parseInt(OsmEntity.toOSM(a.id), 10);
    const bId = parseInt(OsmEntity.toOSM(b.id), 10);

    if (aId < 0 || bId < 0) return aId - bId;
    return bId - aId;
  };


  /**
   * osmId
   * This returns just the numerc part of the entityID.
   * @return  {string}
   */
  osmId() {
    return OsmEntity.toOSM(this.props.id);
  }

  /**
   * isNew
   * By convention, negative numbers are used for new Entities, and positive numbers are used for existing entities.
   * @return  {boolean}  `true` if the Entity is new, `false` if the entity was downloaded from OSM.
   */
  isNew() {
    return this.osmId() < 0;
  }

  /**
   * mergeTags
   * This merges the given tags into this Entity's existing tags.
   * When tags have different values, it attempts to convert them into a multi valued tag
   *   such as `key=val1;val2`, without overflowing the tag character limit.
   * @return  {OsmEntity}  A new Entity copied from this Entity, but with the updated tags
   */
  mergeTags(tags) {
    const merged = Object.assign({}, this.props.tags);  // copy
    let changed = false;
    for (let k in tags) {
      let t1 = merged[k];
      let t2 = tags[k];
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
   * hasParentRelations
   * Returns `true` if this Entity is a member of any parent Relations.
   * @param   {Graph}    graph - the Graph that holds the topology needed
   * @return  {boolean}  `true` if this Entity has parent Relations, `false` if not
   */
  hasParentRelations(graph) {
    return graph.parentRelations(this).length > 0;
  }

  /**
   * hasNonGeometryTags
   * Returns `true` if this Entity has tags other than `area=yes/no`.
   * @return  {boolean}  `true` if this Entity has non-geometry tags, `false` if not
   */
  hasNonGeometryTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (k !== 'area') return true;
    }
    return false;
  }

  /**
   * hasInterestingTags
   * By convention, some tags are more for storing metadata and can be safely ignored.
   * (For example, `source`, `created_by`, etc).
   * The list of these tags can be found in `osmIsInterestingTag`.
   * @return  {boolean}  `true` if this Entity has "interesting" tags, `false` if not
   */
  hasInterestingTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (osmIsInterestingTag(k)) return true;
    }
    return false;
  }

  /**
   * isHighwayIntersection
   * Is this Entity a highway intersection?
   * For most Entities this returns `false`, but is overridden in `OsmNode`.
   * @param   {Graph}    graph - the Graph that holds the topology needed
   * @return  {boolean}  `true` if this Entity is an intersection of parent highways, `false` if not
   * @abstract
   */
  isHighwayIntersection() {
    return false;
  }

  /**
   * isDegenerate
   * Each Entity has a way of checking whether it is degenerate (aka invalid) or not.
   * For generic Entities, this returns `true`, but should be overridden with proper logic in the derived classes.
   * @param   {Graph}    graph - the Graph that holds the topology needed
   * @return  {boolean}  `true` if this Entity is degenerate, `false` if not
   * @abstract
   */
  isDegenerate() {
    return true;
  }

}
