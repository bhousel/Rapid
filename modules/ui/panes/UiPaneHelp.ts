import { select } from 'd3-selection';
import { marked } from 'marked';
import { UiPane } from '../UiPane.ts';
import { uiIcon } from '../icon.ts';
import { UiIntro } from '../intro/UiIntro.ts';
import { UiTooltip } from '../UiTooltip.ts';
import { helpHtml } from '../intro/helper.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


const DOC_SECTIONS: [string, string[]][] = [
    ['help', [
      'welcome',
      'open_data_h',
      'open_data',
      'before_start_h',
      'before_start',
      'open_source_h',
      'open_source',
      'open_source_help'
    ]],
    ['overview', [
      'navigation_h',
      'navigation_pan',
      'navigation_zoom',
      'navigation_rotate',
      'features_h',
      'features',
      'nodes_ways'
    ]],
    ['editing', [
      'select_h',
      'select_left_click',
      'select_right_click',
      'select_space',
      'multiselect_h',
      'multiselect',
      'multiselect_shift_click',
      'multiselect_lasso',
      'undo_redo_h',
      'undo_redo',
      'save_h',
      'save',
      'save_validation',
      'upload_h',
      'upload',
      'backups_h',
      'backups',
      'keyboard_h',
      'keyboard'
    ]],
    ['feature_editor', [
      'intro',
      'definitions',
      'type_h',
      'type',
      'type_picker',
      'fields_h',
      'fields_all_fields',
      'fields_example',
      'fields_add_field',
      'tags_h',
      'tags_all_tags',
      'tags_resources'
    ]],
    ['points', [
      'intro',
      'add_point_h',
      'add_point',
      'add_point_finish',
      'move_point_h',
      'move_point',
      'delete_point_h',
      'delete_point',
      'delete_point_command'
    ]],
    ['lines', [
      'intro',
      'add_line_h',
      'add_line',
      'add_line_draw',
      'add_line_continue',
      'add_line_finish',
      'modify_line_h',
      'modify_line_dragnode',
      'modify_line_addnode',
      'connect_line_h',
      'connect_line',
      'connect_line_display',
      'connect_line_drag',
      'connect_line_tag',
      'disconnect_line_h',
      'disconnect_line_command',
      'move_line_h',
      'move_line_command',
      'move_line_connected',
      'delete_line_h',
      'delete_line',
      'delete_line_command'
    ]],
    ['areas', [
      'intro',
      'point_or_area_h',
      'point_or_area',
      'add_area_h',
      'add_area_command',
      'add_area_draw',
      'add_area_continue',
      'add_area_finish',
      'square_area_h',
      'square_area_command',
      'modify_area_h',
      'modify_area_dragnode',
      'modify_area_addnode',
      'delete_area_h',
      'delete_area',
      'delete_area_command'
    ]],
    ['relations', [
      'intro',
      'edit_relation_h',
      'edit_relation',
      'edit_relation_add',
      'edit_relation_delete',
      'maintain_relation_h',
      'maintain_relation',
      'relation_types_h',
      'multipolygon_h',
      'multipolygon',
      'multipolygon_create',
      'multipolygon_merge',
      'turn_restriction_h',
      'turn_restriction',
      'turn_restriction_field',
      'turn_restriction_editing',
      'route_h',
      'route',
      'route_add',
      'boundary_h',
      'boundary',
      'boundary_add'
    ]],
    ['operations', [
      'intro',
      'intro_2',
      'straighten',
      'orthogonalize',
      'circularize',
      'move',
      'rotate',
      'reflect',
      'continue',
      'reverse',
      'disconnect',
      'split',
      'extract',
      'merge',
      'delete',
      'downgrade',
      'copy_paste'
    ]],
    ['notes', [
      'intro',
      'show_notes',
      'add_note_h',
      'add_note',
      'place_note',
      'move_note',
      'update_note_h',
      'update_note',
      'save_note_h',
      'save_note'
    ]],
    ['imagery', [
      'intro',
      'sources_h',
      'choosing',
      'sources',
      'offsets_h',
      'offset',
      'offset_change'
    ]],
    ['streetlevel', [
      'intro',
      'using_h',
      'using',
      'photos',
      'viewer'
    ]],
    ['gps', [
      'intro',
      'survey',
      'using_h',
      'using',
      'tracing',
      'upload'
    ]],
    ['qa', [
      'intro',
      'tools_h',
      'tools',
      'issues_h',
      'issues'
    ]]
];


