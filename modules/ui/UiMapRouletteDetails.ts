import { select, selection } from 'd3-selection';
import { marked } from 'marked';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilHighlightEntities } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { MapRouletteTask } from '../services/MapRouletteService.ts';


/**
 * Generates HTML for a dropdown menu with the specified name and options.
 * @param   dropdownName - The name attribute for the dropdown.
 * @param   options      - An array of options to be included in the dropdown.
 * @return  HTML string representing a dropdown menu.
 */
function generateDropdownHtml(dropdownName: string, options: string[]): string {
  return `<select name="${dropdownName}"><option value=""></option>${options.map(option => `<option value="${option.trim()}">${option.trim()}</option>`).join('')}</select>`;
}


/**
 * Generates dynamic HTML content by parsing short codes within the provided text.
 * This function identifies special short code segments and replaces them with HTML dropdowns.
 * https://learn.maproulette.org/en-us/documentation/challenge-instructions-templating/
 *
 * Example input:
 * "[select &quot;dropdownName&quot; values=&quot;option1,option2,option3&quot;]"
 *
 * @param   text - The text containing short codes to be transformed into HTML content.
 * @return  The transformed text with HTML content.
 */
function generateDynamicContent(text: string): string {
  const segments = text.split(/\[select\s+&quot;\s*[^"]*?\s*&quot;\s+name=&quot;/);
  let transformedText = segments[0];
  segments.slice(1).forEach(segment => {
    const endIndex = segment.indexOf('&quot;');
    const dropdownName = segment.substring(0, endIndex);
    const valuesStart = segment.indexOf('values=&quot;') + 'values=&quot;'.length;
    const valuesEnd = segment.indexOf('&quot;', valuesStart);
    const options = segment.substring(valuesStart, valuesEnd).split(',');
    const dropdownHtml = generateDropdownHtml(dropdownName, options);
    const remainder = segment.substring(valuesEnd + '&quot;'.length).trim().replace(/^\]/, '');
    transformedText += dropdownHtml + remainder;
  });
  return transformedText;
}


/**
 * This function searches for mustache tags defined by double curly braces (e.g., `{{propertyName}}`) and replaces them
 * with actual values from the task's properties or generates clickable links if the property is an OSM identifier.
 * https://learn.maproulette.org/en-us/documentation/mustache-tag-replacement/#content
 * @param  text - The text containing mustache tags to be replaced.
 * @param  task - The task object containing properties that may replace the tags.
 * @return The text with mustache tags replaced by actual values or links.
 */
function replaceMustacheTags(text: string, task: any): string {
  const tagRegex = /\{\{([\w:]+)\}\}/g;
  return text.replace(tagRegex, (match, propertyName) => {
    // Check if the property name is 'osmIdentifier' and task has a title
    if (propertyName === 'osmIdentifier' && task.props.title) {
      // Extract the OSM ID including the prefix from the task's title
      const osmId = task.props.title.split('@')[0];
      // Return an anchor tag with a class for highlighting and data attribute for the OSM ID
      return `<a href="#" class="highlight-link" data-osm-id="${osmId}">${osmId}</a>`;
    }
    // For other properties, return their values from the task if they exist
    // Tasks have a featureCollection. Usually there is only one feature, but we still have to handle multiple.
    // In case properties are duplicated between features, we take the last value. I don't expect this to happen or be an issue.
    const allProperties = new Map();
    task.props.features.map((f: any) => f.properties).forEach((properties: any) => {
      Object.keys(properties).forEach(key => {
        allProperties.set(key, properties[key]);
      });
    });
    if (allProperties.has(propertyName)) {
      return allProperties.get(propertyName);
    }
    // Return an non-replaced Mustache tag if the property does not exist in the task to signal that there is something that we could not replace
    return `{{${propertyName}}}`;
  });
}


/**
 * Transform the `${type}/${number}` pattern to the `${w|n|r}${number}` pattern
 * Correct format: `w${number}`, `n${number}`, `r${number}`
 * Format that this helper transforms: `way/${number}`, `node/${number}`, `relation/${number}`
 */
function transformId(id: string): string {
  return id.replace(/^(way|node|relation)\//, (match) => {
    switch (match) {
      case 'way/': return 'w';
      case 'node/': return 'n';
      case 'relation/': return 'r';
      default: return match;
    }
  });
}


/**
 * The `UiMapRouletteDetails` renders the description/instructions for a MapRoulette task,
 * with mustache/short-code templating and clickable OSM entity links (loaded lazily).
 * Set the task via the public `datum` property, then call `.render($parent)`.
 */
export class UiMapRouletteDetails {
  public context: Context;
  public datum: MapRouletteTask | null;

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
    const maproulette = context.services.maproulette!;

    let $details: D3Selection = $parent.selectAll('.sidebar-details')
      .data(this.datum ? [this.datum] : [], (d: MapRouletteTask) => d.key!);

    $details.exit()
      .remove();

    const $$details = $details.enter()
      .append('section')
      .attr('class', 'sidebar-details');

    const $$qaDetails = $$details
      .append('div')
      .attr('class', 'qa-details-subsection');

    $$qaDetails
      .append('div')
      .attr('class', 'qa-details-container maproulette-loading');

    $details = $details
      .merge($$details);

    $details.select('.maproulette-loading')
      .text(l10n.t('map_data.layers.maproulette.loading_task_details'));


    maproulette.loadCompleteTaskAsync(this.datum!).then((task: any) => {
      if (!task) return;
      if (this.datum!.id !== task.id) return;

      const $qaDetails = $details.selectAll('.qa-details-subsection');
      $qaDetails.html(''); // replace contents

      // Display Challenge ID and Task ID
      if (task.id) {
        const $header = $qaDetails
          .append('header')
          .attr('class', 'qa-details-header');

        $header
          .append('h4')
          .text(l10n.t('map_data.layers.maproulette.id_title'));

        $header
          .append('p')
          .text(`${task.props.parentId} / ${task.id}`)
          .selectAll('a')
          .attr('rel', 'noopener')
          .attr('target', '_blank');
      }

      const descriptionHtml = utilSanitizeHTML(generateDynamicContent(marked.parse(replaceMustacheTags(task.props.description, task), { async: false })));
      const instructionHtml = utilSanitizeHTML(generateDynamicContent(marked.parse(replaceMustacheTags(task.props.instruction, task), { async: false })));

      // We show the challenge description when user select an unkown challenge.
      // But we hide it if a specific (assumed to be know) challenge is selected.
      const hasChallengeID = (maproulette.challengeIDs.length === 1);
      if (!hasChallengeID && task.props.description) {
        const $description = $qaDetails
          .append('article');

        const $descriptionHeader = $description
          .append('header')
          .attr('class', 'qa-details-header');

        $descriptionHeader
          .append('h4')
          .text(l10n.t('text.detail', { n: 100 }));   // force plural, i.e. "Details"

        const $descriptionContent = $description
          .append('section')
          .attr('class', 'qa-details-container');

        $descriptionContent
          .html(descriptionHtml)
          .selectAll('a')
          .attr('rel', 'noopener')
          .attr('target', '_blank');
      }

      if (task.props.instruction && task.props.instruction !== task.props.description) {
        const $instruction = $qaDetails
          .append('article');

        const $instructionHeader = $instruction
          .append('header')
          .attr('class', 'qa-details-header');

        $instructionHeader
          .append('h4')
          .text(l10n.t('map_data.layers.maproulette.instruction_title'));

        const $instructionContent = $instruction
          .append('article')
          .attr('class', 'qa-details-container');

        $instructionContent
          .html(instructionHtml)
          .selectAll('a')
          .attr('rel', 'noopener')
          .attr('target', '_blank');
      }

      // Attach hover and click event listeners
      $parent.selectAll('.highlight-link')
        .on('mouseover', (d3_event: Event) => {
          const osmId = transformId(select(d3_event.currentTarget as any).attr('data-osm-id'));
          utilHighlightEntities(context, [osmId], true);
        })
        .on('mouseout', (d3_event: Event) => {
          const osmId = transformId(select(d3_event.currentTarget as any).attr('data-osm-id'));
          utilHighlightEntities(context, [osmId], false);
        })
        .on('click', (d3_event: Event) => {
          d3_event.preventDefault();
          const osmId = transformId(select(d3_event.currentTarget as any).attr('data-osm-id'));
          utilHighlightEntities(context, [osmId], false);
          this._highlightFeature(osmId);
        });
    }).catch(() => {
      const $errorSelection = $details.selectAll('.qa-details-subsection');
      $errorSelection.html(''); // replace contents

      const $errorContent = $errorSelection
        .append('div')
        .attr('class', 'qa-details-container');

      $errorContent
        .text(l10n.t('map_data.layers.maproulette.error_loading_task_details'));
    });
  }


  /**
   * Highlights or selects the OSM feature based on the provided identifier.
   * @param osmIdentifier - Example format: 'n123456@1' where 'n' indicates a node.
   */
  protected _highlightFeature(osmIdentifier: string): void {
    const idPart = osmIdentifier.split('@')[0]; // Retains the 'n' or 'w' prefix and removes the version
    // Pass the full ID including the prefix to the selection context
    this.context.enter('select-osm', {
      selection: { osm: [idPart] }
    });
  }
}
