import * as Operations from '../operations/index.ts';
import { AbstractMode } from './AbstractMode.ts';
import { actionDeleteRelation } from '../actions/delete_relation.ts';
import { actionMove, actionRotate } from '../actions/index.ts';
import { DEG2RAD, Extent, vecAdd, vecRotate, vecScale } from '@rapid-sdk/math';
import { GeoJSONData, MarkerData, OsmEntity } from '../data/index.ts';
import { osmEntityID } from '../data/dataID.ts';
import { UiDataEditor } from '../ui/UiDataEditor.ts';
import { UiDetectionInspector } from '../ui/UiDetectionInspector.ts';
import { UiKeepRightEditor } from '../ui/UiKeepRightEditor.ts';
import { UiMapRouletteEditor } from '../ui/UiMapRouletteEditor.ts';
import { UiNoteEditor } from '../ui/UiNoteEditor.ts';
import { UiOsmoseEditor } from '../ui/UiOsmoseEditor.ts';
import { utilArrayIdentical } from '@rapid-sdk/util';
import { utilCmd } from '../util/index.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractOperation } from '../operations/AbstractOperation.ts';
import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { KeyBindingScope } from '../core/KeyboardSystem.ts';
import type { OsmNode, OsmRelation, OsmWay } from '../data/types.ts';
import type { Vec2 } from '@rapid-sdk/math';

const DEBUG = false;


/** Options for entering `SelectMode` */
export interface SelectModeOptions {
  /** Data IDs of the data to select (see `design/data-ids.md`) */
  selection?: DataID[];
  /** Whether this is a newly created feature */
  newFeature?: boolean;
  /** The focused parent way ID for vertex navigation */
  focusedParentID?: EntityID;
}


/**
 * In `SelectMode`, the user has selected one or more map features, from any source.
 * - `selectedIDs` holds the data IDs of what is selected, and `selectedData` looks them up.
 * - The sidebar shows something depending on what the selection contains: the OSM inspector for
 *   OSM entities, an editor or inspector for a single other datum, or a list for a mix.
 * - What's specific to OSM (the edit menu's operations, moving and rotating with the arrow keys,
 *   vertex navigation, selecting parents and children) works on the OSM entities in the selection.
 *   Operations are offered only when everything selected is OSM.
 * See `design/data-ids.md`.
 */
export class SelectMode extends AbstractMode {

  /** Keyboard scope for this mode's vertex-navigation shortcuts */
  protected _selectScope: KeyBindingScope | null;
  /** The total extent of selected features */
  public extent: Extent | null;

  /** Whether this is a newly created feature */
  protected _newFeature: boolean;
  /**
   * `_focusedParentID` is used when we visit a vertex with multiple
   * parents, and we want to remember which parent line we started on.
   */
  protected _focusedParentID: EntityID | null;
  /** The OSM entities in the selection */
  protected _osmIDs: EntityID[];
  /** If a single OSM entity is selected, keep track of it here */
  protected _singularDatum: OsmEntity | null;
  /** Previous selection, used by arrow key handler */
  protected _lastSelectedIDs: DataID[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'select';

    this._selectScope = null;
    this.extent = null;

    this._newFeature = false;
    this._focusedParentID = null;
    this._osmIDs = [];
    this._singularDatum = null;
    this._lastSelectedIDs = [];

    // Make sure the event handlers have `this` bound correctly
    this._keydown = this._keydown.bind(this);
    this._hover = this._hover.bind(this);
    this._merge = this._merge.bind(this);
    this._firstVertex = this._firstVertex.bind(this);
    this._focusNextParent = this._focusNextParent.bind(this);
    this._lastVertex = this._lastVertex.bind(this);
    this._nextVertex = this._nextVertex.bind(this);
    this._previousVertex = this._previousVertex.bind(this);
  }


