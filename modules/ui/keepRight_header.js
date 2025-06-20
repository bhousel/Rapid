import * as PIXI from 'pixi.js';

import { uiIcon } from './icon.js';


export function uiKeepRightHeader(context) {
  const l10n = context.systems.l10n;
  let _marker;


  function issueTitle(d) {
    const { itemType, parentIssueType } = d.props;
    const unknown = l10n.t('inspector.unknown');
    let replacements = d.props.replacements || {};
    replacements.default = unknown;  // special key `default` works as a fallback string

    let title = l10n.t(`QA.keepRight.errorTypes.${itemType}.title`, replacements);
    if (title === unknown) {
      title = l10n.t(`QA.keepRight.errorTypes.${parentIssueType}.title`, replacements);
    }
    return title;
  }


  function render($selection) {
    let iconFill = 0xffffff;
    const keepright = context.services.keepRight;
    if (keepright) {
      iconFill = keepright.getColor(_marker?.props.parentIssueType);
    }

    const $header = $selection.selectAll('.qa-header')
      .data(_marker ? [_marker] : [], d => d.key);

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('div')
      .attr('class', d => `qaItem ${d.serviceID}`)
      .call(uiIcon('#rapid-icon-bolt'));

    $$header
      .append('div')
      .attr('class', 'qa-header-label')
      .text(issueTitle);

    $$header.selectAll('.qaItem svg.icon')
      .attr('stroke', '#333')
      .attr('stroke-width', '1.3px')
      .attr('color', new PIXI.Color(iconFill).toHex());
  }


  render.issue = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };

  return render;
}
