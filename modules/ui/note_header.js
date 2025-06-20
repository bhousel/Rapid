import { uiIcon } from './icon.js';


export function uiNoteHeader(context) {
  const l10n = context.systems.l10n;
  let _note;


  function render($selection) {
    const $header = $selection.selectAll('.note-header')
      .data((_note ? [_note] : []), d => d.key );

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'note-header');

    const $$icon = $$header
      .append('div')
      .attr('class', d => `note-header-icon ${d.props.status}`)
      .classed('new', d => d.isNew);

    $$icon
      .append('div')
      .attr('class', 'preset-icon-28')
      .call(uiIcon('#rapid-icon-note', 'note-fill'));

    $$icon
      .each(d => {
        let statusIcon;
        if (d.isNew) {
          statusIcon = '#rapid-icon-plus';
        } else if (d.props.status === 'open') {
          statusIcon = '#rapid-icon-close';
        } else {
          statusIcon = '#rapid-icon-apply';
        }
        $$icon
          .append('div')
          .attr('class', 'note-icon-annotation')
          .call(uiIcon(statusIcon, 'icon-annotation'));
      });

    $$header
      .append('div')
      .attr('class', 'note-header-label')
      .text(d => {
        if (d.isNew) {
          return l10n.t('note.new');
        } else {
          return l10n.t('note.note') + ' ' + d.id + ' ' +
            (d.props.status === 'closed' ? l10n.t('note.closed') : '');
        }
      });
  }


  render.note = function(val) {
    if (!arguments.length) return _note;
    _note = val;
    return render;
  };


  return render;
}
