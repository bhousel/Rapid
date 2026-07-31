import type { D3Selection } from 'd3-selection';


/** A set of tag changes to apply: key → new value (`undefined` removes the tag). */
export type TagChange = Record<string, string | undefined>;

/**
 * The tags on the selected entity or entities.
 * A value may be a `string`, or an array of strings when multiple entities are
 * selected and they disagree on the value (a "mixed" value).
 */
export type Tags = Record<string, string | string[] | undefined>;


/**
 * The internal implementation created by a `UiFieldX` class.
 * Each field renders itself into a selection via `render()` and exposes a small API.
 * The index signature keeps this permissive, since individual field types add their own methods.
 */
export interface UiFieldInternal {
  /** Renders the field into the given selection */
  render($selection: D3Selection): void;
  /** Updates the field with the current tags */
  tags(tags: Tags): void;
  /** Moves focus into the field's primary input */
  focus(): void;
  /** Subscribes to field events (`change`, `revert`, …) */
  on(...args: any[]): UiFieldInternal;
  /** Some fields want to know which entities are selected */
  entityIDs?(ids?: string[]): any;
  [key: string]: any;
}
