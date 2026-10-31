describe('PasteOperation', () => {

  const context = new Rapid.MockContext();

  class MockEditSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'editor';
    }
    get staging() { return { graph: _graph }; }
    beginTransaction() {}
    endTransaction() {}
    commit() {}
    perform(action) { _graph = action(new Rapid.Graph(_graph)); }
  }

  class MockMapSystem extends Rapid.MockSystem {
    constructor(context) {
      super(context);
      this.id = 'map';
    }
    mouseWorld() { return Rapid.sdk.projWgs84ToWorld([0.0005, 0]); }
  }

  context.systems = {
    editor:  new MockEditSystem(context),
    gfx:     { scene: { layers: new Map([['osm', { enabled: true }]]) }, immediateRedraw: () => {} },
    l10n:    new Rapid.LocalizationSystem(context),
    map:     new MockMapSystem(context)
  };
  context.enter = () => {};
  let _graph;

  before(() => {
    return context.systems.l10n.initAsync();
  });

  it('pastes at the copied nodes\' locations, even if the way\'s shared geometry changed after the copy', () => {
    const n1 = new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] });
    const n2 = new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0] });
    const w1 = new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2'] });
    const copyGraph = new Rapid.Graph(context, [n1, n2, w1]);
    w1.updateGeometry(copyGraph);

    // The user moves the way after copying it. `actionMove` keeps the same way object,
    // so its shared geometry now describes the moved shape.
    const moved = new Rapid.Graph(copyGraph)
      .replace(n1.move([1, 1]))
      .replace(n2.move([1.001, 1]))
      .commit();
    w1.updateGeometry(moved);

    _graph = new Rapid.Graph(moved);
    context.copyGraph = copyGraph;
    context.copyIDs = ['w1'];
    context.copyLoc = null;   // keyboard copy, no pointer location

    new Rapid.PasteOperation(context).run();

    // The pointer is at the center of the copied shape, so the copy lands where the original was.
    const newWay = [..._graph.local.entities.values()].find(e => e?.type === 'way' && e.id !== 'w1');
    assert.isOk(newWay);
    const locs = newWay.nodes.map(nodeID => _graph.entity(nodeID).loc);
    assert.closeTo(locs[0][0], 0, 1e-6);
    assert.closeTo(locs[0][1], 0, 1e-6);
    assert.closeTo(locs[1][0], 0.001, 1e-6);
    assert.closeTo(locs[1][1], 0, 1e-6);
  });

});
