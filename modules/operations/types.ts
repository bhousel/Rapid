/**
 * Type definitions for the operations module.
 * @module
 */

import type { Context } from '../Context.ts';
import type { AbstractOperation } from './AbstractOperation.ts';


/** An Operation class constructor */
export type OperationConstructor = new (context: Context, selectedIDs: EntityID[]) => AbstractOperation;
