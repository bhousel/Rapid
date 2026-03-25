import { Extent } from '@rapid-sdk/math';

import { operationDelete } from '../operations/delete.js';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction } from './types.ts';


/**
 * Factory that creates a validator for detecting routing islands — routable
 * features (highways, ferries) that are disconnected from the wider road network.
 * @param context
 * @returns Validator function
 */
export function validateDisconnectedWay(context: Context): ValidatorFunction {
  const type = 'disconnected_way' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const map = context.systems.map;
  const schema = context.systems.schema;


  /**
   * Tests whether an entity's highway tag matches a known routable highway.
   * @param entity - The entity to check
   * @returns `true` if the entity is tagged as a routable highway
   */
  function isTaggedAsHighway(entity: OsmEntity): boolean {
    return !!schema!.getScope('osm').rulesets.get('connected_highway')?.match({ highway: entity.tags.highway });
  }


  /**
   * Checks whether a routable entity belongs to a routing island — a group
   * of interconnected routable features with no connection to the wider network.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Array of issues for disconnected routing islands
   */
  const validator = function checkDisconnectedWay(entity: OsmEntity, graph: Graph): ValidationIssue[] {
    if (!schema) return [];

    const routingIslandEntities = routingIslandForEntity(entity);
    if (!routingIslandEntities) return [];

    return [new ValidationIssue(context, {
      type: type,
      subtype: 'highway',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = this.entityIds.length && graph.hasEntity(this.entityIds[0]);
        const label = entity && l10n.displayLabel(entity, graph);
        return l10n.t('issues.disconnected_way.routable.message', { count: this.entityIds.length, highway: label });
      },
      reference: showReference,
      entityIds: Array.from(routingIslandEntities).map(entity => entity.id),
      dynamicFixes: makeFixes
    })];


    /**
     * Generates fixes for a disconnected routing island.
     * @returns Array of fixes: continue drawing, connect, or delete
     */
    function makeFixes(this: any): ValidationFix[] {
      const graph = editor.staging.graph;
      const singleEntity = this.entityIds.length === 1 && graph.hasEntity(this.entityIds[0]);
      const fixes = [];

      if (singleEntity) {
        if (singleEntity.type === 'way' && !(singleEntity as OsmWay).isClosed()) {
          const startFix = makeContinueDrawingFixIfAllowed((singleEntity as OsmWay).first()!, 'start');
          if (startFix) fixes.push(startFix);

          const endFix = makeContinueDrawingFixIfAllowed((singleEntity as OsmWay).last()!, 'end');
          if (endFix) fixes.push(endFix);
        }
        if (!fixes.length) {
          fixes.push(new ValidationFix({
            title: l10n.t('issues.fix.connect_feature.title')
          }));
        }

        fixes.push(new ValidationFix({
          icon: 'rapid-operation-delete',
          title: l10n.t('issues.fix.delete_feature.title'),
          entityIds: [ singleEntity.id ],
          onClick: function(this: any) {
            const id = this.issue.entityIds[0];
            const operation = operationDelete(context, [id]);
            if (!operation.disabled()) {
              operation();
            }
          }
        }));
      } else {
        fixes.push(new ValidationFix({
          title: l10n.t('issues.fix.connect_features.title')
        }));
      }

      return fixes;
    }


    /** Renders the issue reference text into the given selection. */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.disconnected_way.routable.reference'));
    }


    /**
     * Performs a flood-fill traversal from the entity, collecting all
     * reachable routable features. Returns `null` if a connection to the
     * wider network is found; otherwise returns the routing island members.
     * @param entity - The starting entity
     * @returns Set of island entities, or `null` if connected
     */
    function routingIslandForEntity(entity: OsmEntity): Set<OsmEntity> | null {
      const routingIsland = new Set<OsmEntity>();  // the interconnected routable features
      const waysToCheck: OsmWay[] = [];           // the queue of remaining routable ways to traverse

      /** Queues parent ways of the node for traversal. */
      function queueParentWays(node: OsmNode): void {
        for (const parentWay of graph.parentWays(node)) {
          if (!routingIsland.has(parentWay) && isRoutableWay(parentWay, false)) {
            routingIsland.add(parentWay);
            waysToCheck.push(parentWay);
          }
        }
      }

      if (entity.type === 'way' && isRoutableWay(entity as OsmWay, true)) {
        routingIsland.add(entity);
        waysToCheck.push(entity as OsmWay);

      } else if (entity.type === 'node' && isRoutableNode(entity as OsmNode)) {
        routingIsland.add(entity);
        queueParentWays(entity as OsmNode);

      } else {    // this feature isn't routable, cannot be a routing island
        return null;
      }


      while (waysToCheck.length) {
        const way = waysToCheck.pop();
        for (const vertex of graph.childNodes(way!)) {
          if (isConnectedVertex(vertex)) {
            return null;  // found a link to the wider network, not a routing island
          }

          if (isRoutableNode(vertex)) {
            routingIsland.add(vertex);
          }

          queueParentWays(vertex);
        }
      }

      // no network link found, this is a routing island, return its members
      return routingIsland;
    }


    /**
     * Tests whether a vertex is connected to the wider road network
     * via entrances, parking entrances, or unloaded tiles.
     * @param vertex - The vertex to check
     * @returns `true` if the vertex is considered connected
     */
    function isConnectedVertex(vertex: OsmNode): boolean {
      // Assume ways overlapping unloaded tiles are connected to the wider road network. - iD#5938
      // Don't worry, as more map tiles are loaded, we'll have additional chances to validate it.
      const osm = context.services.osm;
      if (osm && !osm.isDataLoaded(vertex.loc!)) return true;

      // entrances are considered connected
      if (vertex.tags.entrance && vertex.tags.entrance !== 'no') return true;
      if (vertex.tags.amenity === 'parking_entrance') return true;

      return false;
    }


    /**
     * Tests whether a node is a distinct routable feature (e.g. elevator).
     * @param node - The node to check
     * @returns `true` if the node is a routable feature
     */
    function isRoutableNode(node: OsmNode): boolean {
      // treat elevators as distinct features in the highway network
      if (node.tags.highway === 'elevator') return true;
      return false;
    }


    /**
     * Tests whether a way is routable (highway, ferry route, or part of
     * a highway multipolygon or ferry route relation).
     * @param way - The way to check
     * @param ignoreInnerWays - If `true`, skip inner members of multipolygons
     * @returns `true` if the way is routable
     */
    function isRoutableWay(way: OsmWay, ignoreInnerWays: boolean): boolean {
      if (isTaggedAsHighway(way) || way.tags.route === 'ferry') return true;

      return graph.parentRelations(way).some(parentRelation => {
        if (parentRelation.tags.type === 'route' &&
          parentRelation.tags.route === 'ferry') return true;

        if (parentRelation.isMultipolygon() &&
          isTaggedAsHighway(parentRelation) &&
          (!ignoreInnerWays || parentRelation.memberById(way.id)?.role !== 'inner')) return true;

        return false;
      });
    }


    /**
     * Creates a "continue drawing" fix for a vertex endpoint if allowed.
     * @param vertexID - The endpoint vertex to continue from
     * @param whichEnd - Must be 'start' or 'end'
     * @returns A validation fix, or `null` if drawing cannot continue
     */
    function makeContinueDrawingFixIfAllowed(vertexID: EntityID, whichEnd: 'start' | 'end'): ValidationFix | null {
      const vertex = graph.hasEntity(vertexID);
      if (!vertex || vertex.tags.noexit === 'yes') return null;

      const isRTL = l10n.isRTL;
      const useLeftContinue = (whichEnd === 'start' && !isRTL) || (whichEnd === 'end' && isRTL);

      return new ValidationFix({
        icon: 'rapid-operation-continue' + (useLeftContinue ? '-left' : ''),
        title: l10n.t(`issues.fix.continue_from_${whichEnd}.title`),
        entityIds: [vertexID],
        onClick: function(this: any) {
          const graph = editor.staging.graph;
          const wayID = this.issue.entityIds[0];
          const way = graph.hasEntity(wayID);
          const vertexID = this.entityIds[0];
          const vertex = graph.hasEntity(vertexID);
          if (!way || !vertex) return;

          // make sure the vertex is actually visible and editable
          if (!context.editable() || !(map!.trimmedExtent() as Extent).contains(new Extent((vertex as OsmNode).loc!))) {
            map!.fitEntitiesEase(vertex);
          }

          context.enter('draw-line', { continueWayID: way.id, continueNodeID: vertex.id });
        }
      });
    }
  };


  validator.type = type;

  return validator;
}
