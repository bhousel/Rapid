import { uiModal } from './modal.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This is the modal where the user can toggle on and off power user features.
 * It is shown by clicking the "Beta" button in the top menu, if `&poweruser=true` is in the url.
 */
export class UiRapidPowerUserFeatures {
  public context: Context;
  public featureFlags: string[];
  public $modal: any;
  public rerender: () => void;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    const l10n = context.systems.l10n!;
    const urlhash = context.systems.urlhash!;

    this.featureFlags = [
      'autoConnect',
      'previewDatasets',
      'tagnosticRoadCombine',
      'tagSources',
      'showAutoFix',
      'allowLargeEdits'
    ];

    // D3 selections
    this.$modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.renderFeatures = this.renderFeatures.bind(this);
    this.updateFeatureFlags = this.updateFeatureFlags.bind(this);
    this.isFeatureEnabled = this.isFeatureEnabled.bind(this);
    this.toggleFeature = this.toggleFeature.bind(this);

    // Setup event handlers
    l10n.on('localechange', this.rerender);
    urlhash.on('hashchange', this.updateFeatureFlags);
  }


  /**
   * This shows the poweruser features modal if it isn't already being shown.
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const $container = context.container();   // $container is always the parent for a modal

    const isShowing = $container.selectAll('.shaded').size();
    if (isShowing) return;  // a modal is already showing

    this.updateFeatureFlags();

    this.$modal = uiModal($container);

    this.$modal.select('.modal')
      .attr('class', 'modal rapid-modal');

    this.$modal.select('.content')
      .attr('class', 'content poweruser');

    this.render();
  }


  /**
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - `$modal` is always the parent.
   */
  public render(): void {
    // Modals are created at the time when `show()` is first called
    if (!this.$modal) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.$modal.select('.content');

    /* Heading */
    let $heading = $content.selectAll('.modal-section-heading')
      .data([0]);

    // enter
    const $$heading = $heading.enter()
      .append('div')
      .attr('class', 'modal-section-heading');

    $$heading
      .append('h3')
      .attr('class', 'modal-heading');

    const $$description = $$heading
      .append('div')
      .attr('class', 'modal-heading-desc');

    $$description
      .append('span')
      .attr('class', 'modal-heading-desc-text');

    $$description
      .append('span')
      .attr('class', 'smile')
      .text('😎');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading')
      .html(l10n.t('rapid_poweruser.heading.label'));

    $heading.selectAll('.modal-heading-desc-text')
      .text(l10n.t('rapid_poweruser.heading.description'));


    /* Features */
    let $features = $content.selectAll('.rapid-features-container')
      .data([0]);

    // enter
    const $$features = $features.enter()
      .append('div')
      .attr('class', 'modal-section rapid-features-container');

    $features = $features.merge($$features);

    $features
      .call(this.renderFeatures);


    /* OK Button */
    let $buttons = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click', () => this.$modal.close());

    // set focus (but only on enter)
    const buttonNode = $$buttons.selectAll('button').node() as HTMLElement | null;
    if (buttonNode) buttonNode.focus();

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons.selectAll('.button')
      .text(l10n.t('confirm.okay'));
  }


  /**
   * Renders the list of feature flag checkboxes into the `.rapid-features-container` div.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderFeatures($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    let $rows: D3Selection = $selection.selectAll('.rapid-checkbox-feature')
      .data(this.featureFlags, d => d);

    // enter
    const $$rows = $rows.enter()
      .append('div')
      .attr('class', 'rapid-checkbox rapid-checkbox-feature');

    const $$descriptions = $$rows
      .append('div')
      .attr('class', 'rapid-feature');

    $$descriptions
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$descriptions
      .append('div')
      .attr('class', 'rapid-feature-description');

    const $$inputs = $$rows
      .append('div')
      .attr('class', 'rapid-checkbox-inputs');

    const $$checkboxes = $$inputs
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $$checkboxes
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-feature-checkbox')
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

    $rows.selectAll('.rapid-feature-checkbox')
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
      for (const featureFlag of this.featureFlags) {
        const val = settings?.get(`poweruser.${featureFlag}`);
        if (val) {
          settings?.set(`poweruser.was.${featureFlag}`, val);
          settings?.unset(`poweruser.${featureFlag}`);
        }
      }
    } else {
      for (const featureFlag of this.featureFlags) {
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
   * @param  e? - triggering event (if any)
   * @param  featureFlag - the feature flag to toggle
   */
  public toggleFeature(e?: Event, featureFlag?: string): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;
    const settings = context.systems.settings;

    let enabled = settings?.get(`poweruser.${featureFlag}`) === 'true';
    enabled = !enabled;
    settings?.set(`poweruser.${featureFlag}`, String(enabled));

    // custom on-toggle behaviors can go here
    if (featureFlag === 'previewDatasets' && !enabled) {   // if user unchecked previewDatasets feature
      for (const dataset of rapid.datasets.values()) {
        if (dataset.beta) {
          dataset.added = false;
          dataset.enabled = false;
        }
      }
      context.enter('browse');   // return to browse mode (in case something was selected)
      gfx.immediateRedraw();
    }
  }

}
