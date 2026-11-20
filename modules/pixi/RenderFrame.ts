import { Extent } from '@rapid-sdk/math';


/** What a layer did for a frame, recorded by the layer and its features as they work */
export interface LayerWork {
  /** Features made */
  created: number;
  /** Features destroyed */
  destroyed: number;
  /** Features rebuilt because they were dirty (new ones included) */
  updated: number;
  /** Features that went from hidden to shown */
  shown: number;
  /** Features that went from shown to hidden */
  hidden: number;
  /**
   * Milliseconds spent in each step of the layer's `render()`, for layers that time their steps
   * (e.g. the OSM layer's `gather`, `filter`, `polygons`, `lines`, …)
   */
  steps: Record<string, number>;
}

/** What one layer cost during a frame's APP pass */
export interface LayerFrameStats extends LayerWork {
  /** Whether the layer was enabled (disabled layers still cull their features) */
  enabled: boolean;
  /**
   * Whether the layer left its features as the last frame had them, because only the view moved,
   * within the frame's cull box (see "A CULL pass" in `design/graphics-system.md`)
   */
  kept: boolean;
  /** Milliseconds spent in the layer's `render()` */
  renderMs: number;
  /** Milliseconds spent in the layer's `cull()` */
  cullMs: number;
  /** Features the layer has, shown or not */
  features: number;
  /** Features the layer shows after culling */
  visible: number;
  /**
   * Work the layer put off to a later frame: features still to be drawn again, or for the labels,
   * 1 while placement is waiting (see "A deadline on the frame" in `design/graphics-system.md`)
   */
  waiting: number;
}

/** A `Graphics` that Pixi drew on its own instead of in a batch */
export interface UnbatchedGraphic {
  /** The `Graphics`' label, after its parent's (e.g. `osm-w123-0/casing`) */
  label: string;
  /**
   * Why Pixi didn't batch it:
   * - `size`: its geometry has 400 floats (200 vertices) or more
   * - `shader`: its context has a custom shader
   * - `batchMode`: its context's `batchMode` says not to
   * - `unknown`: anything else, e.g. a renderer without GPU contexts
   */
  reason: 'size' | 'shader' | 'batchMode' | 'unknown';
  /** Length of its vertex array (x and y for each vertex) */
  floats: number;
}

/** What a frame's DRAW pass cost, and what Pixi drew */
export interface DrawFrameStats {
  /** Milliseconds spent in `pixi.render()` (CPU) */
  ms: number;
  /** Render groups under the stage (each has its own instruction list) */
  renderGroups: number;
  /** Render groups whose instruction list Pixi rebuilt this frame, because something in them changed */
  rebuiltGroups: number;
  /** Instructions in the lists that were rebuilt */
  rebuiltInstructions: number;
  /** Instructions in Pixi's instruction lists, by the pipe that runs them (`batch`, `graphics`, `stencilMask`, …) */
  instructions: Record<string, number>;
  /** Drawables merged into `batch` instructions, by how many textures their batch used */
  batchTextures: Record<number, number>;
  /** The `Graphics` drawn on their own, biggest first */
  unbatched: UnbatchedGraphic[];
  /** WebGL calls made during `pixi.render()`, only while detailed stats are on */
  gl?: GLCallCounts;
  /** GPU milliseconds for `pixi.render()`, only while detailed stats are on. Arrives a few frames later. */
  gpuMs?: number;
}

/** WebGL calls counted during a DRAW pass */
export interface GLCallCounts {
  /** `drawElements`, `drawArrays` and their instanced versions */
  draws: number;
  /** `useProgram` (shader switches) */
  programs: number;
  /** `bindTexture` */
  textureBinds: number;
  /** `bufferData` and `bufferSubData` (uploads to the GPU) */
  bufferUploads: number;
}


/**
 * A `RenderFrame` is one frame of the map: its number, and what we learn about it while it is made.
 * The APP pass fills in what Rapid did (time per layer, feature counts), and the DRAW pass fills in what
 * Pixi did (its instructions, and with detailed stats on, WebGL calls and GPU time).
 * `GraphicsSystem` keeps the last few, so scripts and the UI can ask what recent frames cost.
 * See "Frame stats" in `design/graphics-system.md`.
 */
