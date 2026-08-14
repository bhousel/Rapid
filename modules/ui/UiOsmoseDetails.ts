import { select, selection } from 'd3-selection';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilHighlightEntities } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmoseIssue } from '../services/OsmoseService.ts';


/**
 * The `UiOsmoseDetails` renders the description/details for an Osmose QA issue,
 * including any linked OSM entities (loaded lazily from the Osmose API). Set the issue
 * via the public `datum` property, then call `.render($parent)`.
 */
export class UiOsmoseDetails {
  public context: Context;
  public datum: OsmoseIssue | null;

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
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const osmose = context.services.osmose!;
    const schema = context.systems.schema!;
    const scene = gfx.scene!;

    let $details: D3Selection = $parent.selectAll('.sidebar-details')
      .data(this.datum ? [this.datum] : [], (d: OsmoseIssue) => d.key!);

    $details.exit()
      .remove();

    const $$details = $details.enter()
      .append('div')
      .attr('class', 'sidebar-details qa-details-container');

    const detailHtml = this._issueString(this.datum!, 'detail');
    const trapHtml = this._issueString(this.datum!, 'trap');
    const fixHtml = this._issueString(this.datum!, 'fix');

    // Description
    if (detailHtml) {
      const $$div = $$details
        .append('div')
        .attr('class', 'qa-details-subsection');

      $$div
        .append('h4')
        .attr('class', 'qa-details-description-title');

      $$div
        .append('p')
        .attr('class', 'qa-details-description-text')
        .html(utilSanitizeHTML(detailHtml))
        .selectAll('a')
        .attr('rel', 'noopener')
        .attr('target', '_blank');
    }

    const $$detailsDiv = $$details
      .append('div')
      .attr('class', 'qa-details-subsection');

    // Elements (populated later as data is requested)
    const $$elemsDiv = $$details
      .append('div')
      .attr('class', 'qa-details-subsection');

    // Suggested Fix (might not exist for every issue type)
    if (fixHtml) {
      const $$div = $$details
        .append('div')
        .attr('class', 'qa-details-subsection');

      $$div
        .append('h4')
        .attr('class', 'qa-details-fix-title');

      $$div
        .append('p')
        .html(utilSanitizeHTML(fixHtml))
        .selectAll('a')
        .attr('rel', 'noopener')
        .attr('target', '_blank');
    }

    // Common Pitfalls (might not exist for every issue type)
    if (trapHtml) {
      const $$div = $$details
        .append('div')
        .attr('class', 'qa-details-subsection');

      $$div
        .append('h4')
        .attr('class', 'qa-details-trap-title');

      $$div
        .append('p')
        .html(utilSanitizeHTML(trapHtml))
        .selectAll('a')
        .attr('rel', 'noopener')
        .attr('target', '_blank');
    }

    // update — set localized subsection titles here so they re-localize on language change
    $details = $details.merge($$details);
    $details.select('.qa-details-description-title')
      .text(l10n.t('text.description'));
    $details.select('.qa-details-fix-title')
      .text(l10n.t('QA.osmose.fix_title'));
    $details.select('.qa-details-trap-title')
      .text(l10n.t('QA.osmose.trap_title'));

    // Save current item to check if UI changed by time request resolves
    if (!osmose) return;

    osmose.loadIssueDetailAsync(this.datum!)
      .then((d: any) => {
        // Do nothing if the datum has changed by the time Promise resolves
        if (this.datum!.id !== d.id) return;

        // No details to add if there are no associated issue elements
        if (!d.props.elems || d.props.elems.length === 0) return;

        // Things like keys and values are dynamically added to a subtitle string
        if (d.props.detail) {
          $$detailsDiv
            .append('h4')
            .text(l10n.t('text.details'));

          $$detailsDiv
            .append('p')
            .html((d: any) => utilSanitizeHTML(d.props.detail))
            .selectAll('a')
            .attr('rel', 'noopener')
            .attr('target', '_blank');
        }

        // Create list of linked issue elements
        $$elemsDiv
          .append('h4')
          .text(l10n.t('text.features'));

        $$elemsDiv
          .append('ul').selectAll('li')
          .data(d.props.elems)
          .enter()
          .append('li')
          .append('a')
          .attr('href', '#')
          .attr('class', 'error_entity_link')
          .text((d: any) => d)
          .each((d: any, i: number, nodes: any) => {
            const node = nodes[i];
            const $$link = select(node);
            const entityID = node.textContent;
            const graph = editor.staging.graph;
            const entity = graph.hasEntity(entityID);

            // Add click handler
            $$link
              .on('mouseenter', () => {
                utilHighlightEntities(context, [entityID], true);
              })
              .on('mouseleave', () => {
                utilHighlightEntities(context, [entityID], false);
              })
              .on('click', (d3_event: Event) => {
                d3_event.preventDefault();

                utilHighlightEntities(context, [entityID], false);

                scene.enableLayers('osm');  // make sure osm layer is even on
                map.centerZoom(d.loc, 20);
                map.selectEntityID(entityID);
              });

            // Replace with friendly name if possible
            // (The entity may not yet be loaded into the graph)
            if (entity) {
              let name: string | undefined = l10n.displayName(entity.tags);  // try to use common name
              if (!name) {
                const preset = schema.match(entity, graph);
                name = (preset && !preset.isFallback() && preset.name) || undefined;  // fallback to preset name
              }

              if (name) {
                node.innerText = name;
              }
            }
          });

        // Don't hide entities related to this issue - iD#5880
        filters.forceVisible(d.props.elems);
        gfx.immediateRedraw();
      })
      .catch((e: unknown) => console.error(e));  // eslint-disable-line
  }


  /**
   * Returns a cached Osmose issue string of the given type, or an empty string.
   * @param d    - The issue datum
   * @param type - The string type to look up (e.g. 'detail', 'trap', 'fix')
   */
  protected _issueString(d: OsmoseIssue, type: string): string {
    const osmose = this.context.services.osmose!;

    if (!osmose || !d) return '';

    // Issue strings are cached from Osmose API
    const s = osmose.getStrings(d.props.type!);
    return (type in s) ? (s as any)[type] : '';
  }
}
