import { EventEmitter } from 'tseep/lib/ee-safe';
import { select, selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiNoteComments } from './UiNoteComments.ts';
import { UiNoteHeader } from './UiNoteHeader.ts';
import { UiNoteReport } from './UiNoteReport.ts';
import { UiViewOn } from './UiViewOn.ts';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { OsmNote } from '../services/OsmService.ts';


/**
 * The `UiNoteEditor` renders the sidebar editor for an OSM Note (header, comments,
 * comment/status actions, report link). Set the note via the public `datum` property
 * (and `newNote` to autofocus a fresh note), then call `.render($parent)`.
 * Emits `change` when the note is created/updated/cancelled.
 */
export class UiNoteEditor extends EventEmitter {
  public context: Context;
  public datum: OsmNote | null;
  public newNote: boolean;

  // D3 selections
  public $parent: D3Selection | null;

  // Child Components
  public NoteHeader: UiNoteHeader;
  public NoteComments: UiNoteComments;
  public NoteReport: UiNoteReport;
  public ViewOn: UiViewOn;

  protected _authWired: boolean;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this.datum = null;
    this.newNote = false;
    this._authWired = false;

    // D3 Selections
    this.$parent = null;

    // Create child components
    this.NoteHeader = new UiNoteHeader(context);
    this.NoteComments = new UiNoteComments(context);
    this.NoteReport = new UiNoteReport(context);
    this.ViewOn = new UiViewOn(context);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._saveSection = this._saveSection.bind(this);
    this._userDetails = this._userDetails.bind(this);
    this._buttons = this._buttons.bind(this);
    this._clickCancel = this._clickCancel.bind(this);
    this._clickSave = this._clickSave.bind(this);
    this._clickStatus = this._clickStatus.bind(this);
    this._clickComment = this._clickComment.bind(this);
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
    const osm = context.services.osm as any;

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
      .text(l10n.t('note.title'));


    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor: D3Selection = $body.selectAll('.note-editor')
      .data([0]);

    this.NoteHeader.datum = this.datum;
    this.NoteComments.datum = this.datum;

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section note-editor')
      .merge($editor)
      .call(this.NoteHeader.render)
      .call(this.NoteComments.render)
      .call(this._saveSection);

    this.ViewOn.stringID = 'inspector.view_on_osm';
    this.ViewOn.url = osm?.noteURL(this.datum);

