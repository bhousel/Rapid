import { geoArea as d3_geoArea } from 'd3-geo';
import { geomPolygonContainsPolygon, geomPolygonIntersectsPolygon } from '@rapid-sdk/math';

import { OsmEntity } from './OsmEntity.js';
import { osmJoinWays } from './multipolygon.js';


/**
 * OsmRelation
 * @see https://wiki.openstreetmap.org/wiki/Relation
 *
 * Properties you can access:
 *   `geoms`    Geometry object (inherited from `AbstractData`)
 *   `props`    Properties object (inherited from `AbstractData`)
 *   `tags`     Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 *   `members`  Accessor for the members property, an Array of Objects with properties, `id`, `type`, `role`
 */
export class OsmRelation extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'relation';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'r-' + this.context.next('relation');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    if (!this.props.members) {
      this.props.members = [];
    }
  }

  /**
   * members
   * get/set the members property
   * @readonly
   */
  get members() {
    return this.props.members;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmRelation.
   * Relations are represented by either:
   *  a Feature with MultiPolygon geometry, or
   *  a FeatureCollection containing the Relation's child members.
   * @param   {Graph}        graph - the Graph that holds the topology needed
   * @param   {Set<string>}  seen - seen ids, used to avoid infinite loops and cycles.
   * @return  {Object}       GeoJSON representation of the OsmRelation
   */
  asGeoJSON(graph, seen) {
    return this.transient('geojson', () => {

      if (this.isMultipolygon()) {
        return {
          type: 'Feature',
          id: this.id,
          properties: this.tags,
          geometry: {
            type: 'MultiPolygon',
            coordinates: this.multipolygon(graph)
          }
        };

      } else {  // Gather children into a FeatureCollection

        if (!seen) {
          seen = new Set();
        }
        if (seen.has(this.id)) {
          return {};  // seen this already, avoid infinite loops and cycles
        } else {
          seen.add(this.id);
        }

        const features = [];
        for (const member of this.members) {
          const entity = graph.hasEntity(member.id);
          if (!entity) continue;

          const child = entity.asGeoJSON(graph, seen);
          if (!Object.keys(child).length) continue;  // skip if empty

          child.role = member.role;  // `role` here is not GeoJSON spec
          features.push(child);
        }

        return {
          type: 'FeatureCollection',
          id: this.id,
          properties: this.tags,  // `properties` here is not GeoJSON spec
          features: features
        };
      }

    });
  }

  /**
   * asJXON
   * Returns a JXON representation of the OsmRelation.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param   {string}  changesetID - optional changeset ID to include in the output
   * @return  {Object}  JXON representation of the OsmRelation
   */
  asJXON(changesetID) {
    var result = {
      relation: {
        '@id': this.osmId(),
        '@version': this.props.version || 0,
        member: this.members.map(member => {
          return {
            keyAttributes: {
              type: member.type,
              role: member.role,
              ref: OsmEntity.toOSM(member.id)
            }
          };
        }, this),
        tag: Object.keys(this.tags).map(k => {
          return { keyAttributes: { k: k, v: this.tags[k] } };
        })
      }
    };
    if (changesetID) {
      result.relation['@changeset'] = changesetID;
    }
    return result;
  }


  /**
   * copy
   * Makes a (mostly) deep copy of an OSM Entity.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param   {Graph}        fromGraph - The Graph that owns the source object (needed for some data types)
   * @param   {Object}       memo      - An Object to store seen copies (to prevent circular/infinite copying)
   * @return  {OsmRelation}  a copy of this OsmRelation
   */
  copy(fromGraph, memo = {}) {
    if (memo[this.id]) {
      return memo[this.id];
    }

    // copy self
    const copy = new OsmRelation(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;

    // copy members too
    const members = [];
    for (const member of this.members) {
      const source = fromGraph.entity(member.id);
      const result = source.copy(fromGraph, memo);
      members.push(Object.assign({}, member, { id: result.id }));
    }
    copy.props.members = members;
    return copy;
  }


  /**
   * geometry
   * Returns 'area' if this Relation is a multipolygon, or 'relation' otherwise.
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {string}  'area' or 'relation'
   */
  geometry() {
    return this.transient('geometry', () => {
      return this.isMultipolygon() ? 'area' : 'relation';
    });
  }

  /**
   * isDegenerate
   * A relation is "degenerate" it has no members.
   * @return  {boolean}  `true` if the relation is degenerate, `false` if not.
   */
  isDegenerate() {
    return this.members.length === 0;
  }

  /**
   * indexedMembers
   * Return an array of members, each extended with an `index` property whose value
   * is the member index.
   * @return  {Array<Object>}  An Array of members, including an `index` property
   */
  indexedMembers() {
    const result = new Array(this.members.length);
    for (let i = 0; i < this.members.length; i++) {
      result[i] = Object.assign({}, this.members[i], { index: i });
    }
    return result;
  }

  /**
   * memberByRole
   * Return the first member with the given role. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param   {string}  The role to search for
   * @return  {Object}  The member with the given role, including an `index` property
   */
  memberByRole(role) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }

  /**
   * memberByRole
   * Same as `memberByRole`, but returns all members with the given role.
   * @param   {string}  The role to search for
   * @return  {Array<Object>}  An Array of members, including an `index` property
   */
  membersByRole(role) {
    const results = [];
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        results.push(Object.assign({}, this.members[i], { index: i }));
      }
    }
    return results;
  }

  /**
   * memberById
   * Return the first member with the given id. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param   {string}  The id to search for
   * @return  {Object}  The member with the given id, including an `index` property
   */
  memberById(id) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }

  /**
   * memberByIdAndRole
   * Return the first member with the given id and role. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param   {string}  The id to search for
   * @param   {string}  The role to search for
   * @return  {Object}  The member with the given id, including an `index` property
   */
  memberByIdAndRole(id, role) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id && this.members[i].role === role) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }

  /**
   * addMember
   * Inserts a member into the members list at the given index.
   * If index is undefined, the member will be added to the end of the members list.
   * @param   {Object}       member - the member to add
   * @param   {number}       index - the index to insert at, or `undefined`
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  addMember(member, index) {
    const members = this.members.slice();
    members.splice(index === undefined ? members.length : index, 0, member);
    return this.update({ members: members });
  }

  /**
   * updateMember
   * Replaces the member which is currently at the given index with the given member.
   * @param   {Object}       member - the member to add
   * @param   {number}       index - the index to replace
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  updateMember(member, index) {
    const members = this.members.slice();
    members.splice(index, 1, Object.assign({}, members[index], member));
    return this.update({ members: members });
  }

  /**
   * removeMember
   * Removes the member at the given index.
   * @param   {number}       index - the index to remove
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  removeMember(index) {
    const members = this.members.slice();
    members.splice(index, 1);
    return this.update({ members: members });
  }

  /**
   * removeMembersWithID
   * Removes any members from the member list with the given id.
   * @param   {string}       id - the id to search for
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  removeMembersWithID(id) {
    const members = this.members.filter(m => m.id !== id);
    return this.update({ members: members });
  }

  /**
   * moveMember
   * Moves a members from one index in the members list to another.
   * @param   {number}       fromIndex - the index to move it from
   * @param   {number}       toIndex   - the index to move it to
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  moveMember(fromIndex, toIndex) {
    const members = this.members.slice();
    members.splice(toIndex, 0, members.splice(fromIndex, 1)[0]);
    return this.update({ members: members });
  }

  /**
   * replaceMember
   * Wherever a member appears with id `needle.id`, replace it with a member
   * with id `replacement.id`, type `replacement.type`, and the original role,
   * By default, adding a duplicate member (by id and role) is prevented.
   * @param   {string}       needle - the member to find
   * @param   {string}       replacement - the member to replace it with
   * @param   {boolean}      keepDuplicates - `true` to preserve duplicate members
   * @return  {OsmRelation}  A new Relation copied from this Relation, but with the updated members list
   */
  replaceMember(needle, replacement, keepDuplicates) {
    if (!this.memberById(needle.id)) return this;

    const members = [];

    for (const member of this.members) {
      if (member.id !== needle.id) {
        members.push(member);
      } else if (keepDuplicates || !this.memberByIdAndRole(replacement.id, member.role)) {
        members.push({ id: replacement.id, type: replacement.type, role: member.role });
      }
    }

    return this.update({ members: members });
  }

  /**
   * area
   * This calculates an area for the given relation using d3_geoArea.
   * The result is in "steradians" (square radians).
   * (This should instead live in the Geometry/GeometryPart classes)
   * @see https://d3js.org/d3-geo/math#geoArea
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {number}  The area in square radians
   */
  area(graph) {
    return this.transient('area', () => {
      return d3_geoArea(this.asGeoJSON(graph));
    });
  }

  /**
   * isMultipolygon
   * Returns whether this relation is an OSM multipolygon, given the tags present.
   * @return  {boolean}  `true` if the relation is a multipolygon, `false` if not.
   */
  isMultipolygon() {
    return this.tags.type === 'multipolygon';
  }

  /**
   * isComplete
   * Returns whether this relation's members all exist in the given graph.
   * Because OSM Relations are downloaded lazily, the members may not all exist in the graph
   *  until the relation has been fully downloaded.
   * @param   {Graph}    graph - the Graph that holds the topology needed
   * @return  {boolean} `true` if the all members are present in the graph, `false` if not
   */
  isComplete(graph) {
    for (const member of this.members) {
      if (!graph.hasEntity(member.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * hasFromViaTo
   * Returns whether this relation has members with 'from', 'via', and 'to' roles.
   * These roles are required for `restriction` or `manoeuvre` relations.
   * @return  {boolean} `true` if the all members are present in the graph, `false` if not
   */
  hasFromViaTo() {
    return (
      this.members.some(m => m.role === 'from') &&
      this.members.some(m => m.role === 'via') &&
      this.members.some(m => m.role === 'to')
    );
  }

  /**
   * isConnectivity
   * Returns whether this relation is a 'connectivity' relation, given the tags present.
   * @return  {boolean}  `true` if the relation is a connectivity relation, `false` if not.
   */
  isConnectivity() {
    return /^connectivity:?/.test(this.tags.type);
  }

  /**
   * isRestriction
   * Returns whether this relation is a 'restriction' relation, given the tags present.
   * @return  {boolean}  `true` if the relation is a restriction relation, `false` if not.
   */
  isRestriction() {
    return /^restriction:?/.test(this.tags.type);
  }

  /**
   * isValidRestriction
   * Returns whether this relation is a valid 'restriction' relation, given the tags present.
   * Valid restrictions have a 'restriction' type and an appropriate amount of 'from', 'via', 'to' members.
   * @return  {boolean}  `true` if the relation is a valid restriction relation, `false` if not.
   */
  isValidRestriction() {
    if (!this.isRestriction()) return false;

    const froms = this.members.filter(m => m.role === 'from');
    const vias = this.members.filter(m => m.role === 'via');
    const tos = this.members.filter(m => m.role === 'to');

    if (froms.length !== 1 && this.tags.restriction !== 'no_entry') return false;
    if (froms.some(m => m.type !== 'way')) return false;

    if (tos.length !== 1 && this.tags.restriction !== 'no_exit') return false;
    if (tos.some(m => m.type !== 'way')) return false;

    if (vias.length === 0) return false;
    if (vias.length > 1 && vias.some(m => m.type !== 'way')) return false;

    return true;
  }

  /**
   * multipolygon
   * Returns an array `[A0, ... An]`, each `Ai` being an array of node arrays `[Nds0, ... Ndsm]`,
   * where `Nds0` is an outer ring and subsequent `Ndsi's` (if any i > 0) being inner rings.
   *
   * This corresponds to the structure needed for rendering a multipolygon path using a
   * `evenodd` fill rule, as well as the structure of a GeoJSON MultiPolygon geometry.
   *
   * In the case of invalid geometries, this function will still return a result which
   * includes the nodes of all way members, but some `Nds` may be unclosed and some inner
   * rings not matched with the intended outer ring.
   *
   * @param   {Graph}    graph - the Graph that holds the topology needed
   * @return  {Array<Array<number>>}  An array of closed rings
   */
  multipolygon(graph) {
    let outers = this.members.filter(m => 'outer' === (m.role || 'outer'));
    let inners = this.members.filter(m => 'inner' === m.role);

    outers = osmJoinWays(outers, graph);
    inners = osmJoinWays(inners, graph);

    function sequenceToLineString(sequence) {
      // close unclosed parts to ensure correct area rendering - iD#2945
      if (sequence.nodes.length > 2 && sequence.nodes.at(0) !== sequence.nodes.at(-1)) {
        sequence.nodes.push(sequence.nodes.at(0));
      }
      return sequence.nodes.map(node => node.loc);
    }

    outers = outers.map(sequenceToLineString);
    inners = inners.map(sequenceToLineString);

    const result = outers.map(o => {
      // Heuristic for detecting counterclockwise winding order. Assumes
      // that OpenStreetMap polygons are not hemisphere-spanning.
      return [d3_geoArea({ type: 'Polygon', coordinates: [o] }) > 2 * Math.PI ? o.reverse() : o];
    });

    function findOuter(inner) {
      let o, outer;
      for (o = 0; o < outers.length; o++) {
        outer = outers[o];
        if (geomPolygonContainsPolygon(outer, inner)) {
          return o;
        }
      }

      for (o = 0; o < outers.length; o++) {
        outer = outers[o];
        if (geomPolygonIntersectsPolygon(outer, inner, false)) {
          return o;
        }
      }
    }

    for (let i = 0; i < inners.length; i++) {
      let inner = inners[i];

      if (d3_geoArea({ type: 'Polygon', coordinates: [inner] }) < 2 * Math.PI) {
        inner = inner.reverse();
      }

      const o = findOuter(inners[i]);
      if (o !== undefined) {
        result[o].push(inners[i]);
      } else {
        result.push([inners[i]]); // Invalid geometry
      }
    }

    return result;
  }

}
