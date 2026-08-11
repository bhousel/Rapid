import { selection } from 'd3-selection';
import { interpolateNumber } from 'd3-interpolate';
import { Extent, vecLength } from '@rapid-sdk/math';

import { GeoJSONData, MarkerData, OsmEntity, OsmNode } from '../data/index.ts';
import { UiDataEditor } from './UiDataEditor.ts';
import { UiFeatureList } from './UiFeatureList.ts';
import { UiInspector } from './UiInspector.ts';
import { UiDetectionInspector } from './UiDetectionInspector.ts';
import { UiKeepRightEditor } from './UiKeepRightEditor.ts';
import { UiMapRouletteEditor } from './UiMapRouletteEditor.ts';
import { UiMapRouletteMenu } from './UiMapRouletteMenu.ts';
import { UiOsmoseEditor } from './UiOsmoseEditor.ts';
import { UiNoteEditor } from './UiNoteEditor.ts';
import { UiRapidInspector } from './UiRapidInspector.ts';
import { UiOvertureInspector } from './UiOvertureInspector.ts';
import { UiTooltip } from './UiTooltip.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';


const NEAR_TOLERANCE = 4;
const MIN_WIDTH = 240;
const DEFAULT_WIDTH = 400;  // needs to match the flex-basis in our css file


/**
 * The Sidebar is positioned to the side of the map and can show various information.
 * It can appear either on the left or right side of the map (depending on `l10n.isRTL`)
 * While editing and interacting with the map, the sidebar will control which child
 * component is visible.
 *
 * @example
 *  <div class='sidebar'>
 *    <div class='feature-list-wrap'/>   // Feature list / search component
 *    <div class='inspector-wrap'/>      // Inspector - the components for working with OSM
 *    <div class='sidebar-component'/>   // Custom UI - everything else (Notes, Rapid, QA items, Save, etc)
 *  </div>
 *  <div class='resizer'/>
 */
export class UiSidebar {
  public context: Context;

  // Child components
  public DataEditor: UiDataEditor;
  public DetectionInspector: UiDetectionInspector;
  public FeatureList: UiFeatureList;
  public Inspector: UiInspector;
  public KeepRightEditor: UiKeepRightEditor;
  public MapRouletteEditor: UiMapRouletteEditor;
  public MapRouletteMenu: UiMapRouletteMenu;
  public NoteEditor: UiNoteEditor;
  public OsmoseEditor: UiOsmoseEditor;
  public RapidInspector: UiRapidInspector;
  public OvertureInspector: UiOvertureInspector;
  public Tooltip: UiTooltip;

  // D3 selections
  public $parent: D3Selection | null;
  public $sidebar: D3Selection | null;
  public $resizer: D3Selection | null;
  public $custom: D3Selection | null;
  public $featureList: D3Selection | null;
  public $inspector: D3Selection | null;

  public hover: (target: unknown) => void;

  protected _keys: string | string[] | null;
  protected _currTargetID: DataID | null;
  protected _startPointerID: number | string | null;
  protected _startCoord: Vec2 | null;
  protected _startWidth: number | null;
  protected _lastCoord: Vec2 | null;
  protected _lastWidth: number | null;
  protected _expandWidth: number;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._keys = null;

    // Create child components
    this.DataEditor = new UiDataEditor(context);
    this.DetectionInspector = new UiDetectionInspector(context);
    this.FeatureList = new UiFeatureList(context);
    this.Inspector = new UiInspector(context);
    this.KeepRightEditor = new UiKeepRightEditor(context);
    this.MapRouletteEditor = new UiMapRouletteEditor(context);
    this.MapRouletteMenu = new UiMapRouletteMenu(context);
    this.NoteEditor = new UiNoteEditor(context);
    this.OsmoseEditor = new UiOsmoseEditor(context);
    this.RapidInspector = new UiRapidInspector(context);
    this.OvertureInspector = new UiOvertureInspector(context);
    this.Tooltip = new UiTooltip(context);

