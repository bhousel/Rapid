import { EventEmitter } from 'tseep/lib/ee-safe';
import { marked } from 'marked';
import { RapidDataset } from '../lib/RapidDataset.ts';
import { UiCombobox } from './UiCombobox.ts';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidDatasetSettings } from './UiRapidDatasetSettings.ts';
import { utilDetect } from '../util/detect.ts';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDatasetProps } from '../lib/RapidDataset.ts';
import type { StorageViability } from '../core/DatabaseSystem.ts';


/**
 * The values collected on this screen, along with information about whether
 * the field values are all present and have passed validation.
 */
interface FieldInfo {
  /* `true` if we can continue (no errors), false if not */
  isOk: boolean
  /* Mapping of input element IDs to raw localized error strings, if any. */
  errors?: Record<string, string[]>;

  /** Dataset ID */
  datasetID?: DatasetID;
  /** Dataset Name */
  datasetName?: string;
  /** Dataset File */
  datasetFile?: File;
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
  public SampleCombo: UiCombobox;

  /** Unique ID for field identifiers */
  protected _uuid: string;
  /** Seen names (to avoid duplicates) */
  protected _seenNames: Set<string> | null;
  /** Seen identifiers (to avoid duplicates) */
  protected _seenIDs: Set<string> | null;
  /** The current file list, if any */
  protected _fileList: FileList | null;

  /** Error with dataset creation, if any */
  protected _dsError: string | null;
  /** Error with file storage, if any */
  protected _fileError: string | null;
  /** Data about the file storage viability, if any */
  protected _storageViability: StorageViability | null;

  public rerender: () => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._uuid = crypto.randomUUID().slice(0, 8);
    this._seenNames = null;
    this._seenIDs = null;
    this._fileList = null;
    this._dsError = null;
    this._fileError = null;
    this._storageViability = null;

    // Child components
    this.Modal = null;
    this.SampleCombo = new UiCombobox(context, 'rapid-dark');

    // Sample datasets
    const sampleData = [
      { value: 'http://bryanhousel.com/osm/STL_TREES_min.geojson' },
      { value: 'http://bryanhousel.com/osm/Hawaii_Sidewalks_and_Paths.geojson' },
      { value: 'http://bryanhousel.com/osm/King_County_Stops.geojson' },
      { value: 'http://bryanhousel.com/ODOT/freight_terminals/Freight_Terminals_osw_clean_7.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/crashes_osw_clean/Crashes_osw_clean_3.points.geojson' },
      { value: 'http://bryanhousel.com/ODOT/crossings_ped_bike_sanitized_validated/crossings_ped_bike_osw_tags_full_precision.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/crossings_ped_bike_sanitized_validated/crossings_ped_bike.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/bike_paths_osw_tags_sanitized_validated/bike_paths_osw_tags.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/bike_paths_osw_tags_sanitized_validated/bike_paths.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/union_roads_sidewalks_bikepaths_crossings/osw.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/union_roads_sidewalks_bikepaths_crossings/osw.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/pedestrian_sidewalks_osw_tags/Pedestrian_Sidewalks_osw_tags.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/pedestrian_sidewalks_osw_tags/Pedestrian_Sidewalks_osw_tags.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/freight_routes_cleaned/Freight_Routes_osw.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/freight_routes_cleaned/Freight_Routes_osw.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/transit_osw_tags_sanitized_validated/Transit_odot_osw_tags.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/transit_osw_tags_sanitized_validated/Transit_odot.nodes.geojson' },
      { value: 'http://bryanhousel.com/ODOT/roads_osw_tags_sanitized_validated/roads_osw_tags.edges.geojson' },
      { value: 'http://bryanhousel.com/ODOT/roads_osw_tags_sanitized_validated/roads.nodes.geojson' },
    ];

