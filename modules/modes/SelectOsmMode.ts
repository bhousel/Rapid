import { select as d3_select } from 'd3-selection';
import { DEG2RAD, vecAdd, vecRotate, vecScale } from '@rapid-sdk/math';
import { utilArrayIdentical } from '@rapid-sdk/util';

import { AbstractMode } from './AbstractMode.ts';
import { actionDeleteRelation } from '../actions/delete_relation.ts';
import { actionMove, actionRotate } from '../actions/index.ts';
import * as Operations from '../operations/index.js';
import { utilCmd, utilKeybinding, utilTotalExtent } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { Extent, Vec2 } from '@rapid-sdk/math';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmRelation } from '../data/OsmRelation.ts';
import type { OsmWay } from '../data/OsmWay.ts';
import type { Keybinding } from '../util/keybinding.ts';


/** Options for entering `SelectOsmMode` */
export interface SelectOsmModeOptions {
  /** Selection object where keys are layerIDs and values are arrays of dataIDs */
  selection?: Record<LayerID, EntityID[]>;
  /** Whether this is a newly created feature */
  newFeature?: boolean;
  /** The focused parent way ID for vertex navigation */
  focusedParentID?: EntityID;
}


/**
 * In `SelectOsmMode`, the user has selected one or more OSM features.
 *
 * For a while we needed to keep the old `modeSelect` around, and we should
 * eventually have a common select mode for everything but this is just my
 * attempt at updating the legacy osm-only select mode for now.
 */
export class SelectOsmMode extends AbstractMode {
  /** Keybinding handler for this mode */
  keybinding: Keybinding | null;
  /** The total extent of selected features */
  extent: Extent | null;

  /** Whether this is a newly created feature */
  private _newFeature: boolean;
  /**
   * `_focusedParentID` is used when we visit a vertex with multiple
   * parents, and we want to remember which parent line we started on.
   */
  private _focusedParentID: EntityID | null;
  /** If we have a single thing selected, keep track of it here */
  private _singularDatum: OsmEntity | null;
  /** Previous selection, used by arrow key handler */
  private _lastSelectedIDs: EntityID[];

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'select-osm';

    this.keybinding = null;
    this.extent = null;

    this._newFeature = false;
    this._focusedParentID = null;
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
   * Enters the mode.
   * @param  options - Optional options object
   * @return `true` if the mode can be entered, `false` if not
   */
  enter(options: SelectOsmModeOptions = {}): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const gfx = context.systems.gfx!;
    const hover = context.behaviors.hover!;
    const locations = context.systems.locations;
    const ui = context.systems.ui!;
    const urlhash = context.systems.urlhash!;
    const graph = editor.staging.graph;
    const scene = gfx.scene!;
    const eventManager = gfx.eventManager!;

    const selection = options.selection ?? {};
    let entityIDs = selection.osm ?? [];
    this._newFeature = options.newFeature ?? false;

    // Gather valid entities and entityIDs from selection.
    // For this mode, keep only the OSM data.
    this._selectedData = new Map();
    this._singularDatum = null;
    this._lastSelectedIDs = [];
    this._focusedParentID = options.focusedParentID ?? null;

    for (const entityID of entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) continue;   // not in the osm graph
      if (entity.type === 'node') {
        const loc = (entity as OsmNode).loc;
        if (loc && locations?.isBlockedAt(loc)) continue;  // editing is blocked
      }

      this._selectedData.set(entityID, entity);

