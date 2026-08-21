import { EventEmitter } from 'tseep/lib/ee-safe';
import { select, selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiKeepRightDetails } from './UiKeepRightDetails.ts';
import { UiKeepRightHeader } from './UiKeepRightHeader.ts';
import { UiViewOn } from './UiViewOn.ts';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { KeepRightIssue } from '../services/KeepRightService.ts';


/**
 * `UiKeepRightEditor` renders the sidebar editor for a KeepRight QA issue
 * (header, details, comment + action buttons). Set the issue via the public `datum`
 * property, then call `.render($parent)`. Emits `change` when the issue is updated.
 */
export class UiKeepRightEditor extends EventEmitter {
  public context: Context;
  public datum: KeepRightIssue | null;

  // D3 selections
  public $parent: D3Selection | null;

  // Child components
  public KeepRightHeader: UiKeepRightHeader;
  public KeepRightDetails: UiKeepRightDetails;
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
    this.KeepRightHeader = new UiKeepRightHeader(context);
    this.KeepRightDetails = new UiKeepRightDetails(context);
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
    const keepright = context.services.keepright;

    let $header: D3Selection = $parent.selectAll('.header')
      .data([0]);

    const $$header: D3EnterSelection = $header.enter()
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
      .text(l10n.t('QA.keepRight.title'));


    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor: D3Selection = $body.selectAll('.qa-editor')
      .data([0]);

    this.KeepRightHeader.datum = this.datum;
    this.KeepRightDetails.datum = this.datum;

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($editor)
      .call(this.KeepRightHeader.render)
      .call(this.KeepRightDetails.render)
      .call(this._saveSection);


    this.ViewOn.stringID = 'inspector.view_on_keepright';
    this.ViewOn.url = keepright ? keepright.issueURL(this.datum!) : '';

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this.ViewOn.render);
  }


  /**
   * Renders the comment textarea and save/action buttons for the issue.
   * @param $selection - A d3-selection to render the save section into
   */
  protected _saveSection($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const keepright = context.services.keepright;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);
    const isShown = (this.datum && (isSelected || this.datum.props.newComment || this.datum.props.comment));

    let $saveSection: D3Selection = $selection.selectAll('.qa-save')
      .data(isShown ? [this.datum!] : [], (d: KeepRightIssue) => d.key!);

    const changeInput = (d3_event: Event): void => {
      const $input = select(d3_event.currentTarget as HTMLTextAreaElement);
      let val: string | undefined = ($input.property('value') as string).trim();

      if (val === this.datum!.props.comment) {
        val = undefined;
      }

      // store the unsaved comment with the issue itself
      this.datum = this.datum!.update({ newComment: val });

      if (keepright) {
        keepright.replaceItem(this.datum);  // update keepright cache
      }

      $saveSection
        .call(this._saveButtons);
    };

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection: D3EnterSelection = $saveSection.enter()
      .append('div')
      .attr('class', 'qa-save save-section');

    $$saveSection
      .append('h4')
      .attr('class', '.qa-save-header');

    $$saveSection
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('maxlength', 1000)
      .property('value', (d: KeepRightIssue) => d.props.newComment || d.props.comment || '')
      .call(utilNoAuto)
      .on('input', changeInput)
      .on('blur', changeInput);

    // update
    $saveSection = $saveSection
      .merge($$saveSection);

    $saveSection.select('h4')
      .text(l10n.t('text.comment'));

    $saveSection.select('.new-comment-input')
      .attr('placeholder', l10n.t('QA.keepRight.comment_placeholder'));

    $saveSection
      .call(this._saveButtons);
  }


  /**
   * Renders the comment/close/ignore action buttons for the issue.
   * @param $selection - A d3-selection to render the buttons into
   */
  protected _saveButtons($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const keepright = context.services.keepright;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons: D3Selection = $selection.selectAll('.buttons')
      .data(isSelected ? [this.datum] : [], (d: KeepRightIssue) => d.key!);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'buttons');

    $$buttons
      .append('button')
      .attr('class', 'button comment-button action');

    $$buttons
      .append('button')
      .attr('class', 'button close-button action');

    $$buttons
      .append('button')
      .attr('class', 'button ignore-button action');

    // update
    $buttons = $buttons
      .merge($$buttons);

    $buttons.select('.comment-button')   // select and propagate data
      .attr('disabled', (d: KeepRightIssue) => d.props.newComment ? null : true)
      .text(l10n.t('QA.keepRight.save_comment'))
      .on('click.comment', (d3_event: Event, d: KeepRightIssue) => {
        (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          keepright.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });

    $buttons.select('.close-button')   // select and propagate data
      .text((d: KeepRightIssue) => {
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t(`QA.keepRight.close${andComment}`);
      })
      .on('click.close', (d3_event: Event, d: KeepRightIssue) => {
        (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          d.props.newStatus = 'ignore_t';   // ignore temporarily (item fixed)
          keepright.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });

    $buttons.select('.ignore-button')   // select and propagate data
      .text((d: KeepRightIssue) => {
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t(`QA.keepRight.ignore${andComment}`);
      })
      .on('click.ignore', (d3_event: Event, d: KeepRightIssue) => {
        (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          d.props.newStatus = 'ignore';   // ignore permanently (false positive)
          keepright.postUpdate(d, (err: any, item: any) => this.emit('change', item));
        }
      });
  }
}
