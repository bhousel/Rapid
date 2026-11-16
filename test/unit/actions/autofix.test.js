import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionAutofix', () => {
  const context = new Rapid.MockContext();

  // A validator that finds one issue per `fixme:*` tag on a node, as the node is in the graph it's given.
  // Each fix removes its tag, and the fix for `fixme:b` also removes `fixme:c` (it changes what the others are about).
  // Fixes for `fixme:stuck` don't remove it.
  function validateFixme() {
    const validator = (entity, graph) => {
      const issues = Object.keys(entity.tags)
        .filter(k => k.startsWith('fixme:'))
        .map(k => new Rapid.ValidationIssue(context, {
          type: 'fixme',
          subtype: k,
          entityIds: [entity.id],
          autoArgs: [removeTags(entity.id, k === 'fixme:b' ? [k, 'fixme:c'] : [k]), {}]
        }));
      validator.calls.push(Object.keys(entity.tags).sort().join(' '));
      return { issues: issues };
    };
    validator.type = 'fixme';
    validator.calls = [];
    return validator;
  }

  function removeTags(nodeID, keys) {
    return graph => {
      const node = graph.entity(nodeID);
      const tags = { ...node.tags };
      for (const k of keys) {
        if (k !== 'fixme:stuck') delete tags[k];
      }
      return graph.replace(node.update({ tags: tags }));
    };
  }

  function makeGraph(tags) {
    const base = new Rapid.Graph(context, [new Rapid.OsmNode(context, { id: 'n1', loc: [0, 0], tags: tags })]);
    return new Rapid.Graph(base);
  }


  it('applies one fix at a time, validating again after each', () => {
    const validator = validateFixme();
    const graph = makeGraph({ 'fixme:a': 'x', 'fixme:b': 'x', 'fixme:c': 'x', amenity: 'bench' });

    const result = Rapid.actionAutofix([{ entityID: 'n1', validator: validator }])(graph);
    assert.deepEqual(result.entity('n1').tags, { amenity: 'bench' });

    // Fixing `fixme:b` also fixed `fixme:c`, so its stale fix never ran
    assert.deepEqual(validator.calls, [
      'amenity fixme:a fixme:b fixme:c',
      'amenity fixme:b fixme:c',
      'amenity'
    ]);
  });

  it('tries each fix only once, even if it doesn\'t make its issue go away', () => {
    const validator = validateFixme();
    const graph = makeGraph({ 'fixme:stuck': 'x', 'fixme:a': 'x' });

    const result = Rapid.actionAutofix([{ entityID: 'n1', validator: validator }])(graph);
    assert.deepEqual(result.entity('n1').tags, { 'fixme:stuck': 'x' });
    assert.lengthOf(validator.calls, 3);
  });

  it('fixes only the issues that `canFix` allows', () => {
    const validator = validateFixme();
    const graph = makeGraph({ 'fixme:a': 'x', 'fixme:d': 'x' });
    const canFix = issue => issue.subtype === 'fixme:d';

    const result = Rapid.actionAutofix([{ entityID: 'n1', validator: validator }], canFix)(graph);
    assert.deepEqual(result.entity('n1').tags, { 'fixme:a': 'x' });
  });

  it('skips a target that an earlier fix removed', () => {
    const validator = validateFixme();
    const graph = makeGraph({ 'fixme:a': 'x' });
    const remove = graph => graph.remove(graph.entity('n1'));
    const removing = () => ({ issues: [new Rapid.ValidationIssue(context, { type: 'remove', entityIds: ['n1'], autoArgs: [remove, {}] })] });
    removing.type = 'remove';

    const result = Rapid.actionAutofix([
      { entityID: 'n1', validator: removing },
      { entityID: 'n1', validator: validator }
    ])(graph);
    assert.isUndefined(result.hasEntity('n1'));
    assert.lengthOf(validator.calls, 0);
  });
});
