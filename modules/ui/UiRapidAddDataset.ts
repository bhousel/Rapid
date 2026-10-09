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
  /** Dataset Source */
  datasetSource?: string;
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
        this._fileList = payload.fileList;
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
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
   * When clicking "Next", test dataset for validity.  If it all looks ok,
   * create the RapidDataset and continue to the Dataset Settings Modal.
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

    // Instantiate the custom dataset and add it to the catalog.
    const props: Partial<RapidDatasetProps> = {
      id: fieldInfo.datasetID,
      label: fieldInfo.datasetName,
      sourceUrl: fieldInfo.datasetSource,
      custom: true
    };

    const ds = new RapidDataset(context, props);

    // Does it work?
    ds.setupCustomDatasetAsync()
      .then(() => {
        rapid.catalog.set(ds.id, ds);
        rapid.enableDatasets(ds.id);    // add it to the menu
        rapid.saveDatasetSettings(ds);  // persist settings

        // Continue to the Dataset Settings modal, wire up 'done' handler too.
        const SettingsModal = new UiRapidDatasetSettings(context).once('done', this.close);
        SettingsModal.dataset = ds;
        SettingsModal.show();
      })
      .catch((err: unknown) => {
        console.error(`Dataset setup failed for ${ds.id}: `, err);  // eslint-disable-line no-console
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
   * Renders the Url section.
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
    const $$source = $source.enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-source');

    $$source
      .append('div')
      .attr('class', 'source-instructions');

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
        if (files?.length) {
          this._fileList = files;
          // const urlNode = $parent.selectAll(`#url-${uuid}`).node() as HTMLTextAreaElement | null;
          // if (urlNode) {
          //   urlNode.value = URL.createObjectURL(files[0]);
          // }
        } else {
          this._fileList = null;
        }
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
      });

    $$file
      .append('button')
      .attr('class', 'file-remove')
      .on('click', (e: PointerEvent) => {
        e.preventDefault();
        const fileNode = $parent.selectAll(`#file-${uuid}`).node() as HTMLTextAreaElement | null;
        if (fileNode) {
          fileNode.value = '';
        }
        this._fileList = null;
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
      })
      .call(uiIcon('#fas-xmark'));

    $$source
      .append('div')
      .attr('class', 'instructions-url');

    $$source
      .append('textarea')
      .attr('id', `url-${uuid}`)
      .attr('class', 'field-url')
      .call(utilNoAuto)
      .call(this.SampleCombo.attach)   // sample data
      .on('change', (e: Event) => {
        this._dsError = null;   // clear any error, clicking "next" will try again.
        this.render();          // rerendering will also run validation
      });

    $$source
      .append('div')
      .attr('class', 'field-feedback');


    // update
    $source = $source.merge($$source) as D3Selection;

    // perform field validation
    const fieldInfo = this._checkFields();
    const errors = fieldInfo.errors || {};

    $source
      .classed('has-warning', !!errors.url?.length);

    const source_heading = l10n.t(`${prefix}.source.label`);
    const source_instructions = l10n.t(`${prefix}.source.instructions`);
    const source_supported = l10n.t(`${prefix}.source.supported`);
    const file_types = l10n.t(`${prefix}.source.types`);
    const instructionsHtml = marked.parse(`
### ${source_heading}
${source_instructions}
&nbsp;<br>
${source_supported} ${file_types}
&nbsp;<br>
&nbsp;<br>
`);

    $source.selectAll('.source-instructions')
      .html(instructionsHtml as string);
    $source.selectAll('.instructions-url')
      .text(l10n.t(`${prefix}.url.instructions`));

    $source.selectAll(`#file-${uuid}`)
      .property('files', this._fileList);

    $source.selectAll('.file-remove')
      .classed('hide', !this._fileList);

    $source.selectAll(`#url-${uuid}`)
      .property('disabled', !!this._fileList)
      .classed('disabled', !!this._fileList)
      .attr('placeholder', l10n.t(`${prefix}.url.placeholder`));

    // Show errors
    $source.selectAll('.field-feedback')
      .selectAll('.feedback-item')
      .data(errors.url || [], (d: string) => d)
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
   * Run all field validations.  Returns an object containing the current field values
   * and information about whether validation has passed or failed.
   * @returns a FieldInfo result set
   */
  protected _checkFields(): FieldInfo {
    const result: FieldInfo = { isOk: false };
    if (!this.Modal) return result;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;
    const $content = this.Modal.$content!;
    const uuid = this._uuid;

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
    const idVal = (idNode?.value || '').trim();
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
    const nameVal = (nameNode?.value || '').trim();
    if (nameVal && this._seenNames.has(nameVal.toLowerCase())) {
      nameErrors.push(l10n.t('rapid_add_dataset.name.taken'));
    }
    if (nameVal && !nameErrors.length) {
      result.datasetName = nameVal;
    }

    // Check Dataset Source
    const urlErrors = result.errors.url = [] as string[];
    const urlNode = $content.selectAll(`#url-${uuid}`).node() as HTMLTextAreaElement | null;
    const urlVal = urlNode?.value || '';
    result.datasetSource = urlVal.trim();
    if (this._dsError) {
      urlErrors.push(this._dsError);
    }
    if (urlVal && !urlErrors.length) {
      result.datasetSource = urlVal;
    }

    // required values must be present
    result.isOk = !!(result.datasetID && result.datasetName && result.datasetSource);
    return result;
  }

}
