import { select, selection } from 'd3-selection';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilHighlightEntities } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { KeepRightIssue } from '../services/KeepRightService.ts';


/**
 * The `UiKeepRightDetails` renders the description/details for a KeepRight QA issue,
 * including any linked OSM entities. Set the issue via the public `datum` property,
 * then call `.render($parent)`.
 */
export class UiKeepRightDetails {
  public context: Context;
  public datum: KeepRightIssue | null;

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
    const schema = context.systems.schema!;
    const scene = gfx.scene!;

    const datum = this.datum;

    let $details: D3Selection = $parent.selectAll('.sidebar-details')
      .data(datum ? [datum] : [], (d: KeepRightIssue) => d.key);

    $details.exit()
      .remove();

    const $$details: D3EnterSelection = $details.enter()
      .append('div')
      .attr('class', 'sidebar-details qa-details-container');

    // description
    const $$description: D3EnterSelection = $$details
      .append('div')
      .attr('class', 'qa-details-subsection');

    $$description
      .append('h4');

    $$description
      .append('div')
      .attr('class', 'qa-details-description-text');

    // update
    $details = $details.merge($$details);

    const $description = $details.selectAll('.qa-details-subsection');

    $description.selectAll('h4')
      .text(l10n.t('text.description'));

    $description.selectAll('.qa-details-description-text')
      .html((d: KeepRightIssue) => utilSanitizeHTML(this._issueDetailHTML(d)));


    // If there are entity links in the error message..
    const relatedEntities: string[] = [];
    $$description.selectAll('.error_entity_link, .error_object_link')
      .attr('href', '#')
      .each((d: any, i: number, nodes: any) => {
        // Note that in here, we are selecting links within the detail text.
        // We won't have the bound datum passed to us in `d`, so rely on the closure `datum` instead.
        if (!datum) return;

        const node = nodes[i];
        const $link: D3Selection = select(node);
        const isObjectLink = $link.classed('error_object_link');
        const entityID = isObjectLink ? (datum.props.objectType.charAt(0) + datum.props.objectId) : node.textContent;
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
            map.centerZoomEase(d.loc, 20);
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


    // Don't hide entities related to this issue - iD#5880
    filters.forceVisible(relatedEntities);
    gfx.immediateRedraw();
  }


  /**
   * Returns the localized detail/description HTML for the given KeepRight issue.
   * @param d - The issue datum
   */
  protected _issueDetailHTML(d: KeepRightIssue): string {
    const l10n = this.context.systems.l10n!;

    const { itemType, parentIssueType } = d.props;
    const unknown = l10n.t('text.unknown');
    const replacements = d.props.replacements || {};  // some replacements are html linkified
    replacements.default = unknown;  // special key `default` works as a fallback string

    let detail = l10n.t(`QA.keepRight.errorTypes.${itemType}.description`, replacements);
    if (detail === unknown) {
      detail = l10n.t(`QA.keepRight.errorTypes.${parentIssueType}.description`, replacements);
    }
    return detail;
  }
}
