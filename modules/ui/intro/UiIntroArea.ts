import { Extent } from '@rapid-sdk/math';
import { select } from 'd3-selection';
import { interpolateNumber } from 'd3-interpolate';
import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { delayAsync, eventCancel, helpHtml, icon, transitionTime } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * The "Areas" chapter of the walkthrough. Teaches drawing an area feature, choosing a preset, and
 * adding a field to describe it.
 */
export class UiIntroArea extends AbstractIntroChapter {
  protected _playgroundExtent: Extent;
  protected _playgroundPreset: any;
  protected _nameField: any;
  protected _descriptionField: any;
  protected _areaID: string | null;


  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.areas.title';

    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');

    this._playgroundExtent = new Extent([-85.63575, 41.94137], [-85.63526, 41.94180]);
    this._playgroundPreset = scope?.presets.get('leisure/playground');
    this._nameField = scope?.fields.get('name');
    this._descriptionField = scope?.fields.get('description');
    this._areaID = null;
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._addAreaAsync;
  }


  /** @return `true` if the tutorial area currently exists in the graph */
  protected _doesAreaExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._areaID && graph.hasEntity(this._areaID));
  }

  /** @return `true` if the tutorial area is the single selected feature */
  protected _isAreaSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._areaID;
  }


  // "Areas are used to show the boundaries of features like lakes, buildings, and residential areas..."
  // Click "Add Area" button to advance
  protected async _addAreaAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');
    this._areaID = null;

    const loc = this._playgroundExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._startPlaygroundAsync);

        const tooltip = curtain.reveal({
          revealSelector: 'button.draw-area',
          tipHtml: helpHtml(context, 'intro.areas.add_playground')
        });

        tooltip!.selectAll('.popover-inner')
          .insert('svg', 'span')
          .attr('class', 'tooltip-illustration')
          .append('use')
          .attr('xlink:href', '#rapid-graphic-areas');
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Let's add this playground to the map by drawing an area..."
  // Click to place the initial point to advance
  protected async _startPlaygroundAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (context.mode?.id !== 'draw-area') return this._addAreaAsync;
    this._areaID = null;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;  // disallow mode change
        this._onStagingChange = (difference: any) => {
          for (const entity of difference.created()) {  // created a node and a way
            if (entity.type === 'way') {
              this._areaID = entity.id;
              resolve(this._continuePlaygroundAsync);
            }
          }
        };

        const textID = (context.lastPointerType === 'mouse') ? 'click' : 'tap';
        const startDrawString = helpHtml(context, 'intro.areas.start_playground') +
          helpHtml(context, `intro.areas.starting_node_${textID}`);

        curtain.reveal({
          revealExtent: this._playgroundExtent,
          tipHtml: startDrawString
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "Continue drawing the area by placing more nodes along the playground's edge..."
  // Add at least 5 nodes to advance
  protected async _continuePlaygroundAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (!this._doesAreaExist() || context.mode?.id !== 'draw-area') return this._addAreaAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;  // disallow mode change
        this._onStagingChange = (difference: any) => {
          for (const entity of difference.modified()) {  // modified the way
            if (entity.id === this._areaID && entity.nodes.length > 5) {
              resolve(this._finishPlaygroundAsync);
            }
          }
        };

        curtain.reveal({
          revealExtent: this._playgroundExtent,
          tipHtml: helpHtml(context, 'intro.areas.continue_playground')
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "Finish the area by pressing return, or clicking again on either the first or last node..."
  // Finish the area to advance
  protected async _finishPlaygroundAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (!this._doesAreaExist() || context.mode?.id !== 'draw-area') return this._addAreaAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._searchPresetAsync);

        const textID = (context.lastPointerType === 'mouse') ? 'click' : 'tap';
        const finishString = helpHtml(context, `intro.areas.finish_area_${textID}`) +
          helpHtml(context, 'intro.areas.finish_playground');

        curtain.reveal({
          revealExtent: this._playgroundExtent,
          tipHtml: finishString
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // Search for Playground and select it from the preset search result to advance
  protected async _searchPresetAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const playgroundPreset = this._playgroundPreset;

    await delayAsync();  // after preset pane visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesAreaExist()) { resolve(this._addAreaAsync); return; }
        if (!this._isAreaSelected()) context.enter('select-osm', { selection: { osm: [this._areaID] }} );

        this._onModeChange = reject;   // disallow mode change;
        this._onStagingChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === playgroundPreset) {
              resolve(this._clickAddFieldAsync);
            } else {
              reject();  // didn't pick playground
            }
          }
        };

        ui.Sidebar.showPresetList();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        curtain.reveal({
          revealSelector: '.preset-search-input',
          tipHtml: helpHtml(context, 'intro.areas.search_playground', { preset: playgroundPreset.name })
        });

        container.select('.preset-search-input')
          .on('keydown.intro', null)
          .on('keyup.intro', _checkPresetSearch);


        // Get user to choose the Playground preset from the search result
        function _checkPresetSearch() {
          const first = container.select('.preset-list-item:first-child');
          if (!first.classed('preset-leisure_playground')) return;

          curtain.reveal({
            revealNode: first.select('.preset-list-button').node(),
            revealPadding: 5,
            tipHtml: helpHtml(context, 'intro.areas.search_playground', { preset: playgroundPreset.name })
          });

          container.select('.preset-search-input')
            .on('keydown.intro', eventCancel, true)   // no more typing
            .on('keyup.intro', null);
        }
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.preset-search-input').on('keydown.intro keyup.intro', null);
    }
  }


  // "This playground doesn't have an official name, so we won't add anything in the name field..."
  // "Instead let's add some additional details about the playground to the description field..."
  // Expand the Add field combo to advance
  protected async _clickAddFieldAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const scheduler = context.systems.scheduler!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const nameField = this._nameField;
    const descriptionField = this._descriptionField;

    await delayAsync();  // after entity editor visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesAreaExist()) { resolve(this._addAreaAsync); return; }
        if (!this._isAreaSelected()) context.enter('select-osm', { selection: { osm: [this._areaID] }} );

        if (!container.select('.form-field-description').empty()) {  // has description field already
          resolve(this._describePlaygroundAsync);
          return;
        }

        // It's possible for the user to add a description in a previous step..
        // If they did this already, just complete this chapter
        const graph = editor.staging.graph;
        const entity = graph.entity(this._areaID!) as any;
        if (entity.tags.description) {
          resolve(this._playAsync);
          return;
        }

        this._onModeChange = reject;   // disallow mode change;

        ui.Sidebar.showEntityEditor();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        // scroll "Add field" into view
        const box = (container.select('.more-fields').node() as any).getBoundingClientRect();
        if (box.top > 300) {
          const pane = container.select('.entity-editor-pane .inspector-body');
          const start = (pane.node() as any).scrollTop;
          const end = start + (box.top - 300);

          pane
            .transition()
            .duration(250)
            .tween('scroll.inspector', (d: any, i: number, nodes: any) => {
              const lerp = interpolateNumber(start, end);
              return function(t: number) {
                const el = select(nodes[i]) as any;
                el.scrollTop = lerp(t);
              };
            });
        }

        scheduler.setTimeout('walkthrough-area-click-addfield', () => {
          curtain.reveal({
            revealSelector: '.more-fields .combobox-input',
            revealPadding: 5,
            tipHtml: helpHtml(context, 'intro.areas.add_field', {
              name: nameField.label,
              description: descriptionField.label
            })
          });

          container.select('.more-fields .combobox-input')
            .on('click.intro', () => {
              // Watch for the combobox to appear...
              scheduler.setInterval('walkthrough-area-waitfor-morefields', () => {
                if (!container.select('div.combobox').empty()) {
                  scheduler.cancel('walkthrough-area-waitfor-morefields');
                  resolve(this._chooseDescriptionFieldAsync);
                }
              }, { ms: 300 });
            });
        }, { ms: 300 });  // after "Add Field" visible

      });
    } finally {
      this._onModeChange = null;
      scheduler.cancel('walkthrough-area-click-addfield');
      scheduler.cancel('walkthrough-area-waitfor-morefields');
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.more-fields .combobox-input').on('click.intro', null);
    }
  }


  // "Choose Description from the list..."
  // Add the Description field to advance
  protected async _chooseDescriptionFieldAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const scheduler = context.systems.scheduler!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const descriptionField = this._descriptionField;

    if (!this._doesAreaExist()) return this._addAreaAsync;
    if (!this._isAreaSelected()) return this._searchPresetAsync;

    if (!container.select('.form-field-description').empty()) {  // has description field already
      return this._describePlaygroundAsync;
    }

    // Make sure combobox is open..
    if (container.select('div.combobox').empty()) {
      return this._clickAddFieldAsync;
    }

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change;

        // Watch for the combobox to close..
        scheduler.setInterval('walkthrough-area-waitfor-combo-close', () => {
          if (container.select('div.combobox').empty()) {
            scheduler.cancel('walkthrough-area-waitfor-combo-close');
            scheduler.setTimeout('walkthrough-area-waitfor-choose-description', () => {
              if (container.select('.form-field-description').empty()) {
                resolve(this._retryChooseDescriptionAsync);
              } else {
                resolve(this._describePlaygroundAsync);
              }
            }, { ms: 300 });  // after description field added.
          }
        }, { ms: 300 });

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: 'div.combobox',
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.areas.choose_field', { field: descriptionField.label })
        });

      });
    } finally {
      scheduler.cancel('walkthrough-area-waitfor-combo-close');
      scheduler.cancel('walkthrough-area-waitfor-choose-description');
      this._onModeChange = null;
    }
  }


  // "Add a description, then press the X button to close the feature editor..."
  // Close entity editor / leave select mode to advance
  protected async _describePlaygroundAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._doesAreaExist()) return this._addAreaAsync;
    if (!this._isAreaSelected()) return this._searchPresetAsync;

    if (container.select('.form-field-description').empty()) {  // no description field
      return this._retryChooseDescriptionAsync;
    }

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._playAsync);

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.areas.describe_playground', { button: icon('#rapid-icon-close', 'inline') })
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "You didn't select the Description field. Let's try again..."
  // Click Ok to advance
  protected async _retryChooseDescriptionAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const descriptionField = this._descriptionField;

    if (!this._doesAreaExist()) return this._addAreaAsync;
    if (!this._isAreaSelected()) return this._searchPresetAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change;
        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.areas.retry_add_field', { field: descriptionField.label }),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._clickAddFieldAsync)
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // Free play
  // Click on Lines (or another) chapter to advance
  protected async _playAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.ideditor',
      tipSelector: '.intro-nav-wrap .chapter-line',
      tipHtml: helpHtml(context, 'intro.areas.play', { next: l10n.t('intro.lines.title') }),
      buttonText: l10n.t('intro.ok'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
  }
}
