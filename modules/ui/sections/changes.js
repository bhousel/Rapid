import { select as d3_select } from 'd3-selection';

import { JXON } from '../../util/jxon.js';
import { actionDiscardTags } from '../../actions/discard_tags.js';
import { OsmChangeset } from '../../data/OsmChangeset.js';
import { uiIcon } from '../icon.js';
import { uiSection } from '../section.js';
import { utilHighlightEntities } from '../../util/index.js';


export function uiSectionChanges(context) {
  const assets = context.systems.assets;
  const editor = context.systems.editor;
  const l10n = context.systems.l10n;
  const map = context.systems.map;
  const presets = context.systems.presets;

  let _discardTags = {};
  assets.loadAssetAsync('tagging_discarded')
    .then(d => _discardTags = d)
    .catch(() => { /* ignore */ });

  let section = uiSection(context, 'changes-list')
    .label(() => {
      const summary = editor.difference().summary();
      return l10n.t('inspector.title_count', { title: l10n.t('commit.changes'), count: summary.size });
    })
    .disclosureContent(renderDisclosureContent);


  function renderDisclosureContent(selection) {
    const summary = [...editor.difference().summary().values()];

    let container = selection.selectAll('.commit-section')
      .data([0]);

    let containerEnter = container.enter()
      .append('div')
      .attr('class', 'commit-section');

    containerEnter
      .append('ul')
      .attr('class', 'changeset-list');

    container = containerEnter
      .merge(container);


    let items = container.select('ul').selectAll('li')
      .data(summary);

    let itemsEnter = items.enter()
      .append('li')
      .attr('class', 'change-item');

    let buttons = itemsEnter
      .append('button')
      .on('mouseover', (e, d) => utilHighlightEntities(context, [d.entity.id], true))
      .on('mouseout', () => utilHighlightEntities(context, false, false))
      .on('click', click);

    buttons
      .each((d, i, nodes) => {
        const geom = d.entity.geometry(d.graph);
        d3_select(nodes[i])
          .call(uiIcon(`#rapid-icon-${geom}`, `pre-text ${d.changeType}`));
      });

    buttons
      .append('span')
      .attr('class', 'change-type')
      .text(d => l10n.t(`commit.${d.changeType}`) + ' ');

    buttons
      .append('strong')
      .attr('class', 'entity-type')
      .text(d => {
        const matched = presets.match(d.entity, d.graph);
        return (matched && matched.name()) || l10n.displayType(d.entity.id);
      });

    buttons
      .append('span')
      .attr('class', 'entity-name')
      .text(d => {
        const name = l10n.displayName(d.entity.tags);
        let string = '';
        if (name !== '') {
          string += ':';
        }
        return string += ' ' + name;
      });

    items = itemsEnter
      .merge(items);


    // Download changeset link
    const changeset = new OsmChangeset(context).update({ id: undefined });
    const changes = editor.changes(actionDiscardTags(editor.difference(), _discardTags));

    delete changeset.id;  // Export without chnageset_id

    const data = JXON.stringify(changeset.osmChangeJXON(changes));
    const blob = new Blob([data], {type: 'text/xml;charset=utf-8;'});
    const fileName = 'changes.osc';

    let linkEnter = container.selectAll('.download-changes')
      .data([0])
      .enter()
      .append('a')
      .attr('class', 'download-changes');

    // All except IE11 and Edge
    linkEnter
      .attr('href', window.URL.createObjectURL(blob)) // download the data as a file
      .attr('download', fileName);

    linkEnter
      .call(uiIcon('#rapid-icon-load', 'inline'))
      .append('span')
      .text(l10n.t('commit.download_changes'));

    function click(d3_event, change) {
      if (change.changeType !== 'deleted') {
        const entity = change.entity;
        map.fitEntitiesEase(entity);
//        context.surface().selectAll(utilEntityOrMemberSelector([entity.id], editor.staging.graph))
//          .classed('hover', true);
      }
    }
  }

  return section;
}
