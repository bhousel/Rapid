import { geoArea as d3_geoArea } from 'd3-geo';
import { Extent, vecCross } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';

import { OsmEntity } from './OsmEntity.js';
import { osmLanes } from './lanes.js';
import { osmTagSuggestingArea, osmOneWayTags, osmRightSideIsInsideTags, osmRemoveLifecyclePrefix } from './tags.js';
import { utilTotalExtent } from '../util/index.js';


// Filter function to eliminate consecutive duplicates.
function noRepeatNodes(node, i, arr) {
  return i === 0 || node !== arr[i - 1];
}


/**
 * OsmWay
 * @see https://wiki.openstreetmap.org/wiki/Way
 *
 * Properties you can access:
 *   `props`  - Object containing Feature properties (inherited from `AbstractFeature`)
 *   `tags`   - Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 *   `nodes`  - Accessor for the nodes, an Array of node ids
 */
export class OsmWay extends OsmEntity {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'way';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = `w${OsmEntity.id.next.way--}`;
    }

    if (!this.props.nodes) {
      this.props.nodes = [];
    }
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature.
   * Features are intended to be immutable.  To modify them a Feature,
   *  pass in the properties to change, and you'll get a new Feature.
   * The new Feature will have an updated `v` internal version number.
   * @param   {Object}  props - the updated properties
   * @return  {OsmWay}  a new OsmWay
   */
  update(props) {
    return new OsmWay(this, props).touch();
  }

  /**
   * copy
   * Makes a (mostly) deep copy of a feature.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param   {Graph}   fromGraph - The Graph that owns the source object (needed for some data types)
   * @param   {Object}  memo      - An Object to store seen copies (to prevent circular/infinite copying)
   * @return  {OsmWay}  a copy of this OsmWay
   */
  copy(fromGraph, memo = {}) {
    if (memo[this.id]) {
      return memo[this.id];
    }

    // copy self
    const copy = new OsmWay(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;

    // copy nodes too
    const nodes = [];
    for (const nodeID of this.nodes) {
      const source = fromGraph.entity(nodeID);
      const result = source.copy(fromGraph, memo);
      nodes.push(result.id);
    }

    return copy.updateSelf({ nodes: nodes });
  }

  /**
   * nodes
   * get/set the nodes property
   * @readonly
   */
  get nodes() {
    return this.props.nodes;
  }

  /**
   * extent
   * Get the Extent from the geometry object
   * @param  {Graph}  graph
   * @return {Extent}
   */
  extent(graph) {
    return graph.transient(this, 'extent', () => {
      // return utilTotalExtent(this.nodes, graph);
// setup the geometry here (for now) - borrowed from asGeoJSON():
      const coords = [];
      for (const nodeID of this.nodes) {
        const node = graph.hasEntity(nodeID);
        if (node) {
          coords.push(node.loc);
        }
      }
      if (this.isArea() && this.isClosed()) {
        this.geom.setCoords([coords]);
      } else {
        this.geom.setCoords(coords);
      }

      return this.geom.origExtent;
    });
  }

  first() {
    return this.nodes.at(0);
  }

  last() {
    return this.nodes.at(-1);
  }

  contains(nodeID) {
    return this.nodes.includes(nodeID);
  }

  affix(nodeID) {
    if (this.nodes.at(0) === nodeID) return 'prefix';
    if (this.nodes.at(-1) === nodeID) return 'suffix';
  }

  layer() {
// TODO - we should stop doing this, it's a holdover from when iD used SVG groups for this.
    // explicit layer tag, clamp between -10, 10..
    if (isFinite(this.tags.layer)) {
      return Math.max(-10, Math.min(+(this.tags.layer), 10));
    }

    // implied layer tag..
    if (this.tags.covered === 'yes') return -1;
    if (this.tags.location === 'overground') return 1;
    if (this.tags.location === 'underground') return -1;
    if (this.tags.location === 'underwater') return -10;

    if (this.tags.power === 'line') return 10;
    if (this.tags.power === 'minor_line') return 10;
    if (this.tags.aerialway) return 10;
    if (this.tags.bridge) return 1;
    if (this.tags.cutting) return -1;
    if (this.tags.tunnel) return -1;
    if (this.tags.waterway) return -1;
    if (this.tags.man_made === 'pipeline') return -10;
    if (this.tags.boundary) return -10;
    return 0;
  }


  // The approximate width of the line based on its tags except its `width` tag
  impliedLineWidthMeters() {
    const averageWidths = {
      highway: { // width is for single lane
        motorway: 5, motorway_link: 5, trunk: 4.5, trunk_link: 4.5,
        primary: 4, secondary: 4, tertiary: 4,
        primary_link: 4, secondary_link: 4, tertiary_link: 4,
        unclassified: 4, road: 4, living_street: 4, bus_guideway: 4, pedestrian: 4,
        residential: 3.5, service: 3.5, track: 3, cycleway: 2.5,
        bridleway: 2, corridor: 2, steps: 2, path: 1.5, footway: 1.5
      },
      railway: { // width includes ties and rail bed, not just track gauge
        rail: 2.5, light_rail: 2.5, tram: 2.5, subway: 2.5,
        monorail: 2.5, funicular: 2.5, disused: 2.5, preserved: 2.5,
        miniature: 1.5, narrow_gauge: 1.5
      },
      waterway: {
        river: 50, canal: 25, stream: 5, tidal_channel: 5, fish_pass: 2.5, drain: 2.5, ditch: 1.5
      }
    };

    for (const [k, group] of Object.entries(averageWidths)) {
      const v = this.tags[k];
      let width = v && group[v];
      if (width) {
        if (k === 'highway') {
          let laneCount = this.tags.lanes && parseInt(this.tags.lanes, 10);
          if (!laneCount) {
            laneCount = this.isOneWay() ? 1 : 2;
          }
          return width * laneCount;
        }
        return width;
      }
    }
    return null;
  }


  isOneWay() {
    // explicit oneway tag..
    const values = {
      'yes': true,
      '1': true,
      '-1': true,
      'reversible': true,
      'alternating': true,
      'no': false,
      '0': false
    };
    if (values[this.tags.oneway] !== undefined) {
      return values[this.tags.oneway];
    }

    // implied oneway tag..
    for (var key in this.tags) {
      if (key in osmOneWayTags &&
        (this.tags[key] in osmOneWayTags[key])) {
        return true;
      }
    }
    return false;
  }


  // Some identifier for tag that implies that this way is "sided",
  // i.e. the right side is the 'inside' (e.g. the right side of a
  // natural=cliff is lower).
  sidednessIdentifier() {
    for (const realKey in this.tags) {
      const value = this.tags[realKey];
      const key = osmRemoveLifecyclePrefix(realKey);
      if (key in osmRightSideIsInsideTags && (value in osmRightSideIsInsideTags[key])) {
        if (osmRightSideIsInsideTags[key][value] === true) {
          return key;
        } else {
          // if the value is something other than a literal true, we should use it so we can
          // special case some keys (e.g. natural=coastline is handled differently to other naturals).
          return osmRightSideIsInsideTags[key][value];
        }
      }
    }

    return null;
  }


  isSided() {
    if (this.tags.two_sided === 'yes') {
      return false;
    }

    return this.sidednessIdentifier() !== null;
  }

  lanes() {
    return osmLanes(this);
  }


  isClosed() {
    return this.nodes.length > 1 && this.first() === this.last();
  }


  isConvex(graph) {
    if (!this.isClosed() || this.isDegenerate()) return null;

    const nodes = utilArrayUniq(graph.childNodes(this));
    const coords = nodes.map(node => node.loc);
    let curr = 0;
    let prev = 0;

    for (let i = 0; i < coords.length; i++) {
      const o = coords[(i+1) % coords.length];
      const a = coords[i];
      const b = coords[(i+2) % coords.length];
      const res = vecCross(a, b, o);

      curr = (res > 0) ? 1 : (res < 0) ? -1 : 0;
      if (curr === 0) {
        continue;
      } else if (prev && curr !== prev) {
        return false;
      }
      prev = curr;
    }
    return true;
  }

  // returns an object with the tag that implies this is an area, if any
  tagSuggestingArea() {
    return osmTagSuggestingArea(this.tags);
  }

  isArea() {
    if (this.tags.area === 'yes') return true;
    if (!this.isClosed() || this.tags.area === 'no') return false;
    return this.tagSuggestingArea() !== null;
  }

  isDegenerate() {
    return (new Set(this.nodes).size < (this.isClosed() ? 3 : 2));
  }

  areAdjacent(n1, n2) {
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i] === n1) {
        if (this.nodes[i - 1] === n2) return true;
        if (this.nodes[i + 1] === n2) return true;
      }
    }
    return false;
  }


  geometry(graph) {
    return graph.transient(this, 'geometry', () => {
      return this.isArea() ? 'area' : 'line';
    });
  }


  // returns an array of objects representing the segments between the nodes in this way
  segments(graph) {

    function segmentExtent(graph) {
      const n1 = graph.hasEntity(this.nodes[0]);
      const n2 = graph.hasEntity(this.nodes[1]);
      return n1 && n2 && new Extent(
        [ Math.min(n1.loc[0], n2.loc[0]), Math.min(n1.loc[1], n2.loc[1]) ],
        [ Math.max(n1.loc[0], n2.loc[0]), Math.max(n1.loc[1], n2.loc[1]) ]
      );
    }

    return graph.transient(this, 'segments', () => {
      const segments = [];
      for (let i = 0; i < this.nodes.length - 1; i++) {
        segments.push({
          id: this.props.id + '-' + i,
          wayId: this.props.id,
          index: i,
          nodes: [this.nodes[i], this.nodes[i + 1]],
          extent: segmentExtent
        });
      }
      return segments;
    });
  }


  // If this way is not closed, append the beginning node to the end of the nodelist to close it.
  close() {
    if (this.isClosed() || !this.nodes.length) return this;

    let nodes = this.nodes.slice();
    nodes = nodes.filter(noRepeatNodes);
    nodes.push(nodes[0]);
    return this.update({ nodes: nodes });
  }


  // If this way is closed, remove any connector nodes from the end of the nodelist to unclose it.
  unclose() {
    if (!this.isClosed()) return this;

    const connector = this.first();
    let nodes = this.nodes.slice();
    let i = nodes.length - 1;

    // remove trailing connectors..
    while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
      nodes.splice(i, 1);
      i = nodes.length - 1;
    }

    nodes = nodes.filter(noRepeatNodes);
    return this.update({ nodes: nodes });
  }


  // Adds a node (id) in front of the node which is currently at position index.
  // If index is undefined, the node will be added to the end of the way for linear ways,
  //   or just before the final connecting node for circular ways.
  // Consecutive duplicates are eliminated including existing ones.
  // Circularity is always preserved when adding a node.
  addNode(id, index) {
    let isClosed = this.isClosed();
    let nodes = this.nodes.slice();
    let max = isClosed ? nodes.length - 1 : nodes.length;

    if (index === undefined) {
      index = max;
    }

    if (index < 0 || index > max) {
      throw new RangeError(`index ${index} out of range 0..${max}`);
    }

    // If this is a closed way, remove all connector nodes except the first one
    // (there may be duplicates) and adjust index if necessary..
    if (isClosed) {
      const connector = this.first();

      // leading connectors..
      let i = 1;
      while (i < nodes.length && nodes.length > 2 && nodes[i] === connector) {
        nodes.splice(i, 1);
        if (index > i) index--;
      }

      // trailing connectors..
      i = nodes.length - 1;
      while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
        nodes.splice(i, 1);
        if (index > i) index--;
        i = nodes.length - 1;
      }
    }

    nodes.splice(index, 0, id);
    nodes = nodes.filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  // Replaces the node which is currently at position index with the given node (id).
  // Consecutive duplicates are eliminated including existing ones.
  // Circularity is preserved when updating a node.
  updateNode(id, index) {
    let nodes = this.nodes.slice();
    let isClosed = this.isClosed();
    let max = nodes.length - 1;

    if (index === undefined || index < 0 || index > max) {
      throw new RangeError(`index ${index} out of range 0..${max}`);
    }

    // If this is a closed way, remove all connector nodes except the first one
    // (there may be duplicates) and adjust index if necessary..
    if (isClosed) {
      const connector = this.first();

      // leading connectors..
      let i = 1;
      while (i < nodes.length && nodes.length > 2 && nodes[i] === connector) {
        nodes.splice(i, 1);
        if (index > i) index--;
      }

      // trailing connectors..
      i = nodes.length - 1;
      while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
        nodes.splice(i, 1);
        if (index === i) index = 0;  // update leading connector instead
        i = nodes.length - 1;
      }
    }

    nodes.splice(index, 1, id);
    nodes = nodes.filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  // Replaces each occurrence of node id needle with replacement.
  // Consecutive duplicates are eliminated including existing ones.
  // Circularity is preserved.
  replaceNode(needleID, replacementID) {
    const isClosed = this.isClosed();
    let nodes = this.nodes.slice();

    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === needleID) {
        nodes[i] = replacementID;
      }
    }

    nodes = nodes.filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  // Removes each occurrence of node id.
  // Consecutive duplicates are eliminated including existing ones.
  // Circularity is preserved.
  removeNode(id) {
    const isClosed = this.isClosed();
    let nodes = this.nodes.slice();

    nodes = nodes
      .filter(node => node !== id)
      .filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  area(graph) {
    return graph.transient(this, 'area', () => {
      let nodes = graph.childNodes(this);

      const json = {
        type: 'Polygon',
        coordinates: [ nodes.map(n => n.loc) ]
      };

      if (!this.isClosed() && nodes.length) {
        json.coordinates[0].push(nodes[0].loc);
      }

      let area = d3_geoArea(json);
      // Heuristic for detecting counterclockwise winding order. Assumes
      // that OpenStreetMap polygons are not hemisphere-spanning.
      if (area > 2 * Math.PI) {
        json.coordinates[0] = json.coordinates[0].reverse();
        area = d3_geoArea(json);
      }

      return isNaN(area) ? 0 : area;
    });
  }


  asJXON(changesetID) {
    const result = {
      way: {
        '@id': this.osmId(),
        '@version': this.props.version || 0,
        nd: this.nodes.map(nodeID => {
          return { keyAttributes: { ref: OsmEntity.toOSM(nodeID) } };
        }),
        tag: Object.keys(this.tags).map(k => {
          return { keyAttributes: { k: k, v: this.tags[k] } };
        })
      }
    };
    if (changesetID) {
      result.way['@changeset'] = changesetID;
    }
    return result;
  }


  asGeoJSON(graph) {
    return graph.transient(this, 'GeoJSON', () => {
      const coordinates = graph.childNodes(this).map(n => n.loc);

      if (this.isArea() && this.isClosed()) {
        return {
          type: 'Polygon',
          coordinates: [coordinates]
        };
      } else {
        return {
          type: 'LineString',
          coordinates: coordinates
        };
      }
    });
  }

}


