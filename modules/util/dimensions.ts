import { select as d3_select } from 'd3-selection';
import type { Vec2 } from '../data/types.ts';
import type { D3Selection, Nullable } from '../core/types.ts';

function refresh($selection: D3Selection, node: Element): Vec2 {
  const cr = node.getBoundingClientRect();
  const prop: Vec2 = [cr.width, cr.height];
  $selection.property('__dimensions__', prop);
  return prop;
}

export function utilGetDimensions($selection: Nullable<D3Selection>, force: boolean = false): Vec2 {
  if (!$selection || $selection.empty()) {
    return [0, 0];
  }

  const node = $selection.node();
  if (!node) return [0, 0];

  const cached = $selection.property('__dimensions__') as Vec2 | undefined;
  return (!cached || force) ? refresh($selection, node) : cached;
}


export function utilSetDimensions($selection: Nullable<D3Selection>, dimensions: Nullable<Vec2>): D3Selection {
  if (!$selection) return d3_select(null as unknown as Element);
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