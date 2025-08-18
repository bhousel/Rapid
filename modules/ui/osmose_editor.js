import { dispatch as d3_dispatch } from 'd3-dispatch';

import { uiOsmoseDetails } from './osmose_details.js';
import { uiOsmoseHeader } from './osmose_header.js';
import { uiIcon } from './icon.js';
import { UiViewOn } from './UiViewOn.js';
import { utilRebind } from '../util/index.js';


export function uiOsmoseEditor(context) {
  const l10n = context.systems.l10n;
  const osmose = context.services.osmose;
  const dispatch = d3_dispatch('change');
  const qaDetails = uiOsmoseDetails(context);
  const qaHeader = uiOsmoseHeader(context);
  const ViewOn = new UiViewOn(context);
  let _marker;


  function render($selection) {
    const $header = $selection.selectAll('.header')
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
      .text(l10n.t('QA.osmose.title'));

    let $body = $selection.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    let $editor = $body.selectAll('.qa-editor')
      .data([0]);

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section qa-editor')
      .merge($editor)
      .call(qaHeader.issue(_marker))
      .call(qaDetails.issue(_marker))
      .call(osmoseSaveSection);

    ViewOn.stringID = 'inspector.view_on_osmose';
    ViewOn.url = osmose.itemURL(_marker);

    const $footer = $selection.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(ViewOn.render);
  }


  function osmoseSaveSection($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    const isShown = (_marker && isSelected);
    let $saveSection = $selection.selectAll('.qa-save')
      .data(isShown ? [_marker] : [], d => d.key);

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection = $saveSection.enter()
      .append('div')
      .attr('class', 'qa-save save-section cf');

    // update
    $saveSection = $$saveSection
      .merge($saveSection)
      .call(qaSaveButtons);
  }


  function qaSaveButtons($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons = $selection.selectAll('.buttons')
      .data(isSelected ? [_marker] : [], d => d.key);

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
      .on('click.close', function(d3_event, d) {
        this.blur();    // avoid keeping focus on the button - iD#4641
        if (osmose) {
          d.props.newStatus = 'done';
          d.touch();
          osmose.postUpdate(d, (err, item) => dispatch.call('change', item));
        }
      });

    $buttons.select('.ignore-button')
      .text(l10n.t('QA.keepRight.ignore'))
      .on('click.ignore', function(d3_event, d) {
        this.blur();    // avoid keeping focus on the button - iD#4641
        if (osmose) {
          d.props.newStatus = 'false';
          d.touch();
          osmose.postUpdate(d, (err, item) => dispatch.call('change', item));
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
