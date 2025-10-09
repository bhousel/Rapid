
export function uiDetectionDetails(context) {
  const l10n = context.systems.l10n;
  let _marker;


  function render(selection) {
    const $details = selection.selectAll('.sidebar-details')
      .data(_marker ? [_marker] : [], d => d.key);

    $details.exit()
      .remove();

    const $$details = $details.enter()
      .append('div')
      .attr('class', 'sidebar-details qa-details-container');

    // description
    const $$description = $$details
      .append('div')
      .attr('class', 'qa-details-subsection');

    $$description
      .append('h3')
      .text(l10n.t('inspector.details') + ':');

    const $$type = $$description
      .attr('class', 'qa-details-item')
      .append('div');

    $$type
      .append('strong')
      .text(l10n.t('inspector.type') + ':');

    $$type
      .append('span')
      .text(d => d.props.value);

    const $$firstseen = $$description
      .attr('class', 'qa-details-item')
      .append('div');

    $$firstseen
      .append('strong')
      .text(l10n.t('inspector.first_seen') + ':');

    $$firstseen
      .append('span')
      .text(d => d.props.first_seen_at ? l10n.displayShortDate(d.props.first_seen_at) : l10n.t('inspector.unknown'));

    const $$lastseen = $$description
      .attr('class', 'qa-details-item')
      .append('div');

    $$lastseen
      .append('strong')
      .text(l10n.t('inspector.last_seen') + ':');

    $$lastseen
      .append('span')
      .text(d => d.props.last_seen_at ? l10n.displayShortDate(d.props.last_seen_at) : l10n.t('inspector.unknown'));

  }


  render.datum = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };

  return render;
}
