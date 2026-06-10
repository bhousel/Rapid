import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import { projWorldToWgs84, vecAngle, vecLength, vecInterp, WORLD_ZOOM } from '@rapid-sdk/math';

import type { MarkerProps } from '../data/MarkerData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Preset } from '../lib/Preset.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


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
  polygons: Map<EntityID, OsmEntity>;
  lines: Map<EntityID, OsmWay>;
  points: Map<EntityID, OsmNode>;
  vertices: Map<EntityID, OsmNode>;
}

/** Related entity IDs for selection/hover/drawing */
interface RelatedIDs {
  descendantIDs: Set<EntityID>;
  siblingIDs: Set<EntityID>;
}

/** Midpoint properties */
interface MidpointProps extends MarkerProps {
  type: 'midpoint';
  serviceID: 'osm';
  id: string;
  wayID: EntityID;
  edge: [EntityID, EntityID];
  dist: number;
  rotation: number;
  coord: Vec2;
}

/* Midpoints are markers that accept the MidpointProps */
type Midpoint = MarkerData<MidpointProps>;

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
 * This class renders OpenStreetMap map data.
 */
export class PixiLayerOsm extends AbstractPixiLayer {

  /** Container for area/polygon features */
  public areaContainer: PIXI.Container | null;
  /** Container for line features */
  public lineContainer: PIXI.Container | null;

  /** collection of calculated midpoints */
  protected _midpoints: Map<DataID, Midpoint>;



  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'osm';
    this._enabled = true;   // OSM layers should be enabled by default

    this.areaContainer = null;
    this.lineContainer = null;