    // D3 selections
    this.$parent = null;
    this.$sidebar = null;
    this.$resizer = null;
    this.$custom = null;
    this.$featureList = null;
    this.$inspector = null;

    this._currTargetID = null;
    this._startPointerID = null;
    this._startCoord = null;
    this._startWidth = null;
    this._lastCoord = null;
    this._lastWidth = null;
    this._expandWidth = DEFAULT_WIDTH;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.toggle = this.toggle.bind(this);
    this._hover = this._hover.bind(this);
    this._hoverchange = this._hoverchange.bind(this);
    this._pointerup = this._pointerup.bind(this);
    this._pointermove = this._pointermove.bind(this);
    this._pointerdown = this._pointerdown.bind(this);
    this._eventCancel = this._eventCancel.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    const scheduler = context.systems.scheduler;  // optional

    /**
     * Hovers over the given targets
     * This just wraps the internal `_hover` in a throttle to keep it from being called too frequently.
     * @param  target - data element to target
     */
    this.hover = (target: unknown) => {
      // scheduler throttles the hover; without it, hover immediately
      if (scheduler) {
        scheduler.throttle('UiSidebar-hover', () => this._hover(target), { ms: 200 });
      } else {
        this._hover(target);
      }
    };

    // Setup event handlers
    context.behaviors.hover!.on('hoverchange', this._hoverchange);

    const l10n = context.systems.l10n!;
    l10n.on('localechange', this._setupKeybinding);
    this._setupKeybinding();
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    const dir = l10n.textDirection;
    const preferCollapsed = (settings?.get('ui.inspector.collapsed') === 'true');
    const storedWidth = +(settings?.get('ui.inspector.width') || DEFAULT_WIDTH);
    this._expandWidth = Math.max(MIN_WIDTH, storedWidth);

    // add .sidebar
    let $sidebar: D3Selection = $parent.selectAll('.sidebar')
      .data([dir]);

    $sidebar.exit()
      .remove();

    const $$sidebar = $sidebar.enter()
      .append('div')
      .attr('class', 'sidebar')
      .classed('collapsed', preferCollapsed)
      .style('flex-basis', `${this._expandWidth}px`);

    this.$sidebar = $sidebar = $sidebar.merge($$sidebar);


    // add .resizer
    let $resizer: D3Selection = $parent.selectAll('.resizer')
      .data([0]);

    const $$resizer = $resizer.enter()
      .append('div')
      .attr('class', 'resizer')
      .each((d, i, nodes) => {
        (nodes[i] as HTMLElement).addEventListener('pointerdown', this._pointerdown);
      });

    $$resizer
      .append('div')
      .attr('class', 'resizer-handle');

    this.$resizer = $resizer = $resizer.merge($$resizer)
      .call(this.Tooltip
        .placement(dir === 'rtl' ? 'right' : 'left')  // place on the sidebar side (i.e. don't cover the map)
        .title(l10n.t('inspector.tooltip'))
        .shortcut(l10n.t('shortcuts.command.toggle_inspector.key'))
        .attach
      );

    $sidebar
      .call(this.FeatureList.render);

    $sidebar
      .call(this.Inspector.render);

