import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import osmRulesets from '../../../data/osm_rulesets.json5';


describe('ValidationSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    editor:     new Rapid.EditSystem(context),
    l10n:       new Rapid.LocalizationSystem(context),
    scheduler:  new Rapid.SchedulerSystem(context),
    schema:     new Rapid.SchemaSystem(context),
    spatial:    new Rapid.SpatialSystem(context),
    storage:    new Rapid.StorageSystem(context)
  };

  beforeAll(() => {
    const scheduler = context.systems.scheduler;
    const schema = context.systems.schema;
    schema.requestedAssetIDs = '';
    return Promise.resolve()
      .then(() => Promise.all([scheduler.initAsync(), schema.initAsync()]))
      .then(() => Promise.all([scheduler.startAsync(), schema.startAsync()]))
      .then(() => schema.merge(osmRulesets));
  });

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a ValidationSystem from a context', () => {
        const validator = new Rapid.ValidationSystem(context);
        assert.instanceOf(validator, Rapid.ValidationSystem);
        assert.strictEqual(validator.id, 'validator');
        assert.strictEqual(validator.context, context);
        assert.instanceOf(validator.requiredDependencies, Set);
        assert.instanceOf(validator.optionalDependencies, Set);
        assert.isTrue(validator.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const validator = new Rapid.ValidationSystem(context);
        const prom = validator.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const validator = new Rapid.ValidationSystem(context);
        validator.requiredDependencies.add('missing');
        const prom = validator.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const validator = new Rapid.ValidationSystem(context);
        const prom = validator.initAsync().then(() => validator.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(validator.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const validator = new Rapid.ValidationSystem(context);
        const prom = validator.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _validator;

    beforeAll(() => {
      _validator = new Rapid.ValidationSystem(context);

      return _validator.initAsync()
        .then(() => _validator.startAsync())
        .then(() => {
          // For now just run the one validator we are testing.
          // Otherwise we need to mock out anything used by any validator.
          for (const validatorID of _validator._validators.keys()) {
            if (validatorID !== 'private_data') {
              _validator._validators.delete(validatorID);
            }
          }
        });
    });

    it('has no issues on init', () => {
      const issues = _validator.getIssues({ what: 'all', where: 'all' });
      assert.deepEqual(issues, []);
    });

    it('validateAsync returns a Promise, fulfilled when the validation has completed', () => {
      const n_1 = new Rapid.OsmNode(context, { id: 'n-1', loc: [0, 0], tags: { building: 'house', phone: '555-1212' } });

      const editor = context.systems.editor;
      editor.perform(Rapid.actionAddEntity(n_1));
      editor.commit({ annotation: 'added n-1', selectedIDs: ['n-1'] });

      const prom = _validator.validateAsync();
      assert.instanceOf(prom, Promise);

      return prom
        .then(() => {
          const issues = _validator.getIssues({ what: 'all', where: 'all' });
          assert.lengthOf(issues, 1);

          const issue = issues[0];
          assert.strictEqual(issue.type, 'private_data');
          assert.deepEqual(issue.entityIds, ['n-1']);
        });
    });

  });


  describe('validators added by an embedding app', () => {
    // Its own context, so the data and validators don't mix with the tests above.
    const ctx = new Rapid.MockContext();
    ctx.systems = {
      editor:     new Rapid.EditSystem(ctx),
      l10n:       new Rapid.LocalizationSystem(ctx),
      scheduler:  new Rapid.SchedulerSystem(ctx),
      schema:     new Rapid.SchemaSystem(ctx),
      spatial:    new Rapid.SpatialSystem(ctx),
      storage:    new Rapid.StorageSystem(ctx)
    };
    let _validator;

    // Flags every node tagged `ref` whose value isn't the `id` tag of some other node: its
    // result for one node depends on nodes anywhere, so it needs `revalidateAll`.
    const danglingRef = (entity, graph) => {
      const ref = entity.tags?.ref;
      if (entity.type !== 'node' || !ref) return { issues: [], provisional: false };
      const found = ctx.systems.spatial.getAllItems(ctx.systems.editor.spatialIDForGraph(graph))
        .some(other => other.tags?.id === ref);
      if (found) return { issues: [], provisional: false };
      return {
        issues: [new Rapid.ValidationIssue(ctx, { type: 'dangling_ref', severity: 'warning', message: () => 'dangling', entityIds: [entity.id] })],
        provisional: false
      };
    };
    danglingRef.type = 'dangling_ref';

    const issuesOfType = (type) => _validator.getIssues({ what: 'all', where: 'all' }).filter(i => i.type === type);

    beforeAll(() => {
      _validator = new Rapid.ValidationSystem(ctx);
      ctx.systems.schema.requestedAssetIDs = '';
      return Promise.all([ctx.systems.scheduler.initAsync(), ctx.systems.schema.initAsync()])
        .then(() => Promise.all([ctx.systems.scheduler.startAsync(), ctx.systems.schema.startAsync()]))
        .then(() => _validator.initAsync())
        .then(() => _validator.startAsync())
        .then(() => {
          for (const validatorID of _validator.getValidatorIDs()) {
            _validator._validators.delete(validatorID);   // just ours
          }
        });
    });

    it('registers a validator, lists it, and validates the data already loaded with it', () => {
      const editor = ctx.systems.editor;
      editor.merge([new Rapid.OsmNode(ctx, { id: 'n1', loc: [0, 0], tags: { ref: 'missing' } })]);

      return Promise.resolve().then(() => {   // the base merge validates asynchronously
        let changed = 0;
        _validator.on('validatorschange', () => changed++);
        _validator.registerValidator(danglingRef, { revalidateAll: true });

        assert.strictEqual(changed, 1);
        assert.include(_validator.getValidatorIDs(), 'dangling_ref');
        assert.deepEqual(issuesOfType('dangling_ref').map(i => i.entityIds), [['n1']]);
      });
    });

    it('reruns "revalidate all" validators over all data when other data loads', () => {
      const editor = ctx.systems.editor;
      // A node elsewhere now satisfies n1's reference, without touching n1.
      editor.merge([new Rapid.OsmNode(ctx, { id: 'n2', loc: [1, 1], tags: { id: 'missing' } })]);

      return _validator._validateBaseEntitiesAsync(['n2'])
        .then(() => assert.deepEqual(issuesOfType('dangling_ref'), []));
    });

    it('revalidates on demand, optionally only some entities', () => {
      const editor = ctx.systems.editor;
      editor.merge([new Rapid.OsmNode(ctx, { id: 'n3', loc: [2, 2], tags: { ref: 'nowhere' } })]);
      _validator._base.uncacheIssuesOfType('dangling_ref');

      _validator.revalidate(['dangling_ref'], entity => entity.id === 'n3');
      assert.deepEqual(issuesOfType('dangling_ref').map(i => i.entityIds), [['n3']]);
    });

    it('unregisters a validator, dropping its issues and listing', () => {
      let changed = 0;
      _validator.on('validatorschange', () => changed++);
      _validator.unregisterValidator('dangling_ref');

      assert.strictEqual(changed, 1);
      assert.notInclude(_validator.getValidatorIDs(), 'dangling_ref');
      assert.deepEqual(issuesOfType('dangling_ref'), []);
    });
  });
});
