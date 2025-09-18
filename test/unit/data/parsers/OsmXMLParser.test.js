import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../../modules/headless.js';
import * as sample from './OsmXMLParser.sample.js';


describe('OsmXMLParser', () => {
  const parser = new Rapid.OsmXMLParser();

  beforeEach(() => {
    parser.reset();
  });

  describe('constructor', () => {
    it('constructs an OsmXMLParser', () => {
      assert.instanceOf(parser, Rapid.OsmXMLParser);
    });
  });

  describe('reset', () => {
    it('resets the seen cache', () => {
      parser._seen.add('user1');
      parser.reset();
      assert.isEmpty(parser._seen);
    });
  });

  describe('parseAsync', () => {
    it('rejects if "No Content"', () => {
      const prom = parser.parseAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /no content/i));
    });

    it('rejects if "No XML"', () => {
      const prom = parser.parseAsync(123);
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /no xml/i));
    });

    it('rejects if "No OSM Element"', () => {
      const prom = parser.parseAsync('<?xml version="1.0" encoding="UTF-8"?><hello/>');
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /no osm element/i));
    });

    it('rejects if "Partial Response"', () => {
      const prom = parser.parseAsync(sample.mapXMLpartial);
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /partial response/i));
    });

    it('parses metadata', () => {
      const prom = parser.parseAsync(sample.mapXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          assert.deepInclude(results.osm, sample.metadataResult);
        });
    });

    it('parses elements and bounds', () => {
      const prom = parser.parseAsync(sample.mapXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 5);

          assert.deepEqual(data[0], sample.boundsResult);
          assert.deepInclude(data[1], sample.n1Result);
          assert.deepInclude(data[2], sample.n2Result);
          assert.deepInclude(data[3], sample.w1Result);
          assert.deepInclude(data[4], sample.r1Result);
        });
    });

    it('parses notes', () => {
      const prom = parser.parseAsync(sample.notesXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 2);
          assert.deepInclude(data[0], sample.note1Result);
          assert.deepInclude(data[1], sample.note2Result);
        });
    });

    it('parses users', () => {
      const prom = parser.parseAsync(sample.usersXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 2);
          assert.deepInclude(data[0], sample.user1Result);
          assert.deepInclude(data[1], sample.user2Result);
        });
    });

    it('parses preferences', () => {
      const prom = parser.parseAsync(sample.preferencesXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 1);
          assert.deepInclude(data[0], sample.preferencesResult);
        });
    });

    it('parses changesets', () => {
      const prom = parser.parseAsync(sample.changesetsXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 3);
          assert.deepInclude(data[0], sample.c1Result);
          assert.deepInclude(data[1], sample.c2Result);
          assert.deepInclude(data[2], sample.c3Result);
        });
    });

    it('parses api and policy', () => {
      const prom = parser.parseAsync(sample.capabilitiesXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 2);
          assert.deepInclude(data[0], sample.apiResult);
          assert.deepInclude(data[1], sample.policyResult);
        });
    });
  });

});
