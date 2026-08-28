import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import { AbstractData, GeoJSONData, OsmEntity, OsmNode, OsmWay } from '../data/index.ts';

import type { Viewport } from '@rapid-sdk/math';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { PixiScene } from './PixiScene.ts';
import type { OsmTags } from '../data/types.ts';


/** Minimum zoom level where Rapid data is rendered */
const MINZOOM = 12;

/** Collected data from services, sorted by geometry type */
interface RenderData {
  points: AbstractData[];
  vertices: Set<AbstractData>;
  lines: AbstractData[];
  polygons: AbstractData[];
}


/**
 * This class renders Rapid map data.
 * Rapid allows users to work with third party datasets external to OpenStreetMap.
 * These datasets may be derived from authorative sources or AI-detected suggestions.
 */
export class PixiLayerRapid extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'rapid';
    this._enabled = true;     // Rapid features should be enabled by default

//// shader experiment:
//this._uniforms = {
// u_resolution: [300.0, 300.0],
// u_time: 0.0,
// tint: new Float32Array([1, 1, 1, 1]),
// translationMatrix: new PIXI.Matrix(),
// default: this.gfx.renderer.plugins.batch._shader.uniformGroup
//};
//
//const vert = `
//precision highp float;
//attribute vec2 aVertexPosition;
//
//uniform mat3 projectionMatrix;
//uniform mat3 translationMatrix;
//
//void main(void) {
//  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
//}
//`;
//
//const frag =`
//// varying vec2 vTextureCoord;
//// uniform sampler2D uSampler;
//// void main() {
////   // gl_FragColor *= texture2D(uSampler, vTextureCoord);
////  gl_FragColor = vec4(gl_FragCoord.x/1000.0, gl_FragCoord.y/1000.0, 0.0, 1.0);
//// }
////
//// https://thebookofshaders.com/examples/?chapter=proceduralTexture
//// Title: Cellular Noise
//
//#ifdef GL_ES
//precision mediump float;
//#endif
//
//uniform vec2 u_resolution;
//uniform float u_time;
//uniform vec4 tint;
//
//vec2 random2(vec2 p) {
//  return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*u_time);
//}
//
//float cellular(vec2 p) {
//  vec2 i_st = floor(p);
//  vec2 f_st = fract(p);
//  float m_dist = 10.;
//  for (int j=-1; j<=1; j++ ) {
//    for (int i=-1; i<=1; i++ ) {
//      vec2 neighbor = vec2(float(i),float(j));
//      vec2 point = random2(i_st + neighbor);
//      point = 0.5 + 0.5*sin(6.2831*point);
//      vec2 diff = neighbor + point - f_st;
//      float dist = length(diff);
//      if ( dist < m_dist ) {
//        m_dist = dist;
//      }
//    }
//  }
//  return m_dist;
//}
//
//void main() {
//  vec4 magenta = vec4(218.0/255.0, 38.0/255.0, 211.0/255.0, 0.7);
//  vec2 st = gl_FragCoord.xy / u_resolution.xy;
//  st.x *= u_resolution.x / u_resolution.y;
//  st *= 10.0;
//
//  float v = cellular(st);
//  gl_FragColor = vec4(vec3(v),1.0) * magenta;
//}
//`;
//
//this._customshader = new PIXI.Shader.from(vert, frag, this._uniforms);
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if at least one Rapid data service is registered
   */
  public get supported(): boolean {
    // return true if any of these are installed
    const services = this.context.services;
    return !!(services.mapwithai || services.esri || services.overture);
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the services first.
   * @return  `true` if the layer is enabled
   */
  public get enabled(): boolean {
    return this._enabled;
  }
  /** Enables or disables this layer; starts all configured Rapid data services when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const esri = context.services.esri;
    const mapwithai = context.services.mapwithai;
    const overture = context.services.overture;

    // This code is written in a way that we can work with whatever
    // data-providing services are installed.
    const services: any[] = [];
    if (esri)      services.push(esri);
    if (mapwithai) services.push(mapwithai);
    if (overture)  services.push(overture);

    if (val && services.length) {
      Promise.all(services.map(service => service.startAsync()))
        .then(() => this.gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset(): void {
    super.reset();

    const groupContainer = this.scene.groups.get('basemap')!;

    // Remove any existing containers
    for (const child of groupContainer.children) {
      if (child.label.startsWith(this.layerID + '-')) {   // 'rapid-*'
        groupContainer.removeChild(child);
        child.destroy({ children: true });  // recursive
      }
    }

    // We don't add area or line containers here - `renderDataset()` does it as needed
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const rapid = this.context.systems.rapid!;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || viewZoom < MINZOOM) return;

// shader experiment
//const offset = this.gfx.pixi.stage.position;
//const transform = this.gfx.pixi.stage.worldTransform;
//this._uniforms.translationMatrix = transform.clone().translate(-offset.x, -offset.y);
//this._uniforms.u_time = frame/10;

    for (const dataset of rapid.datasets.values()) {
      if (!rapid.enabledDatasetIDs.has(dataset.id)) continue;  // on menu but not checked
      this.renderDataset(dataset, frame, viewport);
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view.
   * @param dataset - Dataset Object
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderDataset(dataset: RapidDataset, frame: number, viewport: Viewport): void {
    const context = this.context;
    const rapid = context.systems.rapid!;
    const viewZoom = viewport.transform.zoom;

    const service = context.services[dataset.serviceID] as any;  // 'mapwithai', 'esri', 'overture'
    if (!service?.started) return;

    const useConflation = dataset.conflated;
//    const conflationOverride = utilStringQs(window.location.hash).conflation;
//    if (conflationOverride === 'false' || conflationOverride === 'no') {
//      useConflation = false;
//    }

    // Adjust the dataset id for whether we want the data conflated or not
    const datasetID = dataset.id + (useConflation ? '-conflated' : '');

    // Filter out features that have already been accepted or ignored by the user.
    const isAcceptedOrIgnored = (dataID: DataID): boolean => {
      return rapid.acceptIDs.has(dataID) || rapid.ignoreIDs.has(dataID);
    };

    // Gather data
    const renderData: RenderData = {
      points: [],
      vertices: new Set<OsmNode>(),
      lines: [],
      polygons: []
    };

    /* Facebook MapWithAI */
    if (dataset.serviceID === 'mapwithai') {
      const mapwithai = context.services.mapwithai!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        mapwithai.loadTiles(datasetID);
      }

      // Gather data in view - we only want OsmWays here
      const dsGraph = mapwithai.graph(datasetID);
      const entities = mapwithai.getData(datasetID)
        .filter((entity: OsmEntity) => entity.type === 'way' && !isAcceptedOrIgnored(entity.id)) as OsmWay[];

      // MapWithAIService gives us roads and buildings together,
      // so filter further according to which dataset we're drawing
      if (dataset.id === 'fbRoads' || dataset.id === 'rapid_intro_graph') {
        renderData.lines = entities.filter((d: OsmWay) => d.geometry(dsGraph) === 'line' && !!d.tags.highway) as OsmWay[];

        // Gather endpoint vertices, we will render these also
        for (const way of renderData.lines as OsmWay[]) {
          const first = dsGraph.entity(way.first() as EntityID) as OsmNode;
          const last = dsGraph.entity(way.last() as EntityID) as OsmNode;
          renderData.vertices.add(first);
          renderData.vertices.add(last);
        }

      } else {  // Microsoft or Esri buildings retrieved through the MapWithAI conflation service
        renderData.polygons = entities.filter((d: OsmWay) => d.geometry(dsGraph) === 'area');
      }

    /* ESRI ArcGIS */
    } else if (dataset.serviceID === 'esri') {
      const esri = context.services.esri!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        esri.loadTiles(datasetID);
      }

      // Gather data in view
      const dsGraph = esri.graph(datasetID);
      if (!dsGraph) return;
      const entities = esri.getData(datasetID);

      for (const entity of entities) {
        if (isAcceptedOrIgnored(entity.id)) continue;

        const geom = entity.geometry(dsGraph);
        if (geom === 'point') {   // standalone points only (not vertices/childnodes)
          renderData.points.push(entity as OsmNode);
        } else if (geom === 'line') {
          renderData.lines.push(entity as OsmWay);
        } else if (geom === 'area') {
          renderData.polygons.push(entity);
        }
      }

    /* Overture */
    } else if (dataset.serviceID === 'overture') {
      const overture = context.services.overture!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        overture.loadTiles(datasetID);
      }

      const data = overture.getData(datasetID);   // GeoJSONData from the VectorTileService
      for (const d of data) {
        if (isAcceptedOrIgnored(d.id)) continue;

        if (d.geoms.parts.some(part => part.type === 'Polygon')) {
          renderData.polygons.push(d);
        }
        if (d.geoms.parts.some(part => part.type === 'LineString')) {
          renderData.lines.push(d);
        }

        // The TomTom Roads dataset includes standalone points at all junctions.
        // These do not seem to have useful information in them.
        if (dataset.id !== 'overture-tomtom-roads') {
          if (d.geoms.parts.some(part => part.type === 'Point')) {
            renderData.points.push(d);
          }
        }
      }
    }

    const pointsContainer = this.scene.groups.get('points')!;
    const basemapContainer = this.scene.groups.get('basemap')!;
    const areasID = `${this.layerID}-${dataset.id}-areas`;
    const linesID = `${this.layerID}-${dataset.id}-lines`;

    let areasContainer = basemapContainer.getChildByLabel(areasID) as PIXI.Container | undefined;
    if (!areasContainer) {
      areasContainer = new PIXI.Container();
      areasContainer.label = areasID;
      areasContainer.sortableChildren = true;
      basemapContainer.addChild(areasContainer);
    }

    let linesContainer = basemapContainer.getChildByLabel(linesID) as PIXI.Container | undefined;
    if (!linesContainer) {
      linesContainer = new PIXI.Container();
      linesContainer.label = linesID;
      linesContainer.sortableChildren = true;
      basemapContainer.addChild(linesContainer);
    }

    this.renderPolygons(areasContainer, dataset, renderData, frame, viewport);
    this.renderLines(linesContainer, dataset, renderData, frame, viewport);
    this.renderPoints(pointsContainer, dataset, renderData, frame, viewport);
  }


  /**
   * Renders the polygon features for the given Rapid dataset.
   * @param parentContainer
   * @param dataset
   * @param data
   * @param frame
   * @param viewport
   */
  public renderPolygons(
    parentContainer: PIXI.Container,
    dataset: RapidDataset,
    data: RenderData,
    frame: number,
    viewport: Viewport
  ): void {
    const color = new PIXI.Color(dataset.color);
    const l10n = this.context.systems.l10n!;

    for (const d of data.polygons) {
      for (let i = 0; i < d.geoms.parts.length; ++i) {
        const part = d.geoms.parts[i];
        const featureID = `${this.layerID}-${dataset.id}-${d.id}-${i}`;
        let feature = this.features.get(featureID);

        if (!feature) {
          if (!part.world) continue;  // invalid?

          feature = new PixiFeaturePolygon(this, featureID);
          feature.geometry = part;
          const area = part.world.extent.area();
          feature.container.zIndex = -area;      // sort by area descending (small things above big things)

          feature.parentContainer = parentContainer;
          feature.data = d;
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          const colorNum = color.toNumber();
          const style: Partial<MatchedStyle> = {
            label: { color: colorNum },
            fill: { color: colorNum },
          };

          const tags = this._getTags(d);
          feature.style = style;
          feature.label = l10n.displayName(tags);
          feature.update(viewport);
        }

        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Renders the line features for the given Rapid dataset.
   * @param parentContainer
   * @param dataset
   * @param data
   * @param frame
   * @param viewport
   */
  public renderLines(
    parentContainer: PIXI.Container,
    dataset: RapidDataset,
    data: RenderData,
    frame: number,
    viewport: Viewport
  ): void {
    const color = new PIXI.Color(dataset.color);
    const l10n = this.context.systems.l10n!;

    for (const d of data.lines) {
      for (let i = 0; i < d.geoms.parts.length; i++) {
        const part = d.geoms.parts[i];
        const featureID = `${this.layerID}-${dataset.id}-${d.id}-${i}`;
        let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

        if (!feature) {
          if (!part.world) continue;  // invalid?

          feature = new PixiFeatureLine(this, featureID);
          feature.geometry = part;
          feature.parentContainer = parentContainer;
          feature.data = d;
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          const tags = this._getTags(d);

          const colorNum = color.toNumber();
          const style: Partial<MatchedStyle> = {
            casing: { color: 0x444444, width: 5, cap: 'round', join: 'round' },
            stroke: { color: colorNum, width: 3, cap: 'round', join: 'round' },
            label: { color: colorNum }
          };

          if (d instanceof OsmWay) {
            const way = d as OsmWay;
            if (way.isOneWay()) {
              style.lineMarker ??= {};
              const isAlternating = (tags.oneway === 'alternating' || tags.oneway === 'reversible');
              style.lineMarker.image = isAlternating ? 'twoway' : 'oneway';
            } else {
              delete style.lineMarker;
            }
            if (way.isSided()) {
              style.sidedMarker ??= {};
              style.sidedMarker.image = 'sided';
            } else {
              delete style.sidedMarker;
            }
          }

          feature.style = style;
          feature.label = l10n.displayName(tags);
          feature.update(viewport);
        }

        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Renders the point features for the given Rapid dataset.
   * @param parentContainer
   * @param dataset
   * @param data
   * @param frame
   * @param viewport
   */
  public renderPoints(
    parentContainer: PIXI.Container,
    dataset: RapidDataset,
    data: RenderData,
    frame: number,
    viewport: Viewport
  ): void {
    const color = new PIXI.Color(dataset.color);
    const l10n = this.context.systems.l10n!;

    const colorNum = color.toNumber();
    const pointStyle: Partial<MatchedStyle> = {
      marker: { color: colorNum, image: 'largeCircle' },
      icon: { color: colorNum, image: 'maki-circle-stroked' },
      label: { color: colorNum }
    };
    const vertexStyle: Partial<MatchedStyle> = {
      marker: { color: colorNum, image: 'smallCircle' },
      label: { color: colorNum }
    };

    for (const d of data.points) {
      const featureID = `${this.layerID}-${dataset.id}-${d.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        const part = d.geoms.parts[0];
        if (!part.world) continue;  // invalid?

        feature = new PixiFeaturePoint(this, featureID);
        feature.geometry = part;
        feature.parentContainer = parentContainer;
        feature.data = d;
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const tags = this._getTags(d);
        feature.style = pointStyle;

        feature.label = l10n.displayName(tags);

        // experiment: label addresses
        const housenumber = tags['addr:unit'] ?? tags['addr:housenumber'];
        if (!feature.label && housenumber) {
          feature.label = housenumber;
        }

        feature.update(viewport);
      }

      this.retainFeature(feature, frame);
    }

    for (const d of data.vertices) {
      const featureID = `${this.layerID}-${d.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        const part = d.geoms.parts[0];
        if (!part.world) continue;  // invalid?

        feature = new PixiFeaturePoint(this, featureID);
        feature.geometry = part;
        feature.parentContainer = parentContainer;
        feature.allowInteraction = false;   // vertices in this layer don't actually need to be interactive
        feature.data = d;
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        const tags = this._getTags(d);
        feature.style = vertexStyle;
        feature.label = l10n.displayName(tags);

        // experiment: label addresses
        const housenumber = tags['addr:unit'] ?? tags['addr:housenumber'];
        if (!feature.label && housenumber) {
          feature.label = housenumber;
        }
        feature.update(viewport);
      }

      this.retainFeature(feature, frame);
    }
  }


  /**
   * Gathers an object that looks like OsmTags from the given data.
   * @param d  The data entity (will be an OsmEntity or a GeoJSONData)
   */
  protected _getTags(d: AbstractData): OsmTags {
    if (d instanceof OsmEntity) {   // entities already have tags
      return d.tags;
    } else if (d instanceof GeoJSONData) {
      const name = d.properties['@name'];
      if (typeof name === 'string') {
        return { name };
      }
    }
    return {};
  }
}