// import { geoArea as d3_geoArea } from 'd3-geo';
// import { Extent, vecCross } from '@rapid-sdk/math';
// import { utilArrayUniq } from '@rapid-sdk/util';

// import { osmEntity } from './entity.js';
// import { osmLanes } from './lanes.js';
// import { osmTagSuggestingArea, osmOneWayTags, osmRightSideIsInsideTags, osmRemoveLifecyclePrefix } from './tags.js';
// import { utilTotalExtent } from '../util/index.js';


// export function osmWay() {
//     if (!(this instanceof osmWay)) {
//         return (new osmWay()).initialize(arguments);
//     } else if (arguments.length) {
//         this.initialize(arguments);
//     }
// }


// osmEntity.way = osmWay;

// osmWay.prototype = Object.create(osmEntity.prototype);


// Object.assign(osmWay.prototype, {
//     type: 'way',
//     nodes: [],


//     copy: function(resolver, copies) {
//         if (copies[this.id]) return copies[this.id];

//         var copy = osmEntity.prototype.copy.call(this, resolver, copies);

//         var nodes = this.nodes.map(function(id) {
//             return resolver.entity(id).copy(resolver, copies).id;
//         });

//         copy = copy.update({ nodes: nodes });
//         copies[this.id] = copy;

//         return copy;
//     },


