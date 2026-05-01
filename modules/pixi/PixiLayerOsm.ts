import * as PIXI from 'pixi.js';
import { vecAngle, vecLength, vecInterp } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';

import type { Vec2, Viewport } from '@rapid-sdk/math';
import type { OsmEntity, OsmNode, OsmRelationMember, OsmTags } from '../data/types.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { PixiScene } from './PixiScene.ts';


/** Minimum zoom level where OSM data is rendered */
const MINZOOM = 12;

/** Highway type z-index stacking order (motorway on top, footway on bottom) */
const HIGHWAYSTACK: Record<string, number> = {
  motorway: 0,
  motorway_link: -1,
  trunk: -2,
  trunk_link: -3,
  primary: -4,
  primary_link: -5,
  secondary: -6,
  tertiary: -7,
  unclassified: -8,
  residential: -9,
  service: -10,
  busway: -11,
  track: -12,
  footway: -20
};

/** Visible OSM data sorted by geometry type */
interface OsmData {
  polygons: Map<EntityID, any>;
  lines: Map<EntityID, any>;
  points: Map<EntityID, OsmNode>;
  vertices: Map<EntityID, OsmNode>;
}

/** Related entity IDs for selection/hover/drawing */
interface RelatedIDs {
  descendantIDs: Set<EntityID>;
  siblingIDs: Set<EntityID>;
}

/** Midpoint data for adding nodes to ways */
interface MidpointData {
  type: 'midpoint';
  id: string;
  a: { id: string; point: Vec2 };
  b: { id: string; point: Vec2 };
  way: any;
  world: Vec2;
  loc: Vec2;
  rot: number;
}


/**
 * Returns z-index for highway tags (for drawing order)
 * @param tags - Entity tags
 * @returns z-index value
 */
function getzIndex(tags: OsmTags): number {
  return HIGHWAYSTACK[tags.highway] || 0;
}


/**
 * Checks if entity has any wikidata tags (deserves special styling)
 * @param entity - OSM entity to check
 * @returns true if entity has wikidata tags
 */
function hasWikidata(entity: OsmEntity): boolean {
  const tags = entity.tags as OsmTags;
  return !!(
    tags.wikidata ||
    tags['flag:wikidata'] ||
    tags['brand:wikidata'] ||
    tags['network:wikidata'] ||
    tags['operator:wikidata']
  );
}


/**
 * Renders OpenStreetMap entities (points, vertices, lines, polygons)
 * @class
 */
export class PixiLayerOsm extends AbstractPixiLayer {
  /** Container for area/polygon features */
  areaContainer: PIXI.Container | null;
  /** Container for line features */
  lineContainer: PIXI.Container | null;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'osm';
    this._enabled = true;   // OSM layers should be enabled by default

