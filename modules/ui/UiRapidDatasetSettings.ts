import { select } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { RapidDataDictionary } from '../lib/RapidDataDictionary.ts';
import { uiIcon } from './icon.ts';
import { UiCombobox } from './UiCombobox.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidColorpicker } from './UiRapidColorpicker.ts';
import { utilHashcode } from '@rapid-sdk/util';
import { utilNoAuto, utilSafeURL } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { RapidDataTransform } from '../lib/RapidDataDictionary.ts';

const RAPID_MAGENTA = '#da26d3';


/**
 * We create a "partial" type because on this screen the values may not be filled in completely.
 * The 'order' and 'key' fields are guaranteed by running the transforms through `_checkDictionary` */
interface PartialDataTransform extends Partial<RapidDataTransform> {
  /** Unique row identifier for the html table */
  uuid?:  string | undefined;
}

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
  conflation?: boolean;
}

/**
 * Information about the dictionary, along with information about whether
 * the field values are all present and have passed validation.
 */
export interface DictionaryInfo {
  /* `true` if we can continue (no errors), false if not */
  isOk: boolean
  /* `true` if this is a "default" dictionary that simply copies all source data to target tags */
  isDefault: boolean
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
  public AreYouSureModal: UiModal | null;

  /** The dataset being setup */
  protected _dataset: RapidDataset | null;
  /** A copy of the dataset dictionary transforms */
  protected _transforms: PartialDataTransform[] | null;
  /** Unique ID for field identifiers */
  protected _uuid: string;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._dataset = null;
    this._transforms = null;
    this._uuid = crypto.randomUUID().slice(0, 8);

    // Child components
    this.ThumbnailCombo = new UiCombobox(context, 'rapid-dark');
    this.Colorpicker = new UiRapidColorpicker(context);
    this.Modal = null;
    this.AreYouSureModal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this._checkFields = this._checkFields.bind(this);
    this._clickedOk = this._clickedOk.bind(this);
    this._clickedDelete = this._clickedDelete.bind(this);
    this._clickedIAmSure = this._clickedIAmSure.bind(this);
    this._done = this._done.bind(this);

    this._renderHeading = this._renderHeading.bind(this);
    this._renderDetails = this._renderDetails.bind(this);
    this._renderFields = this._renderFields.bind(this);
    this._renderThumbnail = this._renderThumbnail.bind(this);
    this._renderConflation = this._renderConflation.bind(this);
    this._renderDictionary = this._renderDictionary.bind(this);
    this._renderButtons = this._renderButtons.bind(this);
    this._renderAreYouSure = this._renderAreYouSure.bind(this);

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
    this.AreYouSureModal?.close();
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
    this.AreYouSureModal = null;
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

    const prefix = 'rapid_dataset_settings.details';  // prefix for text strings
    const isLocked = !ds.custom;     // Can only change these details for custom datasets
    const uuid = this._uuid;

    let $wrap: D3Selection = $parent.selectAll('.dataset-details-wrap')
      .data([0]);

    const $$wrap: D3EnterSelection = $wrap
      .enter()
      .append('div')
      .attr('class', 'dataset-details-wrap');

    $$wrap
      .append('h3')
      .attr('class', 'dataset-details-heading');


    // Create the fields and set `.property('value', …)`
    // to their initial values, gathered from the dataset.
    // We'll avoid D3.js metaprogramming here, as each field has unique needs.

    /* SourceID */
    const $$source: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-source');

    $$source
      .append('label')
      .attr('for', `source-${uuid}`)
      .attr('class', 'field-label');
    $$source
      .append('input')
      .attr('id', `source-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.serviceID || '');

    /* SourceURL */
    const $$sourceUrl: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-sourceurl');

    $$sourceUrl
      .append('label')
      .attr('for', `sourceurl-${uuid}`)
      .attr('class', 'field-label');
    $$sourceUrl
      .append('input')
      .attr('id', `sourceurl-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.sourceUrl || '');

    /* DatasetID */
    const $$identifier: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-identifier');

