import { EventEmitter } from 'tseep/lib/ee-safe';
import { select } from 'd3-selection';
import { icon } from './intro/helper.ts';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidAddDataset } from './UiRapidAddDataset.ts';
import { UiRapidCatalog } from './UiRapidCatalog.ts';
import { UiRapidColorpicker } from './UiRapidColorpicker.ts';
import { UiRapidDatasetSettings } from './UiRapidDatasetSettings.ts';
import { utilCmd } from '../util/cmd.ts';
import { utilSafeURL } from '../util/url.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';


/**
 * This is the Modal where the user can toggle on and off datasets.
 * It is shown by clicking the main "Rapid" button in the top menu.
 *
 * Events available:
 * - `done`:  Fires when the user is finished and they are closing this Modal
 *
 * @example
 * <div class='modal rapid-modal'>
 *   <button class='close'/>
 *   <div class='content'>
 *     <div class='modal-section rapid-toggle-all'/>       // "Toggle All Rapid Features"
 *     <div class='rapid-datasets-container'> … </div>     //   …list of datasets…
 *     <div class='modal-section rapid-browse-catalog'/>   // "Browse Data Catalog"
 *     <div class='modal-section rapid-add-custom-data'/>  // "Add Custom Data"
 *     <div class='modal-section buttons'/>                // "OK" button
 *   </div>
 * </div>
 */
export class UiRapidDatasetToggle extends EventEmitter {
  public context: Context;

