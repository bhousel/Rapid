import type { TransformProps } from '@rapid-sdk/math';
import type { Graph } from './Graph.ts';


/**
 * Properties that define an `Edit`.
 */
export interface EditProps {
  /** Human-readable description of the edit */
  annotation: string;
  /** The graph state after this edit */
  graph: Graph;
  /** IDs of entities selected when this edit was made */
  selectedIDs: EntityID[];
  /** Sources that contributed to this edit */
  sources: Record<string, unknown>;
  /** Map transform at time of edit */
  transform: TransformProps;
}


/**
 * An `Edit` encapsulates the state of a single edit.
 */
export class Edit {

  /** Human-readable description of what was changed (used for undo/redo menu) */
  public annotation: string | undefined;
  /** The Graph state after this edit was applied */
  public graph: Graph;
  /** IDs of entities that were selected when this edit was committed */
  public selectedIDs: EntityID[] | undefined;
  /** Imagery, photo, and data sources used to make this edit (shown in changeset comment) */
  public sources: Record<string, unknown>;
  /** Map viewport transform at the time this edit was made */
  public transform: TransformProps | undefined;


  /**
   * @constructor
   * @param props - Properties to initialize the Edit
   */
  public constructor(props: Partial<EditProps> = {}) {
    if (!props.graph) {
      throw new Error(`Edit missing 'graph' property`);
    }

    this.annotation = props.annotation;
    this.graph = props.graph;
    this.selectedIDs = props.selectedIDs;
    this.sources = props.sources ?? {};
    this.transform = props.transform;
  }
}

