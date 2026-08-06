import { selection } from 'd3-selection';
import { UiEntityEditor } from './UiEntityEditor.ts';
import { UiPresetList } from './UiPresetList.ts';
import { UiViewOn } from './UiViewOn.ts';

import type { Category } from '../lib/Category.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Preset } from '../lib/Preset.ts';


/**
 * The Inspector is a UI component for viewing/editing OSM Entities in the sidebar.
 * It consists of two divs that can slide side to side (only one will be visible at a time).
 * (The order may be swapped depending on `l10n.isRTL`)
 *
 * +--------+--------+
 * |        |        |
 * | Preset | Entity |
 * |  List  | Editor |
 * |        |        |
 * |        |        |
 * +--------+--------+
 *
 * @example
 *  <div class='inspector-wrap'>
 *    <div class='panewrap'>
 *      <div class='preset-list-pane'/>      // Preset List
 *      <div class='entity-editor-pane'/>    // Entity Editor
 *    </div>
 *    <div class='sidebar-footer'/>          // Footer, usually contains "View on OSM" link
 *  </div>
 */
export class UiInspector {
  public context: Context;

  // Child components
  public PresetList: UiPresetList;
  public EntityEditor: UiEntityEditor;
  public ViewOn: UiViewOn;

  // D3 selections
  public $parent: D3Selection | null;
  public $inspector: D3Selection | null;
  public $paneWrap: D3Selection | null;
  public $presetPane: D3Selection | null;
  public $editorPane: D3Selection | null;

  protected _state: string;
  protected _entityIDs: EntityID[];
  protected _newFeature: boolean;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;    // Create child components
    this.PresetList = new UiPresetList(context);
    this.EntityEditor = new UiEntityEditor(context);
    this.ViewOn = new UiViewOn(context);

    // D3 selections
    this.$parent = null;
    this.$inspector = null;
    this.$paneWrap = null;
    this.$presetPane = null;
    this.$editorPane = null;

    this._state = '';       // can be 'hide', 'hover', or 'select'
    this._entityIDs = [];
    this._newFeature = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.setPreset = this.setPreset.bind(this);
    this.showPresetList = this.showPresetList.bind(this);
    this.showEntityEditor = this.showEntityEditor.bind(this);
    this._onMerge = this._onMerge.bind(this);

    // Setup event handlers
    context.systems.editor!
      .on('merge', this._onMerge);

    this.PresetList
      .on('choose', (choice: Preset | Category) => { this.setPreset(choice); })
      .on('cancel', () => { this.setPreset(); });

