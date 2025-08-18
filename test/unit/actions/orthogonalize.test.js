import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('actionOrthogonalize', () => {
  const context = new Rapid.MockContext();

  const viewport = {
    project: val => val,
    unproject: val => val
  };

  describe('closed paths', () => {
    it('orthogonalizes a perfect quad', () => {
      //    d --- c
      //    |     |
      //    a --- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);
      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.lengthOf(result.entity('-').nodes, 5);
    });

    it('orthogonalizes a quad', () => {
      //    d --- c
      //    |     |
      //    a ---  b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.lengthOf(result.entity('-').nodes, 5);
    });

    it('orthogonalizes a triangle', () => {
      //    a
      //    | \
      //    |   \
      //     b - c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.lengthOf(result.entity('-').nodes, 4);
    });

    it('deletes empty redundant nodes', () => {
      //    e - d - c
      //    |       |
      //    a ----- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.isUndefined(result.hasEntity('d'));
    });

    it('preserves non empty redundant nodes', () => {
      //    e - d - c
      //    |       |
      //    a ----- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.lengthOf(result.entity('-').nodes, 6);
      assert.isOk(result.hasEntity('d'));
    });

    it('only moves nodes which are near right or near straight', () => {
      //    f - e
      //    |    \
      //    |     d - c
      //    |         |
      //    a -------- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [3.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [2, 1] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [1, 2] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['a', 'b', 'c', 'f']);  // not d, e
    });

    it('does not move or remove self-intersecting nodes', () => {
      //   f -- g
      //   |    |
      //   e --- d - c
      //        |    |
      //        a -- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, -1] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, -1] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [-1, 1] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0, 1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.doesNotHaveAnyKeys(diff.changes, ['d']);  // d not changed
      assert.isOk(graph.hasEntity('d'));               // d not removed
    });

    it('preserves the shape of skinny quads', () => {
      const viewport = new Rapid.sdk.Viewport();
      const tests = [
        [
          [-77.0339864831478, 38.8616391227204],
          [-77.0209775298677, 38.8613609264884],
          [-77.0210405781065, 38.8607390721519],
          [-77.0339024188294, 38.8610663645859]
        ],
        [
          [-89.4706683, 40.6261177],
          [-89.4706664, 40.6260574],
          [-89.4693973, 40.6260830],
          [-89.4694012, 40.6261355]
        ]
      ];

      for (var i = 0; i < tests.length; i++) {
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: tests[i][0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: tests[i][1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: tests[i][2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: tests[i][3] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
        ]);
        const graph = new Rapid.Graph(base);
        const initialWidth = Rapid.sdk.geoSphericalDistance(graph.entity('a').loc, graph.entity('b').loc);
        const result = Rapid.actionOrthogonalize('-', viewport)(graph);
        assert.instanceOf(result, Rapid.Graph);
        const finalWidth = Rapid.sdk.geoSphericalDistance(result.entity('a').loc, result.entity('b').loc);
        assert.isOk(finalWidth / initialWidth >= 0.90 && finalWidth / initialWidth <= 1.10);
      }
    });
  });


  describe('open paths', () => {
    it('orthogonalizes a perfect quad path', () => {
      //    d --- c
      //          |
      //    a --- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes.length, 4);
    });

    it('orthogonalizes a quad path', () => {
      //    d --- c
      //          |
      //    a ---  b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes.length, 4);
    });

    it('orthogonalizes a 3-point path', () => {
      //    a
      //    |
      //    |
      //     b - c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes.length, 3);
    });

    it('deletes empty redundant nodes', () => {
      //    e - d - c
      //            |
      //    a ----- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.strictEqual(result.hasEntity('d'), undefined);
    });

    it('preserves non empty redundant nodes', () => {
      //    e - d - c
      //            |
      //    a ----- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [1, 2], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes.length, 5);
      assert.isOk(result.hasEntity('d'));
    });

    it('only moves non-endpoint nodes which are near right or near straight', () => {
      //    f - e
      //         \
      //          d - c
      //              |
      //    a -------- b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [3.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [2, 1] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [1, 2] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['b', 'c']);
    });

    it('does not move or remove self-intersecting nodes', () => {
      //   f -- g
      //   |    |
      //   e --- d - c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [-1, 0] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [-1, 1] }),
        new Rapid.OsmNode(context, { id: 'g', loc: [0, 1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['c', 'd', 'e', 'f', 'g', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.doesNotHaveAnyKeys(diff.changes, ['d']);  // d not changed
      assert.isOk(graph.hasEntity('d'));                 // d not removed
    });
  });


  describe('vertices', () => {
    it('orthogonalizes a single vertex in a quad', () => {
      //    d --- c
      //    |     |
      //    a ---  b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport, 'b')(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['b']);  // only b
    });

    it('orthogonalizes a single vertex in a triangle', () => {
      //    a
      //    | \
      //    |   \
      //     b - c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport, 'b')(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['b']);  // only b
    });

    it('orthogonalizes a single vertex in a quad path', () => {
      //    d --- c
      //          |
      //    a ---  b
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport, 'b')(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['b']);  // only b
    });

    it('orthogonalizes a single vertex in a 3-point path', () => {
      //    a
      //    |
      //    |
      //     b - c
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [0.1, 0] }),
        new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport, 'b')(graph);
      assert.instanceOf(result, Rapid.Graph);
      const diff = new Rapid.Difference(base, result);
      assert.hasAllKeys(diff.changes, ['b']);  // only b
    });
  });


  describe('disabled', () => {

    describe('closed paths', () => {
      it('returns "square_enough" for a perfect quad', () => {
        //    d ---- c
        //    |      |
        //    a ---- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.strictEqual(result, 'square_enough');
      });

      it('returns false for unsquared quad', () => {
        //    d --- c
        //    |     |
        //    a ---- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns false for unsquared triangle', () => {
        //    a
        //    | \
        //    |   \
        //     b - c
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [0.1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns false for perfectly square shape with redundant nodes', () => {
        //    e - d - c
        //    |       |
        //    a ----- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns "not_squarish" for shape that can not be squared', () => {
        //      e -- d
        //     /      \
        //    f        c
        //     \      /
        //      a -- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [3, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 4] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [1, 4] }),
          new Rapid.OsmNode(context, { id: 'f', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.strictEqual(result, 'not_squarish');
      });

      it('returns false for non-square self-intersecting shapes', () => {
        //   f -- g
        //   |    |
        //   e --- d - c
        //        |    |
        //        a -- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, -1] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [1, -1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0.1, 0] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [-1, 0] }),
          new Rapid.OsmNode(context, { id: 'f', loc: [-1, 1] }),
          new Rapid.OsmNode(context, { id: 'g', loc: [0, 1] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'd', 'a'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });
    });


    describe('open paths', () => {
      it('returns "square_enough" for a perfect quad', () => {
        //    d ---- c
        //           |
        //    a ---- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.strictEqual(result, 'square_enough');
      });

      it('returns false for unsquared quad', () => {
        //    d --- c
        //          |
        //    a ---  b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns false for unsquared 3-point path', () => {
        //    a
        //    |
        //    |
        //     b - c
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [0, 0.1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns false for perfectly square shape with redundant nodes', () => {
        //    e - d - c
        //            |
        //    a ----- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [1, 2] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });

      it('returns "not_squarish" for path that can not be squared', () => {
        //      e -- d
        //     /      \
        //    f        c
        //            /
        //      a -- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [3, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 4] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [1, 4] }),
          new Rapid.OsmNode(context, { id: 'f', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.strictEqual(result, 'not_squarish');
      });

      it('returns false for non-square self-intersecting paths', () => {
        //   f -- g
        //   |    |
        //   e --- d - c
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'c', loc: [0, 1] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0.1, 0] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [-1, 0] }),
          new Rapid.OsmNode(context, { id: 'f', loc: [-1, 1] }),
          new Rapid.OsmNode(context, { id: 'g', loc: [0, 1] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['c', 'd', 'e', 'f', 'g', 'd'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport).disabled(graph);
        assert.isFalse(result);
      });
    });


    describe('vertex-only', () => {
      it('returns "square_enough" for a vertex in a perfect quad', () => {
        //    d ---- c
        //           |
        //    a ---- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport, 'b').disabled(graph);
        assert.strictEqual(result, 'square_enough');
      });

      it('returns false for a vertex in an unsquared quad', () => {
        //    d --- c
        //          |
        //    a ---  b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [2.1, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [2, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport, 'b').disabled(graph);
        assert.isFalse(result);
      });

      it('returns false for a vertex in an unsquared 3-point path', () => {
        //    a
        //    |
        //    |
        //     b - c
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [0, 3] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [0, 0.1] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [3, 0] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport, 'b').disabled(graph);
        assert.isFalse(result);
      });

      it('returns "not_squarish" for vertex that can not be squared', () => {
        //      e -- d
        //     /      \
        //    f        c
        //            /
        //      a -- b
        const base = new Rapid.Graph(context, [
          new Rapid.OsmNode(context, { id: 'a', loc: [1, 0] }),
          new Rapid.OsmNode(context, { id: 'b', loc: [3, 0] }),
          new Rapid.OsmNode(context, { id: 'c', loc: [4, 2] }),
          new Rapid.OsmNode(context, { id: 'd', loc: [3, 4] }),
          new Rapid.OsmNode(context, { id: 'e', loc: [1, 4] }),
          new Rapid.OsmNode(context, { id: 'f', loc: [0, 2] }),
          new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f'] })
        ]);

        const graph = new Rapid.Graph(base);
        const result = Rapid.actionOrthogonalize('-', viewport, 'b').disabled(graph);
        assert.strictEqual(result, 'not_squarish');
      });
    });
  });


  describe('transitions', () => {
    it('is transitionable', () => {
      assert.isTrue(Rapid.actionOrthogonalize().transitionable);
    });

    //  for all of these:
    //
    //     f ------------ e
    //     |              |
    //     a -- b -- c -- d
    //
    it('orthogonalize at t = 0', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [3, 1] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph, 0);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'e', 'f', 'a']);
      assert.isOk(Math.abs(result.entity('b').loc[0] - 1) < 1e-6);
      assert.isOk(Math.abs(result.entity('b').loc[1] - 0.01) < 1e-6);
      assert.isOk(Math.abs(result.entity('c').loc[0] - 2) < 1e-6);
      assert.isOk(Math.abs(result.entity('c').loc[1] + 0.01) < 1e-6);
    });

    it('orthogonalize at t = 0.5', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [3, 1] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph, 0.5);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'c', 'd', 'e', 'f', 'a']);
      assert.isOk(Math.abs(result.entity('b').loc[0] - 1) < 1e-3);
      assert.isOk(Math.abs(result.entity('b').loc[1] - 0.005) < 1e-3);
      assert.isOk(Math.abs(result.entity('c').loc[0] - 2) < 1e-3);
      assert.isOk(Math.abs(result.entity('c').loc[1] + 0.005) < 1e-3);
    });

    it('orthogonalize at t = 1', () => {
      const base = new Rapid.Graph(context, [
        new Rapid.OsmNode(context, { id: 'a', loc: [0, 0] }),
        new Rapid.OsmNode(context, { id: 'b', loc: [1, 0.01], tags: { foo: 'bar' } }),
        new Rapid.OsmNode(context, { id: 'c', loc: [2, -0.01] }),
        new Rapid.OsmNode(context, { id: 'd', loc: [3, 0] }),
        new Rapid.OsmNode(context, { id: 'e', loc: [3, 1] }),
        new Rapid.OsmNode(context, { id: 'f', loc: [0, 1] }),
        new Rapid.OsmWay(context, { id: '-', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] })
      ]);

      const graph = new Rapid.Graph(base);
      const result = Rapid.actionOrthogonalize('-', viewport)(graph, 1);
      assert.instanceOf(result, Rapid.Graph);
      assert.deepEqual(result.entity('-').nodes, ['a', 'b', 'd', 'e', 'f', 'a']);
      assert.isOk(Math.abs(result.entity('b').loc[0] - 1) < 2e-3);
      assert.isOk(Math.abs(result.entity('b').loc[1]) < 2e-3);
      assert.isUndefined(result.hasEntity('c'));
    });
  });
});
