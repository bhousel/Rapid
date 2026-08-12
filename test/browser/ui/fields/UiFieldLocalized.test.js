describe('UiFieldLocalized', () => {

  const context = new Rapid.MockContext();
  let $container, field;

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
    assets:    new Rapid.AssetSystem(context),
    editor:    new MockEditSystem(context),
    l10n:      new Rapid.LocalizationSystem(context),
    network:   new Rapid.NetworkSystem(context),
    scheduler: new Rapid.SchedulerSystem(context),
    schema:    new Rapid.SchemaSystem(context)
  };

  before(() => {
    // Setup mock asset data that LocalizationSystem attempts to load during initAsync.
    const assets = context.systems.assets;
    assets._loaded.languages = { languages: { de: { nativeName: 'Deutsch' }, en: { nativeName: 'English' } } };
    assets._loaded.locales = { locales: { en: { rtl: false }, de: { rtl: false } } };
    assets._loaded.territory_languages = { territoryLanguages: { de: ['de'], us: ['en'] } };
    assets._loaded.l10n_core_en = { en: {} };
    assets._loaded.l10n_tagging_en = { en: {} };
    assets._loaded.l10n_imagery_en = { en: {} };
    assets._loaded.l10n_community_en = { en: {} };

    const l10n = context.systems.l10n;
    const scheduler = context.systems.scheduler;
    return Promise.all([l10n.initAsync(), scheduler.initAsync()])
      .then(() => Promise.all([l10n.startAsync(), scheduler.startAsync()]));
  });

  beforeEach(() => {
    context.$container = $container = d3.select(document.createElement('div'));
    field = new Rapid.Field(context, { id: 'name', key: 'name', type: 'localized' });
  });

  afterEach(() => {
    $container.remove();
    context.$container = d3.select(null);
  });

  function delay(msec) {
    return new Promise(resolve => { setTimeout(resolve, msec); });
  }


  it('adds a blank set of fields when the + button is clicked', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);

        const addButton = $container.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        assert.lengthOf($container.selectAll('.localized-lang').nodes(), 1);
        assert.lengthOf($container.selectAll('.localized-value').nodes(), 1);
      });
  });

  it('doesn\'t create a tag when the value is empty', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);

        const addButton = $container.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        localized.on('change', tags => {
          assert.deepEqual(tags, {});
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-lang'), 'Deutsch');

        const langInput = $container.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
        langInput.dispatchEvent(new FocusEvent('blur'));
      });
  });

  it('doesn\'t create a tag when the name is empty', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);

        const addButton = $container.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        localized.on('change', tags => {
          assert.deepEqual(tags, {});
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-value'), 'Value');

        const valueInput = $container.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
        valueInput.dispatchEvent(new FocusEvent('blur'));
      });
  });

  it('creates a tag after setting language then value', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);

        const addButton = $container.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        Rapid.utilGetSetValue($container.selectAll('.localized-lang'), 'Deutsch');

        const langInput = $container.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': 'Value' });
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-value'), 'Value');

        const valueInput = $container.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
      });
  });

  it('creates a tag after setting value then language', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);

        const addButton = $container.selectAll('.localized-add').node();
        addButton.dispatchEvent(new MouseEvent('click'));

        Rapid.utilGetSetValue($container.selectAll('.localized-value'), 'Value');

        const valueInput = $container.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': 'Value' });
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-lang'), 'Deutsch');

        const langInput = $container.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
      });
  });

  it('changes an existing language', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);
        localized.syncTags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined, 'name:en': 'Value' });
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-lang'), 'English');

        const langInput = $container.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
    });
  });

  it('ignores similar keys like `old_name`', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);
        localized.syncTags({ 'old_name:de': 'Value' });

        assert.isTrue($container.selectAll('.localized-lang').empty());
        assert.isTrue($container.selectAll('.localized-value').empty());
      });
  });

  it('removes the tag when the language is emptied', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);
        localized.syncTags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined });
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-lang'), '');

        const langInput = $container.selectAll('.localized-lang').node();
        langInput.dispatchEvent(new Event('change'));
      });
  });

  it('removes the tag when the value is emptied', () => {
    const localized = new Rapid.UiFieldLocalized(context, field);
    localized.locked = () => false;
    return delay(1)  // async, so AssetSystem promise will have settled
      .then(() => {
        $container.call(localized.render);
        localized.syncTags({ 'name:de': 'Value' });

        localized.on('change', tags => {
          assert.deepEqual(tags, { 'name:de': undefined });
        });

        Rapid.utilGetSetValue($container.selectAll('.localized-value'), '');

        const valueInput = $container.selectAll('.localized-value').node();
        valueInput.dispatchEvent(new Event('change'));
      });
  });
});
