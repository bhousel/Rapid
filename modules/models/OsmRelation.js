import { geoArea as d3_geoArea } from 'd3-geo';
import { Extent, geomPolygonContainsPolygon, geomPolygonIntersectsPolygon } from '@rapid-sdk/math';

import { OsmEntity } from './OsmEntity.js';
import { osmJoinWays } from './multipolygon.js';


/**
 * OsmRelation
 *
 */
export class OsmRelation extends OsmEntity {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'relation';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = `r${OsmEntity.id.next.relation--}`;
    }

    if (!this.props.members) {
      this.props.members = [];
    }

    // this._assignProps();
  }

  // /**
  //  * _assignProps
  //  * Some of the props we receive are special
  //  * We'll move them out of the props object into their own properties.
  //  */
  // _assignProps() {
  //   super._assignProps();

  //   if (this.props.members) {
  //     this.members = this.props.members.slice();  // copy
  //     delete this.props.members;
  //   }

  //   if (!Array.isArray(this.members)) {
  //     this.members = [];
  //   }
  //   if (!this.id) {  // no ID provided - generate one
  //     this.id = `w${OsmEntity.id.next.relation--}`;
  //   }
  // }

  /**
   * destroy
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  destroy() {
    super.destroy();
    // this.members = null;
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature
   * @param   {Object}    props
   * @return  this
   */
  update(props) {
    return new OsmRelation(this, props).touch();
  }


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


  /**
   * members
   * get/set the members property
   */
  get members() {
    return this.props.members;
  }
  // set members(val) {
  //   this.members = val || [];
  //   this.touch();
  // }



  // compare entities by their osm id (move to OsmEntity?)
  static creationOrder(a, b) {
    const aId = parseInt(OsmEntity.toOSM(a.id), 10);
    const bId = parseInt(OsmEntity.toOSM(b.id), 10);

    if (aId < 0 || bId < 0) return aId - bId;
    return bId - aId;
  };


  // `memo` keeps track of the "seen" entities, to avoid infinite looping
  extent(graph, memo) {
    return graph.transient(this, 'extent', () => {
      if (memo && memo[this.props.id]) return new Extent();
      memo = memo || {};
      memo[this.props.id] = true;

      const extent = new Extent();
      for (let i = 0; i < this.members.length; i++) {
        const member = graph.hasEntity(this.members[i].id);
        if (member) {
          extent.extendSelf(member.extent(graph, memo));
        }
      }
      return extent;
    });
  }


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


  asGeoJSON(graph) {
    return graph.transient(this, 'GeoJSON', () => {
      if (this.isMultipolygon()) {
        return {
          type: 'MultiPolygon',
          coordinates: this.multipolygon(graph)
        };
      } else {
        return {
          type: 'FeatureCollection',
          properties: this.tags,
          features: this.members.map(member => {
            return Object.assign({role: member.role}, graph.entity(member.id).asGeoJSON(graph));
          })
        };
      }
    });
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


// import { geoArea as d3_geoArea } from 'd3-geo';
// import { Extent, geomPolygonContainsPolygon, geomPolygonIntersectsPolygon } from '@rapid-sdk/math';

// import { osmEntity } from './entity.js';
// import { osmJoinWays } from './multipolygon.js';


// export function osmRelation() {
//     if (!(this instanceof osmRelation)) {
//         return (new osmRelation()).initialize(arguments);
//     } else if (arguments.length) {
//         this.initialize(arguments);
//     }
// }


// osmEntity.relation = osmRelation;

// osmRelation.prototype = Object.create(osmEntity.prototype);


// osmRelation.creationOrder = function(a, b) {
//     var aId = parseInt(osmEntity.id.toOSM(a.id), 10);
//     var bId = parseInt(osmEntity.id.toOSM(b.id), 10);

//     if (aId < 0 || bId < 0) return aId - bId;
//     return bId - aId;
// };


// Object.assign(osmRelation.prototype, {
//     type: 'relation',
//     members: [],


//     copy: function(resolver, copies) {
//         if (copies[this.id]) return copies[this.id];

//         var copy = osmEntity.prototype.copy.call(this, resolver, copies);

//         var members = this.members.map(function(member) {
//             return Object.assign({}, member, { id: resolver.entity(member.id).copy(resolver, copies).id });
//         });

//         copy = copy.update({members: members});
//         copies[this.id] = copy;

//         return copy;
//     },


//     extent: function(resolver, memo) {
//         return resolver.transient(this, 'extent', function() {
//             if (memo && memo[this.id]) return new Extent();
//             memo = memo || {};
//             memo[this.id] = true;

//             var extent = new Extent();
//             for (var i = 0; i < this.members.length; i++) {
//                 var member = resolver.hasEntity(this.members[i].id);
//                 if (member) {
//                     extent = extent.extend(member.extent(resolver, memo));
//                 }
//             }
//             return extent;
//         });
//     },
//     worldExtent: function(resolver, memo) {
//         return resolver.transient(this, 'worldExtent', function() {
//             if (memo && memo[this.id]) return new Extent();
//             memo = memo || {};
//             memo[this.id] = true;

//             var extent = new Extent();
//             for (var i = 0; i < this.members.length; i++) {
//                 var member = resolver.hasEntity(this.members[i].id);
//                 if (member) {
//                     extent = extent.extend(member.worldExtent(resolver, memo));
//                 }
//             }
//             return extent;
//         });
//     },


//     geometry: function(graph) {
//         return graph.transient(this, 'geometry', function() {
//             return this.isMultipolygon() ? 'area' : 'relation';
//         });
//     },


//     isDegenerate: function() {
//         return this.members.length === 0;
//     },


//     // Return an array of members, each extended with an 'index' property whose value
//     // is the member index.
//     indexedMembers: function() {
//         var result = new Array(this.members.length);
//         for (var i = 0; i < this.members.length; i++) {
//             result[i] = Object.assign({}, this.members[i], {index: i});
//         }
//         return result;
//     },


//     // Return the first member with the given role. A copy of the member object
//     // is returned, extended with an 'index' property whose value is the member index.
//     memberByRole: function(role) {
//         for (var i = 0; i < this.members.length; i++) {
//             if (this.members[i].role === role) {
//                 return Object.assign({}, this.members[i], {index: i});
//             }
//         }
//     },

//     // Same as memberByRole, but returns all members with the given role
//     membersByRole: function(role) {
//         var result = [];
//         for (var i = 0; i < this.members.length; i++) {
//             if (this.members[i].role === role) {
//                 result.push(Object.assign({}, this.members[i], {index: i}));
//             }
//         }
//         return result;
//     },

//     // Return the first member with the given id. A copy of the member object
//     // is returned, extended with an 'index' property whose value is the member index.
//     memberById: function(id) {
//         for (var i = 0; i < this.members.length; i++) {
//             if (this.members[i].id === id) {
//                 return Object.assign({}, this.members[i], {index: i});
//             }
//         }
//     },


//     // Return the first member with the given id and role. A copy of the member object
//     // is returned, extended with an 'index' property whose value is the member index.
//     memberByIdAndRole: function(id, role) {
//         for (var i = 0; i < this.members.length; i++) {
//             if (this.members[i].id === id && this.members[i].role === role) {
//                 return Object.assign({}, this.members[i], {index: i});
//             }
//         }
//     },


//     addMember: function(member, index) {
//         var members = this.members.slice();
//         members.splice(index === undefined ? members.length : index, 0, member);
//         return this.update({members: members});
//     },


//     updateMember: function(member, index) {
//         var members = this.members.slice();
//         members.splice(index, 1, Object.assign({}, members[index], member));
//         return this.update({members: members});
//     },


//     removeMember: function(index) {
//         var members = this.members.slice();
//         members.splice(index, 1);
//         return this.update({members: members});
//     },


//     removeMembersWithID: function(id) {
//         var members = this.members.filter(function(m) { return m.id !== id; });
//         return this.update({members: members});
//     },

//     moveMember: function(fromIndex, toIndex) {
//         var members = this.members.slice();
//         members.splice(toIndex, 0, members.splice(fromIndex, 1)[0]);
//         return this.update({members: members});
//     },


//     // Wherever a member appears with id `needle.id`, replace it with a member
//     // with id `replacement.id`, type `replacement.type`, and the original role,
//     // By default, adding a duplicate member (by id and role) is prevented.
//     // Return an updated relation.
//     replaceMember: function(needle, replacement, keepDuplicates) {
//         if (!this.memberById(needle.id)) return this;

//         var members = [];

//         for (var i = 0; i < this.members.length; i++) {
//             var member = this.members[i];
//             if (member.id !== needle.id) {
//                 members.push(member);
//             } else if (keepDuplicates || !this.memberByIdAndRole(replacement.id, member.role)) {
//                 members.push({ id: replacement.id, type: replacement.type, role: member.role });
//             }
//         }

//         return this.update({ members: members });
//     },


//     asJXON: function(changeset_id) {
//         var r = {
//             relation: {
//                 '@id': this.osmId(),
//                 '@version': this.version || 0,
//                 member: this.members.map(function(member) {
//                     return {
//                         keyAttributes: {
//                             type: member.type,
//                             role: member.role,
//                             ref: osmEntity.id.toOSM(member.id)
//                         }
//                     };
//                 }, this),
//                 tag: Object.keys(this.tags).map(function(k) {
//                     return { keyAttributes: { k: k, v: this.tags[k] } };
//                 }, this)
//             }
//         };
//         if (changeset_id) {
//             r.relation['@changeset'] = changeset_id;
//         }
//         return r;
//     },


//     asGeoJSON: function(resolver) {
//         return resolver.transient(this, 'GeoJSON', function () {
//             if (this.isMultipolygon()) {
//                 return {
//                     type: 'MultiPolygon',
//                     coordinates: this.multipolygon(resolver)
//                 };
//             } else {
//                 return {
//                     type: 'FeatureCollection',
//                     properties: this.tags,
//                     features: this.members.map(function (member) {
//                         return Object.assign({role: member.role}, resolver.entity(member.id).asGeoJSON(resolver));
//                     })
//                 };
//             }
//         });
//     },


//     area: function(resolver) {
//         return resolver.transient(this, 'area', function() {
//             return d3_geoArea(this.asGeoJSON(resolver));
//         });
//     },


//     isMultipolygon: function() {
//         return this.tags.type === 'multipolygon';
//     },


//     isComplete: function(resolver) {
//         for (var i = 0; i < this.members.length; i++) {
//             if (!resolver.hasEntity(this.members[i].id)) {
//                 return false;
//             }
//         }
//         return true;
//     },


//     hasFromViaTo: function() {
//         return (
//             this.members.some(function(m) { return m.role === 'from'; }) &&
//             this.members.some(function(m) { return m.role === 'via'; }) &&
//             this.members.some(function(m) { return m.role === 'to'; })
//         );
//     },


//     isRestriction: function() {
//         return !!(this.tags.type && this.tags.type.match(/^restriction:?/));
//     },


//     isValidRestriction: function() {
//         if (!this.isRestriction()) return false;

//         var froms = this.members.filter(function(m) { return m.role === 'from'; });
//         var vias = this.members.filter(function(m) { return m.role === 'via'; });
//         var tos = this.members.filter(function(m) { return m.role === 'to'; });

//         if (froms.length !== 1 && this.tags.restriction !== 'no_entry') return false;
//         if (froms.some(function(m) { return m.type !== 'way'; })) return false;

//         if (tos.length !== 1 && this.tags.restriction !== 'no_exit') return false;
//         if (tos.some(function(m) { return m.type !== 'way'; })) return false;

//         if (vias.length === 0) return false;
//         if (vias.length > 1 && vias.some(function(m) { return m.type !== 'way'; })) return false;

//         return true;
//     },

//     isConnectivity: function() {
//         return !!(this.tags.type && this.tags.type.match(/^connectivity:?/));
//     },

//     // Returns an array [A0, ... An], each Ai being an array of node arrays [Nds0, ... Ndsm],
//     // where Nds0 is an outer ring and subsequent Ndsi's (if any i > 0) being inner rings.
//     //
//     // This corresponds to the structure needed for rendering a multipolygon path using a
//     // `evenodd` fill rule, as well as the structure of a GeoJSON MultiPolygon geometry.
//     //
//     // In the case of invalid geometries, this function will still return a result which
//     // includes the nodes of all way members, but some Nds may be unclosed and some inner
//     // rings not matched with the intended outer ring.
//     //
//     multipolygon: function(resolver) {
//         var outers = this.members.filter(function(m) { return 'outer' === (m.role || 'outer'); });
//         var inners = this.members.filter(function(m) { return 'inner' === m.role; });

//         outers = osmJoinWays(outers, resolver);
//         inners = osmJoinWays(inners, resolver);

//         var sequenceToLineString = function(sequence) {
//             if (sequence.nodes.length > 2 &&
//                 sequence.nodes[0] !== sequence.nodes[sequence.nodes.length - 1]) {
//                 // close unclosed parts to ensure correct area rendering - #2945
//                 sequence.nodes.push(sequence.nodes[0]);
//             }
//             return sequence.nodes.map(function(node) { return node.loc; });
//         };

//         outers = outers.map(sequenceToLineString);
//         inners = inners.map(sequenceToLineString);

//         var result = outers.map(function(o) {
//             // Heuristic for detecting counterclockwise winding order. Assumes
//             // that OpenStreetMap polygons are not hemisphere-spanning.
//             return [d3_geoArea({ type: 'Polygon', coordinates: [o] }) > 2 * Math.PI ? o.reverse() : o];
//         });

//         function findOuter(inner) {
//             var o, outer;

//             for (o = 0; o < outers.length; o++) {
//                 outer = outers[o];
//                 if (geomPolygonContainsPolygon(outer, inner)) {
//                     return o;
//                 }
//             }

//             for (o = 0; o < outers.length; o++) {
//                 outer = outers[o];
//                 if (geomPolygonIntersectsPolygon(outer, inner, false)) {
//                     return o;
//                 }
//             }
//         }

//         for (var i = 0; i < inners.length; i++) {
//             var inner = inners[i];

//             if (d3_geoArea({ type: 'Polygon', coordinates: [inner] }) < 2 * Math.PI) {
//                 inner = inner.reverse();
//             }

//             var o = findOuter(inners[i]);
//             if (o !== undefined) {
//                 result[o].push(inners[i]);
//             } else {
//                 result.push([inners[i]]); // Invalid geometry
//             }
//         }

//         return result;
//     }
// });
