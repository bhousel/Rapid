import { select as d3_select } from 'd3-selection';

import { utilHighlightEntities } from '../util/index.js';


export function uiOsmoseDetails(context) {
  const editor = context.systems.editor;
  const filters = context.systems.filters;
  const gfx = context.systems.gfx;
  const l10n = context.systems.l10n;
  const map = context.systems.map;
  const osmose = context.services.osmose;
  const presets = context.systems.presets;
  const scene = context.systems.gfx.scene;

  let _marker;


  function issueString(d, type) {
    if (!osmose || !d) return '';

    // Issue strings are cached from Osmose API
    const s = osmose.getStrings(d.props.type);
    return (type in s) ? s[type] : '';
  }


  function render($selection) {
    const $details = $selection.selectAll('.sidebar-details')
      .data(_marker ? [_marker] : [], d => d.key);

    $details.exit()
      .remove();

    const $$details = $details.enter()
      .append('div')
      .attr('class', 'sidebar-details qa-details-container');

    const detailHtml = issueString(_marker, 'detail');
    const trapHtml = issueString(_marker, 'trap');
    const fixHtml = issueString(_marker, 'fix');

    // Description
    if (detailHtml) {
      const $$div = $$details
        .append('div')
        .attr('class', 'qa-details-subsection');

      $$div
        .append('h4')
        .text(l10n.t('QA.keepRight.detail_description'));

      $$div
        .append('p')
        .attr('class', 'qa-details-description-text')
        .html(detailHtml)
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
        .text(l10n.t('QA.osmose.fix_title'));

      $$div
        .append('p')
        .html(fixHtml)
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
        .text(l10n.t('QA.osmose.trap_title'));

      $$div
        .append('p')
        .html(trapHtml)
        .selectAll('a')
        .attr('rel', 'noopener')
        .attr('target', '_blank');
    }

    // Save current item to check if UI changed by time request resolves
    if (!osmose) return;

    osmose.loadIssueDetailAsync(_marker)
      .then(d => {
        // Do nothing if _marker has changed by the time Promise resolves
        if (_marker.id !== d.id) return;

        // No details to add if there are no associated issue elements
        if (!d.props.elems || d.props.elems.length === 0) return;

        // Things like keys and values are dynamically added to a subtitle string
        if (d.props.detail) {
          $$detailsDiv
            .append('h4')
            .text(l10n.t('QA.osmose.detail_title'));

          $$detailsDiv
            .append('p')
            .html(d => d.props.detail)
            .selectAll('a')
            .attr('rel', 'noopener')
            .attr('target', '_blank');
        }

        // Create list of linked issue elements
        $$elemsDiv
          .append('h4')
          .text(l10n.t('QA.osmose.elems_title'));

        $$elemsDiv
          .append('ul').selectAll('li')
          .data(d.props.elems)
          .enter()
          .append('li')
          .append('a')
          .attr('href', '#')
          .attr('class', 'error_entity_link')
          .html(d => d)
          .each((d, i, nodes) => {
            const node = nodes[i];
            const $$link = d3_select(node);
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
              .on('click', (d3_event) => {
                d3_event.preventDefault();

                utilHighlightEntities(context, [entityID], false);

                scene.enableLayers('osm');  // make sure osm layer is even on
                map.centerZoom(d.loc, 20);
                map.selectEntityID(entityID);
              });

            // Replace with friendly name if possible
            // (The entity may not yet be loaded into the graph)
            if (entity) {
              let name = l10n.displayName(entity.tags);  // try to use common name
              if (!name) {
                const preset = presets.match(entity, graph);
                name = preset && !preset.isFallback() && preset.name();  // fallback to preset name
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
      .catch(e => console.error(e));  // eslint-disable-line
  }


  render.issue = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };


  return render;
}
