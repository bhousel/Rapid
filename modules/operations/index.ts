/**
 * Operations module barrel file.
 * Exports all operation classes and the operations registry.
 * @module operations
 */
import { AbstractOperation } from './AbstractOperation.ts';
import { CircularizeOperation } from './CircularizeOperation.ts';
import { ContinueOperation } from './ContinueOperation.ts';
import { CopyOperation } from './CopyOperation.ts';
import { CycleHighwayTagOperation } from './CycleHighwayTagOperation.ts';
import { DeleteOperation } from './DeleteOperation.ts';
import { DisconnectOperation } from './DisconnectOperation.ts';
import { DowngradeOperation } from './DowngradeOperation.ts';
import { ExtractOperation } from './ExtractOperation.ts';
import { MergeOperation } from './MergeOperation.ts';
import { MoveOperation } from './MoveOperation.ts';
import { OrthogonalizeOperation } from './OrthogonalizeOperation.ts';
import { PasteOperation } from './PasteOperation.ts';
import { ReflectOperation, ReflectLongOperation, ReflectShortOperation } from './ReflectOperation.ts';
import { ReverseOperation } from './ReverseOperation.ts';
import { RotateOperation } from './RotateOperation.ts';
import { SplitOperation } from './SplitOperation.ts';
import { StraightenOperation } from './StraightenOperation.ts';

export {
  AbstractOperation,
  CircularizeOperation,
  ContinueOperation,
  CopyOperation,
  CycleHighwayTagOperation,
  DeleteOperation,
  DisconnectOperation,
  DowngradeOperation,
  ExtractOperation,
  MergeOperation,
  MoveOperation,
  OrthogonalizeOperation,
  PasteOperation,
  ReflectOperation,
  ReflectLongOperation,
  ReflectShortOperation,
  ReverseOperation,
  RotateOperation,
  SplitOperation,
  StraightenOperation
};

// Re-export types from types.ts for convenience
import type { OperationConstructor } from './types.ts';
export type { OperationConstructor } from './types.ts';

/**
 * Registry interface for available operations.
 * Contains a Map of operation IDs to their constructor functions.
 * A mode constructs the operations here (against its selection) to build its edit menu.
 */
interface OperationRegistry {
  /** Map of operation IDs to their constructors */
  available: Map<OperationID, OperationConstructor>;
}

/**
 * Registry of available operations.
 * The insertion order here is the default order operations appear on the edit menu.
 */
export const operations: OperationRegistry = {
  available: new Map<OperationID, OperationConstructor>()
};

operations.available.set('circularize', CircularizeOperation);
operations.available.set('continue', ContinueOperation);
operations.available.set('cycle_highway_tag', CycleHighwayTagOperation);
operations.available.set('copy', CopyOperation);
operations.available.set('delete', DeleteOperation);
operations.available.set('disconnect', DisconnectOperation);
operations.available.set('downgrade', DowngradeOperation);
operations.available.set('extract', ExtractOperation);
operations.available.set('merge', MergeOperation);
operations.available.set('move', MoveOperation);
operations.available.set('orthogonalize', OrthogonalizeOperation);
operations.available.set('paste', PasteOperation);
operations.available.set('reflect-short', ReflectShortOperation);
operations.available.set('reflect-long', ReflectLongOperation);
operations.available.set('reverse', ReverseOperation);
operations.available.set('rotate', RotateOperation);
operations.available.set('split', SplitOperation);
operations.available.set('straighten', StraightenOperation);

