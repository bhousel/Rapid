import { geomGetSmallestSurroundingRectangle, vecInterp, vecLength } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/** Interface for reflect action with useLongAxis setter/getter */
export interface ReflectAction extends Action {
  useLongAxis(): boolean;
  useLongAxis(val: boolean): ReflectAction;
}


/**
 * actionReflect
 * Reflects the given area around its axis of symmetry.
 *
 * @param   reflectIDs  - Array of EntityIDs to reflect
 * @param   viewport    - The Viewport for coordinate conversion
 * @return  A ReflectAction that reflects the entities in the graph
 */
export function actionReflect(reflectIDs: EntityID[], viewport: Viewport): ReflectAction {
  let _useLongAxis = true;


  const action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    const nodes = utilGetAllNodes(reflectIDs, graph) as OsmNode[];
    const points = nodes.map(n => viewport.project(n.loc!));
    const ssr = geomGetSmallestSurroundingRectangle(points);
    if (!ssr) return graph;

    // Choose line pq = axis of symmetry.
    // The shape's surrounding rectangle has 2 axes of symmetry.
    // Reflect across the longer axis by default.
    const p1: Vec2 = [(ssr.poly[0][0] + ssr.poly[1][0]) / 2, (ssr.poly[0][1] + ssr.poly[1][1]) / 2 ];
    const q1: Vec2 = [(ssr.poly[2][0] + ssr.poly[3][0]) / 2, (ssr.poly[2][1] + ssr.poly[3][1]) / 2 ];
    const p2: Vec2 = [(ssr.poly[3][0] + ssr.poly[4][0]) / 2, (ssr.poly[3][1] + ssr.poly[4][1]) / 2 ];
    const q2: Vec2 = [(ssr.poly[1][0] + ssr.poly[2][0]) / 2, (ssr.poly[1][1] + ssr.poly[2][1]) / 2 ];
    let p: Vec2;
    let q: Vec2;

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
      const c = viewport.project(node.loc!);
      const c2: Vec2 = [
        a * (c[0] - p[0]) + b * (c[1] - p[1]) + p[0],
        b * (c[0] - p[0]) - a * (c[1] - p[1]) + p[1]
      ];
      const loc2 = viewport.unproject(c2);
      node = node.move(vecInterp(node.loc!, loc2, t));
      graph.replace(node);
    }

    return graph.commit();
  }) as ReflectAction;


  action.useLongAxis = function(val?: boolean): any {
    if (!arguments.length) return _useLongAxis;
    _useLongAxis = val!;
    return action;
  };

  action.transitionable = true;

  return action;
}
