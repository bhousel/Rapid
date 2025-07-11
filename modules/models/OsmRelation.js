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
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}       props - the updated properties
   * @return  {OsmRelation}  a new OsmRelation
   */
  update(props) {
    return new OsmRelation(this, props).touch();
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmRelation.
   * Relations are represented by either:
   *  a Feature with MultiPolygon geometry, or
   *  a FeatureCollection containing the Relation's child members.
   * @param   {Graph}        graph - the Graph that holds the information needed
   * @param   {Set<string>}  seen - seen ids, used to avoid infinite loops and cycles.
   * @return  {Object}       GeoJSON representation of the OsmRelation
   */
  asGeoJSON(graph, seen) {
    return graph.transient(this, 'geojson', () => {

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

    return copy.updateSelf({ members: members });
  }


  // compare entities by their osm id (move to OsmEntity?)
  static creationOrder(a, b) {
    const aId = parseInt(OsmEntity.toOSM(a.id), 10);
    const bId = parseInt(OsmEntity.toOSM(b.id), 10);

    if (aId < 0 || bId < 0) return aId - bId;
    return bId - aId;
  };


  geometry(graph) {
    return graph.transient(this, 'geometry', () => {
      return this.isMultipolygon() ? 'area' : 'relation';
    });
  }


  isDegenerate() {
    return this.members.length === 0;
  }


  // Return an array of members, each extended with an 'index' property whose value
  // is the member index.
  indexedMembers() {
    const result = new Array(this.members.length);
    for (let i = 0; i < this.members.length; i++) {
      result[i] = Object.assign({}, this.members[i], { index: i });
    }
    return result;
  }


  // Return the first member with the given role. A copy of the member object
  // is returned, extended with an 'index' property whose value is the member index.
  memberByRole(role) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }


  // Same as memberByRole, but returns all members with the given role
  membersByRole(role) {
    const result = [];
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        result.push(Object.assign({}, this.members[i], { index: i }));
      }
    }
    return result;
  }


  // Return the first member with the given id. A copy of the member object
  // is returned, extended with an 'index' property whose value is the member index.
  memberById(id) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }


  // Return the first member with the given id and role. A copy of the member object
  // is returned, extended with an 'index' property whose value is the member index.
  memberByIdAndRole(id, role) {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id && this.members[i].role === role) {
        return Object.assign({}, this.members[i], { index: i });
      }
    }
  }


  addMember(member, index) {
    const members = this.members.slice();
    members.splice(index === undefined ? members.length : index, 0, member);
    return this.update({ members: members });
  }

  updateMember(member, index) {
    const members = this.members.slice();
    members.splice(index, 1, Object.assign({}, members[index], member));
    return this.update({ members: members });
  }

  removeMember(index) {
    const members = this.members.slice();
    members.splice(index, 1);
    return this.update({ members: members });
  }

  removeMembersWithID(id) {
    const members = this.members.filter(m => m.id !== id);
    return this.update({ members: members });
  }

  moveMember(fromIndex, toIndex) {
    const members = this.members.slice();
    members.splice(toIndex, 0, members.splice(fromIndex, 1)[0]);
    return this.update({ members: members });
  }


  // Wherever a member appears with id `needle.id`, replace it with a member
  // with id `replacement.id`, type `replacement.type`, and the original role,
  // By default, adding a duplicate member (by id and role) is prevented.
  // Return an updated relation.
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

  area(graph) {
    return graph.transient(this, 'area', () => {
      return d3_geoArea(this.asGeoJSON(graph));
    });
  }

  isMultipolygon() {
    return this.tags.type === 'multipolygon';
  }


  isComplete(graph) {
    for (const member of this.members) {
      if (!graph.hasEntity(member.id)) {
        return false;
      }
    }
    return true;
  }


  hasFromViaTo() {
    return (
      this.members.some(m => m.role === 'from') &&
      this.members.some(m => m.role === 'via') &&
      this.members.some(m => m.role === 'to')
    );
  }


  isConnectivity() {
    return /^connectivity:?/.test(this.tags.type);
  }

  isRestriction() {
    return /^restriction:?/.test(this.tags.type);
  }

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


  // Returns an array [A0, ... An], each Ai being an array of node arrays [Nds0, ... Ndsm],
  // where Nds0 is an outer ring and subsequent Ndsi's (if any i > 0) being inner rings.
  //
  // This corresponds to the structure needed for rendering a multipolygon path using a
  // `evenodd` fill rule, as well as the structure of a GeoJSON MultiPolygon geometry.
  //
  // In the case of invalid geometries, this function will still return a result which
  // includes the nodes of all way members, but some Nds may be unclosed and some inner
  // rings not matched with the intended outer ring.
  //
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