//     extent: function(resolver) {
//         return resolver.transient(this, 'extent', function() {
//             return utilTotalExtent(this.nodes, resolver);
//         });
//     },


//     first: function() {
//         return this.nodes[0];
//     },


//     last: function() {
//         return this.nodes[this.nodes.length - 1];
//     },


//     contains: function(node) {
//         return this.nodes.indexOf(node) >= 0;
//     },


//     affix: function(node) {
//         if (this.nodes[0] === node) return 'prefix';
//         if (this.nodes[this.nodes.length - 1] === node) return 'suffix';
//     },


//     layer: function() {
//         // explicit layer tag, clamp between -10, 10..
//         if (isFinite(this.tags.layer)) {
//             return Math.max(-10, Math.min(+(this.tags.layer), 10));
//         }

//         // implied layer tag..
//         if (this.tags.covered === 'yes') return -1;
//         if (this.tags.location === 'overground') return 1;
//         if (this.tags.location === 'underground') return -1;
//         if (this.tags.location === 'underwater') return -10;

//         if (this.tags.power === 'line') return 10;
//         if (this.tags.power === 'minor_line') return 10;
//         if (this.tags.aerialway) return 10;
//         if (this.tags.bridge) return 1;
//         if (this.tags.cutting) return -1;
//         if (this.tags.tunnel) return -1;
//         if (this.tags.waterway) return -1;
//         if (this.tags.man_made === 'pipeline') return -10;
//         if (this.tags.boundary) return -10;
//         return 0;
//     },


