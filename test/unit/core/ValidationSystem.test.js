import { before, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('ValidationSystem', () => {

  class MockSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    on()          { return this; }
    pause()       { }
    resume()      { }
  }

  class MockGfxSystem {
    constructor() {
      this.scene = { layers: new Map() };
    }
    initAsync()   { return Promise.resolve(); }
    pause()       { }
    resume()      { }
  }

  class MockImagerySystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    imageryUsed() { return ''; }
  }

  class MockLocalizationSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockPhotoSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    photosUsed()  { return ''; }
  }

  class MockStorageSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    getItem()     { return ''; }
    hasItem()     { return false; }
    setItem()     { }
  }

  class MockUrlSystem {
    constructor() {
      this.initialHashParams = new Map();
    }
    initAsync()   { return Promise.resolve(); }
    on()          { return this; }
  }

  class MockContext {
    constructor()   {
      this.viewport = new Rapid.sdk.Viewport();
      this.sequences = {};
      this.systems = {
        assets:   new Rapid.AssetSystem(this),
        editor:   new Rapid.EditSystem(this),
        gfx:      new MockGfxSystem(),
        imagery:  new MockImagerySystem(),
        l10n:     new MockLocalizationSystem(),
        map:      new MockSystem(),
        photos:   new MockPhotoSystem(),
        presets:  new MockSystem(),
        rapid:    new MockSystem(),
        storage:  new MockStorageSystem(),
        urlhash:  new MockUrlSystem()
      };
    }
    selectedIDs() { return []; }
    on() {}
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  let _validator;

  before(() => {
    const editSystem = context.systems.editor;
    _validator = new Rapid.ValidationSystem(context);

    return editSystem.initAsync()
      .then(() => _validator.initAsync())
      .then(() => {
        // For now just run the one rule we are testing.
        // Otherwise we need to mock out anything used by any validator.
        for (const ruleID of _validator._rules.keys()) {
          if (ruleID !== 'private_data') {
            _validator._rules.delete(ruleID);
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
