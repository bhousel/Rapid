import { EventEmitter } from 'tseep/lib/ee-safe';
import { marked } from 'marked';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';


/**
 * `UiRapidAddDataset` is a modal control where the user can
 * add a custom dataset to Rapid.
 *
 * Events available:
 * - `done` - Fires when the user is finished, emits the new datasetID if one was added.
 */
export class UiRapidAddDataset extends EventEmitter {
  public context: Context;

  // Child components
  public Modal: UiModal | null;

  protected _currFileList: FileList | null;
  protected _currUrl: string | null;

  /** The datasetID for the newly added RapidDataset. */
  protected _datasetID: DatasetID | null;
  /** style for the datasetID field (warning class?) */
  protected _datasetIDClass: string | null;
  /** stringID for the datasetID feedback (warning text?) */
  protected _datasetIDStringID: string | null;



  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._currFileList = null;
    this._currUrl = null;
    this._datasetID = null;
    this._datasetIDClass = null;
    this._datasetIDStringID = null;

    // Child components
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._clickedOk = this._clickedOk.bind(this);
    this._clickedCancel = this._clickedCancel.bind(this);
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderFields = this.renderFields.bind(this);
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

//    if (this._datasetID) {
//        // do the thing
//    }

    this.emit('done', this._datasetID);
    this.Modal = null;
    this._currFileList = null;
    this._currUrl = null;
    this._datasetID = null;

    l10n.off('localechange', this.render);
  }


  /**
   * When clicking "cancel", remove any partially entered data, and close.
   * @param [e] - the triggering event, if any
   */
  protected _clickedCancel(e?: Event): void {
    e?.preventDefault();
    this._currFileList = null;
    this._currUrl = null;
    this._datasetID = null;
    this.close();
  }


  /**
   * When clicking "ok", test dataset for validity, create a RapidDataset, then close.
   * @param [e] - the triggering event, if any
   */
  protected _clickedOk(e?: Event): void {
    e?.preventDefault();

    // todo: do the stuff
    this.close();
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
      .text(l10n.t(`${prefix}.heading`));


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
      .property('value', this._currUrl);


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
      .attr('placeholder', l10n.t(`${prefix}.url.placeholder`))
      .property('value', this._currUrl);


    /* OK/Cancel Buttons */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click', this._clickedOk);

    $$buttons
      .append('button')
      .attr('class', 'button cancel-button action')
      .on('click', this._clickedCancel);

    // update
    $buttons = $buttons.merge($$buttons) as D3Selection;

    $buttons.selectAll('.ok-button')
      .classed('disabled', this._datasetIDClass === 'warning')
      .text(l10n.t('text.okay'));

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
    const rapid = context.systems.rapid!;

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
      .call(utilNoAuto);

    $$wraps
      .append('div')
      .attr('class', 'dataset-field-instruction');

    $$wraps
      .append('div')
      .attr('class', 'dataset-field-feedback');

    // Add special handling for the identifier field..
    const $$identifier: D3EnterSelection = $$fields.selectAll('.row-identifier .dataset-field-input');

    // validate input
    $$identifier
      .attr('maxlength', 36)
      .on('input', (e: InputEvent) => {
        const el = e.currentTarget as HTMLInputElement;
        const val = el.value;

        if (val && rapid.catalog.has(val)) {
          this._datasetID = null;
          this._datasetIDClass = 'warning';
          this._datasetIDStringID = `${prefix}.identifier.taken`;

        } else if (val && !/^[\w\-]+$/.test(val)) {
          this._datasetID = null;
          this._datasetIDClass = 'warning';
          this._datasetIDStringID = `${prefix}.identifier.invalid`;

        } else {
          this._datasetID = val;
          this._datasetIDClass = null;
          this._datasetIDStringID = null;
        }

        this.render();
      });

    // set focus on enter
    const $$name: D3EnterSelection = $$fields.selectAll('.row-name .dataset-field-input');
    const inputNode = $$name.node() as HTMLElement | null;
    inputNode?.focus();


    // update
    $fields = $fields.merge($$fields);

    $fields.selectAll('.dataset-field-label')
      .text((d: string) => l10n.t(`${prefix}.${d}.label`));

    $fields.selectAll('.dataset-field-input')
      .attr('placeholder', (d: string) => l10n.t(`${prefix}.${d}.placeholder`));


    $fields.selectAll('.row-identifier .dataset-field-input')
      .classed('warning', this._datasetIDClass === 'warning');

    $fields.selectAll('.row-identifier .dataset-field-instruction')
      .text(l10n.t(`${prefix}.identifier.instruction`));

    // U+26A0 U+FE0F = emoji warning
    // U+00A0 = non breaking space &nbsp;  (we want the div always drawn, so layout doesn't jump around)
    $fields.selectAll('.row-identifier .dataset-field-feedback')
      .classed('warning', this._datasetIDClass === 'warning')
      .text(this._datasetIDStringID ? '\u26a0\ufe0f ' + l10n.t(this._datasetIDStringID) : '\u00a0');

  }

}
