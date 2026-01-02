import type { D3Selection, Nullable } from '../core/types.ts';

/** Element with optional value property (like form input elements) */
type ValueElement = Element & { value?: string };

/** A value or a function that computes a value for each element */
type ValueAccessor = (this: Element, datum: unknown, index: number, groups: ArrayLike<Element>) => string | null | undefined;

/**
 * Like selection.property('value', ...), but avoids no-op value sets,
 * which can result in layout/repaint thrashing in some situations.
 *
 * When called with one argument (selection only), gets the value property.
 * When called with two arguments, sets the value property efficiently.
 *
 * @param selection - D3 selection of form elements
 * @param value - The value to set, a function to compute the value, or null/undefined to delete
 * @returns The value (when getting) or the selection (when setting)
 */
export function utilGetSetValue(selection: D3Selection, value?: Nullable<string | ValueAccessor>): string | D3Selection {
  function d3_selection_value(val: Nullable<string | ValueAccessor>): (this: ValueElement, datum: unknown, index: number, groups: ArrayLike<Element>) => void {
    function valueNull(this: ValueElement): void {
      delete this.value;
    }

    function valueConstant(this: ValueElement): void {
      if (this.value !== val) {
        this.value = val as string;
      }
    }

    function valueFunction(this: ValueElement, datum: unknown, index: number, groups: ArrayLike<Element>): void {
      const x = (val as ValueAccessor).call(this, datum, index, groups);
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
