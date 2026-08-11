import { selection } from 'd3-selection';
import { marked } from 'marked';
import { uiIcon } from './icon.ts';
//import { UiTooltip } from './UiTooltip.ts';
import { utilSanitizeHTML } from '../util/sanitize.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { GeoJSONData } from '../data/GeoJSONData.ts';

const OVERTURE_CYAN = '#00ffff';


/**
 * The OvertureInspector is a UI component for viewing Overture Entities in the sidebar.
 * Because Overture entities conform to a certain schema, we might at some point build a JSON-Schema-aware
 * version of this code that modifies the display of the data.
 *
 * @example
 *  <div class='overture-inspector'>
 *    <div class='header'>…</div>
 *    <div class='body'>
 *      <div class='feature-info'>
 *        <div class='dataset-label'/>             // Dataset name, e.g. "Places" or "Buildings"
 *      </div>
 *      <div class='property-info'>
 *        <div class='property-bag'>               // List of `key=value` properties on this feature
 *          …
 *        </div>
 *      <div>
 *      <div class='overture-inspector-notice'/>   // Legal notice, required in some situations
 *    </div>
 *  </div>
 */
export class UiOvertureInspector {
  public context: Context;
  public datum: GeoJSONData | null;

  // D3 Selections
  public $parent: D3Selection | null;
  public $inspector: D3Selection | null;

//  // Child Components
//  public AcceptTooltip: UiTooltip;
//  public IgnoreTooltip: UiTooltip;

  protected _keys: any;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this.datum = null;
    this._keys = null;

