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

});
