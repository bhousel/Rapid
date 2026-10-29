import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { AbstractMode } from '../../../modules/modes/AbstractMode.ts';


describe('AbstractMode', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    spatial: new Rapid.SpatialSystem(context)
  };
  const spatial = context.systems.spatial;

  function note(id, props = {}) {
    return new Rapid.MarkerData(context, { id: id, namespace: 'notes-test', loc: [0, 0], ...props });
  }


  describe('selection', () => {
    it('keeps the data IDs, and selectedIDs returns a copy', () => {
      const mode = new AbstractMode(context);
      mode._selectedIDs = ['w1', 'notes-test:1'];

      const ids = mode.selectedIDs;
      assert.deepEqual(ids, ['w1', 'notes-test:1']);
      ids.push('w2');
      assert.deepEqual(mode.selectedIDs, ['w1', 'notes-test:1']);
    });

    it('selectedData looks up each data ID, so it gets the current version', () => {
      const mode = new AbstractMode(context);
      spatial.replaceData('notes-test', note('1', { status: 'open' }));
      mode._selectedIDs = ['notes-test:1'];
      assert.strictEqual(mode.selectedData.get('notes-test:1').props.status, 'open');

      spatial.replaceData('notes-test', note('1', { status: 'closed' }));
      assert.strictEqual(mode.selectedData.get('notes-test:1').props.status, 'closed');
    });

    it('selectedData leaves out data that can\'t be found', () => {
      const mode = new AbstractMode(context);
      spatial.replaceData('notes-test', note('2'));
      mode._selectedIDs = ['notes-test:2', 'notes-test:missing'];
      assert.deepEqual([...mode.selectedData.keys()], ['notes-test:2']);
    });
  });
});
