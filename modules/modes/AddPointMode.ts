import { AbstractMode } from './AbstractMode.ts';
import { actionAddEntity } from '../actions/add_entity.ts';
import { actionChangeTags } from '../actions/change_tags.ts';
import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { OsmNode } from '../data/OsmNode.ts';
import { projWorldToWgs84, vecProject, WORLD_ZOOM } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { EventData } from '../behaviors/AbstractBehavior.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmTags, OsmWay } from '../data/types.ts';
import type { Vec2 } from '@rapid-sdk/math';

const DEBUG = false;


/**
 * In `AddPointMode`, we are waiting for the user to place a point somewhere.
 */
export class AddPointMode extends AbstractMode {

  /** Tags to apply automatically when a new point is placed (e.g. from a preset selection) */
  public defaultTags: OsmTags;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'add-point';

    this.defaultTags = {};

    // Make sure the event handlers have `this` bound correctly
    this._click = this._click.bind(this);
    this._cancel = this._cancel.bind(this);
  }


  /**
   * Enters the mode.
   * @return `true` if mode could be entered, `false` if not
   */
  public enter(): boolean {
    if (DEBUG) {
      console.log('AddPointMode: entering');  // eslint-disable-line no-console
    }

    this._active = true;
    const context = this.context;

    const eventManager = context.systems.gfx!.eventManager!;
    eventManager.setCursor('crosshair');

    context.enableBehaviors(['hover', 'draw', 'mapInteraction']);
    context.behaviors.draw!
      .on('click', this._click)
      .on('cancel', this._cancel)
      .on('finish', this._cancel);

    return true;
  }


  /**
   * Exits the mode, removing event listeners and resetting cursor.
   */
  public exit(): void {
    if (!this._active) return;
    this._active = false;

    if (DEBUG) {
      console.log('AddPointMode: exiting');  // eslint-disable-line no-console
    }

    const context = this.context;

    const eventManager = context.systems.gfx!.eventManager!;
    eventManager.setCursor('grab');

    context.behaviors.draw!
      .off('click', this._click)
      .off('cancel', this._cancel)
      .off('finish', this._cancel);
  }


  /**
   * Process whatever the user clicked on
   * @param eventData
   */
  protected _click(eventData: EventData): void {
    const context = this.context;
    const editor = context.systems.editor;
    const graph = editor!.staging.graph;
    const locations = context.systems.locations;
    const viewport = context.viewport;
    const point = eventData.coord.world;
    const loc = projWorldToWgs84(point);
    if (locations?.isBlockedAt(loc)) return;   // editing is blocked here

    // Allow snapping only for OSM Entities in the actual graph (i.e. not Rapid features)
    const datum = eventData?.target?.data as { id?: EntityID } | null;
    const target = datum?.id ? graph.hasEntity(datum.id) : null;

    // Snap to a node
    if (target && target.type === 'node') {
      const targetNode = target as OsmNode;
      if (targetNode.loc) {
        this._clickNode(targetNode.loc, targetNode);
        return;
      }
    }

    // Snap to a way
    if (target && target.type === 'way') {
      const way = target as OsmWay;
      // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
      const line = way.geoms.parts[0]!.world!.outer as Vec2[];

      const choice = vecProject(point, line);
      const localScale = 2 ** (WORLD_ZOOM - viewport.transform.zoom);
      const SNAP_DIST = 6;  // hack to avoid snap to fill, see Rapid#719

      if (choice && choice.distance < SNAP_DIST * localScale) {
        const loc = projWorldToWgs84(choice.point);
        const edge: [EntityID, EntityID] = [way.nodes[choice.index - 1], way.nodes[choice.index]];
        this._clickWay(loc, edge);
        return;
      }
    }
    this._clickNothing(loc);
  }


  /**
   * Clicked on nothing, create the point at given `loc`
   * @param loc
   */
  protected _clickNothing(loc: Vec2): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const node = new OsmNode(context, { loc: loc, tags: this.defaultTags });

    editor.perform(actionAddEntity(node));
    editor.commit({ annotation: l10n.t('operations.add.annotation.point'), selectedIDs: [node.id] });
    context.enter('select-osm', { selection: { osm: [node.id] }, newFeature: true });
  }


  /**
   * Clicked on an existing way, add a midpoint along the `edge` at given `loc`
   * @param loc
   * @param edge
   */
  protected _clickWay(loc: Vec2, edge: [EntityID, EntityID]): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const node = new OsmNode(context, { tags: this.defaultTags });
    editor.perform(actionAddMidpoint({ loc, edge } as Midpoint, node));
    editor.commit({ annotation: l10n.t('operations.add.annotation.vertex'), selectedIDs: [node.id] });
    context.enter('select-osm', { selection: { osm: [node.id] }, newFeature: true });
  }


  /**
   * Clicked on an existing node, merge `defaultTags` into it, if any, then select the node
   * @param _loc
   * @param node
   */
  protected _clickNode(_loc: Vec2, node: OsmNode): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    if (Object.keys(this.defaultTags).length === 0) {
      context.enter('select-osm', { selection: { osm: [node.id] }, newFeature: false });
      return;
    }

    const tags: OsmTags = { ...node.tags };  // shallow copy
    for (const k in this.defaultTags) {
      tags[k] = this.defaultTags[k];
    }

    editor.perform(actionChangeTags(node.id, tags));
    editor.commit({ annotation: l10n.t('operations.add.annotation.point'), selectedIDs: [node.id] });
    context.enter('select-osm', { selection: { osm: [node.id] }, newFeature: false });
  }


  /**
   * Return to browse mode without doing anything
   */
  protected _cancel(): void {
    this.context.enter('browse');
  }
}
