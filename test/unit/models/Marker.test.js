import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Marker', () => {

  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
    }
  }

  const context = new MockContext();

  describe('constructor', () => {
    it('constructs a Marker with no props', () => {
      const marker = new Rapid.Marker(context);
      assert.instanceOf(marker, Rapid.Marker);
      assert.ok(marker.id, 'should have an id');
      assert.isTrue(marker.geoms.dirty, 'no loc property');
    });

    it('constructs a Marker with props', () => {
      const props = {
        id: 'test1',
        serviceID: 'service',
        loc: [0, 0]
      };
      const marker = new Rapid.Marker(context, props);
      assert.instanceOf(marker, Rapid.Marker);
      assert.equal(marker.id, 'test1');
      assert.deepEqual(marker.loc, [0, 0]);
      assert.isFalse(marker.geoms.dirty);
    });
  });

});
