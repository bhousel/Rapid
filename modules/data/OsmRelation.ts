import { geoArea as d3_geoArea } from 'd3-geo';
import { geomPolygonContainsPolygon, geomPolygonIntersectsPolygon } from '@rapid-sdk/math';
import { OsmEntity, OsmEntityProps } from './OsmEntity.ts';
import { osmJoinWays } from '../lib/multipolygon.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONObject } from '../lib/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { EntityType } from './types.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Member of an OSM Relation.
 */
export interface OsmRelationMember {
  /** Entity ID of the member */
  id: EntityID;
  /** Type of the member entity */
  type: EntityType;
  /** Role of this member in the relation */
  role: string;
}

/**
 * Indexed member with additional index property.
 */
export interface IndexedMember extends OsmRelationMember {
  index: number;
}

/**
 * Properties for OsmRelation data elements.
 */
export interface OsmRelationProps extends OsmEntityProps {
  /** Array of relation members */
  members: OsmRelationMember[];
}


/**
 * This class contains the data for an OSM Relation.
 * @see https://wiki.openstreetmap.org/wiki/Relation
 *
 * Properties available:
 * - `geoms`    Geometry object (inherited from `AbstractData`)
 * - `props`    Properties object (inherited from `AbstractData`)
 * - `tags`     Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 * - `members`  Accessor for the members property, an Array of Objects with properties, `id`, `type`, `role`
 */
export class OsmRelation extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  public constructor(otherOrContext: OsmRelation | Context, props: Partial<OsmRelationProps> = {}) {
    super(otherOrContext, props);
    this.props.type = 'relation';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'r-' + this.context.next('relation');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;

