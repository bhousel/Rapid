import { Extent } from '@rapid-sdk/math';
import { select } from 'd3-selection';
import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { delayAsync, eventCancel, helpHtml, icon, transitionTime } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';
import type { Vec2 } from '@rapid-sdk/math';


const tulipLaneExtent = new Extent([-85.62991, 41.95568], [-85.62700, 41.95638]);


/**
 * The "Rapid" chapter of the walkthrough. Teaches how to use the AI-assisted (Rapid) features:
 * showing/hiding the AI roads, accepting a road, reviewing the resulting issue, and ignoring a road.
 */
export class UiIntroRapid extends AbstractIntroChapter {
  protected _tulipLaneID: string;


  /**
   * @param context - Global shared application context
   * @param curtain - `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.rapid.title';
    this._tulipLaneID = 'w-516';
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._welcomeAsync;
  }


  /**
   * Enter the chapter, first making sure the Rapid data layer is enabled.
   */
  public override enter(): void {
    const gfx = this.context.systems.gfx!;
    gfx.scene!.enableLayers('rapid');
    super.enter();
  }


  /**
   * Exit the chapter, turning the Rapid data layer and intro datasets back off.
   */
  public override exit(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;

    // Make sure Rapid data is off..
    gfx.scene!.disableLayers('rapid');
    rapid.disableDatasets('rapid_intro_graph');

    super.exit();
  }


  // Helper functions
  // (Note that this returns true whether the way lives in the Rapid graph or OSM graph)
  /** @return `true` if the tutorial road is the single selected feature */
  protected _isTulipLaneSelected(): boolean {
    const context = this.context;
    if (!['select', 'select-osm'].includes(context.mode?.id ?? '')) return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._tulipLaneID;
  }

  /** @return `true` if the tutorial road currently exists in the working graph */
  protected _isTulipLaneAccepted(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(graph.hasEntity(this._tulipLaneID));
  }


  // "This section of the walkthrough will teach you how to use these AI-assisted features..."
  // Click Ok to advance
  protected async _welcomeAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const rapid = context.systems.rapid!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');

    // Make sure Rapid data is on..
    gfx.scene!.enableLayers('rapid');
    rapid.enableDatasets('rapid_intro_graph');

