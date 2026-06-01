import type { TransformProps } from '@rapid-sdk/math';
import type { Graph } from './Graph.js';


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

  public annotation: string | undefined;
  public graph: Graph;
  public selectedIDs: EntityID[] | undefined;
  public sources: Record<string, unknown>;
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