export class RenderFrame {
  /** The frame number */
  public id: number;
  /** When the APP pass started (`performance.now()`) */
  public time: number;
  /** The map zoom the frame was drawn at */
  public zoom: number;
  /** Whether every feature was marked dirty this frame (zoom or rotation changed, or a long pan) */
  public dirtyScene: boolean;
  /**
   * Whether something asked for this frame without naming a layer (`deferredRedraw()` or
   * `immediateRedraw()`), or the whole scene is dirty. Then every layer has to do its work.
   * Layers ask `changedFor()`.
   */
  public contentChanged: boolean;
  /**
   * Whether something asked for this frame without naming a layer. Unlike `contentChanged`, a
   * new zoom or rotation alone doesn't count. Layers ask `requestedFor()`.
   */
  public requested: boolean;
  /** The layers that a redraw was requested for by name (e.g. the imagery, when a tile arrives) */
  public changedLayerIDs: Set<LayerID>;
  /**
   * The part of the world to have features ready for, in world coordinates: the view and some
   * padding around it. It stays the same object while the view moves around inside it, so a layer
   * can tell that it already has what this frame needs (see `PixiScene.updateCullBox`).
   */
  public cullBox: Extent;
  /**
   * Whether a pass was wanted (a redraw was requested, or the view left the cull box) and was held
   * back until the gap after the last pass is over. A held frame only moves the view: layers are
   * told nothing changed and get the cull box they had (see `FramePacer`).
   */
  public held: boolean;
  /** The part of the world in view, in world coordinates: the cull box without its padding */
  public viewBox: Extent;
  /**
   * When the APP pass should stop taking on work that can wait (`performance.now()`). Layers ask
   * `hasTime()`. What can wait: drawing a feature again that isn't in view, or that is but isn't
   * needed at once (see `urgent`), and placing labels.
   */
  public deadline: number;
  /**
   * Whether the user did something that asked for this frame (`immediateRedraw()`). Then what
   * changed in view is drawn in this frame, whatever the time.
   */
  public urgent: boolean;
  /**
   * Milliseconds that the DRAW pass is expected to spend on the features drawn in this APP pass
   * so far. Drawing a feature costs little in the APP pass: Pixi builds its geometry in the DRAW
   * pass, where a feature drawn for the first time costs about ten times one drawn again. Layers
   * add to this as they draw (see `AbstractPixiLayer.updateFeature`), and `hasTime()` counts it.
   */
  public drawDebt: number;
  /** Features in view that layers have put off making or drawing again so far in this frame (labels wait for them) */
  public waitingInView: number;
  /** Whether a layer put work off to a later frame, so that another frame should follow this one */
  public unfinished: boolean;
  /** Milliseconds spent in the APP pass */
  public appMs: number;
  /** What each layer cost during the APP pass */
  public layers: Map<LayerID, LayerFrameStats>;
  /** What the DRAW pass cost, or `null` until it has run */
  public draw: DrawFrameStats | null;


  /**
   * @param id - The frame number
   * @param zoom - The map zoom the frame is drawn at
   */
  public constructor(id: number, zoom: number) {
    this.id = id;
    this.time = performance.now();
    this.zoom = zoom;
    this.dirtyScene = false;
    this.contentChanged = true;
    this.requested = true;
    this.changedLayerIDs = new Set<LayerID>();
    this.cullBox = new Extent();
    this.held = false;
    this.viewBox = new Extent();
    this.deadline = Infinity;
    this.urgent = false;
    this.drawDebt = 0;
    this.waitingInView = 0;
    this.unfinished = false;
    this.appMs = 0;
    this.layers = new Map<LayerID, LayerFrameStats>();
    this.draw = null;
  }


  /**
   * Whether what the given layer draws may have changed since the last frame. `false` means that as
   * far as this layer goes, the only thing that changed is the view.
   * @param layerID - The layer asking
   * @return `true` if a redraw was requested for the whole scene or for this layer
   */
  public changedFor(layerID: LayerID): boolean {
    return this.contentChanged || this.changedLayerIDs.has(layerID);
  }


  /**
   * Whether a redraw was requested for the given layer, or for everything. When `changedFor()` is
   * `true` and this is `false`, the layer's data is what it was, and only how it's drawn changed:
   * the view has a new zoom or rotation.
   * @param layerID - The layer asking
   * @return `true` if a redraw was requested for the whole scene or for this layer
   */
  public requestedFor(layerID: LayerID): boolean {
    return this.requested || this.changedLayerIDs.has(layerID);
  }


  /**
   * Whether the APP pass still has time for work that can wait (see `deadline`).
   * The DRAW pass's share counts too: what the features drawn so far will cost there (`drawDebt`)
   * is time this frame has already spent.
   * @return `true` if the deadline hasn't passed
   */
  public hasTime(): boolean {
    return performance.now() + this.drawDebt < this.deadline;
  }


  /**
   * Milliseconds the frame spent on the CPU: its APP pass plus its DRAW pass.
   * (The two passes run in the same animation frame when the APP pass was quick, or else in two.)
   * @return Total CPU milliseconds
   */
  public get cpuMs(): number {
    return this.appMs + (this.draw?.ms ?? 0);
  }


  /**
   * Returns a plain object with the frame's stats, suitable for JSON (e.g. from `bun run cdp eval`).
   * @return The frame's stats
   */
  public toJSON(): object {
    return {
      id: this.id,
      zoom: this.zoom,
      dirtyScene: this.dirtyScene,
      contentChanged: this.contentChanged,
      changedLayerIDs: [...this.changedLayerIDs],
      cullBox: this.cullBox.rectangle(),
      held: this.held,
      urgent: this.urgent,
      unfinished: this.unfinished,
      appMs: this.appMs,
      layers: Object.fromEntries(this.layers),
      draw: this.draw
    };
  }
}
