import { selection } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { UiOsmoseDetails } from './UiOsmoseDetails.ts';
import { UiOsmoseHeader } from './UiOsmoseHeader.ts';
import { uiIcon } from './icon.ts';
import { UiViewOn } from './UiViewOn.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmoseIssue } from '../services/OsmoseService.ts';


/**
 * `UiOsmoseEditor` renders the sidebar editor for an Osmose QA issue
 * (header, details, action buttons). Set the issue via the public `datum` property,
 * then call `.render($parent)`. Emits `change` when the issue is updated.
 */
export class UiOsmoseEditor extends EventEmitter {
  public context: Context;
  public datum: OsmoseIssue | null;

  // D3 selections
  public $parent: D3Selection | null;

  // Child components
  public OsmoseHeader: UiOsmoseHeader;
  public OsmoseDetails: UiOsmoseDetails;
  public ViewOn: UiViewOn;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    // Create child components
    this.OsmoseHeader = new UiOsmoseHeader(context);
    this.OsmoseDetails = new UiOsmoseDetails(context);
    this.ViewOn = new UiViewOn(context);

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
    const osmose = context.services.osmose;

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

    this.OsmoseHeader.datum = this.datum;
    this.OsmoseDetails.datum = this.datum;

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($editor)
      .call(this.OsmoseHeader.render)
      .call(this.OsmoseDetails.render)
      .call(this._saveSection);

    this.ViewOn.stringID = 'inspector.view_on_osmose';
    this.ViewOn.url = osmose ? osmose.itemURL(this.datum!) : '';

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this.ViewOn.render);
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
      .data(isShown ? [this.datum] : [], (d: OsmoseIssue) => d.key!);

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
    const osmose2 = context.services.osmose!;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons: D3Selection = $selection.selectAll('.buttons')
      .data(isSelected ? [this.datum] : [], (d: OsmoseIssue) => d.key!);

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
      .on('click', (e: PointerEvent, d: OsmoseIssue) => {
        (e.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (osmose2) {
          d.props.newStatus = 'done';
          d.touch();
          osmose2.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });

    $buttons.select('.ignore-button')
      .text(l10n.t('QA.keepRight.ignore'))
      .on('click', (e: PointerEvent, d: OsmoseIssue) => {
        (e.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (osmose2) {
          d.props.newStatus = 'false';
          d.touch();
          osmose2.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });
  }
}
