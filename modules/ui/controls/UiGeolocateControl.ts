import { selection } from 'd3-selection';
import { Extent } from '@rapid-sdk/math';

import { uiIcon } from '../icon.ts';
import { uiLoading } from '../loading.ts';
import { uiTooltip } from '../tooltip.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

const GEOLOCATE_TIMEOUT = 10000;  // 10 sec
const GEOLOCATE_REPEAT = 2000;    // 2 sec
const GEOLOCATE_OPTIONS = {
  enableHighAccuracy: false,   // prioritize speed and power usage over precision
  timeout: 6000   // 6sec      // don't hang indefinitely getting the location
};


/**
 * `UiGeolocateControl` renders the geolocate button that centers the map on the
 * user's current location (using the browser Geolocation API).
 */
export class UiGeolocateControl {
  public context: Context;

  // Child components
  public Tooltip: any;
  public Loading: any;

  // D3 selections
  public $parent: D3Selection | null;
  public $button: D3Selection | null;

  protected _isSupported: boolean;
  protected _isActive: boolean;
  protected _isInitial: boolean;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._isSupported = (typeof navigator?.geolocation?.getCurrentPosition === 'function');
    this._isActive = false;
    this._isInitial = false;  // only pan the map after the initial geolocate

    // Create child components
    this.Tooltip = uiTooltip(context);
    this.Loading = uiLoading(context).blocking(true);

    // D3 selections
    this.$parent = null;
    this.$button = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.block = this.block.bind(this);
    this.error = this.error.bind(this);
    this.render = this.render.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.success = this.success.bind(this);
    this.toggle = this.toggle.bind(this);
    this.unblock = this.unblock.bind(this);
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

    if (!this._isSupported) return;   // no button

    const context = this.context;
    const l10n = context.systems.l10n!;

    let $button: D3Selection = $parent.selectAll('button')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'geolocate')
      .on('click', this.toggle)
      .call(this.Tooltip)
      .call(uiIcon('#rapid-icon-geolocate', 'light'));

    // update
    this.$button = $button = $button.merge($$button);

    this.$button
      .classed('active', this._isActive);

    // Update localization
    this.Tooltip
      .placement(l10n.isRTL ? 'right' : 'left')
      .title(l10n.t('geolocate.title'));

    this.Loading
      .message(l10n.t('geolocate.locating'));
  }


  /**
   * @param e - triggering event (if any)
   */
  public toggle(e?: Event): void {
    e?.preventDefault();
    if (!this._isSupported) return;
    if (this.context.inIntro) return;

    if (!this._isActive) {
      this.start(e);
    } else {
      this.stop(e);
    }
  }


  /**
   * Start geolocating - enable the button, block the UI, and initiate a geolocate request.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
   * @param  e - triggering event (if any)
   */
  public start(e?: Event): void {
    e?.preventDefault();
    if (!this._isSupported) return;
    if (this.context.inIntro) return;
    if (this._isActive) return;    // already started

    this._isActive = true;

    if (this.$button) {
      this.$button.classed('active', true);
    }

    this.context.enter('browse');
    this.block();
    navigator.geolocation.getCurrentPosition(this.success, this.error, GEOLOCATE_OPTIONS);
  }


  /**
   * Stop geolocating - disable the button and remove any saved data
   * @param  e - triggering event (if any)
   */
  public stop(e?: Event): void {
    e?.preventDefault();
    if (!this._isActive) return;    // already stopped

    const context = this.context;
    const gfx = context.systems.gfx!;
    const layer: any = gfx.scene!.layers.get('map-ui');

    this._isActive = false;

    if (this.$button) {
      this.$button.classed('active', false);
    }

    this.unblock();
    layer.geolocationData = null;
    gfx.deferredRedraw();
  }


  /**
   * Callback called with a successful geolocation result.
   * This will continue the requests every few seconds until the user stops it.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
   * @see https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPosition
   * @param  result - the successful geolocation position
   */
  public success(result: GeolocationPosition): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const map = context.systems.map!;
    const scheduler = context.systems.scheduler;
    const layer: any = gfx.scene!.layers.get('map-ui');

    if (this._isActive) {   // User may have disabled it before the callback fires..
      const coords = result.coords;
      const extent = new Extent([coords.longitude, coords.latitude]).padByMeters(coords.accuracy);
      layer.geolocationData = result;
      gfx.deferredRedraw();

      // If `_isInitial`, this is the first successful result we've received.
      // Recenter the map and clear the timeout.
      if (this._isInitial) {
        this._isInitial = false;
        scheduler?.cancel('ui-geolocate-initial');
        map.centerZoomEase(extent.center(), Math.min(20, map.extentZoom(extent)));
      }

      // Keep geolocating until user turns the feature off..
      scheduler?.setTimeout('ui-geolocate', () => {
        navigator.geolocation.getCurrentPosition(this.success, this.error, GEOLOCATE_OPTIONS);
      }, { ms: GEOLOCATE_REPEAT });
    }

    this.unblock();
  }


  /**
   * Callback called when geolocation request either fails or times out.
   */
  public error(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui;

    if (this._isActive) {    // user may have disabled it before the callback fires
      ui?.Flash.show({
        label: l10n.t('geolocate.location_unavailable'),
        iconName: '#rapid-icon-geolocate'
      });
    }

    this.stop();
  }


  /**
   * This blocks the UI, only initially when the user first requests geolocation.
   */
  public block(): void {
    // The timeout ensures that we complete even if the success/error callbacks never get called.
    // This can happen if the user declines to share their location.
    const scheduler = this.context.systems.scheduler;
    scheduler?.setTimeout('ui-geolocate-initial', this.error, GEOLOCATE_TIMEOUT as any);
    this._isInitial = true;

    this.context.container().call(this.Loading);  // Block UI
  }


  /**
   * This unblocks the UI, after the initial request either completed or timed out.
   */
  public unblock(): void {
    const scheduler = this.context.systems.scheduler;
    scheduler?.cancel('ui-geolocate-initial');
    this._isInitial = false;

    this.Loading.close();  // Unblock UI
  }

}