    this.EntityEditor
      .on('choose', (selected: (Preset | undefined)[]) => { this.showPresetList(selected, true); });  // true = animate in
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders.)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const osm = context.services.osm;
    const validator = context.systems.validator!;

    const state = this._state;
    const entityIDs = this._entityIDs;
    const newFeature = this._newFeature;

    // propagate state to children
    this.PresetList
      .entityIDs(entityIDs)
      .autofocus(newFeature);

    this.EntityEditor
      .state(state)
      .entityIDs(entityIDs);


    // add .inspector-wrap
    let $inspector: D3Selection = this.$parent.selectAll('.inspector-wrap')
      .data([0]);

    const $$inspector = $inspector.enter()
      .append('div')
      .attr('class', 'inspector-wrap inspector-hidden');   // UiSidebar will manage its visibility

    this.$inspector = $inspector = $inspector.merge($$inspector);


    // add .panewrap
    let $paneWrap: D3Selection = $inspector.selectAll('.panewrap')
      .data([0]);

    const $$paneWrap = $paneWrap.enter()
      .append('div')
      .attr('class', 'panewrap');

    $$paneWrap
      .append('div')
      .attr('class', 'preset-list-pane pane');

    $$paneWrap
      .append('div')
      .attr('class', 'entity-editor-pane pane');

    this.$paneWrap = $paneWrap = $paneWrap.merge($$paneWrap);
    this.$presetPane = $paneWrap.selectAll('.preset-list-pane');
    this.$editorPane = $paneWrap.selectAll('.entity-editor-pane');

    if (_shouldDefaultToPresetList()) {
      this.showPresetList();
    } else {
      this.showEntityEditor();
    }

    // add .sidebar-footer
    const entityID = entityIDs.length === 1 ? graph.hasEntity(entityIDs[0]) : undefined;
    this.ViewOn.stringID = 'inspector.view_on_osm';
    this.ViewOn.url = (osm && entityID) ? osm.entityURL(entityID) : '';

    const $footer = $inspector.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer as any)
      .call(this.ViewOn.render);


    // Internal function for deciding which pane to show
    function _shouldDefaultToPresetList(): boolean {
      // always show the inspector on hover
      if (state !== 'select') return false;

      // can only change preset on single selection
      if (entityIDs.length !== 1) return false;

      const entityID = entityIDs[0];
      const entity = graph.hasEntity(entityID);
      if (!entity) return false;

      // default to inspector if there are already tags
      if (entity.hasNonGeometryTags()) return false;

      // prompt to select preset if feature is new and untagged
      if (newFeature) return true;

      // all existing features except vertices should default to inspector
      if (entity.geometry(graph) !== 'vertex') return false;

      // show vertex relations if any
      if (graph.parentRelations(entity).length) return false;

      // show vertex issues if there are any
      if (validator.getEntityIssues(entityID).length) return false;

      // show turn retriction editor for junction vertices
      if ((entity as any).isHighwayIntersection(graph)) return false;

      // otherwise show preset list for uninteresting vertices
      return true;
    }
  }

  /**
   * Show the preset list, optionally with given selected array, and optionally with a slide-in animation
   * @param  selected? - optional Array of presets selected
   * @param  animate? - whether to animate the pane
   */
  public showPresetList(selected?: (Preset | undefined)[], animate?: boolean): void | false {
    const $paneWrap = this.$paneWrap;
    const $presetPane = this.$presetPane;
    const $editorPane = this.$editorPane;
    if (!$paneWrap || !$presetPane || !$editorPane) return false;  // called too early?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const isRTL = l10n.isRTL;
    const prop = isRTL ? 'margin-right' : 'margin-left';

    if (animate) {
      $paneWrap.transition().style(prop, '0%');
    } else {
      $paneWrap.style(prop, '0%');
    }

    // Update the state of the PresetList before showing it.
    this.PresetList
      .entityIDs(this._entityIDs)
      .selected(selected || [])
      .autofocus(this._newFeature || !!animate);

    $presetPane
      .call(this.PresetList.render);
  }


  /**
   * Show the entity editor, optionally with the given presets, optionally with slide-in animation
   * @param  presets? - optional Array of presets selected
   * @param  animate? - whether to animate the pane
   */
  public showEntityEditor(presets?: (Preset | undefined)[], animate?: boolean): void | false {
    const $paneWrap = this.$paneWrap;
    const $presetPane = this.$presetPane;
    const $editorPane = this.$editorPane;
    if (!$paneWrap || !$presetPane || !$editorPane) return false;  // called too early?

    const context = this.context;
    const l10n = context.systems.l10n!;
    const isRTL = l10n.isRTL;
    const prop = isRTL ? 'margin-right' : 'margin-left';

    if (animate) {
      $paneWrap.transition().style(prop, '-100%');
    } else {
      $paneWrap.style(prop, '-100%');
    }

    // Update the state of the EntityEditor before showing it.
    if (Array.isArray(presets)) {
      this.EntityEditor.presets(presets);
    }
    this.EntityEditor
      .state(this._state)
      .entityIDs(this._entityIDs);

    $editorPane
      .call(this.EntityEditor.render);
  }


  /**
   * Choose the given preset
   * @param preset - the Preset to choose
   */
  public setPreset(preset?: Preset | Category): void | false {
    const $presetPane = this.$presetPane;
    if (!$presetPane) return false;  // called too early?

    // upon choosing multipolygon, re-render the area preset list instead of the editor
    if (preset?.id === 'type/multipolygon') {
      this.showPresetList();
    } else {
      const choice = preset ? [preset] : null;
      const input = $presetPane.select('.preset-search-input').node() as HTMLInputElement;
      input.value = '';
      this.showEntityEditor((choice ?? undefined) as any, true);  // true = animate
    }
  }


  /**
   * If the inspector is showing `_entityIDs` already,
   * and we get new versions of them loaded from the server
   * refresh this component and its children. Rapid#1311
   * @param newIDs - Set of EntityIDs that were just merged in
   */
  protected _onMerge(newIDs: EntityID[]): void {
    if (!(newIDs instanceof Set)) return;
    if (!this._entityIDs.length) return;

    let needsRedraw = false;
    for (const entityID of this._entityIDs) {
      if (newIDs.has(entityID)) {
        needsRedraw = true;
        break;
      }
    }

    if (needsRedraw) {
      this.render();
    }
  }


  // old style getter/setters

  /**
   * Get or set the inspector state ('hide', 'hover', or 'select').
   * @param  val? - the state to set; if omitted, returns the current state
   */
  public state(val?: string): any {
    if (val === undefined) return this._state;
    this._state = val;
    this.EntityEditor.state(this._state);

    // remove any old field help overlay that might have gotten attached to the inspector
    this.context.container().selectAll('.field-help-body').remove();

    return this;
  }


  /**
   * Get or set the entities being inspected.
   * @param  val? - array of EntityIDs to set; if omitted, returns the current ids
   */
  public entityIDs(val?: EntityID[]): any {
    if (val === undefined) return this._entityIDs;
    this._entityIDs = val ?? [];
    return this;
  }


  /**
   * Get or set whether the inspected entity is a newly created feature.
   * @param  val? - the flag to set; if omitted, returns the current value
   */
  public newFeature(val?: boolean): any {
    if (val === undefined) return this._newFeature;
    this._newFeature = val;
    return this;
  }

}
