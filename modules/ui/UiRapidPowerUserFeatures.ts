import { EventEmitter } from 'tseep/lib/ee-safe';
import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * `UiRapidPowerUserFeatures` is a Modal that allows the user to toggle on and off poweruser features.
 * It is shown by clicking the "Beta" button in the top menu, if `&poweruser=true` is in the url.
 *
 * Events available:
 * - `done`:  Fires when the user is finished and they are closing this Modal
 */
export class UiRapidPowerUserFeatures extends EventEmitter {
  public context: Context;
  protected _featureFlags: string[];

  // Child components
  public Modal: UiModal | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._featureFlags = [
      'autoConnect',
      'previewDatasets',
      'tagnosticRoadCombine',
      'tagSources',
      'showAutoFix',
      'allowLargeEdits'
    ];

    // Child components
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderFeatures = this.renderFeatures.bind(this);
    this.updateFeatureFlags = this.updateFeatureFlags.bind(this);
    this.isFeatureEnabled = this.isFeatureEnabled.bind(this);
    this.toggleFeature = this.toggleFeature.bind(this);
  }


  /**
   * This shows the datataset modal if it isn't already being shown.
   * For a Modal component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const urlhash = context.systems.urlhash!;

    if (this.Modal?.isShown) return;  // already showing

    this.updateFeatureFlags();

    this.Modal = new UiModal(context).show();

    this.Modal.$modal!
      .attr('class', 'modal rapid-modal modal-poweruser');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();

    // Setup event handlers
    l10n.on('localechange', this.render);
    urlhash.on('hashchange', this.updateFeatureFlags);
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
    const urlhash = context.systems.urlhash!;

    this.emit('done');
    this.Modal = null;

    l10n.off('localechange', this.render);
    urlhash.off('hashchange', this.updateFeatureFlags);
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    if (!this.Modal) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.Modal.$content!;   // legacy render body, typed loosely

    /* Heading */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    // enter
    const $$heading: D3EnterSelection = $heading.enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('div')
      .attr('class', 'modal-heading-icon')
      .append('div')
      .attr('class', 'beta');

    const $$headingText: D3EnterSelection = $$heading
      .append('div')
      .attr('class', 'modal-heading-text');

    $$headingText
      .append('h1');

    const $$description: D3EnterSelection = $$headingText
      .append('div')
      .attr('class', 'modal-heading-desc');

    $$description
      .append('span')
      .attr('class', 'modal-heading-desc-text');

    $$description
      .append('span')
      .attr('class', 'smile')
      .attr('aria-hidden', 'true')
      .text('😎');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading h1')
      .text(l10n.t('rapid_poweruser.heading.label'));

    $heading.selectAll('.modal-heading-desc-text')
      .text(l10n.t('rapid_poweruser.heading.description'));


    /* Features */
    let $features: D3Selection = $content.selectAll('.rapid-feature-rows')
      .data([0]);

    // enter
    const $$features: D3EnterSelection = $features.enter()
      .append('div')
      .attr('class', 'modal-section rapid-feature-rows');

    $features = $features.merge($$features);

    $features
      .call(this.renderFeatures);


    /* OK Button */
    let $buttons: D3Selection= $content.selectAll('.modal-section.buttons')
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
   * Renders the list of feature flag checkboxes into the `.rapid-feature-rows` div.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderFeatures($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    let $rows: D3Selection = $selection.selectAll('.rapid-row-feature')
      .data(this._featureFlags, d => d);

    // enter
    const $$rows: D3EnterSelection = $rows.enter()
      .append('div')
      .attr('class', 'rapid-row rapid-row-feature');

    const $$texts: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-row-text');

    $$texts
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$texts
      .append('div')
      .attr('class', 'rapid-feature-description');

    const $$inputs: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-row-actions');

    const $$checkboxes: D3EnterSelection = $$inputs
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $$checkboxes
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-checkbox-input')
      .on('click', this.toggleFeature);

    $$checkboxes
      .append('div')
      .attr('class', 'rapid-checkbox-custom');


    // update
    $rows = $rows.merge($$rows);

    // localize and style everything...
    $rows.selectAll('.rapid-feature-label')
      .text(d => l10n.t(`rapid_poweruser.${d}.label`));

    $rows.selectAll('.rapid-feature-description')
      .text(d => l10n.t(`rapid_poweruser.${d}.description`));

    $rows.selectAll('.rapid-checkbox-input')
      .property('checked', this.isFeatureEnabled);
  }


  /**
   * On any change in poweruser setting, update the storage for the flags.
   * If user is not currently a poweruser, move all the feature flags to a different storage space.
   * @param  currParams   Map(key -> value) of the current hash parameters
   * @param  prevParams   Map(key -> value) of the previous hash parameters
   */
  public updateFeatureFlags(currParams?: Map<string, string>, prevParams?: Map<string, string>): void {
    let needsUpdate = true;
    if (currParams && prevParams) {
      needsUpdate = currParams.get('poweruser') !== prevParams.get('poweruser');
    }
    if (!needsUpdate) return;

    const context = this.context;
    const urlhash = context.systems.urlhash!;
    const settings = context.systems.settings;

    const isPowerUser = urlhash.getParam('poweruser') === 'true';
    if (!isPowerUser) {
      for (const featureFlag of this._featureFlags) {
        const val = settings?.get(`poweruser.${featureFlag}`);
        if (val) {
          settings?.set(`poweruser.was.${featureFlag}`, val);
          settings?.unset(`poweruser.${featureFlag}`);
        }
      }
    } else {
      for (const featureFlag of this._featureFlags) {
        const val = settings?.get(`poweruser.was.${featureFlag}`);
        if (val) {
          settings?.set(`poweruser.${featureFlag}`, val);
          settings?.unset(`poweruser.was.${featureFlag}`);
        }
      }
    }
  }


  /**
   * Test whether the given feature flag is enabled.
   * @param   featureFlag - the feature flag to test
   * @return  `true` if the flag is enabled, `false` if not
   */
  public isFeatureEnabled(featureFlag: string): boolean {
    const settings = this.context.systems.settings;
    return settings?.get(`poweruser.${featureFlag}`) === 'true';
  }


  /**
   * Toggles the given feature flag between on/off
   * @param  [e] - the triggering event, if any
   * @param  featureFlag - the feature flag to toggle
   */
  public toggleFeature(e?: Event, featureFlag?: string): void {
    const context = this.context;
    const rapid = context.systems.rapid!;
    const settings = context.systems.settings;

    let enabled = settings?.get(`poweruser.${featureFlag}`) === 'true';
    enabled = !enabled;
    settings?.set(`poweruser.${featureFlag}`, String(enabled));

    // custom on-toggle behaviors can go here
    if (featureFlag === 'previewDatasets' && !enabled) {   // if user unchecked previewDatasets feature
      const toRemove = new Set<DatasetID>();
      for (const dataset of rapid.datasets.values()) {
        if (dataset.beta) {
          toRemove.add(dataset.id);
        }
      }
      if (toRemove.size) {
        rapid.removeDatasets(toRemove);
        context.enter('browse');   // return to browse mode (in case something was selected)
      }
    }
  }

}
