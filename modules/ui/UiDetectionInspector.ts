import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiDetectionDetails } from './UiDetectionDetails.ts';
import { UiDetectionHeader } from './UiDetectionHeader.ts';
import { UiViewOn } from './UiViewOn.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiDetectionInspector` renders the sidebar inspector for a Mapillary detection
 * (header, details, "view on Mapillary" footer). Set the detection via the public `datum`
 * property, then call `.render($parent)`.
 */
export class UiDetectionInspector {
  public context: Context;
  public datum: any;

  protected _header: UiDetectionHeader;
  protected _details: UiDetectionDetails;
  protected _viewOn: UiViewOn;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    this._header = new UiDetectionHeader(context);
    this._details = new UiDetectionDetails(context);
    this._viewOn = new UiViewOn(context);

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

    const $$header = $header.enter()
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

    this._header.datum = this.datum;
    this._details.datum = this.datum;

    $details.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($details)
      .call(this._header.render)
      .call(this._details.render);


    // add .sidebar-footer
    const service = context.services[this.datum.props.serviceID] as any;
    const imageID = this.datum.props.bestImageID || photos.currPhotoID;

    if (service && imageID) {
      this._viewOn.stringID = 'mapillary.view_on_mapillary';
      this._viewOn.url = service.imageURL(imageID);
    } else {
      this._viewOn.stringID = '';
      this._viewOn.url = '';
    }

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this._viewOn.render);
  }
}