  // Child components
  public Modal: UiModal | null;
  protected _colorpickers: Record<DatasetID, UiRapidColorpicker>;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // Child components
    this.Modal = null;
    this._colorpickers = {};

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderDatasets = this.renderDatasets.bind(this);
    this.changeColor = this.changeColor.bind(this);
    this.toggleDataset = this.toggleDataset.bind(this);
    this.toggleRapid = this.toggleRapid.bind(this);
  }


  /**
   * This shows the datataset modal if it isn't already being shown.
   * For a Modal component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    if (this.Modal?.isShown) return;  // already showing

    this.Modal = new UiModal(context).show();
    this.Modal.$modal!
      .attr('class', 'modal rapid-modal');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();

    // Setup event handlers
    scene.on('layerchange', this.render);
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
    const scene = context.systems.gfx!.scene!;

    this.emit('done');
    this.Modal = null;
    this._colorpickers = {};

    scene.off('layerchange', this.render);
    l10n.off('localechange', this.render);
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    if (!this.Modal) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;
    const rtl = l10n.isRTL ? '-rtl' : '';
    const isRapidEnabled = scene.layers.get('rapid')?.enabled;
    const $content = this.Modal.$content!;

    /* Toggle All */
    let $toggleAll: D3Selection = $content.selectAll('.rapid-toggle-all')
      .data([0]);

    // enter
    const $$toggleAll: D3EnterSelection = $toggleAll
      .enter()
      .append('div')
      .attr('class', 'modal-section rapid-checkbox rapid-toggle-all');

    const $$toggleAllText: D3EnterSelection = $$toggleAll
      .append('div')
      .attr('class', 'rapid-feature-label-container');

    $$toggleAllText
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$toggleAllText
      .append('span')
      .attr('class', 'rapid-feature-hotkey');

    const $$toggleAllLabel: D3EnterSelection = $$toggleAll
      .append('div')
      .attr('class', 'rapid-checkbox-inputs')
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $$toggleAllLabel
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-feature-checkbox')
      .on('click', this.toggleRapid);

    $$toggleAllLabel
      .append('div')
      .attr('class', 'rapid-checkbox-custom');

    // update
    $toggleAll = $toggleAll.merge($$toggleAll);

    $toggleAll.selectAll('.rapid-feature-label')
      .html(l10n.t('rapid_menu.toggle_all', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'logo-rapid')
      }));

    const toggleKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_rapid_data.key'));
    $toggleAll.selectAll('.rapid-feature-hotkey')
      .text('(' + toggleKey + ')');

    $toggleAll.selectAll('.rapid-feature-checkbox')
      .property('checked', isRapidEnabled);


    /* Dataset List */
    let $datasets: D3Selection = $content.selectAll('.rapid-datasets-container')
      .data([0]);

    // enter
    const $$datasets: D3EnterSelection = $datasets.enter()
      .append('div')
      .attr('class', 'modal-section rapid-datasets-container');

    // update
    $datasets = $datasets.merge($$datasets);

    $datasets
      .call(this.renderDatasets);


    /* Browse Data Catalog */
    let $catalogOption: D3Selection = $content.selectAll('.rapid-browse-catalog')
      .data([0]);

    // enter
    const $$catalogOption: D3EnterSelection = $catalogOption.enter()
      .append('div')
      .attr('class', 'modal-section rapid-checkbox rapid-browse-catalog')
      .on('click', () => {
        const CatalogModal = new UiRapidCatalog(context).on('done', this.render);
        CatalogModal.show();
      });

    $$catalogOption
      .append('div')
      .attr('class', 'rapid-feature-label-container')
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$catalogOption
      .append('div')
      .attr('class', 'rapid-checkbox-inputs')
      .append('div')
      .attr('class', 'rapid-checkbox-label')
      .call(uiIcon('', 'icon-30'));

    // update
    $catalogOption = $catalogOption.merge($$catalogOption);

    $catalogOption.selectAll('.rapid-feature-label')
      .text(l10n.t('rapid_menu.browse_data_catalog'));

    $catalogOption.selectAll('.rapid-checkbox-label use')
      .attr('xlink:href', l10n.isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward');


    /* Add Custom Data */
    let $addCustomOption: D3Selection = $content.selectAll('.rapid-add-custom-data')
      .data([0]);

    // enter
    const $$addCustomOption: D3EnterSelection = $addCustomOption.enter()
      .append('div')
      .attr('class', 'modal-section rapid-checkbox rapid-add-custom-data')
      .on('click', () => {
        const AddDatasetModal = new UiRapidAddDataset(context).on('done', this.render);
        AddDatasetModal.show();
      });

    $$addCustomOption
      .append('div')
      .attr('class', 'rapid-feature-label-container')
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$addCustomOption
      .append('div')
      .attr('class', 'rapid-checkbox-inputs')
      .append('div')
      .attr('class', 'rapid-checkbox-label')
      .call(uiIcon('', 'icon-30'));

    // update
    $addCustomOption = $addCustomOption.merge($$addCustomOption);

    $addCustomOption.selectAll('.rapid-feature-label')
      .text(l10n.t('rapid_menu.add_custom_data'));

    $addCustomOption.selectAll('.rapid-checkbox-label use')
      .attr('xlink:href', l10n.isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward');


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

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons.selectAll('.button')
      .text(l10n.t('confirm.okay'));
  }


  /**
   * Renders the list of active datasets into the `.rapid-datasets-container` div.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderDatasets($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const rapid = context.systems.rapid!;
    const scene = context.systems.gfx!.scene!;
    const settings = context.systems.settings;

    const isRapidEnabled = scene.layers.get('rapid')?.enabled;
    const showPreview = settings?.get('poweruser.previewDatasets') === 'true';
    const datasets = [...rapid.datasets.values()]
      .filter(d => d.added && (showPreview || !d.beta));    // exclude preview datasets unless user has opted into them

    let $rows: D3Selection = $selection.selectAll('.rapid-checkbox-dataset')
      .data(datasets, (d: RapidDataset) => d.id);

    // exit
    $rows.exit()
      .each((d: RapidDataset) => {
        const control = this._colorpickers[d.id];
        control?.close();
        delete this._colorpickers[d.id];
      })
      .remove();

    // enter
    const $$rows: D3EnterSelection = $rows.enter()
      .append('div')
      .attr('class', 'rapid-checkbox rapid-checkbox-dataset');

    const $$label: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-feature');

    // line1: name and optional beta badge
    const $$line1: D3EnterSelection = $$label
      .append('div')
      .attr('class', 'rapid-feature-label-container');

    $$line1
      .append('div')
      .attr('class', 'rapid-feature-label');

    $$line1
      .filter((d: RapidDataset) => d.beta)
      .append('div')
      .attr('class', 'rapid-feature-label-beta beta');

    // line2:  extent and license link
    const $$line2: D3EnterSelection = $$label
      .append('div')
      .attr('class', 'rapid-feature-extent-container');

    $$line2
      .each((d: RapidDataset, i: number, nodes: HTMLElement[]) => {
        const $$extent: D3EnterSelection = select(nodes[i]);

        // if the data spans more than 100°*100°, it might as well be worldwide
        if (d.extent && d.extent.area() < 10000) {
          $$extent
            .append('a')
            .attr('class', 'rapid-feature-extent-center-map')
            .attr('href', '#')
            .on('click', (e: Event) => {
              e.preventDefault();
              map.extent(d.extent);
            });
        } else {
          $$extent
            .append('span')
            .attr('class', 'rapid-feature-extent-worldwide');
        }
      });

    const $$license: D3EnterSelection = $$line2
      .filter((d: RapidDataset) => !!d.licenseUrl);

    $$license
      .append('div')
      .attr('class', 'rapid-feature-label-divider');

    const $$link: D3EnterSelection = $$license
      .append('div')
      .attr('class', 'rapid-feature-license')
      .append('a')
      .attr('class', 'rapid-feature-licence-link')
      .attr('target', '_blank')
      .attr('href', (d: RapidDataset) => utilSafeURL(d.licenseUrl));

    $$link
      .append('span')
      .attr('class', 'rapid-feature-license-link-text');

    $$link
      .call(uiIcon('#rapid-icon-out-link', 'inline'));


    const $$inputs: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-checkbox-inputs');

    const $$colorpickers: D3EnterSelection = $$inputs
      .append('label')
      .attr('class', 'rapid-colorpicker-label');

    $$colorpickers.each((d: RapidDataset) => {
      const control = new UiRapidColorpicker(context);
      control.on('change', (val: string) => this.changeColor(d, val));
      this._colorpickers[d.id] = control;
    });

    const $$settings: D3EnterSelection = $$inputs
      .append('label')
      .attr('class', 'rapid-settings-label');

    $$settings
      .append('div')
      .attr('class', 'rapid-feature-settings')
      .on('click', (e: Event, d: RapidDataset) => {
        const SettingsModal = new UiRapidDatasetSettings(context).on('done', this.render);
        SettingsModal.dataset = d;
        SettingsModal.show();
      })
      .append('div')
      .attr('class', 'rapid-settings-icon')
      .call(uiIcon('#fas-gear'));

    const $$checkboxes: D3EnterSelection = $$inputs
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $$checkboxes
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-feature-checkbox')
      .on('click', this.toggleDataset);

    $$checkboxes
      .append('div')
      .attr('class', 'rapid-checkbox-custom');


    // update
    $rows = $rows.merge($$rows);

    $rows
      .classed('disabled', !isRapidEnabled);

    // localize and style everything...
    $rows.selectAll('.rapid-feature-label')
      .text(d => d.getLabel());

    $rows.selectAll('.rapid-feature-label-beta')
      .attr('title', l10n.t('rapid_poweruser.beta'));   // alt text

    $rows.selectAll('.rapid-feature-description')
      .text(d => d.description);

    $rows.selectAll('.rapid-feature-license-link-text')
      .text(l10n.t('rapid_menu.license'));

    $rows.selectAll('.rapid-feature-extent-center-map')
      .text(l10n.t('rapid_menu.center_map'));

    $rows.selectAll('.rapid-feature-extent-worldwide')
      .text(l10n.t('rapid_menu.worldwide'));

    $rows.selectAll('.rapid-colorpicker-label')
      .attr('disabled', isRapidEnabled ? null : true)
      .each((d: RapidDataset, i: number, nodes: HTMLElement[]) => {
        const $selection: D3Selection = select(nodes[i]);
        const control = this._colorpickers[d.id];
        if (control) {
          control.color = d.color;
          $selection.call(control.render);
        }
      });

    $rows.selectAll('.rapid-checkbox-label')
      .classed('disabled', !isRapidEnabled);

    $rows.selectAll('.rapid-feature-checkbox')
      .property('checked', (d: RapidDataset) => d.enabled)
      .attr('disabled', isRapidEnabled ? null : true);
  }


  /**
   * Called when a user has clicked the checkbox to toggle all Rapid layers on/off.
   * @param [e] - the triggering event, if any
   */
  public toggleRapid(): void {
    const scene = this.context.systems.gfx!.scene!;
    scene.toggleLayers('rapid');
  }


  /**
   * Called when a user has clicked the checkbox to toggle a dataset on/off.
   * @param  [e] - the triggering event, if any
   * @param  d - bound datum (the RapidDataset in this case)
   */
  public toggleDataset(e: Event, d: RapidDataset): void {
    const context = this.context;
    const rapid = context.systems.rapid!;

    context.enter('browse');   // return to browse mode (in case something was selected)
    rapid.toggleDatasets(d.id);
  }


  /**
   * Called when a user has selected a color with the colorpicker
   * @param  dataset  - the RapidDataset to update
   * @param  color    - hexstring for the color e.g. '#da26d3'
   */
  public changeColor(dataset: RapidDataset, color: string): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const scene = gfx.scene!;

    dataset.color = color;

    scene.dirtyLayers(['rapid', 'rapidoverlay']);
    gfx.immediateRedraw();
    this.render();

    // In case a Rapid feature is already selected, reselect it to update sidebar too
    const mode = context.mode;
    if (mode?.id === 'select') {  // new (not legacy) select mode
      const selection = new Map(mode.selectedData);
      context.enter('select', { selection: selection });
    }
  }

}
