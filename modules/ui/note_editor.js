import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { uiIcon } from './icon.js';
import { uiNoteComments } from './note_comments.js';
import { uiNoteHeader } from './note_header.js';
import { uiNoteReport } from './note_report.js';
import { UiViewOn } from './UiViewOn.js';
import { utilNoAuto, utilRebind } from '../util/index.js';


export function uiNoteEditor(context) {
  const l10n = context.systems.l10n;
  const dispatch = d3_dispatch('change');
  const noteComments = uiNoteComments(context);
  const noteHeader = uiNoteHeader(context);
  const ViewOn = new UiViewOn(context);

  let _note;
  let _newNote;


  function render($selection) {
    const osm = context.services.osm;

    let $header = $selection.selectAll('.header')
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
      .append('h3')
      .text(l10n.t('note.title'));


    let $body = $selection.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    let $editor = $body.selectAll('.note-editor')
      .data([0]);

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section note-editor')
      .merge($editor)
      .call(noteHeader.note(_note))
      .call(noteComments.note(_note))
      .call(noteSaveSection);

    ViewOn.stringID = 'inspector.view_on_osm';
    ViewOn.url = osm?.noteURL(_note);

    const $footer = $selection.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(ViewOn.render)
      .call(uiNoteReport(context).note(_note));


    // rerender the note editor on any auth change
    if (osm) {
      osm.on('authchange', () => {
        $selection.call(render);
      });
    }
  }


  function noteSaveSection($selection) {
    const isSelected = (_note && _note.id === context.selectedIDs()[0]);
    let $noteSave = $selection.selectAll('.note-save')
      .data((isSelected ? [_note] : []), d => d.key);

    // exit
    $noteSave.exit()
      .remove();

    // enter
    const $$noteSave = $noteSave.enter()
      .append('div')
      .attr('class', 'note-save save-section cf');

    $$noteSave
      .append('h4')
      .attr('class', '.note-save-header')
      .text(() => {
        return _note.isNew ? l10n.t('note.newDescription') : l10n.t('note.newComment');
      });

    const $$textarea = $$noteSave
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('placeholder', l10n.t('note.inputPlaceholder'))
      .attr('maxlength', 1000)
      .property('value', d => d.props.newComment)
      .call(utilNoAuto)
      .on('keydown.note-input', keydown)
      .on('input.note-input', changeInput)
      .on('blur.note-input', changeInput);

    if (!$$textarea.empty() && _newNote) {
      // autofocus the comment field for new notes
      $$textarea.node().focus();
    }

    // update
    $noteSave = $$noteSave
      .merge($noteSave)
      .call(renderUserDetails)
      .call(renderButtons);


    // fast submit if user presses cmd+enter
    function keydown(d3_event) {
      if (!(d3_event.keyCode === 13 && d3_event.metaKey)) return; // ↩ Return

      let osm = context.services.osm;
      if (!osm) return;

      let hasAuth = osm.authenticated();
      if (!hasAuth) return;

      if (!_note.props.newComment) return;

      d3_event.preventDefault();

      d3_select(this)
        .on('keydown.note-input', null);

      // focus on button and submit
      window.setTimeout(() => {
        if (_note.isNew) {
          $noteSave.selectAll('.save-button').node().focus();
          clickSave(_note);
        } else  {
          $noteSave.selectAll('.comment-button').node().focus();
          clickComment(_note);
        }
      }, 10);
    }


    function changeInput() {
      let input = d3_select(this);
      let val = input.property('value').trim() || undefined;

      // store the unsaved comment with the note itself
      _note = _note.update({ newComment: val });

      let osm = context.services.osm;
      if (osm) {
        osm.replaceNote(_note);  // update note cache
      }

      $noteSave
        .call(renderButtons);
    }
  }


  function renderUserDetails($selection) {
    let $detail = $selection.selectAll('.detail-section')
      .data([0]);

    $detail = $detail.enter()
      .append('div')
      .attr('class', 'detail-section')
      .merge($detail);

    const osm = context.services.osm;
    if (!osm) return;

    // Add warning if user is not logged in
    const hasAuth = osm.authenticated();
    let $auth = $detail.selectAll('.auth-warning')
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
      .on('click.note-login', e => {
        e.preventDefault();
        osm.authenticate();
      });

    $$auth
      .transition()
      .duration(200)
      .style('opacity', 1);


    let $prose = $detail.selectAll('.note-save-prose')
      .data(hasAuth ? [0] : []);

    $prose.exit()
      .remove();

    $prose = $prose.enter()
      .append('p')
      .attr('class', 'note-save-prose')
      .text(l10n.t('note.upload_explanation'))
      .merge($prose);

    osm.userDetails((err, user) => {
      if (err) return;

      let $userLink = d3_select(document.createElement('div'));

      if (user.image_url) {
        $userLink
          .append('img')
          .attr('src', user.image_url)
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


  function renderButtons($selection) {
    const osm = context.services.osm;
    const hasAuth = osm && osm.authenticated();
    const isSelected = (_note && _note.id === context.selectedIDs()[0]);

    let $buttons = $selection.selectAll('.buttons')
      .data((isSelected ? [_note] : []), d => d.key);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'buttons');

    if (_note.isNew) {
      $$buttons
        .append('button')
        .attr('class', 'button cancel-button secondary-action')
        .text(l10n.t('confirm.cancel'));

      $$buttons
        .append('button')
        .attr('class', 'button save-button action')
        .text(l10n.t('note.save'));

    } else {
      $$buttons
        .append('button')
        .attr('class', 'button status-button action');

      $$buttons
        .append('button')
        .attr('class', 'button comment-button action')
        .text(l10n.t('note.comment'));
    }


    // update
    $buttons = $buttons
      .merge($$buttons);

    $buttons.select('.cancel-button')   // select and propagate data
      .on('click.cancel', clickCancel);

    $buttons.select('.save-button')     // select and propagate data
      .attr('disabled', isSaveDisabled)
      .on('click.save', clickSave);

    $buttons.select('.status-button')   // select and propagate data
      .attr('disabled', (hasAuth ? null : true))
      .text(d => {
        const action = (d.props.status === 'open' ? 'close' : 'open');
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t('note.' + action + andComment);
      })
      .on('click.status', clickStatus);

    $buttons.select('.comment-button')   // select and propagate data
      .attr('disabled', isSaveDisabled)
      .on('click.comment', clickComment);


    function isSaveDisabled(d) {
      return (hasAuth && d.props.status === 'open' && d.props.newComment) ? null : true;
    }
  }


  function clickCancel(d3_event, d) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    const osm = context.services.osm;
    if (osm) {
      osm.removeNote(d);
    }
    context.enter('browse');
    dispatch.call('change');
  }


  function clickSave(d3_event, d) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    const osm = context.services.osm;
    if (osm) {
      osm.postNoteCreate(d, (err, note) => {
        dispatch.call('change', note);
      });
    }
  }


  function clickStatus(d3_event, d) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    const osm = context.services.osm;
    if (osm) {
      const setStatus = (d.props.status === 'open' ? 'closed' : 'open');
      osm.postNoteUpdate(d, setStatus, (err, note) => {
        dispatch.call('change', note);
      });
    }
  }

  function clickComment(d3_event, d) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    const osm = context.services.osm;
    if (osm) {
      osm.postNoteUpdate(d, d.props.status, (err, note) => {
        dispatch.call('change', note);
      });
    }
  }


  render.note = function(val) {
    if (!arguments.length) return _note;
    _note = val;
    return render;
  };

  render.newNote = function(val) {
    if (!arguments.length) return _newNote;
    _newNote = val;
    return render;
  };


  return utilRebind(render, dispatch, 'on');
}