//     // the approximate width of the line based on its tags except its `width` tag
//     impliedLineWidthMeters: function() {
//         var averageWidths = {
//             highway: { // width is for single lane
//                 motorway: 5, motorway_link: 5, trunk: 4.5, trunk_link: 4.5,
//                 primary: 4, secondary: 4, tertiary: 4,
//                 primary_link: 4, secondary_link: 4, tertiary_link: 4,
//                 unclassified: 4, road: 4, living_street: 4, bus_guideway: 4, pedestrian: 4,
//                 residential: 3.5, service: 3.5, track: 3, cycleway: 2.5,
//                 bridleway: 2, corridor: 2, steps: 2, path: 1.5, footway: 1.5
//             },
//             railway: { // width includes ties and rail bed, not just track gauge
//                 rail: 2.5, light_rail: 2.5, tram: 2.5, subway: 2.5,
//                 monorail: 2.5, funicular: 2.5, disused: 2.5, preserved: 2.5,
//                 miniature: 1.5, narrow_gauge: 1.5
//             },
//             waterway: {
//                 river: 50, canal: 25, stream: 5, tidal_channel: 5, fish_pass: 2.5, drain: 2.5, ditch: 1.5
//             }
//         };
//         for (var key in averageWidths) {
//             if (this.tags[key] && averageWidths[key][this.tags[key]]) {
//                 var width = averageWidths[key][this.tags[key]];
//                 if (key === 'highway') {
//                     var laneCount = this.tags.lanes && parseInt(this.tags.lanes, 10);
//                     if (!laneCount) laneCount = this.isOneWay() ? 1 : 2;

