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

  describe('parseAsync', () => {
    it('rejects with "No Content" when no content', () => {
      const prom = parser.parseAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /no content/i));
    });
  });

  describe('elements', () => {
  });

  describe('notes', () => {
  });

  describe('users', () => {
  });

  describe('preferences', () => {
  });

  describe('changesets', () => {
  });

  describe('API capabilities', () => {
  });

});
