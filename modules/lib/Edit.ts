import type { Graph } from './Graph.js';


/**
 * Properties that define an Edit.
 */
export interface EditProps {
  /** Human-readable description of the edit */
  annotation: string;
  /** The graph state after this edit */
  graph: Graph;
  /** IDs of entities selected when this edit was made */
  selectedIDs: string[];
  /** Sources that contributed to this edit */
  sources: Record<string, unknown>;
  /** Map transform at time of edit */
  transform: unknown;
}


/**
 * `Edit` encapsulates the state of a single edit.
 */
export class Edit {
  annotation: string | undefined;
  graph: Graph | undefined;
  selectedIDs: string[] | undefined;
  sources: Record<string, unknown>;
  transform: unknown;

  /**
   * @constructor
   * @param props - Properties to initialize the Edit
   */
  constructor(props: Partial<EditProps> = {}) {
    this.annotation = props.annotation;
    this.graph = props.graph;
    this.selectedIDs = props.selectedIDs;
    this.sources = props.sources ?? {};
    this.transform = props.transform;
  }
}

