import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiDetectionDetails } from './UiDetectionDetails.ts';
import { UiDetectionHeader } from './UiDetectionHeader.ts';
import { UiViewOn } from './UiViewOn.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { MapillaryService, MapillaryDetection } from '../services/MapillaryService.ts';


/**
 * The `UiDetectionInspector` renders the sidebar inspector for a Mapillary detection
 * (header, details, "view on Mapillary" footer). Set the detection via the public `datum`
 * property, then call `.render($parent)`.
 */
export class UiDetectionInspector {
  public context: Context;
  public datum: MapillaryDetection | null;

  // Child components
  public DetectionHeader: UiDetectionHeader;
  public DetectionDetails: UiDetectionDetails;
  public ViewOn: UiViewOn;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    // Create child components
    this.DetectionHeader = new UiDetectionHeader(context);
    this.DetectionDetails = new UiDetectionDetails(context);
    this.ViewOn = new UiViewOn(context);

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

    const context = this.context;
    const l10n = context.systems.l10n!;
    const photos = context.systems.photos!;

    // add .header
    let $header: D3Selection = $parent.selectAll('.header')
      .data([0]);

    const $$header: D3EnterSelection = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3');

    // update
    $header = $header.merge($$header);
    $header.select('h3')
      .text(l10n.t('mapillary.detection'));


    // add .body
    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $details: D3Selection = $body.selectAll('.qa-editor')
      .data([0]);

    this.DetectionHeader.datum = this.datum;
    this.DetectionDetails.datum = this.datum;

    $details.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($details)
      .call(this.DetectionHeader.render)
      .call(this.DetectionDetails.render);


    // add .sidebar-footer
    const serviceID = this.datum?.props.serviceID;
    const service = serviceID && context.services[serviceID];
    const imageID = this.datum?.props.bestImageID || photos.currPhotoID;

    if (service && imageID) {
      this.ViewOn.stringID = 'mapillary.view_on_mapillary';
      this.ViewOn.url = (service as MapillaryService).imageURL(imageID);
    } else {
      this.ViewOn.stringID = '';
      this.ViewOn.url = '';
    }

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this.ViewOn.render);
  }
}
