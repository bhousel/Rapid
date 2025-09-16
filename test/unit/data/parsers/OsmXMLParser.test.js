import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../../modules/headless.js';
import * as sample from './OsmXMLParser.sample.js';


describe('OsmXMLParser', () => {
  const parser = new Rapid.OsmXMLParser();

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
