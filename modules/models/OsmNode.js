import { RAD2DEG, vecAngle } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';
import { OsmEntity } from './OsmEntity.js';


/**
 * OsmNode
 * @see https://wiki.openstreetmap.org/wiki/Node
 *
 * Properties you can access:
 *   `props`  - Object containing Feature properties (inherited from `AbstractFeature`)
 *   `tags`   - Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 *   `loc`    - Accessor for the `geometry`, used to get WGS84 coords
 */
export class OsmNode extends OsmEntity {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'node';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = `n${OsmEntity.id.next.node--}`;
    }
    if (!this.props.loc) {
      this.props.loc = [9999, 9999];  // (Need a dummy loc so that Difference will work)
    }
    this.geom.setCoords(this.props.loc);
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature.
   * Features are intended to be immutable.  To modify them a Feature,
   *  pass in the properties to change, and you'll get a new Feature.
   * The new Feature will have an updated `v` internal version number.
   * @param   {Object}   props - the updated properties
   * @return  {OsmNode}  a new OsmNode
   */
  update(props) {
    return new OsmNode(this, props).touch();
  }

  /**
   * loc
   * get/set the loc from the geometry object
   * @readonly
   */
  get loc() {
    return this.geom.origCoords;
  }

  /**
   * extent
   * Get the Extent from the geometry object
   * @param  {Graph}  graph
   * @return {Extent}
   */
  extent(graph) {
    // return graph.transient(this, 'extent', () => {
      // return new Extent(this.loc);
// setup the geometry here (for now)
      // this.geom.setCoords(this.props.loc);
      return this.geom.origExtent;
    // });
  }


  geometry(graph) {
    return graph.transient(this, 'geometry', function() {
      return graph.isPoi(this) ? 'point' : 'vertex';
    });
  }


  move(loc) {
    return this.update({ loc: loc });
  }


  isDegenerate() {
    const loc = this.loc;
    return !(
      Array.isArray(loc) && loc.length === 2 &&
      loc[0] >= -180 && loc[0] <= 180 &&
      loc[1] >= -90 && loc[1] <= 90
    );
  }


  // Inspect tags and geometry to determine which direction(s) this node/vertex points
  directions(graph) {
    let val;

    // which tag to use?
    if (this.isHighwayIntersection(graph) && (this.tags.stop || '').toLowerCase() === 'all') {
      // all-way stop tag on a highway intersection
      val = 'all';

    } else {
      // Generic `direction` tag
      val = (this.tags.direction || '').toLowerCase();

      // Look for a better suffix-style `*:direction` tag
      const re = /:direction$/i;
      for (const [k, v] of Object.entries(this.tags)) {
        if (re.test(k)) {
          val = v.toLowerCase();
          break;
        }
      }
    }

    if (val === '') return [];

    const cardinal = {
      north: 0,             n: 0,
      northnortheast: 22,   nne: 22,
      northeast: 45,        ne: 45,
      eastnortheast: 67,    ene: 67,
      east: 90,             e: 90,
      eastsoutheast: 112,   ese: 112,
      southeast: 135,       se: 135,
      southsoutheast: 157,  sse: 157,
      south: 180,           s: 180,
      southsouthwest: 202,  ssw: 202,
      southwest: 225,       sw: 225,
      westsouthwest: 247,   wsw: 247,
      west: 270,            w: 270,
      westnorthwest: 292,   wnw: 292,
      northwest: 315,       nw: 315,
      northnorthwest: 337,  nnw: 337
    };


    const vals = val.split(';');
    const results = [];

    for (let v of vals) {
      // swap cardinal for numeric directions
      if (cardinal[v] !== undefined) {
        v = cardinal[v];
      }

      // `v` looks like a numeric direction - just append to results
      if (v !== '' && !isNaN(+v)) {
        results.push(+v);
        continue;
      }

      // `v` looks like a string direction - look at nearby nodes
      const lookBackward = (this.tags['traffic_sign:backward'] || v === 'backward' || v === 'both' || v === 'all');
      const lookForward = (this.tags['traffic_sign:forward'] || v === 'forward' || v === 'both' || v === 'all');
      if (!lookForward && !lookBackward) continue;

      // Gather nodes to look at
      const nodeIDs = new Set();
      for (const parent of graph.parentWays(this)) {
        if (parent.geometry(graph) !== 'line') continue;
        if (!(parent.tags.highway || parent.tags.railway || parent.tags.waterway || parent.tags.aeroway)) continue;  // not routable?

        const nodes = parent.nodes;
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i] === this.id) {   // match current node
            if (lookForward && i > 0) {
              nodeIDs.add(nodes[i - 1]);  // look back to prev node
            }
            if (lookBackward && i < nodes.length - 1) {
              nodeIDs.add(nodes[i + 1]);  // look ahead to next node
            }
          }
        }
      }

      for (const nodeID of nodeIDs) {
// using loc
//        const a = viewport.project(this.loc);
//        const b = viewport.project(graph.entity(nodeID).loc);
//        results.push( (vecAngle(a, b) * 180 / Math.PI) + 90 );
// using world coords - no projection!
        // +90 because vecAngle returns angle from X axis, not Y (north)
        const a = this.geom.coords;
        const b = (graph.entity(nodeID).geom.coords);
        if (a === null || b === null) continue;
        results.push((vecAngle(a, b) * RAD2DEG) + 90);
      }
    }

    return utilArrayUniq(results).sort((a, b) => a - b);
  }


  isCrossing() {
    return this.tags.highway === 'crossing' || this.tags.railway?.includes('crossing');
  }

  isEndpoint(graph) {
    return graph.transient(this, 'isEndpoint', () => {
      const id = this.id;
      return graph.parentWays(this).filter(parent => {
        return !parent.isClosed() && !!parent.affix(id);
      }).length > 0;
    });
  }

  isConnected(graph) {
    return graph.transient(this, 'isConnected', () => {
      const parents = graph.parentWays(this);

      if (parents.length > 1) {  // vertex is connected to multiple parent ways
        for (let i in parents) {
          if (parents[i].geometry(graph) === 'line' && parents[i].hasInterestingTags()) return true;
        }
      } else if (parents.length === 1) {
        const way = parents[0];
        const nodes = way.nodes.slice();
        if (way.isClosed()) { nodes.pop(); }  // ignore connecting node if closed

        // return true if vertex appears multiple times (way is self intersecting)
        return nodes.indexOf(this.id) !== nodes.lastIndexOf(this.id);
      }

      return false;
    });
  }


  parentIntersectionWays(graph) {
    return graph.transient(this, 'parentIntersectionWays', () => {
      return graph.parentWays(this).filter(parent => {
        return (parent.tags.highway ||
          parent.tags.waterway ||
          parent.tags.railway ||
          parent.tags.aeroway) &&
          parent.geometry(graph) === 'line';
      });
    });
  }


  isIntersection(graph) {
    return this.parentIntersectionWays(graph).length > 1;
  }


  isHighwayIntersection(graph) {
    return graph.transient(this, 'isHighwayIntersection', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.highway && parent.geometry(graph) === 'line';
      }).length > 1;
    });
  }


  isOnAddressLine(graph) {
    return graph.transient(this, 'isOnAddressLine', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.hasOwnProperty('addr:interpolation') && parent.geometry(graph) === 'line';
      }).length > 0;
    });
  }


  asJXON(changesetID) {
    const result = {
      node: {
        '@id': this.osmId(),
        '@lon': this.loc[0],
        '@lat': this.loc[1],
        '@version': (this.props.version || 0),
        tag: Object.keys(this.tags).map(k => {
          return { keyAttributes: { k: k, v: this.tags[k] } };
        })
      }
    };
    if (changesetID) {
      result.node['@changeset'] = changesetID;
    }
    return result;
  }


  asGeoJSON() {
    return {
      type: 'Point',
      coordinates: this.loc
    };
  }

  // Convert the entity to a JSON in the format that we save to history backup
  asJSON() {
    return Object.assign({}, this.props, { loc: this.loc });
  }

}




