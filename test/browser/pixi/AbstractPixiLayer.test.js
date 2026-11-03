import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';


describe('AbstractPixiLayer', () => {
  function makeLayer() {
    const context = new Rapid.MockContext();
    return new AbstractPixiLayer({ context: context, gfx: {} });
  }

  it('binding a feature again to the same data keeps the data\'s parent and child links', () => {
    const layer = makeLayer();
    layer.bindData('r1-feature', 'r1');
    layer.bindData('w1-feature', 'w1');
    layer.addChildData('r1', 'w1');

    layer.bindData('r1-feature', 'r1');   // a redraw binds each feature again
    layer.bindData('w1-feature', 'w1');

    assert.sameMembers([...layer.getSelfAndDescendants('r1')], ['r1', 'w1']);
    assert.sameMembers([...layer.getSelfAndAncestors('w1')], ['w1', 'r1']);
  });

  it('unbinding the last feature of some data drops its links', () => {
    const layer = makeLayer();
    layer.bindData('r1-feature', 'r1');
    layer.addChildData('r1', 'w1');

    layer.unbindData('r1-feature');
    assert.sameMembers([...layer.getSelfAndDescendants('r1')], ['r1']);
  });
});