    const detected = utilDetect();
    if (/(localhost|127\.0\.0\.1)/.test(detected.host ?? '')) {
      this.SampleCombo.data(sampleData);
    }


    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.rerender = () => this.render();
    this._setFileList = this._setFileList.bind(this);
    this._checkFields = this._checkFields.bind(this);
    this._clickedNext = this._clickedNext.bind(this);
    this._done = this._done.bind(this);
    this._renderHeading = this._renderHeading.bind(this);
    this._renderFields = this._renderFields.bind(this);
    this._renderSource = this._renderSource.bind(this);
    this._renderButtons = this._renderButtons.bind(this);
  }


  /**
   * This shows the Modal if it isn't already being shown.
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const dragdrop = context.systems.dragdrop;
    const l10n = context.systems.l10n!;

    if (this.Modal?.isShown) return;

    this.Modal = new UiModal(context).show();
    this.Modal.$modal!
      .attr('class', 'modal rapid-modal modal-add-dataset');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();

    // Setup event handlers
    l10n.on('localechange', this.rerender);

    // Drag-and-drop is owned centrally by `DragAndDropSystem`.
    // `priority: 1` places this above other drag and drop handlers.
    dragdrop?.register({
      id: 'ui-add-dataset',
      priority: 1,
      accepts: (payload) => payload.data.length > 0,
      handle: (payload) => {
        payload.claim();
        this._setFileList(payload.fileList);
      }
    });
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
   * Renders the content inside the Modal component.
   */
  public render(): void {
    if (!this.Modal) return;  // need to call `show()` first to create the modal.

    const $content = this.Modal.$content!;

    $content
      .call(this._renderHeading);

    /* Wrapper for main section */
    const $wrap = $content.selectAll('.add-dataset-wrap')
      .data([0])
      .join($$enter => $$enter.append('div').attr('class', 'add-dataset-wrap'));

    $wrap
      .call(this._renderFields)
      .call(this._renderSource);

    $content
      .call(this._renderButtons);
  }


  /**
   * Emits a 'done' event and cleans up the Modal.
   * All the various ways of closing the Modal end up here.
   */
  protected _done(): void {
    const context = this.context;
    const dragdrop = context.systems.dragdrop;
    const l10n = context.systems.l10n!;

    this.emit('done');
    this.Modal = null;

    l10n.off('localechange', this.rerender);
    dragdrop?.unregister('ui-add-dataset');
  }


  /**
   * When clicking "Next", test dataset for validity.
   * If it all looks ok, create the `RapidDataset` and continue to the Dataset Settings Modal.
   * If there are problems, `render()` again to surface the errors and return early.
   * @param [e] - the triggering event, if any
   */
  protected _clickedNext(e?: Event): void {
    e?.preventDefault();

    const fieldInfo = this._checkFields();
    if (!fieldInfo.isOk) {
      this.render();
      return;
    }

    const context = this.context;
    const rapid = context.systems.rapid!;
    const database = context.systems.database;

    const datasetID = fieldInfo.datasetID;
    const props: Partial<RapidDatasetProps> = {
      id: datasetID,
      label: fieldInfo.datasetName,
      custom: true
    };

    Promise.resolve()
      .then((): Promise<any> => {
        if (database && fieldInfo.datasetFile instanceof File) {  // source is a File
          const file = fieldInfo.datasetFile;
          const fileID = `${this._uuid}:${datasetID}:${file.name}`;
          props.sourceFileID = fileID;
          return database.putFileAsync(file, { id: fileID });

        } else if (fieldInfo.datasetUrl) {  // source is a Url
          props.sourceUrl = fieldInfo.datasetUrl;
          return Promise.resolve();

        } else {
          return Promise.reject(new Error('no source'));   // shouldn't happen
        }
      })
      .then((): Promise<RapidDataset> => {
        const ds = new RapidDataset(context, props);
        return ds.setupCustomDatasetAsync().then(() => ds);   // does it work?
      })
      .then((ds: RapidDataset) => {
        rapid.catalog.set(ds.id, ds);   // add it to the catalog
        rapid.enableDatasets(ds.id);    // add it to the menu
        rapid.saveDatasetSettings(ds);  // persist settings

        // Continue to the Dataset Settings modal, wire up 'done' handler too.
        const SettingsModal = new UiRapidDatasetSettings(context).once('done', this.close);
        SettingsModal.dataset = ds;
        SettingsModal.show();
      })
      .catch((err: unknown) => {
        console.error(`Dataset setup failed for ${datasetID}: `, err);  // eslint-disable-line no-console
        this._dsError = 'Error: ' + (err as Error)?.message;
        this.render();
      });
  }


  /**
   * Renders the heading section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderHeading($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    /* Heading section */
    let $heading: D3Selection = $parent.selectAll('.modal-heading')
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
  }


  /**
   * Renders the fields section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderFields($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const uuid = this._uuid;
    const prefix = 'rapid_add_dataset';  // prefix for text strings

    let $fields: D3Selection = $parent.selectAll('.rapid-add-dataset-fields')
      .data([0]);

    // enter
    const $$fields: D3EnterSelection = $fields
      .enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-fields');


    // Create the fields and set `.property('value', …)`
    // to their initial values, gathered from the dataset.
    // We'll avoid D3.js metaprogramming here, as each field has unique needs.

    /* Name */
    const $$name: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'field-row row-name');

    $$name
      .append('label')
      .attr('for', `name-${uuid}`)
      .attr('class', 'field-label');

    const $$nameInput: D3EnterSelection = $$name
      .append('input')
      .attr('id', `name-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .on('input', this.rerender);  // rerendering will also run validation

    // set focus on enter
    const node = $$nameInput.node() as HTMLElement | null;
    node?.focus();

    $$name
      .append('div')
      .attr('class', 'field-feedback');


    /* Identifier */
    const $$identifier: D3EnterSelection = $$fields
      .append('div')
      .attr('class', 'field-row row-identifier');

    $$identifier
      .append('label')
      .attr('for', `identifier-${uuid}`)
      .attr('class', 'field-label');

    $$identifier
      .append('input')
      .attr('maxlength', 36)
      .attr('id', `identifier-${uuid}`)
      .attr('class', 'field-input')
      .call(utilNoAuto)
      .on('input', this.rerender);  // rerendering will also run validation

    $$identifier
      .append('div')
      .attr('class', 'field-instruction');

    $$identifier
      .append('div')
      .attr('class', 'field-feedback');


    // update
    $fields = $fields.merge($$fields);

    // perform field validation
    const fieldInfo = this._checkFields();
    const errors = fieldInfo.errors || {};

    $fields.selectAll('.row-name')
      .classed('has-warning', !!errors.name?.length);
    $fields.selectAll('.row-identifier')
      .classed('has-warning', !!errors.identifier?.length);

    $fields.selectAll('.row-name label')
      .text(l10n.t(`${prefix}.name.label`));
    $fields.selectAll('.row-identifier label')
      .text(l10n.t(`${prefix}.identifier.label`));
    $fields.selectAll('.row-identifier .field-instruction')
      .text(l10n.t(`${prefix}.identifier.instruction`));

    $fields.selectAll(`#name-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.name.placeholder`));
    $fields.selectAll(`#identifier-${uuid}`)
      .attr('placeholder', l10n.t(`${prefix}.identifier.placeholder`));

    // Show errors
    $fields.selectAll('.row-name .field-feedback')
      .selectAll('.feedback-item')
      .data(errors.name || [], (d: string) => d)
      .join(
        $$enter => $$enter
          .append('div')
          .attr('class', 'feedback-item')
          .text((d: string) => `\u26a0\ufe0f ${d}`),   // U+26A0 U+FE0F = emoji warning
        $update => $update,
        $exit => $exit.remove()
      );

    $fields.selectAll('.row-identifier .field-feedback')
      .selectAll('.feedback-item')
      .data(errors.identifier || [], (d: string) => d)
      .join(
        $$enter => $$enter
          .append('div')
          .attr('class', 'feedback-item')
          .text((d: string) => `\u26a0\ufe0f ${d}`),   // U+26A0 U+FE0F = emoji warning
        $update => $update,
        $exit => $exit.remove()
      );
  }


  /**
   * Renders the "Dataset Source" section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderSource($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const prefix = 'rapid_add_dataset';  // prefix for text strings
    const uuid = this._uuid;

    const accept = [
      '.gpx', 'application/gpx', 'application/gpx+xml',
      '.kml', 'application/vnd.google-earth.kml+xml', 'application/kml', 'application/kml+xml',
      '.geojson', '.json', 'application/geo+json', 'application/json', 'application/vnd.geo+json', 'text/x-json'
    ];

    /* Dataset Source section */
    let $source: D3Selection = $parent.selectAll('.rapid-add-dataset-source')
      .data([0]);

    // enter
    const $$source: D3EnterSelection = $source.enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-source');

    $$source
      .append('h3')
      .attr('class', 'source-heading');

    $$source
      .append('div')
      .attr('class', 'file-instructions');

    $$source
      .append('div')
      .attr('class', 'file-filetypes');


    /* File */
    const $$file: D3EnterSelection = $$source
      .append('div')
      .attr('class', 'field-row row-file');

    $$file
      .append('input')
      .attr('id', `file-${uuid}`)
      .attr('class', 'field-file')
      .attr('type', 'file')
      .attr('accept', accept.join())
      .on('change', (e: Event) => {
        const files = (e.target as HTMLInputElement).files;
        this._setFileList(files);
      });

    $$file
      .append('button')
      .attr('class', 'file-remove')
      .on('click', (e: PointerEvent) => {
        e.preventDefault();
        this._setFileList(null);
      })
      .call(uiIcon('#fas-xmark'));

    $$file
      .append('div')
      .attr('class', 'file-error');


    $$source
      .append('div')
      .attr('class', 'url-instructions');

    /* Url */
    const $$url: D3EnterSelection = $$source
      .append('div')
      .attr('class', 'field-row row-url');

    $$url
      .append('textarea')
      .attr('id', `url-${uuid}`)
      .attr('class', 'field-url')
      .call(utilNoAuto)
      .call(this.SampleCombo.attach)   // sample data
      .on('change', (e: Event) => {
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
      });

    $$url
      .append('div')
      .attr('class', 'field-feedback');


    // update
    $source = $source.merge($$source);

    // perform field validation
    const fieldInfo = this._checkFields();
    const errors = fieldInfo.errors || {};
    const hasFile = !!this._fileList;
    const hasUrl = !!fieldInfo.datasetUrl;
    const isStorageUnavailable = this._storageViability?.reason === 'unavailable';

    $source.selectAll('.row-file')
      .classed('has-warning', hasFile && !!errors.source?.length);

    $source.selectAll('.source-heading')
      .text(l10n.t(`${prefix}.source.label`));

    $source.selectAll('.file-instructions')
      .text(l10n.t(`${prefix}.file.instructions`));

    const source_supported = l10n.t(`${prefix}.file.supported`);
    const file_types = l10n.t(`${prefix}.file.types`);
    $source.selectAll('.file-filetypes')
      .html(marked.parse(`${source_supported} ${file_types}`) as string);

    $source.selectAll('.file-error')
      .text(this._fileError);  // if storage unavailable, a notice will appear here

    $source.selectAll('.url-instructions')
      .text(l10n.t(`${prefix}.url.instructions`));

    $source.selectAll(`#file-${uuid}`)
      .property('disabled', isStorageUnavailable || hasUrl)
      .classed('disabled', isStorageUnavailable || hasUrl)
      .property('files', this._fileList);

    $source.selectAll('.file-remove')
      .classed('hide', !hasFile);

    $source.selectAll('.row-url')
      .classed('has-warning', !!errors.source?.length);

    $source.selectAll(`#url-${uuid}`)
      .property('disabled', hasFile)
      .classed('disabled', hasFile)
      .attr('placeholder', !hasFile ? l10n.t(`${prefix}.url.placeholder`) : null);

    // Show errors
    $source.selectAll('.field-feedback')
      .selectAll('.feedback-item')
      .data(errors.source || [], (d: string) => d)
      .join(
        $$enter => $$enter
          .append('div')
          .attr('class', 'feedback-item')
          .text((d: string) => `\u26a0\ufe0f ${d}`),   // U+26A0 U+FE0F = emoji warning
        $update => $update,
        $exit => $exit.remove()
      );
  }


  /**
   * Renders the buttons section.
   * @param $parent - Parent D3Selection that this content should render itself into
   */
  protected _renderButtons($parent: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const fieldInfo = this._checkFields();

    /* Next/Cancel Buttons */
    let $buttons: D3Selection = $parent.selectAll('.modal-section.buttons')
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
   * Accepts a `FileList`, either from the drag and drop handler or the file input.
   * Also check whether the `DatabaseSystem` exists and has the quota needed to store this file.
   * @param fileList - Files to process (only first one is used), or `null` to reset
   */
  protected _setFileList(fileList: FileList | null): void {
    const context = this.context;
    const database = context.systems.database;

    this._fileList = fileList;

    Promise.resolve()
      .then(() => {
        if (database && fileList?.length) {
          // Hack to make a new `FileList` with only a single file in it.
          // This handles the situation where the user might have dragged multiple files here.
          const file = fileList[0];
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);   // keep only the first one
          this._fileList = dataTransfer.files;

          return database.canStoreAsync(file.size)
            .then((result: StorageViability) => this._storageViability = result);
        }
      })
      .finally(() => {
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
      });
  }


  /**
   * Run all field validations.  Returns an object containing the current field values
   * and information about whether validation has passed or failed.
   * @returns a FieldInfo result set
   */
  protected _checkFields(): FieldInfo {
    const result: FieldInfo = { isOk: false };
    if (!this.Modal) return result;

    const context = this.context;
    const database = context.systems.database;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;
    const $content = this.Modal.$content!;
    const uuid = this._uuid;
    const file = this._fileList && this._fileList[0];
    const filename = file?.name || '';

    result.errors = {};

    // Gather existing Dataset Names and IDs if we haven't done this already.
    if (!this._seenNames || !this._seenIDs) {
      this._seenNames = new Set<string>();
      this._seenIDs = new Set<string>();
      for (const [dsID, ds] of rapid.catalog) {
        this._seenNames.add(ds.getLabel().toLowerCase());
        this._seenIDs.add(dsID.toLowerCase());
      }
    }

    // Check Dataset ID
    const idErrors = result.errors.identifier = [] as string[];
    const idNode = $content.selectAll(`#identifier-${uuid}`).node() as HTMLInputElement | null;
    let idVal = (idNode?.value || '').trim();
    if (idNode && !idVal && filename) {
      idNode.value = idVal = filename.replace(/[^\w\-]+/g, '_');  // fallback to slugified filename, if we have one
    }
    if (idVal && this._seenIDs.has(idVal.toLowerCase())) {
      idErrors.push(l10n.t('rapid_add_dataset.identifier.taken'));
    }
    if (idVal && !/^[\w\-]+$/.test(idVal)) {
      idErrors.push(l10n.t('rapid_add_dataset.identifier.invalid'));
    }
    if (idVal && !idErrors.length) {
      result.datasetID = idVal;
    }

    // Check Dataset Name
    const nameErrors = result.errors.name = [] as string[];
    const nameNode = $content.selectAll(`#name-${uuid}`).node() as HTMLInputElement | null;
    let nameVal = (nameNode?.value || '').trim();
    if (nameNode && !nameVal && filename) {
      nameNode.value = nameVal = filename;  // fallback to filename, if we have one
    }
    if (nameVal && this._seenNames.has(nameVal.toLowerCase())) {
      nameErrors.push(l10n.t('rapid_add_dataset.name.taken'));
    }
    if (nameVal && !nameErrors.length) {
      result.datasetName = nameVal;
    }

    // Check Dataset Source (File or URL string)
    const sourceErrors = result.errors.source = [] as string[];
    if (this._dsError) {
      sourceErrors.push(this._dsError);
    }

    // For files, we will warn the user and not proceed if we can not store the file.
    // Storage viability data may have already been set by `_setFileList()`.
    if (!database) {
      this._storageViability = { ok: false, reason: 'unavailable', requested: 0, available: 0, quota: 0, usage: 0 };
    }
    const sv = this._storageViability;
    if (sv?.reason === 'unavailable') {
      this._fileError = l10n.t('rapid_add_dataset.file.unavailable');
    } else if (sv?.reason === 'insufficient') {
      this._fileError = l10n.t('rapid_add_dataset.file.insufficient', {
        requested: sv.requested || 0,
        available: sv.available || 0
      });
    } else {
      this._fileError = null;
    }

    const urlNode = $content.selectAll(`#url-${uuid}`).node() as HTMLTextAreaElement | null;
    const fileNode = $content.selectAll(`#file-${uuid}`).node() as HTMLInputElement | null;

    if (file) {  // We have a File, use that
      if (urlNode) {
        urlNode.value = '';
      }
      if (!sourceErrors.length && !this._fileError) {
        result.datasetFile = file;
      }

    } else {   // Look for a URL string
      if (fileNode) {
        fileNode.value = '';
      }
      const urlVal = (urlNode?.value || '').trim();
      if (urlVal && !sourceErrors.length) {
        result.datasetUrl = urlVal;
      }
    }

    // required values must be present
    result.isOk = !!(result.datasetID && result.datasetName && (result.datasetUrl || result.datasetFile));
    return result;
  }

}
