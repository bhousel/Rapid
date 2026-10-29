import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import { AbstractData, GeoJSONData, OsmEntity, OsmNode, OsmWay } from '../data/index.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { ConflationResult, ConflationStatus, LineRun } from '../core/ConflationSystem.ts';
import type { Viewport } from '@rapid-sdk/math';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { PixiScene } from './PixiScene.ts';
import type { OsmTags } from '../data/types.ts';


/** Minimum zoom level where Rapid data is rendered */
const MINZOOM = 12;

/** Opacity of already-mapped features, when the dataset shows them */
const MATCHED_OPACITY = 0.35;

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
   * What each feature was last drawn from: its conflation result, the run it draws, or `null`.
   * When this changes, the feature is rebuilt.
   */
  protected _drawnFrom: WeakMap<AbstractPixiFeature, ConflationResult | LineRun | null>;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'rapid';
    this._enabled = true;     // Rapid features should be enabled by default
    this._drawnFrom = new WeakMap<AbstractPixiFeature, ConflationResult | LineRun | null>();

    // Conflation results change when OSM data changes or when a dataset's rules change.
    const conflation = this.context.systems.conflation;   // optional
    conflation?.on('conflationchange', () => this.gfx.deferredRedraw());

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

    for (const ds of rapid.datasets.values()) {
      if (!rapid.enabledDatasetIDs.has(ds.id)) continue;  // on menu but not checked
      this.renderDataset(ds, frame, viewport);
    }
  }


  /**
   * Render any data we have, and schedule fetching more of it to cover the view.
   * @param ds - RapidDataset Object
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderDataset(ds: RapidDataset, frame: number, viewport: Viewport): void {
    const context = this.context;
    const conflation = context.systems.conflation;   // optional
    const rapid = context.systems.rapid!;
    const viewZoom = viewport.transform.zoom;

    const service = context.services[ds.serviceID] as any;  // 'mapwithai', 'esri', 'overture'
    if (ds.serviceID && !service?.started) return;

    // Gather data
    const renderData: RenderData = {
      points: [],
      vertices: new Set<OsmNode>(),
      lines: [],
      polygons: []
    };

    /* Facebook MapWithAI */
    if (ds.serviceID === 'mapwithai') {
      const mapwithai = context.services.mapwithai!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        mapwithai.loadTiles(ds.id);
      }

      // Gather data in view - we only want OsmWays here
      const dsGraph = mapwithai.graph(ds.id);
      const entities = mapwithai.getData(ds.id)
        .filter((entity: OsmEntity) => entity.type === 'way' && !rapid.isAcceptedOrIgnored(entity.dataID)) as OsmWay[];

      // MapWithAIService gives us roads and buildings together,
      // so filter further according to which dataset we're drawing
      if (ds.id === 'fbRoads' || ds.id === 'rapid_intro_graph') {
        renderData.lines = entities.filter((d: OsmWay) => d.geometry(dsGraph) === 'line' && !!d.tags.highway) as OsmWay[];

        // Gather endpoint vertices, we will render these also
        for (const way of renderData.lines as OsmWay[]) {
          const first = dsGraph.entity(way.first() as EntityID) as OsmNode;
          const last = dsGraph.entity(way.last() as EntityID) as OsmNode;
          renderData.vertices.add(first);
          renderData.vertices.add(last);
        }

      } else {  // Legacy: Microsoft or Esri buildings retrieved through the MapWithAI conflation service
        renderData.polygons = entities.filter((d: OsmWay) => d.geometry(dsGraph) === 'area');
      }

    /* ESRI ArcGIS */
    } else if (ds.serviceID === 'esri') {
      const esri = context.services.esri!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        esri.loadTiles(ds.id);
      }

      // Gather data in view
      for (const d of esri.getData(ds.id)) {   // GeoJSONData, one geometry each
        if (rapid.isAcceptedOrIgnored(d.dataID)) continue;

        const type = d.geoms.parts[0]?.type;
        if (type === 'Point') {
          renderData.points.push(d);
        } else if (type === 'LineString') {
          renderData.lines.push(d);
        } else if (type === 'Polygon') {
          renderData.polygons.push(d);
        }
      }

    /* Overture */
    } else if (ds.serviceID === 'overture') {
      const overture = context.services.overture!;
      if (viewZoom >= 15) {  // avoid firing off too many API requests
        overture.loadTiles(ds.id);
      }

      const data = overture.getData(ds.id);   // GeoJSONData from the VectorTileService
      for (const d of data) {
        if (rapid.isAcceptedOrIgnored(d.dataID)) continue;

        if (d.geoms.parts.some(part => part.type === 'Polygon')) {
          renderData.polygons.push(d);
        }
        if (d.geoms.parts.some(part => part.type === 'LineString')) {
          renderData.lines.push(d);
        }

        // The TomTom Roads dataset includes standalone points at all junctions.
        // These do not seem to have useful information in them.
        if (ds.id !== 'overture-tomtom-roads') {
          if (d.geoms.parts.some(part => part.type === 'Point')) {
            renderData.points.push(d);
          }
        }
      }

    /* Custom */
    /* for now, custom data needs to be a data file at a url that is loaded with Rapid starts up */
    /* (this includes datasets from asset files without a serviceID) */
    } else if (!ds.serviceID) {
      const spatial = this.context.systems.spatial!;
      const data = spatial.getVisibleItems(ds.spatialID).map(hit => hit.contents as GeoJSONData);
      for (const d of data) {
        if (rapid.isAcceptedOrIgnored(d.dataID)) continue;

        if (d.geoms.parts.some(part => part.type === 'Polygon')) {
          renderData.polygons.push(d);
        }
        if (d.geoms.parts.some(part => part.type === 'LineString')) {
          renderData.lines.push(d);
        }
        if (d.geoms.parts.some(part => part.type === 'Point')) {
          renderData.points.push(d);
        }
      }
    }

    // Hide already-mapped points and areas.
    // (Lines are handled in `renderLines`, because a partly mapped line is drawn as its runs.)
    if (conflation && !ds.conflation.showMatched) {
      const isMatched = (d: AbstractData) => conflation.getResult(ds, d)?.status === 'matched';
      renderData.points = renderData.points.filter(d => !isMatched(d));
      renderData.polygons = renderData.polygons.filter(d => !isMatched(d));
    }

    const pointsContainer = this.scene.groups.get('points')!;
    const basemapContainer = this.scene.groups.get('basemap')!;
    const areasID = `${this.layerID}-${ds.id}-areas`;
    const linesID = `${this.layerID}-${ds.id}-lines`;

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

    this.renderPolygons(areasContainer, ds, renderData, frame, viewport);
    this.renderLines(linesContainer, ds, renderData, frame, viewport);
    this.renderPoints(pointsContainer, ds, renderData, frame, viewport);
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
   * If conflation is on for the dataset, already-mapped lines are hidden (or muted), lines that need
   * review are highlighted, and partly mapped lines are drawn as their separate runs.
   * @param parentContainer - The Pixi container to draw the lines into
   * @param dataset - The Rapid dataset being drawn
   * @param data - The dataset's data in view, sorted by geometry type
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public renderLines(
    parentContainer: PIXI.Container,
    dataset: RapidDataset,
    data: RenderData,
    frame: number,
    viewport: Viewport
  ): void {
    const context = this.context;
    const conflation = context.systems.conflation;   // optional
    const l10n = context.systems.l10n!;

    const colorNum = new PIXI.Color(dataset.color).toNumber();
    const showMatched = dataset.conflation.showMatched;

    for (const d of data.lines) {
      // A line is drawn as its runs unless it's one run that covers all of it. That includes a line
      // the user has acted on part of (what's left of it), or all of it (no runs, so nothing is drawn).
      const result = conflation?.getResult(dataset, d);
      const runs = result?.runs;
      const isWhole = runs?.length === 1 && runs[0].range[0] === 0 && runs[0].range[1] === 1;
      if (runs && !isWhole) {
        this._renderRuns(parentContainer, dataset, d, runs, frame, viewport);
        continue;
      }

      const status = result?.status;
      if (status === 'matched' && !showMatched) continue;

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

        // Restyle if the conflation result has changed since this feature was drawn.
        const drawnFrom = result ?? null;
        if (this._drawnFrom.get(feature) !== drawnFrom) {
          this._drawnFrom.set(feature, drawnFrom);
          feature.dirty = true;
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          const tags = this._getTags(d);
          const style = this._lineStyle(colorNum, status);

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
   * Draws a partly mapped (or partly accepted) line as its separate runs, one feature per run.
   * A run that isn't already mapped is bound to its own data (`LineRun.datum`), so selecting it selects
   * just that stretch, and accepting it adds just that stretch. Already-mapped runs are bound to the line.
   * @param parentContainer - The Pixi container to draw the runs into
   * @param dataset - The Rapid dataset being drawn
   * @param d - The line's data
   * @param runs - The line's runs, in order
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  protected _renderRuns(
    parentContainer: PIXI.Container,
    dataset: RapidDataset,
    d: AbstractData,
    runs: LineRun[],
    frame: number,
    viewport: Viewport
  ): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const colorNum = new PIXI.Color(dataset.color).toNumber();
    const showMatched = dataset.conflation.showMatched;

    // (Runs that the user already accepted or ignored aren't here, see `ConflationSystem._conflateLine`.)
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.status === 'matched' && !showMatched) continue;

      const featureID = `${this.layerID}-${dataset.id}-${d.id}-run${i}`;
      let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

      if (!feature) {
        feature = new PixiFeatureLine(this, featureID);
        feature.parentContainer = parentContainer;
      }

      // Results are recomputed after edits, so the run at this index may have changed.
      // A run that isn't already mapped is bound to its own data, so it can be selected and accepted
      // on its own. An already-mapped run is bound to the whole line.
      if (this._drawnFrom.get(feature) !== run) {
        this._drawnFrom.set(feature, run);
        const part = new GeometryPart(context);
        part.setData({ type: 'LineString', coordinates: run.coords });
        feature.geometry = part;
        feature.data = run.datum ?? d;
        feature.dirty = true;
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        feature.style = this._lineStyle(colorNum, run.status);
        feature.label = l10n.displayName(this._getTags(d));
        feature.update(viewport);
      }

      this.retainFeature(feature, frame);
    }
  }


  /**
   * Returns the style for a Rapid line, depending on its conflation status.
   * @param colorNum - The dataset's color
   * @param status - The line's (or run's) conflation status, if conflation is on
   * @return The style
   */
  protected _lineStyle(colorNum: number, status?: ConflationStatus): Partial<MatchedStyle> {
// for now, don't adjust style per conflation status
//    if (status === 'matched') {   // only drawn if the dataset shows already-mapped features
//      return {
//        casing: { opacity: 0 },
//        stroke: { color: colorNum, width: 3, opacity: MATCHED_OPACITY, cap: 'round', join: 'round' },
//        label: { color: colorNum, opacity: MATCHED_OPACITY }
//      };
//    }
    return {
      casing: { color: 0x444444, width: 5, cap: 'round', join: 'round' },
      stroke: { color: colorNum, width: 3, cap: 'round', join: 'round' },
      label: { color: colorNum }
    };
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
        const housenumber = tags['addr_unit'] ?? tags['addr_housenumber'];
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
        const housenumber = tags['addr_unit'] ?? tags['addr_housenumber'];
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
