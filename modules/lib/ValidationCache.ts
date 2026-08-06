import type { Context } from '../Context.ts';
import type { Graph } from './Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidationIssue } from './ValidationIssue.ts';


/**
 * A `ValidationCache` stores validation state.
 * The `ValidationSystem` creates 2 of these:
 * - `base` for validation on the base graph (unedited)
 * - `head` for validation on the head graph (user edits applied)
 */
export class ValidationCache {

  /** Global shared application context */
  public context: Context;
  /** Identifier for this cache - 'base' or 'head' */
  public which: 'base' | 'head';
  /** The graph being validated */
  public graph: Graph | null;
  /** Queue of validation jobs to process */
  public queue: Array<(() => void)[]>;
  /** Promise for the current queue processing */
  public queuePromise: Promise<void> | null;
  /** Entity IDs that are currently queued for validation */
  public queuedEntityIDs: Set<EntityID>;
  /** Entity IDs that returned provisional results and need revalidation */
  public provisionalEntityIDs: Set<EntityID>;
  /** Map of issue ID to ValidationIssue */
  public issues: Map<IssueID, ValidationIssue>;
  /** Map of entity ID to Set of issue IDs affecting that entity */
  public entityIssueIDs: Map<EntityID, Set<IssueID>>;

  /** SpatialSystem cache id for connectivity recheck regions (WGS84 coords), e.g. 'validation-head' */
  protected _spatialID: SpatialID;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param which - 'base' or 'head' (to identify the cache)
   */
  public constructor(context: Context, which: 'base' | 'head') {
    this.context = context;
    this.which = which;
    this.graph = null;
    this.queue = [];
    this.queuePromise = null;
    this.queuedEntityIDs = new Set<EntityID>();
    this.provisionalEntityIDs = new Set<EntityID>();
    this.issues = new Map<IssueID, ValidationIssue>();
    this.entityIssueIDs = new Map<EntityID, Set<IssueID>>();

    // Connectivity recheck regions (impossible_oneway / disconnected_way) are tracked in a
    // SpatialSystem cache keyed by `_spatialID`.  These boxes are in WGS84 coordinates, so we
    // only use the box-based query methods (not the world-coordinate convenience helpers).
    // Start from a clean cache for this instance - ValidationCaches are recreated frequently.
    this._spatialID = `validation-${which}`;
    context.systems.spatial!.clearCache(this._spatialID);
  }


  /**
   * The SpatialSystem cache id used for this cache's connectivity recheck regions.
   */
  public get spatialID(): SpatialID {
    return this._spatialID;
  }


  /**
   * Add an issue to the cache
   * @param issue - The ValidationIssue to cache
   */
  public cacheIssue(issue: ValidationIssue): void {
    const spatial = this.context.systems.spatial!;
    if (this.issues.has(issue.id)) {
      this.uncacheIssue(issue);
    }

    if (issue.type === 'disconnected_way' || issue.type === 'impossible_oneway') {
      const extent = issue.extent(this.graph!);
      if (extent) {
        spatial.addItems(this._spatialID, { id: issue.id, contents: issue.id, ...extent.bbox() });
      }
    }

    for (const entityID of issue.entityIds ?? []) {
      let issueIDs = this.entityIssueIDs.get(entityID);
      if (!issueIDs) {
        issueIDs = new Set<IssueID>();
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
  public uncacheIssue(issue: ValidationIssue): void {
    const spatial = this.context.systems.spatial!;
    spatial.removeItems(this._spatialID, issue.id);

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
  public cacheIssues(issues: ValidationIssue[] = []): void {
    for (const issue of issues) {
      this.cacheIssue(issue);
    }
  }


  /**
   * Remove multiple issues from the cache
   * @param issues - Array of ValidationIssues to remove
   */
  public uncacheIssues(issues: ValidationIssue[] = []): void {
    for (const issue of issues) {
      this.uncacheIssue(issue);
    }
  }


  /**
   * Remove all issues of a specific type from the cache
   * @param type - The issue type to remove (e.g. 'unsquare_way')
   */
  public uncacheIssuesOfType(type: string): void {
    const issues = [...this.issues.values()];
    const issuesOfType = issues.filter(issue => issue.type === type);
    this.uncacheIssues(issuesOfType);
  }


  /**
   * Remove a single entity and all its related issues from the caches
   * @param entityID - The entity ID to remove
   */
  public uncacheEntityID(entityID: EntityID): void {
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
  public withAllRelatedEntities(entityIDs: Iterable<EntityID> = []): Set<EntityID> {
    const graph = this.graph;
    const results = new Set<EntityID>(entityIDs);  // include original entityIDs
    if (!graph || !results.size) return results;   // nothing to do

    const spatial = this.context.systems.spatial!;
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
        const extent = entity.extent();
        if (extent) {
          for (const hit of spatial.getItemsAtBox(this._spatialID, extent.bbox())) {
            relatedIssueIDs.add(hit.contents as IssueID);
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