      if (entityIDs.length === 1) {
        this._singularDatum = entity;  // if a single thing is selected
      }
    }

    if (!this._selectedData.size) return false;  // found nothing to select
    entityIDs = [...this._selectedData.keys()];  // the entities we ended up keeping

    this._active = true;

    context.enableBehaviors(['hover', 'select', 'drag', 'mapInteraction', 'lasso', 'paste']);
    ui.closeEditMenu();

    // Compute the total extent of selected items
    this.extent = utilTotalExtent(entityIDs, graph);

    // Handle select style class
    scene.clearClass('select');
    for (const entityID of entityIDs) {
      scene.setClass('select', 'osm', entityID);
    }

    urlhash.setParam('id', entityIDs.join(','));      // Put entityIDs into the url hash
    filters.forceVisible(entityIDs);                  // Exclude entityIDs from being filtered
    this._setupOperations(entityIDs);                 // Determine available operations on the edit menu

    this.keybinding = utilKeybinding('select');
    this.keybinding
      .on(['[', 'pgup'], this._previousVertex)
      .on([']', 'pgdown'], this._nextVertex)
      .on(['{', utilCmd('⌘['), 'home'], this._firstVertex)
      .on(['}', utilCmd('⌘]'), 'end'], this._lastVertex)
      .on(['\\', 'pause'], this._focusNextParent);

    d3_select(document)
      .call(this.keybinding);

    eventManager.on('keydown', this._keydown);
    editor.on('merge', this._merge);
    hover.on('hoverchange', this._hover);

    ui.Sidebar.showInspector(entityIDs, this._newFeature);

    return true;
  }


  /**
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const gfx = context.systems.gfx!;
    const hover = context.behaviors.hover!;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui!;
    const urlhash = context.systems.urlhash!;
    const scene = gfx.scene!;
    const eventManager = gfx.eventManager!;

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
          annotation: l10n.t('operations.delete.annotation.relation'),
          selectedIDs: [entity.id]
        });
      }
    }

    this.extent = null;
    this._newFeature = false;
    this._singularDatum = null;
    this._selectedData.clear();
    this._lastSelectedIDs = [];

    // disable operations
    for (const operation of this.operations as any[]) {
      if (operation.behavior) {
        operation.behavior.disable();
      }
    }
    this.operations = [];

    scene.clearClass('select');
    ui.closeEditMenu();
    ui.Sidebar.hide();
    urlhash.setParam('id', null);
    filters.forceVisible([]);

    if (this.keybinding) {
      d3_select(document).call(this.keybinding.unbind);
      this.keybinding = null;
    }

    editor.off('merge', this._merge);
    eventManager.off('keydown', this._keydown);
    hover.off('hoverchange', this._hover);
  }


  /**
   * Handler for keydown events on the window.
   * @param  e - A DOM KeyboardEvent
   */
  private _keydown(e: KeyboardEvent): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const ui = context.systems.ui!;
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

    // Does the user have the same selection and is doing same action as before?
    // If so, use `commitAppend` to avoid creating a new undo state.
    const selectedIDs = [...this._selectedData.keys()];
    const isSameSelection = utilArrayIdentical(selectedIDs, this._lastSelectedIDs);
    if (!isSameSelection) {
      this._lastSelectedIDs = selectedIDs.slice();  // take copy
    }

    let operation: any;
    let action: any;

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

        operation = Operations.operationRotate(context, selectedIDs);
        action = actionRotate(selectedIDs, pivot, delta, viewport);
      }

    // move
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();

      const MOVE_AMOUNT = 3;   // in pixels
      let delta: [number, number] | undefined;
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
        operation = Operations.operationMove(context, selectedIDs);
        action = actionMove(selectedIDs, delta, viewport);
      }
    }

    // Is this shape transform allowed?
    if (operation && action) {
      if (!operation.available()) return;

      if (operation.disabled()) {
        ui.Flash
          .duration(4000)
          .iconName(`#rapid-operation-${operation.id}`)
          .iconClass('operation disabled')
          .label(operation.tooltip)();

        return;
      }

      // do it
      const annotation = operation.annotation();
      const options = { annotation: annotation, selectedIDs: selectedIDs };

      editor.perform(action);
      if (isSameSelection && editor.getUndoAnnotation() === annotation) {
        editor.commitAppend(options);
      } else {
        editor.commit(options);
      }

      // Update selected/active collections to contain the transformed entities
      const graph2 = editor.staging.graph;  // after transform
      this._selectedData.clear();
      for (const entityID of selectedIDs) {
        this._selectedData.set(entityID, graph2.entity(entityID));
      }

      // Recheck the available operations on menu here.
      // For example, if a user moved the shape off the screen
      // then some of the operations should disable themselves.
      this._setupOperations(selectedIDs);
    }
  }


  /**
   * If we have entities selected already, and we find new versions
   * of them loaded from the server, the `operations` offered on
   * the edit menu may be wrong and should be refreshed. Rapid#1311
   * @param  newIDs - entityIDs recently loaded from OSM
   */
  private _merge(newIDs: Set<EntityID>): void {
    if (!(newIDs instanceof Set)) return;
    const entityIDs = [...this._selectedData.keys()];

    let needsRefresh = false;
    for (const entityID of entityIDs) {
      if (newIDs.has(entityID)) {
        needsRefresh = true;
        break;
      }
    }

    if (needsRefresh) {
      this._setupOperations(entityIDs);
    }
  }


  /**
   *  Called whenever we have a need to reset the `operations` array.
   *  @param  entityIDs - the selected entityIDs
   */
  private _setupOperations(entityIDs: EntityID[]): void {
    const context = this.context;
    const ui = context.systems.ui!;

    // disable any that were available before
    for (const operation of this.operations as any[]) {
      if (operation.behavior) {
        operation.behavior.disable();
      }
    }

    if (Array.isArray(entityIDs) && entityIDs.length) {
      const order: Record<OperationID, number> = {  // sort these to the end of the list
        copy: 1,
        downgrade: 2,
        delete: 3
      };

      this.operations = Object.values(Operations)
        .map(op => op(context, entityIDs))
        .filter(op => op.available())
        .sort((a, b) => {
          const aOrder = order[a.id] || 0;
          const bOrder = order[b.id] || 0;
          return aOrder - bOrder;
        });

      // enable all available
      for (const operation of this.operations as any[]) {
        if (operation.behavior) {
          operation.behavior.enable();
        }
      }
    }

    // Redraw the menu if it is already shown
    ui.redrawEditMenu();
  }


  /**
   *  When using keyboard navigation, try to stay with the previously focused parent way
   *  @param  entity - The entity we are checking for parent ways
   */
  private _chooseParentWay(entity: OsmEntity | null): OsmWay | undefined {
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
   */
  private _firstVertex(d3_event: Event): void {
    d3_event.preventDefault();

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

    context.enter('select-osm', { selection: { osm: [nodeID] }} );
    map.centerEase(node.loc!);
  }


  /**
   *  jump to the first vertex along a way
   */
  private _lastVertex(d3_event: Event): void {
    d3_event.preventDefault();

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

    context.enter('select-osm', { selection: { osm: [nodeID] }} );
    map.centerEase(node.loc!);
  }


  /**
   *  jump to the previous vertex
   */
  private _previousVertex(d3_event: Event): void {
    d3_event.preventDefault();

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

      context.enter('select-osm', { selection: { osm: [node.id] }} );
      map.centerEase(node.loc!);
    }
  }


  /**
   *  jump to the next vertex
   */
  private _nextVertex(d3_event: Event): void {
    d3_event.preventDefault();

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

      context.enter('select-osm', { selection: { osm: [node.id] }} );
      map.centerEase(node.loc!);
    }
  }


  /**
   *  If the user is at a junction, focus on a different parent way
   */
  private _focusNextParent(d3_event: Event): void {
    d3_event.preventDefault();

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
   * Select the parent ways of the currently selected nodes.
   * Triggered by Alt/Cmd/Ctrl + ArrowUp keyboard shortcut.
   */
  private _selectParentWays(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const parentWayIDs = new Set<EntityID>();

    for (const entity of this._selectedData.values()) {
      if (entity.type !== 'node') continue;

      for (const way of graph.parentWays(entity as OsmEntity)) {
        parentWayIDs.add(way.id);
      }
    }

    if (!parentWayIDs.size) return;

    context.enter('select-osm', {
      selection: { osm: [...parentWayIDs] },
      focusedParentID: this._focusedParentID ?? undefined  // keep focus on same parentWay
    });
  }


  /**
   * Select the child nodes of the currently selected ways.
   * Triggered by Alt/Cmd/Ctrl + ArrowDown keyboard shortcut.
   */
  private _selectChildNodes(): void {
    const context = this.context;
    const childNodeIDs = new Set<EntityID>();

    for (const entity of this._selectedData.values()) {
      if (entity.type !== 'way') continue;

      for (const nodeID of (entity as OsmWay).nodes) {
        childNodeIDs.add(nodeID);
      }
    }

    if (!childNodeIDs.size) return;

    context.enter('select-osm', {
      selection: { osm: [...childNodeIDs] },
      focusedParentID: this._focusedParentID ?? undefined  // keep focus on same praentWay
    });
  }


  /**
   * Changes the cursor styling based on what geometry is hovered
   */
  private _hover(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const eventManager = context.systems.gfx!.eventManager!;
    const graph = editor.staging.graph;

    const dataID = eventData.target?.dataID;
    if (!dataID) return;
    const entity = graph.hasEntity(dataID);
    const geom = entity?.geometry(graph) ?? 'unknown';

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
      case 'unknown':
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