// import { Extent, vecAngle } from '@rapid-sdk/math';
// import { utilArrayUniq } from '@rapid-sdk/util';

// import { osmEntity } from './entity.js';


// export function osmNode() {
//     if (!(this instanceof osmNode)) {
//         return (new osmNode()).initialize(arguments);
//     } else if (arguments.length) {
//         this.initialize(arguments);
//     }
// }

// osmEntity.node = osmNode;

// osmNode.prototype = Object.create(osmEntity.prototype);

// Object.assign(osmNode.prototype, {
//     type: 'node',
//     loc: [9999, 9999],
//     worldLoc: [9999, 9999],

//     extent: function() {
//         return new Extent(this.loc);
//     },
//     worldExtent: function() {
//         return new Extent(this.worldLoc);
//     },


//     geometry: function(graph) {
//         return graph.transient(this, 'geometry', function() {
//             return graph.isPoi(this) ? 'point' : 'vertex';
//         });
//     },


//     move: function(loc) {
//         return this.update({loc: loc});
//     },


//     isDegenerate: function() {
//         return !(
//             Array.isArray(this.loc) && this.loc.length === 2 &&
//             this.loc[0] >= -180 && this.loc[0] <= 180 &&
//             this.loc[1] >= -90 && this.loc[1] <= 90
//         );
//     },