const HEADINGS: Record<string, number> = {
  'help.help.open_data_h': 3,
  'help.help.before_start_h': 3,
    'help.help.open_source_h': 3,
    'help.overview.navigation_h': 3,
    'help.overview.features_h': 3,
    'help.editing.select_h': 3,
    'help.editing.multiselect_h': 3,
    'help.editing.undo_redo_h': 3,
    'help.editing.save_h': 3,
    'help.editing.upload_h': 3,
    'help.editing.backups_h': 3,
    'help.editing.keyboard_h': 3,
    'help.feature_editor.type_h': 3,
    'help.feature_editor.fields_h': 3,
    'help.feature_editor.tags_h': 3,
    'help.points.add_point_h': 3,
    'help.points.move_point_h': 3,
    'help.points.delete_point_h': 3,
    'help.lines.add_line_h': 3,
    'help.lines.modify_line_h': 3,
    'help.lines.connect_line_h': 3,
    'help.lines.disconnect_line_h': 3,
    'help.lines.move_line_h': 3,
    'help.lines.delete_line_h': 3,
    'help.areas.point_or_area_h': 3,
    'help.areas.add_area_h': 3,
    'help.areas.square_area_h': 3,
    'help.areas.modify_area_h': 3,
    'help.areas.delete_area_h': 3,
    'help.relations.edit_relation_h': 3,
    'help.relations.maintain_relation_h': 3,
    'help.relations.relation_types_h': 2,
    'help.relations.multipolygon_h': 3,
    'help.relations.turn_restriction_h': 3,
    'help.relations.route_h': 3,
    'help.relations.boundary_h': 3,
    'help.notes.add_note_h': 3,
    'help.notes.update_note_h': 3,
    'help.notes.save_note_h': 3,
    'help.imagery.sources_h': 3,
    'help.imagery.offsets_h': 3,
    'help.streetlevel.using_h': 3,
    'help.gps.using_h': 3,
    'help.qa.tools_h': 3,
    'help.qa.issues_h': 3
  };


export class UiPaneHelp extends UiPane {
  protected _docs: any[];
  protected _$content: D3Selection | null;
  protected _currIndex: number;

  public constructor(context: Context) {
    super(context, 'help');

    const l10n = context.systems.l10n!;

    this.key = l10n.t('shortcuts.command.toggle_help.key');
    this.label = l10n.t('text.help');
    this.description = l10n.t('text.help');
    this.iconName = 'rapid-icon-help';

    this._$content = null;
    this._currIndex = 0;

    // common replacements that we may use anywhere in the help text
    const rtl = l10n.isRTL ? '-rtl' : '';
    const replacements = {
      version: `**${context.version}**`,
      rapidicon: `<svg class="icon pre-text rapid"><use xlink:href="#rapid-logo-rapid-wordmark${rtl}"></use></svg>`
    };

    // For each doc section, squash all the subsections into a single markdown document
    this._docs = [];
    for (const [section, subsections] of DOC_SECTIONS) {
      const markdown = subsections.reduce((acc, subsection) => {
        const stringID = `help.${section}.${subsection}`;
        const depth = HEADINGS[stringID];                             // is this string a heading?
        const hhh = depth ? Array(depth + 1).join('#') + ' ' : '';    // if so, prepend with some ##'s
        return acc + hhh + helpHtml(context, stringID, replacements) + '\n\n';
      }, '');

      this._docs.push({
        title: l10n.t(`help.${section}.title`),
        contentHtml: (marked.parse(markdown.trim()) as string)
          .replace(/<code>/g, '<kbd>')       // use <kbd> styling for shortcuts
          .replace(/<\/code>/g, '<\/kbd>')
      });
    }

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._clickChapter = this._clickChapter.bind(this);
    this._clickWalkthrough = this._clickWalkthrough.bind(this);
    this._clickShortcuts = this._clickShortcuts.bind(this);
  }



