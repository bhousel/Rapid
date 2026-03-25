/**
 * Type definitions for the validations module.
 * Validators are factory functions that take a Context and return a ValidatorFunction.
 * @module
 */

import type { Context } from '../Context.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { ValidationIssue } from '../lib/ValidationIssue.ts';

/** A validator result includes an array of detected issues and an optional `provisional` flag */
export type ValidatorResult = ValidationIssue[] & { provisional?: boolean };

/**
 * A validation rule function that checks an entity for issues.
 * Returns an array of ValidationIssue, possibly with a `provisional` flag
 * to indicate that the result is incomplete (e.g. waiting for async data).
 */
export interface ValidatorFunction {
  (entity: OsmEntity, graph: Graph): ValidatorResult;
  type: ValidatorID;
}

/** A validator factory function that creates a ValidatorFunction */
export type ValidatorFactory = (context: Context) => ValidatorFunction;
