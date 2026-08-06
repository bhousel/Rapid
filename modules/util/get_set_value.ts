import type { D3Selection } from 'd3-selection';

/** Element with optional value property (like form input elements) */
type ValueElement = Element & { value?: string };

/**
 * A function that computes a value for each element.
 * Generic on the datum type `D` so typed callbacks don't fight the compiler.
 */
type ValueAccessor<D> = (this: Element, datum: D, index: number, groups: ArrayLike<Element>) => string | null | undefined;

/**
 * Like selection.property('value', ...), but avoids no-op value sets,
 * which can result in layout/repaint thrashing (and cursor jumps on focused inputs).
 *
 * Getter: `utilGetSetValue($sel)` returns the `value` property of the (first) element.
 * Setter: `utilGetSetValue($sel, value)` sets the `value` property efficiently and
 *  returns the selection for chaining. `value` may be a string, a per-element function,
 *  or null/undefined to delete the property.
 *
 * @param selection - D3 selection of form elements
 * @returns The value string (when getting) or the selection (when setting)
 */
export function utilGetSetValue(selection: D3Selection): string;
export function utilGetSetValue<D = unknown>(selection: D3Selection, value: Nullable<string | ValueAccessor<D>>): D3Selection;
export function utilGetSetValue<D = unknown>(selection: D3Selection, value?: Nullable<string | ValueAccessor<D>>): string | D3Selection {
  function d3_selection_value(val: Nullable<string | ValueAccessor<D>>): (this: ValueElement, datum: D, index: number, groups: ArrayLike<Element>) => void {
    /** Deletes the `value` property from the element (sets to undefined/empty). */
    function valueNull(this: ValueElement): void {
      delete this.value;
    }

    /** Sets the element's `value` property to the constant `val`, if it differs. */
    function valueConstant(this: ValueElement): void {
      if (this.value !== val) {
        this.value = val as string;
      }
    }

    /** Sets the element's `value` from the accessor result, if it differs. */
    function valueFunction(this: ValueElement, datum: D, index: number, groups: ArrayLike<Element>): void {
      const x = (val as ValueAccessor<D>).call(this, datum, index, groups);
      if (x === null || x === undefined) {
        delete this.value;
      } else if (this.value !== x) {
        this.value = x;
      }
    }

    return (val === null || val === undefined)
      ? valueNull : (typeof val === 'function'
      ? valueFunction : valueConstant);
  }

  if (arguments.length === 1) {
    return selection.property('value') as string;
  }

  return selection.each(d3_selection_value(value) as (this: Element, datum: unknown, index: number, groups: ArrayLike<Element>) => void);
}