//                     return width * laneCount;
//                 }
//                 return width;
//             }
//         }
//         return null;
//     },


//     isOneWay: function() {
//         // explicit oneway tag..
//         var values = {
//             'yes': true,
//             '1': true,
//             '-1': true,
//             'reversible': true,
//             'alternating': true,
//             'no': false,
//             '0': false
//         };
//         if (values[this.tags.oneway] !== undefined) {
//             return values[this.tags.oneway];
//         }

//         // implied oneway tag..
//         for (var key in this.tags) {
//             if (key in osmOneWayTags &&
//                 (this.tags[key] in osmOneWayTags[key])) {
//                 return true;
//             }
//         }
//         return false;
//     },

//     // Some identifier for tag that implies that this way is "sided",
//     // i.e. the right side is the 'inside' (e.g. the right side of a
//     // natural=cliff is lower).
//     sidednessIdentifier: function() {
//         for (const realKey in this.tags) {
//             const value = this.tags[realKey];
//             const key = osmRemoveLifecyclePrefix(realKey);
//             if (key in osmRightSideIsInsideTags && (value in osmRightSideIsInsideTags[key])) {
//                 if (osmRightSideIsInsideTags[key][value] === true) {
//                     return key;
//                 } else {
//                     // if the map's value is something other than a
//                     // literal true, we should use it so we can
//                     // special case some keys (e.g. natural=coastline
//                     // is handled differently to other naturals).
//                     return osmRightSideIsInsideTags[key][value];
//                 }
//             }
//         }

