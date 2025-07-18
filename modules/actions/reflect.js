import { geomGetSmallestSurroundingRectangle, vecInterp, vecLength } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';


/* Reflect the given area around its axis of symmetry */
export function actionReflect(reflectIDs, viewport) {
  let _useLongAxis = true;


  const action = (graph, t) => {
    if (t === null || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    const nodes = utilGetAllNodes(reflectIDs, graph);
    const points = nodes.map(n => viewport.project(n.loc));
    const ssr = geomGetSmallestSurroundingRectangle(points);

    // Choose line pq = axis of symmetry.
    // The shape's surrounding rectangle has 2 axes of symmetry.
    // Reflect across the longer axis by default.
    const p1 = [(ssr.poly[0][0] + ssr.poly[1][0]) / 2, (ssr.poly[0][1] + ssr.poly[1][1]) / 2 ];
    const q1 = [(ssr.poly[2][0] + ssr.poly[3][0]) / 2, (ssr.poly[2][1] + ssr.poly[3][1]) / 2 ];
    const p2 = [(ssr.poly[3][0] + ssr.poly[4][0]) / 2, (ssr.poly[3][1] + ssr.poly[4][1]) / 2 ];
    const q2 = [(ssr.poly[1][0] + ssr.poly[2][0]) / 2, (ssr.poly[1][1] + ssr.poly[2][1]) / 2 ];
    let p, q;

    const isLong = (vecLength(p1, q1) > vecLength(p2, q2));
    if ((_useLongAxis && isLong) || (!_useLongAxis && !isLong)) {
      p = p1;
      q = q1;
    } else {
      p = p2;
      q = q2;
    }

    // reflect c across pq
    // http://math.stackexchange.com/questions/65503/point-reflection-over-a-line
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const a = (dx * dx - dy * dy) / (dx * dx + dy * dy);
    const b = 2 * dx * dy / (dx * dx + dy * dy);

    for (let node of nodes) {
      const c = viewport.project(node.loc);
      const c2 = [
        a * (c[0] - p[0]) + b * (c[1] - p[1]) + p[0],
        b * (c[0] - p[0]) - a * (c[1] - p[1]) + p[1]
      ];
      const loc2 = viewport.unproject(c2);
      node = node.move(vecInterp(node.loc, loc2, t));
      graph.replace(node);
    }

    return graph.commit();
  };


  action.useLongAxis = function(val) {
    if (!arguments.length) return _useLongAxis;
    _useLongAxis = val;
    return action;
  };


  action.transitionable = true;


  return action;
}
