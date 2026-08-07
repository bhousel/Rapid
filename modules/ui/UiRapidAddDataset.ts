import { EventEmitter } from 'tseep/lib/ee-safe';
import { select } from 'd3-selection';
import { marked } from 'marked';
import { uiIcon } from './icon.ts';
import { utilKeybinding, utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This is the modal where the user can add a custom dataset to Rapid.
 *
 * Events available:
 *   `done`   Fires when the user is finished and they are closing this modal
 */
export class UiRapidAddDataset extends EventEmitter {
  public context: Context;

  // D3 selections
  public $parentModal: any;
  public $wrap: D3Selection | null;
  public $modal: D3Selection | null;

  public rerender: () => void;

  protected _currFileList: FileList | null;
  protected _currUrl: string | null;
  protected _clickedOk: () => void;       // custom OK handler
  protected _clickedCancel: () => void;   // custom Cancel handler


  /**
   * @param  context - Global shared application context
   * @param  $parentModal - the parent modal that this dialog is shown on top of
   */
  public constructor(context: Context, $parentModal: any) {
    super();
    this.context = context;

    this._currFileList = null;
    this._currUrl = null;

    this._clickedOk = () => true;       // custom OK handler
    this._clickedCancel = () => true;   // custom Cancel handler

    // D3 selections
    this.$parentModal = $parentModal;
    this.$wrap = null;
    this.$modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument

    // Setup event handlers
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this.rerender);
  }


  /**
   * This shows the add-dataset screen if it isn't alreaday being shown.
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const $container = context.container();   // $container is always the parent for a modal

    // Unfortunately `uiModal` is written in a way that there can be only one at a time.
    // So we need to roll our own modal here instead of just creating a second `uiModal`.
    const $shaded = $container.selectAll('.shaded');  // container for the existing modal
    if ($shaded.empty()) return;
    if ($shaded.selectAll('.modal-add-dataset').size()) return;  // modal exists already

    const origClose = this.$parentModal.close;
    this.$parentModal.close = () => { /* ignore */ };

    // Setup Ok/Cancel behaviors
    this._clickedOk = () => {
      this.$modal!
        .transition()
        .duration(200)
        .style('top', '0px')
        .on('end', () => this.$wrap!.remove());

      this.$parentModal.close = origClose;  // restore close handler

      const keybinding = utilKeybinding('modal');
      keybinding.on(['⌫', '⎋'], origClose);
      select(document).call(keybinding);
      this.emit('done');
    };

    this._clickedCancel = () => {
      this._currFileList = null;
      this._currUrl = null;
      this.$modal!
        .transition()
        .duration(200)
        .style('top', '0px')
        .on('end', () => this.$wrap!.remove());

      this.$parentModal.close = origClose;  // restore close handler

      const keybinding = utilKeybinding('modal');
      keybinding.on(['⌫', '⎋'], origClose);
      select(document).call(keybinding);
      this.emit('done');
    };

    // Override the default modal close handler - we'll have it click "cancel"
    const keybinding = utilKeybinding('modal');
    keybinding.on(['⌫', '⎋'], this._clickedCancel);
    select(document).call(keybinding);

    let $wrap: D3Selection = $shaded.selectAll('.modal2-wrap')
      .data([0]);

    // enter
    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'modal2-wrap');  // need absolutely positioned div here for new stacking context

    const $$modal = $$wrap
      .append('div')
      .attr('class', 'modal rapid-modal modal-add-dataset')  // Rapid styling
      .style('opacity', 0);

    $$modal
      .append('button')
      .attr('class', 'close')
      .on('click', this._clickedCancel)
      .call(uiIcon('#rapid-icon-close'));

    $$modal
      .append('div')
      .attr('class', 'content');

    // update
    this.$wrap = $wrap = $wrap.merge($$wrap) as D3Selection;
    this.$modal = $wrap.selectAll('.modal-add-dataset');

    this.$modal
      .transition()
      .style('opacity', 1);

    this.render();
  }


  /**
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - `$modal` is always the parent.
   */
  public render(): void {
    if (!this.$modal) return;  // need to call `show()` first to create the modal.

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content = this.$modal.selectAll('.content');

    const prefix = 'rapid_add_dataset';  // prefix for text strings
    const accept = [
      '.gpx', 'application/gpx', 'application/gpx+xml',
      '.kml', 'application/vnd.google-earth.kml+xml', 'application/kml', 'application/kml+xml',
      '.geojson', '.json', 'application/geo+json', 'application/json', 'application/vnd.geo+json', 'text/x-json'
    ];

    /* Heading section */
    let $heading: D3Selection = $content.selectAll('.rapid-add-dataset-heading')
      .data([0]);

    const $$heading = $heading.enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-heading');

    const $$line1 = $$heading
      .append('div');

    $$line1
      .append('div')
      .attr('class', 'rapid-add-dataset-heading-icon')
      .call(uiIcon('#rapid-icon-data', 'icon-30'));

    $$line1
      .append('div')
      .attr('class', 'rapid-add-dataset-heading-text');


    // update
    $heading = $heading.merge($$heading) as D3Selection;

    $heading.selectAll('.rapid-add-dataset-heading-text')
      .text(l10n.t(`${prefix}.heading`));


    /* Text section */
    let $textSection: D3Selection = $content.selectAll('.rapid-add-dataset-text')
      .data([0]);

    // enter
    const $$textSection = $textSection.enter()
      .append('div')
      .attr('class', 'modal-section rapid-add-dataset-text');

    $$textSection
      .append('div')
      .attr('class', 'instructions-file');

    $$textSection
      .append('input')
      .attr('class', 'field-file')
      .attr('type', 'file')
      .attr('accept', accept.join())
      .on('change', (d3_event: Event) => {
        const files = (d3_event.target as HTMLInputElement).files;
        if (files?.length) {
          this._currFileList = files;
          this._currUrl = '';
          $textSection.select('.field-url').property('value', '');
        } else {
          this._currFileList = null;
        }
      });

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

    const data_instructions = l10n.t(`${prefix}.instructions`);
    const file_heading = l10n.t(`${prefix}.file.heading`);
    const file_instructions = l10n.t(`${prefix}.file.instructions`);
    const file_types = l10n.t(`${prefix}.file.types`);

    const fileHtml = marked.parse(`
${data_instructions}
&nbsp;<br>
&nbsp;<br>
### ${file_heading}
${file_instructions}
* ${file_types}
&nbsp;<br>
&nbsp;<br>
`);

    $textSection.selectAll('.instructions-file')
      .html(fileHtml as string);

    $textSection.selectAll('.field-file')
      .property('files', this._currFileList);  // works for all except IE11

    const data_or = l10n.t(`${prefix}.or`);
    const url_heading = l10n.t(`${prefix}.url.heading`);
    const url_instructions = l10n.t(`${prefix}.url.instructions`);
    const url_tokens = l10n.t(`${prefix}.url.tokens`);
    const url_xyz = l10n.t(`${prefix}.url.xyz`);
    const url_example_file = l10n.t(`${prefix}.url.example_file`);
    const url_example_xyz = l10n.t(`${prefix}.url.example_xyz`);
    const url_example_pmtiles = l10n.t(`${prefix}.url.example_pmtiles`);
    const example = l10n.t('example');

    const urlHtml = marked.parse(`
### ${data_or}
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
      .text(l10n.t('confirm.okay'));

    $buttons.selectAll('.cancel-button')
      .text(l10n.t('confirm.cancel'));
  }


}
