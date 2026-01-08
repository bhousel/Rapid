import { beforeAll, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './ImagerySource.sample.js';

// const mockResponse = {
//   ok: true,
//   status: 200,
//   statusText: 'OK',
//   url: 'http://example.com/data.json',
//   headers: {
//     get: () => 'application/json'
//   }
// };


describe('ImagerySource', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.ImagerySource(context), /missing id/i);
    });

    it('constructs an ImagerySource from a context and props', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test' });
      assert.instanceOf(source, Rapid.ImagerySource);
      assert.strictEqual(source.context, context);
    });

    it('constructs an ImagerySource with an encrypted template', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test', encrypted: true, template: '5597506f958c53716d3dbd79' });
      assert.deepEqual(source._template, 'Hello Rapid!');
    });
  });


  // Test some already-constructed sources..
  describe('methods', () => {
    let _bing, _esri, _nj, _none, _custom;

    beforeAll(() => {
      // sources
      _bing = new Rapid.ImagerySourceBing(context, sample.bingProps);
      _esri = new Rapid.ImagerySourceEsri(context, sample.esriProps);
      _nj = new Rapid.ImagerySource(context, sample.njProps);
      _none = new Rapid.ImagerySourceNone(context);
      _custom = new Rapid.ImagerySourceCustom(context, '');

      _bing.reset();
      _esri.reset();
      _nj.reset();
      _none.reset();
      _custom.reset();
    });

    describe('strings', () => {
      it('has a Map to hold prelocalized strings', () => {
        assert.instanceOf(_bing._strings, Map);
        assert.hasAllKeys(_bing._strings, ['en-US']);
      });

      it('stores the current locale code', () => {
        assert.deepEqual(_bing._currLocaleCode, 'en-US');
      });

      it('stores the current strings', () => {
        const currStrings = _bing._currStrings;
        assert.isObject(currStrings);
        assert.strictEqual(currStrings, _bing._strings.get('en-US'));
        assert.deepEqual(currStrings, sample.bingStrings);
      });
    });

    describe('stringIDs', () => {
      it('stores stringIDs in props', () => {
        assert.strictEqual(_bing.props.nameStringID, '_imagery.imagery.Bing.name');
        assert.strictEqual(_bing.props.descriptionStringID, '_imagery.imagery.Bing.description');

        assert.strictEqual(_none.props.nameStringID, 'background.none');
        assert.strictEqual(_none.props.descriptionStringID, '');

        assert.strictEqual(_custom.props.nameStringID, 'background.custom');
        assert.strictEqual(_custom.props.descriptionStringID, '');
      });
    });

    describe('name', () => {
      it('returns the prelocalized name', () => {
        assert.strictEqual(_bing.name, _bing._currStrings.name);
        assert.strictEqual(_bing.name, sample.bingStrings.name);

        assert.strictEqual(_esri.name, _esri._currStrings.name);
        assert.strictEqual(_esri.name, sample.esriStrings.name);
      });
    });

    describe('description', () => {
      it('returns the prelocalized description', () => {
        assert.strictEqual(_bing.description, _bing._currStrings.description);
        assert.strictEqual(_bing.description, sample.bingStrings.description);

        assert.strictEqual(_esri.description, _esri._currStrings.description);
        assert.strictEqual(_esri.description, sample.esriStrings.description);
      });
    });

    describe('safeid', () => {
      it('computes a safeid by removing spaces from the id', () => {
        assert.strictEqual(_bing.safeid, 'bing');
        assert.strictEqual(_esri.safeid, 'esriworldimagery');
        assert.strictEqual(_nj.safeid, 'test_nj_imagery');
      });
    });

    describe('key', () => {
      it('uses the safeid as the key', () => {
        assert.strictEqual(_bing.key, _bing.safeid);
        assert.strictEqual(_esri.key, _esri.safeid);
        assert.strictEqual(_nj.key, _nj.safeid);
      });
    });

    describe('imageryUsed', () => {
      it('uses the name as the imageryUsed', () => {
        assert.strictEqual(_bing.imageryUsed, _bing._currStrings.name);
        assert.strictEqual(_esri.imageryUsed, _esri._currStrings.name);
        assert.strictEqual(_nj.imageryUsed, _nj._currStrings.name);
      });

      it(`returns null for 'none'`, () => {
        assert.isNull(_none.imageryUsed);
      });
    });

    describe('template', () => {
      it('gets the template', () => {
        assert.strictEqual(_bing.template, _bing._template);
        assert.strictEqual(_esri.template, _esri._template);
        assert.strictEqual(_nj.template, _nj._template);
      });

      it(`returns empty string for 'none'`, () => {
        assert.strictEqual(_none.template, '');
      });
    });

    describe('area', () => {
      it('returns max number for sources with no polygon (worldwide)', () => {
        assert.strictEqual(_bing.area, Number.MAX_VALUE);
        assert.strictEqual(_esri.area, Number.MAX_VALUE);
      });

      it('returns a reasonable area for sources with a polygon', () => {
        assert.closeTo(_nj.area, 12, 1);
      });

      it(`returns -1 for 'none'`, () => {
        assert.strictEqual(_none.area, -1);
      });

      it(`returns -2 for 'custom'`, () => {
        assert.strictEqual(_custom.area, -2);
      });
    });
  });


  describe('url', () => {
    it('does not error with blank template', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', template: '' });
      assert.strictEqual(source.url([0,1,2]), '');
    });

    it('supports tms replacement tokens', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', type: 'tms', template: '{z}/{x}/{y}' });
      assert.strictEqual(source.url([0,1,2]), '2/0/1');
    });

    it('supports wms replacement tokens for EPSG:3857 (older wms)', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:3857',
        template: 'SRS={proj}&imageSR={wkid}&bboxSR={wkid}&FORMAT=image/jpeg&WIDTH={width}&HEIGHT={height}&BBOX={bbox}'
      });

      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const expected = {
        SRS:     'EPSG:3857',
        imageSR: '3857',
        bboxSR:  '3857',
        FORMAT:  'image/jpeg',
        WIDTH:   '256',
        HEIGHT:  '256'
      };

      assert.deepInclude(result, expected);

      const bbox = result.BBOX.split(',');
      assert.closeTo(+bbox[0], -20037508.34, 1e-6);
      assert.closeTo(+bbox[1], 0, 1e-6);
      assert.closeTo(+bbox[2], -10018754.17, 1e-6);
      assert.closeTo(+bbox[3], 10018754.17, 1e-6);
    });

    it('supports wms replacement tokens for EPSG:4326 (older wms)', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:4326',
        template: 'SRS={proj}&imageSR={wkid}&bboxSR={wkid}&FORMAT=image/jpeg&WIDTH={width}&HEIGHT={height}&BBOX={bbox}'
      });

      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const expected = {
        SRS:     'EPSG:4326',
        imageSR: '4326',
        bboxSR:  '4326',
        FORMAT:  'image/jpeg',
        WIDTH:   '256',
        HEIGHT:  '256'
      };

      assert.deepInclude(result, expected);

      const bbox = result.BBOX.split(',');
      assert.closeTo(+bbox[0], -180, 1e-6);
      assert.closeTo(+bbox[1], 0, 1e-6);
      assert.closeTo(+bbox[2], -90, 1e-6);
      assert.closeTo(+bbox[3], 66.513260, 1e-6);
    });

    it('retains bbox order for EPSG:3857 on newer wms server', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:3857',
        template: 'VERSION=1.3&SRS={proj}&imageSR={wkid}&bboxSR={wkid}&FORMAT=image/jpeg&WIDTH={width}&HEIGHT={height}&BBOX={bbox}'
      });

      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const bbox = result.BBOX.split(',');
      assert.closeTo(+bbox[0], -20037508.34, 1e-6);
      assert.closeTo(+bbox[1], 0, 1e-6);
      assert.closeTo(+bbox[2], -10018754.17, 1e-6);
      assert.closeTo(+bbox[3], 10018754.17, 1e-6);
    });

    it('flips bbox order for EPSG:4326 on newer wms server', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:4326',
        template: 'VERSION=1.3&SRS={proj}&imageSR={wkid}&bboxSR={wkid}&FORMAT=image/jpeg&WIDTH={width}&HEIGHT={height}&BBOX={bbox}'
      });

      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const bbox = result.BBOX.split(',');
      assert.closeTo(+bbox[0], 0, 1e-6);
      assert.closeTo(+bbox[1], -180, 1e-6);
      assert.closeTo(+bbox[2], 66.513260, 1e-6);
      assert.closeTo(+bbox[3], -90, 1e-6);
    });

    it('supports wms replacement tokens w,s,n,e', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:4326',
        template: 'SRS={proj}&BBOX={w},{s},{n},{e}'
      });

      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const bbox = result.BBOX.split(',');
      assert.closeTo(+bbox[0], -180, 1e-6);
      assert.closeTo(+bbox[1], 0, 1e-6);
      assert.closeTo(+bbox[2], -90, 1e-6);
      assert.closeTo(+bbox[3], 66.513260, 1e-6);
    });

    it('ignores unknown wms replacement tokens', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        type: 'wms',
        projection: 'EPSG:4326',
        template: 'SRS={proj}&FOO={bar}&BBOX={bbox}'
      });
      const result = Rapid.sdk.utilStringQs(source.url([0,1,2]));
      const expected = {
        SRS: 'EPSG:4326',
        FOO: '{bar}'
      };
      assert.deepInclude(result, expected);
    });

    it('supports bing replacement tokens', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', type: 'bing', template: '{u}' });
      const coord = [1, 1, 1];
      assert.strictEqual(source.url(coord), '3');
    });

    it('supports switch: subdomains', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', template: '{switch:a,b}/{z}/{x}/{y}' });
      assert.strictEqual(source.url([0,1,2]), 'b/2/0/1');
    });

    it('distributes switch: requests between subdomains', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', template: '{switch:a,b}/{z}/{x}/{y}' });
      assert.strictEqual(source.url([0,1,1]), 'b/1/0/1');
      assert.strictEqual(source.url([0,2,1]), 'a/1/0/2');
    });

    it('custom source, unknown type, guess wms', () => {
      const source = new Rapid.ImagerySourceCustom(context, '&imageSR={wkid}&bboxSR={wkid}&FORMAT=image/jpeg&WIDTH={width}&HEIGHT={height}&BBOX={bbox}');
      source.url([0,1,2]);
      assert.deepEqual(source.type, 'wms');
      assert.deepEqual(source.props.projection, 'EPSG:3857');
    });

    it('custom source, unknown type, guess tms', () => {
      const source = new Rapid.ImagerySourceCustom(context, '{switch:a,b}/{z}/{x}/{y}');
      source.url([0,1,2]);
      assert.deepEqual(source.type, 'tms');
    });

    it('custom source, unknown type, guess bing', () => {
      const source = new Rapid.ImagerySourceCustom(context, '{u}');
      source.url([0,1,2]);
      assert.deepEqual(source.type, 'bing');
    });

  });


  describe('isValidZoom', () => {
    it('returns false if passed not a number', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', zoomExtent: [6,16] });
      assert.isFalse(source.isValidZoom());
      assert.isFalse(source.isValidZoom(NaN));
      assert.isFalse(source.isValidZoom(null));
      assert.isFalse(source.isValidZoom('fake'));
    });

    it('correctly respects min/max zoomExtent', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid', zoomExtent: [6,16] });
      assert.isFalse(source.isValidZoom(-Infinity));
      assert.isFalse(source.isValidZoom(5));
      assert.isTrue(source.isValidZoom(6));
      assert.isTrue(source.isValidZoom(16));
      assert.isFalse(source.isValidZoom(17));
      assert.isFalse(source.isValidZoom(Infinity));
    });
  });


  describe('isLocatorOverlay', () => {
    it('returns true only for the locator overlay', () => {
      const source1 = new Rapid.ImagerySource(context, { id: 'anyid' });
      const source2 = new Rapid.ImagerySource(context, { id: 'mapbox_locator_overlay' });
      assert.isFalse(source1.isLocatorOverlay());
      assert.isTrue(source2.isLocatorOverlay());
    });
  });

  describe('isBuiltin', () => {
    it('returns true only for sources with no bundleID', () => {
      const source1 = new Rapid.ImagerySource(context, { id: 'anyid1', bundleID: 'editor-layer-index' });
      const source2 = new Rapid.ImagerySource(context, { id: 'anyid2' });
      assert.isFalse(source1.isBuiltin());
      assert.isTrue(source2.isBuiltin());
    });
  });


  describe('_vintageRange', () => {
    it('returns undefined if the input does not have a start or end', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test' });
      assert.isUndefined(source._vintageRange({}));
    });

    it('returns a string with the start date if only the start is provided', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test' });
      assert.strictEqual(source._vintageRange({ start: 'Jan 1, 2020' }), 'Jan 1, 2020 - ?');
    });

    it('returns a string with the end date if only the end is provided', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test' });
      assert.strictEqual(source._vintageRange({ end: 'Dec 31, 2020' }), '? - Dec 31, 2020');
    });

    it('returns a range string if both the start and end are provided', () => {
      const source = new Rapid.ImagerySource(context, { id: 'test' });
      assert.strictEqual(source._vintageRange({ start: 'Jan 1, 2020', end: 'Dec 31, 2020' }), 'Jan 1, 2020 - Dec 31, 2020');
    });
  });


