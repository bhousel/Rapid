import { selection, select } from 'd3-selection';
import { UiBearingControl, UiGeolocateControl, UiZoomControl, UiZoomToControl } from './controls/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This component creates the map controls bar
 * (bearing, zoom in, zoom out, zoom to selection, geolocate)
 */
export class UiMapControls {
  public context: Context;

  // Child components
  public BearingControl: UiBearingControl;
  public ZoomControl: UiZoomControl;
  public ZoomToControl: UiZoomToControl;
  public GeolocateControl: UiGeolocateControl;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Create child components
    this.BearingControl = new UiBearingControl(context);
    this.ZoomControl = new UiZoomControl(context);
    this.ZoomToControl = new UiZoomToControl(context);
    this.GeolocateControl = new UiGeolocateControl(context);

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

    // .map-controls container
    let $container: D3Selection = $parent.selectAll('.map-controls')
      .data([0]);

    const $$container = $container.enter()
      .append('div')
      .attr('class', 'map-controls');

    $container = $container.merge($$container) as D3Selection;


    // Map Controls
    const components = [
      { control: this.BearingControl, klass: 'bearing' },
      { control: this.ZoomControl, klass: 'zoombuttons' },
      { control: this.ZoomToControl, klass: 'zoom-to-selection' },
      { control: this.GeolocateControl, klass: 'geolocate' }
    ];

    let $controls: D3Selection = $container.selectAll('.map-control')
      .data(components, (d: any) => d.klass);

    // enter
    const $$controls = $controls.enter()
      .append('div')
      .attr('class', (d: any) => `map-control ${d.klass}`);

    // update
    $controls = $controls.merge($$controls) as D3Selection;

    $controls
      .each((d: any, i, nodes) => {
        select(nodes[i]).call(d.control.render);  // render
      });
  }

}