    const loc = tulipLaneExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 18.5, 0, msec);

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;

      const rtl = l10n.isRTL ? '-rtl' : '';
      curtain.reveal({
        revealSelector: '.intro-nav-wrap .chapter-rapid',
        tipHtml: helpHtml(context, 'intro.rapid.start', {
          rapid: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'pre-text rapid')
        }),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._showHideRoadsAsync)
      });
    });
  }


  // "AI-assisted features are presented in a magenta-colored overlay..."
  // Click Ok to advance
  protected async _showHideRoadsAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;

      const rtl = l10n.isRTL ? '-rtl' : '';
      curtain.reveal({
        revealSelector: 'button.rapid-features',
        tipHtml: helpHtml(context, 'intro.rapid.ai_roads', {
          rapid: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'pre-text rapid')
        }),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._selectRoadAsync)
      });
    });
  }


  // "A single AI-assisted road has shown up on the map. Select the AI-assisted road with a left-click..."
  // Select Tulip Lane to advance
  protected async _selectRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');
    ui.togglePanes();   // close issue pane

    // Make sure Rapid data is on..
    gfx.scene!.enableLayers('rapid');
    rapid.enableDatasets('rapid_intro_graph');

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._acceptRoadAsync);

        select('.inspector-wrap').on('wheel.intro', eventCancel);  // prevent scrolling

        curtain.reveal({
          revealExtent: tulipLaneExtent,
          tipHtml: helpHtml(context, 'intro.rapid.select_road')
        });
      });
    } finally {
      this._onModeChange = null;
      select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "Click the 'Use this Feature' button to add the road to the working map..."
  // Accept the feature to advance
  protected async _acceptRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const curtain = this._curtain;

    await delayAsync();  // after rapid inspector visible

    try {
      await new Promise<void>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._isTulipLaneSelected()) { resolve(); return; }

        this._onModeChange = resolve;
        curtain.reveal({
          revealSelector: '.rapid-inspector-choice-accept',
          tipHtml: helpHtml(context, 'intro.rapid.add_road')
        });
      });

      // check undo annotation to see what the user did
      if ((editor.getUndoAnnotation() as any)?.type === 'rapid_accept_feature') {
        return this._roadAcceptedAsync;
      } else {
        return this._selectRoadAsync;
      }
    } finally {
      this._onModeChange = null;
    }
  }


  // "The AI-assisted road has been added as a change to the map..."
  // Click Ok to advance
  protected async _roadAcceptedAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    await delayAsync();  // after entity inspector visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._isTulipLaneAccepted()) { resolve(this._selectRoadAsync); return; }
        if (!this._isTulipLaneSelected()) context.enter('select-osm', { selection: { osm: [this._tulipLaneID] }});

        this._onModeChange = reject;   // disallow mode change

        const rtl = l10n.isRTL ? '-rtl' : '';
        curtain.reveal({
          revealExtent: tulipLaneExtent,
          tipHtml: helpHtml(context, 'intro.rapid.add_road_not_saved_yet', {
            rapid: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'pre-text rapid')
          }),
          buttonText: l10n.t('text.okay'),
          buttonCallback: () => resolve(this._showIssuesButtonAsync)
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Now let's open up the issues panel..."
  // Open Issues panel to advance
  protected async _showIssuesButtonAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (!this._isTulipLaneAccepted()) return this._selectRoadAsync;
    if (!this._isTulipLaneSelected()) context.enter('select-osm', { selection: { osm: [this._tulipLaneID] }});

    const issuesButton = select('div.map-control.issues-control > button');

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        curtain.reveal({
          revealNode: issuesButton.node(),
          tipHtml: helpHtml(context, 'intro.rapid.open_issues')
        });
        issuesButton.on('click.intro', () => resolve(this._showLintAsync));
      });
    } finally {
      this._onModeChange = null;
      issuesButton.on('click.intro', null);
    }
  }


  // "The addition of the road has caused a new issue to appear in the issues panel..."
  // Click Ok to advance
  protected async _showLintAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    await delayAsync();  // after issues pane visible

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      if (!this._isTulipLaneAccepted()) { resolve(this._selectRoadAsync); return; }
      if (!this._isTulipLaneSelected()) context.enter('select-osm', { selection: { osm: [this._tulipLaneID] }});

      const label = select('li.issue.severity-warning');
      curtain.reveal({
        revealNode: label.node(),   // "connect these features" is expected to be the first child
        revealPadding: 5,
        tipHtml: helpHtml(context, 'intro.rapid.new_lints'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._undoRoadAddAsync)
      });
    });
  }


  // "We could fix the issue by connecting the roads, but let's instead undo..."
  // Click Undo to advance
  protected async _undoRoadAddAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (!this._isTulipLaneAccepted()) return this._selectRoadAsync;
    if (!this._isTulipLaneSelected()) context.enter('select-osm', { selection: { osm: [this._tulipLaneID] }});

    const undoButton = select('.map-toolbar button.undo-button');

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        curtain.reveal({
          revealNode: undoButton.node(),
          tipHtml: helpHtml(context, 'intro.rapid.undo_road_add', { button: icon('#rapid-icon-undo', 'inline') })
        });
        undoButton.on('click.intro', () => resolve(this._afterUndoRoadAddAsync));
      });
    } finally {
      undoButton.on('click.intro', null);
    }
  }


  // "The road is removed from your local changes, and has returned to the magenta layer as before..."
  // Click Ok to advance
  protected async _afterUndoRoadAddAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (this._isTulipLaneAccepted()) return this._selectRoadAsync;  // should be un-accepted now

    ui.togglePanes();   // close issue pane

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: tulipLaneExtent,
        tipHtml: helpHtml(context, 'intro.rapid.undo_road_add_aftermath'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._selectRoadAgainAsync)
      });
    });
  }


  // "Next, we'll learn how to ignore roads that you don't want to add..."
  // Select Tulip Lane to advance
  protected async _selectRoadAgainAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const map = context.systems.map!;
    const rapid = context.systems.rapid!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');

    // Make sure Rapid data is on..
    gfx.scene!.enableLayers('rapid');
    rapid.enableDatasets('rapid_intro_graph');

    const loc = tulipLaneExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 18.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        this._onModeChange = () => {
          if (!context.selectedIDs().includes(this._tulipLaneID)) return;
          resolve(this._ignoreRoadAsync);
        };

        curtain.reveal({
          revealExtent: tulipLaneExtent,
          tipHtml: helpHtml(context, 'intro.rapid.select_road_again')
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "This time, press the 'Ignore this Feature' button to remove the incorrect road from the working map..."
  // Ignore the road to advance
  protected async _ignoreRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const curtain = this._curtain;

    await delayAsync();  // after rapid inspector visible

    try {
      await new Promise<void>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._isTulipLaneSelected()) { resolve(); return; }

        this._onModeChange = resolve;

        curtain.reveal({
          revealSelector: '.rapid-inspector-choice-ignore',
          tipHtml: helpHtml(context, 'intro.rapid.ignore_road')
        });
      });

      // check undo annotation to see what the user did
      if ((editor.getUndoAnnotation() as any)?.type === 'rapid_ignore_feature') {
        return this._playAsync;
      } else {
        return this._selectRoadAgainAsync;
      }
    } finally {
      this._onModeChange = null;
    }
  }


  // Free play
  // Click on Start Editing (or another) chapter to advance
  protected async _playAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.ideditor',
      tipSelector: '.intro-nav-wrap .chapter-startEditing',
      tipHtml: helpHtml(context, 'intro.rapid.done', { next: l10n.t('intro.startediting.title') }),
      buttonText: l10n.t('text.okay'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
    // chapter is done
  }
}
