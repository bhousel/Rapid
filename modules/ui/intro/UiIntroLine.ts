import { Extent, geoSphericalDistance } from '@rapid-sdk/math';

import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { delayAsync, eventCancel, helpHtml, icon, transitionTime } from './helper.ts';

import type { Vec2 } from '@rapid-sdk/math';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';


/**
 * The "Lines" chapter of the walkthrough. Teaches drawing a new road, realigning an existing
 * road by moving nodes and midpoints, and multiselecting and deleting roads.
 */
export class UiIntroLine extends AbstractIntroChapter {
  protected _flowerStreetID: string;
  protected _tulipRoadStartExtent: Extent;
  protected _tulipRoadMidExtent: Extent;
  protected _tulipRoadIntersection: Vec2;
  protected _roadCategory: any;
  protected _residentialPreset: any;

  protected _woodStreetID: string;
  protected _woodStreetEndID: string;
  protected _woodStreetExtent: Extent;
  protected _woodStreetAddNode: Vec2;
  protected _woodStreetDragEndpoint: Vec2;
  protected _woodStreetDragMidpoint: Vec2;

  protected _washingtonStreetID: string;
  protected _twelfthAvenueID: string;
  protected _eleventhAvenueEndID: string;
  protected _deleteLinesExtent: Extent;
  protected _eleventhAvenueEnd: Vec2;

  protected _washingtonSegmentID: string | null;
  protected _lineID: string | null;


  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.lines.title';

    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');

    this._flowerStreetID = 'w646';
    this._tulipRoadStartExtent = new Extent([-85.63016, 41.95749], [-85.62937, 41.95843]);
    this._tulipRoadMidExtent = new Extent([-85.63044, 41.95686], [-85.62900, 41.95843]);
    this._tulipRoadIntersection = [-85.629745, 41.95742];
    this._roadCategory = scope?.categories.get('category-road_minor');
    this._residentialPreset = scope?.presets.get('highway/residential');

    this._woodStreetID = 'w525';
    this._woodStreetEndID = 'n2862';
    this._woodStreetExtent = new Extent([-85.62457, 41.95381], [-85.62326, 41.9548]);
    this._woodStreetAddNode = [-85.62390, 41.95397];
    this._woodStreetDragEndpoint = [-85.62387, 41.95467];
    this._woodStreetDragMidpoint = [-85.62386, 41.95430];

    this._washingtonStreetID = 'w522';
    this._twelfthAvenueID = 'w1';
    this._eleventhAvenueEndID = 'n3550';
    this._deleteLinesExtent = new Extent([-85.62304, 41.95084], [-85.62087, 41.95336]);
    this._eleventhAvenueEnd = [-85.622758, 41.951884];

