import { beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PhotoSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a PhotoSystem from a context', () => {
        const photos = new Rapid.PhotoSystem(context);
        assert.instanceOf(photos, Rapid.PhotoSystem);
        assert.strictEqual(photos.id, 'photos');
        assert.strictEqual(photos.context, context);
        assert.instanceOf(photos.requiredDependencies, Set);
        assert.instanceOf(photos.optionalDependencies, Set);
        assert.isTrue(photos.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const photos = new Rapid.PhotoSystem(context);
        const prom = photos.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const photos = new Rapid.PhotoSystem(context);
        photos.requiredDependencies.add('missing');
        const prom = photos.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const photos = new Rapid.PhotoSystem(context);
        const prom = photos.initAsync().then(() => photos.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(photos.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const photos = new Rapid.PhotoSystem(context);
        const prom = photos.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _photos;

    beforeAll(() => {
      _photos = new Rapid.PhotoSystem(context);
      return _photos.initAsync().then(() => _photos.startAsync());
    });
  });


  describe('the legacy `photo_overlay` url param', () => {
    it('turns on the photo layers it names, and drops it from the url', () => {
      const ctx = new Rapid.MockContext();
      const enabledLayers = [];
      const urlParams = new Map();
      ctx.systems = {
        gfx: { scene: { enableLayers: layerIDs => enabledLayers.push(...layerIDs) } },
        urlhash: { setParam: (k, v) => urlParams.set(k, v) }
      };
      const photos = new Rapid.PhotoSystem(ctx);

      photos._hashChanged(new Map([['photo_overlay', 'mapillary,osm,streetside']]), new Map());
      assert.sameMembers(enabledLayers, ['mapillary', 'streetside']);   // only photo layers
      assert.isTrue(urlParams.has('photo_overlay'));
      assert.isNull(urlParams.get('photo_overlay'));
    });
  });


  // The photo filters are for this session only, and a link's `photo_dates` and `photo_username`
  // stay in the url until the user changes those filters.  The filters aren't written to the url.
  describe('photo filters in the url', () => {
    let photos, urlParams;

    function hashChange(curr, prev = []) {
      photos._hashChanged(new Map(curr), new Map(prev));
    }

    beforeEach(() => {
      const ctx = new Rapid.MockContext();
      urlParams = new Map();
      ctx.systems = {
        urlhash: {
          getParam: k => urlParams.get(k),
          setParam: (k, v) => (v === null || v === undefined ? urlParams.delete(k) : urlParams.set(k, v))
        }
      };
      photos = new Rapid.PhotoSystem(ctx);
    });

    it('applies a link\'s filters, and keeps them in the url until the user changes them', () => {
      urlParams.set('photo_dates', '2019-01-01|2020-12-31');
      urlParams.set('photo_username', 'alice,bob');
      hashChange(urlParams);
      assert.strictEqual(photos.fromDate, '2019-01-01');
      assert.strictEqual(photos.toDate, '2020-12-31');
      assert.deepEqual(photos.usernames, ['alice', 'bob']);
      assert.strictEqual(urlParams.get('photo_dates'), '2019-01-01|2020-12-31');
      assert.strictEqual(urlParams.get('photo_username'), 'alice,bob');

      photos.setDateFilter('fromDate', '2018-01-01');
      assert.isFalse(urlParams.has('photo_dates'));
      assert.isTrue(urlParams.has('photo_username'));
      assert.strictEqual(photos.toDate, '2020-12-31');

      photos.setUsernameFilter(['carol']);
      assert.isFalse(urlParams.has('photo_username'));
    });

    it('doesn\'t write the filters the user picks to the url', () => {
      photos.setDateFilter('fromDate', '2018-01-01');
      photos.setUsernameFilter(['carol']);
      assert.strictEqual(urlParams.size, 0);
    });

    it('leaves the filters alone when their params go away', () => {
      urlParams.set('photo_username', 'alice');
      hashChange(urlParams);
      urlParams.delete('photo_username');
      hashChange([], [['photo_username', 'alice']]);
      assert.deepEqual(photos.usernames, ['alice']);
    });

    it('doesn\'t apply a value that was dropped while the url was being read', () => {
      hashChange([['photo_username', 'alice']]);   // in the emitted params, but not the url anymore
      assert.isNull(photos.usernames);
    });
  });

});
