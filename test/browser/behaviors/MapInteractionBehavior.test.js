import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { MapInteractionBehavior } from '../../../modules/behaviors/MapInteractionBehavior.ts';


describe('MapInteractionBehavior', () => {
  let context, behavior, pans, selectedIDs;

  function press(key, options = {}) {
    behavior._keydown(new KeyboardEvent('keydown', { key: key, ...options }));
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    pans = [];
    selectedIDs = [];
    context.systems = {
      map: { pan: delta => pans.push(delta) },
      photos: { isViewerShowing: () => false }
    };
    context.viewport.dimensions = [800, 600];
    context.selectedIDs = () => selectedIDs;
    behavior = new MapInteractionBehavior(context);
  });


  describe('arrow keys', () => {
    it('pan the map', () => {
      context.mode = { id: 'browse' };
      press('ArrowUp');
      press('ArrowUp', { ctrlKey: true });
      assert.lengthOf(pans, 2);
    });

    it('leave everything to select mode when everything selected is OSM', () => {
      context.mode = { id: 'select' };
      selectedIDs = ['w1'];
      press('ArrowLeft');
      assert.lengthOf(pans, 0);
    });

    it('with a modifier and ↑↓, leave selecting parents or children to select mode in a mixed selection', () => {
      context.mode = { id: 'select' };
      selectedIDs = ['n1', 'osm-notes:1'];
      press('ArrowUp', { ctrlKey: true });
      press('ArrowDown', { metaKey: true });
      assert.lengthOf(pans, 0);

      press('ArrowLeft', { ctrlKey: true });   // still pans
      press('ArrowUp');
      assert.lengthOf(pans, 2);
    });

    it('with a modifier and ↑↓, pan when nothing selected is OSM', () => {
      context.mode = { id: 'select' };
      selectedIDs = ['osm-notes:1'];
      press('ArrowUp', { ctrlKey: true });
      assert.lengthOf(pans, 1);
    });
  });
});
