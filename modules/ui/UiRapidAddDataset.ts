import { EventEmitter } from 'tseep/lib/ee-safe';
import { marked } from 'marked';
import { RapidDataset } from '../lib/RapidDataset.ts';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidDatasetSettings } from './UiRapidDatasetSettings.ts';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDatasetProps } from '../lib/RapidDataset.ts';


/**
 * The values collected on this screen, along with information about whether
 * the field values are all present and have passed validation.
 */
export interface FieldInfo {
  /* `true` if we can continue (no errors), false if not */
  isOk: boolean
  /* If there is a dataset validation error, the stringID for the error */
  datasetIDStringID?: StringID;

  /** Dataset ID */
  datasetID?: DatasetID;
  /** Dataset Name */
  datasetName?: string;
  /** Dataset Url */
  datasetUrl?: string;
}


/**
 * `UiRapidAddDataset` is a Modal control where the user can add a custom dataset to Rapid.
 * On this screen we collect the "Dataset Name", "Dataset ID", and "Dataset URL".
 * When these fields are acceptable, the user can press "Next" to add the Dataset to the
 * RapidSystem catalog and continue to the Dataset Settings Modal.
 *
 * Events available:
 * - `done` - Fires when the user is finished
 */
export class UiRapidAddDataset extends EventEmitter {
  public context: Context;

  // Child components
  public Modal: UiModal | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // Child components
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._clickedNext = this._clickedNext.bind(this);
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderFields = this.renderFields.bind(this);
    this.checkFields = this.checkFields.bind(this);
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
      .attr('class', 'modal rapid-modal modal-add-dataset');

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
   * When clicking "Next", test dataset for validity.  If it all looks ok,
   * create the RapidDataset and continue to the Dataset Settings Modal.
   * If there are problems just return without doing anything.
   * @param [e] - the triggering event, if any
   */
  protected _clickedNext(e?: Event): void {
    e?.preventDefault();

    const fieldInfo = this.checkFields();
    if (!fieldInfo.isOk) return;  // one last check

    const context = this.context;
    const rapid = context.systems.rapid!;

    // Instantiate the custom dataset and add it to the catalog.
    const props: Partial<RapidDatasetProps> = {
      id: fieldInfo.datasetID,
      label: fieldInfo.datasetName,
      sourceUrl: fieldInfo.datasetUrl,
      custom: true
    };

    const ds = new RapidDataset(context, props);
    rapid.catalog.set(ds.id, ds);
    rapid.enableDatasets(ds.id);  // add it to the menu

    // Continue to the Dataset Settings modal, wire up 'done' handler too.
    const SettingsModal = new UiRapidDatasetSettings(context).once('done', this.close);
    SettingsModal.dataset = ds;
    SettingsModal.show();
  }


