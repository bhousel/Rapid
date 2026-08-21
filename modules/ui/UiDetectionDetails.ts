import { selection } from 'd3-selection';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { MapillaryDetection } from '../services/MapillaryService.ts';


/**
 * `UiDetectionDetails` renders the details (type, first/last seen) for a Mapillary detection.
 * Set the detection via the public `datum` property, then call `.render($parent)`.
 */
export class UiDetectionDetails {
  public context: Context;
  public datum: MapillaryDetection | null;

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

    const l10n = this.context.systems.l10n!;

    let $details: D3Selection = $parent.selectAll('.sidebar-details')
      .data(this.datum ? [this.datum] : [], (d: MapillaryDetection) => d.key);

    $details.exit()
      .remove();

    // enter - structure only
    const $$details: D3EnterSelection = $details.enter()
      .append('div')
      .attr('class', 'sidebar-details qa-details-container');

    // description
    const $$description: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'qa-details-item');

    $$description
      .append('h3')
      .attr('class', 'detection-details-title');

    const $$type: D3EnterSelection = $$description
      .append('div')
      .attr('class', 'detection-type');

    $$type.append('strong');
    $$type.append('span');

    const $$firstseen: D3EnterSelection = $$description
      .append('div')
      .attr('class', 'detection-first-seen');

    $$firstseen.append('strong');
    $$firstseen.append('span');

    const $$lastseen: D3EnterSelection = $$description
      .append('div')
      .attr('class', 'detection-last-seen');

    $$lastseen.append('strong');
    $$lastseen.append('span');

    // update - localized text here so it re-localizes on language change
    $details = $details.merge($$details);

    $details.select('.detection-details-title')
      .text(l10n.t('text.detail', { n: 100 }) + ':');   // force plural, i.e. "Details"

    const $type = $details.select('.detection-type');
    $type.select('strong')
      .text(l10n.t('text.type') + ':');
    $type.select('span')
      .text((d: MapillaryDetection) => d.props.value);

    const $firstseen = $details.select('.detection-first-seen');
    $firstseen.select('strong')
      .text(l10n.t('inspector.first_seen') + ':');
    $firstseen.select('span')
      .text((d: MapillaryDetection) => d.props.first_seen_at ? l10n.displayShortDate(d.props.first_seen_at) : l10n.t('text.unknown'));

    const $lastseen = $details.select('.detection-last-seen');
    $lastseen.select('strong')
      .text(l10n.t('inspector.last_seen') + ':');
    $lastseen.select('span')
      .text((d: MapillaryDetection) => d.props.last_seen_at ? l10n.displayShortDate(d.props.last_seen_at) : l10n.t('text.unknown'));
  }
}