    if (!(this.props as OsmRelationProps).members) {
      (this.props as OsmRelationProps).members = [];
    }
  }

  /**
   * get/set the members property
   * @return  Array of relation member descriptors
   * @readonly
   */
  public get members(): OsmRelationMember[] {
    return (this.props as OsmRelationProps).members;
  }

  /**
   * Returns a GeoJSON representation of the OsmRelation.
   * Relations are represented by either:
   *  a Feature with MultiPolygon geometry, or
   *  a FeatureCollection containing the Relation's child members.
   * @param graph - the Graph that holds the topology needed
   * @param seen - seen ids, used to avoid infinite loops and cycles.
   * @return GeoJSON representation of the OsmRelation
   */
  public asGeoJSON(graph: Graph, seen?: Set<EntityID>): GeoJSONObject {
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
          seen = new Set<EntityID>();
        }
        if (seen.has(this.id)) {
          return {} as GeoJSONObject;  // seen this already, avoid infinite loops and cycles
        } else {
          seen.add(this.id);
        }

        const features: any[] = [];
        for (const member of this.members) {
          const entity = graph.hasEntity(member.id) as any;
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
   * Returns a JXON representation of the OsmRelation.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @param changesetID - optional changeset ID to include in the output
   * @return JXON representation of the OsmRelation
   */
  public asJXON(changesetID?: string): Record<string, unknown> {
    const result: any = {
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
        }),
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
   * Makes a (mostly) deep copy of an OSM Entity.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param fromGraph - The Graph that owns the source object (needed for some data types)
   * @param memo - An Object to store seen copies (to prevent circular/infinite copying)
   * @return a copy of this OsmRelation
   */
  public copy(fromGraph: Graph, memo: Record<string, OsmEntity> = {}): OsmRelation {
    if (memo[this.id]) {
      return memo[this.id] as OsmRelation;
    }

    // copy self
    const copy = new OsmRelation(this, { id: undefined, user: undefined, version: undefined, v: undefined } as any);
    memo[this.id] = copy;

    // copy members too
    const members: OsmRelationMember[] = [];
    for (const member of this.members) {
      const source = fromGraph.entity(member.id) as any;
      const result = source.copy(fromGraph, memo);
      members.push({ ...member, id: result.id });
    }
    (copy.props as OsmRelationProps).members = members;
    return copy;
  }


  /**
   * Returns 'area' if this Relation is a multipolygon, or 'relation' otherwise.
   * @param graph - the Graph that holds the topology needed
   * @return 'area' or 'relation'
   */
  public geometry(graph?: Graph): 'area' | 'relation' {
    return this.transient('geometry', () => {
      return this.isMultipolygon() ? 'area' : 'relation';
    });
  }

  /**
   * A relation is "degenerate" it has no members.
   * @return `true` if the relation is degenerate, `false` if not.
   */
  public isDegenerate(): boolean {
    return this.members.length === 0;
  }

  /**
   * Return an array of members, each extended with an `index` property whose value
   * is the member index.
   * @return An Array of members, including an `index` property
   */
  public indexedMembers(): IndexedMember[] {
    const result: IndexedMember[] = new Array(this.members.length);
    for (let i = 0; i < this.members.length; i++) {
      result[i] = { ...this.members[i], index: i };
    }
    return result;
  }

  /**
   * Return the first member with the given role. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param role - The role to search for
   * @return The member with the given role, including an `index` property
   */
  public memberByRole(role: string): IndexedMember | undefined {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        return { ...this.members[i], index: i };
      }
    }
  }

  /**
   * Same as `memberByRole`, but returns all members with the given role.
   * @param role - The role to search for
   * @return An Array of members, including an `index` property
   */
  public membersByRole(role: string): IndexedMember[] {
    const results: IndexedMember[] = [];
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].role === role) {
        results.push({ ...this.members[i], index: i });
      }
    }
    return results;
  }

  /**
   * Return the first member with the given id. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param id - The id to search for
   * @return The member with the given id, including an `index` property
   */
  public memberById(id: EntityID): IndexedMember | undefined {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id) {
        return { ...this.members[i], index: i };
      }
    }
  }

  /**
   * Return the first member with the given id and role. A copy of the member object
   * is returned, extended with an `index` property whose value is the member index.
   * @param id - The id to search for
   * @param role - The role to search for
   * @return The member with the given id, including an `index` property
   */
  public memberByIdAndRole(id: EntityID, role: string): IndexedMember | undefined {
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i].id === id && this.members[i].role === role) {
        return { ...this.members[i], index: i };
      }
    }
  }

  /**
   * Inserts a member into the members list at the given index.
   * If index is undefined, the member will be added to the end of the members list.
   * @param member - the member to add
   * @param index - the index to insert at, or `undefined`
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public addMember(member: OsmRelationMember, index?: number): OsmRelation {
    const members = this.members.slice();
    members.splice(index === undefined ? members.length : index, 0, member);
    return this.update({ members: members });
  }

  /**
   * Replaces the member which is currently at the given index with the given member.
   * @param member - the member to add
   * @param index - the index to replace
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public updateMember(member: Partial<OsmRelationMember>, index: number): OsmRelation {
    const members = this.members.slice();
    members.splice(index, 1, { ...members[index], ...member });
    return this.update({ members: members });
  }

  /**
   * Removes the member at the given index.
   * @param index - the index to remove
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public removeMember(index: number): OsmRelation {
    const members = this.members.slice();
    members.splice(index, 1);
    return this.update({ members: members });
  }

  /**
   * Removes any members from the member list with the given id.
   * @param id - the id to search for
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public removeMembersWithID(id: EntityID): OsmRelation {
    const members = this.members.filter(m => m.id !== id);
    return this.update({ members: members });
  }

  /**
   * Moves a members from one index in the members list to another.
   * @param fromIndex - the index to move it from
   * @param toIndex - the index to move it to
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public moveMember(fromIndex: number, toIndex: number): OsmRelation {
    const members = this.members.slice();
    members.splice(toIndex, 0, members.splice(fromIndex, 1)[0]);
    return this.update({ members: members });
  }

  /**
   * Wherever a member appears with id `needle.id`, replace it with a member
   * with id `replacement.id`, type `replacement.type`, and the original role,
   * By default, adding a duplicate member (by id and role) is prevented.
   * @param needle - the member to find
   * @param needle.id
   * @param replacement - the member to replace it with
   * @param replacement.id
   * @param replacement.type
   * @param keepDuplicates - `true` to preserve duplicate members
   * @return A new Relation copied from this Relation, but with the updated members list
   */
  public replaceMember(needle: { id: EntityID }, replacement: { id: EntityID; type: EntityType }, keepDuplicates?: boolean): OsmRelation {
    if (!this.memberById(needle.id)) return this;

    const members: OsmRelationMember[] = [];

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
   * Returns whether this relation is an OSM multipolygon, given the tags present.
   * @return `true` if the relation is a multipolygon, `false` if not.
   */
  public isMultipolygon(): boolean {
    return this.tags.type === 'multipolygon';
  }

  /**
   * Returns whether this relation's members all exist in the given graph.
   * Because OSM Relations are downloaded lazily, the members may not all exist in the graph
   *  until the relation has been fully downloaded.
   * @param graph - the Graph that holds the topology needed
   * @return `true` if the all members are present in the graph, `false` if not
   */
  public isComplete(graph: Graph): boolean {
    for (const member of this.members) {
      if (!graph.hasEntity(member.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns whether this relation has members with 'from', 'via', and 'to' roles.
   * These roles are required for `restriction` or `manoeuvre` relations.
   * @return `true` if the all members are present in the graph, `false` if not
   */
  public hasFromViaTo(): boolean {
    return (
      this.members.some(m => m.role === 'from') &&
      this.members.some(m => m.role === 'via') &&
      this.members.some(m => m.role === 'to')
    );
  }

  /**
   * Returns whether this relation is a 'connectivity' relation, given the tags present.
   * @return `true` if the relation is a connectivity relation, `false` if not.
   */
  public isConnectivity(): boolean {
    return /^connectivity:?/.test(this.tags.type);
  }

  /**
   * Returns whether this relation is a 'restriction' relation, given the tags present.
   * @return `true` if the relation is a restriction relation, `false` if not.
   */
  public isRestriction(): boolean {
    return /^restriction:?/.test(this.tags.type);
  }

  /**
   * Returns whether this relation is a valid 'restriction' relation, given the tags present.
   * Valid restrictions have a 'restriction' type and an appropriate amount of 'from', 'via', 'to' members.
   * @return `true` if the relation is a valid restriction relation, `false` if not.
   */
  public isValidRestriction(): boolean {
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
   * @param graph - the Graph that holds the topology needed
   * @return An array of closed rings
   */
  public multipolygon(graph: Graph): Vec2[][][] {
    let outers: any[] = this.members.filter(m => 'outer' === (m.role || 'outer'));
    let inners: any[] = this.members.filter(m => 'inner' === m.role);

    outers = osmJoinWays(outers, graph);
    inners = osmJoinWays(inners, graph);

    /**
     *
     * @param sequence
     */
    function sequenceToLineString(sequence: any): Vec2[] {
      // close unclosed parts to ensure correct area rendering - iD#2945
      if (sequence.nodes.length > 2 && sequence.nodes.at(0) !== sequence.nodes.at(-1)) {
        sequence.nodes.push(sequence.nodes.at(0));
      }
      return sequence.nodes.map((node: any) => node.loc);
    }

    outers = outers.map(sequenceToLineString);
    inners = inners.map(sequenceToLineString);

    const result: Vec2[][][] = outers.map(o => {
      // Heuristic for detecting counterclockwise winding order. Assumes
      // that OpenStreetMap polygons are not hemisphere-spanning.
      return [d3_geoArea({ type: 'Polygon', coordinates: [o] }) > 2 * Math.PI ? o.reverse() : o];
    });

    /**
     *
     * @param inner
     */
    function findOuter(inner: Vec2[]): number | undefined {
      let o: number;
      let outer: Vec2[];
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

    for (let inner of inners) {
      if (d3_geoArea({ type: 'Polygon', coordinates: [inner] }) < 2 * Math.PI) {
        inner = inner.reverse();
      }

      const o = findOuter(inner);
      if (o !== undefined) {
        result[o].push(inner);
      } else {
        result.push([inner]); // Invalid geometry
      }
    }

    return result;
  }

}
