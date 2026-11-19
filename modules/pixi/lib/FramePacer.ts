
/**
 * After a pass, the next one waits this many times what the pass cost (its APP and DRAW passes
 * together), so that passes take at most a third of the time. The rest is for input and for the
 * scheduler's background work.
 */
export const PASS_GAP_FACTOR = 2;

/** The longest that a pass waits for the one before it, in milliseconds, however much that one cost */
export const MAX_PASS_GAP = 250;

/**
 * How long after a pass the next one waits, in milliseconds, when nothing but a deferred redraw
 * request asks for it. Data streams in, and this lets the changes batch up.
 */
export const DEFERRED_WAIT = 250;


/**
 * `FramePacer` decides when `GraphicsSystem` may do a pass: a frame in which layers gather their
 * data and update their features, which can take from a few milliseconds to hundreds.
 * A frame that only moves the view is cheap and isn't paced: it can be drawn on every tick.
 *
 * - A pass that was asked for now (`hurry()`, from `immediateRedraw()`) doesn't wait.
 * - A pass that the view needs (it left the cull box, or the zoom changed) waits until the gap
 *   after the last pass is over. The gap grows with what that pass cost.
 * - A pass for a deferred redraw request alone waits for the gap, and at least `DEFERRED_WAIT`.
 *
 * It owns no clock: callers pass the time in (`performance.now()`).
 * See "Frame pacing" in `design/graphics-system.md`.
 */
export class FramePacer {
  /** Milliseconds that a pass waits after the last one */
  protected _gap: number;
  /** When the last pass finished (`-Infinity` before the first) */
  protected _lastPass: number;
  /** Whether a pass was asked for now */
  protected _hurried: boolean;


  /**
   * @constructor
   */
  public constructor() {
    this._gap = 0;
    this._lastPass = -Infinity;
    this._hurried = false;
  }


  /**
   * Milliseconds that a pass waits after the last one, from what that one cost.
   * @return The gap in milliseconds
   */
  public get gap(): number {
    return this._gap;
  }


  /**
   * Whether a pass was asked for now (`hurry()`), and hasn't begun yet.
   * @return `true` if the next pass doesn't wait
   */
  public get hurried(): boolean {
    return this._hurried;
  }


  /**
   * Asks for the next pass now, whatever the gap. It stays asked for until a pass begins.
   */
  public hurry(): void {
    this._hurried = true;
  }


  /**
   * Records that a pass is beginning. A `hurry()` after this is for the pass after it.
   */
  public begin(): void {
    this._hurried = false;
  }


  /**
   * How long a pass must still wait.
   * @param now - The current time (`performance.now()`)
   * @param forView - Whether the view needs the pass (it shows something no layer has features
   *   for), as opposed to a deferred redraw request alone
   * @return Milliseconds to wait, 0 if a pass may start now
   */
  public wait(now: number, forView: boolean): number {
    if (this._hurried) return 0;

    const needed = forView ? this._gap : Math.max(this._gap, DEFERRED_WAIT);
    return Math.max(0, needed - (now - this._lastPass));
  }


  /**
   * Records that a pass finished, and works out the gap before the next one.
   * @param now - The current time (`performance.now()`)
   * @param costMs - What the pass cost in milliseconds (its APP and DRAW passes together)
   */
  public passed(now: number, costMs: number): void {
    this._gap = Math.min(MAX_PASS_GAP, Math.max(0, costMs) * PASS_GAP_FACTOR);
    this._lastPass = now;
  }


  /**
   * Forgets the last pass, so the next one doesn't wait.
   */
  public reset(): void {
    this._gap = 0;
    this._lastPass = -Infinity;
    this._hurried = false;
  }
}
