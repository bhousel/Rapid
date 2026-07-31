import { select as d3_select, selection } from 'd3-selection';

import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilHighlightEntities } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiKeepRightDetails` renders the description/details for a KeepRight QA issue,
 * including any linked OSM entities. Set the issue via the public `datum` property,
 * then call `.render($parent)`.
 */
export class UiKeepRightDetails {
  public context: Context;
  public datum: any;

  // D3 selections
  public $parent: D3Selection | null;

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
    const schema = context.systems.schema!;
    const scene = gfx.scene!;

    let $details: D3Selection = $parent.selectAll('.sidebar-details')
      .data(this.datum ? [this.datum] : [], (d: any) => d.key);

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
      .append('h4');

    $$description
      .append('div')
      .attr('class', 'qa-details-description-text')
      .html((d: any) => utilSanitizeHTML(this._issueDetailHTML(d)));

    // If there are entity links in the error message..
    const relatedEntities: string[] = [];
    $$description.selectAll('.error_entity_link, .error_object_link')
      .attr('href', '#')
      .each((d: any, i: number, nodes: any) => {
        const node = nodes[i];
        const $link = d3_select(node);
        const isObjectLink = $link.classed('error_object_link');
        const entityID = isObjectLink ? (this.datum.props.objectType.charAt(0) + this.datum.props.objectId) : node.textContent;
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(entityID);

        relatedEntities.push(entityID);

        // Add click handler
        $link
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
            map.centerZoomEase(this.datum.loc, 20);
            map.selectEntityID(entityID);
          });

        // Replace with friendly name if possible
        // (The entity may not yet be loaded into the graph)
        if (entity) {
          let name: any = l10n.displayName(entity.tags);  // try to use common name
          if (!name && !isObjectLink) {
            const preset = schema.match(entity, graph);
            name = preset && !preset.isFallback() && preset.name;  // fallback to preset name
          }

          if (name) {
            node.innerText = name;
          }
        }
      });

    // update — set localized title here so it re-localizes on language change
    $details = $details.merge($$details);
    $details.select('h4')
      .text(l10n.t('QA.keepRight.detail_description'));

    // Don't hide entities related to this issue - iD#5880
    filters.forceVisible(relatedEntities);
    gfx.immediateRedraw();
  }


  /**
   * Returns the localized detail/description HTML for the given KeepRight issue.
   * @param d - The issue datum
   */
  protected _issueDetailHTML(d: any): string {
    const l10n = this.context.systems.l10n!;

    const { itemType, parentIssueType } = d.props;
    const unknown = l10n.t('inspector.unknown');
    const replacements = d.props.replacements || {};  // some replacements are html linkified
    replacements.default = unknown;  // special key `default` works as a fallback string

    let detail = l10n.t(`QA.keepRight.errorTypes.${itemType}.description`, replacements);
    if (detail === unknown) {
      detail = l10n.t(`QA.keepRight.errorTypes.${parentIssueType}.description`, replacements);
    }
    return detail;
  }
}
