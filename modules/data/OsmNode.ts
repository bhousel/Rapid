import { RAD2DEG, vecAngle } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';

import { OsmEntity, OsmEntityProps } from './OsmEntity.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Vec2 } from './types.ts';


/**
 * Properties for OsmNode data elements.
 */
export interface OsmNodeProps extends OsmEntityProps {
  /** Geographic location in WGS84 [lon, lat] */
  loc: Vec2;
}


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
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  constructor(otherOrContext: OsmNode | Context, props: Partial<OsmNodeProps> = {}) {
    super(otherOrContext, props);
    this.props.type = 'node';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'n-' + this.context.next('node');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    this.updateGeometry();
  }


  /**
   * loc
   * Geographic location in WGS84 [lon, lat]
   * @readonly
   */
  get loc(): Vec2 | undefined {
    return (this.props as Partial<OsmNodeProps>).loc;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmNode.
   * Nodes are represented by a Feature with a Point geometry.
   * @param _graph - Unused for OsmNode
   * @returns GeoJSON representation of the OsmNode
   */
  asGeoJSON(_graph?: Graph): GeoJSONObject {
    let geometry: GeoJSON.Point | null = null;

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
   * @param changesetID - optional changeset ID to include in the output
   * @returns JXON representation of the OsmNode
   */
  asJXON(changesetID?: string): Record<string, unknown> {
    const loc = this.loc;
    const result: Record<string, unknown> = {
      node: {
        '@id': this.osmId(),
        '@lon': loc?.[0],
        '@lat': loc?.[1],
        '@version': (this.props.version || 0),
        tag: Object.keys(this.tags).map(k => {
          return { keyAttributes: { k: k, v: this.tags[k] } };
        })
      }
    };
    if (changesetID) {
      (result.node as Record<string, unknown>)['@changeset'] = changesetID;
    }
    return result;
  }

  /**
   * geometry
   * Returns 'point' if this Node is standalone, or 'vertex' if is along a parent Way.
   * @param graph - the Graph that holds the topology needed
   * @returns 'point' or 'vertex'
   */
  geometry(graph: Graph): string {
    return this.transient('geometry', () => {
      const parents = graph.parentWays(this);
      return parents.length === 0 ? 'point' : 'vertex';
    });
  }

  /**
   * move
   * Moves this node to a new location.
   * @param loc - the new location, in WGS84 coordinate [longitude, latitude]
   * @returns A new Node copied from this Node, but with the updated location
   */
  move(loc: Vec2): this {
    return this.update({ loc: loc });
  }

  /**
   * isDegenerate
   * A node is "degenerate" if its location is not a proper WGS84 [longitude,latitude] coordinate.
   * @returns `true` if the node is degenerate, `false` if not.
   */
  isDegenerate(): boolean {
    const loc = this.loc;
    return !(
      Array.isArray(loc) && loc.length === 2 &&
      loc[0] >= -180 && loc[0] <= 180 &&
      loc[1] >= -90 && loc[1] <= 90
    );
  }

  /**
   * directions
   * Returns the directions, in degrees, that this node points, given the tags present.
   * @param graph - the Graph that holds the topology needed
   * @returns Array of azimuth angles in degrees
   */
  directions(graph: Graph): number[] {
    let val: string;

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

    const cardinal: Record<string, number> = {
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
    const results: number[] = [];

    for (let v of vals) {
      // swap cardinal for numeric directions
      if (cardinal[v] !== undefined) {
        v = String(cardinal[v]);
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
      const nodeIDs = new Set<string>();
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
        // +90 because vecAngle returns angle from X axis, not Y (north)
        const a = this.geoms.parts[0]?.world?.coords as Vec2 | null ?? null;
        const b = graph.entity(nodeID).geoms.parts[0]?.world?.coords as Vec2 | null ?? null;
        if (a === null || b === null) continue;
        results.push((vecAngle(a, b) * RAD2DEG) + 90);
      }
    }

    return utilArrayUniq(results).sort((a, b) => a - b);
  }

  /**
   * isEndpoint
   * Returns `true` if this node is an endpoint of a parent way.
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node is an endpoint on a parent way, `false` if not
   */
  isEndpoint(graph: Graph): boolean {
    return this.transient('isEndpoint', () => {
      const id = this.id;
      return graph.parentWays(this).filter(parent => {
        return !parent.isClosed() && !!parent.affix(id);
      }).length > 0;
    });
  }

  /**
   * isConnected
   * Returns `true` if this node is connected to multiple parent ways
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node is connected to multiple parent ways, `false` if not
   */
  isConnected(graph: Graph): boolean {
    return this.transient('isConnected', () => {
      const parents = graph.parentWays(this);

      if (parents.length > 1) {  // vertex is connected to multiple parent ways
        for (const parent of parents) {
          if (parent.geometry(graph) === 'line' && parent.hasInterestingTags()) return true;
        }
      } else if (parents.length === 1) {
        const way = parents[0];
        const nodes = way.nodes.slice();
        if (way.isClosed()) {
          nodes.pop();  // ignore connecting node if closed
        }

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
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node has multiple connections
   */
  isShared(graph: Graph): boolean {
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

  /**
   * parentIntersectionWays
   * Returns an array of parent ways that intersect at this node.
   * Only linear parent ways with tagging for 'highway', 'railway', 'aeroway', 'waterway' are considered.
   * @param graph - the Graph that holds the topology needed
   * @returns parent ways that intersect at this node.
   */
  parentIntersectionWays(graph: Graph): unknown[] {
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

  /**
   * isIntersection
   * Returns `true` if this node is an intersection, see `parentIntersectionWays`.
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node is an intersection of parent ways, `false` if not
   */
  isIntersection(graph: Graph): boolean {
    return this.parentIntersectionWays(graph).length > 1;
  }

  /**
   * isHighwayIntersection
   * Like `isIntersection`, but just for highways.
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node is an intersection of parent highways, `false` if not
   */
  isHighwayIntersection(graph?: Graph): boolean {
    if (!graph) return false;
    return this.transient('isHighwayIntersection', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.highway && parent.geometry(graph) === 'line';
      }).length > 1;
    });
  }

  /**
   * isOnAddressLine
   * Returns `true` if this node is along an address interpolation line.
   * @param graph - the Graph that holds the topology needed
   * @returns `true` if this node is along an address interpolation line, `false` if not
   */
  isOnAddressLine(graph: Graph): boolean {
    return this.transient('isOnAddressLine', () => {
      return graph.parentWays(this).filter(parent => {
        return parent.tags.hasOwnProperty('addr:interpolation') && parent.geometry(graph) === 'line';
      }).length > 0;
    });
  }

}
