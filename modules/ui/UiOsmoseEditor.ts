import { selection } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';

import { UiOsmoseDetails } from './UiOsmoseDetails.js';
import { UiOsmoseHeader } from './UiOsmoseHeader.js';
import { uiIcon } from './icon.js';
import { UiViewOn } from './UiViewOn.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiOsmoseEditor` renders the sidebar editor for an Osmose QA issue
 * (header, details, action buttons). Set the issue via the public `datum` property,
 * then call `.render($parent)`. Emits `change` when the issue is updated.
 */
export class UiOsmoseEditor extends EventEmitter {
  public context: Context;
  public datum: any;

  // D3 selections
  public $parent: D3Selection | null;

  protected _header: UiOsmoseHeader;
  protected _details: UiOsmoseDetails;
  protected _viewOn: UiViewOn;

  public constructor(context: Context) {
    super();
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    this._header = new UiOsmoseHeader(context);
    this._details = new UiOsmoseDetails(context);
    this._viewOn = new UiViewOn(context);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._saveSection = this._saveSection.bind(this);
    this._saveButtons = this._saveButtons.bind(this);
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
    const osmose = context.services.osmose as any;

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
      .text(l10n.t('QA.osmose.title'));

    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor: D3Selection = $body.selectAll('.qa-editor')
      .data([0]);

    this._header.datum = this.datum;
    this._details.datum = this.datum;

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($editor)
      .call(this._header.render)
      .call(this._details.render)
      .call(this._saveSection);

    this._viewOn.stringID = 'inspector.view_on_osmose';
    this._viewOn.url = osmose ? osmose.itemURL(this.datum) : '';

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this._viewOn.render);
  }


  /**
   * Renders the save section wrapper for the issue when it is selected.
   * @param $selection - A d3-selection to render the save section into
   */
  protected _saveSection($selection: D3Selection): void {
    const errID = this.datum?.id;
    const isSelected = errID && this.context.selectedData().has(errID);
    const isShown = (this.datum && isSelected);

    let $saveSection: D3Selection = $selection.selectAll('.qa-save')
      .data(isShown ? [this.datum] : [], (d: any) => d.key);

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection = $saveSection.enter()
      .append('div')
      .attr('class', 'qa-save save-section');

    // update
    $saveSection = ($$saveSection as D3Selection)
      .merge($saveSection)
      .call(this._saveButtons);
  }


  /**
   * Renders the close/ignore action buttons for the issue.
   * @param $selection - A d3-selection to render the buttons into
   */
  protected _saveButtons($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const osmose = context.services.osmose as any;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons: D3Selection = $selection.selectAll('.buttons')
      .data(isSelected ? [this.datum] : [], (d: any) => d.key);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'buttons');

    $$buttons
      .append('button')
      .attr('class', 'button close-button action');

    $$buttons
      .append('button')
      .attr('class', 'button ignore-button action');

    // update
    $buttons = $buttons
      .merge($$buttons);

    $buttons.select('.close-button')
      .text(l10n.t('QA.keepRight.close'))
      .on('click.close', (d3_event: Event, d: any) => {
        (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (osmose) {
          d.props.newStatus = 'done';
          d.touch();
          osmose.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });

    $buttons.select('.ignore-button')
      .text(l10n.t('QA.keepRight.ignore'))
      .on('click.ignore', (d3_event: Event, d: any) => {
        (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (osmose) {
          d.props.newStatus = 'false';
          d.touch();
          osmose.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });
  }
}
