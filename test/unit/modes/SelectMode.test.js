import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { SelectMode } from '../../../modules/modes/SelectMode.ts';
import { UiKeepRightEditor } from '../../../modules/ui/UiKeepRightEditor.ts';
import { UiNoteEditor } from '../../../modules/ui/UiNoteEditor.ts';
import { UiOsmoseEditor } from '../../../modules/ui/UiOsmoseEditor.ts';


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
      editor: { staging: { graph: graph }, index: 0, history: [{}], ...emitter },
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


  it('leaves a data ID that came from a counter out of `id=`', () => {
    const d = new Rapid.GeoJSONData(context, { namespace: 'vt-test', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } } });
    context.systems.spatial.replaceData('vt-test', d);
    mode.enter({ selection: ['w1', d.dataID] });
    assert.deepEqual(mode.selectedIDs, ['w1', d.dataID]);   // still selected
    assert.strictEqual(urlParams.id, 'w1');
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


  describe('an empty new relation', () => {
    let commits;

    beforeEach(() => {
      graph = new Rapid.Graph(context, [new Rapid.OsmRelation(context, { id: 'r-1', members: [] })]);
      commits = [];
      Object.assign(context.systems.editor, {
        staging: { graph: graph },
        perform: () => {},
        commit: props => commits.push(props)
      });
    });

    it('is deleted on exit, at the newest edit', () => {
      mode.enter({ selection: ['r-1'] });
      mode.exit();
      assert.lengthOf(commits, 1);
      assert.strictEqual(commits[0].stringID, 'operations.delete.annotation.relation');
    });

    it('is kept when there are edits to redo, so they aren\'t thrown away', () => {
      context.systems.editor.history.push({});   // e.g. undid the relation's tags
      mode.enter({ selection: ['r-1'] });
      mode.exit();
      assert.lengthOf(commits, 0);
    });
  });


  describe('note editor', () => {
    it('selects a new note by its real id once it is saved', () => {
      const noop = () => {};
      context.systems.ui = { closeEditMenu: noop, Sidebar: { reset: noop, show: noop, hide: noop } };
      context.systems.gfx.immediateRedraw = noop;
      const entered = [];
      context.enter = (modeID, options) => entered.push([modeID, options]);

      let onChange;
      const on = UiNoteEditor.prototype.on;
      UiNoteEditor.prototype.on = function(eventName, fn) {
        if (eventName === 'change') onChange = fn;
        return on.call(this, eventName, fn);
      };
      try {
        const props = { type: 'note', serviceID: 'osm', namespace: 'osm-notes', loc: [0, 0], isNew: true };
        const newNote = new Rapid.MarkerData(context, { id: '-1', ...props });
        context.systems.spatial.replaceData('osm-notes', newNote);
        mode.enter({ selection: [newNote.dataID] });
      } finally {
        UiNoteEditor.prototype.on = on;
      }

      // Saving removes the new note and caches the saved one, then the editor emits it.
      const saved = new Rapid.MarkerData(context, { id: '123', type: 'note', serviceID: 'osm', namespace: 'osm-notes', loc: [0, 0] });
      context.systems.spatial.removeItems('osm-notes', '-1');
      context.systems.spatial.replaceData('osm-notes', saved);
      onChange(saved);

      assert.deepEqual(entered, [['select', { selection: [saved.dataID] }]]);
    });
  });


  describe('QA issue editors', () => {
    // Selects an issue, closes it (which removes it from the cache), and returns the modes entered after.
    // With `moveOn`, the user selects something else before the close comes back.
    function closeIssue(serviceID, Editor, moveOn = false) {
      const noop = () => {};
      const spatial = context.systems.spatial;
      context.systems.ui = { closeEditMenu: noop, Sidebar: { reset: noop, show: noop, hide: noop } };
      context.systems.gfx.immediateRedraw = noop;
      context.services[serviceID] = { getError: id => spatial.getItem(serviceID, id) };
      const entered = [];
      context.enter = (modeID, options) => entered.push([modeID, options]);

      let onChange;
      const on = Editor.prototype.on;
      Editor.prototype.on = function(eventName, fn) {
        if (eventName === 'change') onChange = fn;
        return on.call(this, eventName, fn);
      };
      try {
        const issue = new Rapid.MarkerData(context, { id: 'abc', serviceID: serviceID, namespace: serviceID, loc: [0, 0] });
        spatial.replaceData(serviceID, issue);
        mode.enter({ selection: [issue.dataID] });
      } finally {
        Editor.prototype.on = on;
      }

      if (moveOn) {
        mode.exit();
        mode.enter({ selection: ['notes-test:1'] });
      }

      // Closing the issue removes it from the cache, then the editor emits 'change'.
      spatial.removeItems(serviceID, 'abc');
      onChange();
      return entered;
    }

    it('returns to browse mode once a KeepRight issue is closed, so it can\'t be posted again', () => {
      assert.deepEqual(closeIssue('keepright', UiKeepRightEditor), [['browse', undefined]]);
    });

    it('returns to browse mode once an Osmose issue is closed, so it can\'t be posted again', () => {
      assert.deepEqual(closeIssue('osmose', UiOsmoseEditor), [['browse', undefined]]);
    });

    it('stays on what the user selected since, when the close comes back', () => {
      assert.deepEqual(closeIssue('osmose', UiOsmoseEditor, true), []);
      assert.deepEqual(mode.selectedIDs, ['notes-test:1']);
    });
  });
});
