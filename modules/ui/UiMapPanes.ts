import { selection, select } from 'd3-selection';

import {
  UiPaneBackground, UiPaneHelp, UiPaneIssues, UiPaneMapData, UiPanePreferences
} from './panes/index.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component the map panes section for drawers like:
 *  Background, Map Data, Issues, Preferences, Help
 */
export class UiMapPanes {
  public context: Context;

  // Child components
  public Background: any;
  public MapData: any;
  public Issues: any;
  public Preferences: any;
  public Help: any;
  public panes: any[];

  // D3 selections
  public $parent: D3Selection | null;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Create child components
    this.Background = new UiPaneBackground(context);
    this.MapData = new UiPaneMapData(context);
    this.Issues = new UiPaneIssues(context);
    this.Preferences = new UiPanePreferences(context);
    this.Help = new UiPaneHelp(context);

    this.panes = [
      this.Background,
      this.MapData,
      this.Issues,
      this.Preferences,
      this.Help
    ];

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

    const $panes: D3Selection = $parent.selectAll('.map-panes')
      .data([0]);

    // enter
    const $$panes = $panes.enter()
      .append('div')
      .attr('class', 'map-panes');

    // Add the panes (enter only)
    $$panes.selectAll('.map-pane')
      .data(this.panes, (d: any) => d.id)
      .enter()
      .each((d: any, i, nodes) => {
        select(nodes[i]).call(d.renderPane);
      });

    // Also add the pane toggle buttons to the map controls div (enter only)
    const $mapControls = $parent.selectAll('.map-controls');

    $mapControls.selectAll('.map-pane-control')
      .data(this.panes, (d: any) => d.id)
      .enter()
      .each((d: any, i, nodes) => {
        select(nodes[i]).call(d.renderToggleButton);
      });
  }

}
