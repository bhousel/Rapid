import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { AddNoteMode } from '../../../modules/modes/AddNoteMode.ts';


describe('AddNoteMode', () => {
  it('adds a new note that SelectMode shows in the note editor', () => {
    const context = new Rapid.MockContext();
    let stored, entered;
    context.services = { osm: { replaceNote: note => stored = note } };
    context.enter = (modeID, options) => entered = { modeID, options };

    const mode = new AddNoteMode(context);
    mode._click({ coord: { map: [0, 0] } });

    // SelectMode opens the note editor for a MarkerData from the 'osm' service with type 'note'
    assert.instanceOf(stored, Rapid.MarkerData);
    assert.strictEqual(stored.type, 'note');
    assert.strictEqual(stored.serviceID, 'osm');
    assert.isTrue(stored.isNew);
    assert.deepEqual(entered, { modeID: 'select', options: { selection: [stored.dataID] } });
  });
});