  /**
   * All panes have a `renderContent` function that will render this pane's
   * content into the given parent selection.
   * (this is the render function)
   * @param $selection - A d3-selection to a HTMLElement to render the content into
   */
  public override renderContent($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    this._$content = $selection;

    // table of contents
    const $$toc = $selection.selectAll('.toc')
      .data([0])
      .enter()
      .append('ul')
      .attr('class', 'toc');

    $$toc.selectAll('li')
      .data(this._docs)
      .enter()
      .append('li')
      .append('a')
      .attr('href', '#')
      .text((d: any) => d.title)
      .on('click', (d3_event: Event, d: any) => {
        d3_event.preventDefault();
        this._clickChapter(d, this._docs.indexOf(d));
      });

    // button for the shortcuts
    const $$shortcuts = $$toc
      .append('li')
      .attr('class', 'shortcuts')
      .call(new UiTooltip(context)
        .title(l10n.t('shortcuts.tooltip'))
        .shortcut('?')
        .placement('top')
        .attach
      )
      .append('a')
      .attr('href', '#')
      .on('click', this._clickShortcuts);

    $$shortcuts
      .append('div')
      .attr('class', 'shortcuts-title-text');

    // button for the walkthrough
    const $$walkthrough = $$toc
      .append('li')
      .attr('class', 'walkthrough')
      .append('a')
      .attr('href', '#')
      .on('click', this._clickWalkthrough);

    $$walkthrough
      .append('svg')
      .attr('class', 'logo logo-walkthrough')
      .append('use')
      .attr('xlink:href', '#rapid-logo-walkthrough');

    $$walkthrough
      .append('div')
      .attr('class', 'walkthrough-title-text');

    // help content (everything that's not the table of contents)
    const $$wrap = $selection.selectAll('.help-content-wrap')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'help-content-wrap');

    $$wrap
      .append('div')
      .attr('class', 'help-content');

    $$wrap
      .append('div')
      .attr('class', 'nav');

    // update - set localized labels here so they re-localize on language change
    $selection.select('.shortcuts-title-text')
      .text(l10n.t('shortcuts.title'));
    $selection.select('.walkthrough-title-text')
      .text(l10n.t('splash.walkthrough'));

    this._clickChapter(this._docs[this._currIndex], this._currIndex);
  }


  /**
   * Displays the given help chapter (updates heading, content, and prev/next nav).
   * @param d - the chapter doc to display (`{ title, contentHtml }`)
   * @param i - the index of the chapter within `_docs`
   */
  protected _clickChapter(d: any, i: number): void {
    const l10n = this.context.systems.l10n!;

    if (!this._$content) return;  // called too early

    this._currIndex = i;
    const docs = this._docs;

    const isRTL = l10n.isRTL;
    this._$content.property('scrollTop', 0);

    const $helpPane = select((this._$content.node() as HTMLElement).parentElement);
    $helpPane.selectAll('.pane-heading > h2').text(d.title);

    const $content = this._$content.selectAll('.help-content');
    $content.html(d.contentHtml);
    $content.selectAll('a').attr('target', '_blank');  // outbound links should open in new tab

    this._$content.selectAll('.toc > li')
      .classed('selected', (item: any) => item === d);

    const drawNext = ($selection: D3Selection): void => {
      if (i === docs.length - 1) return;

      const $$nextLink = $selection
        .append('a')
        .attr('href', '#')
        .attr('class', 'next')
        .on('click', (d3_event: Event) => {
          d3_event.preventDefault();
          this._clickChapter(docs[i + 1], i + 1);
        });

      $$nextLink
        .append('span')
        .text(docs[i + 1].title)
        .call(uiIcon((isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward'), 'inline'));
    };

    const drawPrevious = ($selection: D3Selection): void => {
      if (i === 0) return;

      const $$prevLink = $selection
        .append('a')
        .attr('href', '#')
        .attr('class', 'previous')
        .on('click', (d3_event: Event) => {
          d3_event.preventDefault();
          this._clickChapter(docs[i - 1], i - 1);
        });

      $$prevLink
        .call(uiIcon((isRTL ? '#rapid-icon-forward' : '#rapid-icon-backward'), 'inline'))
        .append('span')
        .text(docs[i - 1].title);
    };

    const $nav = this._$content.selectAll('.nav');
    $nav.html('');    // empty innerHtml and replace it
    if (isRTL) {
      $nav.call(drawNext).call(drawPrevious);
    } else {
      $nav.call(drawPrevious).call(drawNext);
    }
  }


  /**
   * Starts the interactive walkthrough (intro) and closes the panes.
   * @param d3_event - triggering event
   */
  protected _clickWalkthrough(d3_event: Event): void {
    const context = this.context;
    const ui = context.systems.ui;

    d3_event.preventDefault();
    if (context.inIntro) return;
    new UiIntro(context).start();
    ui?.togglePanes();
  }


  /**
   * Opens the keyboard shortcuts dialog.
   * @param d3_event - triggering event
   */
  protected _clickShortcuts(d3_event: Event): void {
    const ui = this.context.systems.ui;
    d3_event.preventDefault();
    ui?.Shortcuts?.toggle();
  }
}
