describe('operationExtract', () => {

  const context = new Rapid.MockContext();

  class MockEditSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'editor';
    }
    get staging() { return { graph: _graph }; }
  }

  context.systems = {
    editor:   new MockEditSystem(context),
    l10n:     new Rapid.LocalizationSystem(context),
    schema:   new Rapid.SchemaSystem(context),
    storage:  new Rapid.StorageSystem(context)
  };
  context.hasHiddenConnections = () => false;
  let _graph;

  before(() => {
    return Promise.all([
      context.systems.l10n.initAsync(),
      // context.systems.schema.initAsync(),
      context.systems.storage.initAsync()
    ]);
  });

  describe('available', () => {
    beforeEach(() => {
      // a - node with tags & parent way
      // b - node with tags & 2 parent ways
      // c - node with no tags, parent way
      // d - node with no tags, 2 parent ways
      // e - node with tags, no parent way
      // f - node with no tags, no parent way
      _graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: 'x', nodes: ['a', 'b', 'c', 'd'] }),
        new Rapid.OsmWay(context, { id: 'y', nodes: ['b', 'd'] })
      ]);
    });

    it('is not available for no selected ids', () => {
      const result = Rapid.operationExtract(context, []).available();
      assert.isNotOk(result);
    });

    it('is not available for unknown selected id', () => {
      const result = Rapid.operationExtract(context, ['z']).available();
      assert.isNotOk(result);
    });

    it('is not available for selected way', () => {
      const result = Rapid.operationExtract(context, ['x']).available();
      assert.isNotOk(result);
    });

    it('is not available for selected node with tags, no parent way', () => {
      const result = Rapid.operationExtract(context, ['e']).available();
      assert.isNotOk(result);
    });

    it('is not available for selected node with no tags, no parent way', () => {
      const result = Rapid.operationExtract(context, ['f']).available();
      assert.isNotOk(result);
    });

    it('is not available for selected node with no tags, parent way', () => {
      const result = Rapid.operationExtract(context, ['c']).available();
      assert.isNotOk(result);
    });

    it('is not available for selected node with no tags, two parent ways', () => {
      const result = Rapid.operationExtract(context, ['d']).available();
      assert.isNotOk(result);
    });

    it('is available for selected node with tags, parent way', () => {
      const result = Rapid.operationExtract(context, ['a']).available();
      assert.isOk(result);
    });

    it('is available for selected node with tags, two parent ways', () => {
      const result = Rapid.operationExtract(context, ['b']).available();
      assert.isOk(result);
    });

    it('is available for two selected nodes with tags and parent ways', () => {
      const result = Rapid.operationExtract(context, ['a', 'b']).available();
      assert.isOk(result);
    });
  });


  describe('disabled', () => {
    it('returns enabled for non-related node', () => {
      _graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: 'x', nodes: ['a', 'b', 'c'] })
      ]);

      const result = Rapid.operationExtract(context, ['b']).disabled();
      assert.isNotOk(result);
    });

    it('returns enabled for non-restriction related node', () => {
      _graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: 'x', nodes: ['a', 'b', 'c'] }),
        new Rapid.OsmRelation(context, { id: 'r', members: [{ id: 'b', role: 'label' }] })
      ]);
      const result = Rapid.operationExtract(context, ['b']).disabled();
      assert.isNotOk(result);
    });

    it('returns enabled for via node in restriction', () => {
      // https://wiki.openstreetmap.org/wiki/Relation:restriction indicates that
      // from and to roles are only appropriate for Ways
      _graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: 'x', nodes: ['a', 'b', 'c'] }),
        new Rapid.OsmWay(context, { id: 'y', nodes: ['e', 'f', 'g'] }),
        new Rapid.OsmRelation(context, {id: 'r', tags: { type: 'restriction', restriction: 'no_right_turn' },
          members: [
            { id: 'x', type: 'way', role: 'from' },
            { id: 'd', type: 'node', role: 'via' },
            { id: 'z', type: 'way', role: 'to' }
          ]
        })
      ]);
      const result = Rapid.operationExtract(context, ['d']).disabled();
      assert.isNotOk(result);
    });

    it('returns enabled for location_hint node in restriction', () => {
      // https://wiki.openstreetmap.org/wiki/Relation:restriction indicates that
      // from and to roles are only appropriate for Ways
      _graph = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 0], tags: { 'name': 'fake' } }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0, 0] }),
        new Rapid.OsmWay(context, { id: 'x', nodes: ['a', 'b'] }),
        new Rapid.OsmWay(context, { id: 'y', nodes: ['e', 'f', 'g'] }),
        new Rapid.OsmRelation(context, {id: 'r', tags: {type: 'restriction', restriction: 'no_right_turn'},
          members: [
            { id: 'x', type: 'way', role: 'from' },
            { id: 'c', type: 'node', role: 'via' },
            { id: 'd', type: 'node', role: 'location_hint' },
            { id: 'z', type: 'way', role: 'to' }
          ]
        })
      ]);
      const result = Rapid.operationExtract(context, ['d']).disabled();
      assert.isNotOk(result);
    });
  });

});
