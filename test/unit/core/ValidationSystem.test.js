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
      editor.commit({ stringID:'added n-1', selectionAfter: ['n-1'] });

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

    it('keeps the issues other validators find when one throws', () => {
      // A validator that throws on `n-2` only
      const throwing = (entity) => {
        if (entity.id === 'n-2') throw new Error('validator failed');
        return { issues: [] };
      };
      throwing.type = 'throwing';
      _validator._validators.set('throwing', throwing);

      const n_2 = new Rapid.OsmNode(context, { id: 'n-2', loc: [0, 0], tags: { building: 'house', phone: '555-1212' } });
      const n_3 = new Rapid.OsmNode(context, { id: 'n-3', loc: [0, 0], tags: { building: 'house', phone: '555-1212' } });
      const editor = context.systems.editor;
      editor.perform(Rapid.actionAddEntity(n_2), Rapid.actionAddEntity(n_3));
      editor.commit({ stringID:'added n-2 and n-3', selectionAfter: ['n-2', 'n-3'] });

      const _error = console.error;
      console.error = () => {};
      return _validator.validateAsync()
        .then(() => {
          const issues = _validator.getIssues({ what: 'all', where: 'all' });
          const entityIDs = issues.map(issue => issue.entityIds[0]);
          assert.includeMembers(entityIDs, ['n-1', 'n-2', 'n-3']);
        })
        .finally(() => {
          console.error = _error;
          _validator._validators.delete('throwing');
        });
    });

    it('revalidateUnsquare checks each building as it is in the graph being validated', async () => {
      const editor = context.systems.editor;
      await _validator.validateAsync();

      // A stand-in for `unsquare_way` that records what it was given
      let checked = [];
      const unsquare = (entity, graph) => {
        checked.push([entity.id, graph.hasEntity(entity.id) === entity]);
        return { issues: [] };
      };
      unsquare.type = 'unsquare_way';
      _validator._validators.set('unsquare_way', unsquare);

      const square = (wayID, x) => {
        const nodes = [[x, 0], [x + 0.0001, 0], [x + 0.0001, 0.0001], [x, 0.0001]]
          .map(loc => new Rapid.OsmNode(context, { loc }));
        const way = new Rapid.OsmWay(context, { id: wayID, nodes: [...nodes.map(node => node.id), nodes[0].id], tags: { building: 'yes' } });
        return [...nodes, way].map(entity => Rapid.actionAddEntity(entity));
      };

      editor.perform(...square('w-1', 0));
      editor.commit({ stringID: 'added w-1', selectionAfter: ['w-1'] });   // starts validating

      // Commit again while that validation runs, so the head cache is a graph behind stable
      editor.perform(Rapid.actionChangeTags('w-1', { building: 'house' }), ...square('w-2', 0.001));
      editor.commit({ stringID: 'changed w-1, added w-2', selectionAfter: ['w-2'] });

      checked = [];
      try {
        _validator.revalidateUnsquare();
        // The head cache's graph is the current stable, and each building is checked as it is there
        assert.strictEqual(_validator._head.graph, editor.stable.graph);
        assert.sameDeepMembers(checked, [['w-1', true], ['w-2', true]]);
      } finally {
        await _validator.validateAsync();
        _validator._validators.delete('unsquare_way');
      }
    });

    it('validates the current stable graph when the user commits during a validation', async () => {
      const editor = context.systems.editor;
      await _validator.validateAsync();

      // A stand-in that records which graph each entity was validated with
      const validated = [];
      const recorder = (entity, graph) => {
        validated.push([entity.id, graph === editor.stable.graph]);
        return { issues: [] };
      };
      recorder.type = 'recorder';
      _validator._validators.set('recorder', recorder);

      try {
        editor.perform(Rapid.actionAddEntity(new Rapid.OsmNode(context, { id: 'n-20', loc: [30, 30] })));
        editor.commit({ stringID: 'added n-20', selectionAfter: ['n-20'] });   // starts validating

        // Commit again before the queued jobs run
        editor.perform(Rapid.actionAddEntity(new Rapid.OsmNode(context, { id: 'n-21', loc: [30.001, 30] })));
        editor.commit({ stringID: 'added n-21', selectionAfter: ['n-21'] });
        assert.strictEqual(_validator._head.graph, editor.stable.graph);

        await _validator.validateAsync();
        await _validator.validateAsync();   // the round that catches up to the second commit

        assert.sameDeepMembers(validated, [
          ['n-20', true],
          ['n-21', true]
        ]);
      } finally {
        _validator._validators.delete('recorder');
      }
    });


    it('validates the user\'s edits again when map data loads near them', async () => {
      const editor = context.systems.editor;
      await _validator.validateAsync();

      // Like `almost_junction`, a stand-in that gives up where the map isn't loaded
      let loaded = false;
      const osm = { isDataLoaded: () => loaded };
      const checkedIDs = [];
      const waits = (entity) => {
        if (entity.type !== 'way') return { issues: [] };
        checkedIDs.push(entity.id);
        if (!osm.isDataLoaded()) return { issues: [] };
        return { issues: [new Rapid.ValidationIssue(context, { type: 'waits', severity: 'warning', entityIds: [entity.id] })] };
      };
      waits.type = 'waits';
      _validator._validators.set('waits', waits);
      const services = context.services;
      context.services = { ...services, osm };

      try {
        // The user draws a road that ends where the map isn't loaded
        const a = new Rapid.OsmNode(context, { id: 'n-10', loc: [10, 10] });
        const b = new Rapid.OsmNode(context, { id: 'n-11', loc: [10.001, 10] });
        const way = new Rapid.OsmWay(context, { id: 'w-10', nodes: ['n-10', 'n-11'], tags: { highway: 'residential' } });
        editor.perform(Rapid.actionAddEntity(a), Rapid.actionAddEntity(b), Rapid.actionAddEntity(way));
        editor.commit({ stringID: 'added w-10', selectionAfter: ['w-10'] });
        await _validator.validateAsync();
        const waitsFor = () => _validator.getIssues().filter(issue => issue.type === 'waits').map(issue => issue.entityIds[0]);
        assert.deepEqual(waitsFor(), []);

        // Data loads far away: the road isn't checked again
        loaded = true;
        checkedIDs.length = 0;
        editor.merge([new Rapid.OsmNode(context, { id: 'n100', loc: [20, 20], version: '1' })]);
        await _validator._head.queuePromise;
        assert.notInclude(checkedIDs, 'w-10');

        // Data loads at the road's end: the road is checked again
        editor.merge([new Rapid.OsmNode(context, { id: 'n101', loc: [10.001, 10.00001], version: '1' })]);
        await _validator._head.queuePromise;
        assert.include(checkedIDs, 'w-10');
        assert.deepEqual(waitsFor(), ['w-10']);
      } finally {
        context.services = services;
        _validator._validators.delete('waits');
      }
    });


    // Validates the stable graph, and waits for any validation already running to catch up too
    async function validated() {
      await _validator.validateAsync();
      while (_validator._validationPromise) {
        await _validator._validationPromise;
      }
    }

    // Starts from an empty edit session, so that the IDs the editor makes for new entities
    // don't land on the entities the tests above added with IDs of their own
    async function resetAll() {
      await validated();
      await context.systems.editor.resetAsync();
      await _validator.resetAsync();
    }


    it('validates a node that a merge restores in the stable graph already validated (iD#2085)', async () => {
      const editor = context.systems.editor;
      await resetAll();

      const headChecks = [];
      const records = (entity, graph) => {
        if (graph === editor.stable.graph) headChecks.push(entity.id);
        return { issues: [] };
      };
      records.type = 'records';
      _validator._validators.set('records', records);

      try {
        editor.merge([new Rapid.OsmNode(context, { id: 'n301', loc: [40, 40], version: '1' })]);
        editor.perform(Rapid.actionDeleteNode('n301'));
        editor.commit({ stringID: 'deleted n301' });
        await validated();
        const stable = editor.stable.graph;

        // A downloaded way uses n301, so the merge puts it back, in the same stable graph
        headChecks.length = 0;
        editor.merge([
          new Rapid.OsmNode(context, { id: 'n302', loc: [40.001, 40], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w301', nodes: ['n301', 'n302'], version: '1' })
        ]);
        await validated();

        assert.strictEqual(editor.stable.graph, stable);
        assert.isOk(stable.hasEntity('n301'));
        assert.include(headChecks, 'n301');
      } finally {
        _validator._validators.delete('records');
      }
    });


    it('autofixAction fixes the issues given, finding them again after each fix, but not ignored ones', async () => {
      const editor = context.systems.editor;
      await resetAll();
      _validator._validators.set('crossing_ways', Rapid.validateCrossingWays(context));

      try {
        // Three roads running north, at lon 30, 30.0005 and 30.001
        const residential = { highway: 'residential' };
        editor.merge([
          new Rapid.OsmNode(context, { id: 'n201', loc: [30, 29.999], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n202', loc: [30, 30.001], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w201', nodes: ['n201', 'n202'], tags: residential, version: '1' }),
          new Rapid.OsmNode(context, { id: 'n203', loc: [30.0005, 29.999], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n204', loc: [30.0005, 30.001], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w202', nodes: ['n203', 'n204'], tags: residential, version: '1' }),
          new Rapid.OsmNode(context, { id: 'n205', loc: [30.001, 29.999], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n206', loc: [30.001, 30.001], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w203', nodes: ['n205', 'n206'], tags: residential, version: '1' })
        ]);

        // The user draws a footway with one segment that crosses all three.
        // Each fix splits that segment, which changes the IDs of the crossings left on it.
        const a = new Rapid.OsmNode(context, { id: 'n-201', loc: [29.999, 30] });
        const b = new Rapid.OsmNode(context, { id: 'n-202', loc: [30.0015, 30] });
        const footway = new Rapid.OsmWay(context, { id: 'w-201', nodes: ['n-201', 'n-202'], tags: { highway: 'footway' } });
        editor.perform(Rapid.actionAddEntity(a), Rapid.actionAddEntity(b), Rapid.actionAddEntity(footway));
        editor.commit({ stringID: 'added w-201', selectionAfter: ['w-201'] });
        await validated();

        const crossings = () => _validator.getIssues({ what: 'edited', where: 'all' })
          .filter(issue => issue.type === 'crossing_ways' && issue.entityIds.includes('w-201'));
        assert.lengthOf(crossings(), 3);

        // The user ignores the crossing with `w203`, then clicks "Autofix All"
        _validator.ignoreIssue(crossings().find(issue => issue.entityIds.includes('w203')).id);
        const shown = crossings();
        assert.lengthOf(shown, 2);
        editor.perform(_validator.autofixAction(shown));
        editor.commit({ stringID: 'issues.fix_all.annotation' });

        const graph = editor.staging.graph;
        const way = graph.entity('w-201');
        assert.lengthOf(way.nodes, 4);   // a crossing node on each of the two roads
        for (const roadID of ['w201', 'w202', 'w203']) {
          const road = graph.entity(roadID);
          const shared = road.nodes.filter(nodeID => way.nodes.includes(nodeID));
          assert.lengthOf(shared, roadID === 'w203' ? 0 : 1, `connected to ${roadID}`);
        }
      } finally {
        _validator._validators.delete('crossing_ways');
        _validator.resetIgnoredIssues();
      }
    });


    it('autofixAction applies fixes that change what the other fixes were found on', async () => {
      const editor = context.systems.editor;
      await resetAll();
      _validator._validators.set('almost_junction', Rapid.validateAlmostJunction(context));
      _validator._validators.set('crossing_ways', Rapid.validateCrossingWays(context));

      try {
        // Two roads running north, at lon 40 and 40.001. The second has a node `n304`
        // about 20 cm north of [40.001, 40] (a version, so it's the node kept when two are merged).
        const residential = { highway: 'residential' };
        editor.merge([
          new Rapid.OsmNode(context, { id: 'n301', loc: [40, 39.999], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n302', loc: [40, 40.001], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w301', nodes: ['n301', 'n302'], tags: residential, version: '1' }),
          new Rapid.OsmNode(context, { id: 'n303', loc: [40.001, 39.999], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n304', loc: [40.001, 40.000002], version: '1' }),
          new Rapid.OsmNode(context, { id: 'n305', loc: [40.001, 40.001], version: '1' }),
          new Rapid.OsmWay(context, { id: 'w302', nodes: ['n303', 'n304', 'n305'], tags: residential, version: '1' })
        ]);

        // The user draws a road that crosses the first, and ends about 1 m short of the second.
        // Connecting the end merges its end node with `n304`, so the crossing's fix, found with that
        // end node in the crossing segment, no longer fits.
        const a = new Rapid.OsmNode(context, { id: 'n-301', loc: [39.999, 40] });
        const b = new Rapid.OsmNode(context, { id: 'n-302', loc: [40.00099, 40] });
        const road = new Rapid.OsmWay(context, { id: 'w-301', nodes: ['n-301', 'n-302'], tags: residential });
        editor.perform(Rapid.actionAddEntity(a), Rapid.actionAddEntity(b), Rapid.actionAddEntity(road));
        editor.commit({ stringID: 'added w-301', selectionAfter: ['w-301'] });
        await validated();

        const issues = _validator.getIssues({ what: 'edited', where: 'all' })
          .filter(issue => issue.entityIds.includes('w-301'))
          .sort((a, b) => a.type.localeCompare(b.type));   // almost_junction first
        assert.deepEqual(issues.map(issue => issue.type), ['almost_junction', 'crossing_ways']);

        editor.perform(_validator.autofixAction(issues));
        editor.commit({ stringID: 'issues.fix_all.annotation' });

        const graph = editor.staging.graph;
        const way = graph.entity('w-301');
        assert.strictEqual(way.last(), 'n304');
        assert.lengthOf(way.nodes, 3);   // and a crossing node on the first road
        assert.include(graph.entity('w301').nodes, way.nodes[1]);
      } finally {
        _validator._validators.delete('almost_junction');
        _validator._validators.delete('crossing_ways');
      }
    });

  });

});
