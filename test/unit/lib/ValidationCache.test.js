import { describe, it, beforeEach } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('ValidationCache', () => {
  const context = new Rapid.MockContext();
  context.systems.spatial = new Rapid.SpatialSystem(context);
  let graph;
  let cache;

  beforeEach(() => {
    graph = new Rapid.Graph(context);
    cache = new Rapid.ValidationCache(context, 'head');
    cache.graph = graph;
  });


  describe('constructor', () => {
    it('constructs a ValidationCache for "base"', () => {
      const baseCache = new Rapid.ValidationCache(context, 'base');
      assert.instanceOf(baseCache, Rapid.ValidationCache);
      assert.strictEqual(baseCache.which, 'base');
      assert.isNull(baseCache.graph);
      assert.isArray(baseCache.queue);
      assert.isEmpty(baseCache.queue);
      assert.isNull(baseCache.queuePromise);
      assert.instanceOf(baseCache.queuedEntityIDs, Set);
      assert.isEmpty(baseCache.queuedEntityIDs);
      assert.instanceOf(baseCache.provisionalEntityIDs, Set);
      assert.isEmpty(baseCache.provisionalEntityIDs);
      assert.instanceOf(baseCache.issues, Map);
      assert.isEmpty(baseCache.issues);
      assert.instanceOf(baseCache.entityIssueIDs, Map);
      assert.isEmpty(baseCache.entityIssueIDs);
    });

    it('constructs a ValidationCache for "head"', () => {
      const headCache = new Rapid.ValidationCache(context, 'head');
      assert.instanceOf(headCache, Rapid.ValidationCache);
      assert.strictEqual(headCache.which, 'head');
    });
  });


  describe('cacheIssue', () => {
    it('caches an issue by its id', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);

      assert.isTrue(cache.issues.has(issue.id));
      assert.strictEqual(cache.issues.get(issue.id), issue);
    });

    it('tracks entity-to-issue mapping', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1', 'n2']
      });

      cache.cacheIssue(issue);

      assert.isTrue(cache.entityIssueIDs.has('n1'));
      assert.isTrue(cache.entityIssueIDs.has('n2'));
      assert.isTrue(cache.entityIssueIDs.get('n1').has(issue.id));
      assert.isTrue(cache.entityIssueIDs.get('n2').has(issue.id));
    });

    it('replaces existing issue with same id', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',  // same type + entityIds = same id
        severity: 'error',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue1);
      cache.cacheIssue(issue2);

      assert.strictEqual(cache.issues.size, 1);
      assert.strictEqual(cache.issues.get(issue2.id).severity, 'error');
    });

    it('stores disconnected_way issues in spatial index', () => {
      // Create a node with a location so extent can be calculated
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const graphWithNode = new Rapid.Graph(context, [node]);
      cache.graph = graphWithNode;

      const issue = new Rapid.ValidationIssue(context, {
        type: 'disconnected_way',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);

      assert.isTrue(context.systems.spatial.hasItem(cache.spatialID, issue.id));
    });

    it('stores impossible_oneway issues in spatial index', () => {
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const graphWithNode = new Rapid.Graph(context, [node]);
      cache.graph = graphWithNode;

      const issue = new Rapid.ValidationIssue(context, {
        type: 'impossible_oneway',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);

      assert.isTrue(context.systems.spatial.hasItem(cache.spatialID, issue.id));
    });
  });


  describe('uncacheIssue', () => {
    it('removes an issue from the cache', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);
      assert.isTrue(cache.issues.has(issue.id));

      cache.uncacheIssue(issue);
      assert.isFalse(cache.issues.has(issue.id));
    });

    it('removes entity-to-issue mapping', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1', 'n2']
      });

      cache.cacheIssue(issue);
      cache.uncacheIssue(issue);

      assert.isFalse(cache.entityIssueIDs.has('n1'));
      assert.isFalse(cache.entityIssueIDs.has('n2'));
    });

    it('only removes the uncached issue from entityIssueIDs', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'unsquare_way',
        severity: 'warning',
        entityIds: ['n1']  // same entity, different issue type
      });

      cache.cacheIssue(issue1);
      cache.cacheIssue(issue2);
      cache.uncacheIssue(issue1);

      assert.isTrue(cache.entityIssueIDs.has('n1'));
      assert.isFalse(cache.entityIssueIDs.get('n1').has(issue1.id));
      assert.isTrue(cache.entityIssueIDs.get('n1').has(issue2.id));
    });

    it('removes spatial index entry for disconnected_way issues', () => {
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const graphWithNode = new Rapid.Graph(context, [node]);
      cache.graph = graphWithNode;

      const issue = new Rapid.ValidationIssue(context, {
        type: 'disconnected_way',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);
      assert.isTrue(context.systems.spatial.hasItem(cache.spatialID, issue.id));

      cache.uncacheIssue(issue);
      assert.isFalse(context.systems.spatial.hasItem(cache.spatialID, issue.id));
    });
  });


  describe('cacheIssues', () => {
    it('caches multiple issues', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'unsquare_way',
        severity: 'warning',
        entityIds: ['w1']
      });

      cache.cacheIssues([issue1, issue2]);

      assert.strictEqual(cache.issues.size, 2);
      assert.isTrue(cache.issues.has(issue1.id));
      assert.isTrue(cache.issues.has(issue2.id));
    });

    it('handles empty array', () => {
      cache.cacheIssues([]);
      assert.strictEqual(cache.issues.size, 0);
    });

    it('handles undefined', () => {
      cache.cacheIssues();
      assert.strictEqual(cache.issues.size, 0);
    });
  });


  describe('uncacheIssues', () => {
    it('uncaches multiple issues', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'unsquare_way',
        severity: 'warning',
        entityIds: ['w1']
      });

      cache.cacheIssues([issue1, issue2]);
      cache.uncacheIssues([issue1, issue2]);

      assert.strictEqual(cache.issues.size, 0);
    });

    it('handles empty array', () => {
      cache.uncacheIssues([]);
      assert.strictEqual(cache.issues.size, 0);
    });

    it('handles undefined', () => {
      cache.uncacheIssues();
      assert.strictEqual(cache.issues.size, 0);
    });
  });


  describe('uncacheIssuesOfType', () => {
    it('removes all issues of a specific type', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n2']
      });
      const issue3 = new Rapid.ValidationIssue(context, {
        type: 'unsquare_way',
        severity: 'warning',
        entityIds: ['w1']
      });

      cache.cacheIssues([issue1, issue2, issue3]);
      cache.uncacheIssuesOfType('missing_tag');

      assert.strictEqual(cache.issues.size, 1);
      assert.isFalse(cache.issues.has(issue1.id));
      assert.isFalse(cache.issues.has(issue2.id));
      assert.isTrue(cache.issues.has(issue3.id));
    });

    it('does nothing if type not found', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssue(issue);
      cache.uncacheIssuesOfType('nonexistent_type');

      assert.strictEqual(cache.issues.size, 1);
    });
  });


  describe('uncacheEntityID', () => {
    it('removes an entity and all its issues', () => {
      const issue1 = new Rapid.ValidationIssue(context, {
        type: 'missing_tag',
        severity: 'warning',
        entityIds: ['n1']
      });
      const issue2 = new Rapid.ValidationIssue(context, {
        type: 'unsquare_way',
        severity: 'warning',
        entityIds: ['n1']
      });

      cache.cacheIssues([issue1, issue2]);
      cache.uncacheEntityID('n1');

      assert.strictEqual(cache.issues.size, 0);
      assert.isFalse(cache.entityIssueIDs.has('n1'));
    });

    it('removes entity from provisionalEntityIDs', () => {
      cache.provisionalEntityIDs.add('n1');
      cache.uncacheEntityID('n1');
      assert.isFalse(cache.provisionalEntityIDs.has('n1'));
    });

    it('handles entity not in cache', () => {
      cache.uncacheEntityID('n999');
      assert.strictEqual(cache.issues.size, 0);
    });

    it('removes shared issues affecting multiple entities', () => {
      const issue = new Rapid.ValidationIssue(context, {
        type: 'crossing_ways',
        severity: 'warning',
        entityIds: ['w1', 'w2']  // issue involves both entities
      });

      cache.cacheIssue(issue);
      cache.uncacheEntityID('w1');

      // Issue should be removed entirely
      assert.strictEqual(cache.issues.size, 0);
      // w2 should also no longer have this issue
      assert.isFalse(cache.entityIssueIDs.has('w2'));
    });
  });


  describe('withAllRelatedEntities', () => {
    it('returns empty set when no entityIDs provided', () => {
      const result = cache.withAllRelatedEntities([]);
      assert.instanceOf(result, Set);
      assert.strictEqual(result.size, 0);
    });

    it('returns only input entityIDs when graph is null', () => {
      cache.graph = null;
      const result = cache.withAllRelatedEntities(['n1']);
      // Still includes input, but no related entities added
      assert.strictEqual(result.size, 1);
      assert.isTrue(result.has('n1'));
    });

    it('includes original entityIDs in result', () => {
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      cache.graph = new Rapid.Graph(context, [node]);

      const result = cache.withAllRelatedEntities(['n1']);

      assert.isTrue(result.has('n1'));
    });

    it('includes entities from shared issues', () => {
      const node1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const node2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] });
      cache.graph = new Rapid.Graph(context, [node1, node2]);

      const issue = new Rapid.ValidationIssue(context, {
        type: 'crossing_ways',
        severity: 'warning',
        entityIds: ['n1', 'n2']
      });
      cache.cacheIssue(issue);

      const result = cache.withAllRelatedEntities(['n1']);

      assert.isTrue(result.has('n1'));
      assert.isTrue(result.has('n2'));
    });

    it('includes parent ways of nodes', () => {
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const way = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1'] });
      cache.graph = new Rapid.Graph(context, [node, way]);

      const result = cache.withAllRelatedEntities(['n1']);

      assert.isTrue(result.has('n1'));
      assert.isTrue(result.has('w1'));
    });

    it('includes parent ways of way child nodes', () => {
      const node1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      const node2 = new Rapid.OsmNode(context, { id: 'n2', loc: [1, 0] });
      const way1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
      const way2 = new Rapid.OsmWay(context, { id: 'w2', nodes: ['n2'] });  // shares n2
      cache.graph = new Rapid.Graph(context, [node1, node2, way1, way2]);

      const result = cache.withAllRelatedEntities(['w1']);

      assert.isTrue(result.has('w1'));
      assert.isTrue(result.has('w2'));  // connected via shared node n2
    });

    it('skips entities not in graph', () => {
      cache.graph = new Rapid.Graph(context);  // empty graph

      const result = cache.withAllRelatedEntities(['n1']);

      // n1 is in result because it's in input, but won't cause errors
      assert.isTrue(result.has('n1'));
    });

    it('accepts a Set as input', () => {
      const node = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
      cache.graph = new Rapid.Graph(context, [node]);

      const inputSet = new Set(['n1']);
      const result = cache.withAllRelatedEntities(inputSet);

      assert.isTrue(result.has('n1'));
    });
  });
});
