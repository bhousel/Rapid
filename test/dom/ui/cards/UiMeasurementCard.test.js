describe('UiMeasurementCard', () => {
  let $container;

  beforeEach(() => {
    $container = d3.select('body').append('div');
  });

  afterEach(() => {
    $container.remove();
  });


  function makeContext(graph, selectedIDs) {
    const context = new Rapid.MockContext();
    context.systems.editor = { staging: { graph: graph } };
    context.systems.gfx = { on: () => {} };
    context.systems.keyboard = { global: { on: () => {}, off: () => {} } };
    context.systems.l10n = {
      isMetric: true,
      localeCode: 'en',
      on: () => {},
      t: key => key,
      displayArea: val => String(val),
      displayLength: val => String(val),
      dmsCoordinatePair: loc => String(loc),
      decimalCoordinatePair: loc => String(loc)
    };
    context.selectedIDs = () => selectedIDs;
    context.selectedData = () => new Map();
    return context;
  }


  it('does not rewind the memoized GeoJSON of the selected way', () => {
    const context = new Rapid.MockContext();
    // Counterclockwise ring, so rewinding it (outer ring clockwise) would reverse it
    const graph = new Rapid.Graph(context, [
      new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0] }),
      new Rapid.OsmNode(context, { id: 'n2', loc: [0.001, 0] }),
      new Rapid.OsmNode(context, { id: 'n3', loc: [0.001, 0.001] }),
      new Rapid.OsmNode(context, { id: 'n4', loc: [0, 0.001] }),
      new Rapid.OsmWay(context, { id: 'w1', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'], tags: { area: 'yes' } })
    ]);
    const way = graph.entity('w1');
    const before = structuredClone(way.asGeoJSON(graph));

    const card = new Rapid.UiMeasurementCard(makeContext(graph, ['w1']));
    card._isVisible = true;
    card.render($container);

    assert.deepEqual(way.asGeoJSON(graph), before);
    assert.isNotEmpty($container.selectAll('.card-content li').nodes());
  });

});
