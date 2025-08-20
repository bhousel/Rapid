import { geoArea as d3_geoArea } from 'd3-geo';
import { Extent, vecCross } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';

import { OsmEntity } from './OsmEntity.js';
import { osmLanes } from './lanes.js';
import { osmTagSuggestingArea, osmOneWayTags, osmRightSideIsInsideTags, osmRemoveLifecyclePrefix } from './tags.js';


// Filter function to eliminate consecutive duplicates.
function noRepeatNodes(node, i, arr) {
  return i === 0 || node !== arr[i - 1];
}


/**
 * OsmWay
 * @see https://wiki.openstreetmap.org/wiki/Way
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 *   `tags`    Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 *   `nodes`   Accessor for the `nodes` property, an Array of node ids
 */
export class OsmWay extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'way';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'w-' + this.context.next('way');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    if (!this.props.nodes) {
      this.props.nodes = [];
    }
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
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmWay.
   * Ways are represented by a Feature with either LineString or a Polygon geometry.
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {Object}  GeoJSON representation of the OsmWay
   */
  asGeoJSON(graph) {
    return this.transient('geojson', () => {

      let geometry = null;
      const coords = [];
      for (const nodeID of this.nodes) {
        const node = graph.hasEntity(nodeID);
        if (node?.loc) {
          coords.push(node.loc);
        }
      }

      if (coords.length) {
        if (this.isArea() && this.isClosed()) {
          geometry = {
            type: 'Polygon',
            coordinates: [coords]
          };
        } else {
          geometry = {
            type: 'LineString',
            coordinates: coords
          };
        }
      }

      return {
        type: 'Feature',
        id: this.id,
        properties: this.tags,
        geometry: geometry
      };

    });
  }


  /**
   * asJXON
   * Returns a JXON representation of the OsmWay.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param   {string}  changesetID - optional changeset ID to include in the output
   * @return  {Object}  JXON representation of the OsmWay
   */
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


  /**
   * copy
   * Makes a (mostly) deep copy of an OSM Entity.
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
    copy.props.nodes = nodes;
    return copy;
  }


  /**
   * first
   * Returns the first nodeID in the node list.
   * @return  {string}  The first nodeID in the node list, or `undefined` if no nodes.
   */
  first() {
    return this.nodes.at(0);
  }

  /**
   * last
   * Returns the last nodeID in the node list.
   * @return  {string}  The last nodeID in the node list, or `undefined` if no nodes.
   */
  last() {
    return this.nodes.at(-1);
  }

  /**
   * contains
   * Returns true if the node list contains the given nodeID.
   * @param   {string}   The nodeID to check
   * @return  {boolean}  `true` if the nodeID is in the node list, `false` if not.
   */
  contains(nodeID) {
    return this.nodes.includes(nodeID);
  }

  /**
   * affix
   * Returns 'prefix' or if the given nodeID is at the beginning the node list
   *  or 'suffix' if the given nodeID is at the end of the node list.
   * @param   {string}   The nodeID to check
   * @return  {string}  'prefix', 'suffix' or `undefined`
   */
  affix(nodeID) {
    if (this.nodes.at(0) === nodeID) return 'prefix';
    if (this.nodes.at(-1) === nodeID) return 'suffix';
  }

  /**
   * layer
   * Returns a numeric layer for this way, given the tags present.
   * '0' is considered "ground level", negative numbers are underground and positive numbers are aboveground.
   * The numbers are currently clamped in the range of [-10..10].
   * @return  {number}  A number that can be used for rendering layer
   */
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

  /**
   * impliedLineWidthMeters
   * Returns the approximate width of the line, given the tags present.
   * (This does not look for an actual `width` tag, it looks at other tags to imply a width.)
   * @return  {number}  A number that can be used for the width, in meters
   */
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

  /**
   * isOneWay
   * Returns whether a line is oneway, given the tags present.
   * @return  {boolean}  `true` if the tags suggest that this is a oneway, `false` if not.
   */
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

  /**
   * sidednessIdentifier
   * Returns some identifier for tag that implies that this way is "sided",
   *  i.e. the right side is the 'inside' (e.g. the right side of a
   *   natural=cliff is lower).
   * @return  {string}  The tag that indicates the sidedness
   */
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

  /**
   * isSided
   * Returns whether a line sided, given the tags present.
   * @return  {boolean}  `true` if the tags suggest that the line is sided, `false` if not.
   */
  isSided() {
    if (this.tags.two_sided === 'yes') {
      return false;
    }
    return this.sidednessIdentifier() !== null;
  }

  /**
   * lanes
   * Returns lane information for the given way, given the tags present.
   * @return  {Object}  An object containing the lane details for this way
   */
  lanes() {
    return osmLanes(this);
  }

  /**
   * isClosed
   * A way is "closed" if the first and last nodeID is the same.
   * @return  {boolean}  `true` if the way is closed, `false` if not
   */
  isClosed() {
    return this.nodes.length > 1 && this.first() === this.last();
  }

  /**
   * isConvex
   * Checks the node angles to determine if the way is a convex polygon or not.
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {boolean}  `true` if the way is a convex polygon, `false` if concave polygon, `null` if unclosed or degenerate
   */
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

  /**
   * tagSuggestingArea
   * Returns an Object with the tag that implies that this way is an area (polygon).
   * @return  {Object}  The tag that indicates the area
   */
  tagSuggestingArea() {
    return osmTagSuggestingArea(this.tags);
  }

  /**
   * isArea
   * Returns whether this way is a closed area (polygon), given the tags present.
   * @return  {boolean}  `true` if the tags suggest that the way is an area, `false` if not.
   */
  isArea() {
    if (this.tags.area === 'yes') return true;
    if (!this.isClosed() || this.tags.area === 'no') return false;
    return this.tagSuggestingArea() !== null;
  }

  /**
   * isDegenerate
   * The way is "degenerate" if it is a line with <2 nodes or an area with <3 nodes.
   * @return  {boolean}  `true` if the way is degenerate, `false` if not.
   */
  isDegenerate() {
    return (new Set(this.nodes).size < (this.isClosed() ? 3 : 2));
  }

  /**
   * isAdjacent
   * Checks whether the given nodeIDs are adjacent in the node list.
   * @return  {boolean}  `true` if the way is degenerate, `false` if not.
   */
  isAdjacent(n1, n2) {
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i] === n1) {
        if (this.nodes[i - 1] === n2) return true;
        if (this.nodes[i + 1] === n2) return true;
      }
    }
    return false;
  }

  /**
   * geometry
   * Returns 'area' if this way is an area (polygon), or 'line' if it is a line.
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {string}  'area' or 'line'
   */
  geometry(graph) {
    return this.transient('geometry', () => {
      return this.isArea() ? 'area' : 'line';
    });
  }

  /**
   * segments
   * Returns an Array of Objects representing the segments between the nodes in this way
   * @param   {Graph}          graph - the Graph that holds the topology needed
   * @return  {Array<Object>}  Array of segment data
   */
  segments(graph) {

    function segmentExtent(graph) {
      const n1 = graph.hasEntity(this.nodes[0]);
      const n2 = graph.hasEntity(this.nodes[1]);
      return n1 && n2 && new Extent(
        [ Math.min(n1.loc[0], n2.loc[0]), Math.min(n1.loc[1], n2.loc[1]) ],
        [ Math.max(n1.loc[0], n2.loc[0]), Math.max(n1.loc[1], n2.loc[1]) ]
      );
    }

    return this.transient('segments', () => {
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

  /**
   * close
   * If this way is not closed, append the beginning node to the end of the nodelist to close it.
   * @return  {OsmWay}  This Way, or a new Way that has a closed node list
   */
  close() {
    if (this.isClosed() || !this.nodes.length) return this;

    let nodes = this.nodes.slice();
    nodes = nodes.filter(noRepeatNodes);
    nodes.push(nodes[0]);
    return this.update({ nodes: nodes });
  }

  /**
   * unclose
   * If this way is closed, remove any connector nodes from the end of the nodelist to unclose it.
   * @return  {OsmWay}  This Way, or a new Way that has an unclosed node list
   */
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


  /**
   * addNode
   * Adds a nodeID in front of the node which is currently at position index.
   * If index is undefined, the node will be added to the end of the way for linear ways,
   *   or just before the final connecting node for circular ways.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is always preserved when adding a node.
   * @param   {string}  nodeID - the nodeID to add
   * @param   {number}  index - the index to add the node into the node list
   * @return  {OsmWay}  A new Way copied from this Way, but with the updated node list
   * @throws  Will throw if the given index is out of range 0..max
   */
  addNode(nodeID, index) {
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

    nodes.splice(index, 0, nodeID);
    nodes = nodes.filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  /**
   * updateNode
   * Replaces the node which is currently at the given index with the given nodeID.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved when updating a node.
   * @param   {string}  nodeID - the nodeID to add into the node list
   * @param   {number}  index - the index to add the node into the node list
   * @return  {OsmWay}  A new Way copied from this Way, but with the updated node list
   * @throws  Will throw if the given index is out of range 0..max
   */
  updateNode(nodeID, index) {
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

    nodes.splice(index, 1, nodeID);
    nodes = nodes.filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  /**
   * replaceNode
   * Replaces each occurrence of nodeID needle with replacement.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved.
   * @param   {string}  needleID - the nodeID to find
   * @param   {string}  replacementID - the nodeID to replace it with
   * @return  {OsmWay}  A new Way copied from this Way, but with the updated node list
   */
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


  /**
   * removeNode
   * Removes each occurrence of the given nodeID.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved.
   * @param   {string}  nodeID - the nodeID to remove
   * @return  {OsmWay}  A new Way copied from this Way, but with the updated node list
   */
  removeNode(nodeID) {
    const isClosed = this.isClosed();
    let nodes = this.nodes.slice();

    nodes = nodes
      .filter(node => node !== nodeID)
      .filter(noRepeatNodes);

    // If the way was closed before, append a connector node to keep it closed..
    if (isClosed && (nodes.length === 1 || nodes.at(0) !== nodes.at(-1))) {
      nodes.push(nodes[0]);
    }

    return this.update({ nodes: nodes });
  }


  /**
   * area
   * This calculates an area for the given way using d3_geoArea.
   * The result is in "steradians" (square radians).
   * (This should instead live in the Geometry/GeometryPart classes)
   * @see https://d3js.org/d3-geo/math#geoArea
   * @param   {Graph}   graph - the Graph that holds the topology needed
   * @return  {number}  The area in square radians
   */
  area(graph) {
    return this.transient('area', () => {
      const nodes = graph.childNodes(this);
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

}
