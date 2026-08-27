import { utilArrayDifference, utilArrayUniq } from '@rapid-sdk/util';
import { createOsmEntity } from '../../data/index.ts';
import { localize } from './helper.ts';
import { uiIcon } from '../icon.ts';
import { UiCurtain } from './UiCurtain.ts';

import { UiIntroWelcome } from './UiIntroWelcome.ts';
import { UiIntroNavigation } from './UiIntroNavigation.ts';
import { UiIntroPoint } from './UiIntroPoint.ts';
import { UiIntroArea } from './UiIntroArea.ts';
import { UiIntroLine } from './UiIntroLine.ts';
import { UiIntroBuilding } from './UiIntroBuilding.ts';
import { UiIntroStartEditing } from './UiIntroStartEditing.ts';
import { UiIntroRapid } from './UiIntroRapid.ts';

import type { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


type ChapterConstructor = new (context: Context, curtain: UiCurtain) => AbstractIntroChapter;

const chapterUi: Record<string, ChapterConstructor> = {
  welcome: UiIntroWelcome,
  navigation: UiIntroNavigation,
  point: UiIntroPoint,
  area: UiIntroArea,
  line: UiIntroLine,
  building: UiIntroBuilding,
  rapid: UiIntroRapid,
  startEditing: UiIntroStartEditing
};

const chapterFlow = [
  'welcome',
  'navigation',
  'point',
  'area',
  'line',
  'building',
  'rapid',
  'startEditing'
];


/**
 * `UiIntro` orchestrates the walkthrough: it pauses the live systems, saves and restores app state,
 * loads the tutorial graph data, builds the chapter navigation bar, and enters/exits the chapters.
 *
 * Like the chapters, this is a stateful controller rather than an idempotent `render($parent)`
 * component - call `start($parent)` to launch the walkthrough.
 */
export class UiIntro {
  public context: Context;

  protected _introGraph: any;
  protected _rapidGraph: any;
  protected _original: any;
  protected _resume: any;
  protected _progress: string[];
  protected _currChapter: AbstractIntroChapter | null;

  // Child Components
  public Curtain: UiCurtain | null;

  // D3 Selections
  public $buttons: D3Selection | null;
  public $navwrap: D3Selection | null;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._introGraph = {};
    this._rapidGraph = {};
    this._original = {};
    this._resume = {};
    this._progress = [];
    this._currChapter = null;

    // Child Components
    this.Curtain = null;

    // D3 Selections
    this.$buttons = null;
    this.$navwrap = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.start = this.start.bind(this);
    this._enterChapter = this._enterChapter.bind(this);
  }


  /**
   * Start the walkthrough. Loads the tutorial graph data, then launches the walkthrough into the
   * given parent selection.
   * @param skipToRapid  - `true` to start on the Rapid chapter (used by the Rapid splash screen)
   */
  public start(skipToRapid = false): void {
    const context = this.context;
    const assets = context.systems.assets!;

    Promise.all([
      assets.loadAssetAsync('intro_rapid_graph'),
      assets.loadAssetAsync('intro_graph')
    ])
    .then(values => {
      const rapidData = (values[0] as any).introRapidGraph;
      const introData = (values[1] as any).introGraph;

      for (const [id, data] of Object.entries(rapidData)) {
        if (!this._rapidGraph[id]) {
          this._rapidGraph[id] = createOsmEntity(context, localize(context, data));
        }
      }
      for (const [id, data] of Object.entries(introData)) {
        if (!this._introGraph[id]) {
          this._introGraph[id] = createOsmEntity(context, localize(context, data));
        }
      }

      this._startIntro(skipToRapid);
    });
  }


  /**
   * After the walkthrough data has been loaded, this starts the walkthrough.
   * @param skipToRapid  - `true` to start on the Rapid chapter
   */
  protected _startIntro(skipToRapid: boolean): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;
    const mapwithai = context.services.mapwithai;
    const osm = context.services.osm;
    const rapid = context.systems.rapid!;
    const scene = context.systems.gfx!.scene!;
    const settings = context.systems.settings;
    const ui = context.systems.ui!;
    const urlhash = context.systems.urlhash!;
    const $container = context.$container;

    // Pause several systems, preserving the resume functions.
    this._resume = {
      urlhash:    urlhash.pause(),       // disable updates
      osm:        osm?.pause(),          // disable network
      mapwithai:  mapwithai?.pause()     // disable network
    };

    $container.classed('inIntro', true);
    context.inIntro = true;
    context.enter('browse');

    // Save current state
    this._original = {
      hash: window.location.hash,
      transform: context.viewport.transform.props,
      brightness: imagery.brightness,
      baseLayer: imagery.baseLayerSource(),
      overlayLayers: imagery.overlayLayerSources(),
      layersEnabled: new Set(),                            // Set<layerID>
      datasetsAdded: new Set(rapid.addedDatasetIDs),       // Set<datasetID>
      datasetsEnabled: new Set(rapid.enabledDatasetIDs),   // Set<datasetID>
      edits: editor.toJSON()
    };

    // Remember which layers were enabled before, enable only certain ones in the walkthrough.
    for (const [layerID, layer] of scene.layers) {
      if (layer.enabled) {
        this._original.layersEnabled.add(layerID);
      }
    }
    scene.onlyLayers(['background', 'osm', 'labels']);

    // Show only a fake walkthrough dataset
    rapid.removeDatasets(rapid.addedDatasetIDs);
    rapid.addDatasets('rapid_intro_graph');

    // Setup imagery
    const introSource = imagery.getSourceByID('Bing');
    imagery.baseLayerSource(introSource);
    this._original.overlayLayers.forEach((d: any) => imagery.toggleOverlayLayer(d));
    imagery.brightness = 1;

    ui.Sidebar.expand(false);   // false = no animation
    this.Curtain = new UiCurtain(context);
    $container.call(this.Curtain.enable);

    // Store that the user started the walkthrough..
    settings?.set('ui.walkthrough.started', 'yes');

    // Restore previous walkthrough progress..
    const storedProgress = settings?.get('ui.walkthrough.progress') || '';
    this._progress = storedProgress.split(';').filter(Boolean);

    // Create the chapters
    const chapters = chapterFlow.map((chapterID, i) => {
      const chapter = new chapterUi[chapterID](context, this.Curtain!);
      chapter.on('done', () => {    // When completing each chapter..
        this.$buttons!
          .filter((d: any) => d.title === chapter.title)
          .classed('finished', true);

        // Store walkthrough progress..
        this._progress.push(chapterID);
        settings?.set('ui.walkthrough.progress', utilArrayUniq(this._progress).join(';'));

        if (i < chapterFlow.length - 1) {
          const nextID = chapterFlow[i + 1];
          $container.select(`button.chapter-${nextID}`)
            .classed('next', true);
        } else {
          this._finish();
        }
      });
      return chapter;
    });


    this.$navwrap = $container
      .append('div')
      .attr('class', 'intro-nav-wrap fillD');

    this.$navwrap
      .append('svg')
      .attr('class', 'intro-nav-wrap-logo')
      .append('use')
      .attr('xlink:href', '#rapid-logo-walkthrough');

    const buttonwrap = this.$navwrap
      .append('div')
      .attr('class', 'joined')
      .selectAll('button.chapter');

    this.$buttons = buttonwrap
      .data(chapters)
      .enter()
      .append('button')
      .attr('class', (d: any, i: number) => `chapter chapter-${chapterFlow[i]}`)
      .on('click', this._enterChapter);

    this.$buttons
      .append('span')
      .text((d: any) => l10n.t(d.title));

    this.$buttons
      .append('span')
      .attr('class', 'status')
      .call(uiIcon(l10n.isRTL ? '#rapid-icon-backward' : '#rapid-icon-forward', 'inline'));


    // Reset, then load the data into the editor and start.
    context.resetAsync()
      .then(() => {
        editor.merge(Object.values(this._introGraph));
        mapwithai?.merge('rapid_intro_graph', Object.values(this._rapidGraph));
        editor.setCheckpoint('initial');
        this._enterChapter(undefined, chapters[skipToRapid ? 6 : 0]);
      });
  }


  /**
   * Call this to enter a new chapter.
   * Either called explicitly or by clicking a button in the chapter navigation bar.
   * @param [e]           - If clicked on a button, the click event (not used)
   * @param newChapter  - The chapter to enter
   */
  protected _enterChapter(e: Event | undefined, newChapter: AbstractIntroChapter): void {
    const context = this.context;

    if (this._currChapter) this._currChapter.exit();
    context.enter('browse');

    this._currChapter = newChapter;
    this._currChapter.enter();

    this.$buttons!
      .classed('next', false)
      .classed('active', (d: any) => d.title === this._currChapter!.title);
  }


  /**
   * Cleanup, restore state, and leave the walkthrough.
   */
  protected _finish(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const imagery = context.systems.imagery!;
    const map = context.systems.map!;
    const rapid = context.systems.rapid!;
    const scene = context.systems.gfx!.scene!;
    const settings = context.systems.settings;

    // Store if walkthrough is completed..
    const incomplete = utilArrayDifference(chapterFlow, this._progress);
    if (!incomplete.length) {
      settings?.set('ui.walkthrough.completed', 'yes');
    }

    // Restore Rapid datasets and service
    rapid.removeDatasets('rapid_intro_graph');
    rapid.addDatasets(this._original.datasetsAdded);       // added to menu
    rapid.enableDatasets(this._original.datasetsEnabled);  // enabled/checked

    this.Curtain!.disable();
    this.$navwrap!.remove();

    // Restore Map State
    for (const [layerID, layer] of scene.layers) {
      layer.enabled = this._original.layersEnabled.has(layerID);
    }
    imagery.baseLayerSource(this._original.baseLayer);
    this._original.overlayLayers.forEach((d: any) => imagery.toggleOverlayLayer(d));
    imagery.brightness = this._original.brightness;
    map.transform(this._original.transform);
    window.location.replace(this._original.hash);

    context.$container.classed('inIntro', false);
    context.inIntro = false;

    // Resume paused systems
    this._resume.osm?.();
    this._resume.mapwithai?.();
    this._resume.urlhash();

    // Reset, then restore the user's edits, if any...
    context.resetAsync()
      .then(() => {
        if (this._original.edits) {
          return editor.fromJSONAsync(this._original.edits);
        } else {
          return Promise.resolve();
        }
      });
  }
}
