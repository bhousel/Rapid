import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';

describe('actionNoop', () => {
  const context = new Rapid.MockContext();

  it('does nothing', () => {
    const graph = new Rapid.Graph(context);
    const result = Rapid.actionNoop()(graph);
    assert.instanceOf(result, Rapid.Graph);
    assert.strictEqual(graph, result);
  });
});
