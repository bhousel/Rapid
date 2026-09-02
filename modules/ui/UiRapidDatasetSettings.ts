import { select } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { uiIcon } from './icon.ts';
import { UiCombobox } from './UiCombobox.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidColorpicker } from './UiRapidColorpicker.ts';
import { utilNoAuto, utilSafeURL } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';

const RAPID_MAGENTA = '#da26d3';


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
  id?: DatasetID;
  /** Name */
  name?: string;
  /** Source type */
  sourceID?: string;
  /** Description */
  description?: string;
  /** Source Url */
  sourceUrl?: string;
  /** Thumbnail Url */
  thumbnailUrl?: string;
  /** Color */
  color?: string;
  /** Conflation? */
  conflation?: string;
}


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
  public ThumbnailCombo: UiCombobox;
  public Colorpicker: UiRapidColorpicker;
  public Modal: UiModal | null;

  /** The dataset being setup */
  protected _dataset: RapidDataset | null;
  /** Unique ID for field identifiers */
  protected _uuid: string;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._dataset = null;
    this._uuid = crypto.randomUUID().slice(0, 8);

    // Child components
    this.ThumbnailCombo = new UiCombobox(context, 'rapid-dark');
    this.Colorpicker = new UiRapidColorpicker(context);
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this._checkFields = this._checkFields.bind(this);
    this._clickedOk = this._clickedOk.bind(this);
    this._clickedDelete = this._clickedDelete.bind(this);
    this._done = this._done.bind(this);
    this._renderHeading = this._renderHeading.bind(this);
    this._renderDetails = this._renderDetails.bind(this);
    this._renderFields = this._renderFields.bind(this);
    this._renderThumbnail = this._renderThumbnail.bind(this);
    this._renderConflation = this._renderConflation.bind(this);
    this._renderDictionary = this._renderDictionary.bind(this);
    this._renderButtons = this._renderButtons.bind(this);

    // Setup event handlers
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this.render);
    this.Colorpicker.on('change', this.render);
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

    const $content = this.Modal.$content!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    $content
      .call(this._renderHeading);

    /* Wrapper for main section */
    let $wrap: D3Selection = $content.selectAll('.dataset-settings-wrap')
      .data([0]);

    // enter
    const $$wrap: D3EnterSelection = $wrap
      .enter()
      .append('div')
      .attr('class', 'dataset-settings-wrap');

    // update
    $wrap = $wrap.merge($$wrap);

    $wrap
      .call(this._renderDetails)
      .call(this._renderThumbnail)
      .call(this._renderConflation)
      .call(this._renderDictionary);

    $content
      .call(this._renderButtons);
  }


  /**
   * Renders the heading section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderHeading($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    let $heading: D3Selection = $parent.selectAll('.modal-heading')
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
  }


  /**
   * Renders the details section.
   * This includes the fields and the thumbnail.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderDetails($parent: D3Selection): void {
    let $details: D3Selection = $parent.selectAll('.dataset-details')
      .data([0]);

    // enter
    const $$details: D3EnterSelection = $details
      .enter()
      .append('div')
      .attr('class', 'modal-section dataset-details');

    // update
    $details = $details.merge($$details);

    $details
      .call(this._renderFields)
      .call(this._renderThumbnail);
  }


  /**
   * Renders the fields section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderFields($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    const prefix = 'rapid_dataset_settings.fields';  // prefix for text strings
    const isLocked = !ds.custom;     // Can only change these details for custom datasets
    const uuid = this._uuid;

    let $fields: D3Selection = $parent.selectAll('.dataset-detail-fields')
      .data([0]);

    const $$fields: D3EnterSelection = $fields
      .enter()
      .append('div')
      .attr('class', 'dataset-detail-fields');

    $$fields
      .append('h3')
      .attr('class', 'dataset-details-heading');


    // Create the fields and set `.property('value', …)`
    // to their initial values, gathered from the dataset.
    // We'll avoid D3.js metaprogramming here, as each field has unique needs.

    /* SourceID */
    const $$source: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-source');

    $$source
      .append('label')
      .attr('for', `source-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$source
      .append('input')
      .attr('id', `source-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.serviceID || '');

    /* SourceURL */
    const $$sourceUrl: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-sourceurl');

    $$sourceUrl
      .append('label')
      .attr('for', `sourceurl-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$sourceUrl
      .append('input')
      .attr('id', `sourceurl-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.sourceUrl || '');

    /* DatasetID */
    const $$identifier: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-identifier');

    $$identifier
      .append('label')
      .attr('for', `identifier-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$identifier
      .append('input')
      .attr('id', `identifier-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.id || '');

    /* Name */
    const $$name: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-name');

    $$name
      .append('label')
      .attr('for', `name-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$name
      .append('input')
      .attr('id', `name-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', isLocked)
      .classed('disabled', isLocked)
      .property('value', ds.getLabel() || '')
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    /* Thumbnail URL */
    // Set data for thumbnail combo:  a fixed list of thumbnails + the current value if any.
    const thumbOptions = new Set<string>();
    for (const s of ['buildings', 'footways', 'roads', 'points']) {
      thumbOptions.add(`img/data-${s}.png`);
    }
    if (ds.thumbnailUrl) {
      thumbOptions.add(ds.thumbnailUrl);
    }
    const comboData = [...thumbOptions].map((s: string) => ({ value: s }));
    this.ThumbnailCombo.data(comboData);

    const $$thumbnailUrl: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-thumbnailurl');

    $$thumbnailUrl
      .append('label')
      .attr('for', `thumbnailurl-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$thumbnailUrl
      .append('input')
      .attr('id', `thumbnailurl-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', isLocked)
      .classed('disabled', isLocked)
      .property('value', ds.thumbnailUrl || '');

    if (!isLocked) {   // Add thumbnail url picker, if not locked.
      $$thumbnailUrl.select(`#thumbnailurl-${uuid}`)
        .call(this.ThumbnailCombo.attach)
        .on('change', (e: Event) => this.render());
    }

    /* Description */
    const $$description: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'dataset-field-row row-description');

    $$description
      .append('label')
      .attr('for', `description-${uuid}`)
      .attr('class', 'dataset-field-label');
    $$description
      .append('textarea')
      .attr('id', `description-${uuid}`)
      .attr('class', 'dataset-field-input')
      .call(utilNoAuto)
      .property('disabled', isLocked)
      .classed('disabled', isLocked)
      .property('value', ds.getDescription() || '')
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    // update
    $fields = $fields.merge($$fields);

    $fields.selectAll('.dataset-details-heading')
      .text(l10n.t(`${prefix}.heading`));

    $fields.selectAll('.row-source .dataset-field-label')
      .text(l10n.t(`${prefix}.source.label`));
    $fields.selectAll('.row-sourceurl .dataset-field-label')
      .text(l10n.t(`${prefix}.sourceurl.label`));
    $fields.selectAll('.row-identifier .dataset-field-label')
      .text(l10n.t(`${prefix}.identifier.label`));
    $fields.selectAll('.row-name .dataset-field-label')
      .text(l10n.t(`${prefix}.name.label`));
    $fields.selectAll('.row-thumbnailurl .dataset-field-label')
      .text(l10n.t(`${prefix}.thumbnailurl.label`));
    $fields.selectAll('.row-description .dataset-field-label')
      .text(l10n.t(`${prefix}.description.label`));

    $fields.selectAll(`#name-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.name.placeholder`));
    $fields.selectAll(`#description-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.description.placeholder`));
    $fields.selectAll(`#thumbnailurl-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.thumbnailurl.placeholder`));
  }


  /**
   * Renders the thumbnail section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderThumbnail($parent: D3Selection): void {
    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    let $wrap: D3Selection = $parent.selectAll('.dataset-thumbnail-wrap')
      .data([0]);

    const $$wrap: D3EnterSelection = $wrap
      .enter()
      .append('div')
      .attr('class', 'dataset-thumbnail-wrap');

    $$wrap
      .append('img')
      .attr('class', 'dataset-thumbnail');

    $$wrap
      .append('div')
      .attr('class', 'rapid-colorpicker-wrap')
      .each(() => this.Colorpicker.color = ds.color);  // seed with starting ds.color on enter


    // update
    const fieldInfo = this._checkFields();

    $wrap = $wrap.merge($$wrap);

    $wrap.selectAll('.dataset-thumbnail')
      .classed('inverted', ds.categories.has('esri'))  // invert colors from light->dark
      .on('load', (e: Event) => {  // rewire this on update, so it captures the current fieldInfo closure
        const $selection = select(e.currentTarget as HTMLImageElement);
        const img = $selection.node() as HTMLImageElement;
        const isLoaded = (img.complete && img.naturalWidth !== 0);
        $selection.style('background', () => isLoaded ? fieldInfo.color : null);
      })
      .attr('src', utilSafeURL(fieldInfo.thumbnailUrl));

    $wrap.selectAll('.rapid-colorpicker-wrap')
      .call(this.Colorpicker.render);
  }


  /**
   * Renders the conflation settings section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderConflation($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    const prefix = 'rapid_dataset_settings.conflation';  // prefix for text strings
    const uuid = this._uuid;

    let $conflation: D3Selection = $parent.selectAll('.dataset-conflation')
      .data([0]);

    // enter
    const $$conflation: D3EnterSelection = $conflation
      .enter()
      .append('div')
      .attr('class', 'modal-section dataset-conflation');

    // update
    $conflation = $conflation.merge($$conflation);


    let $fields: D3Selection = $conflation.selectAll('.dataset-detail-fields')
      .data([0]);

    const $$fields: D3EnterSelection = $fields
      .enter()
      .append('div')
      .attr('class', 'dataset-detail-fields');

    $$fields
      .append('h3')
      .attr('class', 'dataset-details-heading');

    const $$rows = $$fields.selectAll('.dataset-field-row')
      .data(['conflation'])     // only one field for now
      .enter()
      .append('div')
      .attr('class', (d: string) => `dataset-field-row row-${d}`);

    $$rows
      .append('label')
      .attr('for', (d: string) => `${d}-${uuid}`)
      .attr('class', 'dataset-field-label');

    $$rows
      .append('input')
      .attr('id', (d: string) => `${d}-${uuid}`)
      .attr('class', 'dataset-field-input')
      .attr('type', 'checkbox')
      .call(utilNoAuto)
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    $$rows.selectAll(`#conflation-${uuid}`)
      .property('checked', !!ds.conflated)
      .property('value', ds.conflated ? 'true' : 'false');

    // update
    $fields = $fields.merge($$fields);

    $fields.selectAll('.dataset-details-heading')
      .text(l10n.t(`${prefix}.heading`));

    $fields.selectAll('.dataset-field-label')
      .text((d: string) => l10n.t(`${prefix}.${d}.label`));
  }


  /**
   * Renders the dictionary section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderDictionary($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // You can only change these details for custom datasets
    const isLocked = !ds.custom;

    /* Data Dictionary */
    let $dictionary: D3Selection = $parent.selectAll('.dataset-dictionary')
      .data([0]);

    // enter
    const $$dictionary: D3EnterSelection = $dictionary
      .enter()
      .append('div')
      .attr('class', 'modal-section dataset-dictionary');

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


  /**
   * Renders the buttons section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderButtons($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    const fieldInfo = this._checkFields();

    /* Ok/Cancel/Delete Buttons */
    let $buttons: D3Selection = $parent.selectAll('.modal-section.buttons')
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
      .on('click', this.close);

    if (ds.custom) {   // only available for custom datasets
      $$buttons
        .append('button')
        .attr('class', 'button delete-button action')
        .on('click', this._clickedDelete);
    }

    // update
    $buttons = $buttons.merge($$buttons) as D3Selection;

    $buttons.selectAll('.ok-button')
      .classed('secondary disabled', !fieldInfo.isOk)
      .text(l10n.t('text.okay'));

    $buttons.selectAll('.cancel-button')
      .text(l10n.t('text.cancel'));

    $buttons.selectAll('.delete-button')
      .text(l10n.t('rapid_dataset_settings.delete_permanently'));

  }


  /**
   * When clicking "Ok", test dataset for validity.  If it all looks ok
   * save everything and close the Modal.
   * If there are problems, `render()` again to surface the errors and return early.
   * @param [e] - the triggering event, if any
   */
  protected _clickedOk(e?: Event): void {
    e?.preventDefault();

    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    const fieldInfo = this._checkFields();
    if (!fieldInfo.isOk) {
      this.render();
      return;
    }

    const context = this.context;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;
    const scene = gfx.scene!;

    // All datasets allow these things to be changed:
    ds.color = fieldInfo.color ?? RAPID_MAGENTA;
    ds.conflated = (fieldInfo.conflation === 'true');

    // Custom datasets allow more things to be changed:
    if (ds.custom) {
      ds.label = fieldInfo.name || '';
      ds.description = fieldInfo.description || '';
      (ds as any)._label = fieldInfo.name!;                       // todo avoid this duplication
      (ds as any)._description = fieldInfo.description || '';     // todo avoid this duplication
      ds.thumbnailUrl = fieldInfo.thumbnailUrl ?? ds.getThumbnail();
    }

    rapid.saveDatasetSettings(ds);  // persist settings

    // need some more things to happen here to trigger redraws..
    // see also UiRapidDatasetToggle changeColor()
    scene.dirtyLayers('rapid');
    gfx.immediateRedraw();
    this.render();

    // In case a Rapid feature is already selected, reselect it to update sidebar too.
    const mode = context.mode;
    if (mode?.id === 'select') {  // new (not legacy) select mode
      const selection = new Map(mode.selectedData);
      context.enter('select', { selection: selection });
    }

    this.close();
  }


  /**
   * Callback when user clicks "Delete".
   * Only a custom dataset can be deleted.
   * @param [e] - the triggering event, if any
   */
  protected _clickedDelete(e?: Event): void {
    e?.preventDefault();

    const ds = this.dataset;
    if (!ds?.custom) return;   // need a dataset to do anything

    const context = this.context;
    const rapid = context.systems.rapid!;
    const settings = context.systems.settings;

    settings?.unset(`rapid.custom.${ds.id}`);
    rapid.catalog.delete(ds.id);
    rapid.removeDatasets(ds.id);
    this.close();
  }


  /**
   * Run all field validations.  Returns an object containing the current field values
   * and information about whether validation has passed or failed.
   * @returns a FieldInfo result set
   */
  protected _checkFields(): FieldInfo {
    const result: FieldInfo = { isOk: false };
    if (!this.Modal) return result;

    const ds = this.dataset;
    if (!ds) return result;   // need a dataset to do anything

    const context = this.context;
    const rapid = context.systems.rapid!;
    const $content = this.Modal.$content!;
    const uuid = this._uuid;

    // check dataset ID
    const idNode = $content.selectAll(`#identifier-${uuid}`).node() as HTMLInputElement | null;
    const idVal = idNode?.value || '';
    const datasetID = idVal.trim();
    const existing = rapid.catalog.get(datasetID);
    if (existing && existing !== ds) {  // id belongs to another dataset
      result.datasetIDStringID = 'rapid_add_dataset.identifier.taken';
    } else if (datasetID && !/^[\w\-]+$/.test(datasetID)) {
      result.datasetIDStringID = 'rapid_add_dataset.identifier.invalid';
    } else {
      result.id = datasetID;
    }

    // check source type
    const sourceNode = $content.selectAll(`#source-${uuid}`).node() as HTMLInputElement | null;
    const sourceVal = sourceNode?.value || '';
    result.sourceID = sourceVal.trim();

    // check source url
    const sourceUrlNode = $content.selectAll(`#sourceurl-${uuid}`).node() as HTMLTextAreaElement | null;
    const sourceUrlVal = sourceUrlNode?.value || '';
    result.sourceUrl = sourceUrlVal.trim();

    // check dataset name
    const nameNode = $content.selectAll(`#name-${uuid}`).node() as HTMLInputElement | null;
    const nameVal = nameNode?.value || '';
    result.name = nameVal.trim();

    // check dataset description
    const descriptionNode = $content.selectAll(`#description-${uuid}`).node() as HTMLTextAreaElement | null;
    const descriptionVal = descriptionNode?.value || '';
    result.description = descriptionVal.trim();

    // check thumbnail url
    const thumbnailUrlNode = $content.selectAll(`#thumbnailurl-${uuid}`).node() as HTMLTextAreaElement | null;
    const thumbnailUrlVal = thumbnailUrlNode?.value || '';
    result.thumbnailUrl = thumbnailUrlVal.trim();

    // check color
    const colorNode = $content.selectAll('.rapid-colorpicker-wrap .colorpicker-input').node() as HTMLInputElement | null;
    const colorVal = colorNode?.value || '';
    result.color = colorVal.trim();

    // check conflation
    const conflationNode = $content.selectAll(`#conflation-${uuid}`).node() as HTMLInputElement | null;
    const conflationVal = conflationNode?.value || '';
    result.conflation = conflationVal.trim() || 'false';

    // required values must be present
    result.isOk = !!(result.id && result.name && result.sourceUrl);
    return result;

  }
}
