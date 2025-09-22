import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../../modules/headless.js';
import * as sample from './OsmJSONParser.sample.js';


describe('OsmJSONParser', () => {
  const parser = new Rapid.OsmJSONParser();

  beforeEach(() => {
    parser.reset();
  });

  describe('constructor', () => {
    it('constructs an OsmJSONParser', () => {
      assert.instanceOf(parser, Rapid.OsmJSONParser);
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

    it('throws if "No JSON"', () => {
      assert.throws(() => parser.parse(123), /no json/i);
    });

    it('throws if "Partial Response", including message', () => {
      assert.throws(() => parser.parse(sample.mapJSONerror1), /partial response:\s+something went wrong loading postgres/i);
    });

    it('throws if "Partial Response" with no message', () => {
      assert.throws(() => parser.parse(sample.mapJSONerror2), /partial response:\s+unknown error/i);
    });

    it('parses empty object', () => {
      const results = parser.parse({});
      assert.deepInclude(results, { osm: {}, data: [] });
    });

    it('parses string content that needs to be converted to a JSON object', () => {
      // The sample data is objects, but we should handle string content that needs to be parsed into a JSON object.
      const str = JSON.stringify(sample.mapJSON);
      const results = parser.parse(str);
      assert.deepEqual(results.osm, sample.metadataResult);
    });

    it('parses metadata', () => {
      const results = parser.parse(sample.mapJSON);
      assert.deepEqual(results.osm, sample.metadataResult);
    });

    it('parses elements and bounds, default to visible=true', () => {
      const results = parser.parse(sample.mapJSON);
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
      const results = parser.parse(sample.mapJSONvisible);
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
      const results = parser.parse(sample.mapJSONdeleted);
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

    it('parses single note', () => {
      const results = parser.parse(sample.noteJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 1);
      assert.deepEqual(data[0], sample.note1Result);
    });

    it('parses multiple notes', () => {
      const results = parser.parse(sample.notesJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.note1Result);
      assert.deepEqual(data[1], sample.note2Result);
    });

    it('parses single user', () => {
      const results = parser.parse(sample.userJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 1);
      assert.deepEqual(data[0], sample.user1Result);
    });

    it('parses multiple users', () => {
      const results = parser.parse(sample.usersJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.user1Result);
      assert.deepEqual(data[1], sample.user2Result);
    });

    it('parses preferences', () => {
      const results = parser.parse(sample.preferencesJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 1);
      assert.deepEqual(data[0], sample.preferencesResult);
    });

    it('parses single changeset', () => {
      const results = parser.parse(sample.changesetJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 1);
      assert.deepEqual(data[0], sample.c1Result);
    });

    it('parses multiple changesets', () => {
      const results = parser.parse(sample.changesetsJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 3);
      assert.deepEqual(data[0], sample.c1Result);
      assert.deepEqual(data[1], sample.c2Result);
      assert.deepEqual(data[2], sample.c3Result);
    });

    it('parses api and policy', () => {
      const results = parser.parse(sample.capabilitiesJSON);
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 2);
      assert.deepEqual(data[0], sample.apiResult);
      assert.deepEqual(data[1], sample.policyResult);
    });

    it('skips already-seen elements by default', () => {
      const results1 = parser.parse(sample.mapJSON);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 7);   // bounds + elements

      const results2 = parser.parse(sample.mapJSON);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 1);
      assert.deepEqual(data2[0], sample.boundsResult);  // only bounds
    });

    it('optionally returns already-seen elements', () => {
      const results1 = parser.parse(sample.mapJSON, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 7);   // bounds + elements

      const results2 = parser.parse(sample.mapJSON, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 7);   // bounds + elements
    });

    it('skips already-seen users by default', () => {
      const results1 = parser.parse(sample.usersJSON);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 2);

      const results2 = parser.parse(sample.usersJSON);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 0);
    });

    it('optionally returns already-seen users', () => {
      const results1 = parser.parse(sample.usersJSON, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 2);

      const results2 = parser.parse(sample.usersJSON, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 2);
    });

    it('skips already-seen changesets by default', () => {
      const results1 = parser.parse(sample.changesetsJSON);
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 3);

      const results2 = parser.parse(sample.changesetsJSON);
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 0);
    });

    it('optionally returns already-seen changesets', () => {
      const results1 = parser.parse(sample.changesetsJSON, { skipSeen: false });
      const data1 = results1.data;
      assert.isArray(data1);
      assert.lengthOf(data1, 3);

      const results2 = parser.parse(sample.changesetsJSON, { skipSeen: false });
      const data2 = results2.data;
      assert.isArray(data2);
      assert.lengthOf(data2, 3);
    });

    it('optionally skips non-elements', () => {
      const results = parser.parse(sample.mapJSON, { onlyElements: true });
      const data = results.data;
      assert.isArray(data);
      assert.lengthOf(data, 6);   // no bounds
      assert.deepEqual(data[0], sample.n1Result);
    });
  });

});
