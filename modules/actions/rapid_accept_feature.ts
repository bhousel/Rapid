import { GeoJSONData, OsmEntity, OsmNode, OsmRelation, OsmWay } from '../data/index.ts';
import { Graph } from '../lib/Graph.ts';
import { validateAlmostJunction } from '../validators/almost_junction.ts';
import { validateCrossingWays } from '../validators/crossing_ways.ts';

import type { Action } from './types.ts';
import type { Context } from '../Context.ts';
import type { EntityType, OsmRelationMember, OsmTags } from '../data/types.ts';
import type { RapidDataDictionary } from '../lib/index.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Extended Action that includes additional methods.
 */
export interface RapidAcceptAction extends Action {
  /** Returns the full set of entityIDs accepted */
  getAllIDs(): Set<EntityID>;
}


/**
 * Accepts a Rapid feature from an external dataset into the main graph.
 * Handles nodes, ways, and relations, including connection points to existing ways.
 * @param   datum  - Data to accept - should be OSMEntity-like or GeoJSONData-like.
 * @return  An Action function that adds the given Rapid feature to the main graph
 */
export function actionRapidAcceptFeature(datum: OsmEntity | GeoJSONData): RapidAcceptAction {

  const old2new = new Map<EntityID, EntityID>();  // oldid to newid
  const allIDs = new Set<EntityID>();

  const action: RapidAcceptAction = ((graph: Graph): Graph => {

    const context = graph.context;
    const rapid = context.systems.rapid!;

    const datasetID = datum.props.datasetID as DatasetID;
    const dataset = rapid.catalog.get(datasetID);
    const dictionary = dataset?.dictionary;
    const spatialID = dataset?.spatialID;
    if (!dataset || !dictionary || !spatialID) return graph;

    // If we end up accepting a new way, trigger the autoconnect code below.
    let newWay: OsmWay | undefined;
    let newEntities: OsmEntity[] | undefined | null;

    // Data is "GeoJSON-like".  Convert it to OSM Entities.
    if (datum instanceof GeoJSONData) {
      newEntities = acceptGeoJSON(context, dictionary, datum);

    // Data is already "OSM-like" - we should expect to find a graph that holds the OSM Entities.
    } else if (datum instanceof OsmEntity) {
      const serviceID = datum.props.serviceID as ServiceID;
      const service = context.services[serviceID] as any;
      if (typeof service?.graph !== 'function') return graph;  // bail out

      const extGraph = service.graph(datasetID);
      const extEntity = extGraph?.entity(datum.id);
      if (!extEntity || !extGraph) return graph;   // bail out

      if (extEntity.type === 'node') {
        newEntities = acceptNode(extEntity as OsmNode, extGraph);
      } else if (extEntity.type === 'way') {
        newEntities = acceptWay(extEntity as OsmWay, extGraph);
      } else if (extEntity.type === 'relation') {
        newEntities = acceptRelation(extEntity as OsmRelation, extGraph);
      }
    }

    if (!newEntities?.length) return graph;  // nothing to do
    graph.replace(newEntities);

    if (newEntities.at(-1) instanceof OsmWay) {
      newWay = newEntities.at(-1) as OsmWay;
    }

    if (newWay) {
      attemptAutoconnect(newWay, graph);
    }

    return graph.commit();


    /**
     * Copies an external node, stripping any metadata.
     * @param   extNode - The external OsmNode to accept
     * @param   extGraph - The external Graph to accept from
     * @return  Array containing the newly-created node
     */
    function acceptNode(extNode: OsmNode, extGraph: Graph): OsmEntity[] {
      const n = new OsmNode(extNode);   // copy external node
      old2new.set(extNode.id, n.id);
      allIDs.add(n.id);
      n.props.tags = dictionary!.applyTransforms(extNode.tags);
      removeMetadata(n);
      return [n];
    }


    /**
     * Copies an external way and child nodes, stripping any metadata.
     * @param   extWay - The external OsmWay to accept
     * @param   extGraph - The external Graph to accept from
     * @return  Array containing newly-created nodes and ways
     */
    function acceptWay(extWay: OsmWay, extGraph: Graph): OsmEntity[] {
      const w = new OsmWay(extWay);   // copy external way
      old2new.set(extWay.id, w.id);
      allIDs.add(w.id);
      w.props.tags = dictionary!.applyTransforms(extWay.tags);
      removeMetadata(w);

      const newEntities: OsmEntity[] = [];
      const newNodeIDs: EntityID[] = [];
      for (const extNodeID of w.nodes) {
        const newNodes = acceptNode(extGraph!.entity(extNodeID) as OsmNode, extGraph);
        newEntities.push(newNodes[0]);
        newNodeIDs.push(newNodes[0].id);
      }

      w.props.nodes = newNodeIDs;
      newEntities.push(w);
      return newEntities;
    }


    /**
     * Recursively copies an external Relation and all child members, stripping metadata.
     * @param   extRelation - The external OsmRelation to accept
     * @param   extGraph - The external Graph to accept from
     * @return  Array containing the newly-created Entities
     */
    function acceptRelation(extRelation: OsmRelation, extGraph: Graph): OsmEntity[] {
      if (old2new.has(extRelation.id)) return [];   // done already, avoid recursion

      const r = new OsmRelation(extRelation);  // copy external relation
      old2new.set(extRelation.id, r.id);
      allIDs.add(r.id);
      r.props.tags = dictionary!.applyTransforms(extRelation.tags);
      removeMetadata(r);

      const newEntities: OsmEntity[] = [];
      const newMembers: OsmRelationMember[] = [];
      for (const extMember of r.members) {
        const extEntity = extGraph!.entity(extMember.id);

        if (extEntity.type === 'node') {
          newEntities.push( ...acceptNode(extEntity as OsmNode, extGraph) );
        } else if (extEntity.type === 'way') {
          newEntities.push( ...acceptWay(extEntity as OsmWay, extGraph) );
        } else if (extEntity.type === 'relation') {
          newEntities.push( ...acceptRelation(extEntity as OsmRelation, extGraph) );
        } else {
          continue;  // skip unknown types
        }

        const newID = old2new.get(extMember.id);
        if (newID) {
          newMembers.push(Object.assign(extMember, { id: newID }));
        }
      }

      r.props.members = newMembers;
      newEntities.push(r);
      return newEntities;
    }


    /**
     * After adding a way, automatically connect it to existing features.
     * @param  way   - the newly accepted OsmWay
     * @param  graph - the current Graph
     */
    function attemptAutoconnect(way: OsmWay, graph: Graph): void {
      const context = graph.context;
      const rapid = context.systems.rapid;
      const spatial = context.systems.spatial;
      const settings = context.systems.settings;

      const doAutoconnect = settings?.get('poweruser.autoConnect') === 'true';
      if (!doAutoconnect || !rapid || !spatial) return;

      graph = graph.commit();

      // 1. If there are unaccepted nodes in the external dataset at the same location as
      // the node that we just added, mark them accepted also and import their tags.
      for (const nodeID of way.nodes) {
        const node = graph.entity(nodeID) as OsmNode;
        const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
        if (!coord) continue;

        const extHits = spatial.getItemsAtCoord(spatialID!, coord);
        for (const hit of extHits) {
          const other = hit.contents as OsmEntity | GeoJSONData;
          const otherID = other.id;
          // TODO this should work for geojson-like data too
          if (other.type !== 'node') continue;
          if (rapid.acceptIDs.has(otherID) || rapid.ignoreIDs.has(otherID) || allIDs.has(otherID)) continue;

          const extNode = other as OsmNode;
          const copy = new OsmNode(extNode);   // copy node before modifying
          old2new.set(extNode.id, copy.id);
          allIDs.add(copy.id);
          copy.props.tags = dictionary!.applyTransforms(extNode.tags);
          removeMetadata(copy);
          // merge the tags into the existing node
          for (const [k, v] of Object.entries(copy.props?.tags ?? {})) {
            node.props.tags![k] = v;
          }
          node.touch();
          graph.replace(node);
        }
      }

      // 2. Run the validator for almost junction and autofix whatever it found.
      const checkAlmostJunction = validateAlmostJunction(context);
      for (const issue of checkAlmostJunction(way, graph).issues) {
        if (issue.autoArgs) {
          graph = issue.autoArgs[0](graph);   // autoArgs = [action, annotation]
        }
      }

      // 3. Run the validator for crossing ways and autofix whatever it found.
      const checkCrossingWays = validateCrossingWays(context);
      for (const issue of checkCrossingWays(way, graph).issues) {
        if (issue.autoArgs) {
          graph = issue.autoArgs[0](graph);   // autoArgs = [action, annotation]
        }
      }
    }

  }) as RapidAcceptAction;


  /**
   * Accessor to get _all_ the ids that were accepted by the action.
   * When accepting a way, we also accept child nodes.
   * When accepting a relation, we also accept child members.
   * When autoconnecting, we also try to accept other nodes that are in the same place as the accepted nodes.
   * @return  Set of all ids that were accepted (not just the Entity that the user clicked on)
   */
  action.getAllIDs = () => allIDs;

  return action;


  /**
   * Deletes all Rapid-specific metadata from an entity's props and tags in place.
   * @param  entity - The entity to strip metadata from (mutated in place)
   */
  function removeMetadata(entity: OsmEntity): void {
    const props = entity.props as Record<string, unknown>;
    const tags = props.tags as OsmTags;

    delete props.fbID;
    delete props.serviceID;
    delete props.datasetID;
    delete tags.conn;
    delete tags.orig_id;
    delete tags.debug_way_id;
    delete tags.import;
    delete tags.dupe;
  }


  /**
   * Convert a GeoJSONData feature to OSM Entities.
   * @param context
   * @param dictionary - data dictionary, needed to convert source tags into target tags
   * @param data - the GeoJSON feature that we fetched
   * @return An array of OSMEntities for that feature, or `null` if we skipped it
   */
  function acceptGeoJSON(context: Context, dictionary: RapidDataDictionary, data: GeoJSONData): OsmEntity[] | null {

    // NOTE:  Expect a single part - No Multitypes for now (maybe not needed)
    const geom = data.geoms.parts[0];
    const orig = geom?.orig;   // original WGS84 data
    if (!orig) return null;

    const newEntities: OsmEntity[] = [];
    const nodemap = new Map<string, OsmNode>();

    // Convert source properties to target tags
    const tags = dictionary.applyTransforms(data.properties ?? {});

    // Point:  make a single node
    if (geom.type === 'Point') {
      const n = new OsmNode(context, { loc: orig.coords as Vec2, tags: tags });
      allIDs.add(n.id);
      return [n];

    // LineString:  make nodes, single way
    } else if (geom.type === 'LineString') {
      const nodelist = acceptCoordinates(orig.coords as Vec2[]);
      if (nodelist.length < 2) return null;

      const w = new OsmWay(context, { nodes: nodelist, tags: tags });
      allIDs.add(w.id);
      newEntities.push(w);
      return newEntities;

    // Polygon:  make nodes, way(s), possibly a relation
    } else if (geom.type === 'Polygon') {
      const ways: OsmWay[] = [];
      for (const ring of orig.coords ?? []) {
        const nodelist = acceptCoordinates(ring as Vec2[]);
        if (nodelist.length < 3) continue;

        const first = nodelist.at(0)!;
        const last = nodelist.at(-1)!;
        if (first !== last) {
          nodelist.push(first);   // sanity check, ensure rings are closed
        }

        const w = new OsmWay(context, { nodes: nodelist });
        ways.push(w);
      }

      if (ways.length === 1) {  // single ring, assign tags and return
        const w = ways[0];
        w.props.tags = tags;
        allIDs.add(w.id);
        newEntities.push(w);
      } else {  // multiple rings, make a multipolygon relation with inner/outer members
        const members = ways.map((w, i) => {
          allIDs.add(w.id);
          newEntities.push(w);
          return {
            id: w.id,
            role: (i === 0 ? 'outer' : 'inner'),
            type: 'way' as EntityType
          };
        });
        tags.type = 'multipolygon';
        const r = new OsmRelation(context, { members: members, tags: tags });
        allIDs.add(r.id);
        newEntities.push(r);
      }

      return newEntities;
    }

    return null;


    /**
     * Parse GeoJSON coordinate data into OSM Nodes.
     * Accepts a LineString coordinates or single Polygon coordinate ring
     * @param coords
     */
    function acceptCoordinates(coords: GeoJSON.Position[]): EntityID[] {
      const nodelist: EntityID[] = [];
      for (const coord of coords) {
        const key = coord.toString();
        let n = nodemap.get(key);
        if (!n) {
          n = new OsmNode(context, { loc: coord as Vec2 });
          allIDs.add(n.id);
          newEntities.push(n);
          nodemap.set(key, n);
        }
        nodelist.push(n.id);
      }
      return nodelist;
    }
  }



}

