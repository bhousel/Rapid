import * as PIXI from 'pixi.js';

import type { DrawFrameStats, GLCallCounts, UnbatchedGraphic } from '../RenderFrame.ts';


/**
 * Reads what Pixi will draw from its instruction lists: the instructions by pipe, the textures per
 * batch, and the `Graphics` it draws on its own.
 *
 * This is the one place in Rapid that reads Pixi's internals for stats (`renderGroup.instructionSet`,
 * `renderer.graphicsContext.getGpuContext()`). They aren't public API and can change in any Pixi
 * release; the e2e test `rendering.test.js` checks that they still look the way this expects.
 * @param renderer - The Pixi renderer
 * @param root - The container whose render groups to read (the stage)
 * @param rebuilt - The render groups Pixi rebuilt in this render (from `findChangedRenderGroups`, before it)
 * @return The DRAW pass stats, without timings
 */
export function readInstructionStats(renderer: PIXI.Renderer, root: PIXI.Container, rebuilt: Set<PIXI.RenderGroup>): Omit<DrawFrameStats, 'ms'> {
  const instructions: Record<string, number> = {};
  const batchTextures: Record<number, number> = {};
  const unbatched: UnbatchedGraphic[] = [];
  const graphicsContext = (renderer as PIXI.WebGLRenderer).graphicsContext;  // WebGL and WebGPU have one
  let renderGroups = 0;
  let rebuiltInstructions = 0;
  let indices = 0;

  const groups: PIXI.RenderGroup[] = root.renderGroup ? [root.renderGroup] : [];
  while (groups.length) {
    const group = groups.pop()!;
    groups.push(...group.renderGroupChildren);
    renderGroups++;

    const set = group.instructionSet;
    if (rebuilt.has(group)) {
      rebuiltInstructions += set.instructionSize;
    }
    for (let i = 0; i < set.instructionSize; i++) {
      const instruction = set.instructions[i];
      const pipeID = instruction.renderPipeId;
      instructions[pipeID] = (instructions[pipeID] ?? 0) + 1;

      if (pipeID === 'batch') {
        const textures = (instruction as PIXI.Batch).textures?.count ?? 0;
        batchTextures[textures] = (batchTextures[textures] ?? 0) + 1;
        indices += (instruction as PIXI.Batch).size;

      } else if (pipeID === 'mesh' && instruction instanceof PIXI.Mesh) {
        indices += instruction.geometry?.indices?.length ?? 0;

      } else if (pipeID === 'graphics' && instruction instanceof PIXI.Graphics) {
        const context = instruction.context;
        const gpuContext = graphicsContext?.getGpuContext(context);
        const floats = gpuContext?.geometryData?.vertices?.length ?? 0;
        indices += gpuContext?.geometryData?.indices?.length ?? 0;
        let reason: UnbatchedGraphic['reason'] = 'unknown';
        if (context.customShader) {
          reason = 'shader';
        } else if (context.batchMode === 'no-batch') {
          reason = 'batchMode';
        } else if (gpuContext && !gpuContext.isBatchable) {
          reason = 'size';
        }
        const parentLabel = instruction.parent?.label;
        const label = parentLabel ? `${parentLabel}/${instruction.label}` : instruction.label;
        unbatched.push({ label, reason, floats });
      }
    }
  }

  unbatched.sort((a, b) => b.floats - a.floats);
  const triangles = Math.round(indices / 3);
  return { renderGroups, rebuiltGroups: rebuilt.size, rebuiltInstructions, instructions, batchTextures, triangles, unbatched };
}


/**
 * Returns the render groups whose instruction list Pixi will rebuild in the next render, because
 * something in them was added, removed, shown or hidden (`structureDidChange`). Pixi clears the flag
 * as it renders, so call this just before. Like `readInstructionStats`, this reads Pixi's internals.
 * @param root - The container whose render groups to look at (the stage)
 * @return The render groups that changed
 */
export function findChangedRenderGroups(root: PIXI.Container): Set<PIXI.RenderGroup> {
  const changed = new Set<PIXI.RenderGroup>();
  const groups: PIXI.RenderGroup[] = root.renderGroup ? [root.renderGroup] : [];
  while (groups.length) {
    const group = groups.pop()!;
    groups.push(...group.renderGroupChildren);
    if (group.structureDidChange) {
      changed.add(group);
    }
  }
  return changed;
}


/** The WebGL functions that `GLCallCounter` counts, and the count each one adds to */
const COUNTED_GL_CALLS: Record<string, keyof GLCallCounts> = {
  drawElements: 'draws',
  drawArrays: 'draws',
  drawElementsInstanced: 'draws',
  drawArraysInstanced: 'draws',
  useProgram: 'programs',
  bindTexture: 'textureBinds',
  bufferData: 'bufferUploads',
  bufferSubData: 'bufferUploads'
};


/**
 * Counts WebGL calls by wrapping the context's functions. It counts every call while installed, so
 * take a `snapshot()` before and after the work you want to measure.
 * The wrappers cost a little on every call, so install it only while someone is looking at the numbers.
 */
