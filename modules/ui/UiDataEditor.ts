import { selection } from 'd3-selection';

import { uiIcon } from './icon.js';
import { UiDataHeader } from './UiDataHeader.js';
import { UiSectionRawTagEditor } from './sections/UiSectionRawTagEditor.js';
import { utilObjectOmit } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiDataEditor` renders the sidebar editor for custom/vector map data features.
 * Set the feature to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiDataEditor {
  public context: Context;
  public datum: any;

  protected _dataHeader: UiDataHeader;
  protected _rawTagEditor: UiSectionRawTagEditor;

  // D3 selections
  public $parent: D3Selection | null;

  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    this._dataHeader = new UiDataHeader(context);
    this._rawTagEditor = new UiSectionRawTagEditor(context, 'custom-data-tag-editor')
      .readOnlyTags([/./]);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;

    let $header: D3Selection = $parent.selectAll('.header')
      .data([0]);

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3');

    // update
    $header = $header.merge($$header);
    $header.select('h3')
      .text(l10n.t('map_data.title'));


    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor: D3Selection = $body.selectAll('.data-editor')
      .data([0]);

    // enter/update
    this._dataHeader.datum = this.datum;
    $editor.enter()
      .append('div')
      .attr('class', 'modal-section data-editor')
      .merge($editor)
      .call(this._dataHeader.render);

    const $rawTagEditor: D3Selection = $body.selectAll('.data-tag-editor')
      .data([0]);

    // enter/update
    $rawTagEditor.enter()
      .append('div')
      .attr('class', 'data-tag-editor')
      .merge($rawTagEditor)
      .call(this._rawTagEditor
        .tags((this.datum?.properties) || {})
        .state('hover')
        .render
      )
      .selectAll('textarea.tag-text')
      .attr('readonly', true)
      .classed('readonly', true);


// DEBUG
    const props = utilObjectOmit(this.datum?.props ?? {}, ['geojson']);
    const propsStr = Object.entries(props).reduce((acc, item) => {
      const line = `${item[0]} = ${item[1]}\n`;
      return acc += line;
    }, '');

    const $propInspector = $body.selectAll('.data-prop-inspector')
      .data([this.datum], (d: any) => d.id);

    $propInspector.exit()
      .remove();

    $propInspector.enter()
      .append('pre')
      .attr('class', 'data-prop-inspector')
      .text(propsStr);
  }
}
