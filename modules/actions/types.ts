/**
 * Type definitions for the actions module.
 * Actions are pure functions that take a Graph and return a modified Graph.
 * @module
 */

import type { Graph } from '../lib/Graph.ts';


/**
 * An Action is a function that modifies a Graph.
 * Actions should call `graph.commit()` at the end to finalize changes.
 *
 * Optional properties:
 * - `transitionable`: If true, the action supports eased transitions via the `t` parameter.
 * - `disabled`: Returns a reason string if the action cannot be performed, or `false` if enabled.
 */
export interface Action {
  (graph: Graph, t?: number): Graph;
  transitionable?: boolean;
  disabled?(graph: Graph): string | false;
}
