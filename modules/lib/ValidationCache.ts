import RBush from 'rbush';

import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { Graph } from './Graph.ts';
import type { ValidationIssue } from './ValidationIssue.ts';


/** Type for the spatial index box used in RBush */
export interface RecheckBox {
  /** Issue ID this box belongs to */
  issueID: IssueID;
  /** Minimum X coordinate */
  minX: number;
  /** Minimum Y coordinate */
  minY: number;
  /** Maximum X coordinate */
  maxX: number;
  /** Maximum Y coordinate */
  maxY: number;
}


/**
 * A `ValidationCache` stores validation state.
 * We create 2 of these:
 *   `base` for validation on the base graph (unedited)
 *   `head` for validation on the head graph (user edits applied)
 */
export class ValidationCache {
  /** Identifier for this cache - 'base' or 'head' */
  which: 'base' | 'head';
  /** The graph being validated */
  graph: Graph | null;
  /** Queue of validation jobs to process */
  queue: Array<(() => void)[]>;
  /** Promise for the current queue processing */
  queuePromise: Promise<void> | null;
  /** Entity IDs that are currently queued for validation */
  queuedEntityIDs: Set<EntityID>;
  /** Entity IDs that returned provisional results and need revalidation */
  provisionalEntityIDs: Set<EntityID>;
  /** Map of issue ID to ValidationIssue */
  issues: Map<IssueID, ValidationIssue>;
  /** Map of entity ID to Set of issue IDs affecting that entity */
  entityIssueIDs: Map<EntityID, Set<IssueID>>;
  /** RBush spatial index for connectivity issues */
  recheckRBush: RBush<RecheckBox>;
  /** Map of issue ID to its spatial box */
  recheckBoxes: Map<IssueID, RecheckBox>;

  /**
   * @constructor
   * @param which - 'base' or 'head' (to identify the cache)
   */
  constructor(which: 'base' | 'head') {
    this.which = which;
    this.graph = null;
    this.queue = [];
    this.queuePromise = null;
    this.queuedEntityIDs = new Set();
    this.provisionalEntityIDs = new Set();
    this.issues = new Map();
    this.entityIssueIDs = new Map();

    // A RBush spatial index that stores 'boxes'.
    // The boxes mark regions where the involved entities may need to be rechecked
    // by being part of a impossible oneway or disconnected way routing island.
    this.recheckRBush = new RBush();
    this.recheckBoxes = new Map();
  }


  /**
   * Add an issue to the cache
   * @param issue - The ValidationIssue to cache
   */
  cacheIssue(issue: ValidationIssue): void {
    if (this.issues.has(issue.id)) {
      this.uncacheIssue(issue);
    }

    if (issue.type === 'disconnected_way' || issue.type === 'impossible_oneway') {
      const extent = issue.extent(this.graph!);
      if (extent) {
        const box: RecheckBox = Object.assign({ issueID: issue.id }, extent.bbox());
        this.recheckRBush.insert(box);
        this.recheckBoxes.set(issue.id, box);
      }
    }

    for (const entityID of issue.entityIds ?? []) {
      let issueIDs = this.entityIssueIDs.get(entityID);
      if (!issueIDs) {
        issueIDs = new Set();
        this.entityIssueIDs.set(entityID, issueIDs);
      }
      issueIDs.add(issue.id);
    }
    this.issues.set(issue.id, issue);
  }


  /**
   * Remove an issue from the cache
   * @param issue - The ValidationIssue to remove
   */
  uncacheIssue(issue: ValidationIssue): void {
    const box = this.recheckBoxes.get(issue.id);
    if (box) {
      this.recheckRBush.remove(box);
      this.recheckBoxes.delete(issue.id);
    }

    for (const entityID of issue.entityIds ?? []) {
      const issueIDs = this.entityIssueIDs.get(entityID);
      if (issueIDs) {
        issueIDs.delete(issue.id);
        if (!issueIDs.size) {
          this.entityIssueIDs.delete(entityID);
        }
      }
    }
    this.issues.delete(issue.id);
  }


  /**
   * Add multiple issues to the cache
   * @param issues - Array of ValidationIssues to cache
   */
  cacheIssues(issues: ValidationIssue[] = []): void {
    for (const issue of issues) {
      this.cacheIssue(issue);
    }
  }


  /**
   * Remove multiple issues from the cache
   * @param issues - Array of ValidationIssues to remove
   */
  uncacheIssues(issues: ValidationIssue[] = []): void {
    for (const issue of issues) {
      this.uncacheIssue(issue);
    }
  }


  /**
   * Remove all issues of a specific type from the cache
   * @param type - The issue type to remove (e.g. 'unsquare_way')
   */
  uncacheIssuesOfType(type: string): void {
    const issues = [...this.issues.values()];
    const issuesOfType = issues.filter(issue => issue.type === type);
    this.uncacheIssues(issuesOfType);
  }


  /**
   * Remove a single entity and all its related issues from the caches
   * @param entityID - The entity ID to remove
   */
  uncacheEntityID(entityID: EntityID): void {
    const issueIDs = this.entityIssueIDs.get(entityID) ?? [];
    for (const issueID of issueIDs) {
      const issue = this.issues.get(issueID);
      if (issue) {
        this.uncacheIssue(issue);
      }
    }

    this.entityIssueIDs.delete(entityID);
    this.provisionalEntityIDs.delete(entityID);
  }


  /**
   * Returns an expanded set of `entityIDs` that need to also be validated alongside the given `entityIDs`
   * - Entities involved in the same issues
   * - Entities connected to the given entities
   * - Entities involved in nearby connectivity issues (impossible oneway, disconnected way)
   *
   * @param entityIDs - Array or Set containing entityIDs
   * @return entityIDs related to the given entityIDs
   */
  withAllRelatedEntities(entityIDs: Iterable<EntityID> = []): Set<EntityID> {
    const graph = this.graph;
    const results = new Set<EntityID>(entityIDs);  // include original entityIDs
    if (!graph || !results.size) return results;   // nothing to do

    const relatedIssueIDs = new Set<IssueID>();

    for (const entityID of entityIDs) {
      const entity: OsmEntity | undefined = graph.hasEntity(entityID);
      if (!entity) continue;

      // Gather Issues this Entity is involved in..
      const issueIDs = this.entityIssueIDs.get(entityID) ?? [];
      for (const issueID of issueIDs) {
        relatedIssueIDs.add(issueID);
      }

      if (entity.type === 'way' || entity.type === 'node') {
        // Gather nearby connectivity Issues (impossible oneway, disconnected way)
        const extent = (entity as any).extent(graph);
        if (extent) {
          const boxes = this.recheckRBush.search(extent.bbox()) ?? [];
          for (const box of boxes) {
            relatedIssueIDs.add(box.issueID);
          }
        }

        // Gather other Entities connected to this Entity..
        const checkNodes: OsmNode[] = entity.type === 'way'
          ? graph.childNodes(entity as OsmWay)
          : [entity as OsmNode];
        for (const node of checkNodes) {
          for (const parentWay of graph.parentWays(node)) {
            results.add(parentWay.id);
          }
        }
      }
    }

    for (const issueID of relatedIssueIDs) {
      const issue = this.issues.get(issueID);
      const relatedEntityIDs = issue?.entityIds ?? [];
      for (const relatedEntityID of relatedEntityIDs) {
        results.add(relatedEntityID);
      }
    }

    return results;
  }
}