  /**
   * Expects a `selection` property in the options argument, the data IDs to select.
   * Data that can't be found (`SpatialSystem.getData`) is left out, and so are OSM nodes where
   * editing is blocked.
   * @param  options - Optional options object
   * @return `true` if mode could be entered, `false` it not
   */
  public enter(options: SelectModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const gfx = context.systems.gfx!;
    const hover = context.behaviors.hover!;
    const keyboard = context.systems.keyboard!;
    const locations = context.systems.locations;
    const spatial = context.systems.spatial!;
    const ui = context.systems.ui;
    const urlhash = context.systems.urlhash!;
    const graph = editor.staging.graph;
    const scene = gfx.scene!;
    const eventManager = gfx.eventManager!;

    // Gather the data we can find.  An OSM entity's data ID is its entity ID.
    const selectedIDs = new Set<DataID>();
    const osmIDs: EntityID[] = [];
    for (const dataID of options.selection ?? []) {
      const datum = spatial.getData(dataID);
      if (!datum) continue;   // can't find it

      const entityID = osmEntityID(dataID);
      if (entityID) {
        if (selectedIDs.has(entityID)) continue;
        if (datum.type === 'node') {
          const loc = (datum as OsmNode).loc;
          if (loc && locations?.isBlockedAt(loc)) continue;  // editing is blocked
        }
        osmIDs.push(entityID);
        selectedIDs.add(entityID);
      } else {
        selectedIDs.add(dataID);
      }
    }

    if (!selectedIDs.size) return false;  // found nothing to select

    this._selectedIDs = [...selectedIDs];
    this._osmIDs = osmIDs;
    this._newFeature = options.newFeature ?? false;
    this._focusedParentID = options.focusedParentID ?? null;
    this._lastSelectedIDs = [];

    const isSingular = (this._selectedIDs.length === 1);
    this._singularDatum = (isSingular && osmIDs.length === 1) ? graph.hasEntity(osmIDs[0]) ?? null : null;

    if (DEBUG) {
      console.log(`SelectMode: entering, selected ${this._selectedIDs.join(',')}`);  // eslint-disable-line no-console
    }

    this._active = true;

    context.enableBehaviors(['hover', 'select', 'drag', 'mapInteraction', 'lasso', 'paste']);
    ui?.closeEditMenu();

    // Compute the total extent of selected items
    this.extent = new Extent();
    for (const d of this.selectedData.values()) {
      const other = d.extent();
      if (other instanceof Extent) {
        this.extent.extendSelf(other);
      }
    }

    // Handle 'select' style class.
    scene.clearClass('select');
    for (const dataID of this._selectedIDs) {
      scene.setClass('select', dataID);
    }

    urlhash.setParam('id', osmIDs.length ? osmIDs.join(',') : null);   // Put the OSM entityIDs into the url hash
    filters.forceVisible(osmIDs);                  // Exclude OSM entityIDs from being filtered
    this._setupOperations();                       // Determine available operations on the edit menu

    this._selectScope = keyboard.scope('select');
    this._selectScope
      .on(['[', 'pgup'], this._previousVertex)
      .on([']', 'pgdown'], this._nextVertex)
      .on(['{', utilCmd('⌘['), 'home'], this._firstVertex)
      .on(['}', utilCmd('⌘]'), 'end'], this._lastVertex)
      .on(['\\', 'pause'], this._focusNextParent)
      .enable();

    eventManager.on('keydown', this._keydown);
    editor.on('merge', this._merge);
    hover.on('hoverchange', this._hover);

    this._showSidebar();

    return true;
  }