    this._washingtonSegmentID = null;
    this._lineID = null;
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._addLineAsync;
  }


  // Helper functions

  /** @return `true` if the tutorial line currently exists in the graph */
  protected _doesLineExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._lineID && graph.hasEntity(this._lineID));
  }

  /** @return `true` if the tutorial line is the single selected feature */
  protected _isLineSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._lineID;
  }

  /** @return `true` if the tutorial line shares a node with Flower Street */
  protected _isLineConnected(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    const tulipRoad: any = this._lineID && graph.hasEntity(this._lineID);
    const flowerStreet: any = this._flowerStreetID && graph.hasEntity(this._flowerStreetID);
    if (!tulipRoad || !flowerStreet) return false;

    const drawNodes = graph.childNodes(tulipRoad);
    return drawNodes.some((node: any) => {
      return graph.parentWays(node).some((parent: any) => parent.id === this._flowerStreetID);
    });
  }

  /** @return `true` if the Wood Street way and endpoint node both exist */
  protected _hasWoodStreetParts(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(graph.hasEntity(this._woodStreetID) && graph.hasEntity(this._woodStreetEndID));
  }

  /** @return `true` if Wood Street is the single selected feature */
  protected _isWoodStreetSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._woodStreetID;
  }

  /** @return `true` if the Washington Street, 12th Avenue, and 11th Avenue parts all exist */
  protected _has12thAvenueParts(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(graph.hasEntity(this._washingtonStreetID) && graph.hasEntity(this._twelfthAvenueID) && graph.hasEntity(this._eleventhAvenueEndID));
  }

  /** @return `true` if the split-off Washington Street segment currently exists */
  protected _hasWashingtonSegment(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._washingtonSegmentID && graph.hasEntity(this._washingtonSegmentID));
  }

  /** @return `true` if the 11th Avenue endpoint is the single selected feature */
  protected _is11thAveEndSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._eleventhAvenueEndID;
  }


  /* DRAW TULIP ROAD */

  // "Lines are used to represent features such as roads, railroads, and rivers."
  // Click "Add Line" button to advance
  protected async _addLineAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');
    this._lineID = null;

    const loc = this._tulipRoadStartExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 18.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._startLineAsync);

        const tooltip = curtain.reveal({
          revealSelector: 'button.draw-line',
          tipHtml: helpHtml(context, 'intro.lines.add_line')
        });

        tooltip!.selectAll('.popover-inner')
          .insert('svg', 'span')
          .attr('class', 'tooltip-illustration')
          .append('use')
          .attr('xlink:href', '#rapid-graphic-lines');
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Here is a road that is missing. Let's add it!"
  // Place the first point to advance
  protected async _startLineAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (context.mode?.id !== 'draw-line') return this._addLineAsync;
    this._lineID = null;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change
        this._onStagingChange = (difference: any) => {
          for (const entity of difference.created()) {  // created a node and a way
            if (entity.type === 'way') {
              this._lineID = entity.id;
              resolve(this._drawLineAsync);
            }
          }
        };

        const textID = context.lastPointerType === 'mouse' ? 'start_line' : 'start_line_tap';
        const startLineString = helpHtml(context, 'intro.lines.missing_road') + '{br}' +
          helpHtml(context, 'intro.lines.line_draw_info') + helpHtml(context, `intro.lines.${textID}`);

        curtain.reveal({
          revealExtent: this._tulipRoadStartExtent,
          tipHtml: startLineString
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "Continue drawing the line by placing more nodes along the road."
  // "Place an intersection node on {name} to connect the two lines."
  protected async _drawLineAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    const loc = this._tulipRoadMidExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);

    await map.setMapParamsAsync(loc, 18.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist() || context.mode?.id !== 'draw-line') { resolve(this._addLineAsync); return; }

        this._onModeChange = () => resolve(this._retryIntersectAsync);
        this._onStagingChange = () => {
          if (this._isLineConnected()) resolve(this._finishLineAsync);
        };

        curtain.reveal({
          revealExtent: this._tulipRoadMidExtent,
          tipHtml: helpHtml(context, 'intro.lines.intersect', { name: l10n.t('intro.graph.name.flower-street') })
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "The road needs to intersect Flower Street. Let's try again!"
  // Click Ok to advance
  protected async _retryIntersectAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: new Extent(this._tulipRoadIntersection).padByMeters(15),
        tipHtml: helpHtml(context, 'intro.lines.retry_intersect', { name: l10n.t('intro.graph.name.flower-street') }),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._addLineAsync)
      });
    });
  }


  // "Continue drawing the line for the new road. Remember that you can drag and zoom the map if needed."
  // "When you're finished, click the last node again or press return."
  // Finish the road to advance
  protected async _finishLineAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const map = context.systems.map!;
    const curtain = this._curtain;

    const loc = this._tulipRoadMidExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);

    await map.setMapParamsAsync(loc, 18.5, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist() || context.mode?.id !== 'draw-line') { resolve(this._addLineAsync); return; }

        this._onModeChange = () => resolve(this._chooseCategoryRoadAsync);

        const textID = (context.lastPointerType === 'mouse') ? 'click' : 'tap';
        const continueLineText = helpHtml(context, 'intro.lines.continue_line') + '{br}' +
          helpHtml(context, `intro.lines.finish_line_${textID}`) + helpHtml(context, 'intro.lines.finish_road');

        curtain.reveal({
          revealSelector: '.main-map',
          tipHtml: continueLineText
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Select Minor Roads from the list."
  // Open the Minor Roads category to advance
  protected async _chooseCategoryRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const curtain = this._curtain;

    let categoryButton: any;

    await delayAsync();  // after presets visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist()) { resolve(this._addLineAsync); return; }
        if (!this._isLineSelected()) context.enter('select-osm', { selection: { osm: [this._lineID] }} );

        this._onModeChange = reject;   // disallow mode change

        // ui.Sidebar.showPresetList(); // calling this again causes issue
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        categoryButton = container.select('.preset-category_road_minor .preset-list-button');
        if (categoryButton.empty()) {
          reject(new Error('no minor roads category?'));
          return;
        }
        if (categoryButton.classed('expanded')) {
          resolve(this._choosePresetResidentialAsync);  // advance - already expanded
          return;
        }

        curtain.reveal({
          revealNode: categoryButton.node(),
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.lines.choose_category_road', { category: this._roadCategory.name })
        });

        categoryButton.on('click.intro', () => resolve(this._choosePresetResidentialAsync));
      });
    } finally {
      this._onModeChange = null;
      if (categoryButton) categoryButton.on('click.intro', null);
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "There are many different types of roads, but this one is a Residential Road..."
  // Select a preset to advance
  protected async _choosePresetResidentialAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const curtain = this._curtain;

    await delayAsync();  // after presets visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist()) { resolve(this._addLineAsync); return; }
        if (!this._isLineSelected()) context.enter('select-osm', { selection: { osm: [this._lineID] }} );

        // ui.Sidebar.showPresetList(); // calling this again causes issue
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        const categoryButton = container.select('.preset-category_road_minor .preset-list-button');
        if (categoryButton.empty()) {
          reject(new Error('no minor roads category?'));
          return;
        }
        if (!categoryButton.classed('expanded')) {
          resolve(this._chooseCategoryRoadAsync);   // category not expanded - go back
          return;
        }
        // reveal all choices - at this point in the tutorial we are giving the user more freedom
        const subgrid = container.select('.preset-category_road_minor .subgrid');
        if (subgrid.empty()) {
          reject(new Error('no minor roads presets?'));
          return;
        }

        this._onModeChange = reject;   // disallow mode change

        this._onStagingChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === this._residentialPreset) {
              resolve(this._nameRoadAsync);
            } else {
              resolve(this._retryPresetResidentialAsync);  // didn't pick residential, retry
            }
          }
        };

        curtain.reveal({
          revealNode: subgrid.node(),
          revealPadding: 5,
          tipSelector: '.preset-highway_residential .preset-list-button',
          tipHtml: helpHtml(context, 'intro.lines.choose_preset_residential', { preset: this._residentialPreset.name })
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "You didn't select the Residential type."
  // Click the preset button to advance
  protected async _retryPresetResidentialAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    await delayAsync();  // after presets visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist()) { resolve(this._addLineAsync); return; }
        if (!this._isLineSelected()) context.enter('select-osm', { selection: { osm: [this._lineID] }} );

        ui.Sidebar.showPresetList();
        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling

        const categoryButton = container.select('.preset-category_road_minor .preset-list-button');
        if (categoryButton.empty()) {
          reject(new Error('no minor roads category?'));
          return;
        }
        if (!categoryButton.classed('expanded')) {
          resolve(this._chooseCategoryRoadAsync);   // category not expanded - go back
          return;
        }
        // reveal just the button we want them to click
        const presetButton = container.select('.preset-highway_residential .preset-list-button');
        if (presetButton.empty()) {
          reject(new Error('no residential road preset?'));
          return;
        }

        this._onModeChange = reject;   // disallow mode change
        this._onStagingChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === this._residentialPreset) {
              resolve(this._nameRoadAsync);
            } else {
              resolve(this._chooseCategoryRoadAsync);  // didn't pick residential, retry
            }
          }
        };

        curtain.reveal({
          revealNode: presetButton.node(),
          revealPadding: 5,
          tipHtml: helpHtml(context, 'intro.lines.retry_preset_residential', { preset: this._residentialPreset.name })
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
    }
  }


  // "Give this road a name, then press the X button or Esc to close the feature editor."
  // Close entity editor / leave select mode to advance
  protected async _nameRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    await delayAsync();  // after presets visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesLineExist()) { resolve(this._addLineAsync); return; }
        if (!this._isLineSelected()) context.enter('select-osm', { selection: { osm: [this._lineID] }} );

        this._onModeChange = () => resolve(this._didNameRoadAsync);

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.lines.name_road', { button: icon('#rapid-icon-close', 'inline') }),
          tooltipClass: 'intro-lines-name_road'
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Looks good! Next we will learn how to update the shape of a line."
  // Click Ok to advance
  protected async _didNameRoadAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._doesLineExist()) return this._addLineAsync;
    editor.setCheckpoint('doneAddLine');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.main-map',
        tipHtml: helpHtml(context, 'intro.lines.did_name_road'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._updateLineAsync)
      });
    });
  }


  /* REALIGN WOOD STREET */

  // "Sometimes you will need to change the shape of an existing line. Here is a road that doesn't look quite right."
  // Click Ok to advance
  protected async _updateLineAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('doneAddLine');

    // It's remotely possible that in an earlier step,
    // the user scrolled over here and deleted some stuff we need.
    if (!this._hasWoodStreetParts()) editor.restoreCheckpoint('initial');

    const loc = this._woodStreetExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 19, 0, msec);

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._woodStreetExtent,
        tipHtml: helpHtml(context, 'intro.lines.update_line'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._addNodeAsync)
      });
    });
  }


  // "We can add some nodes to this line to improve its shape."
  // "One way to add a node is to double-click the line where you want to add a node."
  // Create a node on Wood Street to advance
  protected async _addNodeAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    context.enter('browse');
    if (!this._hasWoodStreetParts()) return this._updateLineAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        this._onModeChange = (mode: any) => {
          if (!['browse', 'select-osm'].includes(mode.id)) reject();
        };
        this._onStagingChange = (difference: any) => {
          if (difference && difference.created().length === 1) {   // expect to create 1 node
            resolve(this._startDragEndpointAsync);
          } else {
            reject();
          }
        };

        const textID = (context.lastPointerType === 'mouse') ? '' : '_touch';
        curtain.reveal({
          revealExtent: new Extent(this._woodStreetAddNode).padByMeters(15),
          tipHtml: helpHtml(context, `intro.lines.add_node${textID}`)
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "When a line is selected, you can adjust any of its nodes by clicking and holding down the left mouse button while you drag."
  // Drag the endpoint of Wood Street to the expected location to advance
  protected async _startDragEndpointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const dragBehavior = context.behaviors.drag!;
    const curtain = this._curtain;

    if (!this._hasWoodStreetParts()) return this._updateLineAsync;

    let checkDrag: (() => void) | undefined;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;

        const textID = context.lastPointerType === 'mouse' ? '' : '_touch';
        const startDragString = helpHtml(context, `intro.lines.start_drag_endpoint${textID}`) +
          helpHtml(context, 'intro.lines.drag_to_intersection');

        curtain.reveal({
          revealExtent: new Extent(this._woodStreetDragEndpoint).padByMeters(20),
          tipHtml: startDragString
        });

        checkDrag = () => {
          if (!this._hasWoodStreetParts()) {
            reject();
          } else {
            const graph = editor.staging.graph;
            const entity = graph.entity(this._woodStreetEndID) as any;
            if (geoSphericalDistance(entity.loc, this._woodStreetDragEndpoint) <= 4) {   // point is close enough
              resolve(this._finishDragEndpointAsync);   // advance to next step
            }
          }
        };
        dragBehavior.on('move', checkDrag);
      });
    } finally {
      if (checkDrag) dragBehavior.off('move', checkDrag);
    }
  }


  // "This spot looks good. Release the mouse button to finish dragging..."
  // Leave drag mode to advance
  protected async _finishDragEndpointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const dragBehavior = context.behaviors.drag!;
    const curtain = this._curtain;

    if (!this._hasWoodStreetParts()) return this._updateLineAsync;

    let checkDrag: (() => void) | undefined;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._startDragMidpointAsync);

        const textID = context.lastPointerType === 'mouse' ? '' : '_touch';
        const finishDragString = helpHtml(context, 'intro.lines.spot_looks_good') +
          helpHtml(context, `intro.lines.finish_drag_endpoint${textID}`);

        curtain.reveal({
          revealExtent: new Extent(this._woodStreetDragEndpoint).padByMeters(20),
          tipHtml: finishDragString
        });

        checkDrag = () => {
          if (!this._hasWoodStreetParts()) {
            reject();
          } else {
            const graph = editor.staging.graph;
            const entity = graph.entity(this._woodStreetEndID) as any;
            if (geoSphericalDistance(entity.loc, this._woodStreetDragEndpoint) > 4) {   // point is too far
              resolve(this._startDragEndpointAsync);   // back to previous step
            }
          }
        };
        dragBehavior.on('move', checkDrag);
      });
    } finally {
      this._onModeChange = null;
      if (checkDrag) dragBehavior.off('move', checkDrag);
    }
  }


  // "Small triangles are drawn at the *midpoints* between nodes."
  // "Another way to create a new node is to drag a midpoint to a new location."
  // Create a node on Wood Street to advance
  protected async _startDragMidpointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (!this._hasWoodStreetParts()) return this._updateLineAsync;
    if (!this._isWoodStreetSelected()) context.enter('select-osm', { selection: { osm: [this._woodStreetID] }} );

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change
        this._onStagingChange = (difference: any) => {
          if (difference && difference.created().length === 1) {
            resolve(this._continueDragMidpointAsync);
          }
        };

        curtain.reveal({
          revealExtent: new Extent(this._woodStreetDragMidpoint).padByMeters(20),
          tipHtml: helpHtml(context, 'intro.lines.start_drag_midpoint')
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "This line is looking much better! Continue to adjust this line until the curve matches the road shape."
  // "When you're happy with how the line looks, press Ok"
  // Click Ok to advance
  protected async _continueDragMidpointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._hasWoodStreetParts()) return this._updateLineAsync;

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;

      curtain.reveal({
        revealExtent: this._woodStreetExtent,
        tipHtml: helpHtml(context, 'intro.lines.continue_drag_midpoint'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => {
          editor.setCheckpoint('doneUpdateLine');
          resolve(this._deleteLinesAsync);
        }
      });
    });
  }


  /* MULTISELECT AND DELETE 12TH AVE */

  // "It's OK to delete lines for roads that don't exist in the real world..
  // Click Ok to advance
  protected async _deleteLinesAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('doneUpdateLine');

    // It's remotely possible that in an earlier step,
    // the user scrolled over here and deleted some stuff we need.
    if (!this._has12thAvenueParts()) editor.restoreCheckpoint('initial');

    const loc = this._deleteLinesExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    await map.setMapParamsAsync(loc, 18, 0, msec);

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._deleteLinesExtent,
        tipHtml: helpHtml(context, 'intro.lines.delete_lines', { street: l10n.t('intro.graph.name.12th-avenue') }),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._rightClickIntersectionAsync)
      });
    });
  }


  // "We will split Washington Street at this intersection and remove everything above it."
  // Select point with edit menu open to advance
  protected async _rightClickIntersectionAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const EditMenu = ui.EditMenu;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('doneUpdateLine');

    // It's remotely possible that in an earlier step,
    // the user scrolled over here and deleted some stuff we need.
    if (!this._has12thAvenueParts()) editor.restoreCheckpoint('initial');

    this._washingtonSegmentID = null;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onStagingChange = reject;  // disallow doing anything else

        const textID = (context.lastPointerType === 'mouse') ? 'rightclick_intersection' : 'edit_menu_intersection_touch';
        const rightClickString = helpHtml(context, 'intro.lines.split_street', {
          street1: l10n.t('intro.graph.name.11th-avenue'),
          street2: l10n.t('intro.graph.name.washington-street')
        }) + helpHtml(context, `intro.lines.${textID}`);

        curtain.reveal({
          revealExtent: new Extent(this._eleventhAvenueEnd).padByMeters(10),
          tipHtml: rightClickString
        });

        EditMenu.on('toggled.intro', (open: boolean) => {
          if (open) resolve(this._splitIntersectionAsync);
        });
      });
    } finally {
      this._onStagingChange = null;
      EditMenu.on('toggled.intro', null);
    }
  }


  // "Press the Split button to divide Washington Street"
  // Split Washington Street to advance
  protected async _splitIntersectionAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    const buttonNode = container.select('.edit-menu-item-split').node();
    if (!buttonNode) return this._rightClickIntersectionAsync;   // no Split button, try again

    this._washingtonSegmentID = null;

    await delayAsync();  // after edit menu fully visible

    try {
      await new Promise<void>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._has12thAvenueParts()) { resolve(); return; }
        if (!this._is11thAveEndSelected()) context.enter('select-osm', { selection: { osm: [this._eleventhAvenueEndID] }} );

        const revealEditMenu = (duration = 0): void => {
          const menuNode = container.select('.edit-menu').node();
          if (menuNode) {
            curtain.reveal({
              duration: duration,
              revealNode: menuNode,
              revealPadding: 50,
              tipHtml: helpHtml(context, 'intro.lines.split_intersection', { street: l10n.t('intro.graph.name.washington-street') })
            });
          } else {
            reject();   // menu has gone away - user scrolled it offscreen?
          }
        };

        this._onModeChange = reject;   // disallow mode change

        this._onStagingChange = (difference: any) => {
          this._onMapMove = null;
          this._onStagingChange = null;
          if (difference && difference.created()) {
            this._washingtonSegmentID = difference.created()[0].id;
            resolve();
          } else {
            reject();
          }
        };

        this._onMapMove = revealEditMenu;  // on map moves, have the curtain follow the menu immediately
        revealEditMenu(250);               // first time revealing menu, transition curtain to the menu
      });

      await delayAsync();   // wait for any transtion to complete

      // then check undo annotation to see what the user did
      if (editor.getUndoAnnotation() === l10n.t('operations.split.annotation.line', { n: 1 })) {
        return this._didSplitAsync;
      } else {
        return this._retrySplitAsync;
      }
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      this._onMapMove = null;
    }
  }


  // "You didn't press the Split button. Try again."
  // Click Ok to advance
  protected async _retrySplitAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    context.enter('browse');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._deleteLinesExtent,
        tipHtml: helpHtml(context, 'intro.lines.retry_split'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._rightClickIntersectionAsync)
      });
    });
  }


  // "Good job! Washington Street is now split into two pieces."
  // "The top part can be removed. Select the top part of Washington Street"
  // Select Washington Street top segment to advance
  protected async _didSplitAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._has12thAvenueParts()) return this._deleteLinesAsync;
    if (!this._hasWashingtonSegment()) return this._rightClickIntersectionAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._multiSelectAsync);
        this._onStagingChange = reject;  // disallow doing anything else

        const ids = context.selectedIDs();
        const string = 'intro.lines.did_split_' + (ids.length > 1 ? 'multi' : 'single');
        const street = l10n.t('intro.graph.name.washington-street');

        curtain.reveal({
          revealExtent: this._deleteLinesExtent,
          tipHtml: helpHtml(context, string, { street1: street, street2: street })
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "Washington Street is now selected. Let's also select 12th Avenue."
  // "You can hold Shift while clicking to select multiple things."
  // Multiselect both Washington Street top segment and 12th Avenue to advance
  protected async _multiSelectAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    if (!this._has12thAvenueParts()) return this._deleteLinesAsync;
    if (!this._hasWashingtonSegment()) return this._rightClickIntersectionAsync;

    // This step is for when one thing is selected and we are trying to
    // teach the user to shift-click to select a second thing.
    const ids = context.selectedIDs();
    const hasWashington = ids.indexOf(this._washingtonSegmentID!) !== -1;
    const hasTwelfth = ids.indexOf(this._twelfthAvenueID) !== -1;

    if (hasWashington && hasTwelfth) {
      return this._multiRightClickAsync;  // both roads selected - go forward
    } else if (!hasWashington && !hasTwelfth) {
      return this._didSplitAsync;         // neither selected - go back
    }

    let selected, other;
    if (hasWashington) {
      selected = l10n.t('intro.graph.name.washington-street');
      other = l10n.t('intro.graph.name.12th-avenue');
    } else {
      selected = l10n.t('intro.graph.name.12th-avenue');
      other = l10n.t('intro.graph.name.washington-street');
    }

    const textID = (context.lastPointerType === 'mouse') ? 'click' : 'touch';
    const string =
      helpHtml(context, 'intro.lines.multi_select', { selected: selected, other1: other }) + ' ' +
      helpHtml(context, `intro.lines.add_to_selection_${textID}`, { selected: selected, other2: other });

    curtain.reveal({
      revealExtent: this._deleteLinesExtent,
      tipHtml: string
    });

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;  // reject will retry this step, which is what we want
        this._onStagingChange = reject;  // disallow doing anything else
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "Good! Both lines to delete are now selected."
  // "Right-click on one of the lines to show the edit menu."
  // Open edit menu with both lines multiselected to advance
  protected async _multiRightClickAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const EditMenu = ui.EditMenu;
    const curtain = this._curtain;

    if (!this._has12thAvenueParts()) return this._deleteLinesAsync;
    if (!this._hasWashingtonSegment()) return this._rightClickIntersectionAsync;

    const ids = context.selectedIDs();
    const selectedWashington = ids.indexOf(this._washingtonSegmentID!) !== -1;
    const selectedTwelfth = ids.indexOf(this._twelfthAvenueID) !== -1;
    if (!selectedWashington || !selectedTwelfth) {
      return this._multiSelectAsync;   // both need to be selected - go back
    }

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = reject;   // disallow mode change
        this._onStagingChange = reject;   // disallow doing anything else

        const textID = context.lastPointerType === 'mouse' ? 'rightclick' : 'edit_menu_touch';
        const rightClickString = helpHtml(context, 'intro.lines.multi_select_success') + helpHtml(context, `intro.lines.multi_${textID}`);

        curtain.reveal({
          revealExtent: this._deleteLinesExtent,
          tipHtml: rightClickString
        });

        EditMenu.on('toggled.intro', (open: boolean) => {
          if (open) resolve(this._multiDeleteAsync);
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      EditMenu.on('toggled.intro', null);
    }
  }


  // "Press the Delete button to remove the extra lines."
  // Both lines should be deleted to advance
  protected async _multiDeleteAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const curtain = this._curtain;

    const buttonNode = container.select('.edit-menu-item-delete').node();
    if (!buttonNode) return this._multiSelectAsync;   // no Delete button, try again

    await delayAsync();  // after edit menu fully visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._has12thAvenueParts()) { resolve(this._deleteLinesAsync); return; }
        if (!this._hasWashingtonSegment()) { resolve(this._rightClickIntersectionAsync); return; }

        const ids = context.selectedIDs();
        const selectedWashington = ids.indexOf(this._washingtonSegmentID!) !== -1;
        const selectedTwelfth = ids.indexOf(this._twelfthAvenueID) !== -1;
        if (!selectedWashington || !selectedTwelfth) {
          resolve(this._multiSelectAsync);   // both need to be selected - go back
          return;
        }

        const revealEditMenu = (duration = 0): void => {
          const menuNode = container.select('.edit-menu').node();
          if (menuNode) {
            curtain.reveal({
              duration: duration,
              revealNode: menuNode,
              revealPadding: 50,
              tipHtml: helpHtml(context, 'intro.lines.multi_delete')
            });
          } else {
            reject();   // menu has gone away - user scrolled it offscreen?
          }
        };

        // In most cases we receive the edit change event before the mode change event..
        // In this case, we might get them the other way around, because the legacy modeSelect listens for
        // edit change and will switch to browse mode if the previously selected features go away.
        // To fix this, we'll listen to both events to see whether the road segments have been deleted.

        this._onModeChange = (mode: any) => {
          const graph = editor.staging.graph;
          if (mode.id === 'browse' && !graph.hasEntity(this._washingtonSegmentID!) && !graph.hasEntity(this._twelfthAvenueID)) {
            resolve(this._playAsync);
          } else {
            resolve(this._multiSelectAsync);   // lost select mode - go back
          }
        };

        this._onStagingChange = () => {
          this._onStagingChange = null;
          this._onModeChange = null;
          const graph = editor.staging.graph;
          if (!graph.hasEntity(this._washingtonSegmentID!) && !graph.hasEntity(this._twelfthAvenueID)) {
            resolve(this._playAsync);
          } else {
            resolve(this._retryDeleteAsync);   // changed something but roads still exist - go back
          }
        };

        this._onMapMove = revealEditMenu;   // on map moves, have the curtain follow the menu immediately
        revealEditMenu(250);                // first time revealing menu, transition curtain to the menu
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
      this._onMapMove = null;
    }
  }


  // "You didn't press the Delete button. Try again."
  // Click Ok to advance
  protected async _retryDeleteAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    context.enter('browse');

    return await new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealExtent: this._deleteLinesExtent,
        tipHtml: helpHtml(context, 'intro.lines.retry_delete'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._multiSelectAsync)
      });
    });
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
      tipSelector: '.intro-nav-wrap .chapter-building',
      tipHtml: helpHtml(context, 'intro.lines.play', { next: l10n.t('intro.buildings.title') }),
      buttonText: l10n.t('intro.ok'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
    return;
  }
}