  /**
   * Run all field validations.  Returns an object containing the field values
   * and information about whether validation has passed or failed.
   * @returns a FieldInfo result set
   */
  public checkFields(): FieldInfo {
    const result: FieldInfo = { isOk: false };
    if (!this.Modal) return result;

    const context = this.context;
    const rapid = context.systems.rapid!;
    const $content = this.Modal.$content!;

    // check dataset ID
    const idNode = $content.selectAll('.row-identifier .dataset-field-input').node() as HTMLInputElement | null;
    const idVal = idNode?.value || '';
    const datasetID = idVal.trim();
    if (datasetID && rapid.catalog.has(datasetID)) {
      result.datasetIDStringID = 'rapid_add_dataset.identifier.taken';
    } else if (datasetID && !/^[\w\-]+$/.test(datasetID)) {
      result.datasetIDStringID = 'rapid_add_dataset.identifier.invalid';
    } else {
      result.datasetID = datasetID;
    }

    // check dataset name
    const nameNode = $content.selectAll('.row-name .dataset-field-input').node() as HTMLInputElement | null;
    const nameVal = nameNode?.value || '';
    result.datasetName = nameVal.trim();

    // check source url
    const urlNode = $content.selectAll('.field-url').node() as HTMLTextAreaElement | null;
    const urlVal = urlNode?.value || '';
    result.datasetUrl = urlVal.trim();

    // all three must be present
    result.isOk = !!(result.datasetID && result.datasetName && result.datasetUrl);
    return result;
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.Modal.$content!;

    const prefix = 'rapid_add_dataset';  // prefix for text strings
    const accept = [
      '.gpx', 'application/gpx', 'application/gpx+xml',
      '.kml', 'application/vnd.google-earth.kml+xml', 'application/kml', 'application/kml+xml',
      '.geojson', '.json', 'application/geo+json', 'application/json', 'application/vnd.geo+json', 'text/x-json'
    ];

    /* Heading section */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    // enter
    const $$heading: D3EnterSelection = $heading
      .enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('div')
      .attr('class', 'modal-heading-icon')
      .call(uiIcon('#rapid-icon-data', 'icon-30'));

    $$heading
      .append('h1')
      .attr('class', 'modal-heading-text');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading-text')
      .text(l10n.t('rapid_add_dataset.heading'));


    /* Fields section */
    $content
      .call(this.renderFields);


    /* Text section */
    let $textSection: D3Selection = $content.selectAll('.rapid-add-dataset-text')
      .data([0]);

    // enter
    const $$textSection = $textSection.enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-text');

//    $$textSection
//      .append('div')
//      .attr('class', 'instructions-file');
//
//    $$textSection
//      .append('input')
//      .attr('class', 'field-file')
//      .attr('type', 'file')
//      .attr('accept', accept.join())
//      .on('change', (e: Event) => {
//        const files = (e.target as HTMLInputElement).files;
//        if (files?.length) {
//          this._currFileList = files;
//          this._currUrl = '';
//          $textSection.select('.field-url').property('value', '');
//        } else {
//          this._currFileList = null;
//        }
//      });

    $$textSection
      .append('div')
      .attr('class', 'instructions-url');

    $$textSection
      .append('textarea')
      .attr('class', 'field-url')
      .call(utilNoAuto)
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation


    // update
    $textSection = $textSection.merge($$textSection) as D3Selection;

//     const data_instructions = l10n.t(`${prefix}.instructions`);
//     const file_heading = l10n.t(`${prefix}.file.heading`);
//     const file_instructions = l10n.t(`${prefix}.file.instructions`);
//     const file_types = l10n.t(`${prefix}.file.types`);
//     const fileHtml = marked.parse(`
// ${data_instructions}
// &nbsp;<br>
// &nbsp;<br>
// ### ${file_heading}
// ${file_instructions}
// * ${file_types}
// &nbsp;<br>
// &nbsp;<br>
// `);
//
//    $textSection.selectAll('.instructions-file')
//      .html(fileHtml as string);
//
//    $textSection.selectAll('.field-file')
//      .property('files', this._currFileList);  // works for all except IE11
//
//    const data_or = l10n.t(`${prefix}.or`);
    const url_heading = l10n.t(`${prefix}.url.heading`);
    const url_instructions = l10n.t(`${prefix}.url.instructions`);
    const url_tokens = l10n.t(`${prefix}.url.tokens`);
    const url_xyz = l10n.t(`${prefix}.url.xyz`);
    const url_example_file = l10n.t(`${prefix}.url.example_file`);
    const url_example_xyz = l10n.t(`${prefix}.url.example_xyz`);
    const url_example_pmtiles = l10n.t(`${prefix}.url.example_pmtiles`);
    const example = l10n.t('example');

//### ${ data_or }
    const urlHtml = marked.parse(`
### ${url_heading}
${url_instructions}
&nbsp;<br>
&nbsp;<br>
${url_tokens}
* ${url_xyz}
&nbsp;<br>
&nbsp;<br>
#### ${example}
* \`${url_example_file}\`
* \`${url_example_xyz}\`
* \`${url_example_pmtiles}\`
`);

    $textSection.selectAll('.instructions-url')
      .html(urlHtml as string);

    $textSection.selectAll('.field-url')
      .attr('placeholder', l10n.t(`${prefix}.url.placeholder`));


    const fieldInfo = this.checkFields();


    /* Next/Cancel Buttons */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button next-button action')
      .on('click', this._clickedNext);

    $$buttons
      .append('button')
      .attr('class', 'button cancel-button action')
      .on('click', this.close);

    // update
    $buttons = $buttons.merge($$buttons) as D3Selection;

    $buttons.selectAll('.next-button')
      .classed('secondary disabled', !fieldInfo.isOk)
      .text(l10n.t('text.next'));

    $buttons.selectAll('.cancel-button')
      .text(l10n.t('text.cancel'));
  }


  /**
   * Renders the fields section.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderFields($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const prefix = 'rapid_add_dataset';  // prefix for text strings
    const fields = ['name', 'identifier'];

    let $fields: D3Selection = $selection.selectAll('.rapid-add-dataset-fields')
      .data([0]);

    // enter
    const $$fields: D3EnterSelection = $fields
      .enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-fields');

    const $$rows = $$fields.selectAll('.dataset-field-row')
      .data(fields)
      .enter()
      .append('div')
      .attr('class', (d: string) => `dataset-field-row row-${d}`);

    const $$wraps: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'dataset-field-wrap');

    $$wraps
      .append('label')
      .attr('for', (d: string) => `dataset-field-${d}`)
      .attr('class', 'dataset-field-label');

    $$wraps
      .append('input')
      .attr('id', (d: string) => `dataset-field-${d}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    $$wraps
      .append('div')
      .attr('class', 'dataset-field-instruction');

    $$wraps
      .append('div')
      .attr('class', 'dataset-field-feedback');

    // Add special handling for the identifier field..
    const $$identifier: D3EnterSelection = $$fields.selectAll('.row-identifier .dataset-field-input');
    $$identifier
      .attr('maxlength', 36);

    // set focus on enter
    const $$name: D3EnterSelection = $$fields.selectAll('.row-name .dataset-field-input');
    const inputNode = $$name.node() as HTMLElement | null;
    inputNode?.focus();


    // update
    $fields = $fields.merge($$fields);

    const fieldInfo = this.checkFields();

    $fields.selectAll('.dataset-field-label')
      .text((d: string) => l10n.t(`${prefix}.${d}.label`));

    $fields.selectAll('.dataset-field-input')
      .attr('placeholder', (d: string) => l10n.t(`${prefix}.${d}.placeholder`));

    $fields.selectAll('.row-identifier .dataset-field-input')
      .classed('warning', !!fieldInfo.datasetIDStringID);

    $fields.selectAll('.row-identifier .dataset-field-instruction')
      .text(l10n.t(`${prefix}.identifier.instruction`));

    // U+26A0 U+FE0F = emoji warning
    // U+00A0 = non breaking space &nbsp;  (we want the div always drawn, so layout doesn't jump around)
    $fields.selectAll('.row-identifier .dataset-field-feedback')
      .classed('warning', !!fieldInfo.datasetIDStringID)
      .text(fieldInfo.datasetIDStringID ? '\u26a0\ufe0f ' + l10n.t(fieldInfo.datasetIDStringID) : '\u00a0');
  }
}
