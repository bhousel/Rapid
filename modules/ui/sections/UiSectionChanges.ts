import { select as d3_select } from 'd3-selection';

import { JXON } from '../../util/jxon.ts';
import { actionDiscardTags } from '../../actions/discard_tags.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { OsmChangeset } from '../../data/OsmChangeset.ts';
import { uiIcon } from '../icon.ts';
import { utilHighlightEntities } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { SummaryEntry } from '../../lib/Difference.ts';


export class UiSectionChanges extends AbstractUiSection {
  protected _discardTags: Record<string, unknown>;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'changes-list');

    const schema = context.systems.schema;

    this._discardTags = {};

    if (schema) {
      const osmScope = schema.getScope('osm');
      this._discardTags = osmScope.discarded;
    }
  }


  /**
   * The section's heading label, including a count of the current changes.
   * @return Localized section title
   */
  public override label(): string {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const summary = editor.difference().summary();
    return l10n.t('inspector.title_count', { title: l10n.t('commit.changes'), count: summary.size });
  }


  /**
   * Renders the list of pending changes plus the download-changeset link.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const schema = context.systems.schema!;

    const click = (d3_event: Event, change: SummaryEntry): void => {
      if (change.changeType !== 'deleted') {
        const entity = change.entity;
        map.fitEntitiesEase(entity);
//        context.surface().selectAll(utilEntityOrMemberSelector([entity.id], editor.staging.graph))
//          .classed('hover', true);
      }
    };

    const summary = [...editor.difference().summary().values()];

    let $container: D3Selection = $selection.selectAll('.commit-section')
      .data([0]);

    const $$containerEnter = $container.enter()
      .append('div')
      .attr('class', 'commit-section');

    $$containerEnter
      .append('ul')
      .attr('class', 'changeset-list');

    $container = $$containerEnter
      .merge($container);


    let $items: D3Selection = $container.select('ul').selectAll('li')
      .data(summary);

    const $$itemsEnter = $items.enter()
      .append('li')
      .attr('class', 'change-item');

    const $$buttons = $$itemsEnter
      .append('button')
      .on('mouseover', (e: Event, d: SummaryEntry) => utilHighlightEntities(context, [d.entity.id], true))
      .on('mouseout', () => utilHighlightEntities(context, [], false))
      .on('click', click);

    $$buttons
      .each((d: SummaryEntry, i: number, nodes: ArrayLike<HTMLElement>) => {
        const geom = d.entity.geometry(d.graph);
        d3_select(nodes[i])
          .call(uiIcon(`#rapid-icon-${geom}`, `pre-text ${d.changeType}`));
      });

    $$buttons
      .append('span')
      .attr('class', 'change-type')
      .text((d: SummaryEntry) => l10n.t(`commit.${d.changeType}`) + ' ');

    $$buttons
      .append('strong')
      .attr('class', 'entity-type')
      .text((d: SummaryEntry) => {
        const preset = schema.match(d.entity, d.graph);
        return (preset && preset.name) || l10n.displayType(d.entity.id);
      });

    $$buttons
      .append('span')
      .attr('class', 'entity-name')
      .text((d: SummaryEntry) => {
        const name = l10n.displayName(d.entity.tags);
        let string = '';
        if (name !== '') {
          string += ':';
        }
        return string + ' ' + name;
      });

    $items = $$itemsEnter
      .merge($items);


    // Download changeset link
    const changeset = new OsmChangeset(context).update({ id: undefined });
    const changes = editor.changes(actionDiscardTags(editor.difference(), this._discardTags));

    delete (changeset as { id?: string }).id;  // Export without changeset_id

    const data = JXON.stringify(changeset.osmChangeJXON(changes));
    const blob = new Blob([data], {type: 'text/xml;charset=utf-8;'});
    const fileName = 'changes.osc';

    const $$linkEnter = $container.selectAll('.download-changes')
      .data([0])
      .enter()
      .append('a')
      .attr('class', 'download-changes');

    // All except IE11 and Edge
    $$linkEnter
      .attr('href', window.URL.createObjectURL(blob)) // download the data as a file
      .attr('download', fileName);

    $$linkEnter
      .call(uiIcon('#rapid-icon-load', 'inline'))
      .append('span');

    // Set localized text on the update selection so it re-localizes on language change.
    $container.select('.download-changes span')
      .text(l10n.t('commit.download_changes'));
  }
}