    this.$featureList = $sidebar.select('.feature-list-wrap');
    this.$inspector = $sidebar.select('.inspector-wrap');
  }


  /**
   * Respond to any change in hover
   * @param eventData - data about what is being hovered
   */
  protected _hoverchange(eventData: any): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const gfx = context.systems.gfx!;
    const scene = gfx.scene!;

    const modeID = context.mode?.id;
    const target = eventData.target;
    const layer = target?.layer;
    let dataID = target?.dataID;
    let data = target?.data;

    // Note: This code probably doesn't really belong here.  The Sidebar shouldn't "own" this problem.
    // When hovering on a line, its vertexes will appear.
    // The user may then hover on these vertexes, but when that happens,
    // we don't want to "steal" the hover from the line.
    if (modeID === 'browse') {
      if (data instanceof OsmNode) {
        const parents = graph.parentWays(data);
        if (parents.length === 1) {    // hovering over a vertex with one parent
          data = parents[0];           // target the parent instead
          dataID = data.id;
        }
      }
    }

    if (this._currTargetID === dataID) return;    // no change
    this._currTargetID = dataID;

    // Update the sidebar..
    if (modeID !== 'select' && modeID !== 'select-osm') {
      this.hover(data);
    }

    // Update 'hover' class, controlling which map elements appear highlighted..
    scene.clearClass('hover');
    if (layer && dataID) {
      // Only set hover class if this target isn't currently drawing
      const drawingIDs = layer.getDataWithClass('drawing');
      if (!drawingIDs.has(dataID)) {
        layer.setClass('hover', dataID);
      }
    }

    gfx.immediateRedraw();
  }


  /**
   * Hovers the given target data
   * @param  target - data element to target
   */
  protected _hover(target: unknown): void {
    const $sidebar = this.$sidebar;
    const $inspector = this.$inspector;
    const $featureList = this.$featureList;
    if (!$sidebar || !$inspector || !$featureList) return;  // called too early?

    // Exception: don't replace the "save-success" screen on hover.
    // Wait for the user to dismiss it or select something else. Rapid#700
    if (this.$custom && this.$custom.selectAll('.save-success').size()) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    let datum: any = target;
    const serviceID = (datum?.props?.serviceID || '') as ServiceID;

    // Start by clearing out any custom state.
    this.reset();

    // Hovering on MapWithAI/Esri data..
    if (serviceID === 'mapwithai' || serviceID === 'esri') {
      this.RapidInspector.datum = datum as OsmEntity;
      this.show(this.RapidInspector.render);

    // Hovering on Overture data..
    } else if (serviceID === 'overture') {
      this.OvertureInspector.datum = datum as GeoJSONData;
      this.show(this.OvertureInspector.render);

    // Hovering on Mapillary detection..
    } else if (datum instanceof MarkerData && datum?.type === 'detection') {
      this.DetectionInspector.datum = datum;
      this.show(this.DetectionInspector.render);

    // Hovering on an OSM Note...
    } else if (datum instanceof MarkerData && datum.serviceID === 'osm') {
      if (context.mode?.id === 'drag-note') return;
      const service = context.services.osm;
      if (service) {
        datum = service.getNote(datum.id);   // marker may contain stale data - get latest
      }
      this.NoteEditor.datum = datum;
      this.show(this.NoteEditor.render);

    // Hovering on a KeepRight Marker...
    } else if (datum instanceof MarkerData && datum.serviceID === 'keepright') {
      const service = context.services.keepright;
      if (service) {
        datum = service.getError(datum.id);  // marker may contain stale data - get latest
      }
      this.KeepRightEditor.datum = datum;
      this.show(this.KeepRightEditor.render);

    // Hovering on an Osmose Marker...
    } else if (datum instanceof MarkerData && datum.serviceID === 'osmose') {
      const service = context.services.osmose;
      if (service) {
        datum = service.getError(datum.id);  // marker may contain stale data - get latest
      }
      this.OsmoseEditor.datum = datum;
      this.show(this.OsmoseEditor.render);

    // Hovering on a MapRoulette Marker...
    } else if (datum instanceof MarkerData && datum.serviceID === 'maproulette') {
      const service = context.services.maproulette;
      if (service) {
        datum = service.getTask(datum.id);  // marker may contain stale data - get latest
      }
      this.MapRouletteMenu.datum = datum;
      this.MapRouletteEditor.datum = datum;
      this.show(this.MapRouletteEditor.render);

    // Hovering on other unspecified Geo Data (vector tile, geojson, etc..)
    } else if (datum instanceof GeoJSONData) {
      this.DataEditor.datum = datum;
      this.show(this.DataEditor.render);
    }


    // ^ That covers all the custom content we can hover over.
    // If any of the above matched, `this.show()` would have taken care
    // of the sidebar, we just need to add the hover class..
    if (this.$custom) {
      this.$custom.classed('inspector-hover', true);

    // Hovering on an OSM item
    } else if ((datum instanceof OsmEntity) && graph.hasEntity(datum.id)) {
      $featureList.classed('inspector-hidden', true);

      $inspector
        .classed('inspector-hidden', false)
        .classed('inspector-hover', true);

      this.Inspector
        .state('hover')
        .entityIDs([datum.id])
        .newFeature(false);

      $sidebar
        .call(this.Inspector.render);

    } else {
      this.hide();
    }
  }


  /**
   * Test if the sidebar is covering up the given extent
   * @param  wgs84Extent - an Extent in lon/lat coordinates
   * @return `true` if the sidebar is intersecting the `Extent`, `false` if not
   */
  public intersects(wgs84Extent: Extent): boolean {
    const $sidebar = this.$sidebar;
    if (!$sidebar) return false;  // called too early?

    const context = this.context;
    const rect = ($sidebar.node() as HTMLElement).getBoundingClientRect();

    return wgs84Extent.intersects(new Extent(
      context.viewport.unproject([0, rect.height]),
      context.viewport.unproject([rect.width, 0])
    ));
  }


  /**
   * Selects the given ids - they are expected to be OSM IDs already loaded (in the Graph)
   * @param  ids - ids to select (expected to be OSM IDs)
   * @param  newFeature - true if it's a new feature, passed to the inspector
   */
  public showInspector(ids: EntityID[], newFeature = false): void {
    const $sidebar = this.$sidebar;
    const $inspector = this.$inspector;
    const $featureList = this.$featureList;
    if (!$sidebar || !$inspector || !$featureList) return;  // called too early?

    if (Array.isArray(ids) && ids.length) {
      $featureList.classed('inspector-hidden', true);

      this.reset();

      $inspector
        .classed('inspector-hidden', false)
        .classed('inspector-hover', false);

      // Don't expand automatically, let the user control this - Rapid#1562
      // this.expand(true);

      // Always redraw the Inspector even if the ids are the same,
      // as the entities themselves may have changed.
      this.Inspector
        .state('select')
        .entityIDs(ids)
        .newFeature(newFeature);

      $sidebar
        .call(this.Inspector.render);

    } else {
      this.hide();
    }
  }


  /**
   * Shows some "custom" content in the sidebar
   * This is how almost all content renders to the sidebar
   * (except for the OSM editing "inspector", which is special)
   * @param  renderFn - A function suitable for use in `d3-selection.call`
   */
  public show(renderFn: ($selection: D3Selection) => void): void {
    const $sidebar = this.$sidebar;
    const $inspector = this.$inspector;
    const $featureList = this.$featureList;
    if (!$sidebar || !$inspector || !$featureList) return;  // called too early?

    if (renderFn) {
      if (this.$custom) {
        this.$custom.remove();
        this.$custom = null;
      }

      $featureList.classed('inspector-hidden', true);
      $inspector.classed('inspector-hidden', true);
      this.Inspector.entityIDs([]).state('hide');

      this.$custom = $sidebar
        .append('div')
        .attr('class', 'sidebar-component')
        .call(renderFn);

    } else {
      this.hide();
    }
  }


  /**
   * Removes all content from the sidebar..
   * This resets the sidebar back to where it shows the featureList / search component.
   */
  public hide(): void {
    const $inspector = this.$inspector;
    const $featureList = this.$featureList;
    if (!$inspector || !$featureList) return;  // called too early?

    this.reset();
    $featureList.classed('inspector-hidden', false);
    $inspector.classed('inspector-hidden', true);
    this.Inspector.entityIDs([]).state('hide');
  }


  /**
   * Shows inspector open to Preset List
   * @param  args - forwarded to `UiInspector.showPresetList` (optional selected presets, animate flag)
   */
  public showPresetList(...args: Parameters<UiInspector['showPresetList']>): void {
    this.Inspector.showPresetList(...args);
  }


  /**
   * Shows inspector open to Entity Editor
   * @param  args - forwarded to `UiInspector.showEntityEditor` (optional presets, animate flag)
   */
  public showEntityEditor(...args: Parameters<UiInspector['showEntityEditor']>): void {
    this.Inspector.showEntityEditor(...args);
  }


  /**
   * Expands the sidebar
   * @param  animate? - whether to animate the pane
   */
  public expand(animate?: boolean): void {
    const $sidebar = this.$sidebar;
    if (!$sidebar) return;  // called too early?

    if ($sidebar.classed('collapsed')) {
      this.toggle(animate);
    }
  }


  /**
   * Collapses the sidebar
   * @param  animate? - whether to animate the pane
   */
  public collapse(animate?: boolean): void {
    const $sidebar = this.$sidebar;
    if (!$sidebar) return;  // called too early?

    if (!$sidebar.classed('collapsed')) {
      this.toggle(animate);
    }
  }


  /**
   * Toggles the sidebar between expanded/collapsed states
   * @param  animate? - whether to animate the pane
   */
  public toggle(animate = true): void {
    const $sidebar = this.$sidebar;
    if (!$sidebar) return;  // called too early?

    const context = this.context;
    const ui = context.systems.ui;
    const $container = context.container();

    // We get the "preferred" expended width from `flex-basis`.
    // When the sidebar is shown, this is the width that flexbox will use.
    // When the sidebar is hidden (display: none), it is ignored.
    const expandWidth = this._expandWidth || DEFAULT_WIDTH;
    const startCollapsed = $sidebar.classed('collapsed');
    const startWidth = startCollapsed ? 0 : expandWidth;
    const endCollapsed = !startCollapsed;
    const endWidth = endCollapsed ? 0 : expandWidth;
    const lerp = interpolateNumber(startWidth, endWidth);

    this._startWidth = startWidth;
    this._lastWidth = startWidth;

    if (animate) {
      $sidebar
        .transition()
        .tween('inspector.toggler', () => {
          return (t: number) => {
            const setWidth = lerp(t);

            $sidebar
              .classed('collapsing', setWidth < MIN_WIDTH)
              .style('flex-basis', `${setWidth}px`);

            ui?.resize();
            this._lastWidth = setWidth;
          };
        })
        .on('start', () => {
          $container.classed('resizing', true);

          $sidebar
            .classed('collapsing', startWidth < MIN_WIDTH)
            .classed('collapsed', false)
            .style('flex-basis', `${startWidth}px`);
        })
        .on('end interrupt', () => {
          $container.classed('resizing', false);

          $sidebar
            .classed('collapsing', false)
            .classed('collapsed', endCollapsed)
            .style('flex-basis', `${expandWidth}px`);  // done resize, put expanded width back here

          ui?.resize();
          this._storePreferences();
        });

    } else {  // no animation
      $container.classed('resizing', false);

      $sidebar
        .classed('collapsing', false)
        .classed('collapsed', endCollapsed)
        .style('flex-basis', `${expandWidth}px`);  // done resize, put expanded width back here

      ui?.resize();
      this._storePreferences();
    }
  }


  /**
   * Clears out any custom data that might be stored in the sidebar or child components.
   */
  public reset(): void {
    if (this.$custom) {
      this.$custom.remove();
      this.$custom = null;
    }

    this.DataEditor.datum = null;
    this.DetectionInspector.datum = null;
    this.Inspector.entityIDs([]);
    this.KeepRightEditor.datum = null;
    this.MapRouletteEditor.datum = null;
    this.MapRouletteMenu.datum = null;
    this.NoteEditor.datum = null;
    this.OsmoseEditor.datum = null;
    this.RapidInspector.datum = null;
  }


  /**
   * Handler for pointerdown events on the resizer.
   * @param e - the pointerdown event
   */
  protected _pointerdown(e: PointerEvent): void {
    if (this._startPointerID) return;  // already resizing

    if ('button' in e && e.button !== 0) return;

    const $container = this.context.container();
    const $sidebar = this.$sidebar!;

    const expandWidth = this._expandWidth || DEFAULT_WIDTH;
    const startCollapsed = $sidebar.classed('collapsed');
    const startWidth = startCollapsed ? 0 : expandWidth;

    this._startPointerID = e.pointerId || 'mouse';
    this._startCoord = [e.clientX, e.clientY];
    this._startWidth = startWidth;
    this._lastCoord = [e.clientX, e.clientY];
    this._lastWidth = startWidth;

    this.Tooltip.hide();
    $container.classed('resizing', true);

    $sidebar
      .classed('collapsed', false)
      .classed('collapsing', startWidth < MIN_WIDTH)
      .style('flex-basis', `${startWidth}px`);

    window.addEventListener('pointermove', this._pointermove);
    window.addEventListener('pointerup', this._pointerup);
    window.addEventListener('pointercancel', this._pointerup);
    // cancel touchmove to disable page scrolling while resizing
    window.addEventListener('touchmove', this._eventCancel, { passive: false });
  }


  /**
   * Handler for pointermove events
   * @param e - the pointermove event
   */
  protected _pointermove(e: PointerEvent): void {
    if (this._startPointerID !== (e.pointerId || 'mouse')) return;   // not down, or different pointer

    e.preventDefault();

    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui;

    const scaleX = l10n.isRTL ? -1 : 1;
    const dx = (e.clientX - this._lastCoord![0]) * scaleX;
    const setWidth = this._lastWidth! + dx;

    if (dx) {
      this.$sidebar!
        .classed('collapsing', setWidth < MIN_WIDTH)
        .style('flex-basis', `${setWidth}px`);

      ui?.resize();
    }

    this._lastCoord = [e.clientX, e.clientY];
    this._lastWidth = setWidth;
  }


  /**
   * Handler for pointerup events
   * @param e - the pointerup event
   */
  protected _pointerup(e: PointerEvent): void {
    if (this._startPointerID !== (e.pointerId || 'mouse')) return;   // not down, or different pointer

    this._startPointerID = null;
    window.removeEventListener('pointermove', this._pointermove);
    window.removeEventListener('pointerup', this._pointerup);
    window.removeEventListener('pointercancel', this._pointerup);
    window.removeEventListener('touchmove', this._eventCancel, { passive: false } as any);

    const context = this.context;
    const ui = context.systems.ui;

    const $sidebar = this.$sidebar!;
    const $container = context.container();

    const endWidth = this._lastWidth!;
    const endCollapsed = endWidth < MIN_WIDTH;

    // We'll lock in the "preferred" expended width in `flex-basis`.
    // If the user collapsed the sidebar by dragging, assume that they
    // would want to expand it back to its original size.
    const expandWidth = endCollapsed ? this._expandWidth : endWidth;
    this._expandWidth = expandWidth;

    $container.classed('resizing', false);

    $sidebar
      .classed('collapsing', false)
      .classed('collapsed', endCollapsed)
      .style('flex-basis', `${expandWidth}px`);  // done resize, put expanded width back here

    const startCoord = this._startCoord;
    const endCoord: Vec2 = [e.clientX ?? (startCoord as Vec2)[0], e.clientY];
    const dist = vecLength(startCoord as Vec2, endCoord);
    if (dist < NEAR_TOLERANCE) {  // this was a click, not a drag
      this.toggle();              // run the toggle transition
    } else {
      ui?.resize();
      this._storePreferences();
    }
  }


  /**
   * Just cancels an event
   * @param  e? - triggering event (if any)
   */
  protected _eventCancel(e: Event): void {
    e?.preventDefault();
  }


  /**
   * Store the sidebar preferences
   */
  protected _storePreferences(): void {
    const $sidebar = this.$sidebar;
    if (!$sidebar) return;  // called too early?

    const preferCollapsed = $sidebar.classed('collapsed') ? 'true' : 'false';
    const preferWidth = this._expandWidth;

    const settings = this.context.systems.settings;
    settings?.set('ui.inspector.collapsed', preferCollapsed);
    settings?.set('ui.inspector.width', String(preferWidth));
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    // see iD#5663, iD#6864 - common QWERTY, AZERTY
    this._keys = [l10n.t('shortcuts.command.toggle_inspector.key'), '`', '²', '@'];
    context.keybinding().on(this._keys, this.toggle as any);
  }
}
