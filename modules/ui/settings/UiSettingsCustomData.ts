import { EventEmitter } from 'tseep/lib/ee-safe';
import { marked } from 'marked';
import { UiConfirm } from '../UiConfirm.ts';
import { utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


const PREFIX = 'settings.custom_data';  // prefix for text strings

const ACCEPT = [
  '.gpx', 'application/gpx', 'application/gpx+xml',
  '.kml', 'application/vnd.google-earth.kml+xml', 'application/kml', 'application/kml+xml',
  '.geojson', '.json', 'application/geo+json', 'application/json', 'application/vnd.geo+json', 'text/x-json'
];


/**
 * The `UiSettingsCustomData` renders a modal for supplying a custom data file or URL.
 * Call `.render()` to open it; emits `change` with the new settings on save.
 */
export class UiSettingsCustomData extends EventEmitter {
  public context: Context;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash!;

    const dataLayer = scene.layers.get('custom-data') as any;

    // Keep separate copies of original and current settings
    // Take initial values from urlhash first, stored settings second
    const origUrl = urlhash.getParam('data') || urlhash.getParam('gpx') || settings?.get('ui.customData.url');
    const origFileList = (dataLayer && dataLayer.getFileList()) || null;
    let _currUrl = origUrl;
    let _currFileList = origFileList;

    const Modal = new UiConfirm(context).show().okButton();

    Modal.$shaded!
      .classed('settings-modal settings-custom-data', true);

    Modal.$header!
      .append('h3')
      .text(l10n.t(`${PREFIX}.header`));


    const $textSection: D3Selection = Modal.$message!;

    const data_instructions = l10n.t(`${PREFIX}.instructions`);
    const file_heading = l10n.t(`${PREFIX}.file.heading`);
    const file_instructions = l10n.t(`${PREFIX}.file.instructions`);
    const file_types = l10n.t(`${PREFIX}.file.types`);
    const file_tip = l10n.t(`${PREFIX}.file.tip`);

    const fileHtml = marked.parse(`
${data_instructions}
&nbsp;<br>
&nbsp;<br>
### ${file_heading}
${file_instructions}
* ${file_types}
&nbsp;<br>
&nbsp;<br>
${file_tip}
`) as string;

    $textSection
      .append('div')
      .attr('class', 'instructions-template')
      .html(fileHtml);

    $textSection
      .append('input')
      .attr('class', 'field-file')
      .attr('type', 'file')
      .attr('accept', ACCEPT.join())
      .property('files', _currFileList)  // works for all except IE11
      .on('change', (d3_event: Event) => {
        const files = (d3_event.target as HTMLInputElement).files;
        if (files?.length) {
          _currFileList = files;
          _currUrl = '';
          $textSection.select('.field-url').property('value', '');
        } else {
          _currFileList = null;
        }
      });

    const data_or = l10n.t(`${PREFIX}.or`);
    const url_heading = l10n.t(`${PREFIX}.url.heading`);
    const url_instructions = l10n.t(`${PREFIX}.url.instructions`);
    const url_tokens = l10n.t(`${PREFIX}.url.tokens`);
    const url_xyz = l10n.t(`${PREFIX}.url.xyz`);
    const url_example_file = l10n.t(`${PREFIX}.url.example_file`);
    const url_example_xyz = l10n.t(`${PREFIX}.url.example_xyz`);
    const url_example_pmtiles = l10n.t(`${PREFIX}.url.example_pmtiles`);
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
`) as string;

    $textSection
      .append('div')
      .attr('class', 'instructions-template')
      .html(urlHtml);

    $textSection
      .append('textarea')
      .attr('class', 'field-url')
      .attr('placeholder', l10n.t(`${PREFIX}.url.placeholder`))
      .call(utilNoAuto)
      .property('value', _currUrl);


    // Setup Ok/Cancel buttons
    const $buttonSection = Modal.$buttons!;

    $buttonSection
      .insert('button', '.ok-button')
      .attr('class', 'button cancel-button secondary-action')
      .text(l10n.t('confirm.cancel'));

    // Restore the original settings
    const clickCancel = (d3_event: Event): void => {
      $textSection.select('.field-url').property('value', origUrl);
      settings?.set('ui.customData.url', origUrl || '');
      (d3_event.currentTarget as HTMLElement).blur();
      Modal.close();
    };

    // Accept the current settings
    const clickSave = (d3_event: Event): void => {
      _currUrl = $textSection.select('.field-url').property('value').trim();

      let currSettings = {};

      // One or the other but not both
      if (_currUrl) {
        currSettings = { url: _currUrl, fileList: null };
        settings?.set('ui.customData.url', _currUrl);
      } else if (_currFileList)  {
        currSettings = { url: null, fileList: _currFileList };
      }

      (d3_event.currentTarget as HTMLElement).blur();
      Modal.close();
      this.emit('change', currSettings);
    };

    $buttonSection.select('.cancel-button')
      .on('click.cancel', clickCancel);

    $buttonSection.select('.ok-button')
      .attr('disabled', null)  // why is this here?
      .on('click.save', clickSave);
  }
}