//  describe('fetchTilemap', () => {
//    // Save the original fetch function
//    const originalFetch = global.fetch;
//    afterEach(() => {
//      // Restore the original fetch function after each test
//      global.fetch = originalFetch;
//    });
//    it('fetches a tilemap and updates the zoom extent', async () => {
//      const source = new Rapid.ImagerySourceEsri(context, {
//        id: 'anyid',
//        template: 'http://example.com/tile/{z}/{x}/{y}?blankTile=false'
//      });
//      // Mock the fetch function to return a tilemap with all tiles present
//      global.fetch = () => Promise.resolve({
//        ...mockResponse,
//        json: () => Promise.resolve({ data: Array(64).fill(1) })  // An 8x8 grid with all tiles present
//      });
//      await source.fetchTilemap([0, 0]);
//      // Check that the zoom extent was updated to 22
//      assert.equal(source.zoomExtent[1], 22);
//    });
//  });



  describe('nudge', () => {
    it('updates the offset property', () => {
      const source = new Rapid.ImagerySource(context, { id: 'anyid' });
      assert.deepEqual(source.offset, [0, 0]);  // Check initial offset
      source.nudge([10, 20], 0);
      assert.deepEqual(source.offset, [10, 20]);  // Check offset after nudging
      source.nudge([-5, -10], 0);
      assert.deepEqual(source.offset, [5, 10]);  // Check offset after nudging again
    });
  });

  describe('getMetadata', () => {
    it('updates the vintage property of the metadata', () => {
      const source = new Rapid.ImagerySource(context, {
        id: 'anyid',
        startDate: '2020-01-01',
        endDate: '2020-12-31'
      });

      // Tile parameter is unused for the default imagery source.
      // It is only needed for sources where we need to fetch the metadata from a service.
      source.getMetadata(null, (err, result) => {
        assert.isNotOk(err);
        assert.deepEqual(result.vintage, {
          start: '2020-01-01',
          end: '2020-12-31',
          range: '2020-01-01 - 2020-12-31'
        });
      });
    });
  });


