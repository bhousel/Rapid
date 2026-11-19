/** What one layer cost during a frame's APP pass */
export interface LayerFrameStats {
  /** Whether the layer was enabled (disabled layers still cull their features) */
  enabled: boolean;
  /** Milliseconds spent in the layer's `render()` */
  renderMs: number;
  /** Milliseconds spent in the layer's `cull()` */
  cullMs: number;
  /** Features the layer has, shown or not */
  features: number;
  /** Features the layer shows after culling */
  visible: number;
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
  /** The frame number (what layers use for `retainFeature()` and `cull()`) */
  public id: number;
  /** When the APP pass started (`performance.now()`) */
  public time: number;
  /** The map zoom the frame was drawn at */
  public zoom: number;
  /** Whether every feature was marked dirty this frame (zoom or rotation changed, or a long pan) */
  public dirtyScene: boolean;
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
    this.appMs = 0;
    this.layers = new Map<LayerID, LayerFrameStats>();
    this.draw = null;
  }


  /**
   * Milliseconds the frame spent on the CPU: its APP pass plus its DRAW pass.
   * (The two passes run in different animation frames.)
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
      appMs: this.appMs,
      layers: Object.fromEntries(this.layers),
      draw: this.draw
    };
  }
}
