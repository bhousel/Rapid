import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiDetectionHeader` renders the header (icon + title) for a Mapillary detection.
 * Set the detection via the public `datum` property, then call `.render($parent)`.
 */
export class UiDetectionHeader {
  public context: Context;
  public datum: any;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._addIcon = this._addIcon.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    let $header: D3Selection = $parent.selectAll('.qa-header')
      .data(this.datum ? [this.datum] : [], (d: any) => d.key);

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('div')
      .attr('class', (d: any) => `qaItem ${d.props.serviceID}`)
      .call(this._addIcon);

    $$header
      .append('div')
      .attr('class', 'qa-header-label');

    // update
    $header = $header.merge($$header);
    $header.select('.qa-header-label')
      .text((d: any) => this._getTitle(d));
  }


  /**
   * Returns the localized title for a detection (traffic sign or detection value).
   * @param d - the detection datum
   */
  protected _getTitle(d: any): string {
    const l10n = this.context.systems.l10n!;

    if (d.props.object_type === 'traffic_sign') {
      return l10n.t('mapillary_signs.traffic_sign');
    } else {
      const stringID = d.props.value.replace(/--/g, '.');
      return l10n.t(`mapillary_detections.${stringID}`, { default: l10n.t('inspector.unknown') });
    }
  }


  /**
   * Renders the detection's preset icon (falling back to a question mark).
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  protected _addIcon($selection: D3Selection): void {
    const context = this.context;
    const schema = context.systems.schema!;

    const d = $selection.datum() as any;
    if (!d) return;

    let iconName;
    if (d.props.object_type === 'traffic_sign') {
      iconName = d.props.value;
    } else {
      const service = context.services[d.props.serviceID] as any;
      const presetID = service?.getDetectionPresetID(d.props.value);
      const preset = presetID && schema.getScope('osm').presets.get(presetID);
      iconName = preset?.props?.icon || 'fas-question';
    }

    // Some values we don't have icons for, check first - Rapid#1518
    const hasIcon = context.container().selectAll(`#rapid-defs #${iconName}`).size();

    $selection
      .call(uiIcon(hasIcon ? `#${iconName}` : '#fas-question'));
  }
}
