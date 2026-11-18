import { SelectMode } from '../../../modules/modes/SelectMode.ts';


describe('SelectMode', () => {

  // Which arrow keys reach the selection, and when the photo viewers leave them to it
  describe('arrow keys', () => {
    let context, mode, calls, $button;

    const keydown = (key, props = {}) => ({ key: key, preventDefault: () => {}, ...props });

    beforeEach(() => {
      context = new Rapid.MockContext();
      context.editable = () => true;
      context.systems = {
        editor: { staging: { graph: new Rapid.Graph(context) } }
      };
      calls = [];
      mode = new SelectMode(context);
      mode._selectedIDs = ['w1'];   // a way is selected
      mode._osmIDs = ['w1'];
      mode._selectParentWays = () => calls.push('parents');
      mode._selectChildNodes = () => calls.push('children');
      $button = d3.select(document.body).append('button');
    });

    afterEach(() => {
      $button.remove();
    });


    it('selects parents and children with a modifier and ↑↓ while a button has focus', () => {
      $button.node().focus();
      mode._keydown(keydown('ArrowUp', { ctrlKey: true }));
      mode._keydown(keydown('ArrowDown', { metaKey: true }));
      assert.deepEqual(calls, ['parents', 'children']);
    });

    it('leaves the arrow keys alone while a preset button or a text field has focus', () => {
      $button.classed('preset-list-button', true).node().focus();
      mode._keydown(keydown('ArrowUp', { ctrlKey: true }));

      const $input = d3.select(document.body).append('input');
      $input.node().focus();
      mode._keydown(keydown('ArrowUp', { ctrlKey: true }));
      $input.remove();

      assert.deepEqual(calls, []);
    });

    it('the arrow keys move a selection of OSM features that can be edited', () => {
      assert.isTrue(mode.movesWithArrowKeys);

      mode._selectedIDs = ['w1', 'notes-test:1'];   // not all OSM
      assert.isFalse(mode.movesWithArrowKeys);

      mode._selectedIDs = ['w1'];
      context.editable = () => false;
      assert.isFalse(mode.movesWithArrowKeys);
    });

    it('the photo viewers leave the arrow keys to a selection that moves with them', () => {
      const photos = new Rapid.PhotoSystem(context);
      context.mode = mode;
      assert.isTrue(photos.arrowKeysMoveSelection());

      mode._selectedIDs = ['notes-test:1'];
      mode._osmIDs = [];
      assert.isFalse(photos.arrowKeysMoveSelection());

      context.mode = { id: 'browse' };
      assert.isFalse(photos.arrowKeysMoveSelection());
    });

    it('a photo viewer steps through photos only when the selection doesn\'t take the arrow keys', () => {
      const kartaview = new Rapid.KartaviewService(context);
      const steps = [];
      kartaview._step = stepBy => steps.push(stepBy);
      let moves = true;
      context.systems.gfx = { eventManager: { modifierKeys: new Set() } };
      context.systems.photos = {
        isViewerShowing: () => true,
        currPhotoLayerID: 'kartaview',
        arrowKeysMoveSelection: () => moves
      };
      document.activeElement?.blur();

      kartaview._keydown(keydown('ArrowRight'));
      moves = false;
      kartaview._keydown(keydown('ArrowRight'));
      assert.deepEqual(steps, [1]);
    });
  });
});
