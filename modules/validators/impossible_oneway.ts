import { Extent } from '@rapid-sdk/math';

import { actionReverse } from '../actions/reverse.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting oneway roads and waterways
 * whose start or end nodes connect only to other oneways in a way that
 * makes the feature unreachable or inescapable.
 * @param context
 * @returns Validator function
 */
export function validateImpossibleOneway(context: Context): ValidatorFunction {
  const type = 'impossible_oneway' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;


  /**
   * Checks whether a oneway road or waterway has unreachable or inescapable endpoints.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkImpossibleOneway(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };

    if (!schema) return result;
    if (entity.type !== 'way' || entity.geometry(graph) !== 'line') return result;

    const way = entity as OsmWay;
    if (way.isClosed()) return result;
    if (!typeForWay(way)) return result;
    if (!way.isOneWay()) return result;
    if (
      entity.tags.oneway === 'alternating' ||
      entity.tags.oneway === 'reversible' ||
      entity.tags.intermittent === 'yes'      // Ignore intermittent waterways - Rapid#1018
    ) return result;

    const firstIssues = issuesForNode(way, way.first()!);
    const lastIssues = issuesForNode(way, way.last()!);
    result.issues = [...firstIssues, ...lastIssues];
    return result;


    /**
     * Returns whether the way is a 'highway' or 'waterway'.
     * @param way - The way to classify
     * @returns 'highway', 'waterway', or `null`
     */
    function typeForWay(way: OsmWay): 'highway' | 'waterway' | null {
      if (way.geometry(graph) !== 'line') return null;

      const rulesets = schema!.getScope('osm').rulesets;

      const routable = rulesets.get('connected_highway');
      if (routable?.match({ highway: way.tags.highway })) {
        return 'highway';
      }

      const flowing = rulesets.get('connected_waterway');
      if (flowing?.match({ waterway: way.tags.waterway })) {
        return 'waterway';
      }

      return null;
    }


    /**
     * Checks if a node occurs more than once in a way.
     * We skip checks on such nodes because they indicate self-connecting ways.
     *
     * For example, a way that starts/ends in its middle:
     *
     * A --> B --> +
     *       |     |
     *       + <-- +
     *
     * @param way - The way to check
     * @param nodeID - The node to look for
     * @returns `true` if the node occurs more than once
     */
    function nodeOccursMoreThanOnce(way: OsmWay, nodeID: EntityID): boolean {
      return (way.nodes.indexOf(nodeID) !== way.nodes.lastIndexOf(nodeID));
    }


    /**
     * Returns `true` if the node is connected (reachable/escapable) based on its
     * tagging or what type of features it is attached to.
     * @param way - The oneway being checked
     * @param node - The node to evaluate
     * @param isHead - `true` if this node is at the head of the oneway
     * @returns `true` if this node is considered connected
     */
    function isNodeTaggedAsConnected(way: OsmWay, node: OsmNode, isHead: boolean): boolean {
      const wayType = typeForWay(way);

      if (wayType === 'highway') {
        // entrances are considered connected
        if (node.tags.entrance && node.tags.entrance !== 'no') return true;
        if (node.tags.amenity === 'parking_entrance') return true;

      } else if (wayType === 'waterway') {
        if (isHead) {
          // multiple waterways may start at the same spring
          if (node.tags.natural === 'spring') return true;
        } else {
          // multiple waterways may end at the same drain
          if (node.tags.manhole === 'drain') return true;
        }
      }

      return graph.parentWays(node).some(parentWay => {
        if (parentWay.id === way.id) return false;

        if (wayType === 'highway') {
          const routable = schema!.getScope('osm').rulesets.get('connected_highway');

          // allow connections to highway areas
          if (parentWay.geometry(graph) === 'area' && routable?.match({ highway: parentWay.tags.highway })) return true;
          // consider connections to ferry routes as connected
          if (parentWay.tags.route === 'ferry') return true;

          return graph.parentRelations(parentWay).some(parentRelation => {
            if (parentRelation.tags.type === 'route' && parentRelation.tags.route === 'ferry') return true;
            // allow connections to highway multipolygons
            return parentRelation.isMultipolygon() && routable?.match({ highway: parentRelation.tags.highway });
          });
        } else if (wayType === 'waterway') {
          // multiple waterways may start or end at a water body at the same node
          if (parentWay.tags.natural === 'water' || parentWay.tags.natural === 'coastline') return true;
        }
        return false;
      });
    }


    /**
     * Detects issues at the given node of a oneway.
     * Called twice per way: once for the start node, once for the end node.
     * The start/end nodes function as head or tail depending on whether
     * the way is tagged as a normal oneway or reverse oneway (see Rapid#1302).
     * @param way - The oneway to check
     * @param nodeID - The node to check (either start or end)
     * @returns Array of validation issues detected at this node
     */
    function issuesForNode(way: OsmWay, nodeID: EntityID): ValidationIssue[] {
      const isHead = (nodeID === way.first() && way.tags.oneway !== '-1');
      const isTail = !isHead;
      const wayType = typeForWay(way);

      // Skip checks if the way is self-connected at this node.
      if (nodeOccursMoreThanOnce(way, nodeID)) return [];

      const osm = context.services.osm;
      if (!osm) return [];

      const node = graph.hasEntity(nodeID) as OsmNode;

      // Bail out if map not fully loaded here - we won't know all the node's parentWays.
      // Don't worry, as more map tiles are loaded, we'll have additional chances to validate it.
      if (!node || !osm.isDataLoaded(node.loc!)) return [];

      // Some tags imply that the node is connected and we can stop here.
      if (isNodeTaggedAsConnected(way, node, isHead)) return [];

      // Collect other ways of the same type (highway or waterway).
      const attachedWaysOfSameType = graph.parentWays(node).filter(other => {
        if (other.id === way.id) return false;  // ignore self
        return typeForWay(other) === wayType;
      });

      // Assume it's okay for waterways to start or end disconnected for now.
      if (wayType === 'waterway' && attachedWaysOfSameType.length === 0) return [];

      // No issues if this oneway is connected to non-oneway features of the same type.
      const attachedOneways = attachedWaysOfSameType.filter(other => other.isOneWay());
      if (attachedOneways.length < attachedWaysOfSameType.length) return [];

      // Finally, check how this oneway attaches to the other oneways.
      // Allow anything except for head-head or tail-tail.
      //
      // It is still possible to construct some unescapable geometries that satisfy this check.
      // For example, where heads/tails attach to middles
      //
      //    a -> b -> c -> d               w1: [a,b,c,d,x]
      //          \         \              w2: [w,x,y,z,b]
      //           z <- y <- x <- w

      for (const other of attachedOneways) {
        // Again, skip checks on self-connected ways
        if (nodeOccursMoreThanOnce(other, nodeID)) return [];

        const otherHead = (other.tags.oneway === '-1') ? other.last() : other.first();
        const otherTail = (other.tags.oneway === '-1') ? other.first() : other.last();
        if ((isHead && nodeID !== otherHead) || (isTail && nodeID !== otherTail)) return [];
      }

      // If we get here, the way is not reachable / escapable.

      const placement = isHead ? 'start' : 'end';
      let messageID, referenceID;
      if (wayType === 'waterway') {
        messageID = `${wayType}.connected.${placement}`;
        referenceID = `${wayType}.connected`;
      } else {
        messageID = `${wayType}.${placement}`;
        referenceID = `${wayType}.${placement}`;
      }

      return [new ValidationIssue(context, {
        type: type,
        subtype: wayType ?? undefined,
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t(`issues.impossible_oneway.${messageID}.message`, {
            feature: l10n.displayLabel(entity, graph)
          }) : '';
        },
        reference: getReference(referenceID),
        entityIds: [way.id, node.id],
        dynamicFixes: function(this: any) {
          const graph = editor.staging.graph;
          const fixes = [];
          if (attachedOneways.length) {
            fixes.push(new ValidationFix({
              icon: 'rapid-operation-reverse',
              title: l10n.t('issues.fix.reverse_feature.title'),
              entityIds: [way.id],
              onClick: function(this: any) {
                const entityID = this.issue.entityIds[0];
                editor.perform(actionReverse(entityID));
                editor.commit({
                  annotation: l10n.t('operations.reverse.annotation.line', { n: 1 }),
                  selectedIDs: [entityID]
                });
              }
            }));
          }
          if (node.tags.noexit !== 'yes') {
            const isRTL = l10n.isRTL;
            const useLeftContinue = (isHead && !isRTL) || (!isHead && isRTL);
            fixes.push(new ValidationFix({
              icon: 'rapid-operation-continue' + (useLeftContinue ? '-left' : ''),
              title: l10n.t('issues.fix.continue_from_' + (isHead ? 'start' : 'end') + '.title'),
              onClick: function(this: any) {
                const entityID = this.issue.entityIds[0];
                const vertexID = this.issue.entityIds[1];
                const way = graph.entity(entityID) as OsmWay;
                const vertex = graph.entity(vertexID) as OsmNode;
                continueDrawing(way, vertex, context);
              }
            }));
          }

          return fixes;
        },
        loc: node.loc!
      })];

      /**
       * Returns a function to render the reference information for the given issue reference ID.
       * @param referenceID - The localization key suffix
       * @returns A function that renders reference text into a D3 selection
       */
      function getReference(referenceID: string) {
        return function showReference($selection: D3Selection): void {
          $selection.selectAll('.issue-reference')
            .data([0])
            .enter()
            .append('div')
            .attr('class', 'issue-reference')
            .text(l10n.t(`issues.impossible_oneway.${referenceID}.reference`));
        };
      }
    }
  };


  /**
   * Activates draw-line mode to continue drawing from the given vertex.
   * Also attempts to pan the map if the vertex is not visible.
   */
  function continueDrawing(way: OsmWay, vertex: OsmNode, context: Context): void {
    // make sure the vertex is actually visible and editable
    const map = context.systems.map;
    if (!context.editable() || !(map?.trimmedExtent() as Extent).contains(new Extent(vertex.loc!))) {
      map?.fitEntitiesEase(vertex);
    }

    context.enter('draw-line', { continueWayID: way.id, continueNodeID: vertex.id });
  }


  validator.type = type;
  return validator;
}
