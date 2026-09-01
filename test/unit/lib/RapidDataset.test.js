import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('RapidDataset', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    assets:  new Rapid.AssetSystem(context),
    network: new Rapid.NetworkSystem(context),
    rapid:   new Rapid.RapidSystem(context)
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
    it('serializes boolean flags as strings', () => {
      const ds = new Rapid.RapidDataset(context, { id: 'bool-test', conflated: true, custom: false });
      const json = ds.toJSON();

      assert.strictEqual(json.conflated, 'true');
      assert.strictEqual(json.custom, 'false');
    });
  });

  describe('fromJSON', () => {
    it('coerces stringified boolean flags back to booleans', () => {
      // Simulates values arriving from the string-only settings store after a reload.
      const json = { id: 'reload-test', conflated: 'true', custom: 'false', beta: 'true' };
      const ds = Rapid.RapidDataset.fromJSON(context, json);

      assert.isTrue(ds.conflated);
      assert.isFalse(ds.custom);
      assert.isTrue(ds.beta);
    });

    it('round-trips a dataset through toJSON/fromJSON preserving boolean types', () => {
      const original = new Rapid.RapidDataset(context, {
        id: 'roundtrip-test',
        color: '#ff0000',
        conflated: true,
        custom: true,
        featured: false
      });

      const restored = Rapid.RapidDataset.fromJSON(context, original.toJSON());

      assert.equal(restored.id, 'roundtrip-test');
      assert.equal(restored.color, '#ff0000');
      assert.isTrue(restored.conflated);
      assert.isTrue(restored.custom);
      assert.isFalse(restored.featured);
    });
  });
});
