import type { Context } from '../Context.ts';
import type { Graph } from './Graph.ts';
import type { TransformProps, Vec4 } from '@rapid-sdk/math';


/** Parameters for an edit's label, e.g. `{ n: 3 }` for "Moved {n} features". */
export type EditLabelParams = Record<string, string | number>;

/**
 * What the undo/redo menu says about an edit, as a string ID and its parameters.
 * It's translated when shown, so it follows the user's language. Parameters should be values
 * like counts, not translated words.
 */
export interface EditLabel {
  /** The string to show, e.g. `'operations.delete.annotation.point'` */
  stringID: StringID;
  /** Parameters for the string */
  stringParams?: EditLabelParams;
}

/**
 * The selection that an older Rapid saved: data IDs grouped by the layer they're drawn on,
 * e.g. `{ osm: ['w1'] }`. Only for upgrading backups; edits now save a `DataID[]`.
 */
export type LegacyEditSelection = Record<LayerID, DataID[]>;

/** Imagery, photo and data sources used to make an edit (shown in the changeset comment) */
export interface EditSources {
  /** Imagery sources used */
  imagery?: string[];
  /** Photo sources used */
  photos?: string[];
  /** Data sources used */
  data?: string[];
}

/**
 * Properties that describe an `Edit`, everything about it except its graph.
 * These are plain JSON, saved in backups as they are.
 * Systems that make their own kinds of edits extend this with a `type` and their own props.
 * See `design/edit-system.md`.
 */
export interface EditProps {
  /** What kind of edit this is, set by whoever commits it. Classic OSM edits leave it unset. */
  type?: string;
  /** The undo/redo label, translated when shown */
  stringID?: StringID;
  /** Parameters for the label */
  stringParams?: EditLabelParams;
  /** A plain-text label, only for edits restored from a v3 backup (already translated) */
  annotation?: string;
  /** Data IDs of what's selected after this edit, e.g. `['w1', 'fbRoads:abc']`; redo restores it */
  selection?: DataID[];
  /** Data IDs of what was selected before this edit; undo restores it. `EditSystem` fills it in at commit. */
  selectionBefore?: DataID[];
  /**
   * Where the change is, as `[minLon, minLat, maxLon, maxLat]`. Undo and redo show it.
   * `EditSystem` computes it from the graph at commit; an edit that changes no OSM data
   * (like an ignore) passes its own.
   */
  extent?: Vec4;
  /** Sources used to make this edit */
  sources?: EditSources;
  /** Map transform at the time of the edit, where the user was looking */
  transform?: TransformProps;
}


/**
 * An `Edit` is one step in the `EditSystem` history: the graph after the step,
 * plus props that describe it.
 */
export class Edit<P extends EditProps = EditProps> {

  public context: Context;
  /** The graph after this edit. It's runtime state, so it isn't one of the props. */
  public graph: Graph;
  public props: P;


  /**
   * @param context - Global shared application context
   * @param graph - The graph after this edit
   * @param props - Properties that describe the edit, plain JSON
   */
  public constructor(context: Context, graph: Graph, props: Partial<P> = {}) {
    this.context = context;
    this.graph = graph;
    this.props = structuredClone(props) as P;
  }


  /**
   * Whether this edit has a label for the undo/redo menu.
   * @return `true` if the edit has a label
   */
  public get hasLabel(): boolean {
    return !!(this.props.stringID || this.props.annotation);
  }


  /**
   * The label for the undo/redo menu, in the user's current language.
   * @return The localized label, or `''` if the edit has none
   */
  public get label(): string {
    const l10n = this.context.systems.l10n;
    const props = this.props;

    if (props.stringID && l10n) {
      return l10n.t(props.stringID, props.stringParams);
    }
    return props.annotation ?? props.stringID ?? '';
  }


  /**
   * Whether this edit's label is the given one, e.g. to merge a repeated edit into this one.
   * Compares string IDs and parameters, not translated text.
   * @param label - The label to compare against
   * @return `true` if the labels match
   */
  public isLabeled(label: Nullable<EditLabel>): boolean {
    if (!label?.stringID) return false;
    const props = this.props;
    if (props.stringID !== label.stringID) return false;

    const a = props.stringParams ?? {};
    const b = label.stringParams ?? {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }
}
