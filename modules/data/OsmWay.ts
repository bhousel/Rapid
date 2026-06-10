import { Extent, vecCross } from '@rapid-sdk/math';
import { OsmEntity, OsmEntityProps } from './OsmEntity.ts';
import { osmLanes } from '../lib/lanes.ts';
import { utilArrayUniq } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode, OsmTags, TagKeyValueLookup } from './types.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Filter function to eliminate consecutive duplicates.
 * @param node
 * @param i
 * @param arr
 */
function noRepeatNodes(node: EntityID, i: number, arr: EntityID[]): boolean {
  return i === 0 || node !== arr[i - 1];
}


/**
 * Properties for OsmWay data elements.
 */
export interface OsmWayProps extends OsmEntityProps {
  /** Ordered array of node IDs that make up this way */
  nodes: EntityID[];
}

/**
 * Segment data for a way.
 */
export interface Segment {
  id: string;
  wayID: string;
  index: number;
  edge: [EntityID, EntityID];
  extent: (graph: Graph) => Extent | undefined;
}


/**
 * This class contains the data for an OSM Way.
 * @see https://wiki.openstreetmap.org/wiki/Way
 *
 * Properties available:
 * - `geoms`   Geometry object (inherited from `AbstractData`)
 * - `props`   Properties object (inherited from `AbstractData`)
 * - `tags`    Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 * - `nodes`   Accessor for the `nodes` property, an Array of node ids
 */
