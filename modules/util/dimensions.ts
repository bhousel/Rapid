import { select } from 'd3-selection';

import type { D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Read element dimensions from getBoundingClientRect and cache them on the selection.
 * @param $selection - D3 selection containing the element
 * @param node - The DOM element to measure
 * @returns The width and height as a Vec2 tuple [width, height]
 */
function refresh($selection: D3Selection, node: Element): Vec2 {
  const cr = node.getBoundingClientRect();
  const prop: Vec2 = [cr.width, cr.height];
  $selection.property('__dimensions__', prop);
  return prop;
}

/**
 * Get the dimensions of a D3 selection, using cached values when available.
 * If the selection is empty or null, returns [0, 0].
 * @param $selection - D3 selection to measure (can be null/undefined)
 * @param force - If true, forces a fresh measurement even if cached values exist
 * @returns The width and height as a Vec2 tuple [width, height]
 */
export function utilGetDimensions($selection: Nullable<D3Selection>, force: boolean = false): Vec2 {
  if (!$selection || $selection.empty()) {
    return [0, 0];
  }

  const node = $selection.node();
  if (!node) return [0, 0];

  const cached = $selection.property('__dimensions__') as Vec2 | undefined;
  return (!cached || force) ? refresh($selection, node) : cached;
}


/**
 * Set the dimensions of a D3 selection and update the cached values.
 * If dimensions is null, refreshes the cached dimensions from the current element size.
 * @param $selection - D3 selection to set dimensions on (can be null/undefined)
 * @param dimensions - The width and height to set, or null to refresh from current size
 * @returns The D3 selection for method chaining, or a null selection if input was invalid
 */
export function utilSetDimensions($selection: Nullable<D3Selection>, dimensions: Nullable<Vec2>): D3Selection {
  if (!$selection) return select(null as unknown as Element);
  if ($selection.empty()) return $selection;

  const node = $selection.node();
  if (!node) return $selection;

  if (!dimensions) {
    refresh($selection, node);
    return $selection;
  }

  $selection
    .property('__dimensions__', [dimensions[0], dimensions[1]])
    .attr('width', dimensions[0])
    .attr('height', dimensions[1]);

  return $selection;
}
