import * as PIXI from 'pixi.js';


export function uiOsmoseHeader(context) {
  const l10n = context.systems.l10n;
  const osmose = context.services.osmose;
  let _marker;


  function issueTitle(d) {
    const unknown = l10n.t('inspector.unknown');
    if (!osmose || !d) return unknown;

    // Issue titles supplied by Osmose
    const s = osmose.getStrings(d.props.type);
    return ('title' in s) ? s.title : unknown;
  }


  function render($selection) {
    let iconFill = 0xffffff;
    if (osmose) {
      iconFill = osmose.getColor(_marker?.props.item);
    }

    const $header = $selection.selectAll('.qa-header')
      .data(_marker ? [_marker] : [], d => d.key);

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    const $$svg = $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('svg')
      .attr('width', '20px')
      .attr('height', '27px')
      .attr('viewbox', '0 0 20 27')
      .attr('class', d => `qaItem ${d.serviceID}`);

    $$svg
      .append('polygon')
      .attr('fill', new PIXI.Color(iconFill).toHex())
      .attr('stroke', '#333')
      .attr('points', '16,3 4,3 1,6 1,17 4,20 7,20 10,27 13,20 16,20 19,17.033 19,6');

    $$svg
      .append('use')
      .attr('class', 'icon-annotation')
      .attr('width', '13px')
      .attr('height', '13px')
      .attr('transform', 'translate(3.5, 5)')
      .attr('xlink:href', d => d.props.iconID ? `#${d.props.iconID}` : '');

    $$header
      .append('div')
      .attr('class', 'qa-header-label')
      .text(issueTitle);
  }

  render.issue = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };

  return render;
}
