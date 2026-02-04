describe('uiFieldLocalized', () => {

  const context = new Rapid.MockContext();
  let selection, field, uifield;

  class MockEditSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'editor';
    }
    get staging() {
      return { graph: new Rapid.Graph(this.context) };
    }
  }

  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    editor:  new MockEditSystem(context),
    l10n:    new Rapid.LocalizationSystem(context),
    schema:  new Rapid.SchemaSystem(context)
  };
  context.container = () => selection;

  before(() => {
    // Setup mock asset data that LocalizationSystem attempts to load during initAsync.
    const assets = context.systems.assets;
    assets._loaded.languages = { languages: { de: { nativeName: 'Deutsch' }, en: { nativeName: 'English' } } };
    assets._loaded.locales = { locales: { en: { rtl: false }, de: { rtl: false } } };
    assets._loaded.territory_languages = { territoryLanguages: { de: ['de'], us: ['en'] } };

    return context.systems.l10n.initAsync();
  });

  beforeEach(() => {
    selection = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, { id: 'name', key: 'name', type: 'localized' });
    uifield = new Rapid.UiField(context, field);
    uifield.locked = () => { return false; };
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  it('adds a blank set of fields when the + button is clicked', () => {
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        selection.call(localized);
        localized.tags({ 'old_name:de': 'Value' });

        assert.isTrue(selection.selectAll('.localized-lang').empty());
        assert.isTrue(selection.selectAll('.localized-value').empty());
      });
  });

  it('removes the tag when the language is emptied', () => {
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
    const localized = Rapid.uiFieldLocalized(context, uifield);
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
