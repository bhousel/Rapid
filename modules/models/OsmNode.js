import { RAD2DEG, vecAngle } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';

import { OsmEntity } from './OsmEntity.js';


/**
 * OsmNode
 * @see https://wiki.openstreetmap.org/wiki/Node
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 *   `tags`    Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 *   `loc`     Accessor for the `loc` property, used to get WGS84 coordinate for this Node
 */
export class OsmNode extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'node';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'n-' + this.context.next('node');
    }

    this.updateGeometry();
  }

  /**
   * loc
   * @readonly
   */
  get loc() {
    return this.props.loc;
  }

  /**
   * update
   * Update the data element's properties and return a new data element.
   * data elements are intended to be immutable.  To modify a data element,
   *  pass in the properties to change, and you'll get a new data element.
   * The new data element will have an updated `v` internal version number.
   * @param   {Object}   props - the updated properties
   * @return  {OsmNode}  a new OsmNode
   */
  update(props) {
    return new OsmNode(this, props).touch();
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmNode.
   * Nodes are represented by a Feature with a Point geometry.
   * @param   {Graph}   graph - Unused for OsmNode
   * @return  {Object}  GeoJSON representation of the OsmNode
   */
  asGeoJSON() {
    let geometry = null;

    const coords = this.loc;
    if (Array.isArray(coords) && coords.length >= 2) {
      geometry = {
        type: 'Point',
        coordinates: coords
      };
    }

    return {
      type: 'Feature',
      id: this.id,
      properties: this.tags,
      geometry: geometry
    };
  }

  /**
   * asJXON
   * Returns a JXON representation of the OsmNode.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param   {string}  changesetID - optional changeset ID to include in the output
   * @return  {Object}  JXON representation of the OsmNode
   */
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


  geometry(graph) {
    return this.transient('geometry', () => {
      const parents = graph.parentWays(this);
      return parents.length === 0 ? 'point' : 'vertex';
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
        const a = this.geoms.parts[0]?.world?.coords ?? null;
        const b = graph.entity(nodeID).geoms.parts[0]?.world?.coords ?? null;
        if (a === null || b === null) continue;
        results.push((vecAngle(a, b) * RAD2DEG) + 90);
      }
    }

    return utilArrayUniq(results).sort((a, b) => a - b);
  }


  isEndpoint(graph) {
    return this.transient('isEndpoint', () => {
      const id = this.id;
      return graph.parentWays(this).filter(parent => {
        return !parent.isClosed() && !!parent.affix(id);
      }).length > 0;
    });
  }

  isConnected(graph) {
    return this.transient('isConnected', () => {
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

  /**
   * isShared
   * Returns `true` if this node has multiple connections:
   *  - a Node with multiple parents, OR
   *  - a Node connected to a single parent in multiple places.
   * @param   {Graph}    graph - The graph for this node
   * @return  {boolean}  `true` if this node has multiple connections
   */
  isShared(graph) {
    return this.transient('isShared', () => {
      const parents = graph.parentWays(this);

      if (parents.length === 0) return false;  // no parents
      if (parents.length > 1) return true;     // multiple parents

      // single parent
      const parent = parents[0];

      // If parent is a closed loop, don't count the last node in the nodelist as doubly connected
      const end = parent.isClosed() ? parent.nodes.length - 1 : parent.nodes.length;
      for (let i = 0, count = 0; i < end; i++) {
        if (this.id === parent.nodes[i]) count++;
        if (count > 1) return true;
      }
      return false;
    });
  }


  parentIntersectionWays(graph) {
    return this.transient('parentIntersectionWays', () => {
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
    return this.transient('isHighwayIntersection', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.highway && parent.geometry(graph) === 'line';
      }).length > 1;
    });
  }


  isOnAddressLine(graph) {
    return this.transient('isOnAddressLine', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.hasOwnProperty('addr:interpolation') && parent.geometry(graph) === 'line';
      }).length > 0;
    });
  }


}
