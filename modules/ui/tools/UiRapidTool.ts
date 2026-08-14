import { selection } from 'd3-selection';
import { UiRapidDatasetToggle } from '../UiRapidDatasetToggle.ts';
import { UiRapidPowerUserFeatures } from '../UiRapidPowerUserFeatures.ts';
import { UiTooltip } from '../UiTooltip.ts';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * A toolbar section for the Rapid features
 */
export class UiRapidTool {
  public context: Context;
  public id: string;
  public stringID: string;
  public RapidModal: UiRapidDatasetToggle;
  public PowerUserModal: UiRapidPowerUserFeatures;
  public RapidTooltip: UiTooltip;
  public PowerUserTooltip: UiTooltip;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.id = 'rapid_features';
    this.stringID = 'toolbar.rapid_features';

    const scene = context.systems.gfx!.scene!;
    const ui = context.systems.ui;
    const urlhash = context.systems.urlhash!;

    // Create child components
    this.RapidModal = new UiRapidDatasetToggle(context);
    this.PowerUserModal = new UiRapidPowerUserFeatures(context);
    this.RapidTooltip = new UiTooltip(context);
    this.PowerUserTooltip = new UiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);

    ui?.on('uichange', this.render);
    urlhash.on('hashchange', this.render);
    scene.on('layerchange', this.render);
    context.on('modechange', this.render);
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
    const urlhash = context.systems.urlhash!;
    const ui = context.systems.ui;
    const $container = context.container();

    const isPowerUser = urlhash.getParam('poweruser') === 'true';
    const isNarrow = $container.selectAll('.map-toolbar.narrow').size();
    const rtl = l10n.isRTL ? '-rtl' : '';

    // Localize tooltips
    this.RapidTooltip
      .placement('bottom')
      .scrollContainer($container.select('.map-toolbar'))
      .title(l10n.t('shortcuts.command.toggle_rapid_data.label'))
      .shortcut(utilCmd('⇧' + l10n.t('shortcuts.command.toggle_rapid_data.key')));

    this.PowerUserTooltip
      .placement('bottom')
      .scrollContainer($container.select('.map-toolbar'))
      .title(l10n.t('rapid_poweruser.heading.label'));


    // Button group
    let $joined: D3Selection = $parent.selectAll('.joined')
      .data([0]);

    const $$joined = $joined.enter()
      .append('div')
      .attr('class', 'joined')
      .style('display', 'flex');

    $joined = $joined.merge($$joined);


    // Rapid Button
    let $rapidButton: D3Selection = $joined.selectAll('button.rapid-features')
      .data([this.RapidModal]);

    // enter
    const $$rapidButton = $rapidButton.enter()
      .append('button')
      .attr('class', 'bar-button rapid-features')
      .on('click', this.choose)
      .call(this.RapidTooltip.attach);

    $$rapidButton
      .append('svg')
      .attr('class', 'logo-rapid')
      .append('use');

    // update
    $rapidButton = $rapidButton.merge($$rapidButton)
      .classed('layer-off', !this.isLayerEnabled());

    $rapidButton
      .selectAll('.logo-rapid use')
      .attr('xlink:href',  isNarrow ? `#rapid-logo-rapid${rtl}` : `#rapid-logo-rapid-wordmark${rtl}` );


    // Poweruser Button
    const $poweruserButton: D3Selection = $joined.selectAll('button.rapid-poweruser-features')
      .data(isPowerUser ? [this.PowerUserModal] : []);

    $poweruserButton.exit()
      .remove();

    $poweruserButton.enter()
      .append('button')
      .attr('class', 'bar-button rapid-poweruser-features')
      .on('click', this.choose)
      .call(this.PowerUserTooltip.attach)
      .append('div')
      .attr('class', 'beta');

    // If we are adding/removing any buttons, check if toolbar has overflowed..
    if ($poweruserButton.enter().size() || $poweruserButton.exit().size()) {
      ui?.checkOverflow('.map-toolbar', true);
    }
  }


  /**
   * Chooses this item (usually because the user clicked on its button).
   * @param [e] - the triggering event, if any
   * @param [d] - object bound to the selection (i.e. the Modal)
   */
  public choose(e?: Event, d?: any): void {
    e?.preventDefault();
    d?.show();
  }


  /**
   * @return  `true` if the Rapid layer is enabled, `false` if not
   */
  public isLayerEnabled(): boolean | undefined {
    const scene = this.context.systems.gfx!.scene!;
    const rapidLayer = scene.layers.get('rapid');
    return rapidLayer?.enabled;
  }
}