    $$identifier
      .append('label')
      .attr('for', `identifier-${uuid}`)
      .attr('class', 'field-label');
    $$identifier
      .append('input')
      .attr('id', `identifier-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .property('disabled', true)
      .classed('disabled', true)
      .property('value', ds.id || '');

    /* Name */
    const $$name: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-name');

    $$name
      .append('label')
      .attr('for', `name-${uuid}`)
      .attr('class', 'field-label');
    $$name
      .append('input')
      .attr('id', `name-${uuid}`)
      .attr('class', 'field-input')
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

    const $$thumbnailUrl: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-thumbnailurl');

    $$thumbnailUrl
      .append('label')
      .attr('for', `thumbnailurl-${uuid}`)
      .attr('class', 'field-label');
    $$thumbnailUrl
      .append('input')
      .attr('id', `thumbnailurl-${uuid}`)
      .attr('class', 'field-input')
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
    const $$description: D3EnterSelection = $$wrap
      .append('div')
      .attr('class', 'field-row row-description');

    $$description
      .append('label')
      .attr('for', `description-${uuid}`)
      .attr('class', 'field-label');
    $$description
      .append('textarea')
      .attr('id', `description-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .property('disabled', isLocked)
      .classed('disabled', isLocked)
      .property('value', ds.getDescription() || '')
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    // update
    $wrap = $wrap.merge($$wrap);

    $wrap.selectAll('.dataset-details-heading')
      .text(l10n.t(`${prefix}.heading`));

    $wrap.selectAll('.row-source .field-label')
      .text(l10n.t(`${prefix}.fields.source.label`));
    $wrap.selectAll('.row-sourceurl .field-label')
      .text(l10n.t(`${prefix}.fields.sourceurl.label`));
    $wrap.selectAll('.row-identifier .field-label')
      .text(l10n.t(`${prefix}.fields.identifier.label`));
    $wrap.selectAll('.row-name .field-label')
      .text(l10n.t(`${prefix}.fields.name.label`));
    $wrap.selectAll('.row-thumbnailurl .field-label')
      .text(l10n.t(`${prefix}.fields.thumbnailurl.label`));
    $wrap.selectAll('.row-description .field-label')
      .text(l10n.t(`${prefix}.fields.description.label`));

    $wrap.selectAll(`#name-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.fields.name.placeholder`));
    $wrap.selectAll(`#description-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.fields.description.placeholder`));
    $wrap.selectAll(`#thumbnailurl-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.fields.thumbnailurl.placeholder`));
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

    $$conflation
      .append('h3')
      .attr('class', 'conflation-heading');

    $$conflation
      .append('div')
      .attr('class', 'conflation-instructions');

    // Render the conflation fields
    const $$rows = $$conflation.selectAll('.field-row')
      .data(['conflation'])     // only one field for now
      .enter()
      .append('div')
      .attr('class', (d: string) => `field-row row-${d}`);

    $$rows
      .append('label')
      .attr('for', (d: string) => `${d}-${uuid}`)
      .attr('class', 'field-label');

    $$rows
      .append('input')
      .attr('id', (d: string) => `${d}-${uuid}`)
      .attr('class', 'field-input')
      .attr('type', 'checkbox')
      .call(utilNoAuto)
      .on('input', (e: InputEvent) => this.render());  // rerendering will also run validation

    $$rows.selectAll(`#conflation-${uuid}`)
      .property('checked', !!ds.conflated)
      .property('value', ds.conflated ? 'true' : 'false');

    // update
    $conflation = $conflation.merge($$conflation);

    $conflation.selectAll('.conflation-heading')
      .text(l10n.t(`${prefix}.heading`));
    $conflation.selectAll('.conflation-instructions')
      .text(l10n.t(`${prefix}.instruction`));

    $conflation.selectAll('.field-label')
      .text((d: string) => l10n.t(`${prefix}.${d}.label`));
  }


  /**
   * Renders the dictionary section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderDictionary($parent: D3Selection): void {
    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    const context = this.context;
    const l10n = context.systems.l10n!;

    const prefix = 'rapid_dataset_settings.dictionary';  // prefix for text strings
    const isLocked = !ds.custom;     // Can only change these details for custom datasets

    // Check the data dictionary (this also makes a copy before changing anything).
    const dictInfo = this._checkDictionary();
    const transforms = this._transforms!;
    const hasTransforms = transforms.length > 0;

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
      .attr('class', 'dictionary-instructions-wrap');

    // update
    $dictionary = $dictionary.merge($$dictionary);

    $dictionary.selectAll('.dataset-dictionary-heading')
      .text(l10n.t(`${prefix}.heading`));


    // Render the data dictionary instructions..
    // Replace content on each render (makes control flow and localization easier)
    const $instructionsWrap: D3Selection = $dictionary.selectAll('.dictionary-instructions-wrap');
    $instructionsWrap.html('');  // clear

    $instructionsWrap
      .append('div')
      .text(l10n.t(`${prefix}.instruction`));

    if (isLocked) {
      const providerStringID = (
        ds.serviceID === 'esri' ? 'rapid_catalog.category.esri' :
        ds.serviceID === 'mapwithai' ? 'rapid_catalog.category.meta' :
        ds.serviceID === 'overture' ? 'rapid_catalog.category.overture' :
        'text.unknown'
      );
      $instructionsWrap
        .append('div')
        .text(l10n.t(`${prefix}.locked`, { name: l10n.t(providerStringID) }));
    }

    if (!hasTransforms) {
      $instructionsWrap
        .append('div')
        .text(l10n.t(`${prefix}.is_missing`));

      if (!isLocked) {
        $instructionsWrap
          .append('div')
          .text(l10n.t(`${prefix}.add_data_mapping`));

        const $list: D3Selection = $instructionsWrap
          .append('ul');

        $list
          .append('li')
          .append('a')
          .attr('href', '#')
          .on('click', (e: PointerEvent) => {
            e.preventDefault();
            this._createDefaultMapping();
            this.render();
          })
          .text(l10n.t(`${prefix}.default_data_mapping`));

        $list
          .append('li')
          .append('a')
          .attr('href', '#')
          .on('click', (e: PointerEvent) => {
            e.preventDefault();
            this._detectDataMapping();
            this.render();
          })
          .text(l10n.t(`${prefix}.detect_data_mapping`));
      }

    } else if (dictInfo.isDefault) {
      $instructionsWrap
        .append('div')
        .text(l10n.t(`${prefix}.is_default`));
    }


    // Render the data dictionary table..
    let $table: D3Selection = $dictionary.selectAll('.dictionary-table')
      .data(hasTransforms ? [0] : []);

    // exit
    $table.exit()
      .remove();

    // enter
    const $$table: D3EnterSelection = $table.enter()
      .append('table')
      .attr('class', 'dictionary-table')
      .classed('disabled', isLocked);

    /* Table Heading */
    const $$headRow: D3EnterSelection = $$table
      .append('thead')
      .append('tr');

    $$headRow
      .append('th')
      .attr('class', 'dict-order shrink');
    $$headRow
      .append('th')
      .attr('class', 'dict-isid shrink');
    $$headRow
      .append('th')
      .attr('class', 'dict-source');
    $$headRow
      .append('th')
      .attr('class', 'dict-function');
    $$headRow
      .append('th')
      .attr('class', 'dict-target');
    $$headRow
      .append('th')
      .attr('class', 'dict-params');

    if (!isLocked) {
      $$headRow
        .append('th')
        .attr('class', 'dict-actions shrink');
    }

    /* Table Body */
    $$table
      .append('tbody');

    /* Table Footer */
    if (!isLocked) {   // Add "Add More", "Remove All" buttons, if not locked.
      const $$tableActions: D3EnterSelection = $$table
        .append('tfoot')
        .append('tr')
        .append('td')
        .attr('colspan', '9999');   // span all columns

      $$tableActions
        .append('button')
        .attr('class', 'minor dict-add-more')
        .on('click', (e: PointerEvent) => {
          (e?.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
          this._transforms!.push({ order: 9999 } as PartialDataTransform);
          this.render();
        });

      $$tableActions
        .append('button')
        .attr('class', 'minor dict-remove-all')
        .on('click', (e: PointerEvent) => {
          (e?.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
          this._transforms = [];
          this.render();
        });
    }

    // update
    $table = $table.merge($$table);

    $table.selectAll('thead th.dict-order')
      .text(l10n.t(`${prefix}.fields.order.label`));
    $table.selectAll('thead th.dict-isid')
      .text(l10n.t(`${prefix}.fields.isid.label`));
    $table.selectAll('thead th.dict-source')
      .text(l10n.t(`${prefix}.fields.source.label`));
    $table.selectAll('thead th.dict-function')
      .text(l10n.t(`${prefix}.fields.function.label`));
    $table.selectAll('thead th.dict-target')
      .text(l10n.t(`${prefix}.fields.target.label`));
    $table.selectAll('thead th.dict-params')
      .text(l10n.t(`${prefix}.fields.params.label`));

    $table.selectAll('tfoot .dict-add-more')
      .text(l10n.t(`${prefix}.add_more`));
    $table.selectAll('tfoot .dict-remove-all')
      .text(l10n.t(`${prefix}.remove_all`));


    // Render the rows of the table..
    const $tbody: D3Selection = $table.selectAll('tbody');
    let $rows: D3Selection = $tbody.selectAll('.dict-row')
      .data(transforms, (d: PartialDataTransform) => d.uuid!);

    // exit
    $rows.exit()
      .remove();

    // enter
    const $$rows: D3EnterSelection = $rows
      .enter()
      .append('tr')
      .attr('class', 'dict-row');

    $$rows
      .append('td')
      .attr('class', 'dict-order');

    $$rows
      .append('td')
      .attr('class', 'dict-isid')
      .append('input')
      .attr('id', (d: PartialDataTransform) => `dict-isid-${d.uuid}`)
      .attr('class', 'field-input')
      .attr('type', 'checkbox')
      .call(utilNoAuto)
      .on('change', (e: Event, d: PartialDataTransform) => {
        const isChecked = (e.currentTarget as HTMLInputElement).checked;
        for (const row of this._transforms!) {  // uncheck all other rows
          row.isID = (isChecked && row.uuid === d.uuid);
        }
        this.render();  // rerendering will also run validation
      });

    $$rows
      .append('td')
      .attr('class', 'dict-source')
      .append('input')
      .attr('id', (d: PartialDataTransform) => `dict-source-${d.uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .on('change', (e: Event, d: PartialDataTransform) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        const row = this._transforms!.find(row => row.uuid === d.uuid);
        if (row) row.source = val;
        this.render();  // rerendering will also run validation
      });

    $$rows
      .append('td')
      .attr('class', 'dict-function')
      .append('input')
      .attr('id', (d: PartialDataTransform) => `dict-function-${d.uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .each((d: PartialDataTransform, i: number, nodes: ArrayLike<HTMLInputElement>) => {
        const comboData = ['ignore','copy','constant'].map((s: string) => ({ value: s }));
        const combo = new UiCombobox(context, 'rapid-dark').data(comboData);
        select(nodes[i])
          .call(combo.attach)
          .on('change', (e: Event, d: PartialDataTransform) => {
            const val = (e.currentTarget as HTMLInputElement).value;
            const row = this._transforms!.find(row => row.uuid === d.uuid);
            if (row) row.function = val;
            this.render();  // rerendering will also run validation
          });
      });

    $$rows
      .append('td')
      .attr('class', 'dict-target')
      .append('input')
      .attr('id', (d: PartialDataTransform) => `dict-target-${d.uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .on('change', (e: Event, d: PartialDataTransform) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        const row = this._transforms!.find(row => row.uuid === d.uuid);
        if (row) row.target = val;
        this.render();  // rerendering will also run validation
      });

    $$rows
      .append('td')
      .attr('class', 'dict-params')
      .append('input')
      .attr('id', (d: PartialDataTransform) => `dict-params-${d.uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .on('change', (e: Event, d: PartialDataTransform) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        const row = this._transforms!.find(row => row.uuid === d.uuid);
        if (row) row.params = val;
        this.render();  // rerendering will also run validation
      });

    if (!isLocked) {
      const $$actions: D3EnterSelection = $$rows
        .append('td')
        .attr('class', 'dict-actions')
        .append('div')
        .attr('class', 'rapid-row-actions');

      $$actions
        .append('label')
        .attr('class', 'dict-action-trash rapid-row-action')
        .on('click', (e: PointerEvent, d: PartialDataTransform) => {
          e.preventDefault();
          this._transforms = this._transforms!
            .filter((row: PartialDataTransform) => row.uuid !== d.uuid);   // remove current row
          this.render();
        })
        .call(uiIcon('#fas-xmark'));
    }

    // update
    $rows = $rows.merge($$rows).order();

    $rows.selectAll('.dict-order')
      .text((d: PartialDataTransform) => d.order);

    $rows.selectAll('.dict-isid .field-input')
      .property('disabled', (d: PartialDataTransform) => isLocked || d.source === '*')
      .classed('disabled', (d: PartialDataTransform) => isLocked || d.source === '*')
      .property('checked', (d: PartialDataTransform) => d.isID)
      .property('value', (d: PartialDataTransform) => d.isID ? 'true': 'false');

    $rows.selectAll('.dict-source .field-input')
      .property('disabled', (d: PartialDataTransform) => isLocked || d.function === 'constant')
      .classed('disabled', (d: PartialDataTransform) => isLocked || d.function === 'constant')
      .property('value', (d: PartialDataTransform) => d.source);

    $rows.selectAll('.dict-function .field-input')
      .property('disabled', isLocked)
      .classed('disabled', isLocked)
      .property('value', (d: PartialDataTransform) => d.function);

    $rows.selectAll('.dict-target .field-input')
      .property('disabled', (d: PartialDataTransform) => isLocked || d.function === 'ignore')
      .classed('disabled', (d: PartialDataTransform) => isLocked || d.function === 'ignore')
      .property('value', (d: PartialDataTransform) => d.target);

    $rows.selectAll('.dict-params .field-input')
      .property('disabled', (d: PartialDataTransform) => isLocked || d.function !== 'constant')
      .classed('disabled', (d: PartialDataTransform) => isLocked || d.function !== 'constant')
      .property('value', (d: PartialDataTransform) => d.params);
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
    const dictionaryInfo = this._checkDictionary();

    /* Ok/Cancel/Delete Buttons */
    let $buttons: D3Selection = $parent.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons: D3EnterSelection = $buttons.enter()
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
      const $$deleteButton: D3EnterSelection = $$buttons
        .append('button')
        .attr('class', 'button delete-button action danger')
        .on('click', this._clickedDelete);

      $$deleteButton
        .call(uiIcon('#fas-trash-can'));

      $$deleteButton
        .append('div')
        .attr('class', 'button-label');
    }

    // update
    $buttons = $buttons.merge($$buttons) as D3Selection;

    $buttons.selectAll('.ok-button')
      .classed('secondary disabled', !fieldInfo.isOk || !dictionaryInfo.isOk)
      .text(l10n.t('text.okay'));

    $buttons.selectAll('.cancel-button')
      .text(l10n.t('text.cancel'));

    $buttons.selectAll('.delete-button .button-label')
      .text(l10n.t('rapid_dataset_settings.delete.label'));

    // relocalize the "are you sure" modal, if it happens to be showing.
    if (this.AreYouSureModal?.isShown) {
      this._renderAreYouSure();
    }
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
    const dictionaryInfo = this._checkDictionary();
    if (!fieldInfo.isOk || !dictionaryInfo.isOk) {
      this.render();
      return;
    }

    const context = this.context;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;
    const scene = gfx.scene!;

    // All datasets allow these things to be changed:
    ds.color = fieldInfo.color ?? RAPID_MAGENTA;
    ds.conflated = !!fieldInfo.conflation;

    // Custom datasets allow more things to be changed:
    if (ds.custom) {
      ds.label = fieldInfo.name || '';
      ds.description = fieldInfo.description || '';
      (ds as any)._label = fieldInfo.name!;                       // todo avoid this duplication
      (ds as any)._description = fieldInfo.description || '';     // todo avoid this duplication
      ds.thumbnailUrl = fieldInfo.thumbnailUrl ?? ds.getThumbnail();

      // update data dictionary, create/delete if needed
      if (this._transforms!.length > 0) {
        ds.dictionary ||= new RapidDataDictionary(context);
        // assume dictionary is valid, for now
        ds.dictionary.transforms = this._transforms as RapidDataTransform[];
      } else {
        ds.dictionary = null;
      }
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
   * Callback when user clicks "Delete Dataset".  Only a custom dataset can be deleted.
   * This is somewhat destructive, so we show an extra "Are you Sure" modal popup.
   * @param [e] - the triggering event, if any
   */
  protected _clickedDelete(e?: Event): void {
    e?.preventDefault();

    const ds = this.dataset;
    if (!ds?.custom) return;   // need a dataset to do anything

    if (this.AreYouSureModal?.isShown) return;  // already showing

    const context = this.context;
    this.AreYouSureModal = new UiModal(context, true /*isBlocking*/ ).show();
    this.AreYouSureModal.$modal!
      .attr('class', 'modal rapid-modal');

    // Cleanup on close
    this.AreYouSureModal.once('close', () => {
      this.AreYouSureModal = null;
    });

    this._renderAreYouSure();
  }


  /**
   * The user is sure they want to delete the current dataset.
   * Remove all persisted settings, the dataset, and close all the modals.
   * @param [e] - the triggering event, if any
   */
  protected _clickedIAmSure(e?: Event): void {
    e?.preventDefault();

    const ds = this.dataset;
    if (!ds?.custom) return;   // need a dataset to do anything

    const context = this.context;
    const rapid = context.systems.rapid!;
    const settings = context.systems.settings;

    settings?.unset(`rapid.custom.${ds.id}`);
    rapid.catalog.delete(ds.id);
    rapid.removeDatasets(ds.id);

    this.AreYouSureModal?.close();
    this.close();
  }


  /**
   * Renders the additional "Are you sure?" modal
   * when the user chooses to delete the dataset.
   */
  protected _renderAreYouSure(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    if (!this.AreYouSureModal?.isShown) return;

    const prefix = 'rapid_dataset_settings.delete';  // prefix for text strings

    const Modal = this.AreYouSureModal;
    const $content: D3Selection = Modal.$content!;

    /* Heading */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    // enter
    const $$heading: D3EnterSelection = $heading
      .enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('h1')
      .attr('class', 'modal-heading-text');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading-text')
      .text(l10n.t(`${prefix}.heading`));


    /* Text section */
    let $text: D3Selection = $content.selectAll('.modal-text')
      .data([0]);

    // enter
    const $$text: D3EnterSelection = $text
      .enter()
      .append('div')
      .attr('class', 'modal-section modal-text');

    // update
    $text = $text.merge($$text);

    $text
      .text(l10n.t(`${prefix}.instructions`));


    /* Ok/Cancel Buttons */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons: D3EnterSelection = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    const $$okButton: D3EnterSelection = $$buttons
      .append('button')
      .attr('class', 'button ok-button action danger')
      .on('click', this._clickedIAmSure);

    $$okButton
      .call(uiIcon('#fas-trash-can'));

    $$okButton
      .append('div')
      .attr('class', 'button-label');

    const $$cancelButton: D3EnterSelection = $$buttons
      .append('button')
      .attr('class', 'button cancel-button action')
      .on('click', () => this.AreYouSureModal!.close());

    $$cancelButton
      .append('div')
      .attr('class', 'button-label');

    // focus cancel
    const node = $$buttons.selectAll('.cancel-button').node() as HTMLElement | null;
    node?.focus();

    // update
    $buttons = $buttons.merge($$buttons) as D3Selection;

    $buttons.selectAll('.ok-button .button-label')
      .text(l10n.t(`${prefix}.ok`));

    $buttons.selectAll('.cancel-button .button-label')
      .text(l10n.t(`${prefix}.cancel`));
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
    result.conflation = conflationNode?.checked;

    // required values must be present
    result.isOk = !!(result.id && result.name && result.sourceUrl);
    return result;
  }


  /**
   * Checks the data dictionary.
   * @returns a DictionaryInfo result set
   */
  protected _checkDictionary(): DictionaryInfo {
    const result: DictionaryInfo = { isOk: false, isDefault: false };
    if (!this.Modal) return result;

    const ds = this.dataset;
    if (!ds) return result;   // need a dataset to do anything

    // Make a copy of the original dataset dictionary transforms before any changes.
    if (!this._transforms) {
      const orig = ds.dictionary?.transforms;
      this._transforms = (orig ? structuredClone(orig) : []);
    }

    // Sort the rows by order ascending, then check each row.
    let counter = 0;
    const seen = new Set<number>();
    const rows = this._transforms   // sort in-place, send unordered rows to the end
      .sort((a: PartialDataTransform, b: PartialDataTransform) => (a.order ?? 9999) - (b.order ?? 9999));

    for (const row of rows) {
      // recompute order
      row.order = counter++;

      // generate row uuid
      if (!row.uuid) {
        row.uuid = crypto.randomUUID().slice(0, 8);
      }

      // check function
      if (row.function === 'copy') {
        // "copy" should have a 'source' and 'target'
        // default target = source if needed
        if (!row.target) {
          row.target = row.source;
        }

      } else if (row.function === 'ignore') {
        // "ignore" should have a 'source' only
        // remove target and params if present
        row.target = '';
        row.params = '';

      } else if (row.function === 'constant') {
        // "constant" should have no source,
        // and a 'target' and 'params'
        row.source = '';
      }

      // check for duplicate rows
      const template = `${row.source ?? ''}:${row.function ?? ''}:${row.target ?? ''}`;
      const hash = utilHashcode(template);
      if (seen.has(hash)) {
        // warn
      } else {
        seen.add(hash);
      }
    }

    // Is this a "default" data dictionary (one that copies source attributes directly to target tags)?
    result.isDefault = (
      rows.length === 1
      && rows[0].source === '*'
      && rows[0].function === 'copy'
      && rows[0].target === '*'
    );

    result.isOk = true;  // for now

    return result;
  }


  /**
   * Create a default data mapping.
   * This just adds a transform row that copies all source attributes directly to target tags.
   */
  protected _createDefaultMapping(): void {
    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // This function should be called after `_checkDictionary()` has run once.
    // Expect `this._transforms` to contain a working copy of the dictionary.
    if (!this._transforms) return;   // caled too early?
    if (this._transforms.length > 0) return;   // dictionary exists already
    this._transforms.push({ order: 0, source: '*', function: 'copy', target: '*' });
  }


  /**
   * Detect the data dictionary by scanning the data to look for whatever attributes are present.
   * Add a transform row for each source data attribute that we find.
   * By default, each source attribute will be copied directly to a target tag.
   * We also look for common "identifier" fields, and set the `isID` flag if we find one.
   * Note that this currently only works with "GeoJSON"-like data.
   */
  protected _detectDataMapping(): void {
    const ds = this.dataset;
    if (!ds) return;   // need a dataset to do anything

    // This function should be called after `_checkDictionary()` has run once.
    // Expect `this._transforms` to contain a working copy of the dictionary.
    if (!this._transforms) return;   // caled too early?
    if (this._transforms.length > 0) return;   // dictionary exists already

    const context = this.context;
    const spatial = context.systems.spatial!;
    const data = spatial.getAllItems<GeoJSONData>(ds.spatialID);
    if (!data.length) return;  // no data to look at

    // We have data, so we'll take a look at it.
    // Gather whatever fields we find in the data.
    const seen = new Set<string>();
    let identifier = '';
    let counter = 0;
    let iterSinceChange = 0;

    for (const d of data) {
      // First, look for an identifier property if we haven't found one yet..
      if (!identifier) {
        // Make lowercased versions of all the property keys: `Map<lowercase, original>`
        const lowerKeys = new Map<string, string>(Object.keys(d.properties).map(k => [k.toLowerCase(), k]));
        // Try common identifier field names - pick the first one that we find, in this order.
        for (const k of ['objectid', 'oid', 'fid', 'guid', 'id']) {
          const found = lowerKeys.get(k);
          if (found) {
            identifier = found;
            break;
          }
        }
      }

      // Next, create transform rows for each property key that we haven't seen yet..
      const startSize = seen.size;
      for (const k of Object.keys(d.properties)) {
        if (seen.has(k)) continue;
        seen.add(k);

        const transform: RapidDataTransform = {
          order: counter++,
          function: 'copy',
          source: k,
          target: k,
          isID: (k === identifier)
        };
        this._transforms.push(transform);
      }

      // Have we gathered any new fields on this iteration?
      const endSize = seen.size;
      if (startSize !== endSize) {
        iterSinceChange = 0;
      } else {
        iterSinceChange++;
      }

      // Stop looking - don't need to look at 1000s of features if they are all the same.
      if (iterSinceChange > 50) {
        break;
      }
    }
  }
}
