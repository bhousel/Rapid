describe('uiFieldWikipedia', () => {

  class MockWikidataService {
    constructor() { }
    itemsByTitle(lang, title, callback) {
      callback({ Q216353: { id: 'Q216353' }} );
    }
  }

  class MockEditSystem {
    constructor() {}
    get staging() { return { graph: graph }; }
  }

  class MockLocalizationSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockContext {
    constructor()   {
      this.sequences = {};
      this.viewport = new Rapid.sdk.Viewport();
      this.services = {
        wikidata: new MockWikidataService(this)
      };
      this.systems = {
        assets:  new Rapid.AssetSystem(this),
        editor:  new MockEditSystem(this),
        l10n:    new MockLocalizationSystem(this)
      };
    }
    cleanTagKey(val)    { return val; }
    cleanTagValue(val)  { return val; }
    container()         { return selection; }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  let entity, base, graph, selection, field;

  beforeEach(() => {
    entity = new Rapid.OsmNode(context, { id: 'n-1', tags: {} });
    base = new Rapid.Graph(context, [entity]);
    graph = new Rapid.Graph(base);

    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, 'wikipedia', {
      key: 'wikipedia',
      keys: ['wikipedia', 'wikidata'],
      type: 'wikipedia'
    });
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  function changeTags(changed) {
    let tags = JSON.parse(JSON.stringify(entity.tags));   // deep copy
    for (const [k, v] of Object.entries(changed)) {
      tags[k] = v;
    }
    entity = entity.update({ tags: tags });
    graph = graph.replace(entity);
  }


  it('recognizes lang:title format', () => {
    const wikipedia = Rapid.uiFieldWikipedia(context, field);
    return delay(1)  // async, so data will be available
      .then(() => {
        selection.call(wikipedia);
        wikipedia.tags({ wikipedia: 'en:Title' });

        assert.strictEqual(Rapid.utilGetSetValue(selection.selectAll('.wiki-lang')), 'English');
        assert.strictEqual(Rapid.utilGetSetValue(selection.selectAll('.wiki-title')), 'Title');
      });
  });


  it('sets language, value', () => {
    const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
    return delay(1)  // async, so data will be available
      .then(() => {
        wikipedia.on('change', changeTags);
        selection.call(wikipedia);

        const spy = sinon.spy();
        wikipedia.on('change.spy', spy);

        Rapid.utilGetSetValue(selection.selectAll('.wiki-lang'), 'Deutsch');

        const langInput = selection.selectAll('.wiki-lang').node();
        langInput.dispatchEvent(new Event('change'));
        langInput.dispatchEvent(new FocusEvent('blur'));

        Rapid.utilGetSetValue(selection.selectAll('.wiki-title'), 'Title');

        const titleInput = selection.selectAll('.wiki-title').node();
        titleInput.dispatchEvent(new Event('change'));
        titleInput.dispatchEvent(new FocusEvent('blur'));

        assert.strictEqual(spy.callCount, 4);
        assert.deepEqual(spy.getCall(0).args[0], { wikipedia: undefined });   // lang on change
        assert.deepEqual(spy.getCall(1).args[0], { wikipedia: undefined });   // lang on blur
        assert.deepEqual(spy.getCall(2).args[0], { wikipedia: 'de:Title' });  // title on change
        assert.deepEqual(spy.getCall(3).args[0], { wikipedia: 'de:Title' });  // title on blur
      });
  });


  it('recognizes pasted URLs', () => {
    const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
    return delay(1)  // async, so data will be available
      .then(() => {
        wikipedia.on('change', changeTags);
        selection.call(wikipedia);

        Rapid.utilGetSetValue(selection.selectAll('.wiki-title'), 'http://de.wikipedia.org/wiki/Title');

        const titleInput = selection.selectAll('.wiki-title').node();
        titleInput.dispatchEvent(new Event('change'));

        assert.strictEqual(Rapid.utilGetSetValue(selection.selectAll('.wiki-lang')), 'Deutsch');
        assert.strictEqual(Rapid.utilGetSetValue(selection.selectAll('.wiki-title')), 'Title');
      });
  });


  describe('encodePath', () => {
    it('returns an encoded URI component that contains the title with spaces replaced by underscores', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      assert.strictEqual(wikipedia.encodePath('? (film)', undefined), '%3F_(film)');
      done();
    });

    it('returns an encoded URI component that includes an anchor fragment', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      // this can be tested manually by entering '? (film)#Themes and style in the search box before focusing out'
      assert.strictEqual(wikipedia.encodePath('? (film)', 'Themes and style'), '%3F_(film)#Themes_and_style');
      done();
    });
  });


  describe('encodeURIAnchorFragment', () => {
    it('returns an encoded URI anchor fragment', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      // this can be similarly tested by entering 'Section#Arts, entertainment and media' in the search box before focusing out'
      assert.strictEqual(wikipedia.encodeURIAnchorFragment('Theme?'), '#Theme%3F');
      done();
    });

    it('replaces all whitespace characters with underscore', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      assert.strictEqual(wikipedia.encodeURIAnchorFragment('Themes And Styles'), '#Themes_And_Styles');
      done();
    });

    it('encodes % characters, does not replace them with a dot', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      assert.strictEqual(wikipedia.encodeURIAnchorFragment('Is%this_100% correct'), '#Is%25this_100%25_correct');
      done();
    });

    it('encodes characters that are URI encoded characters', done => {
      const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
      assert.strictEqual(wikipedia.encodeURIAnchorFragment('Section %20%25'), '#Section_%2520%2525');
      done();
    });
  });


  it('defaults to previously-used language', () => {
    const wikipedia1 = Rapid.uiFieldWikipedia(context, field);
    const wikipedia2 = Rapid.uiFieldWikipedia(context, field);

    return delay(1)  // async, so data will be available
      .then(() => {
        selection.call(wikipedia1);
        Rapid.utilGetSetValue(selection.selectAll('.wiki-lang'), 'Deutsch');
      })
      .then(() => {
        selection.call(wikipedia2);
        wikipedia2.tags({});
        assert.strictEqual(Rapid.utilGetSetValue(selection.selectAll('.wiki-lang')), 'Deutsch');
      });
  });


  it.skip('does not set delayed wikidata tag if graph has changed', done => {
    const wikipedia = Rapid.uiFieldWikipedia(context, field).entityIDs([entity.id]);
    const editor = context.systems.editor;
    wikipedia.on('change', changeTags);
    selection.call(wikipedia);

    const spy = sinon.spy();
    wikipedia.on('change.spy', spy);

    // Set title to "Skip"
    Rapid.utilGetSetValue(selection.selectAll('.wiki-lang'), 'Deutsch');
    Rapid.utilGetSetValue(selection.selectAll('.wiki-title'), 'Skip');

    const titleInput = selection.selectAll('.wiki-title').node();
    titleInput.dispatchEvent(new Event('change'));
    titleInput.dispatchEvent(new FocusEvent('blur'));

    // t0
    const graph = editor.staging.graph;
    assert.isUndefined(graph.entity(entity.id).tags.wikidata);

    // t30:  graph change - Set title to "Title"
    setTimeout(() => {
      Rapid.utilGetSetValue(selection.selectAll('.wiki-title'), 'Title');

      const titleInput = selection.selectAll('.wiki-title').node();
      titleInput.dispatchEvent(new Event('change'));
      titleInput.dispatchEvent(new FocusEvent('blur'));
    }, 30);

    // t60:  at t0 + 60ms (delay), wikidata SHOULD NOT be set because graph has changed.

    // t70:  check that wikidata unchanged
    setTimeout(() => {
      const graph = editor.staging.graph;
      assert.isUndefined(graph.entity(entity.id).tags.wikidata);
    }, 70);

    // t90:  at t30 + 60ms (delay), wikidata SHOULD be set because graph is unchanged.

    // t100:  check that wikidata has changed
    setTimeout(() => {
      const graph = editor.staging.graph;
      assert.strictEqual(graph.entity(entity.id).tags.wikidata, 'Q216353');

      assert.strictEqual(spy.callCount, 4);
      assert.deepEqual(spy.getCall(0).args[0], { wikipedia: 'de:Skip' });    // 'Skip' on change
      assert.deepEqual(spy.getCall(1).args[0], { wikipedia: 'de:Skip' });    // 'Skip' on blur
      assert.deepEqual(spy.getCall(2).args[0], { wikipedia: 'de:Title' });   // 'Title' on change +10ms
      assert.deepEqual(spy.getCall(3).args[0], { wikipedia: 'de:Title' });   // 'Title' on blur   +10ms
      done();
    }, 100);

  });
});
