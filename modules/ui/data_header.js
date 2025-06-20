import { uiIcon } from './icon.js';


export function uiDataHeader(context) {
  const l10n = context.systems.l10n;
  let _datum;


  // We show a few different kinds of data in this pane
  // If there is a `serviceID`, try to show a better title.
  function issueTitle(d) {
    const serviceID = d.serviceID || 'custom';
    const custom =  l10n.t('map_data.layers.custom.title'); // Fallback to "Custom Map Data"

    return l10n.t(`map_data.layers.${serviceID}.title`, { default: custom });
  }


  function dataHeader($selection) {
    let $header = $selection.selectAll('.data-header')
      .data((_datum ? [_datum] : []), d => d.key );

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'data-header');

    const $$icon = $$header
      .append('div')
      .attr('class', 'data-header-icon');

    $$icon
      .append('div')
      .attr('class', 'preset-icon-28')
      .call(uiIcon('#rapid-icon-data'));

    $$header
      .append('div')
      .attr('class', 'data-header-label')
      .text(issueTitle);
  }


  dataHeader.datum = function(val) {
    if (!arguments.length) return _datum;
    _datum = val;
    return this;
  };


  return dataHeader;
}
