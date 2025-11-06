describe('uiFieldLocalized', () => {

  class MockEditSystem {
    constructor(context) {
      this.context = context;
    }
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  class MockLocalizationSystem {
    constructor() { }
    localeCode()     { return 'en-US'; }
    languageCode()   { return 'en'; }
    t(id)            { return id; }
    tHtml(id)        { return id; }
    languageName(code) {
      const langs = {
        de: { nativeName: 'Deutsch' },
        en: { nativeName: 'English' }
      };
      return langs[code]?.nativeName;
    }
  }

  class MockContext {
    constructor()   {
      this.viewport = new Rapid.sdk.Viewport();
      this.sequences = {};
      this.services = {};
      this.systems = {
        assets:  new Rapid.AssetSystem(this),
        editor:  new MockEditSystem(this),
        l10n:    new MockLocalizationSystem(this)
      };
    }
    cleanTagKey(val)   { return val; }
    cleanTagValue(val) { return val; }
    container()        { return selection; }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  let selection, field;

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, 'name', { key: 'name', type: 'localized' });
    field.locked = () => { return false; };
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  it('adds a blank set of fields when the + button is clicked', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);

        const addButton = selection.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        assert.lengthOf(selection.selectAll('.localized-lang').nodes(), 1);
        assert.lengthOf(selection.selectAll('.localized-value').nodes(), 1);
      });
  });

  it('doesn\'t create a tag when the value is empty', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);

        const addButton = selection.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        localized.on('change', tags => {
          assert.deepEqual(tags, {});
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-lang'), 'Deutsch');

        const langInput = selection.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
        langInput.dispatchEvent(new FocusEvent('blur'));
      });
  });

  it('doesn\'t create a tag when the name is empty', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);

        const addButton = selection.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        localized.on('change', tags => {
          assert.deepEqual(tags, {});
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-value'), 'Value');

        const valueInput = selection.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
        valueInput.dispatchEvent(new FocusEvent('blur'));
      });
  });

  it('creates a tag after setting language then value', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);

        const addButton = selection.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        Rapid.utilGetSetValue(selection.selectAll('.localized-lang'), 'Deutsch');

        const langInput = selection.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': 'Value' });
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-value'), 'Value');

        const valueInput = selection.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
      });
  });

  it('creates a tag after setting value then language', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);

        const addButton = selection.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        Rapid.utilGetSetValue(selection.selectAll('.localized-value'), 'Value');

        const valueInput = selection.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': 'Value' });
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-lang'), 'Deutsch');

        const langInput = selection.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
      });
  });

  it('changes an existing language', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);
        localized.tags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined, 'name:en': 'Value' });
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-lang'), 'English');

        const langInput = selection.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
    });
  });

  it('ignores similar keys like `old_name`', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);
        localized.tags({ 'old_name:de': 'Value' });

        assert.isTrue(selection.selectAll('.localized-lang').empty());
        assert.isTrue(selection.selectAll('.localized-value').empty());
      });
  });

  it('removes the tag when the language is emptied', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);
        localized.tags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined });
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-lang'), '');

        const langInput = selection.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
      });
  });

  it('removes the tag when the value is emptied', () => {
    const localized = Rapid.uiFieldLocalized(context, field);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);
        localized.tags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined });
        });

        Rapid.utilGetSetValue(selection.selectAll('.localized-value'), '');

        const valueInput = selection.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
      });
  });
});
