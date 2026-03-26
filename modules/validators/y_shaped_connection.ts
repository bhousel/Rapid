import { geoSphericalDistance, vecAngle } from '@rapid-sdk/math';

import { operationDelete } from '../operations/delete.js';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting Y-shaped road connections
 * that may appear in ML-generated roads. Flags excessive non-connection nodes
 * that create short edges around connection points, where a cleaner T-shaped
 * connection would be preferable.
 * @param context
 * @returns Validator function
 */
export function validateYShapedConnection(context: Context): ValidatorFunction {
  /* We want to catch and warn about the following "shapes of connections"
   * that may appear in ML-generated roads:
   * (1) Two short edges around a connection node, causing a "Y-shaped" connection
   *     ________ _______
   *             V
   *             |
   *             |
   *             |
   * (2) One short edges around a connection node. The connection is not exactly
   * "Y-shaped", but still a little too detailed.
   *               _______
   *  ___________ /
   *             |
   *             |
   *             |
   * The potential fix is to remove the non-connection nodes causing the short edges,
   * so that the shape of the connection becomes more like a "T".
   *
   * This validation will flag issues on those excessive non-connection nodes around
   * Y-shaped connections and suggest deletion or move as possible fixes.
   */

  const type = 'y_shaped_connection' as ValidatorID;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema!;

  const SHORT_EDGE_THD_METERS = 12;       // (THD means "threshold")
  const NON_FLAT_ANGLE_THD_DEGREES = 5;


  /**
   * Returns parent ways of the node that are major or minor highways.
   * @param node - The node to check
   * @param graph - The current graph
   * @returns Array of highway parent ways
   */
  function getRelatedHighwayParents(node: OsmNode, graph: Graph): OsmWay[] {
    const variables = schema.getScope('osm').variables;
    const majorVals = variables.get('major_highway_values')?.asSet();
    const minorVals = variables.get('minor_highway_values')?.asSet();

    const parentWays = graph.parentWays(node);
    return parentWays.filter(way => majorVals?.has(way.tags.highway) || minorVals?.has(way.tags.highway));
  }

  /**
   * Creates a validation issue for a node near a Y-shaped connection,
   * with a fix to delete or move the node.
   * @param node - The problematic node
   * @param context - The application context
   * @returns A validation issue with appropriate fixes
   */
  function createIssueAndFixForNode(node: OsmNode, context: Context): ValidationIssue {
    const deletable = !operationDelete(context, [node.id]).disabled();
    let fix;
    if (deletable) {
      fix = new ValidationFix({
        icon: 'rapid-operation-delete',
        title: l10n.t('issues.fix.delete_node_around_conn.title'),
        entityIds: [node.id],
        onClick: function(this: any) {
          const id = this.entityIds[0];
          const operation = operationDelete(context, [id]);
          if (!operation.disabled()) {
            operation();
          }
        }
      });
    } else {
      fix = new ValidationFix({
        icon: 'rapid-operation-move',
        title: l10n.t('issues.fix.move_node_around_conn.title'),
        entityIds: [node.id]
      });
    }

    return new ValidationIssue(context, {
      type: type,
      severity: 'warning',
      message: () => {
        return l10n.t('issues.y_shaped_connection.message');
      },
      reference: ($selection: D3Selection) => {
        $selection.selectAll('.issue-reference')
          .data([0])
          .enter()
          .append('div')
          .attr('class', 'issue-reference')
          .text(l10n.t('issues.y_shaped_connection.reference'));
      },
      entityIds: [node.id],
      dynamicFixes: () => [fix]
    });
  }


  /**
   * Tests if a segment is a short edge adjacent to a Y-shaped connection.
   * Checks that the connection node has multiple parent highways and that
   * the angle between adjacent edges is not near-flat.
   * @param graph - The current graph
   * @param way - The way containing the segment
   * @param connNodeIdx - Index of the potential connection node
   * @param edgeNodeIdx - Index of the edge node to test
   * @returns `true` if the edge is short and the connection is Y-shaped
   */
  function isShortEdgeAndYShapedConnection(graph: Graph, way: OsmWay, connNodeIdx: number, edgeNodeIdx: number): boolean {
    // conditions for connNode to be a possible Y-shaped connection:
    // (1) it is a connection node with edges on both side
    // (2) at least one edge is short
    // (3) the angle between the two edges are not close to 180 degrees

    if (connNodeIdx <= 0 || connNodeIdx >= way.nodes.length - 1) return false;

    // make sure the node at connNodeIdx is really a connection node
    const connNid = way.nodes[connNodeIdx];
    const connNode = graph.entity(connNid) as OsmNode;
    const pways = getRelatedHighwayParents(connNode, graph);
    if (pways.length < 2) return false;

    // check if the edge between connNode and edgeNode is short
    const edgeNid = way.nodes[edgeNodeIdx];
    const edgeNode = graph.entity(edgeNid) as OsmNode;
    const edgeLen = geoSphericalDistance(connNode.loc!, edgeNode.loc!);
    if (edgeLen > SHORT_EDGE_THD_METERS) return false;

    // check if connNode is a Y-shaped connection
    const otherNodeIdx = connNodeIdx < edgeNodeIdx ? connNodeIdx - 1 : connNodeIdx + 1;
    const otherNid = way.nodes[otherNodeIdx];
    const otherNode = graph.entity(otherNid) as OsmNode;
    const other = context.viewport.project(otherNode.loc!);
    const conn = context.viewport.project(connNode.loc!);
    const edge = context.viewport.project(edgeNode.loc!);
    let prevEdgeAngle;
    let nextEdgeAngle;
    let angleBetweenEdges;

    if (otherNodeIdx < edgeNodeIdx) {
      // node order along way: otherNode -> connNode -> edgeNode
      prevEdgeAngle = vecAngle(other, conn);
      nextEdgeAngle = vecAngle(conn, edge);
      angleBetweenEdges = Math.abs(nextEdgeAngle - prevEdgeAngle) / Math.PI * 180.0;
    } else {
      // node order along way: edgeNode -> connNode -> otherNode
      prevEdgeAngle = vecAngle(edge, conn);
      nextEdgeAngle = vecAngle(conn, other);
      angleBetweenEdges = Math.abs(nextEdgeAngle - prevEdgeAngle) / Math.PI * 180.0;
    }

    return angleBetweenEdges > NON_FLAT_ANGLE_THD_DEGREES;
  }


  /**
   * Checks whether a node is an excessive detail node near a Y-shaped connection.
   * Only flags nodes on negative (ML-generated) ways with a single highway parent.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkYShapedConnection(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!schema) return result;

    // Only flag issue on non-connection nodes on negative ways
    if (entity.type !== 'node') return result;
    const pways = getRelatedHighwayParents(entity as OsmNode, graph);
    if (pways.length !== 1 || !pways[0].id.startsWith('w-')) return result;

    // check if either neighbor node on its parent way is a connection node
    const way = pways[0];
    const idx = way.nodes.indexOf(entity.id);
    if (idx <= 0) return result;  // not found?
    if (isShortEdgeAndYShapedConnection(graph, way, idx - 1, idx) ||
      isShortEdgeAndYShapedConnection(graph, way, idx + 1, idx)) {
      result.issues.push(createIssueAndFixForNode(entity as OsmNode, context));
    }
    return result;
  };


  validator.type = type;
  return validator;
}
