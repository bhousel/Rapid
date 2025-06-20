import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { uiIcon } from './icon.js';
import { uiKeepRightDetails } from './keepRight_details.js';
import { uiKeepRightHeader } from './keepRight_header.js';
import { UiViewOn } from './UiViewOn.js';
import { utilNoAuto, utilRebind } from '../util/index.js';


export function uiKeepRightEditor(context) {
  const l10n = context.systems.l10n;
  const keepright = context.services.keepRight;
  const dispatch = d3_dispatch('change');
  const qaDetails = uiKeepRightDetails(context);
  const qaHeader = uiKeepRightHeader(context);
  const ViewOn = new UiViewOn(context);

  let _marker;


  function render($selection) {
    const $$header = $selection.selectAll('.header')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3')
      .text(l10n.t('QA.keepRight.title'));


    let $body = $selection.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor = $body.selectAll('.qa-editor')
      .data([0]);

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($editor)
      .call(qaHeader.issue(_marker))
      .call(qaDetails.issue(_marker))
      .call(keepRightSaveSection);


    ViewOn.stringID = 'inspector.view_on_keepRight';
    ViewOn.url = keepright.issueURL(_marker);

    const $footer = $selection.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(ViewOn.render);
  }


  function keepRightSaveSection($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    const isShown = (_marker && (isSelected || _marker.props.newComment || _marker.props.comment));
    let $saveSection = $selection.selectAll('.qa-save')
      .data(isShown ? [_marker] : [], d => d.key);

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection = $saveSection.enter()
      .append('div')
      .attr('class', 'qa-save save-section cf');

    $$saveSection
      .append('h4')
      .attr('class', '.qa-save-header')
      .text(l10n.t('QA.keepRight.comment'));

    $$saveSection
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('placeholder', l10n.t('QA.keepRight.comment_placeholder'))
      .attr('maxlength', 1000)
      .property('value', d => d.props.newComment || d.props.comment)
      .call(utilNoAuto)
      .on('input', changeInput)
      .on('blur', changeInput);

    // update
    $saveSection = $saveSection
      .merge($$saveSection)
      .call(qaSaveButtons);

    function changeInput() {
      const input = d3_select(this);
      let val = input.property('value').trim();

      if (val === _marker.props.comment) {
        val = undefined;
      }

      // store the unsaved comment with the issue itself
      _marker = _marker.update({ newComment: val });

      if (keepright) {
        keepright.replaceItem(_marker);  // update keepright cache
      }

      $saveSection
        .call(qaSaveButtons);
    }
  }


  function qaSaveButtons($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let buttonSection = $selection.selectAll('.buttons')
      .data(isSelected ? [_marker] : [], d => d.key);

    // exit
    buttonSection.exit()
      .remove();

    // enter
    const buttonEnter = buttonSection.enter()
      .append('div')
        .attr('class', 'buttons');

    buttonEnter
      .append('button')
      .attr('class', 'button comment-button action')
      .text(l10n.t('QA.keepRight.save_comment'));

    buttonEnter
      .append('button')
      .attr('class', 'button close-button action');

    buttonEnter
      .append('button')
      .attr('class', 'button ignore-button action');

    // update
    buttonSection = buttonSection
      .merge(buttonEnter);

    buttonSection.select('.comment-button')   // select and propagate data
      .attr('disabled', d => d.props.newComment ? null : true)
      .on('click.comment', function(d3_event, d) {
        this.blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          keepright.postUpdate(d, (err, item) => dispatch.call('change', item));
        }
      });

    buttonSection.select('.close-button')   // select and propagate data
      .text(d => {
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t(`QA.keepRight.close${andComment}`);
      })
      .on('click.close', function(d3_event, d) {
        this.blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          d.props.newStatus = 'ignore_t';   // ignore temporarily (item fixed)
          keepright.postUpdate(d, (err, item) => dispatch.call('change', item));
        }
      });

    buttonSection.select('.ignore-button')   // select and propagate data
      .text(d => {
        const andComment = (d.props.newComment ? '_comment' : '');
        return l10n.t(`QA.keepRight.ignore${andComment}`);
      })
      .on('click.ignore', function(d3_event, d) {
        this.blur();    // avoid keeping focus on the button - iD#4641
        if (keepright) {
          d.props.newStatus = 'ignore';   // ignore permanently (false positive)
          keepright.postUpdate(d, (err, item) => dispatch.call('change', item));
        }
      });
  }

  render.error = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };

  return utilRebind(render, dispatch, 'on');
}
