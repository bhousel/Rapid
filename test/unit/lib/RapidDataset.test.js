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
});