  /**
   * Exits this mode, tearing down behaviors, listeners, and selection state.
   */
  public exit(): void {
    if (!this._active) return;
    this._active = false;

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const gfx = context.systems.gfx!;
    const hover = context.behaviors.hover!;
    const photos = context.systems.photos!;
    const ui = context.systems.ui;
    const urlhash = context.systems.urlhash!;
    const scene = gfx.scene!;
    const eventManager = gfx.eventManager!;

    if (DEBUG) {
      console.log('SelectMode: exiting');  // eslint-disable-line no-console
    }

    // If the user added an empty relation, we should clean it up.
    const graph = editor.staging.graph;
    const singularID = this._singularDatum?.id;
    const entity = singularID ? graph.hasEntity(singularID) : undefined;
    if (entity?.type === 'relation') {
      const relation = entity as OsmRelation;
      const members = relation.members;
      if (
        Object.keys(relation.tags).length === 0 &&        // no tags
        graph.parentRelations(relation).length === 0 &&   // no parent relations
        // no members or one member with no role
        (members.length === 0 || members.length === 1 && !members[0].role)
      ) {
        // The user added this relation but didn't edit it at all, so just delete it
        editor.perform(actionDeleteRelation(entity.id, true, true));  // true = don't delete untagged members
        editor.commit({
          stringID: 'operations.delete.annotation.relation',
          selection: [entity.id]
        });
      }
    }

    this.extent = null;
    this._newFeature = false;
    this._osmIDs = [];
    this._singularDatum = null;
    this._selectedIDs = [];
    this._lastSelectedIDs = [];

    // disable operations
    for (const operation of this.operations) {
      operation.behavior?.disable();
    }
    this.operations = [];

    scene.clearClass('select');
    ui?.closeEditMenu();
    ui?.Sidebar.hide();
    urlhash.setParam('id', null);
    filters.forceVisible([]);
    photos.selectDetection(null);

    if (this._selectScope) {
      this._selectScope.disable();
      this._selectScope = null;
    }

    editor.off('merge', this._merge);
    eventManager.off('keydown', this._keydown);
    hover.off('hoverchange', this._hover);
  }


  /**
   * Whether everything selected is an OSM entity.
   * @return `true` if the selection is all OSM entities
   */
  protected _isAllOsm(): boolean {
    return this._osmIDs.length > 0 && this._osmIDs.length === this._selectedIDs.length;
  }


