import { selection } from 'd3-selection';
import { geoLonToMeters, geoMetersToLon } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';

const MAXLENGTH = 180;
const TICKHEIGHT = 8;


/**
 * This component adds the scale bar.
 */
export class UiScale {
  public context: Context;

  protected _isImperial: boolean;

  // D3 selections
  public $parent: D3Selection | null;
  public $wrap: D3Selection | null;

  public rerender: () => void;
  protected _deferredUpdateScale: () => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;  // optional

    this._isImperial = !l10n.isMetric;

    // D3 selections
    this.$parent = null;
    this.$wrap = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.toggleUnits = this.toggleUnits.bind(this);
    this.updateScale = this.updateScale.bind(this);
    this._deferredUpdateScale = () => {
      // scheduler throttles the update; without it, just update immediately
      if (scheduler) {
        scheduler.throttle('UiScale-updateScale', () => this.updateScale(), { ms: 100 });
      } else {
        this.updateScale();
      }
    };

    gfx.on('draw', this._deferredUpdateScale);
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

    // Create wrapper div if necessary
    let $wrap: D3Selection = $parent.selectAll('.scale-wrap')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'scale-wrap')
      .on('click', this.toggleUnits);

    $$wrap.append('svg')
      .attr('class', 'scale')
      .append('path')
      .attr('class', 'scale-path');

    $$wrap
      .append('div')
      .attr('class', 'scale-text');

    // update
    this.$wrap = $wrap = $wrap.merge($$wrap);

    this.updateScale();
  }


  /**
   * Updates the length and text of the scale bar.
   */
  public updateScale(): void {
    if (!this.$wrap) return;   // called too early?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;

    // Measure loc1, loc2 along bottom of viewport near where the scale bar will be drawn
    const bottom = viewport.dimensions[1];  // height
    const loc1 = viewport.unproject([0, bottom]);
    const loc2 = viewport.unproject([MAXLENGTH, bottom]);
    const lat = (loc2[1] + loc1[1]) / 2;
    const conversion = (this._isImperial ? 3.28084 : 1);
    const dist = geoLonToMeters(loc2[0] - loc1[0], lat) * conversion;

    let buckets: number[];
    if (this._isImperial) {
      buckets = [5280000, 528000, 52800, 5280, 500, 50, 5, 1];
    } else {
      buckets = [5000000, 500000, 50000, 5000, 500, 50, 5, 1];
    }

    // Determine a user-friendly endpoint for the scale
    let scaleDistance = 0;
    for (const val of buckets) {
      if (dist >= val) {
        scaleDistance = Math.floor(dist / val) * val;
        break;
      } else {
        scaleDistance = +dist.toFixed(2);
      }
    }

    const dLon = geoMetersToLon(scaleDistance / conversion, lat);
    const scaleWidth = Math.round(viewport.project([loc1[0] + dLon, loc1[1]])[0]);
    const scaleHeight = TICKHEIGHT;
    const scaleText = l10n.displayLength(scaleDistance / conversion, this._isImperial);

    const [w, h] = [scaleWidth + 2, scaleHeight + 2];
    this.$wrap.select('.scale')
      .attr('width', `${w}px`)
      .attr('height', `${h}px`)
      .attr('viewBox', `0 0 ${w} ${h}`);

    this.$wrap.select('.scale-path')
      .attr('d', `M0.5,0.5 v${scaleHeight} h${scaleWidth} v${-scaleHeight}`);

    this.$wrap.select('.scale-text')
      .text(scaleText);
  }


  /**
   * Toggle the scale bar between imperial and metric
   */
  public toggleUnits(): void {
    this._isImperial = !this._isImperial;
    this.updateScale();
  }

}