export class GLCallCounter {
  /** The WebGL context being counted */
  public gl: WebGL2RenderingContext | WebGLRenderingContext;
  /** Running totals since `install()` */
  protected _counts: GLCallCounts;
  /** Names of the functions we wrapped (as own properties of `gl`, shadowing the prototype's) */
  protected _wrapped: string[];


  /**
   * @param gl - The WebGL context to count calls on
   */
  public constructor(gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.gl = gl;
    this._counts = { draws: 0, programs: 0, textureBinds: 0, bufferUploads: 0 };
    this._wrapped = [];
  }


  /** Wraps the counted functions. */
  public install(): void {
    if (this._wrapped.length) return;  // already installed

    const gl = this.gl as any;
    const counts = this._counts;
    for (const [fnName, countKey] of Object.entries(COUNTED_GL_CALLS)) {
      const orig = gl[fnName];
      if (typeof orig !== 'function') continue;  // e.g. no instanced draws in WebGL1
      gl[fnName] = function(...args: unknown[]) {
        counts[countKey]++;
        return orig.apply(this, args);
      };
      this._wrapped.push(fnName);
    }
  }


  /** Removes the wrappers, so calls go straight to the prototype's functions again. */
  public uninstall(): void {
    const gl = this.gl as any;
    for (const fnName of this._wrapped) {
      delete gl[fnName];
    }
    this._wrapped = [];
  }


  /**
   * Returns a copy of the running totals.
   * @return The counts so far
   */
  public snapshot(): GLCallCounts {
    return { ...this._counts };
  }


  /**
   * Returns the calls made between two snapshots.
   * @param before - The earlier snapshot
   * @param after - The later snapshot
   * @return The difference
   */
  public static diff(before: GLCallCounts, after: GLCallCounts): GLCallCounts {
    return {
      draws: after.draws - before.draws,
      programs: after.programs - before.programs,
      textureBinds: after.textureBinds - before.textureBinds,
      bufferUploads: after.bufferUploads - before.bufferUploads
    };
  }
}


/**
 * Measures GPU time with `EXT_disjoint_timer_query_webgl2` (WebGL 2 only).
 * A query's result arrives a few frames after it ends, so `poll()` hands back the ones that are ready.
 * Queries can't nest, so only one can be running at a time.
 * Each query carries a tag of type `T`, handed back with its result (e.g. the frame it measured).
 */
export class GLTimer<T> {
  /** The WebGL 2 context */
  public gl: WebGL2RenderingContext;
  /** The timer query extension (the object holds its constants) */
  protected _ext: any;
  /** The query that's running, if any */
  protected _running: { query: WebGLQuery; tag: T } | null;
  /** Queries that have ended and are waiting for their results */
  protected _pending: { query: WebGLQuery; tag: T }[];


  /**
   * Returns a timer for the given context, or `null` if it can't measure GPU time.
   * @param gl - The WebGL context
   * @return The timer, or `null` (WebGL1, or no timer query extension)
   */
  public static create<T>(gl: WebGL2RenderingContext | WebGLRenderingContext): GLTimer<T> | null {
    if (!(globalThis.WebGL2RenderingContext && gl instanceof WebGL2RenderingContext)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    return ext ? new GLTimer<T>(gl, ext) : null;
  }


  /**
   * Use `GLTimer.create()` instead.
   * @param gl - The WebGL 2 context
   * @param ext - The timer query extension
   */
  public constructor(gl: WebGL2RenderingContext, ext: any) {
    this.gl = gl;
    this._ext = ext;
    this._running = null;
    this._pending = [];
  }


  /**
   * Starts timing the GPU work issued from now on.
   * @param tag - What to hand back with the result
   */
  public begin(tag: T): void {
    if (this._running) return;  // queries can't nest
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this._ext.TIME_ELAPSED_EXT, query);
    this._running = { query, tag };
  }


  /** Stops timing. The result arrives in a later `poll()`. */
  public end(): void {
    if (!this._running) return;
    this.gl.endQuery(this._ext.TIME_ELAPSED_EXT);
    this._pending.push(this._running);
    this._running = null;
  }


  /**
   * Collects the results that are ready, oldest first.
   * If the GPU was disjoint (e.g. it was reset, or its clock changed), the pending results are thrown out.
   * @return The finished measurements, with their tags
   */
  public poll(): { tag: T; ms: number }[] {
    const gl = this.gl;
    const results: { tag: T; ms: number }[] = [];
    const disjoint = gl.getParameter(this._ext.GPU_DISJOINT_EXT);

    while (this._pending.length) {
      const { query, tag } = this._pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;  // later ones aren't ready either
      if (!disjoint) {
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        results.push({ tag, ms: ns / 1e6 });
      }
      gl.deleteQuery(query);
      this._pending.shift();
    }
    return results;
  }


  /** Deletes any queries still running or pending. */
  public destroy(): void {
    if (this._running) {
      this.gl.endQuery(this._ext.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this._running.query);
      this._running = null;
    }
    for (const { query } of this._pending) {
      this.gl.deleteQuery(query);
    }
    this._pending = [];
  }
}