  /**
   * Shows what's selected in the sidebar.
   * - All OSM entities: the OSM inspector (which lists them if there are several).
   * - A single other datum: the editor or inspector for its kind of data.
   * - Anything else: a list of what's selected.
   */
  protected _showSidebar(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const photos = context.systems.photos!;
    const ui = context.systems.ui;
    const Sidebar = ui?.Sidebar;

    if (!Sidebar) return;

    if (this._isAllOsm()) {
      Sidebar.showInspector(this._osmIDs, this._newFeature);
      return;
    }

    Sidebar.reset();

    if (this._selectedIDs.length > 1) {
      Sidebar.SelectionInspector.dataIDs = this.selectedIDs;
      Sidebar.show(Sidebar.SelectionInspector.render);
      return;
    }

    const datum = this.selectedData.get(this._selectedIDs[0]);
    if (!datum) return;

 // The update handlers feel like they should live with the sidebar content components, not here
    let sidebarContent: any = null;
    const datasetID = (datum.props?.datasetID ?? '') as DatasetID;
    const serviceID = (datum.props?.serviceID ?? '') as ServiceID;

    // Selected a note...
    if (datum instanceof MarkerData && serviceID === 'osm' && datum.type === 'note') {
      const noteEditor = new UiNoteEditor(context);
      noteEditor.datum = datum;
      noteEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const osm = context.services.osm;
        const d = osm?.getNote(datum.id);   // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode
        noteEditor.datum = d;
        Sidebar?.show(noteEditor.render);
      });
      sidebarContent = noteEditor.render;

    } else if (datum instanceof MarkerData && serviceID === 'keepright') {
      const keepRightEditor = new UiKeepRightEditor(context);
      keepRightEditor.datum = datum;
      keepRightEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const keepright = context.services.keepright;
        const d = keepright?.getError(datum.id);  // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode?
        keepRightEditor.datum = d;
        Sidebar?.show(keepRightEditor.render);
      });
      sidebarContent = keepRightEditor.render;

    } else if (datum instanceof MarkerData && serviceID === 'osmose') {
      const osmoseEditor = new UiOsmoseEditor(context);
      osmoseEditor.datum = datum;
      osmoseEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const osmose = context.services.osmose;
        const d = osmose?.getError(datum.id);     // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode?
        osmoseEditor.datum = d;
        Sidebar?.show(osmoseEditor.render);
      });
      sidebarContent = osmoseEditor.render;

    } else if (datum instanceof MarkerData && serviceID === 'maproulette') {
      const maprouletteEditor = new UiMapRouletteEditor(context);
      maprouletteEditor.datum = datum;
      const menu = ui?.MapRouletteMenu;
      if (menu) menu.datum = datum;
      maprouletteEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const maproulette = context.services.maproulette;
        const d = maproulette?.getTask(datum.id);  // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;   // or - go to browse mode?
        maprouletteEditor.datum = d;
        Sidebar?.show(maprouletteEditor.render);
      });
      sidebarContent = maprouletteEditor.render;

    } else if (datum instanceof MarkerData && datum.type === 'detection') {
      const detectionInspector = new UiDetectionInspector(context);
      detectionInspector.datum = datum;
      sidebarContent = detectionInspector.render;
      const serviceID = datum.serviceID;
      const type = (datum.props.object_type === 'traffic_sign') ? 'signs' : 'detections';
      const layerID = `${serviceID}-${type}`;    // e.g. 'mapillary-signs' or 'mapillary-detections'
      photos.selectDetection(layerID, datum.id);

    // Selected Overture feature...
    } else if (datasetID && serviceID === 'overture') {
      Sidebar.OvertureInspector.datum = datum as GeoJSONData;
      sidebarContent = Sidebar.OvertureInspector.render;

    // Selected Rapid feature...
    } else if (datasetID && serviceID !== 'overture') {
      Sidebar.RapidInspector.datum = datum as OsmEntity | GeoJSONData;
      sidebarContent = Sidebar.RapidInspector.render;

    // Selected other unspecified Geo Data (vector tile, geojson, etc..)
    } else if (datum instanceof GeoJSONData) {
      const dataEditor = new UiDataEditor(context);
      dataEditor.datum = datum;
      sidebarContent = dataEditor.render;
    }

    // setup the sidebar
    if (sidebarContent) {
      Sidebar.show(sidebarContent); //.newNote(_newFeature));
      // Attempt to expand the sidebar, avoid obscuring the selected thing if we can..
      // For this to work the datum must have an extent already
      // Sidebar.expand(Sidebar.intersects(datum.extent()));
    }
  }


  /**
   * Handler for keydown events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  protected _keydown(e: KeyboardEvent): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const ui = context.systems.ui;
    const viewport = context.viewport;
    const graph = editor.staging.graph;

    // Only match these keys if the user doesn't have something
    // more important focused - like a input, textarea, menu, etc.
    const activeElement = document.activeElement?.tagName ?? 'BODY';
    if (activeElement !== 'BODY') return;
    // Also exit if we have something selected at very low zoom
    if (!context.editable()) return;

    // select parent
    if ((e.altKey || e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
      e.preventDefault();
      this._selectParentWays();
      return;

    // select children
    } else if ((e.altKey || e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectChildNodes();
      return;
    }

    // Moving and rotating are operations, which work only on OSM entities.
    if (!this._isAllOsm()) return;

    // Does the user have the same selection and is doing same action as before?
    // If so, use `commitAppend` to avoid creating a new undo state.
    const selectedIDs = this._osmIDs.slice();
    const isSameSelection = utilArrayIdentical(selectedIDs, this._lastSelectedIDs);
    if (!isSameSelection) {
      this._lastSelectedIDs = selectedIDs.slice();  // take copy
    }

    let operation: AbstractOperation | undefined;
    let action: Action | undefined;

    // rotate
    if (e.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();

      const ROT_AMOUNT = 2 * DEG2RAD;   // ± 2°
      let delta: number | undefined;
      if (e.key === 'ArrowLeft') {
        delta = -ROT_AMOUNT;
      } else if (e.key === 'ArrowRight') {
        delta = ROT_AMOUNT;
      }

      if (delta) {
        // Average the centroids of the selected features.
        let sum: Vec2 = [0, 0];
        let count = 0;
        for (const entityID of selectedIDs) {
          const entity = graph.hasEntity(entityID);
          if (!entity) continue;

          for (const part of entity.geoms.parts) {
            const centroid = part.world?.centroid;
            if (!centroid) continue;
            sum = vecAdd(sum, centroid);
            count++;
          }
        }

        if (!count) return;

        const pivot = vecScale(sum, 1 / count);

        operation = new Operations.RotateOperation(context, selectedIDs);
        action = actionRotate(selectedIDs, pivot, delta);
      }

    // move
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();

      const MOVE_AMOUNT = 3;   // in pixels
      let delta: Vec2 | undefined;
      if (e.key === 'ArrowLeft') {
        delta = [-MOVE_AMOUNT, 0];
      } else if (e.key === 'ArrowRight') {
        delta = [MOVE_AMOUNT, 0];
      } else if (e.key === 'ArrowUp') {
        delta = [0, -MOVE_AMOUNT];
      } else if (e.key === 'ArrowDown') {
        delta = [0, MOVE_AMOUNT];
      }

      if (delta) {
        const t = viewport.transform;
        if (t.r) {
          delta = vecRotate(delta, -t.r, [0, 0]);   // remove any rotation
        }
        // Pixel delta -> world delta.  The scale factor is `2^z`.
        const k = Math.pow(2, t.z);
        const worldDelta = vecScale(delta, 1 / k);
        operation = new Operations.MoveOperation(context, selectedIDs);
        action = actionMove(selectedIDs, worldDelta);
      }
    }

    // Is this shape transform allowed?
    if (operation && action) {
      if (!operation.available()) return;

      if (operation.disabled()) {
        ui?.Flash.show({
          duration: 4000,
          iconName: `#rapid-operation-${operation.id}`,
          iconClass: 'operation disabled',
          label: operation.tooltip()
        });

        return;
      }

      // do it
      const label = operation.editLabel();
      const props = { ...label, selection: selectedIDs };

      editor.perform(action);
      if (isSameSelection && editor.getUndoEdit()?.isLabeled(label)) {
        editor.commitAppend(props);
      } else {
        editor.commit(props);
      }

      // Recheck the available operations on menu here.
      // For example, if a user moved the shape off the screen
      // then some of the operations should disable themselves.
      this._setupOperations();
    }
  }


  /**
   * If we have entities selected already, and we find new versions
   * of them loaded from the server, the `operations` offered on
   * the edit menu may be wrong and should be refreshed. Rapid#1311
   * @param  newIDs - entityIDs recently loaded from OSM
   */
  protected _merge(newIDs: Set<EntityID>): void {
    if (!(newIDs instanceof Set)) return;

    let needsRefresh = false;
    for (const entityID of this._osmIDs) {
      if (newIDs.has(entityID)) {
        needsRefresh = true;
        break;
      }
    }

    if (needsRefresh) {
      this._setupOperations();
    }
  }


  /**
   * Called whenever we have a need to reset the `operations` array.
   * Operations work on OSM entities, so they're offered only when everything selected is OSM.
   */
  protected _setupOperations(): void {
    const context = this.context;
    const ui = context.systems.ui;

    // disable any that were available before
    for (const operation of this.operations) {
      operation.behavior?.disable();
    }
    this.operations = [];

    if (this._isAllOsm()) {
      const entityIDs = this._osmIDs.slice();
      const order: Record<OperationID, number> = {  // sort these to the end of the list
        copy: 1,
        downgrade: 2,
        delete: 3
      };

      this.operations = [...Operations.operations.available.values()]
        .map(Op => new Op(context, entityIDs))
        .filter(op => op.available())
        .sort((a, b) => {
          const aOrder = order[a.id] || 0;
          const bOrder = order[b.id] || 0;
          return aOrder - bOrder;
        });

      // enable all available
      for (const operation of this.operations) {
        operation.behavior?.enable();
      }
    }

    // Redraw the menu if it is already shown
    ui?.redrawEditMenu();
  }


  /**
   *  When using keyboard navigation, try to stay with the previously focused parent way
   *  @param  entity - The entity we are checking for parent ways
   *  @return  The chosen parent way, or `undefined` if there is none
   */
  protected _chooseParentWay(entity: OsmEntity | null): OsmWay | undefined {
    if (!entity) return undefined;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;

    if (entity.type === 'way') {     // selected entity already is a way, so just use it.
      this._focusedParentID = entity.id;

    } else {
      const parentIDs = graph.parentWays(entity).map(way => way.id);
      if (!parentIDs.length) {
        this._focusedParentID = null;   // no parents

      } else {
        // We'll try to stick with the already focused parent (e.g. when keyboard navigating along a way).
        // If we can't do that, just pick the first parent to be the new focused parent.
        if (!this._focusedParentID || !parentIDs.includes(this._focusedParentID)) {
          this._focusedParentID = parentIDs[0];
        }
      }
    }

    return this._focusedParentID ? graph.hasEntity(this._focusedParentID) as OsmWay | undefined : undefined;
  }


  /**
   *  jump to the first vertex along a way
   * @param e
   */
  protected _firstVertex(e: Event): void {
    e.preventDefault();

    const way = this._chooseParentWay(this._singularDatum);
    if (!way) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const graph = editor.staging.graph;

    const nodeID = way.first();
    if (!nodeID) return;
    const node = graph.hasEntity(nodeID) as OsmNode;
    if (!node) return;

    context.enter('select', { selection: [nodeID] });
    map.centerEase(node.loc!);
  }


  /**
   *  jump to the first vertex along a way
   * @param e
   */
  protected _lastVertex(e: Event): void {
    e.preventDefault();

    const way = this._chooseParentWay(this._singularDatum);
    if (!way) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const graph = editor.staging.graph;

    const nodeID = way.last();
    if (!nodeID) return;
    const node = graph.hasEntity(nodeID) as OsmNode;
    if (!node) return;

    context.enter('select', { selection: [nodeID] });
    map.centerEase(node.loc!);
  }


  /**
   *  jump to the previous vertex
   * @param e
   */
  protected _previousVertex(e: Event): void {
    e.preventDefault();

    const entity = this._singularDatum;
    if (entity?.type !== 'node') return;

    const way = this._chooseParentWay(this._singularDatum);
    if (!way) return;

    const currIndex = way.nodes.indexOf(entity.id);
    let nextIndex = -1;

    if (currIndex > 0) {
      nextIndex = currIndex - 1;
    } else if (way.isClosed()) {
      nextIndex = way.nodes.length - 2;
    }

    if (nextIndex !== -1) {
      const context = this.context;
      const editor = context.systems.editor!;
      const map = context.systems.map!;
      const graph = editor.staging.graph;

      const nodeID = way.nodes[nextIndex];
      if (!nodeID) return;
      const node = graph.hasEntity(nodeID) as OsmNode;
      if (!node) return;

      context.enter('select', { selection: [node.id] });
      map.centerEase(node.loc!);
    }
  }


  /**
   *  jump to the next vertex
   * @param e
   */
  protected _nextVertex(e: Event): void {
    e.preventDefault();

    const entity = this._singularDatum;
    if (entity?.type !== 'node') return;

    const way = this._chooseParentWay(this._singularDatum);
    if (!way) return;

    const currIndex = way.nodes.indexOf(entity.id);
    let nextIndex = -1;

    if (currIndex < way.nodes.length - 1) {
      nextIndex = currIndex + 1;
    } else if (way.isClosed()) {
      nextIndex = 0;
    }

    if (nextIndex !== -1) {
      const context = this.context;
      const editor = context.systems.editor!;
      const map = context.systems.map!;
      const graph = editor.staging.graph;

      const nodeID = way.nodes[nextIndex];
      if (!nodeID) return;
      const node = graph.hasEntity(nodeID) as OsmNode;
      if (!node) return;

      context.enter('select', { selection: [node.id] });
      map.centerEase(node.loc!);
    }
  }


  /**
   *  If the user is at a junction, focus on a different parent way
   * @param e
   */
  protected _focusNextParent(e: Event): void {
    e.preventDefault();

    const entity = this._singularDatum;
    if (entity?.type !== 'node') return;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const parentIDs = graph.parentWays(entity).map(way => way.id);

    if (parentIDs.length) {
      const currIndex = this._focusedParentID ? parentIDs.indexOf(this._focusedParentID) : -1;  // -1 if not found
      let nextIndex = currIndex + 1;
      if (nextIndex >= parentIDs.length) {
        nextIndex = 0;  // wrap
      }

      this._focusedParentID = parentIDs[nextIndex];
    }

// won't work
//    var surface = context.surface();
//    surface.selectAll('.related')
//        .classed('related', false);
//
//    if (this._focusedParentID) {
//        surface.selectAll(utilEntitySelector([this._focusedParentID]))
//            .classed('related', true);
//    }
  }


  /**
   * Select the parent ways of the currently selected OSM nodes.
   * Triggered by Alt/Cmd/Ctrl + ArrowUp keyboard shortcut.
   */
  protected _selectParentWays(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const parentWayIDs = new Set<EntityID>();

    for (const entityID of this._osmIDs) {
      const entity = graph.hasEntity(entityID);
      if (entity?.type !== 'node') continue;

      for (const way of graph.parentWays(entity)) {
        parentWayIDs.add(way.id);
      }
    }

    if (!parentWayIDs.size) return;

    context.enter('select', {
      selection: [...parentWayIDs],
      focusedParentID: this._focusedParentID ?? undefined  // keep focus on same parentWay
    });
  }


  /**
   * Select the child nodes of the currently selected OSM ways.
   * Triggered by Alt/Cmd/Ctrl + ArrowDown keyboard shortcut.
   */
  protected _selectChildNodes(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const childNodeIDs = new Set<EntityID>();

    for (const entityID of this._osmIDs) {
      const entity = graph.hasEntity(entityID);
      if (entity?.type !== 'way') continue;

      for (const nodeID of (entity as OsmWay).nodes) {
        childNodeIDs.add(nodeID);
      }
    }

    if (!childNodeIDs.size) return;

    context.enter('select', {
      selection: [...childNodeIDs],
      focusedParentID: this._focusedParentID ?? undefined  // keep focus on same praentWay
    });
  }


  /**
   * Changes the cursor styling based on what geometry is hovered
   * @param eventData
   */
  protected _hover(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const eventManager = context.systems.gfx!.eventManager!;
    const graph = editor.staging.graph;

    const target = eventData.target;
    const dataID = target?.dataID;
    if (!dataID) return;

    // Only OSM entities have a data ID that's in the graph.
    const entity = graph.hasEntity(dataID);
    let geom = entity?.geometry(graph) ?? 'other';
    if (!entity && (target.data as AbstractData | undefined)?.type === 'midpoint') {
      geom = 'midpoint';
    }

    switch (geom) {
      case 'area':
        eventManager.setCursor('areaCursor');
        break;
      case 'line':
        eventManager.setCursor('lineCursor');
        break;
      case 'point':
        eventManager.setCursor('pointCursor');
        break;
      case 'midpoint':
        eventManager.setCursor('selectSplitCursor');
        break;
      case 'vertex':
        eventManager.setCursor('vertexCursor');
        break;
      default:
        eventManager.setCursor('grab');
        break;
    }
  }

}
