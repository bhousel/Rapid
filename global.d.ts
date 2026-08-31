/**
 * Global type declarations for Rapid
 *
 * This file contains:
 * - Global variable declarations (for test environment)
 * - Type augmentations for external libraries with inconvenient/incorrect types
 *
 * Note: Ambient module declarations for libraries without types
 * (like @mapbox/polylabel) live in `modules/types/*.d.ts` files.
 */

// The `export {}` makes this file a module, enabling augmentation
export {};

// Global type declarations
declare global {
  /** A type that can be T, null, or undefined */
  type Nullable<T> = T | null | undefined;

  /** Errback-style callback: `(err, result?) => void` */
  type Errback = (err: any, result?: any) => void;

  /**
   * An abortable function that can be run either on the main thread or a web worker.
   * Receives arbitrary structured-clone-safe `data` and an `AbortSignal`.
   * Must return a structured-clone-safe value (no DOM nodes, no prototypes).
   */
  type Listener = (data: unknown, signal: AbortSignal) => unknown | Promise<unknown>;

  /** Mapping of available ListenerID -> Listener function */
  type ListenerRegistry = Record<ListenerID, Listener>;


  // String ID types are defined in modules/types/ids.ts
  // They are both exported (for external consumers) and declared globally (for internal use)
}


declare module 'd3-geo' {
  /**
   * Raw Mercator projection function.
   * @types/d3-geo incorrectly types this as a factory function,
   * but it's actually the raw projection function itself.
   * @param lambda - Longitude in radians
   * @param phi - Latitude in radians
   * @returns Projected [x, y] coordinates
   */
  export function geoMercatorRaw(lambda: number, phi: number): [number, number];
}


declare module 'd3-selection' {
  /**
   * Permissive D3 Selection type aliases.
   * These use `any` for all type parameters to avoid friction when chaining
   * D3 selections or when the datum type changes during method chains.
   */
  export type D3Selection = Selection<any, any, any, any>;
  export type D3EnterSelection = Selection<any, any, any, any>;

  /**
   * Standard D3 Callback types
   */
  export type D3CallbackBoolean = (datum: any, index: number, groups: any) => boolean;
  export type D3CallbackValue = (datum: any, index: number, groups: any) => any;
  export type D3CallbackVoid = (datum: any, index: number, groups: any) => void;

  /**
   * Override D3 Selection interface to make callbacks more permissive.
   * D3's default types are very strict about datum types, causing friction
   * when the datum type is unknown or when chaining selections.
   * These overrides allow callbacks to type their datum parameter explicitly.
   */
  interface Selection<GElement extends BaseType, Datum, PElement extends BaseType, PDatum> {
    /**
     * More permissive data binding that accepts any key function.
     * The key function can explicitly type its datum parameter.
     */
    data<NewDatum>(
      data: NewDatum[] | Iterable<NewDatum>,
      key?: (datum: any, index: number, groups: any) => string | number
    ): Selection<GElement, NewDatum, PElement, PDatum>;

    /** Permissive append with value function - datum can be typed by caller. */
    append(value: D3CallbackValue): this;
    /** Permissive insert with value function - datum can be typed by caller. */
    insert(value: D3CallbackValue): this;
    /** Permissive attr with value function - datum can be typed by caller. */
    attr(name: string, value: D3CallbackValue): this;
    /** Permissive style with value function - datum can be typed by caller. */
    style(name: string, value: D3CallbackValue, priority?: 'important' | null): this;
    /** Permissive text with value function - datum can be typed by caller. */
    text(value: D3CallbackValue): this;
    /** Permissive html with value function - datum can be typed by caller. */
    html(value: D3CallbackValue): this;
    /** Permissive classed with value function - datum can be typed by caller. */
    classed(names: string, value: D3CallbackBoolean): this;
    /** Permissive property with value function - datum can be typed by caller. */
    property(name: string, value: D3CallbackValue): this;
    /** Permissive filter with function - datum can be typed by caller. */
    filter(selector: D3CallbackBoolean): Selection<GElement, Datum, PElement, PDatum>;
    /** Permissive sort - datum can be typed by caller. */
    sort(comparator: (a: any, b: any) => number): this;
    /** Permissive each - datum can be typed by caller. */
    each(callback: (datum: any, index: number, groups: any) => void): this;
    /** Permissive on with callback - datum can be typed by caller. */
    on(typenames: string, callback: ((event: any, datum: any) => void) | null, options?: any): this;
  }
}
