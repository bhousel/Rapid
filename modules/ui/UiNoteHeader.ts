import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { OsmNote } from '../services/OsmService.ts';


/**
 * The `UiNoteHeader` renders the header (icon + title) for an OSM Note.
 * Set the note to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiNoteHeader {
  public context: Context;
  public datum: OsmNote | null;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
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

    const l10n = this.context.systems.l10n!;

    const $header: D3Selection = $parent.selectAll('.note-header')
      .data((this.datum ? [this.datum] : []), (d: OsmNote) => d.key );

    $header.exit()
      .remove();

    const $$header: D3EnterSelection = $header.enter()
      .append('div')
      .attr('class', 'note-header');

    const $$icon: D3EnterSelection = $$header
      .append('div')
      .attr('class', (d: OsmNote) => `note-header-icon ${d.props.status}`)
      .classed('new', (d: OsmNote) => d.isNew);

    $$icon
      .append('div')
      .attr('class', 'preset-icon-28')
      .call(uiIcon('#rapid-icon-note', 'note-fill'));

    $$icon
      .each((d: OsmNote) => {
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
      .text((d: OsmNote) => {
        if (d.isNew) {
          return l10n.t('note.new');
        } else {
          return l10n.t('text.note') + ' ' + d.id + ' ' +
            (d.props.status === 'closed' ? l10n.t('note.closed') : '');
        }
      });
  }
}
