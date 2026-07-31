import { selection } from 'd3-selection';

import { uiIcon } from '../icon.js';
import { uiTooltip } from '../tooltip.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiZoomToControl` renders a button that zooms to the current selection's extent
 * (and zooms back out again on a second click).
 */
export class UiZoomToControl {
  public context: Context;

  // Child components
  public Tooltip: any;

  // D3 selections
  public $parent: D3Selection | null;

  protected _prevTransform: any;   // After a zoom in, the previous transform to zoom back out
  protected _keys: string[] | null;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    const l10n = context.systems.l10n!;

    this._prevTransform = null;   // After a zoom in, the previous transform to zoom back out
    this._keys = null;

    // Create child components
    this.Tooltip = uiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.isDisabled = this.isDisabled.bind(this);
    this.render = this.render.bind(this);
    this.modechange = this.modechange.bind(this);
    this.zoomTo = this.zoomTo.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Event listeners
    context.on('modechange', this.modechange);
    l10n.on('localechange', this._setupKeybinding);

    this._setupKeybinding();
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

    const context = this.context;
    const l10n = context.systems.l10n!;

    let $button: D3Selection = $parent.selectAll('button')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'zoom-to-selection')
      .on('click', this.zoomTo)
      .call(this.Tooltip)
      .call(uiIcon('#rapid-icon-framed-dot', 'light'));

    // update
    $button = $button.merge($$button);

    $button
      .classed('disabled', this.isDisabled);

    // Update tooltip
    this.Tooltip
      .placement(l10n.isRTL ? 'right' : 'left')
      .title(() => this.isDisabled() ? l10n.t('inspector.zoom_to.no_selection') : l10n.t('inspector.zoom_to.title'))
      .shortcut(l10n.t('shortcuts.command.zoom_to.key'));
  }


  /**
   * The button is disabled if there is nothing selected that the user can zoom in to (or out from).
   * @return  `true` if the button disabled, `false` if not
   */
  public isDisabled(): boolean {
    const context = this.context;
    return !this._prevTransform && !(context.mode as any)?.extent;
  }


  /**
   * When changing modes, reset the previous transform and rerender
   */
  public modechange(): void {
    this._prevTransform = null;
    this.render();
  }


  /**
   * This zooms in on the selected feature(s), or unzooms out from them
   * @param  e - triggering event (if any)
   */
  public zoomTo(e?: Event): void {
    if (e)  e.preventDefault();

    const context = this.context;
    const extent = (context.mode as any)?.extent;
    const map = context.systems.map!;

    if (this._prevTransform) {   // pop back out
      map.transformEase(this._prevTransform);
      this._prevTransform = null;

    } else if (extent) {   // zoom in on extent
      const viewport = context.viewport;
      this._prevTransform = viewport.transform.props;
      const z = map.extentZoom(extent, viewport.center());
      map.centerZoomEase(extent.center(), z);

    } else {   // button disabled
      //  // consider: there are no tooltips for touch interactions so flash feedback instead
      //  if (_lastPointerUpType === 'touch' || _lastPointerUpType === 'pen') {
      //    ui.Flash
      //      .duration(2000)
      //      .iconName('#rapid-icon-framed-dot')
      //      .iconClass('disabled')
      //      .label(l10n.t('inspector.zoom_to.no_selection'))();
      //  }
    }
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    this._keys = [l10n.t('shortcuts.command.zoom_to.key')];
    context.keybinding().on(this._keys, this.zoomTo);
  }

}