    this.areaContainer = null;
    this.lineContainer = null;
  }


  /**
   * Whether the Layer's service exists
   */
  get supported(): boolean {
    return !!this.context.services.osm;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const osm = context.services.osm;
    if (val && osm) {
      osm.startAsync()
        .then(() => gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();

    const groupContainer = this.scene.groups.get('basemap')!;

    // Remove any existing containers
    for (const child of groupContainer.children) {
      if (child.label.startsWith(this.layerID + '-')) {   // 'osm-*'
        groupContainer.removeChild(child);
        child.destroy({ children: true });  // recursive
      }
    }

    // Add containers
    const areas = new PIXI.Container();
    areas.label = `${this.layerID}-areas`;   // e.g. osm-areas
    areas.sortableChildren = true;
    this.areaContainer = areas;

    const lines = new PIXI.Container();
    lines.label = `${this.layerID}-lines`;   // e.g. osm-lines
    lines.sortableChildren = true;
    this.lineContainer = lines;

    groupContainer.addChild(areas, lines);
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    const context = this.context;
    const osm = context.services.osm;
    if (!this.enabled || !osm?.started || zoom < MINZOOM) return;

    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

    context.loadTiles();  // Load tiles of OSM data to cover the view

    let entities = editor.intersects(context.viewport.visibleExtent());   // Gather data in view
    entities = filters.filterScene(entities, graph);   // Apply feature filters

    const data: OsmData = {
      polygons: new Map(),
      lines: new Map(),
      points: new Map(),
      vertices: new Map(),
    };

    for (const entity of entities) {
      const geom = entity.geometry(graph);
      if (geom === 'point') {
        data.points.set(entity.id, entity as OsmNode);
      } else if (geom === 'vertex') {
        data.vertices.set(entity.id, entity as OsmNode);
      } else if (geom === 'line') {
        data.lines.set(entity.id, entity);
      } else if (geom === 'area') {
        data.polygons.set(entity.id, entity);
      }
    }

    this.renderPolygons(frame, viewport, zoom, data);
    this.renderLines(frame, viewport, zoom, data);
    this.renderPoints(frame, viewport, zoom, data);

    // At this point, all the visible linear features have been accounted for,
    // and parent-child data links have been established.

    // Gather ids related for the selected/hovered/drawing features.
    const selectedIDs = this.getDataWithClass('select');
    const hoveredIDs = this.getDataWithClass('hover');
    const drawingIDs = this.getDataWithClass('drawing');
    const dataIDs = new Set<EntityID>([...selectedIDs, ...hoveredIDs, ...drawingIDs]);

    // Experiment: avoid showing child vertices/midpoints for too small parents
    for (const dataID of dataIDs) {
      const entity = graph.hasEntity(dataID);
      if (entity?.type === 'node') continue;  // ways, relations only

      const renderedFeatureIDs = this._dataHasFeature.get(dataID) ?? new Set();
      let tooSmall = false;
      for (const featureID of renderedFeatureIDs) {
        const geom = this.features.get(featureID)?.geom;
        if (!geom || geom.type === 'Point') continue;  // lines, polygons only (i.e. ignore virtual poi if any)
        const screen = geom.screen;
        const w = screen?.width ?? 0;
        const h = screen?.height ?? 0;
        if (w < 25 && h < 25) {
          tooSmall = true;
          break;
        }
      }
      if (tooSmall) {
        dataIDs.delete(dataID);
      }
    }

    // Expand set to include parent ways for selected/hovered/drawing nodes too..
    const interestingIDs = new Set<EntityID>(dataIDs);
    for (const dataID of dataIDs) {
      const entity = graph.hasEntity(dataID);
      if (entity?.type !== 'node') continue;   // nodes only
      for (const parent of graph.parentWays(entity)) {
        interestingIDs.add(parent.id);
      }
    }

    // Create collections of the sibling and descendant IDs,
    // These will determine which vertices and midpoints get drawn.
    const related: RelatedIDs = {
      descendantIDs: new Set(),
      siblingIDs: new Set()
    };
    for (const interestingID of interestingIDs) {
      this.getSelfAndDescendants(interestingID, related.descendantIDs);
      this.getSelfAndSiblings(interestingID, related.siblingIDs);
    }

    this.renderVertices(frame, viewport, zoom, data, related);

    if (context.mode?.id === 'select-osm') {
      this.renderMidpoints(frame, viewport, zoom, data, related);
    }
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  renderPolygons(frame: number, viewport: Viewport, zoom: number, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const styles = context.systems.styles!;

    const pointsContainer = this.scene.groups.get('points')!;
    const showPoints = filters.isEnabled('points');

    // For deciding if an unlabeled polygon feature is interesting enough to show a virtual pin.
    // Note that labeled polygon features will always get a virtual pin.
    const isInterestingPreset = (preset: any): boolean => {
      if (!preset || preset.isFallback()) return false;

      // These presets probably are not POIs
      if (/^(address|building|indoor|landuse|man_made|military|natural|playground)/.test(preset.id)) return false;

      // These presets probably are POIs even without a label
      // See nsi.guide for the sort of things we are looking for.
      if (/^(attraction|club|craft|emergency|healthcare|office|power|shop|telecom|tourism)/.test(preset.id)) return true;
      if (/^amenity\/(?!parking|shelter)/.test(preset.id)) return true;
      if (/^leisure\/(?!garden|firepit|picnic_table|pitch|swimming_pool)/.test(preset.id)) return true;

      return false;   // not sure, just ignore it
    };

    const entities = data.polygons;
    for (const [entityID, entity] of entities) {
      const version = entity.v || 0;
      const parts = entity.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (!part.world || part.type !== 'Polygon') continue;  // invalid?

        const featureID = `${this.layerID}-${entityID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeaturePolygon | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'Polygon') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeaturePolygon(this, featureID);
          feature.parentContainer = this.areaContainer;
        }

        // If data has changed.. Replace data and parent-child links.
        if (feature.v !== version) {
          feature.v = version;
          feature.setCoords(part);
          const area = part.world.extent.area();
          feature.container.zIndex = -area;      // sort by area descending (small things above big things)

          feature.setData(entityID, entity);
          feature.clearChildData(entityID);
          if (entity.type === 'relation') {
            feature.addChildData(entityID, entity.members.map((member: OsmRelationMember) => member.id));
          }
          if (entity.type === 'way') {
            feature.addChildData(entityID, entity.nodes);
          }
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          const preset = schema.match(entity, graph);

          const geometry = entity.geometry(graph);
          const style = styles.styleMatch(entity.tags, geometry, 'osm') as MatchedStyle;
          feature.style = style;

          const label = l10n.displayPOIName(entity.tags);
          feature.label = label;

          // POI = "Point of Interest" -and- "Pole of Inaccessability"
          // For POIs mapped as polygons, we can create a virtual point feature at the pole of inaccessability.
          // Try to show a virtual pin if there is a label or if the preset is interesting enough..
          if (showPoints && (label || isInterestingPreset(preset))) {
            (feature as any).poiFeatureID = `${this.layerID}-${entityID}-poi-${i}`;
            (feature as any).poiPreset = preset;
          } else {
            (feature as any).poiFeatureID = null;
            (feature as any).poiPreset = null;
          }
        }

        feature.update(viewport, zoom);
        this.retainFeature(feature, frame);

        // Same as above, but for the virtual POI, if any
        if ((feature as any).poiFeatureID && (feature as any).poiPreset) {
          let poiFeature = this.features.get((feature as any).poiFeatureID) as PixiFeaturePoint | undefined;

          if (!poiFeature) {
            poiFeature = new PixiFeaturePoint(this, (feature as any).poiFeatureID);
            (poiFeature as any).virtual = true;
            poiFeature.parentContainer = pointsContainer;
          }

          if (poiFeature.v !== version) {
            poiFeature.v = version;
            const source = { type: 'Point', world: { coords: part.world.poi } };
            poiFeature.setCoords(source as any);
            poiFeature.setData(entityID, entity);
          }

          this.syncFeatureClasses(poiFeature);

          if (poiFeature.dirty) {
            // copy the polygon style, then apply customizations
            const markerStyle = structuredClone(feature.style) as MatchedStyle;  // clone the style

            if (hasWikidata(entity)) {
              markerStyle.marker.image = 'boldPin';
              markerStyle.marker.color = 0xdddddd;  // grey pins
              markerStyle.label.color = 0xdddddd;
            } else {
              markerStyle.marker.image = 'pin';
              markerStyle.marker.color = 0xffffff;  // white pins
              markerStyle.label.color = 0xffffff;
            }
            // -or- make the virtual pins more closely match the polygon fill color?
            // (interesting idea, but these tend to be hard to see)
            // see Rapid#958 and Rapid#1474
            // markerStyle.marker.color = markerStyle.fill.color;
            // markerStyle.label.color = markerStyle.fill.color;
            markerStyle.icon.color = 0x444444;

            const poiIcon = (feature as any).poiPreset?.props?.icon;
            if (poiIcon) {
              markerStyle.icon.image = poiIcon;
            }

            poiFeature.style = markerStyle;
            poiFeature.label = feature.label;
          }

          poiFeature.update(viewport, zoom);
          this.retainFeature(poiFeature, frame);
        }

      }
    }
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  renderLines(frame: number, viewport: Viewport, zoom: number, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const styles = context.systems.styles!;
    const lineContainer = this.lineContainer!;

    const _getLevelContainer = (level: string): PIXI.Container => {
      let levelContainer = lineContainer.getChildByLabel(level);
      if (!levelContainer) {
        levelContainer = new PIXI.Container();
        levelContainer.label = level.toString();
        levelContainer.sortableChildren = true;
        levelContainer.zIndex = parseInt(level, 10);
        lineContainer.addChild(levelContainer);
      }
      return levelContainer;
    };

    const entities = data.lines;
    for (const [entityID, entity] of entities) {
      const layer = (typeof entity.layer === 'function') ? entity.layer() : 0;
      const levelContainer = _getLevelContainer(layer.toString());
      const zindex = getzIndex(entity.tags);
      const version = entity.v || 0;

      const parts = entity.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (!part.world) continue;  // invalid?

        const rings = (part.type === 'LineString') ? [part.world.coords]
          : (part.type === 'Polygon') ? part.world.coords
          : [];

        for (let j = 0; j < rings.length; ++j) {
          const featureID = `${this.layerID}-${entityID}-${i}-${j}`;
          let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

          // If feature existed before as a different type, recreate it.
          if (feature && feature.type !== 'LineString') {
            feature.destroy();
            feature = undefined;
          }

          if (!feature) {
            feature = new PixiFeatureLine(this, featureID);
          }

          // If data has changed.. Replace data and parent-child links.
          if (feature.v !== version) {
            feature.v = version;
            feature.setCoords(part);
            feature.parentContainer = levelContainer;    // Change layer stacking if necessary
            feature.container.zIndex = zindex;

            feature.setData(entityID, entity);
            feature.clearChildData(entityID);

            if (entity.type === 'relation') {
              feature.addChildData(entityID, entity.members.map((member: OsmRelationMember) => member.id));
            }
            if (entity.type === 'way') {
              feature.addChildData(entityID, entity.nodes);
            }
          }

          this.syncFeatureClasses(feature);

          if (feature.dirty) {
            let tags = entity.tags;
            let geometry = entity.geometry(graph);

            // a line no tags - try to style match the tags of its parent relation
            if (!entity.hasInterestingTags()) {
              const parent = graph.parentRelations(entity).find(relation => relation.isMultipolygon());
              if (parent) {
                tags = parent.tags;
                geometry = 'area';
              }
            }

            const style = styles.styleMatch(tags, geometry, 'osm') as MatchedStyle;
            // Todo: handle alternating/two-way case too
            if (geometry === 'line') {
              if (entity.isOneWay()) {
                style.lineMarker ??= {};
                const isAlternating = (entity.tags.oneway === 'alternating' || entity.tags.oneway === 'reversible');
                style.lineMarker.image = isAlternating ? 'twoway' : 'oneway';
              } else {
                delete style.lineMarker;
              }
              if (entity.isSided()) {
                style.sidedMarker ??= {};
                style.sidedMarker.image = 'sided';
              } else {
                delete style.sidedMarker;
              }

            } else {  // an area
// todo, consider whether we need these
              style.casing.width = 0;
              style.stroke.color = style.fill.color;
              style.stroke.width = 2;
              delete style.lineMarker;
              delete style.sidedMarker;
            }
            feature.style = style;

            feature.label = l10n.displayName(entity.tags);
          }

          feature.update(viewport, zoom);
          this.retainFeature(feature, frame);
        }
      }
    }

  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  renderVertices(frame: number, viewport: Viewport, zoom: number, data: OsmData, related: RelatedIDs): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const styles = context.systems.styles!;

    // Vertices related to the selection/hover should be drawn above everything
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;
    const pointsContainer = this.scene.groups.get('points')!;

    const isInterestingVertex = (node: OsmNode): boolean => {
      return node.hasInterestingTags() || node.isEndpoint(graph) || node.isIntersection(graph);
    };

    const isRelatedVertex = (entityID: EntityID): boolean => {
      return related.descendantIDs.has(entityID) || related.siblingIDs.has(entityID);
    };


    const entities = data.vertices;
    for (const [nodeID, node] of entities) {
      let parentContainer: PIXI.Container | null = null;

      if (zoom >= 16 && isInterestingVertex(node) ) {  // minor importance
        parentContainer = pointsContainer;
      }
      if (isRelatedVertex(nodeID)) {   // major importance
        parentContainer = selectedContainer;
      }

      if (!parentContainer) continue;   // this vertex isn't important enough to render

      const featureID = `${this.layerID}-${nodeID}`;
      const version = node.v || 0;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      // If feature existed before as a different type, recreate it.
      if (feature && feature.type !== 'Point') {
        feature.destroy();
        feature = undefined;
      }

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
      }

      // If data has changed, replace it.
      if (feature.v !== version) {
        feature.v = version;
        const part = node.geoms.parts[0];
        feature.setCoords(part);
        feature.setData(nodeID, node);
      }

      this.syncFeatureClasses(feature);
      feature.parentContainer = parentContainer;   // change layer stacking if necessary

      if (feature.dirty) {
        const markerStyle = styles.styleMatch(node.tags, 'vertex', 'osm') as MatchedStyle;

        // If we have an icon, increase the size of the marker..
        if (markerStyle.icon.image) {
          markerStyle.marker.image = 'largeCircle';
        } else if (node.hasInterestingTags()) {
          markerStyle.marker.image = 'taggedCircle';
        } else {
          markerStyle.marker.image = 'smallCircle';
        }

        // Show viewfields, if any..
        markerStyle.viewfield.angles = node.directions(graph);
        markerStyle.viewfield.image = 'viewfieldDark';

        if (hasWikidata(node)) {
          markerStyle.icon.color = 0x444444;
          markerStyle.marker.color = 0xdddddd;
          markerStyle.label.color = 0xdddddd;
        }
        if (node.isShared(graph)) {     // shared nodes / junctions are more grey
          markerStyle.icon.color = 0x111111;
          markerStyle.marker.color = 0xbbbbbb;
          markerStyle.label.color = 0xbbbbbb;
        }

        feature.style = markerStyle;
        feature.label = l10n.displayName(node.tags);
      }

      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  renderPoints(frame: number, viewport: Viewport, zoom: number, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const styles = context.systems.styles!;
    const pointsContainer = this.scene.groups.get('points')!;

    const entities = data.points;
    for (const [nodeID, node] of entities) {
      const featureID = `${this.layerID}-${nodeID}`;
      const version = node.v || 0;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      // If feature existed before as a different type, recreate it.
      if (feature && feature.type !== 'Point') {
        feature.destroy();
        feature = undefined;
      }

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.parentContainer = pointsContainer;
      }

      // If data has changed, replace it.
      if (feature.v !== version) {
        feature.v = version;
        const part = node.geoms.parts[0];
        feature.setCoords(part);
        feature.setData(nodeID, node);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const markerStyle = styles.styleMatch(node.tags, 'point', 'osm') as MatchedStyle;

        if (hasWikidata(node)) {
          markerStyle.marker.image = 'boldPin';
          markerStyle.marker.color = 0xdddddd;  // grey pins
          markerStyle.label.color = 0xdddddd;
        } else {
          markerStyle.marker.image = 'pin';
          markerStyle.marker.color = 0xffffff;  // white pins
          markerStyle.label.color = 0xffffff;
        }
        markerStyle.icon.color = 0x444444;

        // Show viewfields, if any..
        markerStyle.viewfield.angles = node.directions(graph);
        markerStyle.viewfield.image = 'viewfieldDark';


        // Override to style standalone addresses as circles, not pins.
        const preset = schema.matchTags(node.tags, 'point');
        if (preset?.id === 'address') {
          markerStyle.icon.image = 'maki-circle-stroked';
          markerStyle.marker.image = 'largeCircle';
        }

        feature.style = markerStyle;
        feature.label = l10n.displayName(node.tags);
      }

      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  renderMidpoints(frame: number, viewport: Viewport, zoom: number, data: OsmData, related: RelatedIDs): void {
    const MIN_MIDPOINT_DIST = 40;   // distance in pixels
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    // Need to consider both lines and polygons for drawing our midpoints
    const entities = new Map([...data.lines, ...data.polygons]);

    // Midpoints should be drawn above everything
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;

    // If any of these change, the midpoint needs to be redrawn.
    // (This can happen if a sibling node has moved, the midpoint moves too)
    const _midpointVersion = (d: MidpointData): number => {
      return d.loc[0] + d.loc[1] + d.rot;
    };

    // Generate midpoints from all the highlighted ways
    const midpoints = new Map<string, MidpointData>();
    const midpointStyle = {
      marker: { color: 0xffffff, image: 'midpoint' }
    };

    for (const [wayID, way] of entities) {
      // Include only ways that are selected, or descended from a relation that is selected
      if (!related.descendantIDs.has(wayID)) continue;

      // Include only actual ways that have child nodes
      const nodes = graph.childNodes(way);
      if (!nodes.length) continue;

      // Compute midpoints in projected screen coordinates
      // We do this so that we can skip midpoints that are closer than the minimum distance.
      interface NodeData {
        id: EntityID;
        point: Vec2;
      };

      const nodeData = nodes
        .map((node: OsmNode): NodeData | null => {
          if (!node.loc) return null;
          return {
            id: node.id,
            point: viewport.project(node.loc)
          };
        })
        .filter(Boolean) as NodeData[];

      if (way.tags.oneway === '-1') {
        nodeData.reverse();
      }

      for (let i = 0; i < nodeData.length - 1; i++) {
        const a = nodeData[i];
        const b = nodeData[i + 1];
        const midpointID = [a.id, b.id].sort().join('-');
        const dist = vecLength(a.point, b.point);
        if (dist < MIN_MIDPOINT_DIST) continue;

        const point = vecInterp(a.point, b.point, 0.5);
        const rot = vecAngle(a.point, b.point) + viewport.transform.rotation;
        const world = viewport.screenToWorld(point);
        const loc = viewport.worldToWgs84(world);  // store as wgs84 lon/lat
        const midpoint: MidpointData = {
          type: 'midpoint',
          id: midpointID,
          a: a,
          b: b,
          way: way,
          world: world as Vec2,
          loc: loc as Vec2,
          rot: rot
        };

        if (!midpoints.has(midpointID)) {
          midpoints.set(midpointID, midpoint);
        }
      }
    }

    for (const [midpointID, midpoint] of midpoints) {
      const featureID = `${this.layerID}-${midpointID}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.style = midpointStyle;
        feature.parentContainer = selectedContainer;
      }

      // Something about the midpoint has changed
      const v = _midpointVersion(midpoint);
      if (feature.v !== v) {
        feature.v = v;
        const source = { type: 'Point', world: { coords: midpoint.world } };
        feature.setCoords(source as any);

        // Remember to apply rotation - it needs to go on the marker,
        // because the container automatically rotates to be face up.
        feature.marker!.rotation = midpoint.rot;

        feature.setData(midpointID, midpoint);
        feature.addChildData(midpoint.way.id, midpointID);
      }

      this.syncFeatureClasses(feature);
      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }

}
