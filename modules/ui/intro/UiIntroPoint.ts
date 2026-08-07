import { Extent } from '@rapid-sdk/math';
import { select } from 'd3-selection';

import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { actionChangePreset } from '../../actions/change_preset.ts';
import { delayAsync, eventCancel, helpHtml, icon, transitionTime } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';
import type { Vec2 } from '@rapid-sdk/math';


const buildingExtent = new Extent([-85.63261, 41.94391], [-85.63222, 41.94419]);


/**
 * The "Points" chapter of the walkthrough. Teaches adding, editing, and deleting a point feature.
 */
export class UiIntroPoint extends AbstractIntroChapter {
  protected _cafePreset: any;
  protected _pointID: string | null;


  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.points.title';

    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');
    this._cafePreset = scope?.presets.get('amenity/cafe');
    this._pointID = null;
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._addPointAsync;
  }


  /** @return `true` if the tutorial point currently exists in the graph */
  protected _doesPointExist(): boolean {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;
    return Boolean(this._pointID && graph.hasEntity(this._pointID));
  }

  /** @return `true` if the tutorial point is the single selected feature */
  protected _isPointSelected(): boolean {
    const context = this.context;
    if (context.mode?.id !== 'select-osm') return false;
    const ids = context.selectedIDs();
    return ids.length === 1 && ids[0] === this._pointID;
  }


  // "Points can be used to represent features such as shops, restaurants, and monuments."
  // Click "Add Point" button to advance
  protected async _addPointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('initial');
    this._pointID = null;

    const loc = buildingExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    // bug: too hard to place a point in the building at z19 because of snapping to fill #719
    await map.setMapParamsAsync(loc, 20, 0, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._placePointAsync);

        const tooltip = curtain.reveal({
          revealSelector: 'button.add-point',
          tipHtml: helpHtml(context, 'intro.points.points_info') + '{br}' + helpHtml(context, 'intro.points.add_point')
        });

        tooltip!.selectAll('.popover-inner')
          .insert('svg', 'span')
          .attr('class', 'tooltip-illustration')
          .append('use')
          .attr('xlink:href', '#rapid-graphic-points');
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // Place a point in the revealed rectangle to advance
  protected async _placePointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    if (context.mode?.id !== 'add-point') return this._addPointAsync;
    this._pointID = null;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._searchPresetAsync);
        this._onStableChange = (difference: any) => {
          const created = difference.created();
          if (created.length !== 1) return;
          const entity = created[0];
          if (entity.geometry(difference._head) !== 'point') return;
          this._pointID = created[0].id;
        };

        const textID = (context.lastPointerType === 'mouse') ? 'place_point' : 'place_point_touch';
        curtain.reveal({
          revealExtent: buildingExtent,
          tipHtml: helpHtml(context, `intro.points.${textID}`)
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "The point you just added is a cafe..."
  // Search for Cafe in the preset search to advance
  protected async _searchPresetAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;
    const cafePreset = this._cafePreset;

    await delayAsync();  // after preset pane visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesPointExist()) { resolve(this._addPointAsync); return; }
        if (!this._isPointSelected()) context.enter('select-osm', { selection: { osm: [this._pointID] }});

        this._onModeChange = reject;  // disallow mode change
        this._onStableChange = (difference: any) => {
          const modified = difference.modified();
          if (modified.length === 1) {
            const graph = editor.staging.graph;
            if (schema.match(modified[0], graph) === cafePreset) {
              resolve(this._aboutFeatureEditorAsync);
            } else {
              reject();  // didn't pick cafe
            }
          }
        };

        container.select('.inspector-wrap').on('wheel.intro', eventCancel);   // prevent scrolling
        ui.Sidebar.showPresetList();

        curtain.reveal({
          revealSelector: '.preset-search-input',
          tipHtml: helpHtml(context, 'intro.points.search_cafe', { preset: cafePreset.name })
        });

        // Get user to choose the Cafe preset from the search result
        const checkPresetSearch = () => {
          const first = container.select('.preset-list-item:first-child');
          if (!first.classed('preset-amenity_cafe')) return;

          curtain.reveal({
            revealNode: first.select('.preset-list-button').node(),
            revealPadding: 5,
            tipHtml: helpHtml(context, 'intro.points.choose_cafe', { preset: cafePreset.name })
          });

          container.select('.preset-search-input')
            .on('keydown.intro', eventCancel, true)   // no more typing
            .on('keyup.intro', null);
        };

        container.select('.preset-search-input')
          .on('keydown.intro', null)
          .on('keyup.intro', checkPresetSearch);
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
      container.select('.inspector-wrap').on('wheel.intro', null);
      container.select('.preset-search-input').on('keydown.intro keyup.intro', null);
    }
  }


  // "The point is now marked as a cafe. Using the feature editor, we can add more information..."
  // Click Ok to advance
  protected async _aboutFeatureEditorAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    await delayAsync();  // after entity editor visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesPointExist()) { resolve(this._addPointAsync); return; }
        if (!this._isPointSelected()) context.enter('select-osm', { selection: { osm: [this._pointID] }});

        // If user leaves select mode here, just continue with the tutorial.
        this._onModeChange = () => resolve(this._addNameAsync);

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.points.feature_editor'),
          tipClass: 'intro-points-describe',
          buttonText: l10n.t('intro.ok'),
          buttonCallback: () => resolve(this._addNameAsync)
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Let's pretend that you have local knowledge of this cafe, and you know its name..."
  // Make any edit to advance (or click Ok if they happened to add a name already)
  protected async _addNameAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    await delayAsync();  // after entity editor visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesPointExist()) { resolve(this._addPointAsync); return; }
        if (!this._isPointSelected()) context.enter('select-osm', { selection: { osm: [this._pointID] }});

        // If user leaves select mode here, just continue with the tutorial.
        this._onModeChange = () => resolve(this._hasPointAsync);
        this._onStagingChange = () => resolve(this._addCloseEditorAsync);

        ui.Sidebar.showEntityEditor();

        // It's possible for the user to add a name in a previous step..
        // If so, don't tell them to add the name in this step - give them an OK button instead.
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this._pointID!) as any;
        if (entity.tags.name) {
          const tooltip = curtain.reveal({
            revealSelector: '.entity-editor-pane',
            tipHtml: helpHtml(context, 'intro.points.fields_info'),
            buttonText: l10n.t('intro.ok'),
            buttonCallback: () => resolve(this._addCloseEditorAsync)
          });

          tooltip!.select('.instruction').style('display', 'none');

        } else {
          curtain.reveal({
            revealSelector: '.entity-editor-pane',
            tipHtml: helpHtml(context, 'intro.points.fields_info') + '{br}' + helpHtml(context, 'intro.points.add_name'),
            tipClass: 'intro-points-describe'
          });
        }
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "The feature editor will remember all of your changes automatically..."
  // Close entity editor / leave select mode to advance
  protected async _addCloseEditorAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._doesPointExist()) return this._addPointAsync;
    if (!this._isPointSelected()) context.enter('select-osm', { selection: { osm: [this._pointID] }});

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._hasPointAsync);

        ui.Sidebar.showEntityEditor();

        const iconSelector = '.entity-editor-pane button.close svg use';
        const iconName = select(iconSelector).attr('href') || '#rapid-icon-close';
        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.points.add_close', { button: icon(iconName, 'inline') })
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // Set a checkpoint here, so we can return back to it if needed.
  // The point exists and it is a cafe and it probably has a name.
  protected async _hasPointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    if (!this._doesPointExist()) return this._addPointAsync;

    // Make sure it's still a cafe, in case user somehow changed it..
    const graph = editor.staging.graph;
    const entity = graph.entity(this._pointID!);
    const preset = schema.match(entity, graph);
    if (preset !== this._cafePreset) {
      editor.perform(actionChangePreset(this._pointID!, preset, this._cafePreset));
      editor.commit({
        annotation: l10n.t('operations.change_tags.annotation'),
        selectedIDs: [this._pointID!]
      });
    }

    editor.setCheckpoint('hasPoint');
    return this._reselectPointAsync;  // advance
  }


  // "Often points will already exist, but have mistakes or be incomplete..."
  // Reselect the point to advance
  protected async _reselectPointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    context.enter('browse');
    editor.restoreCheckpoint('hasPoint');

    const loc = buildingExtent.center();
    const msec = transitionTime(loc, map.center() as Vec2);
    if (msec > 0) curtain.hide();

    // bug: too hard to place a point in the building at z19 because of snapping to fill #719
    await map.setMapParamsAsync(loc, 20, undefined, msec);

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._updatePointAsync);

        curtain.reveal({
          revealExtent: buildingExtent,
          tipHtml: helpHtml(context, 'intro.points.reselect')
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "Let's fill in some more details for this cafe..."
  // Make any edit to advance
  protected async _updatePointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    await delayAsync();  // after entity editor visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        if (!this._doesPointExist() || !this._isPointSelected()) { resolve(this._reselectPointAsync); return; }

        this._onModeChange = reject;   // disallow mode change
        this._onStagingChange = () => resolve(this._updateCloseEditorAsync);

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.points.update'),
          tipClass: 'intro-points-describe'
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStagingChange = null;
    }
  }


  // "When you are finished updating the cafe..."
  // Close Entity editor / leave select mode to advance
  protected async _updateCloseEditorAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const curtain = this._curtain;

    if (!this._doesPointExist() || !this._isPointSelected()) return this._reselectPointAsync;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => resolve(this._rightClickPointAsync);

        ui.Sidebar.showEntityEditor();

        curtain.reveal({
          revealSelector: '.entity-editor-pane',
          tipHtml: helpHtml(context, 'intro.points.update_close', { button: icon('#rapid-icon-close', 'inline') })
        });
      });
    } finally {
      this._onModeChange = null;
    }
  }


  // "You can right-click on any feature to see the edit menu..."
  // Open the edit menu to advance
  protected async _rightClickPointAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const ui = context.systems.ui!;
    const EditMenu = ui.EditMenu;
    const curtain = this._curtain;

    if (!this._doesPointExist()) return this._reselectPointAsync;
    if (!['browse', 'select-osm'].includes(context.mode?.id ?? '')) context.enter('browse');

    let onToggled: ((open: boolean) => void) | undefined;
    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onStagingChange = reject;  // disallow doing anything else

        const textID = context.lastPointerType === 'mouse' ? 'rightclick' : 'edit_menu_touch';
        curtain.reveal({
          revealExtent: buildingExtent,
          tipHtml: helpHtml(context, `intro.points.${textID}`)
        });

        onToggled = (open: boolean) => {
          if (open) resolve(this._enterDeleteAsync);
        };
        EditMenu.on('toggled', onToggled);
      });
    } finally {
      this._onStagingChange = null;
      if (onToggled) EditMenu.off('toggled', onToggled);
    }
  }


  // "It's OK to delete features that don't exist in the real world..."
  // Delete the point to advance
  protected async _enterDeleteAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const curtain = this._curtain;

    const node = container.select('.edit-menu-item-delete').node();
    if (!node) return this._rightClickPointAsync;   // no Delete button, try again

    await delayAsync();  // after edit menu fully visible

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onModeChange = () => {
          if (this._doesPointExist()) reject();  // point still exists, try again
        };
        this._onStableChange = (difference: any) => {
          const deleted = difference.deleted();
          if (deleted.length === 1 && deleted[0].id === this._pointID) {
            resolve(this._undoAsync);
          }
        };

        if (!this._doesPointExist() || !this._isPointSelected()) { resolve(this._rightClickPointAsync); return; }

        curtain.reveal({
          revealSelector: '.edit-menu',
          revealPadding: 50,
          tipHtml: helpHtml(context, 'intro.points.delete')
        });
      });
    } finally {
      this._onModeChange = null;
      this._onStableChange = null;
    }
  }


  // "You can always undo any changes up until you save your edits to OpenStreetMap..."
  // Click undo to advance
  protected async _undoAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const curtain = this._curtain;

    try {
      return await new Promise<IntroStep>((resolve, reject) => {
        this._rejectStep = reject;
        this._onStableChange = () => resolve(this._playAsync);
        curtain.reveal({
          revealSelector: '.map-toolbar button.undo-button',
          tipHtml: helpHtml(context, 'intro.points.undo')
        });
      });
    } finally {
      this._onStableChange = null;
    }
  }


  // Free play
  // Click on Areas (or another) chapter to advance
  protected async _playAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.ideditor',
      tipSelector: '.intro-nav-wrap .chapter-area',
      tipHtml: helpHtml(context, 'intro.points.play', { next: l10n.t('intro.areas.title') }),
      buttonText: l10n.t('intro.ok'),
      buttonCallback: () => curtain.reveal({ revealSelector: '.ideditor' })  // re-reveal but without the tooltip
    });
    // chapter is done
  }
}
