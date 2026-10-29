import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { SelectMode } from '../../../modules/modes/SelectMode.ts';


describe('SelectMode', () => {
  let context, graph, mode, selectClasses, urlParams, visibleIDs, blocked;

  function note(id) {
    return new Rapid.MarkerData(context, { id: id, namespace: 'notes-test', loc: [0, 0] });
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [1, 1] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] })
    ]);
    selectClasses = new Set();
    urlParams = {};
    visibleIDs = [];
    blocked = new Set();

    const noop = () => {};
    const scope = { on: () => scope, enable: noop, disable: noop };
    const emitter = { on: noop, off: noop };

    context.systems = {
      editor: { staging: { graph: graph }, ...emitter },
      filters: { forceVisible: ids => visibleIDs = ids },
      gfx: {
        scene: {
          clearClass: () => selectClasses.clear(),
          setClass: (classID, dataID) => selectClasses.add(dataID)
        },
        eventManager: emitter
      },
      keyboard: { scope: () => scope },
      locations: { isBlockedAt: loc => blocked.has(loc.join(',')) },
      photos: { selectDetection: noop },
      spatial: new Rapid.SpatialSystem(context),
      urlhash: { setParam: (k, v) => urlParams[k] = v }
    };
    context.behaviors = { hover: emitter };
    context.enableBehaviors = noop;
    context.editable = () => true;

    const spatial = context.systems.spatial;
    spatial.registerResolver('osm', entityID => graph.hasEntity(entityID));
    spatial.replaceData('notes-test', note('1'));

    mode = new SelectMode(context);
    // Operations need most of Rapid's systems; these tests only check whether they're offered.
    mode._setupOperations = function() { this.operations = this._isAllOsm() ? ['op'] : []; };
  });


  describe('enter', () => {
    it('selects a mix of OSM and other data', () => {
      assert.isTrue(mode.enter({ selection: ['w1', 'notes-test:1'] }));
      assert.deepEqual(mode.selectedIDs, ['w1', 'notes-test:1']);
      assert.deepEqual([...selectClasses], ['w1', 'notes-test:1']);
    });

    it('leaves out data it can\'t find, and fails if it finds none', () => {
      assert.isTrue(mode.enter({ selection: ['w1', 'w404', 'notes-test:404'] }));
      assert.deepEqual(mode.selectedIDs, ['w1']);
      mode.exit();

      assert.isFalse(mode.enter({ selection: ['w404', 'notes-test:404'] }));
      assert.isFalse(mode.active);
    });

    it('keeps an `osm:` data ID as the bare entity ID, once', () => {
      mode.enter({ selection: ['osm:w1', 'w1'] });
      assert.deepEqual(mode.selectedIDs, ['w1']);
    });

    it('leaves out OSM nodes where editing is blocked', () => {
      blocked.add('1,1');
      mode.enter({ selection: ['n1', 'n2'] });
      assert.deepEqual(mode.selectedIDs, ['n1']);
    });

    it('puts every data ID in `id=`, and forces only the OSM entities visible', () => {
      mode.enter({ selection: ['notes-test:1', 'w1'] });
      assert.strictEqual(urlParams.id, 'notes-test:1,w1');
      assert.deepEqual(visibleIDs, ['w1']);

      mode.exit();
      mode.enter({ selection: ['notes-test:1'] });
      assert.strictEqual(urlParams.id, 'notes-test:1');
    });

    it('offers operations only when everything selected is OSM', () => {
      mode.enter({ selection: ['w1', 'n1'] });
      assert.lengthOf(mode.operations, 1);
      mode.exit();

      mode.enter({ selection: ['w1', 'notes-test:1'] });
      assert.lengthOf(mode.operations, 0);
    });
  });


  describe('exit', () => {
    it('clears the selection, the select class and `id=`', () => {
      mode.enter({ selection: ['w1', 'notes-test:1'] });
      mode.exit();
      assert.isFalse(mode.active);
      assert.deepEqual(mode.selectedIDs, []);
      assert.strictEqual(selectClasses.size, 0);
      assert.isNull(urlParams.id);
      assert.deepEqual(mode.operations, []);
    });
  });
});
