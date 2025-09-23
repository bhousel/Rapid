import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import { DOMParser } from '@xmldom/xmldom';
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

  describe('parse', () => {
    it('throws if "No Content"', () => {
      assert.throws(() => parser.parse(), /no content/i);
    });

    it('throws if "No XML"', () => {
      assert.throws(() => parser.parse(123), /no xml/i);
    });

    it('throws if "No OSM Element"', () => {
      const content = '<?xml version="1.0" encoding="UTF-8"?><hello/>';
      assert.throws(() => parser.parse(content), /no osm element/i);
    });

    it('throws if "Partial Response", including message', () => {
      assert.throws(() => parser.parse(sample.mapXMLerror1), /partial response:\s+something went wrong loading postgres/i);
    });

    it('throws if "Partial Response" with no message', () => {
      assert.throws(() => parser.parse(sample.mapXMLerror2), /partial response:\s+unknown error/i);
    });

    it('parses empty osm element', () => {
      const results = parser.parse('<?xml version="1.0" encoding="UTF-8"?><osm/>');
      assert.deepInclude(results, { osm: {}, data: [] });
    });

    it('is ok without a processinginstruction', () => {
      const results = parser.parse('<osm/>');
      assert.deepInclude(results, { osm: {}, data: [] });
    });

    it('parses content that is already an XML document', () => {
      // The sample data is strings, but we should handle content already parsed into an xml document
      const doc = new DOMParser().parseFromString(sample.mapXML, 'application/xml');
      const results = parser.parse(doc);
      assert.deepEqual(results.osm, sample.metadataResult);
    });

    it('parses metadata', () => {
      const results = parser.parse(sample.mapXML);
      assert.deepEqual(results.osm, sample.metadataResult);
    });

    it('parses elements and bounds, default to visible=true', () => {
      const results = parser.parse(sample.mapXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 7);

      assert.deepEqual(data[0], sample.boundsResult);
      assert.deepEqual(data[1], sample.n1Result);
      assert.deepEqual(data[2], sample.n2Result);
      assert.deepEqual(data[3], sample.w1Result);
      assert.deepEqual(data[4], sample.w2Result);
      assert.deepEqual(data[5], sample.r1Result);
      assert.deepEqual(data[6], sample.r2Result);
    });

    it('handles visible=true', () => {
      const results = parser.parse(sample.mapXMLvisible);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 7);

      assert.deepEqual(data[0], sample.boundsResult);
      assert.deepEqual(data[1], sample.n1Result);
      assert.deepEqual(data[2], sample.n2Result);
      assert.deepEqual(data[3], sample.w1Result);
      assert.deepEqual(data[4], sample.w2Result);
      assert.deepEqual(data[5], sample.r1Result);
      assert.deepEqual(data[6], sample.r2Result);
    });

    it('handles visible=false (deleted)', () => {
      const results = parser.parse(sample.mapXMLdeleted);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 7);

      assert.deepEqual(data[0], sample.boundsResult);
      assert.deepEqual(data[1], sample.n1ResultDeleted);
      assert.deepEqual(data[2], sample.n2ResultDeleted);
      assert.deepEqual(data[3], sample.w1ResultDeleted);
      assert.deepEqual(data[4], sample.w2ResultDeleted);
      assert.deepEqual(data[5], sample.r1ResultDeleted);
      assert.deepEqual(data[6], sample.r2ResultDeleted);
    });

    it('parses notes', () => {
      const results = parser.parse(sample.notesXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.note1Result);
      assert.deepEqual(data[1], sample.note2Result);
    });

    it('parses users', () => {
      const results = parser.parse(sample.usersXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.user1Result);
      assert.deepEqual(data[1], sample.user2Result);
    });

    it('parses preferences', () => {
      const results = parser.parse(sample.preferencesXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 1);
      assert.deepEqual(data[0], sample.preferencesResult);
    });

    it('parses changesets', () => {
      const results = parser.parse(sample.changesetsXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 3);
      assert.deepEqual(data[0], sample.c1Result);
      assert.deepEqual(data[1], sample.c2Result);
      assert.deepEqual(data[2], sample.c3Result);
    });

    it('parses api and policy', () => {
      const results = parser.parse(sample.capabilitiesXML);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.apiResult);
      assert.deepEqual(data[1], sample.policyResult);
    });

    it('skips already-seen elements by default', () => {
      const results1 = parser.parse(sample.mapXML);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 7);   // bounds + elements

      const results2 = parser.parse(sample.mapXML);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 1);
      assert.deepEqual(data2[0], sample.boundsResult);  // only bounds
    });

    it('optionally returns already-seen elements', () => {
      const results1 = parser.parse(sample.mapXML, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 7);   // bounds + elements

      const results2 = parser.parse(sample.mapXML, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 7);   // bounds + elements
    });

    it('skips already-seen users by default', () => {
      const results1 = parser.parse(sample.usersXML);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 2);

      const results2 = parser.parse(sample.usersXML);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 0);
    });

    it('optionally returns already-seen users', () => {
      const results1 = parser.parse(sample.usersXML, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 2);

      const results2 = parser.parse(sample.usersXML, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 2);
    });

    it('skips already-seen changesets by default', () => {
      const results1 = parser.parse(sample.changesetsXML);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 3);

      const results2 = parser.parse(sample.changesetsXML);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 0);
    });

    it('optionally returns already-seen changesets', () => {
      const results1 = parser.parse(sample.changesetsXML, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 3);

      const results2 = parser.parse(sample.changesetsXML, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 3);
    });

    it('filter option accepts Array', () => {
      const results = parser.parse(sample.mapXML, { filter: ['node', 'way', 'relation'] });
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 6);   // no bounds
      assert.deepEqual(data[0], sample.n1Result);
    });

    it('filter option accepts Set', () => {
      const results = parser.parse(sample.mapXML, { filter: new Set(['way']) });
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.w1Result);
      assert.deepEqual(data[1], sample.w2Result);
    });

  });

});