//     // Inspect tags and geometry to determine which direction(s) this node/vertex points
//     directions: function(resolver, viewport) {
//       let val;

//       // which tag to use?
//       if (this.isHighwayIntersection(resolver) && (this.tags.stop || '').toLowerCase() === 'all') {
//         // all-way stop tag on a highway intersection
//         val = 'all';

//       } else {
//         // Generic `direction` tag
//         val = (this.tags.direction || '').toLowerCase();

//         // Look for a better suffix-style `*:direction` tag
//         const re = /:direction$/i;
//         for (const [k, v] of Object.entries(this.tags)) {
//           if (re.test(k)) {
//             val = v.toLowerCase();
//             break;
//           }
//         }
//       }

//       if (val === '') return [];

//       const cardinal = {
//         north: 0,             n: 0,
//         northnortheast: 22,   nne: 22,
//         northeast: 45,        ne: 45,
//         eastnortheast: 67,    ene: 67,
//         east: 90,             e: 90,
//         eastsoutheast: 112,   ese: 112,
//         southeast: 135,       se: 135,
//         southsoutheast: 157,  sse: 157,
//         south: 180,           s: 180,
//         southsouthwest: 202,  ssw: 202,
//         southwest: 225,       sw: 225,
//         westsouthwest: 247,   wsw: 247,
//         west: 270,            w: 270,
//         westnorthwest: 292,   wnw: 292,
//         northwest: 315,       nw: 315,
//         northnorthwest: 337,  nnw: 337
//       };


//       const vals = val.split(';');
//       const results = [];

//       for (let v of vals) {
//         // swap cardinal for numeric directions
//         if (cardinal[v] !== undefined) {
//           v = cardinal[v];
//         }

//         // `v` looks like a numeric direction - just append to results
//         if (v !== '' && !isNaN(+v)) {
//           results.push(+v);
//           continue;
//         }

//         // `v` looks like a string direction - look at nearby nodes
//         const lookBackward = (this.tags['traffic_sign:backward'] || v === 'backward' || v === 'both' || v === 'all');
//         const lookForward = (this.tags['traffic_sign:forward'] || v === 'forward' || v === 'both' || v === 'all');
//         if (!lookForward && !lookBackward) continue;

//         // Gather nodes to look at
//         const nodeIDs = new Set();
//         for (const parent of resolver.parentWays(this)) {
//           if (parent.geometry(resolver) !== 'line') continue;
//           if (!(parent.tags.highway || parent.tags.railway || parent.tags.waterway || parent.tags.aeroway)) continue;  // not routable?