//  describe('fetchTilemap', () => {
//    // Save the original fetch function
//    const originalFetch = global.fetch;
//    afterEach(() => {
//      // Restore the original fetch function after each test
//      global.fetch = originalFetch;
//    });
//
//    // it('updates the zoom extent when some tiles are missing', async () => {
//    //   const source = new Rapid.ImagerySourceEsri(context, {
//    //     id: 'anyid',
//    //     template: 'http://example.com/tile/{z}/{x}/{y}?blankTile=false'
//    //   });
//
//    //   // Mock the fetch function to return a tilemap with some tiles missing
//    //   global.fetch = () => Promise.resolve({
//    //     ...mockResponse,
//    //     json: () => Promise.resolve({ data: Array(63).fill(1).concat(0) })  // An 8x8 grid with one tile missing
//    //   });
//
//    //   await source.fetchTilemap([0, 0]);
//
//    //   // Check that the zoom extent was updated to 19
//    //   assert.equal(source.zoomExtent[1], 19);
//    // });
//
//    it('does not update the zoom extent when the fetch request fails', async () => {
//      const source = new Rapid.ImagerySourceEsri(context, {
//        id: 'anyid',
//        template: 'http://example.com/tile/{z}/{x}/{y}?blankTile=false'
//      });
//      // Mock the fetch function to reject the promise
//      global.fetch = () => Promise.reject(new Error('Network error'));
//      await source.fetchTilemap([0, 0]);
//      // Check that the zoom extent was not updated
//      assert.equal(source.zoomExtent[1], 22);
//    });
//  });
});