    this._midpoints = new Map<DataID, Midpoint>();
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if the OSM service is registered
   */
  public get supported(): boolean {
    return !!this.context.services.osm;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled(): boolean {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the OSM service when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const osm = context.services.osm;
    if (val && osm) {
      osm.startAsync()
        .then(() => this.gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset(): void {
    super.reset();

    this._midpoints.clear();

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
   * Render any OSM data within view, and schedule fetching more of it to cover the view/
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const context = this.context;
    const osm = context.services.osm;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !osm?.started || viewZoom < MINZOOM) return;

    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

    context.loadTiles();  // Load tiles of OSM data to cover the view

    let entities = editor.intersects();   // Gather data in view
    entities = filters.filterScene(entities, graph);   // Apply feature filters

    const data: OsmData = {
      polygons: new Map<EntityID, OsmWay | OsmRelation>(),
      lines: new Map<EntityID, OsmWay>(),
      points: new Map<EntityID, OsmNode>(),
      vertices: new Map<EntityID, OsmNode>()
    };

    for (const entity of entities) {
      const geom = entity.geometry(graph);
      if (geom === 'point') {
        data.points.set(entity.id, entity as OsmNode);
      } else if (geom === 'vertex') {
        data.vertices.set(entity.id, entity as OsmNode);
      } else if (geom === 'line') {
        data.lines.set(entity.id, entity as OsmWay);
      } else if (geom === 'area') {
        data.polygons.set(entity.id, entity as OsmWay | OsmRelation);
//      } else if (geom === 'relation') {
//        // No support for this now, but it would be very nice to support
//        // special rendering for a selected relation.
      }
    }

    this.renderPolygons(frame, viewport, data);
    this.renderLines(frame, viewport, data);
    this.renderPoints(frame, viewport, data);

    // At this point, all the visible features have been accounted for,
    // and parent-child data links have been established.
    // We can prepare vertices and midpoints.

    // Gather ids related to the selected/hovered/drawing features.
    const selectedIDs = this.getDataWithClass('select');
    const hoveredIDs = this.getDataWithClass('hover');
    const drawingIDs = this.getDataWithClass('drawing');
    const dataIDs = new Set<EntityID>([...selectedIDs, ...hoveredIDs, ...drawingIDs]);

    // Experiment: avoid showing child vertices/midpoints for too small parents
    for (const dataID of dataIDs) {
      const entity = graph.hasEntity(dataID);
      if (entity?.type === 'node') continue;  // ways, relations only

      const extent = entity?.geoms?.world?.extent;
      if (!extent) continue;

      // Determine dimensions in screen pixels
      const worldScale = 2 ** (viewZoom - WORLD_ZOOM);
      const w = Math.abs(extent.max[0] - extent.min[0]) * worldScale;
      const h = Math.abs(extent.max[1] - extent.min[1]) * worldScale;

      if (w < 25 && h < 25) {   // too small, skip this
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
      descendantIDs: new Set<EntityID>(),
      siblingIDs: new Set<EntityID>()
    };
    for (const interestingID of interestingIDs) {
      this.getSelfAndDescendants(interestingID, related.descendantIDs);
      this.getSelfAndSiblings(interestingID, related.siblingIDs);
    }

    this.renderVertices(frame, viewport, data, related);

    if (context.mode?.id === 'select-osm') {
      this.renderMidpoints(frame, viewport, data, related);
    } else {
      this._midpoints.clear();
    }
  }


  /**
   * Renders the visible OSM area (polygon) features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderPolygons(frame: number, viewport: Viewport, data: OsmData): void {
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
    const isInterestingPreset = (preset: Preset | null): boolean => {
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
          feature.geometry = part;
          const area = part.world.extent.area();
          feature.container.zIndex = -area;      // sort by area descending (small things above big things)

          feature.data = entity;
          feature.clearChildData(entityID);
          if (entity.type === 'relation') {
            feature.addChildData(entityID, (entity as OsmRelation).members.map(member => member.id));
          }
          if (entity.type === 'way') {
            feature.addChildData(entityID, (entity as OsmWay).nodes);
          }
        }


        const props = feature.props;
        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          const preset = schema.match(entity, graph);

          const geometry = entity.geometry(graph);
          const style = styles.styleMatch(entity.tags, geometry, 'osm');
          feature.style = style;

          const label = l10n.displayPOIName(entity.tags);
          feature.label = label;

          // POI = "Point of Interest" -and- "Pole of Inaccessability"
          // For POIs mapped as polygons, we can create a virtual point feature at the pole of inaccessability.
          // Try to show a virtual pin if there is a label or if the preset is interesting enough..
          // Store the details about this in the feature's properties object.
          if (showPoints && (label || isInterestingPreset(preset))) {
            props.poiFeatureID = `${this.layerID}-${entityID}-poi-${i}`;
            props.poiPreset = preset;
          } else {
            props.poiFeatureID = null;
            props.poiPreset = null;
          }
        }

        feature.update(viewport);
        this.retainFeature(feature, frame);

        // Same as above, but for the virtual POI, if any
        if (props.poiFeatureID) {
          const poiFeatureID = props.poiFeatureID as FeatureID;
          const poiPreset = props.poiPreset as Preset | null;

          let poiFeature = this.features.get(poiFeatureID) as PixiFeaturePoint | undefined;
          if (!poiFeature) {
            poiFeature = new PixiFeaturePoint(this, poiFeatureID);
            poiFeature.props.isVirtual = true;
            poiFeature.parentContainer = pointsContainer;
          }

          if (poiFeature.v !== version) {
            poiFeature.v = version;

            const poiGeometry = new GeometryPart(context);
            poiGeometry.setData({ type: 'Point', coordinates: projWorldToWgs84(part.world.poi!) });
            poiFeature.geometry = poiGeometry;
            poiFeature.data = entity;
          }

          this.syncFeatureClasses(poiFeature);

          if (poiFeature.dirty) {
            // copy the polygon style, then apply customizations
            const markerStyle = structuredClone(feature.style) as MatchedStyle;

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

            const poiIcon = poiPreset?.props?.icon;
            if (poiIcon) {
              markerStyle.icon.image = poiIcon;
            }

            poiFeature.style = markerStyle;
            poiFeature.label = feature.label;
          }

          poiFeature.update(viewport);
          this.retainFeature(poiFeature, frame);
        }

      }
    }
  }


  /**
   * Renders the visible OSM line features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderLines(frame: number, viewport: Viewport, data: OsmData): void {
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

    const ways = data.lines;
    for (const [wayID, way] of ways) {
      const layer = way.layer();
      const levelContainer = _getLevelContainer(layer.toString());
      const zindex = getzIndex(way.tags);
      const version = way.v || 0;

      const parts = way.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (!part.world || part.type !== 'LineString') continue;  // invalid?

        const featureID = `${this.layerID}-${wayID}-${i}`;
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
          feature.geometry = part;
          feature.parentContainer = levelContainer;    // Change layer stacking if necessary
          feature.container.zIndex = zindex;

          feature.data = way;
          feature.clearChildData(wayID);
          feature.addChildData(wayID, way.nodes);
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          let styleTags = way.tags;
          let styleGeometry: 'line' | 'area' = 'line';
          let isUntaggedMultipolygonEdge = false;

          // A line no tags - If it's a multipolygon edge (e.g. outer or inner),
          // attempt to styleMatch the tags of its parent relation.
          if (!way.hasInterestingTags()) {
            const parent = graph.parentRelations(way).find(relation => relation.isMultipolygon());
            if (parent) {
              styleTags = parent.tags;
              styleGeometry = 'area';
              isUntaggedMultipolygonEdge = true;
            }
          }

          const style = styles.styleMatch(styleTags, styleGeometry, 'osm');
          if (way.isOneWay()) {
            style.lineMarker ??= {};
            const isAlternating = (way.tags.oneway === 'alternating' || way.tags.oneway === 'reversible');
            style.lineMarker.image = isAlternating ? 'twoway' : 'oneway';
          } else {
            delete style.lineMarker;
          }
          if (way.isSided()) {    // todo: handle both-sided cases
            style.sidedMarker ??= {};
            style.sidedMarker.image = 'sided';
          } else {
            delete style.sidedMarker;
          }

          // Override styling for untagged 'inner'/'outer' ways.
          // Note that multipolygons were already fully rendered by `renderPolygons` -
          // what we are doing here is rendering the 'inner'/'outer' lines that
          // sit on top of the multipolygon edges and are selectable as ways.
          if (isUntaggedMultipolygonEdge) {
            style.casing.width = 0;
            style.stroke.color = style.fill.color;
            style.stroke.width = 2;
          }

          feature.style = style;
          feature.label = l10n.displayName(way.tags);
        }

        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Renders the visible OSM vertices (way nodes) for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  public renderVertices(frame: number, viewport: Viewport, data: OsmData, related: RelatedIDs): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const map = context.systems.map;
    const styles = context.systems.styles!;

    const viewZoom = viewport.transform.zoom;
    const styleZoom = map?.effectiveZoom() ?? viewZoom;

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


    const nodes = data.vertices;
    for (const [nodeID, node] of nodes) {
      let parentContainer: PIXI.Container | null = null;

      if (styleZoom >= 16 && isInterestingVertex(node) ) {  // minor importance
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
        feature.geometry = part;
        feature.data = node;
      }

      this.syncFeatureClasses(feature);
      feature.parentContainer = parentContainer;   // change layer stacking if necessary

      if (feature.dirty) {
        const markerStyle = styles.styleMatch(node.tags, 'vertex', 'osm');

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

      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Renders the visible OSM standalone point features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderPoints(frame: number, viewport: Viewport, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const styles = context.systems.styles!;
    const pointsContainer = this.scene.groups.get('points')!;

    const nodes = data.points;
    for (const [nodeID, node] of nodes) {
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
        feature.geometry = part;
        feature.data = node;
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const markerStyle = styles.styleMatch(node.tags, 'point', 'osm');

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

      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Gathers the midpoints that currently belong in the scene.
   * @param  viewport - Pixi viewport to use for rendering
   * @param  data - Visible OSM data to render, sorted by type
   * @param  related - Collections of related OSM IDs
   * @return Array of midpoint properties
   */
  protected _gatherMidpoints(viewport: Viewport, data: OsmData, related: RelatedIDs): MidpointProps[]  {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    // Need to consider both `data.lines` and `data.polygons` for drawing our midpoints.
    // Include only ways that are directly selected, or descended from a relation that is selected.
    const ways = new Set<OsmWay>();
    for (const [entityID, entity] of data.lines) {
      if (!related.descendantIDs.has(entityID)) continue;   // not selected
      ways.add(entity);
    }
    for (const [entityID, entity] of data.polygons) {
      if (entity.type !== 'way') continue;                  // not a way
      if (!related.descendantIDs.has(entityID)) continue;   // not selected
      ways.add(entity as OsmWay);
    }

    const results: MidpointProps[] = [];
    for (const way of ways) {
      const nodes = graph.childNodes(way);
      if (!nodes.length) continue;  // no nodes?

      // swap order for reverse-drawn ways
      const isReverse = (way.tags.oneway === '-1');

      for (let i = 0; i < nodes.length - 1; i++) {
        const node1 = isReverse ? nodes[i + 1] : nodes[i];
        const node2 = isReverse ? nodes[i] : nodes[i + 1];

        // gather world coordinates of the nodes
        const coord1 = node1.geoms.parts[0].world?.coords as Vec2;
        const coord2 = node2.geoms.parts[0].world?.coords as Vec2;
        if (!coord1 || !coord2) continue;

        const dist = vecLength(coord1, coord2);
        const rotation = vecAngle(coord1, coord2);
        const coord = vecInterp(coord1, coord2, 0.5);
        const loc = projWorldToWgs84(coord);

        // The node world coords can be used as a unique identifier
        const key = `${coord1[0].toFixed(7)},${coord1[1].toFixed(7)}:${coord2[0].toFixed(7)},${coord2[1].toFixed(7)}`;

        results.push({
          type: 'midpoint',
          serviceID: 'osm',
          isNew: true,
          id: key,
          wayID: way.id,
          edge: [node1.id, node2.id],
          dist: dist,
          rotation: rotation,
          coord: coord,
          loc: loc
        });
      }
    }

    return results;
  }


  /**
   * Renders the midpoint handles along visible OSM ways for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  public renderMidpoints(frame: number, viewport: Viewport, data: OsmData, related: RelatedIDs): void {
    const context = this.context;

    // Convert screen pixel values to world units
    const scale = 2 ** (WORLD_ZOOM - viewport.transform.z);
    const minDistance = 40 * scale;

    // Midpoints should be drawn above everything
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;

    // Gather midpoints in view
    const midpointData = this._gatherMidpoints(viewport, data, related);
    for (const props of midpointData) {
      if (props.dist < minDistance) continue;  // skip if points are too close at this zoom

      // Generate data element if needed
      let midpoint = this._midpoints.get(props.id);
      if (!midpoint) {
        midpoint = new MarkerData<MidpointProps>(context, props);
      }

      // Check that this part has coordinates and is a Point
      const part = midpoint.geoms.parts[0];
      if (!part.world || part.type !== 'Point') continue;

      const featureID = `${this.layerID}-midpoint-${midpoint.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.style = {
          marker: { color: 0xffffff, image: 'midpoint' }
        };
        feature.parentContainer = selectedContainer;
        feature.geometry = part;
        feature.data = midpoint;
        feature.addChildData(midpoint.props.wayID, midpoint.id);
      }

      this.syncFeatureClasses(feature);
      if (feature.dirty) {
        // Important to apply viewport rotation - this needs to go on the marker,
        // because the container automatically rotates to be north-up.
        feature.marker!.rotation = midpoint.props.rotation + viewport.transform.rotation;
      }
      feature.update(viewport);
      this.retainFeature(feature, frame);
    }
  }

}
