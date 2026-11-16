import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { ValidationIssue } from '../lib/ValidationIssue.ts';
import type { ValidatorFunction } from '../validators/types.ts';


/**
 * An entity to fix, and the validator to run on it.
 */
export interface AutofixTarget {
  /** The entity to validate */
  entityID: EntityID;
  /** The validator to run on it */
  validator: ValidatorFunction;
}


/**
 * Applies validators' autofixes, one at a time.  A fix changes the graph (it may move, merge or
 * remove nodes, and splits segments), so the issues found before it may no longer fit.  After each
 * fix, the entity is looked up again and validated again on the changed graph.
 * Autoconnect and the issues pane's "Autofix All" both run this (see `design/validation-system.md`).
 * @param  targets - The entities to fix, each with the validator to run on it, in order
 * @param  canFix  - Optional: which of the issues found may be fixed (default: any with an autofix)
 * @return An Action that applies the fixes
 */
export function actionAutofix(targets: AutofixTarget[], canFix?: (issue: ValidationIssue) => boolean): Action {
  return (graph: Graph): Graph => {
    const MAX_FIXES = 50;   // per target, in case a fix doesn't make its issue go away
    const tried = new Set<IssueID>();

    for (const { entityID, validator } of targets) {
      for (let i = 0; i < MAX_FIXES; i++) {
        const entity = graph.hasEntity(entityID);
        if (!entity) break;   // an earlier fix merged or removed it

        const issue = validator(entity, graph).issues
          .find(issue => issue.autoArgs && !tried.has(issue.id) && (canFix?.(issue) ?? true));
        if (!issue) break;

        tried.add(issue.id);
        graph = issue.autoArgs![0](graph);   // autoArgs = [action, label]
      }
    }

    return graph.commit();
  };
}
