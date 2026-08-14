import { Extent } from '@rapid-sdk/math';
import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { actionChangePreset } from '../../actions/change_preset.ts';
import { delayAsync, eventCancel, helpHtml, isMostlySquare, transitionTime } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * The "Buildings" chapter of the walkthrough. Teaches tracing building outlines,
 * squaring a house, and circularizing a storage tank.
 */
export class UiIntroBuilding extends AbstractIntroChapter {
  protected _houseExtent: Extent;
  protected _tankExtent: Extent;
  protected _buildingCatetory: any;
  protected _housePreset: any;
  protected _tankPreset: any;
  protected _houseID: string | null;
  protected _tankID: string | null;


  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.buildings.title';

    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');

    this._houseExtent = new Extent([-85.62836, 41.95622], [-85.62791, 41.95654]);
    this._tankExtent = new Extent([-85.62766, 41.95324], [-85.62695, 41.95372]);
    this._buildingCatetory = scope?.categories.get('category-building');
    this._housePreset = scope?.presets.get('building/house');
    this._tankPreset = scope?.presets.get('man_made/storage_tank');
    this._houseID = null;
    this._tankID = null;
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._addHouseAsync;
  }


  // Helper functions
  /** @return `true` if the tutorial house currently exists in the graph */
  protected _doesHouseExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._houseID && graph.hasEntity(this._houseID));
  }

  /** @return `true` if the tutorial house is the single selected feature */
  protected _isHouseSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._houseID;
  }

  /** @return `true` if the tutorial tank currently exists in the graph */
  protected _doesTankExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._tankID && graph.hasEntity(this._tankID));
  }

  /** @return `true` if the tutorial tank is the single selected feature */
  protected _isTankSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._tankID;
  }


  // "You can help improve this database by tracing buildings that aren't already mapped."
  // Click Add Area to advance
  protected async _addHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');
    this._houseID = null;

    const loc = this._houseExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._startHouseAsync);

        const tooltip = curtain.reveal({
          revealSelector: 'button.draw-area',
          tipHtml: helpHtml(context, 'intro.buildings.add_building')
        });

        tooltip!.selectAll('.popover-inner')
          .insert('svg', 'span')
          .attr('class', 'tooltip-illustration')
          .append('use')
          .attr('xlink:href', '#rapid-graphic-buildings');
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Let's add this house to the map by tracing its outline."
  // Place the first point to advance
  protected async _startHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const map = context.systems.map!;
    const curtain = this._curtain;

    this._houseID = null;

    await map.setMapParamsAsync(this._houseExtent.center(), 20, 0, 200);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (context.mode?.id !== 'draw-area') { resolve(this._addHouseAsync); return; }

        this._onModeChange = reject;   // disallow mode change
        this._onStableChange = (difference: any) => {
          for (const entity of difference.created()) {  // created a node and a way
            if (entity.type === 'way') {
              this._houseID = entity.id;
              resolve(this._continueHouseAsync);
            }
          }
        };

        const textID = (context.lastPointerType === 'mouse') ? 'click' : 'tap';
        const startString = helpHtml(context, 'intro.buildings.start_building') +
          helpHtml(context, `intro.buildings.building_corner_${textID}`);

        curtain.reveal({
          revealExtent: this._houseExtent,
          tipHtml: startString
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "Continue placing nodes to trace the outline of the building."
  // Enter Select mode to advance
  protected async _continueHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const curtain = this._curtain;

    if (!this._doesHouseExist() || context.mode?.id !== 'draw-area') return this._addHouseAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => {
          if (this._doesHouseExist() && this._isHouseSelected()) {
            const graph = editor.staging.graph;
            const way = graph.entity(this._houseID!) as any;

            // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
            const points = way.geoms.parts[0]?.local?.outer;

            if (points && isMostlySquare(points)) {
              resolve(this._chooseCategoryBuildingAsync);
            } else {
              resolve(this._retryHouseAsync);
            }

          } else {
            reject();  // disallow mode change
          }
        };

        const textID = (context.lastPointerType === 'mouse') ? 'click' : 'tap';
        const continueString = helpHtml(context, 'intro.buildings.continue_building') + '{br}' +
          helpHtml(context, `intro.areas.finish_area_${textID}`) + helpHtml(context, 'intro.buildings.finish_building');

        curtain.reveal({
          revealExtent: this._houseExtent,
          tipHtml: continueString
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "It looks like you had some trouble placing the nodes at the building corners. Try again!"
  // This happens if the isMostlySquare check fails on the shape the user drew.
  // Click Ok to advance
  protected async _retryHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._houseExtent,
        tipHtml: helpHtml(context, 'intro.buildings.retry_building'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._addHouseAsync)
      });
    });
  }


  // "Choose Building Features from the list."
  // Expand the Building Features category to advance
  protected async _chooseCategoryBuildingAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const buildingCatetory = this._buildingCatetory;

    await delayAsync();  // after preset pane visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        if (!this._doesHouseExist()) { resolve(this._addHouseAsync); return; }
        if (!this._isHouseSelected()) context.enter('select-osm', { selection: { osm: [this._houseID] }});

        this._onModeChange = reject;   // disallow mode change

        ui.Sidebar.showPresetList();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        const button = container.select('.preset-category_building .preset-list-button');
        if (button.empty()) { resolve(this._addHouseAsync); return; }

        curtain.reveal({
          revealNode: button.node(),
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.buildings.choose_category_building', { category: buildingCatetory.name })
        });

        button.on('click.intro', () => resolve(this._choosePresetHouse));
      });
    } finally {
      this._onModeChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.preset-list-button').on('click.intro', null);
    }
  }


  // "There are many different types of buildings, but this one is clearly a house."
  // Select the House preset to advance
  protected async _choosePresetHouse(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const curtain = this._curtain;
    const housePreset = this._housePreset;

    await delayAsync();  // after preset pane visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        if (!this._doesHouseExist()) { resolve(this._addHouseAsync); return; }
        if (!this._isHouseSelected()) context.enter('select-osm', { selection: { osm: [this._houseID] }});

        this._onModeChange = reject;   // disallow mode change
        this._onStableChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === housePreset) {
              resolve(this._hasHouseAsync);
            } else {
              resolve(this._chooseCategoryBuildingAsync);  // didn't pick house, retry
            }
          }
        };

        // ui.Sidebar.showPresetList();  // calling this again causes issue
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        const button = container.select('.preset-building_house .preset-list-button');
        if (button.empty()) { resolve(this._addHouseAsync); return; }

        curtain.reveal({
          revealNode: button.node(),
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.buildings.choose_preset_house', { preset: housePreset.name })
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.preset-list-button').on('click.intro', null);
    }
  }


  // Set a history checkpoint here, so we can return back to it if needed
  protected async _hasHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    if (!this._doesHouseExist()) return this._addHouseAsync;

    // Make sure it's still a house, in case user somehow changed it..
    const graph = editor.staging.graph;
    const entity = graph.entity(this._houseID!);
    const preset = schema.match(entity, graph);
    if (preset !== this._housePreset) {
      editor.perform(actionChangePreset(this._houseID!, preset, this._housePreset));
      editor.commit({
        annotation: l10n.t('operations.change_tags.annotation'),
        selectedIDs: [this._houseID!]
      });
    }

    editor.setCheckpoint('hasHouse');
    return this._rightClickHouseAsync;  // advance
  }


  // "Right-click to select the building you created and show the edit menu."
  // Open the edit menu to advance
  protected async _rightClickHouseAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const ui = context.systems.ui!;
    const EditMenu = ui.EditMenu;
    const curtain = this._curtain;

    if (!['browse', 'select-osm'].includes(context.mode?.id ?? '')) context.enter('browse');
    editor.restoreCheckpoint('hasHouse');

    // make sure user is zoomed in enough to actually see orthagonalize do something
    const setZoom = Math.max(map.zoom() as number, 20);

    await map.setMapParamsAsync(this._houseExtent.center(), setZoom, 0, 100);

    let onToggled: ((open: boolean) => void) | undefined;
    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onStableChange = reject;  // disallow doing anything else

        const textID = (context.lastPointerType === 'mouse') ? 'rightclick_building' : 'edit_menu_building_touch';
        curtain.reveal({
          revealExtent: this._houseExtent,
          tipHtml: helpHtml(context, `intro.buildings.${textID}`)
        });

        onToggled = (open: boolean) => {
          if (open) resolve(this._clickSquareAsync);
        };
        EditMenu.on('toggled', onToggled);
      });
    } finally {
      this._onStableChange = null;
      if (onToggled) EditMenu.off('toggled', onToggled);
    }
  }


  // "The house that you just added will look even better with perfectly square corners."
  // "Press the Square button to tidy up the building's shape."
  // Square the building to advance
  protected async _clickSquareAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    const buttonNode = container.select('.edit-menu-item-orthogonalize').node();
    if (!buttonNode) return this._rightClickHouseAsync;   // no Square button, try again

    await delayAsync();  // after edit menu fully visible

    try {
      await new Promise<void>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesHouseExist() || !this._isHouseSelected()) { resolve(); return; }

        const revealEditMenu = (duration = 0) => {
          const menuNode = container.select('.edit-menu').node();
          if (menuNode) {
            curtain.reveal({
              duration: duration,
              revealNode: menuNode,
              revealPadding: 50,
              tipHtml: helpHtml(context, 'intro.buildings.square_building')
            });
          } else {
            reject();   // menu has gone away - user scrolled it offscreen?
          }
        };

        this._onModeChange = reject;   // disallow mode change
        this._onStableChange = () => {
          this._onStableChange = null;
          this._onMapMove = null;
          curtain.reveal({ revealExtent: this._houseExtent });  // watch it change
          resolve();
        };
        this._onMapMove = revealEditMenu;     // on map moves, have the curtain follow the menu immediately

        revealEditMenu(250);             // first time revealing menu, transition curtain to the menu
      });

      await delayAsync();   // wait for orthogonalize transtion to complete

      // then check undo annotation to see what the user did
      if (editor.getUndoAnnotation() === l10n.t('operations.orthogonalize.annotation.feature', { n: 1 })) {
        return this._doneSquareAsync;
      } else {
        return this._retryClickSquareAsync;
      }
    } finally {
      this._onMapMove = null;
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "You didn't press the Square button. Try again."
  // Click Ok to advance
  protected async _retryClickSquareAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    context.enter('browse');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._houseExtent,
        tipHtml: helpHtml(context, 'intro.buildings.retry_square'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._rightClickHouseAsync)
      });
    });
  }


  // "See how the corners of the building moved into place? Let's learn another useful trick."
  // Click Ok to advance
  protected async _doneSquareAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    editor.setCheckpoint('doneSquare');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._houseExtent,
        tipHtml: helpHtml(context, 'intro.buildings.done_square'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._addTankAsync)
      });
    });
  }


  // "Next we'll trace this circular storage tank..."
  // Click Add Area to advance
  protected async _addTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('doneSquare');
    this._tankID = null;

    const loc = this._tankExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._startTankAsync);

        curtain.reveal({
          revealSelector: 'button.draw-area',
          tipHtml: helpHtml(context, 'intro.buildings.add_tank')
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Don't worry, you won't need to draw a perfect circle. Just draw an area inside the tank that touches its edge."
  // Place the first point to advance
  protected async _startTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (context.mode?.id !== 'draw-area') return this._addTankAsync;
    this._tankID = null;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change
        this._onStableChange = (difference: any) => {
          for (const entity of difference.created()) {  // created a node and a way
            if (entity.type === 'way') {
              this._tankID = entity.id;
              resolve(this._continueTankAsync);
            }
          }
        };

        const textID = context.lastPointerType === 'mouse' ? 'click' : 'tap';
        const startString = helpHtml(context, 'intro.buildings.start_tank') +
          helpHtml(context, `intro.buildings.tank_edge_${textID}`);

        curtain.reveal({
          revealExtent: this._tankExtent,
          tipHtml: startString
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "Add a few more nodes around the edge. The circle will be created outside the nodes that you draw."
  // Enter Select mode to advance
  protected async _continueTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (context.mode?.id !== 'draw-area') return this._addTankAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => {
          if (this._doesTankExist() && this._isTankSelected()) {
            resolve(this._searchPresetTankAsync);
          } else {
            reject();
          }
        };

        const textID = context.lastPointerType === 'mouse' ? 'click' : 'tap';
        const continueString = helpHtml(context, 'intro.buildings.continue_tank') + '{br}' +
          helpHtml(context, `intro.areas.finish_area_${textID}`) + helpHtml(context, 'intro.buildings.finish_tank');

        curtain.reveal({
          revealExtent: this._tankExtent,
          tipHtml: continueString
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Search for Storage Tank."
  // "Choose Storage Tank from the list"
  // Choose the Storage Tank preset to advance
  protected async _searchPresetTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const tankPreset = this._tankPreset;

    await delayAsync();  // after preset pane visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesTankExist()) { resolve(this._addTankAsync); return; }
        if (!this._isTankSelected()) context.enter('select-osm', { selection: { osm: [this._tankID] }});

        this._onModeChange = reject;   // disallow mode change
        this._onStableChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === tankPreset) {
              resolve(this._hasTankAsync);
            } else {
              reject();  // didn't pick tank
            }
          }
        };

        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        ui.Sidebar.showPresetList();

        curtain.reveal({
          revealSelector: '.preset-search-input',
          tipHtml: helpHtml(context, 'intro.buildings.search_tank', { preset: tankPreset.name })
        });

        container.select('.preset-search-input')
          .on('keydown.intro', null)
          .on('keyup.intro', checkPresetSearch);


        // Get user to choose the Tank preset from the search result
        function checkPresetSearch() {
          const first = container.select('.preset-list-item:first-child');
          if (!first.classed('preset-man_made_storage_tank')) return;

          curtain.reveal({
            revealNode: first.select('.preset-list-button').node(),
            revealPadding: 5,
            tipHtml: helpHtml(context, 'intro.buildings.choose_tank', { preset: tankPreset.name })
          });

          container.select('.preset-search-input')
            .on('keydown.intro', eventCancel, true)   // no more typing
            .on('keyup.intro', null);
        }
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.preset-search-input').on('keydown.intro keyup.intro', null);
    }
  }


  // Set a history checkpoint here, so we can return back to it if needed
  protected async _hasTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    if (!this._doesTankExist()) return this._addTankAsync;

    // Make sure it's still a tank, in case user somehow changed it..
    const graph = editor.staging.graph;
    const entity = graph.entity(this._tankID!);
    const preset = schema.match(entity, graph);
    if (preset !== this._tankPreset) {
      editor.perform(actionChangePreset(this._tankID!, preset, this._tankPreset));
      editor.commit({
        annotation: l10n.t('operations.change_tags.annotation'),
        selectedIDs: [this._tankID!]
      });
    }

    editor.setCheckpoint('hasTank');
    return this._rightClickTankAsync;  // advance
  }


  // "Right-click to select the storage tank you created and show the edit menu."
  // Open the edit menu to advance
  protected async _rightClickTankAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const ui = context.systems.ui!;
    const EditMenu = ui.EditMenu;
    const curtain = this._curtain;

    if (!['browse', 'select-osm'].includes(context.mode?.id ?? '')) context.enter('browse');
    editor.restoreCheckpoint('hasTank');

    let onToggled: ((open: boolean) => void) | undefined;
    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onStableChange = reject;  // disallow doing anything else

        const textID = (context.lastPointerType === 'mouse') ? 'rightclick_tank' : 'edit_menu_tank_touch';
        curtain.reveal({
          revealExtent: this._tankExtent,
          tipHtml: helpHtml(context, `intro.buildings.${textID}`)
        });

        onToggled = (open: boolean) => {
          if (open) resolve(this._clickCircleAsync);
        };
        EditMenu.on('toggled', onToggled);
      });
    } finally {
      this._onStableChange = null;
      if (onToggled) EditMenu.off('toggled', onToggled);
    }
  }


  // "Press the Circularize button to make the tank a circle."
  // Circularize the tank to advance
  protected async _clickCircleAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    const buttonNode = container.select('.edit-menu-item-circularize').node();
    if (!buttonNode) return this._rightClickTankAsync;   // no Circularize button, try again

    await delayAsync();  // after edit menu fully visible

    try {
      await new Promise<void>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesTankExist() || !this._isTankSelected()) { resolve(); return; }

        this._onModeChange = reject;   // disallow mode change

        const revealEditMenu = (duration = 0) => {
          const menuNode = container.select('.edit-menu').node();
          if (menuNode) {
            curtain.reveal({
              duration: duration,
              revealNode: menuNode,
              revealPadding: 50,
              tipHtml: helpHtml(context, 'intro.buildings.circle_tank')
            });
          } else {
            reject();   // menu has gone away - user scrolled it offscreen?
          }
        };

        this._onStableChange = () => {
          this._onMapMove = null;
          this._onStableChange = null;
          curtain.reveal({ revealExtent: this._tankExtent });  // watch it change
          resolve();
        };

        this._onMapMove = revealEditMenu;     // on map moves, have the curtain follow the menu immediately
        revealEditMenu(250);             // first time revealing menu, transition curtain to the menu
      });

      await delayAsync();   // wait for circularize transtion to complete

      // then check undo annotation to see what the user did
      if (editor.getUndoAnnotation() === l10n.t('operations.circularize.annotation.feature', { n: 1 })) {
        return this._playAsync;
      } else {
        return this._retryClickCircleAsync;
      }
    } finally {
      this._onMapMove = null;
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "You didn't press the {circularize_icon} {circularize} button. Try again."
  // Click Ok to advance
  protected async _retryClickCircleAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    context.enter('browse');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._tankExtent,
        tipHtml: helpHtml(context, 'intro.buildings.retry_circle'),
        buttonText: l10n.t('text.okay'),
        buttonCallback: () => resolve(this._rightClickTankAsync)
      });
    });
  }


  // Free play
  // Click on Rapid Features (or another) chapter to advance
  protected async _playAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.ideditor',
      tipSelector: '.intro-nav-wrap .chapter-rapid',
      tipHtml: helpHtml(context, 'intro.buildings.play', { next: l10n.t('intro.rapid.title') }),
      buttonText: l10n.t('text.okay'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
    // chapter is done
  }
}