//         return null;
//     },

//     isSided: function() {
//         if (this.tags.two_sided === 'yes') {
//             return false;
//         }

//         return this.sidednessIdentifier() !== null;
//     },

//     lanes: function() {
//         return osmLanes(this);
//     },


//     isClosed: function() {
//         return this.nodes.length > 1 && this.first() === this.last();
//     },


//     isConvex: function(resolver) {
//         if (!this.isClosed() || this.isDegenerate()) return null;

//         var nodes = utilArrayUniq(resolver.childNodes(this));
//         var coords = nodes.map(function(n) { return n.loc; });
//         var curr = 0;
//         var prev = 0;

//         for (var i = 0; i < coords.length; i++) {
//             var o = coords[(i+1) % coords.length];
//             var a = coords[i];
//             var b = coords[(i+2) % coords.length];
//             var res = vecCross(a, b, o);

//             curr = (res > 0) ? 1 : (res < 0) ? -1 : 0;
//             if (curr === 0) {
//                 continue;
//             } else if (prev && curr !== prev) {
//                 return false;
//             }
//             prev = curr;
//         }
//         return true;
//     },

//     // returns an object with the tag that implies this is an area, if any
//     tagSuggestingArea: function() {
//         return osmTagSuggestingArea(this.tags);
//     },

//     isArea: function() {
//         if (this.tags.area === 'yes') return true;
//         if (!this.isClosed() || this.tags.area === 'no') return false;
//         return this.tagSuggestingArea() !== null;
//     },


//     isDegenerate: function() {
//         return (new Set(this.nodes).size < (this.isClosed() ? 3 : 2));
//     },


//     areAdjacent: function(n1, n2) {
//         for (var i = 0; i < this.nodes.length; i++) {
//             if (this.nodes[i] === n1) {
//                 if (this.nodes[i - 1] === n2) return true;
//                 if (this.nodes[i + 1] === n2) return true;
//             }
//         }
//         return false;
//     },


//     geometry: function(graph) {
//         return graph.transient(this, 'geometry', function() {
//             return this.isArea() ? 'area' : 'line';
//         });
//     },


//     // returns an array of objects representing the segments between the nodes in this way
//     segments: function(graph) {

//         function segmentExtent(graph) {
//             var n1 = graph.hasEntity(this.nodes[0]);
//             var n2 = graph.hasEntity(this.nodes[1]);
//             return n1 && n2 && new Extent(
//                 [
//                     Math.min(n1.loc[0], n2.loc[0]),
//                     Math.min(n1.loc[1], n2.loc[1])
//                 ],
//                 [
//                     Math.max(n1.loc[0], n2.loc[0]),
//                     Math.max(n1.loc[1], n2.loc[1])
//                 ]
//             );
//         }

