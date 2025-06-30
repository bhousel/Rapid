import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Marker', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs a Marker with no props', () => {
      const marker = new Rapid.Marker(context);
      assert.instanceOf(marker, Rapid.Marker);
      assert.ok(marker.id, 'should have an id');
      const geoms = marker.geoms;
      assert.lengthOf(geoms.parts, 0);
      assert.isNotOk(geoms.world, 'no loc property');
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
      const geoms = marker.geoms;
      assert.lengthOf(geoms.parts, 1);
      assert.isOk(geoms.world);
    });
  });

});