//           const nodes = parent.nodes;
//           for (let i = 0; i < nodes.length; i++) {
//             if (nodes[i] === this.id) {   // match current node
//               if (lookForward && i > 0) {
//                 nodeIDs.add(nodes[i - 1]);  // look back to prev node
//               }
//               if (lookBackward && i < nodes.length - 1) {
//                 nodeIDs.add(nodes[i + 1]);  // look ahead to next node
//               }
//             }
//           }
//         }

//         for (const nodeID of nodeIDs) {
//           // +90 because vecAngle returns angle from X axis, not Y (north)
//           const a = viewport.project(this.loc);
//           const b = viewport.project(resolver.entity(nodeID).loc);
//           results.push( (vecAngle(a, b) * 180 / Math.PI) + 90 );
//         }
//       }

//       return utilArrayUniq(results).sort((a, b) => a - b);
//     },


//     isCrossing: function(){
//         return this.tags.highway === 'crossing' ||
//                this.tags.railway && this.tags.railway.indexOf('crossing') !== -1;
//     },

//     isEndpoint: function(resolver) {
//         return resolver.transient(this, 'isEndpoint', function() {
//             var id = this.id;
//             return resolver.parentWays(this).filter(function(parent) {
//                 return !parent.isClosed() && !!parent.affix(id);
//             }).length > 0;
//         });
//     },


//     isConnected: function(resolver) {
//         return resolver.transient(this, 'isConnected', function() {
//             var parents = resolver.parentWays(this);

//             if (parents.length > 1) {
//                 // vertex is connected to multiple parent ways
//                 for (var i in parents) {
//                     if (parents[i].geometry(resolver) === 'line' &&
//                         parents[i].hasInterestingTags()) return true;
//                 }
//             } else if (parents.length === 1) {
//                 var way = parents[0];
//                 var nodes = way.nodes.slice();
//                 if (way.isClosed()) { nodes.pop(); }  // ignore connecting node if closed

//                 // return true if vertex appears multiple times (way is self intersecting)
//                 return nodes.indexOf(this.id) !== nodes.lastIndexOf(this.id);
//             }

//             return false;
//         });
//     },


//     parentIntersectionWays: function(resolver) {
//         return resolver.transient(this, 'parentIntersectionWays', function() {
//             return resolver.parentWays(this).filter(function(parent) {
//                 return (parent.tags.highway ||
//                     parent.tags.waterway ||
//                     parent.tags.railway ||
//                     parent.tags.aeroway) &&
//                     parent.geometry(resolver) === 'line';
//             });
//         });
//     },


//     isIntersection: function(resolver) {
//         return this.parentIntersectionWays(resolver).length > 1;
//     },


//     isHighwayIntersection: function(resolver) {
//         return resolver.transient(this, 'isHighwayIntersection', function() {
//             return resolver.parentWays(this).filter(function(parent) {
//                 return parent.tags.highway && parent.geometry(resolver) === 'line';
//             }).length > 1;
//         });
//     },


//     isOnAddressLine: function(resolver) {
//         return resolver.transient(this, 'isOnAddressLine', function() {
//             return resolver.parentWays(this).filter(function(parent) {
//                 return parent.tags.hasOwnProperty('addr:interpolation') &&
//                     parent.geometry(resolver) === 'line';
//             }).length > 0;
//         });
//     },


//     asJXON: function(changeset_id) {
//         var r = {
//             node: {
//                 '@id': this.osmId(),
//                 '@lon': this.loc[0],
//                 '@lat': this.loc[1],
//                 '@version': (this.version || 0),
//                 tag: Object.keys(this.tags).map(function(k) {
//                     return { keyAttributes: { k: k, v: this.tags[k] } };
//                 }, this)
//             }
//         };
//         if (changeset_id) r.node['@changeset'] = changeset_id;
//         return r;
//     },


//     asGeoJSON: function() {
//         return {
//             type: 'Point',
//             coordinates: this.loc
//         };
//     }
// });