//         return graph.transient(this, 'segments', function() {
//             var segments = [];
//             for (var i = 0; i < this.nodes.length - 1; i++) {
//                 segments.push({
//                     id: this.id + '-' + i,
//                     wayId: this.id,
//                     index: i,
//                     nodes: [this.nodes[i], this.nodes[i + 1]],
//                     extent: segmentExtent
//                 });
//             }
//             return segments;
//         });
//     },


//     // If this way is not closed, append the beginning node to the end of the nodelist to close it.
//     close: function() {
//         if (this.isClosed() || !this.nodes.length) return this;

//         var nodes = this.nodes.slice();
//         nodes = nodes.filter(noRepeatNodes);
//         nodes.push(nodes[0]);
//         return this.update({ nodes: nodes });
//     },


//     // If this way is closed, remove any connector nodes from the end of the nodelist to unclose it.
//     unclose: function() {
//         if (!this.isClosed()) return this;

//         var nodes = this.nodes.slice();
//         var connector = this.first();
//         var i = nodes.length - 1;

//         // remove trailing connectors..
//         while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
//             nodes.splice(i, 1);
//             i = nodes.length - 1;
//         }

//         nodes = nodes.filter(noRepeatNodes);
//         return this.update({ nodes: nodes });
//     },


//     // Adds a node (id) in front of the node which is currently at position index.
//     // If index is undefined, the node will be added to the end of the way for linear ways,
//     //   or just before the final connecting node for circular ways.
//     // Consecutive duplicates are eliminated including existing ones.
//     // Circularity is always preserved when adding a node.
//     addNode: function(id, index) {
//         var nodes = this.nodes.slice();
//         var isClosed = this.isClosed();
//         var max = isClosed ? nodes.length - 1 : nodes.length;

//         if (index === undefined) {
//             index = max;
//         }

//         if (index < 0 || index > max) {
//             throw new RangeError('index ' + index + ' out of range 0..' + max);
//         }

//         // If this is a closed way, remove all connector nodes except the first one
//         // (there may be duplicates) and adjust index if necessary..
//         if (isClosed) {
//             var connector = this.first();

//             // leading connectors..
//             var i = 1;
//             while (i < nodes.length && nodes.length > 2 && nodes[i] === connector) {
//                 nodes.splice(i, 1);
//                 if (index > i) index--;
//             }

//             // trailing connectors..
//             i = nodes.length - 1;
//             while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
//                 nodes.splice(i, 1);
//                 if (index > i) index--;
//                 i = nodes.length - 1;
//             }
//         }

//         nodes.splice(index, 0, id);
//         nodes = nodes.filter(noRepeatNodes);

//         // If the way was closed before, append a connector node to keep it closed..
//         if (isClosed && (nodes.length === 1 || nodes[0] !== nodes[nodes.length - 1])) {
//             nodes.push(nodes[0]);
//         }

//         return this.update({ nodes: nodes });
//     },


//     // Replaces the node which is currently at position index with the given node (id).
//     // Consecutive duplicates are eliminated including existing ones.
//     // Circularity is preserved when updating a node.
//     updateNode: function(id, index) {
//         var nodes = this.nodes.slice();
//         var isClosed = this.isClosed();
//         var max = nodes.length - 1;

//         if (index === undefined || index < 0 || index > max) {
//             throw new RangeError('index ' + index + ' out of range 0..' + max);
//         }

//         // If this is a closed way, remove all connector nodes except the first one
//         // (there may be duplicates) and adjust index if necessary..
//         if (isClosed) {
//             var connector = this.first();

//             // leading connectors..
//             var i = 1;
//             while (i < nodes.length && nodes.length > 2 && nodes[i] === connector) {
//                 nodes.splice(i, 1);
//                 if (index > i) index--;
//             }

//             // trailing connectors..
//             i = nodes.length - 1;
//             while (i > 0 && nodes.length > 1 && nodes[i] === connector) {
//                 nodes.splice(i, 1);
//                 if (index === i) index = 0;  // update leading connector instead
//                 i = nodes.length - 1;
//             }
//         }