    // D3 selections
    this.$parent = null;
    this.$inspector = null;

//    // Create child components
//    this.AcceptTooltip = new UiTooltip(context).placement('bottom');
//    this.IgnoreTooltip = new UiTooltip(context).placement('bottom');

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.renderFeatureInfo = this.renderFeatureInfo.bind(this);
    this.renderPropertyInfo = this.renderPropertyInfo.bind(this);
    this.renderNotice = this.renderNotice.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders.)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const assets = context.systems.assets!;
    const l10n = context.systems.l10n!;
    const rtl = l10n.isRTL ? '-rtl' : '';

    let $inspector: D3Selection = $parent.selectAll('.overture-inspector')
      .data([0]);

    const $$inspector = $inspector.enter()
      .append('div')
      .attr('class', 'overture-inspector');


    // add `.header`
    const $$header = $$inspector
      .append('div')
      .attr('class', 'header');

    $$header
      .append('h3')
      .append('img')
      .attr('class', 'wordmark-overture');

    $$header
      .append('button')
      .attr('class', 'overture-inspector-close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    // add `.body`
    $$inspector
      .append('div')
      .attr('class', 'body');

    // update
    this.$inspector = $inspector = $inspector.merge($$inspector);
    $inspector.selectAll('img.wordmark-overture')
      .attr('src', assets.getFileURL(`img/omf-wordmark${rtl}.svg`));

    // localize logo
    $inspector.selectAll('.logo-overture > use')
      .attr('xlink:href', `#overture-logo-overture-wordmark${rtl}`);

    $inspector.selectAll('.body')
      .call(this.renderFeatureInfo)
      .call(this.renderPropertyInfo)
      .call(this.renderNotice);
  }


  /**
   * This is used to get the brightness of the given hex color.
   * (We use this to know whether text written over this color should be light or dark).
   * https://www.w3.org/TR/AERT#color-contrast
   * https://stackoverflow.com/questions/49437263/contrast-between-label-and-background-determine-if-color-is-light-or-dark/49437644#49437644
   * @param  color - a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa'  (alpha values are ignored)
   * @return A number representing the perceived brightness
   */
  public getBrightness(color: string): number {
    const short = (color.length < 6);
    const r = parseInt(short ? color[1] + color[1] : color[1] + color[2], 16);
    const g = parseInt(short ? color[2] + color[2] : color[3] + color[4], 16);
    const b = parseInt(short ? color[3] + color[3] : color[5] + color[6], 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000;
  }


  /**
   * Renders the 'feature-info' section (the dataset name)
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderFeatureInfo($selection: D3Selection): void {
    const context = this.context;
    const rapid = context.systems.rapid!;

    const datum = this.datum;
    const datasetID = (datum?.props?.datasetID ?? '') as DatasetID;
    const dataset = rapid.datasets.get(datasetID);
    const color = dataset?.color ?? OVERTURE_CYAN;

    let $featureInfo: D3Selection = $selection.selectAll('.feature-info')
      .data(datum ? [datum] : [], d => d.id);

    // exit
    $featureInfo.exit()
      .remove();

    // enter
    const $$featureInfo = $featureInfo.enter()
      .append('div')
      .attr('class', 'feature-info');

    $$featureInfo
      .append('div')
      .attr('class', 'dataset-label');

    // update
    $featureInfo = $featureInfo.merge($$featureInfo);

    $featureInfo
      .style('background', color)
      .style('color', this.getBrightness(color) > 140.5 ? '#333' : '#fff');

    $featureInfo.selectAll('.dataset-label')
      .text(dataset?.getLabel() || '');
  }


  /**
   * Renders the 'property-info' section
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderPropertyInfo($selection: D3Selection): void {
    const datum = this.datum;
    const properties = datum?.properties || {};

    const $propInfo: D3Selection = $selection.selectAll('.property-info')
      .data(datum ? [datum] : [], d => d.id);

    // exit
    $propInfo.exit()
      .remove();

    // enter
    const $$propInfo: D3EnterSelection = $propInfo.enter()
      .append('div')
      .attr('class', 'property-info');

    const $$propBag: D3EnterSelection = $$propInfo
      .append('div')
      .attr('class', 'property-bag');


    // Overture properties can come to us as strings, JSON arrays, or JSON objects. Handle all three!
    for (const [k, v] of Object.entries(properties) as [string, any][]) {
      const $$propHeading = $$propBag
        .append('div')
        .attr('class', 'property-heading');

      let key = k;

      // Some params come to us via pmtiles with a prepended '@' sign.
      if (key.startsWith('@')) {
        key = key.slice(1);
      }
      key = key.charAt(0).toUpperCase() + key.slice(1);

      $$propHeading
        .text(key);

      const $$tagEntry = $$propBag
        .append('div')
        .attr('class', 'property-entry');

      const parsedJson = this._getJsonStructure(v);
      if (parsedJson === null) continue;

      if (Object.keys(parsedJson).length !== 0) {
        // Object processing
        if (!Array.isArray(parsedJson)) {
          for (const [k1, v1] of Object.entries(parsedJson)) {
            $$tagEntry.append('div').attr('class', 'property-value').text(k1 + ':' + v1);
          }

        // Array processing
        } else {
          for (const entry of parsedJson) {
            if (entry instanceof Object ) {
              for (const [k1, v1] of Object.entries(entry)){
                $$tagEntry.append('div').attr('class', 'property-value').text(k1 + ':' + v1);
              }
            } else {
              $$tagEntry.append('div').attr('class', 'property-value').text(entry);
            }
          }
        }
      } else {
        // String handling- just make a key/value pair.
        $$tagEntry.append('div').attr('class', 'property-value').text(v);
      }
    }
  }


  /**
   * Test the values we receive from the Overture data,
   * which may be strings, JSON arrays, or JSON objects.
   * @param   str - the value to test and parse
   * @returns null if the str isn't a string, empty object {} if the string can't be parsed into JSON, or the parsed object.
   */
  protected _getJsonStructure(str: any): any {
    if (typeof str !== 'string') return null;
    try {
      const result = JSON.parse(str);
      return result;
    } catch (err) {
      return {};
    }
  }


  /**
   * Renders the 'overture-inspector-notice' section
   * This section contains remarks about the data - license, usage, or other hints
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderNotice($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;

    const datasetID = this.datum?.props?.datasetID as DatasetID || '';
    const dataset = rapid.datasets.get(datasetID);
    const showNotice = dataset?.tags.has('opendata') && !!dataset?.licenseUrl;

    // Only display notice and link if the dataset is tagged as open data (for now)
    let $notice: D3Selection = $selection.selectAll('.overture-inspector-notice')
      .data(showNotice ? [ dataset?.licenseUrl ] : []);

    // exit
    $notice.exit()
      .remove();

    // enter
    const $$notice: D3EnterSelection = $notice.enter()
      .append('div')
      .attr('class', 'overture-inspector-notice');

    // update
    $notice = $notice.merge($$notice);

    $notice
      .html(d => utilSanitizeHTML(marked.parse(l10n.t('rapid_inspector.notice.open_data', { url: d })) as string));

    $notice.selectAll('a')   // links in markdown should open in new page
      .attr('target', '_blank');
  }
}
