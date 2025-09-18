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

  describe('errors', () => {
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
  });

  describe('metadata', () => {
    it('parses metadata', () => {
      const prom = parser.parseAsync(sample.mapXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          assert.deepInclude(results.osm, {
            version: '0.6',
            generator: 'openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)',
            copyright: 'OpenStreetMap and contributors',
            attribution: 'http://www.openstreetmap.org/copyright',
            license: 'http://opendatacommons.org/licenses/odbl/1-0/',
          });
        });
    });
  });

  describe('elements and bounds', () => {
    it('parses elements and bounds', () => {
      const prom = parser.parseAsync(sample.mapXML);
      assert.instanceOf(prom, Promise);
      return prom
        .then(results => {
          const data = results.data;
          assert.isArray(data);
          assert.lengthOf(data, 5);

          assert.deepEqual(data[0], {
            type: 'bounds',
            minlat: 40.6550000,
            minlon: -74.5420000,
            maxlat: 40.6560000,
            maxlon: -74.5410000
          });

          assert.deepInclude(data[1], {
            type: 'node',
            id: 'n1',
            visible: true,
            loc: [-74.5415, 40.6555],
            timestamp: '2025-09-01T00:00:01Z',
            version: '2',
            changeset: '1',
            user: 'bhousel',
            uid: '100',
            tags: {
              crossing: 'marked',
              'crossing:markings': 'zebra',
              highway: 'crossing'
            }
          });

          assert.deepInclude(data[2], {
            type: 'node',
            id: 'n2',
            visible: true,
            loc: [-74.5416, 40.6556],
            timestamp: '2025-09-01T00:00:01Z',
            version: '2',
            changeset: '1',
            user: 'bhousel',
            uid: '100'
          });

          assert.deepInclude(data[3], {
            type: 'way',
            id: 'w1',
            visible: true,
            timestamp: '2025-09-01T00:00:01Z',
            version: '2',
            changeset: '1',
            user: 'bhousel',
            uid: '100',
            nodes: ['n1', 'n2'],
            tags: {
              highway: 'tertiary',
              lanes: '1',
              name: 'Spring Valley Boulevard',
              oneway: 'yes'
            }
          });

          assert.deepInclude(data[4], {
            type: 'relation',
            id: 'r1',
            visible: true,
            timestamp: '2025-09-01T00:00:01Z',
            version: '2',
            changeset: '1',
            user: 'bhousel',
            uid: '100',
            members: [
              { type: 'way', id: 'w1', role: 'south' }
            ],
            tags: {
              network: 'US:NJ:Somerset',
              ref: '651',
              route: 'road',
              type: 'route'
            }
          });
        });
    });
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
