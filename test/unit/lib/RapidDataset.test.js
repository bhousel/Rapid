import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('RapidDataset', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    network: new Rapid.NetworkSystem(context),
    rapid:   new Rapid.RapidSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };


  it('constructs a RapidDataset object with minimal props', () => {
    const props = {
      id: 'test-dataset'
    };

    const result = new Rapid.RapidDataset(context, props);

    assert.equal(result.id, 'test-dataset');
    assert.equal(result.serviceID, '');
    assert.isFalse(result.conflated);
  });

  it('constructs a RapidDataset with full props', () => {
    const props = {
      id: 'full-dataset',
      serviceID: 'esri',
      conflated: true,
      color: '#ff0000',
      dataUsed: ['imagery'],
      label: 'Test Dataset',
      description: 'A test dataset',
      categories: new Set(['buildings'])
    };

    const result = new Rapid.RapidDataset(context, props);

    assert.equal(result.id, 'full-dataset');
    assert.equal(result.serviceID, 'esri');
    assert.isTrue(result.conflated);
    assert.equal(result.color, '#ff0000');
    assert.deepEqual(result.dataUsed, ['imagery']);
    assert.equal(result.label, 'Test Dataset');
    assert.equal(result.description, 'A test dataset');
    assert.isTrue(result.categories.has('buildings'));
  });

  it('uses provided thumbnailUrl', () => {
    const props = {
      id: 'thumbnail-test',
      thumbnailUrl: 'https://example.com/thumb.png'
    };

    const result = new Rapid.RapidDataset(context, props);
    assert.equal(result.thumbnailUrl, 'https://example.com/thumb.png');
  });

  it('returns label from getLabel', () => {
    const props = {
      id: 'label-test',
      label: 'My Label'
    };

    const result = new Rapid.RapidDataset(context, props);
    assert.equal(result.getLabel(), 'My Label');
  });

  it('returns description from getDescription', () => {
    const props = {
      id: 'desc-test',
      description: 'My Description'
    };

    const result = new Rapid.RapidDataset(context, props);
    assert.equal(result.getDescription(), 'My Description');
  });

  describe('toJSON', () => {
    it('writes real JSON types, and leaves out runtime state', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'bool-test', conflated: true, custom: true, filtered: true });
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'a', target: 'a', isID: true }] });
      const json = ds.toJSON();

      assert.strictEqual(json.conflated, true);
      assert.strictEqual(json.hidden, false);
      assert.notProperty(json, 'custom');
      assert.notProperty(json, 'filtered');
      assert.deepEqual(json.dictionary, { transforms: [{ order: 0, function: 'copy', source: 'a', target: 'a', isID: true }] });
    });

    it('includes a copy of the conflation settings', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'conflation-test' });
      ds.conflation.showMatched = true;
      ds.conflation.rules[0].sameDist = 5;
      const json = ds.toJSON();

      assert.isTrue(json.conflation.showMatched);
      assert.strictEqual(json.conflation.rules[0].sameDist, 5);
      json.conflation.rules[0].sameDist = 99;
      assert.strictEqual(ds.conflation.rules[0].sameDist, 5);   // a copy
    });
  });

  describe('fromJSON', () => {
    it('round-trips a dataset through toJSON/fromJSON preserving types', () => {
      const original = new Rapid.RapidDataset(context, {
        id: 'roundtrip-test',
        color: '#ff0000',
        conflated: true,
        featured: false
      });
      original.conflation.showMatched = true;

      const restored = Rapid.RapidDataset.fromJSON(context, original.toJSON());

      assert.equal(restored.id, 'roundtrip-test');
      assert.equal(restored.color, '#ff0000');
      assert.isTrue(restored.conflated);
      assert.isFalse(restored.featured);
      assert.deepEqual(restored.conflation, original.conflation);
    });

    it('accepts real JSON types, as in asset files', () => {
      const json = {
        id: 'asset-test',
        conflated: true,
        hidden: false,
        dictionary: {
          transforms: [
            { order: 1, function: 'copy', source: 'highway', target: 'highway' },
            { order: 0, function: 'ignore', source: 'OBJECTID', isID: true }
          ]
        }
      };
      const ds = Rapid.RapidDataset.fromJSON(context, json);

      assert.isTrue(ds.conflated);
      assert.isFalse(ds.hidden);
      assert.deepEqual(ds.dictionary.transforms, [
        { order: 1, function: 'copy', source: 'highway', target: 'highway' },
        { order: 0, function: 'ignore', source: 'OBJECTID', isID: true }
      ]);
    });

    it('does not modify the object it is given', () => {
      const json = { id: 'keep-test', dictionary: { transforms: [{ order: 0, function: 'copy', source: 'a', target: 'a' }] } };
      Rapid.RapidDataset.fromJSON(context, json);
      assert.property(json, 'dictionary');
    });
  });

  describe('feature ids', () => {
    // A line feature with the given properties, `x` meters east of an arbitrary origin.
    function line(x, properties) {
      const lon = 10 + x * 0.00001;
      return { type: 'Feature', properties: properties, geometry: { type: 'LineString', coordinates: [[lon, 40], [lon, 40.001]] } };
    }

    // Loads features into the dataset, the way it loads a data file, and returns the loaded data.
    function load(ds, features) {
      const spatial = context.systems.spatial;
      spatial.clearCache(ds.spatialID);
      ds._gotData({ type: 'FeatureCollection', features: features }, '.geojson');
      const all = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
      return spatial.getItemsAtBox(ds.spatialID, all).map(item => item.contents);
    }

    // The data ID of the loaded data with the given `name` property.
    function idOf(data, name) {
      return data.find(d => d.properties.name === name)?.dataID;
    }

    it('idField is the source of the data mapping\'s `isID` transform, if any', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'idfield' });
      assert.isUndefined(ds.idField);
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: '*', target: '*' }] });
      assert.isUndefined(ds.idField);
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'GID', target: 'ref', isID: true }] });
      assert.strictEqual(ds.idField, 'GID');
    });

    it('uses the `isID` field\'s value, so ids survive changes to the data', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'keyed' });
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'GID', target: 'ref', isID: true }] });
      const data = load(ds, [line(0, { name: 'a', GID: 7 }), line(10, { name: 'b', GID: 'x-8' })]);
      assert.strictEqual(idOf(data, 'a'), 'keyed:7');
      assert.strictEqual(idOf(data, 'b'), 'keyed:x-8');
    });

    it('replaces `:` and `,` in the `isID` field\'s value', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'punct' });
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'GID', target: 'ref', isID: true }] });
      const data = load(ds, [line(0, { name: 'a', GID: 'x:1,2' })]);
      assert.strictEqual(idOf(data, 'a'), 'punct:x_1_2');
    });

    it('the data can be found by its data ID', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'found' });
      const data = load(ds, [line(0, { name: 'a' })]);
      const d = data[0];
      assert.strictEqual(d.props.namespace, 'found');
      assert.strictEqual(context.systems.spatial.getData(d.dataID), d);
    });

    it('without an `isID` field, hashes the feature, so the same data always gets the same ids, in any order', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'hashed' });
      const first = load(ds, [line(0, { name: 'a', width: 2 }), line(10, { name: 'b' })]);
      assert.match(idOf(first, 'a'), /^hashed:[0-9a-z]+$/);
      assert.notStrictEqual(idOf(first, 'a'), idOf(first, 'b'));

      const again = load(ds, [line(10, { name: 'b' }), line(0, { width: 2, name: 'a' })]);
      assert.strictEqual(idOf(again, 'a'), idOf(first, 'a'));
      assert.strictEqual(idOf(again, 'b'), idOf(first, 'b'));
    });

    it('gives each feature its own id when `isID` values repeat, or features are identical', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'dupes' });
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'GID', target: 'ref', isID: true }] });
      const data = load(ds, [
        line(0, { name: 'a', GID: 7 }),
        line(10, { name: 'b', GID: 7 }),    // same GID, different feature
        line(20, { name: 'c' }),            // no GID, so hashed
        line(20, { name: 'c' })             // identical to the one before
      ]);
      const ids = data.map(d => d.dataID);
      assert.lengthOf(ids, 4);
      assert.lengthOf(new Set(ids), 4);
      assert.include(ids, 'dupes:7');
    });

    it('numbers the parts of a multi-part feature, and only those', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'multi' });
      ds.dictionary = Rapid.RapidDataDictionary.fromJSON(context, { transforms: [{ order: 0, function: 'copy', source: 'GID', target: 'ref', isID: true }] });
      const multi = {
        type: 'Feature',
        properties: { GID: 'm1' },
        geometry: { type: 'MultiLineString', coordinates: [[[10, 40], [10, 40.001]], [[10.001, 40], [10.001, 40.001]]] }
      };
      const ids = load(ds, [multi]).map(d => d.dataID).sort();
      assert.deepEqual(ids, ['multi:m1:0', 'multi:m1:1']);
    });
  });


  describe('setupCustomDatasetAsync', () => {
    it('rejects for a dataset whose data comes from a service', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'svc', serviceID: 'mapwithai' });
      return ds.setupCustomDatasetAsync()
        .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
        .catch(err => assert.match(err.message, /not a custom source/i));
    });

    it('accepts a dataset without a serviceID, even if the user did not add it', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'asset', assetID: 'my_datasets' });
      return ds.setupCustomDatasetAsync()
        .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
        .catch(err => assert.match(err.message, /no source url or file/i));   // got past the service check
    });
  });
});
