import { selection } from 'd3-selection';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';

/**
 * A wrapper for the 3dMap
 * Someday we should make this more like the photoviewer
 */
export class UiMap3dViewer {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const map3d = this.context.systems.map3d!;
    const containerID = map3d.containerID;

    $parent.selectAll(`#${containerID}`)
      .data([0])
      .enter()
      .append('div')
      .attr('id', containerID)
      .style('display', 'none');
  }
}