describe('ImagerySourceCustom', () => {
  const context = new Rapid.MockContext();

  describe('imageryUsed', () => {
    it('returns an imagery_used string', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com )');  // note ' )' space
    });

    it('sanitizes `access_token`', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com?access_token=MYTOKEN');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com?access_token={apikey} )');
    });

    it('sanitizes `connectId`', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com?connectId=MYTOKEN');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com?connectId={apikey} )');
    });

    it('sanitizes `token`', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com?token=MYTOKEN');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com?token={apikey} )');
    });

    it('sanitizes `key`', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com?key=MYTOKEN');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com?key={apikey} )');
    });

    it('sanitizes `Signature` for CloudFront', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'https://example.com/?Key-Pair-Id=foo&Policy=bar&Signature=MYTOKEN');
      assert.strictEqual(source.imageryUsed, 'Custom (https://example.com/?Key-Pair-Id=foo&Policy=bar&Signature={apikey} )');
    });

    it('sanitizes wms path `token`', () => {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com/wms/v1/token/MYTOKEN/1.0.0/layer');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com/wms/v1/token/{apikey}/1.0.0/layer )');
    });

    it('sanitizes `key` in the URL path', function() {
      const source = new Rapid.ImagerySourceCustom(context, 'http://example.com/services;key=MYTOKEN/layer');
      assert.strictEqual(source.imageryUsed, 'Custom (http://example.com/services;key={apikey}/layer )');
    });
  });
});
