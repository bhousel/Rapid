import { selection } from 'd3-selection';

import { UiAttribution } from './UiAttribution.js';
import { UiInfoCards } from './UiInfoCards.js';
import { UiMap3dViewer } from './UiMap3dViewer.js';
import { UiMapControls } from './UiMapControls.js';
import { UiMapPanes } from './UiMapPanes.js';
import { UiMinimap } from './UiMinimap.js';
import { UiPhotoViewer } from './UiPhotoViewer.js';
import { UiSpector } from './UiSpector.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component creates the middle section for any UI elements that float over the map
 *
 * @example
 * <div class='over-map'>
 *   // Lots of things live in here..
 *   // Minimap, map controls, map panes, info cards, photo viewer
 *   …
 * </div>
 */
export class UiOvermap {
  public context: Context;

  // Child components
  public Attribution: any;
  public InfoCards: any;
  public Map3dViewer: any;
  public MapControls: any;
  public MapPanes: any;
  public Minimap: any;
  public PhotoViewer: any;
  public Spector: any;

  // D3 selections
  public $parent: D3Selection | null;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Create child components
    this.Attribution = new UiAttribution(context);
    this.InfoCards = new UiInfoCards(context);
    this.Map3dViewer = new UiMap3dViewer(context);
    this.MapControls = new UiMapControls(context);
    this.MapPanes = new UiMapPanes(context);
    this.Minimap = new UiMinimap(context);
    this.PhotoViewer = new UiPhotoViewer(context);
    this.Spector = new UiSpector(context);

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

    let $overmap: D3Selection = $parent.selectAll('.over-map')
      .data([0]);

    // enter
    const $$overmap = $overmap.enter()
      .append('div')
      .attr('class', 'over-map');

    // HACK: Mobile Safari 14 likes to select anything selectable when long-
    // pressing, even if it's not targeted. This conflicts with long-pressing
    // to show the edit menu. We add a selectable offscreen element as the first
    // child to trick Safari into not showing the selection UI.
    $$overmap
      .append('div')
      .attr('class', 'select-trap')
      .text('t');

    // update
    $overmap = $overmap.merge($$overmap) as D3Selection;

    $overmap
      .call(this.Minimap.render)
      .call(this.Map3dViewer.render)
      .call(this.Spector.render)
      .call(this.MapControls.render)
      .call(this.MapPanes.render)
      .call(this.InfoCards.render)
      .call(this.PhotoViewer.render)
      .call(this.Attribution.render);
  }

}
