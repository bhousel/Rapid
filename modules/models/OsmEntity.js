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
 *   `props`  - Object containing properties (inherited from `AbstractData`)
 *   `tags`   - Object containing key-value string pairs for the OSM tags
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

    // Idea: Store tags in a proto-less object to avoid collisions with
    //  reserved words in JavaScript objects, see iD#3044
    // Good idea, but this won't survive `structuredClone` or other
    //  serialize/deserialize tricks like JSON.parse/JSON.stringify
    if (!this.props.tags) {
      // this.props.tags = Object.create(null);
      this.props.tags = {};
    }
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}     props - the updated properties
   * @return  {OsmEntity}  a new OsmEntity
   */
  update(props) {
    return new OsmEntity(this, props).touch();
  }

  /**
   * updateSelf
   * Like `update` but it modifies the current data element's properties in-place.
   * This will also update the data element's `v` internal version number.
   * `updateSelf` is slightly more performant for situations where you don't need
   * immutability and don't mind mutating the data element.
   *
   * A warning - this can circumvent `updateGeometry`.
   * So you shouldn't `updateSelf` for OsmNodes where to try to change it's `loc`.
   * And you shouldn't `updateSelf` for any entity after it has been added to a Graph.
   *
   * @param   {Object}     props - the updated properties
   * @return  {OsmEntity}  this same OsmEntity
   */
  updateSelf(props) {
    this.props = Object.assign(this.props, props);
    this.touch();
    return this;
  }

  /**
   * updateGeometry
   * OSM geometry can be complicated.
   * Nodes are easy because they represent a single coordinate.
   * But the other data types require topology information from a Graph.
   * This function allows the calling code to setup the geometry once the Graph is ready.
   * @param   {Graph}     graph - the Graph that holds the information needed
   * @return  {OsmEntity} this same OsmEntity
   * @abstract
   */
  updateGeometry(graph) {
    throw new Error(`Do not call 'updateGeometry' on OsmEntity`);
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
   * tags
   * Tags are the `key=value` pairs of strings that assign meaning to an OSM element.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Tag
   * @return {Object}
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
   * @return {boolean}
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
   * @return {string}
   */
  get version() {
    return this.props.version;
  }
  set version(val) {
    this.props.version = val;
  }


  static id = {
    next: { changeset: -1, node: -1, way: -1, relation: -1 }
  };

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

  osmId() {
    return OsmEntity.toOSM(this.props.id);
  }

  isNew() {
    return this.osmId() < 0;
  }

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

  hasParentRelations(graph) {
    return graph.parentRelations(this).length > 0;
  }

  hasNonGeometryTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (k !== 'area') return true;
    }
    return false;
  }

  hasInterestingTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (osmIsInterestingTag(k)) return true;
    }
    return false;
  }

  isHighwayIntersection() {
    return false;
  }

  isDegenerate() {
    return true;
  }

  // Convert the entity to a JSON in the format that we save to history backup
  asJSON() {
    return Object.assign({}, this.props);
  }

}
