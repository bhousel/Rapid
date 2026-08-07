import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { OsmNote } from '../services/OsmService.ts';


/**
 * The `UiNoteReport` renders a "report this note" out-link for an OSM Note.
 * Set the note to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiNoteReport {
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

    const context = this.context;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm;

    let url: string | undefined;
    if (osm && this.datum && !this.datum.isNew) {
      url = osm.noteReportURL(this.datum);
    }

    let $link: D3Selection = $parent.selectAll('.note-report')
      .data(url ? [url] : []);

    $link.exit()
      .remove();

    // enter
    const $$link: D3EnterSelection = $link.enter()
      .append('a')
      .attr('class', 'note-report')
      .attr('target', '_blank')
      .attr('href', (d: string) => d)
      .call(uiIcon('#rapid-icon-out-link', 'inline'));

    $$link
      .append('span')
      .attr('class', 'note-report-text');

    // update
    $link = $link.merge($$link);

    $link.selectAll('.note-report-text')
      .text(l10n.t('note.report'));
  }
}