    this.NoteReport.datum = this.datum;

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this.ViewOn.render)
      .call(this.NoteReport.render);


    // rerender the note editor on any auth change (wire once to avoid leaking listeners)
    if (osm && !this._authWired) {
      this._authWired = true;
      osm.on('authchange', this.render);
    }
  }


  /**
   * Renders the save/comment section (textarea, user details, action buttons).
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _saveSection($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;  // optional

    const isSelected = (this.datum && this.datum.id === context.selectedIDs()[0]);
    let $noteSave: D3Selection = $selection.selectAll('.note-save')
      .data((isSelected ? [this.datum] : []), (d: OsmNote) => d.key!);

    // fast submit if user presses cmd+enter
    const keydown = (d3_event: KeyboardEvent): void => {
      if (!(d3_event.keyCode === 13 && d3_event.metaKey)) return; // ↩ Return

      const osm = context.services.osm!;
      if (!osm) return;
      if (!osm.authenticated()) return;
      if (!this.datum!.props.newComment) return;

      d3_event.preventDefault();

      select(d3_event.currentTarget as HTMLTextAreaElement)
        .on('keydown.note-input', null);

      // focus on button and submit (scheduler defers a tick; without it, do it now)
      const submit = () => {
        if (this.datum!.isNew) {
          ($noteSave.selectAll('.save-button').node() as HTMLElement).focus();
          this._clickSave(this.datum as any);
        } else {
          ($noteSave.selectAll('.comment-button').node() as HTMLElement).focus();
          this._clickComment(this.datum as any);
        }
      };
      if (scheduler) {
        scheduler.setTimeout('keydown-note-submit', submit, { ms: 10 });
      } else {
        submit();
      }
    };

    const changeInput = (d3_event: Event): void => {
      const $input: D3Selection = select(d3_event.currentTarget as HTMLTextAreaElement);
      const val = ($input.property('value') as string).trim() || undefined;

      // store the unsaved comment with the note itself
      this.datum = this.datum!.update({ newComment: val });

      const osm = context.services.osm!;
      if (osm) {
        osm.replaceNote(this.datum!);  // update note cache
      }

      $noteSave
        .call(this._buttons);
    };

    // exit
    $noteSave.exit()
      .remove();

    // enter
    const $$noteSave: D3EnterSelection = $noteSave.enter()
      .append('div')
      .attr('class', 'note-save save-section');

    $$noteSave
      .append('h4')
      .attr('class', '.note-save-header');

    const $$textarea: D3EnterSelection = $$noteSave
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('placeholder', l10n.t('note.inputPlaceholder'))
      .attr('maxlength', 1000)
      .property('value', (d: OsmNote) => d.props.newComment ?? '')
      .call(utilNoAuto)
      .on('keydown.note-input', keydown)
      .on('input.note-input', changeInput)
      .on('blur.note-input', changeInput);

    if (!$$textarea.empty() && this.newNote) {
      // autofocus the comment field for new notes
      ($$textarea.node() as HTMLElement).focus();
    }

    // update
    $noteSave = $noteSave.merge($$noteSave);

    $noteSave.select('h4')
      .text(this.datum!.isNew ? l10n.t('note.newDescription') : l10n.t('note.newComment'));

    $noteSave
      .call(this._userDetails)
      .call(this._buttons);
  }


  /**
   * Renders the logged-in user details and auth warning.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  protected _userDetails($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm!;

    let $detail: D3Selection = $selection.selectAll('.detail-section')
      .data([0]);

    $detail = $detail.enter()
      .append('div')
      .attr('class', 'detail-section')
      .merge($detail);

    if (!osm) return;

    // Add warning if user is not logged in
    const hasAuth = osm.authenticated();
    const $auth = $detail.selectAll('.auth-warning')
      .data(hasAuth ? [] : [0]);

    $auth.exit()
      .transition()
      .duration(200)
      .style('opacity', 0)
      .remove();

    const $$auth = $auth.enter()
      .insert('div', '.tag-reference-body')
      .attr('class', 'field-warning auth-warning')
      .style('opacity', 0);

    $$auth
      .call(uiIcon('#rapid-icon-alert', 'inline'));

    $$auth
      .append('span')
      .text(l10n.t('note.login'));

    $$auth
      .append('a')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-out-link', 'inline'))
      .append('span')
      .text(l10n.t('login'))
      .on('click.note-login', (e: Event) => {
        e.preventDefault();
        osm.authenticate();
      });

    $$auth
      .transition()
      .duration(200)
      .style('opacity', 1);


    let $prose: D3Selection = $detail.selectAll('.note-save-prose')
      .data(hasAuth ? [0] : []);

    $prose.exit()
      .remove();

    $prose = $prose.enter()
      .append('p')
      .attr('class', 'note-save-prose')
      .merge($prose);

    $prose.text(l10n.t('note.upload_explanation'));

    osm.getUserDetailsAsync()
      .then((user: any) => {
        const $userLink = select(document.createElement('div'));

        const href = user?.img?.href;
        if (href) {
          $userLink
            .append('img')
            .attr('src', href)
            .attr('class', 'icon pre-text user-icon');
        }

        $userLink
          .append('a')
          .attr('class', 'user-info')
          .text(user.display_name)
          .attr('href', osm.userURL(user.display_name))
          .attr('target', '_blank');

        $prose
          .html(l10n.tHtml('note.upload_explanation_with_user', { user: $userLink.html() }));
      });
  }


  /**
   * Renders the cancel/save/status/comment action buttons.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  protected _buttons($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm!;

    const hasAuth = osm && osm.authenticated();
    const isSelected = (this.datum && this.datum.id === context.selectedIDs()[0]);

    const isSaveDisabled = (d: OsmNote): true | null => {
      return (hasAuth && d.props.status === 'open' && d.props.newComment) ? null : true;
    };

    let $buttons: D3Selection = $selection.selectAll('.buttons')
      .data((isSelected ? [this.datum] : []), (d: OsmNote) => d.key!);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'buttons');

    if (this.datum!.isNew) {
      $$buttons
        .append('button')
        .attr('class', 'button cancel-button secondary-action');

      $$buttons
        .append('button')
        .attr('class', 'button save-button action');

    } else {
      $$buttons
        .append('button')
        .attr('class', 'button status-button action');

      $$buttons
        .append('button')
        .attr('class', 'button comment-button action');
    }


    // update
    $buttons = $buttons
      .merge($$buttons);

    $buttons.select('.cancel-button')   // select and propagate data
      .text(l10n.t('text.cancel'))
      .on('click.cancel', this._clickCancel);

    $buttons.select('.save-button')     // select and propagate data
      .attr('disabled', isSaveDisabled)
      .text(l10n.t('note.save'))
      .on('click.save', this._clickSave);

    $buttons.select('.status-button')   // select and propagate data
      .attr('disabled', (hasAuth ? null : true))
      .text((d: OsmNote) => {
        const action = (d.props.status === 'open' ? 'close' : 'open');
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t('note.' + action + andComment);
      })
      .on('click.status', this._clickStatus);

    $buttons.select('.comment-button')   // select and propagate data
      .attr('disabled', isSaveDisabled)
      .text(l10n.t('text.comment'))
      .on('click.comment', this._clickComment);
  }


  /**
   * Handles clicking the cancel button (removes a new note and returns to browse).
   * @param d3_event - the triggering click event
   * @param d - the bound note datum
   */
  protected _clickCancel(d3_event: Event, d: OsmNote): void {
    (d3_event?.currentTarget as HTMLElement | undefined)?.blur();    // avoid keeping focus on the button - iD#4641
    const osm = this.context.services.osm!;
    if (osm) {
      osm.removeNote(d);
    }
    this.context.enter('browse');
    this.emit('change');
  }


  /**
   * Handles clicking the save button (creates a new note).
   * @param d3_event - the triggering click event
   * @param d - the bound note datum
   */
  protected _clickSave(d3_event: Event, d?: OsmNote): void {
    (d3_event?.currentTarget as HTMLElement | undefined)?.blur();    // avoid keeping focus on the button - iD#4641
    const osm = this.context.services.osm!;
    if (osm) {
      osm.postNoteCreate(d!, (err: any, note: any) => {
        this.emit('change', note);
      });
    }
  }


  /**
   * Handles clicking the status button (toggles the note open/closed).
   * @param d3_event - the triggering click event
   * @param d - the bound note datum
   */
  protected _clickStatus(d3_event: Event, d: OsmNote): void {
    (d3_event?.currentTarget as HTMLElement | undefined)?.blur();    // avoid keeping focus on the button - iD#4641
    const osm = this.context.services.osm!;
    if (osm) {
      const setStatus = (d.props.status === 'open' ? 'closed' : 'open');
      osm.postNoteUpdate(d, setStatus, (err: any, note: any) => {
        this.emit('change', note);
      });
    }
  }


  /**
   * Handles clicking the comment button (posts a comment to the note).
   * @param d3_event - the triggering click event
   * @param d - the bound note datum
   */
  protected _clickComment(d3_event: Event, d?: OsmNote): void {
    (d3_event?.currentTarget as HTMLElement | undefined)?.blur();    // avoid keeping focus on the button - iD#4641
    const osm = this.context.services.osm!;
    if (osm) {
      osm.postNoteUpdate(d!, d!.props.status!, (err: any, note: any) => {
        this.emit('change', note);
      });
    }
  }
}