export class OsmWay extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  public constructor(otherOrContext: OsmWay | Context, props: Partial<OsmWayProps> = {}) {
    super(otherOrContext, props);
    this.props.type = 'way';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'w-' + this.context.next('way');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    if (!(this.props as OsmWayProps).nodes) {
      (this.props as OsmWayProps).nodes = [];
    }
  }

  /**
   * get/set the nodes property
   * @return  Ordered array of node `EntityID`s that form this way
   * @readonly
   */
  public get nodes(): EntityID[] {
    return (this.props as OsmWayProps).nodes;
  }

  /**
   * Returns a GeoJSON representation of the OsmWay.
   * Ways are represented by a Feature with either LineString or a Polygon geometry.
   * @param graph - the Graph that holds the topology needed
   * @return GeoJSON representation of the OsmWay
   */
  public asGeoJSON(graph: Graph): GeoJSONObject {
    return this.transient('geojson', () => {

      let geometry: GeoJSON.Geometry | null = null;
      const coords: Vec2[] = [];
      for (const nodeID of this.nodes) {
        const node = graph.hasEntity(nodeID) as OsmNode | null;
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
   * Returns a JXON representation of the OsmWay.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param changesetID - optional changeset ID to include in the output
   * @return JXON representation of the OsmWay
   */
  public asJXON(changesetID?: string): Record<string, unknown> {
    const result: any = {
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
   * Makes a (mostly) deep copy of an OSM Entity.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param fromGraph - The Graph that owns the source object (needed for some data types)
   * @param memo - An Object to store seen copies (to prevent circular/infinite copying)
   * @return a copy of this OsmWay
   */
  public copy(fromGraph: Graph, memo: Record<string, OsmEntity> = {}): OsmWay {
    if (memo[this.id]) {
      return memo[this.id] as OsmWay;
    }

    // copy self
    const copy = new OsmWay(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;

    // copy nodes too
    const nodes: EntityID[] = [];
    for (const nodeID of this.nodes) {
      const source = fromGraph.entity(nodeID) as OsmNode;
      const result = source.copy(fromGraph, memo);
      nodes.push(result.id);
    }
    (copy.props as OsmWayProps).nodes = nodes;
    return copy;
  }


  /**
   * Returns the first nodeID in the node list.
   * @return The first nodeID in the node list, or `undefined` if no nodes.
   */
  public first(): EntityID | undefined {
    return this.nodes.at(0);
  }

  /**
   * Returns the last nodeID in the node list.
   * @return The last nodeID in the node list, or `undefined` if no nodes.
   */
  public last(): EntityID | undefined {
    return this.nodes.at(-1);
  }

  /**
   * Returns true if the node list contains the given nodeID.
   * @param nodeID - The nodeID to check
   * @return `true` if the nodeID is in the node list, `false` if not.
   */
  public contains(nodeID: EntityID): boolean {
    return this.nodes.includes(nodeID);
  }

  /**
   * Returns 'prefix' or if the given nodeID is at the beginning the node list
   *  or 'suffix' if the given nodeID is at the end of the node list.
   * @param nodeID - The nodeID to check
   * @return 'prefix', 'suffix' or `undefined`
   */
  public affix(nodeID: EntityID): 'prefix' | 'suffix' | undefined {
    if (this.nodes.at(0) === nodeID) return 'prefix';
    if (this.nodes.at(-1) === nodeID) return 'suffix';
  }

  /**
   * Returns a numeric layer for this way, given the tags present.
   * '0' is considered "ground level", negative numbers are underground and positive numbers are aboveground.
   * The numbers are currently clamped in the range of [-10..10].
   * @return A number that can be used for rendering layer
   */
  public layer(): number {
// TODO - we should stop doing this, it's a holdover from when iD used SVG groups for this.
    // explicit layer tag, clamp between -10, 10..
    if (isFinite(+(this.tags.layer))) {
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
   * Returns the approximate width of the line, given the tags present.
   * (This does not look for an actual `width` tag, it looks at other tags to imply a width.)
   * @return A number that can be used for the width, in meters
   */
  public impliedLineWidthMeters(): number | null {
    const averageWidths: Record<string, Record<string, number>> = {
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
      const width = v && group[v];
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
   * Returns whether a line is oneway, given the tags present.
   * @return `true` if the tags suggest that this is a oneway, `false` if not.
   */
  public isOneWay(): boolean {
    const context = this.context;
    const schema = context.systems.schema;
    const rulesets = schema?.getScope('osm')?.rulesets;

    return rulesets?.get('oneway_forward')?.match(this.tags)
      || rulesets?.get('oneway_backward')?.match(this.tags)
      || rulesets?.get('oneway_bidirectional')?.match(this.tags)
      || false;
  }

  /**
   * Returns whether a line is sided, given the tags present.
   * For a sided way, the direction that the way is drawn is significant.
   * Conventionally, the right side is the 'inside'/'lower'.
   * (e.g. the right side of a `natural=cliff` is lower).
   * @return `true` if the tags suggest that the line is sided, `false` if not.
   */
  public isSided(): boolean {
    const context = this.context;
    const schema = context.systems.schema;
    const rulesets = schema?.getScope('osm')?.rulesets;

    const sided = rulesets?.get('sided_right');
    if (!sided) return false;

    // Build tags with lifecycle prefixes stripped so rulesets can match
    const cleanedTags: Record<string, string> = {};
    for (const realKey in this.tags) {
      const key = schema!.removeLifecyclePrefix(realKey);
      cleanedTags[key] = this.tags[realKey];
    }

    return sided.match(cleanedTags);
  }

  /**
   * Returns lane information for the given way, given the tags present.
   * @return An object containing the lane details for this way
   */
  public lanes(): object | null {
    return osmLanes(this);
  }

  /**
   * A way is "closed" if the first and last nodeID is the same.
   * @return `true` if the way is closed, `false` if not
   */
  public isClosed(): boolean {
    return this.nodes.length > 1 && this.first() === this.last();
  }

  /**
   * Checks the node angles to determine if the way is a convex polygon or not.
   * @param graph - the Graph that holds the topology needed
   * @return `true` if the way is a convex polygon, `false` if concave polygon, `null` if unclosed or degenerate
   */
  public isConvex(graph: Graph): boolean | null {
    if (!this.isClosed() || this.isDegenerate()) return null;

    const nodes = utilArrayUniq(graph.childNodes(this));
    const coords = nodes.map(node => node.loc!);
    let curr: number;
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
   * Returns an Object with the tag that implies that this way is an area (polygon).
   * Checks the preset-derived `areaKeys` lookup, plus `areakeys_force_true` and
   * `areakeys_force_false` rulesets that override the normal areaKeys lookups.
   *
   * @param tags - Tags to check (defaults to `this.tags`)
   * @return The tag that indicates the area, or `null`
   */
  public tagSuggestingArea(tags?: OsmTags): OsmTags | null {
    if (!tags) tags = this.tags;
    if (tags.area === 'yes') return { area: 'yes' };
    if (tags.area === 'no') return null;

    const schema = this.context.systems.schema;
    const scope = schema?.getScope('osm');
    const areaKeys: TagKeyValueLookup = scope?.areaKeys ?? {};
    const forceTrue = scope?.rulesets.get('areakeys_force_true');
    const forceFalse = scope?.rulesets.get('areakeys_force_false');

    const returnTags: OsmTags = {};
    for (const realKey in tags) {
      const key = schema?.removeLifecyclePrefix(realKey) ?? realKey;
      const kv: OsmTags = { [key]: tags[realKey] };

      // Skip tags forced false (e.g. emergency=yes — key is in areaKeys but value is not an area)
      if (forceFalse?.match(kv)) continue;

      // Include tags forced true (e.g. highway=elevator — key is linear but value is an area)
      if (forceTrue?.match(kv)) {
        returnTags[realKey] = tags[realKey];
        return returnTags;
      }

      // Standard areaKeys lookup: key is in areaKeys and value is NOT in the discardlist
      if (key in areaKeys && !(tags[realKey] in areaKeys[key])) {
        returnTags[realKey] = tags[realKey];
        return returnTags;
      }
    }
    return null;
  }

  /**
   * Returns whether this way is a closed area (polygon), given the tags present.
   * @return `true` if the tags suggest that the way is an area, `false` if not.
   */
  public isArea(): boolean {
    if (this.tags.area === 'yes') return true;
    if (!this.isClosed() || this.tags.area === 'no') return false;
    return this.tagSuggestingArea() !== null;
  }

  /**
   * The way is "degenerate" if it is a line with <2 nodes or an area with <3 nodes.
   * @return `true` if the way is degenerate, `false` if not.
   */
  public isDegenerate(): boolean {
    const unique = new Set<EntityID>(this.nodes);
    return (unique.size < (this.isClosed() ? 3 : 2));
  }

  /**
   * Checks whether the given nodeIDs are adjacent in the node list.
   * @param n1
   * @param n2
   * @return `true` if the nodes are adjacent, `false` if not.
   */
  public isAdjacent(n1: EntityID, n2: EntityID): boolean {
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i] === n1) {
        if (this.nodes[i - 1] === n2) return true;
        if (this.nodes[i + 1] === n2) return true;
      }
    }
    return false;
  }

  /**
   * Returns 'area' if this way is an area (polygon), or 'line' if it is a line.
   * @param graph - the Graph that holds the topology needed
   * @return 'area' or 'line'
   */
  public geometry(graph: Graph): 'area' | 'line' {
    return this.transient('geometry', () => {
      return this.isArea() ? 'area' : 'line';
    });
  }

  /**
   * Returns an Array of Objects representing the segments between the nodes in this way
   * @param graph - the Graph that holds the topology needed
   * @return Array of segment data
   */
  public segments(graph: Graph): Segment[] {

    /**
     * Calculates the extent of this segment.
     * @param graph
     */
    function segmentExtent(this: Segment, graph: Graph): Extent | undefined {
      const n1 = graph.hasEntity(this.edge[0]) as OsmNode;
      const n2 = graph.hasEntity(this.edge[1]) as OsmNode;
      return n1?.loc && n2?.loc && new Extent(
        [ Math.min(n1.loc[0], n2.loc[0]), Math.min(n1.loc[1], n2.loc[1]) ],
        [ Math.max(n1.loc[0], n2.loc[0]), Math.max(n1.loc[1], n2.loc[1]) ]
      );
    }

    return this.transient('segments', () => {
      const segments: Segment[] = [];
      for (let i = 0; i < this.nodes.length - 1; i++) {
        segments.push({
          id: this.id + '-' + i,
          wayID: this.id,
          index: i,
          edge: [this.nodes[i], this.nodes[i + 1]],
          extent: segmentExtent
        });
      }
      return segments;
    });
  }

  /**
   * If this way is not closed, append the beginning node to the end of the nodelist to close it.
   * @return This Way, or a new Way that has a closed node list
   */
  public close(): OsmWay {
    if (this.isClosed() || !this.nodes.length) return this;

    let nodes = this.nodes.slice();
    nodes = nodes.filter(noRepeatNodes);
    nodes.push(nodes[0]);
    return this.update({ nodes: nodes });
  }

  /**
   * If this way is closed, remove any connector nodes from the end of the nodelist to unclose it.
   * @return This Way, or a new Way that has an unclosed node list
   */
  public unclose(): OsmWay {
    if (!this.isClosed()) return this;

    const connector = this.first()!;
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
   * Adds a nodeID in front of the node which is currently at position index.
   * If index is undefined, the node will be added to the end of the way for linear ways,
   *   or just before the final connecting node for circular ways.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is always preserved when adding a node.
   * @param nodeID - the nodeID to add
   * @param index - the index to add the node into the node list
   * @return A new Way copied from this Way, but with the updated node list
   * @throws Will throw if the given index is out of range 0..max
   */
  public addNode(nodeID: EntityID, index?: number): OsmWay {
    let nodes = this.nodes.slice();
    const isClosed = this.isClosed();
    const max = isClosed ? nodes.length - 1 : nodes.length;

    if (index === undefined) {
      index = max;
    }

    if (index < 0 || index > max) {
      throw new RangeError(`index ${index} out of range 0..${max}`);
    }

    // If this is a closed way, remove all connector nodes except the first one
    // (there may be duplicates) and adjust index if necessary..
    if (isClosed) {
      const connector = this.first()!;

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
   * Replaces the node which is currently at the given index with the given nodeID.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved when updating a node.
   * @param nodeID - the nodeID to add into the node list
   * @param index - the index to add the node into the node list
   * @return A new Way copied from this Way, but with the updated node list
   * @throws Will throw if the given index is out of range 0..max
   */
  public updateNode(nodeID: EntityID, index: number): OsmWay {
    let nodes = this.nodes.slice();
    const isClosed = this.isClosed();
    const max = nodes.length - 1;

    if (index === undefined || index < 0 || index > max) {
      throw new RangeError(`index ${index} out of range 0..${max}`);
    }

    // If this is a closed way, remove all connector nodes except the first one
    // (there may be duplicates) and adjust index if necessary..
    if (isClosed) {
      const connector = this.first()!;

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
   * Replaces each occurrence of nodeID needle with replacement.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved.
   * @param needleID - the nodeID to find
   * @param replacementID - the nodeID to replace it with
   * @return A new Way copied from this Way, but with the updated node list
   */
  public replaceNode(needleID: EntityID, replacementID: EntityID): OsmWay {
    let nodes = this.nodes.slice();
    const isClosed = this.isClosed();

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
   * Removes each occurrence of the given nodeID.
   * Consecutive duplicates are eliminated including existing ones.
   * Circularity is preserved.
   * @param nodeID - the nodeID to remove
   * @return A new Way copied from this Way, but with the updated node list
   */
  public removeNode(nodeID: EntityID): OsmWay {
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
}
