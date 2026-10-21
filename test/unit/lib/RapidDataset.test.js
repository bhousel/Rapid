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
      ds.conflation.enabled = true;
      ds.conflation.rules[0].sameDist = 5;
      const json = ds.toJSON();

      assert.isTrue(json.conflation.enabled);
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
      original.conflation.enabled = true;

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