//         nodes.splice(index, 1, id);
//         nodes = nodes.filter(noRepeatNodes);

//         // If the way was closed before, append a connector node to keep it closed..
//         if (isClosed && (nodes.length === 1 || nodes[0] !== nodes[nodes.length - 1])) {
//             nodes.push(nodes[0]);
//         }

//         return this.update({nodes: nodes});
//     },


//     // Replaces each occurrence of node id needle with replacement.
//     // Consecutive duplicates are eliminated including existing ones.
//     // Circularity is preserved.
//     replaceNode: function(needleID, replacementID) {
//         var nodes = this.nodes.slice();
//         var isClosed = this.isClosed();

//         for (var i = 0; i < nodes.length; i++) {
//             if (nodes[i] === needleID) {
//                 nodes[i] = replacementID;
//             }
//         }

//         nodes = nodes.filter(noRepeatNodes);

//         // If the way was closed before, append a connector node to keep it closed..
//         if (isClosed && (nodes.length === 1 || nodes[0] !== nodes[nodes.length - 1])) {
//             nodes.push(nodes[0]);
//         }

//         return this.update({nodes: nodes});
//     },


//     // Removes each occurrence of node id.
//     // Consecutive duplicates are eliminated including existing ones.
//     // Circularity is preserved.
//     removeNode: function(id) {
//         var nodes = this.nodes.slice();
//         var isClosed = this.isClosed();

//         nodes = nodes
//             .filter(function(node) { return node !== id; })
//             .filter(noRepeatNodes);

//         // If the way was closed before, append a connector node to keep it closed..
//         if (isClosed && (nodes.length === 1 || nodes[0] !== nodes[nodes.length - 1])) {
//             nodes.push(nodes[0]);
//         }

//         return this.update({nodes: nodes});
//     },


//     asJXON: function(changeset_id) {
//         var r = {
//             way: {
//                 '@id': this.osmId(),
//                 '@version': this.version || 0,
//                 nd: this.nodes.map(function(id) {
//                     return { keyAttributes: { ref: osmEntity.id.toOSM(id) } };
//                 }, this),
//                 tag: Object.keys(this.tags).map(function(k) {
//                     return { keyAttributes: { k: k, v: this.tags[k] } };
//                 }, this)
//             }
//         };
//         if (changeset_id) {
//             r.way['@changeset'] = changeset_id;
//         }
//         return r;
//     },


//     asGeoJSON: function(resolver) {
//         return resolver.transient(this, 'GeoJSON', function() {
//             var coordinates = resolver.childNodes(this)
//                 .map(function(n) { return n.loc; });

//             if (this.isArea() && this.isClosed()) {
//                 return {
//                     type: 'Polygon',
//                     coordinates: [coordinates]
//                 };
//             } else {
//                 return {
//                     type: 'LineString',
//                     coordinates: coordinates
//                 };
//             }
//         });
//     },


//     area: function(resolver) {
//         return resolver.transient(this, 'area', function() {
//             var nodes = resolver.childNodes(this);

//             var json = {
//                 type: 'Polygon',
//                 coordinates: [ nodes.map(function(n) { return n.loc; }) ]
//             };

//             if (!this.isClosed() && nodes.length) {
//                 json.coordinates[0].push(nodes[0].loc);
//             }

//             var area = d3_geoArea(json);

//             // Heuristic for detecting counterclockwise winding order. Assumes
//             // that OpenStreetMap polygons are not hemisphere-spanning.
//             if (area > 2 * Math.PI) {
//                 json.coordinates[0] = json.coordinates[0].reverse();
//                 area = d3_geoArea(json);
//             }

//             return isNaN(area) ? 0 : area;
//         });
//     }
// });


// // Filter function to eliminate consecutive duplicates.
// function noRepeatNodes(node, i, arr) {
//     return i === 0 || node !== arr[i - 1];
// }
