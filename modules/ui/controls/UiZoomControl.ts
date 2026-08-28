import { select, selection } from 'd3-selection';

import { uiIcon } from '../icon.ts';
import { UiTooltip } from '../UiTooltip.ts';
import { utilCmd, utilKeybinding } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiZoomControl` renders the zoom-in / zoom-out buttons and wires their keybindings.
 */
export class UiZoomControl {
  public context: Context;

  // Child components
  public Tooltip: UiTooltip;

  // D3 selections
  public $parent: D3Selection | null;

  public zooms: any[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;

    // Create child components
    this.Tooltip = new UiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.zoomIn = this.zoomIn.bind(this);
    this.zoomOut = this.zoomOut.bind(this);
    this.zoomInFurther = this.zoomInFurther.bind(this);
    this.zoomOutFurther = this.zoomOutFurther.bind(this);

    this.zooms = [{
      id: 'zoom-in',
      icon: 'rapid-icon-plus',
      key: '+',
      action: this.zoomIn,
      isDisabled: () => !map.canZoomIn(),
      getTitle: () => l10n.t('zoom.in'),
      getDisabledTitle: () => l10n.t('zoom.disabled.in')
    }, {
      id: 'zoom-out',
      icon: 'rapid-icon-minus',
      key: '-',
      action: this.zoomOut,
      isDisabled: () => !map.canZoomOut(),
      getTitle: () => l10n.t('zoom.out'),
      getDisabledTitle: () => l10n.t('zoom.disabled.out')
    }];

    // Event listeners
    utilKeybinding.plusKeys.forEach(key => {
      context.keybinding().on(key, this.zoomIn);
      context.keybinding().on(utilCmd('⌥' + key), this.zoomInFurther);
    });

    utilKeybinding.minusKeys.forEach(key => {
      context.keybinding().on(key, this.zoomOut);
      context.keybinding().on(utilCmd('⌥' + key), this.zoomOutFurther);
    });

    gfx.on('draw', this.render);
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

    let $buttons: D3Selection = $parent.selectAll('button')
      .data(this.zooms);

    // enter
    const $$buttons = $buttons.enter()
      .append('button')
      .attr('class', (d: any) => d.id)
      .on('click', (e: PointerEvent, d: any) => {
        if (!d.isDisabled()) {
          d.action(e);
        }
      })
      .call(this.Tooltip.attach)
      .each((d, i, nodes) => {
        select(nodes[i])
          .call(uiIcon(`#${d.icon}`, 'light'));
      });

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons
      .classed('disabled', d => d.isDisabled());

    // Update tooltip
    this.Tooltip
      .placement(l10n.isRTL ? 'right' : 'left')
      .title((d: any) => d.isDisabled() ? d.getDisabledTitle() : d.getTitle())
      .shortcut((d: any) => d.key);

    $buttons
      .each((d, i, nodes) => {
        const $button = select(nodes[i]);
        if (!$button.select('.tooltip.in').empty()) {
          $button.call(this.Tooltip.updateContent);
        }
      });
  }


  /**
   * Zoom in.
   * @param [e] - triggering event (if any)
   */
  public zoomIn(e?: Event): void {
    e?.preventDefault();
    const map = this.context.systems.map!;
    map.zoomIn();
  }

  /**
   * Zoom out.
   * @param [e] - triggering event (if any)
   */
  public zoomOut(e?: Event): void {
    e?.preventDefault();
    const map = this.context.systems.map!;
    map.zoomOut();
  }

  /**
   * Zoom in further.
   * @param [e] - triggering event (if any)
   */
  public zoomInFurther(e?: Event): void {
    e?.preventDefault();
    const map = this.context.systems.map!;
    map.zoomInFurther();
  }

  /**
   * Zoom out further.
   * @param [e] - triggering event (if any)
   */
  public zoomOutFurther(e?: Event): void {
    e?.preventDefault();
    const map = this.context.systems.map!;
    map.zoomOutFurther();
  }
}
