import { EventEmitter } from 'tseep/lib/ee-safe';
import { uiIcon } from './icon.ts';
import { UiCombobox } from './UiCombobox.ts';
import { UiModal } from './UiModal.ts';
import { utilNoAuto, utilSafeURL } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';



/**
 * `UiRapidDatasetSettings` is a Modal control where the user can change
 * a dataset's settings.
 *
 * Events available:
 * - `done`:  Fires when the user is finished and they are closing this Modal
 */
export class UiRapidDatasetSettings extends EventEmitter {
  public context: Context;

  // Child components
  // public CategoryCombo: UiCombobox;
  public Modal: UiModal | null;

  /** The dataset being setup */
  protected _dataset: RapidDataset | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._dataset = null;

    // Child components
    // this.CategoryCombo = new UiCombobox(context, 'dataset-categories');
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderDetails = this.renderDetails.bind(this);
    this.renderThumbnail = this.renderThumbnail.bind(this);
    this.renderConflation = this.renderConflation.bind(this);
    this.renderDictionary = this.renderDictionary.bind(this);

    // Setup event handlers
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this.render);
  }


  /**
   * Gets the current dataset.
   * @return The current dataset
   */
  public get dataset(): RapidDataset | null {
    return this._dataset;
  }
  /**
   * Sets the current dataset
   * @param val - a RapidDataset
   */
  public set dataset(val: RapidDataset) {
    if (val === this._dataset) return;  // no change
    this._dataset = val;
    this.render();
  }


  /**
   * This shows the Modal if it isn't already being shown.
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    if (this.Modal?.isShown) return;

    this.Modal = new UiModal(context).show();
    this.Modal.$modal!
      .attr('class', 'modal rapid-modal wide modal-dataset-settings');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();

    // Setup event handlers
    l10n.on('localechange', this.render);
  }


  /**
   * Dismisses and removes the Modal, if it exists.
   * @param [e] - the triggering event, if any
   */
  public close(e?: Event): void {
    e?.preventDefault();
    this.Modal?.close();
  }


  /**
   * Emits a 'done' event and cleans up the Modal.
   * All the various ways of closing the Modal end up here.
   */
  protected _done(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    this.emit('done');
    this.Modal = null;
    l10n.off('localechange', this.render);
  }


  /**
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   * this one doesn't need it - the owned modal is always the parent.
   */
  public render(): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.Modal.$content!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    /* Heading section */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    const $$heading: D3EnterSelection = $heading
      .enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('div')
      .attr('class', 'modal-heading-icon')
      .call(uiIcon('#fas-gear', 'icon-30'));

    $$heading
      .append('h1')
      .attr('class', 'modal-heading-text');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading-text')
      .text(l10n.t('rapid_dataset_settings.heading'));


    /* Wrapper for main modal section */
    let $wrap: D3Selection = $content.selectAll('.dataset-settings-wrap')
      .data([0]);

    // enter
    const $$wrap: D3EnterSelection = $wrap
      .enter()
      .append('div')
      .attr('class', 'modal-section dataset-settings-wrap');

    // update
    $wrap = $wrap.merge($$wrap);

    $wrap
      .call(this.renderDetails)
      .call(this.renderThumbnail)
      .call(this.renderConflation)
      .call(this.renderDictionary);


    /* OK Button */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons: D3EnterSelection = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click', this.close);

    // set focus (but only on enter)
    const buttonNode = $$buttons.selectAll('button').node() as HTMLElement | null;
    buttonNode?.focus();

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons.selectAll('.button')
      .text(l10n.t('text.okay'));
  }


  /**
   * Renders the details section.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderDetails($selection: D3Selection): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // You can't change the details for datasets that are provided by one of the services.
    const isLocked = !!ds.serviceID;


    /* Details section */
    let $details: D3Selection = $selection.selectAll('.dataset-details')
      .data([0]);

    // enter
    const $$details: D3EnterSelection = $details
      .enter()
      .append('div')
      .attr('class', 'dataset-details');

    $$details
      .append('h3')
      .attr('class', 'dataset-details-heading');

    const $$identifier: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$identifier
      .append('div')
      .attr('class', 'dataset-details-label identifier-label');
    $$identifier
      .append('div')
      .attr('class', 'dataset-details-value identifier-value');

    const $$source: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$source
      .append('div')
      .attr('class', 'dataset-details-label source-label');
    $$source
      .append('div')
      .attr('class', 'dataset-details-value source-value');

    const $$name: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$name
      .append('div')
      .attr('class', 'dataset-details-label name-label');
    $$name
      .append('div')
      .attr('class', 'dataset-details-value name-value');

    const $$description: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$description
      .append('div')
      .attr('class', 'dataset-details-label description-label');
    $$description
      .append('div')
      .attr('class', 'dataset-details-value description-value');

    const $$url: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$url
      .append('div')
      .attr('class', 'dataset-details-label url-label');
    $$url
      .append('div')
      .attr('class', 'dataset-details-value url-value');

    const $$conflation: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'dataset-details-row');
    $$conflation
      .append('div')
      .attr('class', 'dataset-details-label conflation-label');
    $$conflation
      .append('div')
      .attr('class', 'dataset-details-value conflation-value');

    // update
    $details = $details.merge($$details);

    $details.selectAll('.dataset-details-heading')
      .text(l10n.t('rapid_dataset_settings.details.heading'));

    $details.selectAll('.dataset-details-value')
      .classed('disabled', isLocked);

    $details.selectAll('.identifier-label')
      .text(l10n.t('rapid_dataset_settings.details.identifier'));
    $details.selectAll('.identifier-value')
      .classed('disabled', true)   // this one is always locked
      .text(ds.id || '');

    $details.selectAll('.source-label')
      .text(l10n.t('rapid_dataset_settings.details.source'));
    $details.selectAll('.source-value')
      .text(ds.serviceID || '');

    $details.selectAll('.name-label')
      .text(l10n.t('text.name'));
    $details.selectAll('.name-value')
      .text(ds.getLabel() || '');

    $details.selectAll('.description-label')
      .text(l10n.t('text.description'));
    $details.selectAll('.description-value')
      .text(ds.getDescription() || '');

    $details.selectAll('.url-label')
      .text(l10n.t('rapid_dataset_settings.details.url'));
    $details.selectAll('.url-value')
      .text(ds.sourceUrl || '');

    $details.selectAll('.conflation-label')
      .text('Conflation?');
    $details.selectAll('.conflation-value')
      .text(ds.conflated ? 'yes' : 'no');
  }


  /**
   * Renders the thumbnail section.
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderThumbnail($parent: D3Selection): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // You can't change the details for datasets that are provided by one of the services.
    const isLocked = !!ds.serviceID;

    /* Thumbnail */
    let $thumbnailSection: D3Selection = $parent.selectAll('.dataset-thumbnail')
      .data([0]);

    const $$thumbnailSection: D3EnterSelection = $thumbnailSection
      .enter()
      .append('div')
      .attr('class', 'dataset-thumbnail');

    const $$thumbnail: D3EnterSelection = $$thumbnailSection
      .append('div')
      .attr('class', 'dataset-thumb');

    $$thumbnail
      .append('img')
      .attr('class', 'dataset-thumbnail');
    $$thumbnail
      .append('div')
      .attr('class', 'dataset-thumbnail-instruction');

    // update
    $thumbnailSection = $thumbnailSection.merge($$thumbnailSection);

    $thumbnailSection.selectAll('.dataset-thumbnail')
      .classed('inverted', ds.serviceID === 'esri')  // invert colors from light->dark
      .attr('src', utilSafeURL(ds.thumbnailUrl));

    $thumbnailSection.selectAll('.dataset-thumbnail-instruction')
      .text(isLocked ? '' : l10n.t('rapid_dataset_settings.thumbnail.instruction'));
  }


  /**
   * Renders the conflation settings section.
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderConflation($parent: D3Selection): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    /* Conflation Settings */
    let $conflation: D3Selection = $parent.selectAll('.dataset-conflation')
      .data([0]);

    // enter
    const $$conflation: D3EnterSelection = $conflation
      .enter()
      .append('div')
      .attr('class', 'dataset-conflation');

    $$conflation
      .append('h3')
      .attr('class', 'dataset-conflation-heading');

    $$conflation
      .append('div')
      .attr('class', 'dataset-conflation-content');

    // update
    $conflation = $conflation.merge($$conflation);

    $conflation.selectAll('.dataset-conflation-heading')
      .text(l10n.t('rapid_dataset_settings.conflation.heading'));

    $conflation.selectAll('.dataset-conflation-content')
      .text('conflation settings goes here');
  }


  /**
   * Renders the dictionary section.
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderDictionary($parent: D3Selection): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // You can't change the details for datasets that are provided by one of the services.
    const isLocked = !!ds.serviceID;


    /* Data Dictionary */
    let $dictionary: D3Selection = $parent.selectAll('.dataset-dictionary')
      .data([0]);

    // enter
    const $$dictionary: D3EnterSelection = $dictionary
      .enter()
      .append('div')
      .attr('class', 'dataset-dictionary');

    $$dictionary
      .append('h3')
      .attr('class', 'dataset-dictionary-heading');

    $$dictionary
      .append('div')
      .attr('class', 'dataset-dictionary-content');

    // update
    $dictionary = $dictionary.merge($$dictionary);

    $dictionary.selectAll('.dataset-dictionary-heading')
      .text(l10n.t('rapid_dataset_settings.dictionary.heading'));

    $dictionary.selectAll('.dataset-dictionary-content')
      .text('data mapping goes here');
  }

}
