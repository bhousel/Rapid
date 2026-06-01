import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting duplicate segments.
 * Duplicate segments occur when two routable ways share the same pair of
 * adjacent nodes, making the overlap invisible in the editor.
 * @param context
 * @returns Validator function
 */
export function validateDuplicateSegments(context: Context): ValidatorFunction {
  const type = 'duplicate_segments' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;


  /**
   * Checks whether any adjacent node pairs in the way are shared by other routable ways.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkDuplicateSegments(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (entity.type === 'way') {
      result.issues = getIssuesForWay(entity as OsmWay);
    }
    return result;


    /**
     * Tests whether the given tag key indicates a routable feature.
     * @param key - The tag key to check
     * @returns `true` if the key is 'highway', 'railway', or 'waterway'
     */
    function isRoutableTag(key: string): boolean {
      return key === 'highway' || key === 'railway' || key === 'waterway';
    }


    /**
     * Determines whether a way is routable (highway, railway, or waterway)
     * and not an area.
     * @param way - The way to check
     * @returns `true` if the way has routable tags and is not an area
     */
    function hasRoutableTags(way: OsmWay): boolean {
      if (way.isArea()) return false;
      return Object.keys(way.tags).some(isRoutableTag);
    }


    /**
     * Collects duplicate segment issues for a single way.
     * @param way - The way to check
     * @returns Array of issues for duplicated segments in this way
     */
    function getIssuesForWay(way: OsmWay): ValidationIssue[] {
      const issues: ValidationIssue[] = [];
      if (!hasRoutableTags(way)) return issues;

      const nodes = graph.childNodes(way);
      for (let i = 0; i < nodes.length - 1; i++) {
        const node1 = nodes[i];
        const node2 = nodes[i+1];
        const issue = getWayIssueIfAny(node1, node2, way);
        if (issue) issues.push(issue);
      }
      return issues;
    }


    /**
     * Returns an issue if the segment between two nodes is shared by another routable way.
     * @param node1 - The first node of the segment
     * @param node2 - The second node of the segment
     * @param way - The way containing the segment
     * @returns A validation issue, or `null` if the segment is not duplicated
     */
    function getWayIssueIfAny(node1: OsmNode, node2: OsmNode, way: OsmWay): ValidationIssue | null {
      if (node1.id === node2.id ) return null;

      if (node1.loc !== node2.loc) {
        const parentWays1 = graph.parentWays(node1);
        const parentWays2 = new Set(graph.parentWays(node2));
        const sharedWays = parentWays1.filter(parentWay => parentWays2.has(parentWay));

        // Now, we want to filter out any shared ways that aren't routable.
        const remainingSharedWays = sharedWays.filter(way => hasRoutableTags(way));

        // Finally, get rid of ways where the two nodes in question are not adjacent.
        // (this indicates a dogleg or u-shaped road splitting off from node1 and then re-joining at node 2)
        const waysWithContiguousNodes = remainingSharedWays.filter(way => way.isAdjacent(node1.id, node2.id));

        // If the nodes don't share a way, or share 1 way, that's fine!
        // We just want to know if they share 2 or more ways, which means we have duplicate way geometries.
        if (waysWithContiguousNodes.length <= 1) return null;
      }

      return new ValidationIssue(context, {
        type: type,
        subtype: 'vertices',
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.duplicate_segments.message', {
            way: l10n.displayLabel(entity, graph)
          }) : '';
        },
        reference: showReference,
        entityIds: [ way.id, node1.id, node2.id ],
        loc: node1.loc,
        dynamicFixes: () => {
          return [
            new ValidationFix({
              icon: 'rapid-icon-plus',
              title: l10n.t('issues.fix.merge_points.title'),
            }),
            new ValidationFix({
              icon: 'rapid-operation-delete',
              title: l10n.t('issues.fix.remove_way_segments.title')
            }),
            new ValidationFix({
              icon: 'rapid-operation-disconnect',
              title: l10n.t('issues.fix.move_way_segments_apart.title')
            })
          ];
        }
      });


      /**
       * Renders the issue reference text into the given selection.
       * @param $selection
       */
      function showReference($selection: D3Selection): void {
        $selection.selectAll('.issue-reference')
          .data([0])
          .enter()
          .append('div')
          .attr('class', 'issue-reference')
          .text(l10n.t('issues.duplicate_segments.reference'));
      }
    }
  };


  validator.type = type;
  return validator;
}
