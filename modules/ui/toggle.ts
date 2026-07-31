import { select as d3_select } from 'd3-selection';

import type { D3Selection } from 'd3-selection';


/**
 * Toggles the visibility of ui elements, using a combination of the
 * `hide` class, which sets `display: none`, and a d3 transition for opacity.
 * This will cause blinking when called repeatedly, so check that the
 * value actually changes between calls.
 *
 * @param show     - `true` to show the element, `false` to hide it
 * @param callback - optional function called (with `this` bound to the element) when the transition ends
 * @return a render function that applies the toggle to a d3-selection
 */
export function uiToggle(show: boolean, callback?: (this: Element) => void): ($selection: D3Selection) => void {
  return function($selection: D3Selection): void {
    $selection
      .style('opacity', show ? 0 : 1)
      .classed('hide', false)
      .transition()
      .style('opacity', show ? 1 : 0)
      .on('end', function(this: Element) {
        d3_select(this)
          .classed('hide', !show)
          .style('opacity', null);
        callback?.apply(this);
      });
  };
}
