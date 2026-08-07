import { DEG2RAD, Extent, vecEqual } from '@rapid-sdk/math';
import { select } from 'd3-selection';
import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { uiIcon } from '../icon.ts';
import { delayAsync, eventCancel, helpHtml, icon, transitionTime } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * The "Navigation" chapter of the walkthrough. Teaches panning, zooming, rotating, and how to
 * select features and read the feature editor.
 */
export class UiIntroNavigation extends AbstractIntroChapter {
  protected _townHallID: string;
  protected _townHallExtent: Extent;
  protected _springStreetID: string;
  protected _springStreetExtent: Extent;
  protected _onewayField: any;
  protected _maxspeedField: any;


  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.navigation.title';

    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');

    this._townHallID = 'n2061';
    this._townHallExtent = new Extent([-85.63654, 41.94290], [-85.63632, 41.94307]);
    this._springStreetID = 'w397';
    this._springStreetExtent = new Extent([-85.63588, 41.94155], [-85.63574, 41.94278]);
    this._onewayField = scope?.fields.get('oneway');
    this._maxspeedField = scope?.fields.get('maxspeed');
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._navigationIntroAsync;
  }


  /** @return `true` if the town hall is the single selected feature */
  protected _isTownHallSelected(): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    if (!graph.hasEntity(this._townHallID)) return false;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._townHallID;
  }

  /** @return `true` if Spring Street currently exists in the graph */
  protected _doesSpringStreetExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(graph.hasEntity(this._springStreetID));
  }

  /** @return `true` if Spring Street is the single selected feature */
  protected _isSpringStreetSelected(): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    if (!graph.hasEntity(this._springStreetID)) return false;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._springStreetID;
  }


  // "The main map area shows OpenStreetMap data on top of a background."
  // Click Ok to advance
  protected async _navigationIntroAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');

    const loc = this._townHallExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19, 0, msec);

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      const tipHtml = helpHtml(context, 'intro.navigation.map_info') + '{br}' +
        helpHtml(context, 'intro.navigation.map_info2');

      curtain.reveal({
        revealSelector: '.main-map',
        tipHtml: tipHtml,
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._panMapAsync)
      });
    });
  }


  // "There are several ways to pan the map:"
  // User can experiment, then click Ok to advance
  protected async _panMapAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        const startCenter = map.center() as Vec2;
        const pointerType = context.lastPointerType === 'mouse' ? 'mouse' : 'touch';

        const tipHtml = helpHtml(context, 'intro.navigation.pan') + '{br}' +
          (pointerType === 'touch' ? helpHtml(context, 'intro.navigation.pan_touch') + '{br}' : '') +
          (pointerType === 'mouse' ? helpHtml(context, 'intro.navigation.pan_mouse') + '{br}' : '') +
          (pointerType === 'mouse' ? helpHtml(context, 'intro.navigation.pan_touchpad') + '{br}' : '') +
          helpHtml(context, 'intro.navigation.pan_keyboard') + '{br}' +
          helpHtml(context, 'intro.navigation.pan_the_map');

        this._onMapMove = () => {
          if (!vecEqual(map.center() as Vec2, startCenter)) {  // center changed
            const instruction = select('.curtain-tooltip .instruction');
            instruction.call(uiIcon('#rapid-icon-apply', 'inline success'));
          }
        };

        curtain.reveal({
          revealSelector: '.main-map',
          tipHtml: tipHtml,
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._zoomMapAsync)
        });
      });
    } finally {
      this._onMapMove = null;
    }
  }


  // "There are several ways to zoom the map:"
  // User can experiment, then click Ok to advance
  protected async _zoomMapAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        const startZoom = context.viewport.transform.zoom;
        const pointerType = context.lastPointerType === 'mouse' ? 'mouse' : 'touch';

        const tipHtml = helpHtml(context, 'intro.navigation.zoom') + '{br}' +
          (pointerType === 'touch' ? helpHtml(context, 'intro.navigation.zoom_touch_pinch') + '{br}' : '') +
          (pointerType === 'touch' ? helpHtml(context, 'intro.navigation.zoom_touch_doubletap') + '{br}' : '') +
          (pointerType === 'mouse' ? helpHtml(context, 'intro.navigation.zoom_mouse_scroll') + '{br}' : '') +
          (pointerType === 'mouse' ? helpHtml(context, 'intro.navigation.zoom_mouse_doubleclick') + '{br}' : '') +
          (pointerType === 'mouse' ? helpHtml(context, 'intro.navigation.zoom_touchpad') + '{br}' : '') +
          helpHtml(context, 'intro.navigation.zoom_keyboard') + '{br}' +
          helpHtml(context, 'intro.navigation.zoom_buttons') + '{br}' +
          helpHtml(context, 'intro.navigation.zoom_the_map');

        this._onMapMove = () => {
          if (context.viewport.transform.zoom !== startZoom) {  // zoom changed
            const instruction = select('.curtain-tooltip .instruction');
            instruction.call(uiIcon('#rapid-icon-apply', 'inline success'));
          }
        };

        curtain.reveal({
          revealSelector: '.main-map',
          tipHtml: tipHtml,
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._userSettingsAsync)
        });
      });
    } finally {
      this._onMapMove = null;
    }
  }


  // "If the touchpad or mouse wheel doesn't zoom as expected..."
  // Ok to advance
  protected async _userSettingsAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    ui.togglePanes(container.select('.map-panes .preferences-pane'));  // show preferences pane

    await delayAsync();  // after preferences pane visible

    return await new Promise<IntroStep>((resolve) => {
      curtain.reveal({
        revealSelector: '.map-panes .preferences-pane',
        tipHtml: helpHtml(context, 'intro.navigation.user_settings'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => {
          ui.togglePanes();   // hide preferences pane
          resolve(this._rotateMapAsync);
        }
      });
    });
  }


  // "There are several ways to rotate the map:"
  // User can experiment, then click Ok to advance
  protected async _rotateMapAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        const startRotation = context.viewport.transform.rotation;
        const pointerType = context.lastPointerType === 'mouse' ? 'mouse' : 'touch';

        const tipHtml = helpHtml(context, 'intro.navigation.rotate') + '{br}' +
          helpHtml(context, `intro.navigation.rotate_${pointerType}`) + '{br}' +
          helpHtml(context, 'intro.navigation.rotate_keyboard') + '{br}' +
          helpHtml(context, 'intro.navigation.rotate_the_map');

        this._onMapMove = () => {
          if (context.viewport.transform.rotation !== startRotation) {  // rotation changed
            const instruction = select('.curtain-tooltip .instruction');
            instruction.call(uiIcon('#rapid-icon-apply', 'inline success'));
          }
        };

        curtain.reveal({
          revealSelector: '.main-map',
          tipHtml: tipHtml,
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._resetBearingAsync)
        });
      });
    } finally {
      this._onMapMove = null;
    }
  }


  // "This compass button shows you the current rotation..."
  // Reset the map bearing to advance
  protected async _resetBearingAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const map = context.systems.map!;
    const curtain = this._curtain;

    // For the bearing to appear to reset, it needs to start out at not zero.
    // Introduce some rotation if the user entered this step with no rotation.
    let rot = context.viewport.transform.rotation;
    let msec = 0;
    if (rot < 5 * DEG2RAD) {
      rot = 45 * DEG2RAD;
      msec = 100;
    }

    await map.setMapParamsAsync(undefined, undefined, rot, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        this._onMapMove = () => {
          if (context.viewport.transform.rotation === 0) {  // rotation reset
            resolve(this._featuresAsync);
          }
        };

        curtain.reveal({
          revealSelector: '.main-map',
          tipSelector: '.map-control.bearing',
          tipHtml: helpHtml(context, 'intro.navigation.reset_bearing')
        });
      });
    } finally {
      this._onMapMove = null;
    }
  }


  // "We use the word *features* to describe the things that appear on the map..."
  // Click Ok to advance
  protected async _featuresAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.main-map',
        tipHtml: helpHtml(context, 'intro.navigation.features'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._pointsLinesAreasAsync)
      });
    });
  }


  // "Map features are represented using points, lines, or areas..."
  // Click Ok to advance
  protected async _pointsLinesAreasAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.main-map',
        tipHtml: helpHtml(context, 'intro.navigation.points_lines_areas'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._nodesWaysAsync)
      });
    });
  }


  // "Points are sometimes called nodes and lines and areas are sometimes called ways..."
  // Click Ok to advance
  protected async _nodesWaysAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.main-map',
        tipHtml: helpHtml(context, 'intro.navigation.nodes_ways'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._clickTownHallAsync)
      });
    });
  }


  // Select the town hall to advance
  protected async _clickTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');

    const loc = this._townHallExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19, undefined, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        this._onModeChange = () => resolve(this._selectedTownHallAsync);

        const textID = context.lastPointerType === 'mouse' ? 'click_townhall' : 'tap_townhall';
        curtain.reveal({
          revealExtent: this._townHallExtent,
          tipHtml: helpHtml(context, `intro.navigation.${textID}`)
        });

      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Great! The point is now selected..."
  // Click Ok to advance
  protected async _selectedTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._isTownHallSelected()) return this._clickTownHallAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        curtain.reveal({
          revealExtent: this._townHallExtent,
          tipHtml: helpHtml(context, 'intro.navigation.selected_townhall'),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._editorTownHallAsync)
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "When a feature is selected, the feature editor is displayed alongside the map."
  // Click Ok to advance
  protected async _editorTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._isTownHallSelected()) return this._clickTownHallAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        ui.Sidebar.showEntityEditor();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.navigation.editor_townhall'),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._presetTownHallAsync)
        });
      });
    } finally {
      this._onModeChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "The top part of the feature editor shows the feature's type."
  // Click Ok to advance
  protected async _presetTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._isTownHallSelected()) return this._clickTownHallAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        ui.Sidebar.showEntityEditor();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        // preset match, in case the user happened to change it.
        const graph = editor.staging.graph;
        const entity = graph.entity(context.selectedIDs()[0]);
        const preset = schema.match(entity, graph);

        curtain.reveal({
          revealSelector: '.entity-editor-pane .section-feature-type',
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.navigation.preset_townhall', { preset: preset!.name }),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._fieldsTownHallAsync)
        });
      });
    } finally {
      this._onModeChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "The middle part of the feature editor contains fields..."
  // Click Ok to advance
  protected async _fieldsTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._isTownHallSelected()) return this._clickTownHallAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        ui.Sidebar.showEntityEditor();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        curtain.reveal({
          revealSelector: '.entity-editor-pane .section-preset-fields',
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.navigation.fields_townhall'),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._closeTownHallAsync)
        });
      });
    } finally {
      this._onModeChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // Close entity editor / leave select mode to advance
  protected async _closeTownHallAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._isTownHallSelected()) return this._clickTownHallAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._searchStreetAsync);

        ui.Sidebar.showEntityEditor();

        const iconSelector = '.entity-editor-pane button.close svg use';
        const iconName = select(iconSelector).attr('href') || '#rapid-icon-close';
        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipSelector: '.entity-editor-pane button.close',
          tipHtml: helpHtml(context, 'intro.navigation.close_townhall', { button: icon(iconName, 'inline') })
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "You can also search for features in the current view, or worldwide."
  // "Search for Spring Street..."
  // Type in the search box to advance
  protected async _searchStreetAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');  // ensure spring street exists

    const loc = this._springStreetExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        curtain.reveal({
          revealSelector: '.search-header input',
          tipHtml: helpHtml(context, 'intro.navigation.search_street', { name: l10n.t('intro.graph.name.spring-street') })
        });

        container.select('.search-header input').on('keyup.intro', () => resolve(this._checkSearchResultAsync));
      });
    } finally {
      container.select('.search-header input').on('keyup.intro', null);
    }
  }


  // "Choose Spring Street from the list to select it..."
  // Click Spring Street item to advance
  protected async _checkSearchResultAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._doesSpringStreetExist()) return this._searchStreetAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._selectedStreetAsync);

        container.select('.search-header input').on('keyup.intro', () => {
          const first = container.select('.feature-list-item:nth-child(0n+2)');  // skip "No Results" item
          const firstName = first.select('.entity-name');
          const name = l10n.t('intro.graph.name.spring-street');

          if (!firstName.empty() && firstName.html() === name) {
            curtain.reveal({
              revealNode: first.node(),
              revealPadding: 5,
              tipHtml: helpHtml(context, 'intro.navigation.choose_street', { name: name })
            });
            // no more typing
            container.select('.search-header input')
              .on('keydown.intro', eventCancel, true)
              .on('keyup.intro', null);
          }
        });
      });
    } finally {
      this._onModeChange = null;
      container.select('.search-header input')
        .on('keydown.intro', null)
        .on('keyup.intro', null);
    }
  }


  // "Great! Spring Street is now selected..."
  // Click Ok to advance
  protected async _selectedStreetAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const map = context.systems.map!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    // Note, the map is about to try easing to show all of Spring Street
    // due to the user clicking it in the feature list.
    // For the purposes of the tutorial, we want to force the map
    // to show only the `springStreetExtent` instead.
    const loc = this._springStreetExtent.center();

    await map.setMapParamsAsync(loc, 19, 0, 0 /* asap */);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change

        if (!this._isSpringStreetSelected()) { resolve(this._searchStreetAsync); return; }

        curtain.reveal({
          revealExtent: this._springStreetExtent,
          revealPadding: 40,
          tipHtml: helpHtml(context, 'intro.navigation.selected_street', { name: l10n.t('intro.graph.name.spring-street') }),
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._editorStreetAsync)
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "The fields shown for a street are different than the fields that were shown for the town hall."
  // Close Entity editor / leave select mode to advance
  protected async _editorStreetAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._isSpringStreetSelected()) return this._searchStreetAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._playAsync);

        ui.Sidebar.showEntityEditor();
        const iconSelector = '.entity-editor-pane button.close svg use';
        const iconName = select(iconSelector).attr('href') || '#rapid-icon-close';
        const tipHtml = helpHtml(context, 'intro.navigation.street_different_fields') + '{br}' +
          helpHtml(context, 'intro.navigation.editor_street', {
            button: icon(iconName, 'inline'),
            field1: this._onewayField.label,
            field2: this._maxspeedField.label
          });

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: tipHtml
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // Free play
  // Click on Points (or another) chapter to advance
  protected async _playAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.ideditor',
      tipSelector: '.intro-nav-wrap .chapter-point',
      tipHtml: helpHtml(context, 'intro.navigation.play', { next: l10n.t('intro.points.title') }),
      buttonText: l10n.t('intro.ok'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
  }
}
