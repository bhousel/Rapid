/**
 * How long after the scene was last drawn the next animation draw comes, in milliseconds, on a machine
 * that keeps up. It's a little under three ticks of a screen that shows 60 a second, so that
 * every third tick draws one: 20 a second. A selection's dashes move a pixel a draw then.
 */
export const ANIMATION_MS = 45;

/**
 * After an animation draw, the next one waits this many times as long as the browser took to
 * come back for its next tick: two and a half, so that every third tick draws one at most.
 * Where the browser comes back 60 times a second that's under `ANIMATION_MS`, and changes
 * nothing. Where the GPU needs longer than a tick for a frame, the browser comes back later,
 * and the animation slows down instead of taking all of the GPU's time.
 */
export const ANIMATION_GAP_FACTOR = 2.5;

/** The longest that an animation draw waits for the one before it, in milliseconds */
export const MAX_ANIMATION_GAP = 500;

/**
 * How long the animation goes on after anything else was last drawn, in milliseconds. Then it
 * rests until something is drawn again, so that an editor left open with something selected
 * doesn't keep the GPU busy.
 */
export const ANIMATION_REST_MS = 30000;


/**
 * `AnimationPacer` decides when `GraphicsSystem` makes an animation draw: the scene as it
 * is, drawn again only because something in it moves by itself (the glow of a hover, the
 * dashes around a selection; see `PixiScene.animate`). An animation draw costs what any DRAW
 * costs, so:
 *
 * - There's one every `ANIMATION_MS` at most, and none while other frames are being drawn
 *   that often: those move what moves too.
 * - The gap grows with how long the browser took to come back after the last one, up to
 *   `MAX_ANIMATION_GAP` (see `ANIMATION_GAP_FACTOR`).
 * - After `ANIMATION_REST_MS` in which nothing else was drawn, the animation rests. One last
 *   draw settles it (a glow at its brightest), and it goes on when something is drawn again.
 *
 * It owns no clock: callers pass the time in (`performance.now()`).
 * See section 15 of `design/graphics-system.md` (step 10, "Animation draws").
 */
export class AnimationPacer {
  /** How long the next animation draw waits after the scene was last drawn, in milliseconds */
  protected _gap: number;
  /** When the scene was last drawn, for a frame or an animation draw (`-Infinity` before the first) */
  protected _lastDraw: number;
  /** When a frame was last drawn for another reason than the clock (`-Infinity` before the first) */
  protected _lastChange: number;
  /** Whether the last tick made an animation draw, so that the next tick says what it cost */
  protected _isTiming: boolean;
  /** Whether the draw that settles the animation was made since it began to rest */
  protected _isSettled: boolean;


  /**
   * @constructor
   */
  public constructor() {
    this._gap = ANIMATION_MS;
    this._lastDraw = -Infinity;
    this._lastChange = -Infinity;
    this._isTiming = false;
    this._isSettled = false;
  }


  /**
   * Milliseconds that the next animation draw waits after the scene was last drawn.
   * @return The gap in milliseconds
   */
  public get gap(): number {
    return this._gap;
  }


  /**
   * Records a tick of the game loop. The tick after an animation draw says what that draw
   * cost: how long the browser took to come back.
   * @param deltaMS - Milliseconds since the tick before
   */
  public tick(deltaMS: number): void {
    if (!this._isTiming) return;
    this._isTiming = false;
    this._gap = Math.max(ANIMATION_MS, Math.min(MAX_ANIMATION_GAP, deltaMS * ANIMATION_GAP_FACTOR));
  }


  /**
   * Records that a frame was drawn because something changed: what moves by itself was moved
   * with it, and the animation goes on from here (again, if it was resting).
   * @param now - The current time (`performance.now()`)
   */
  public changed(now: number): void {
    this._lastDraw = now;
    this._lastChange = now;
    this._isTiming = false;
    this._isSettled = false;
  }


  /**
   * Records that an animation draw was made.
   * @param now - The current time (`performance.now()`)
   */
  public animated(now: number): void {
    this._lastDraw = now;
    this._isTiming = true;
    this._isSettled = this.isResting(now);
  }


  /**
   * Whether the animation is resting: nothing else was drawn for `ANIMATION_REST_MS`.
   * @param now - The current time (`performance.now()`)
   * @return `true` if no animation draws are made until something changes
   */
  public isResting(now: number): boolean {
    return (now - this._lastChange) >= ANIMATION_REST_MS;
  }


  /**
   * Whether an animation draw is due now: the gap after the scene was last drawn is over, or
   * the animation began to rest and the draw that settles it hasn't been made.
   * @param now - The current time (`performance.now()`)
   * @return `true` to draw one
   */
  public isDue(now: number): boolean {
    if (this.isResting(now)) return !this._isSettled;
    return (now - this._lastDraw) >= this._gap;
  }


  /**
   * Forgets what was drawn, so that the animation rests until a frame is drawn.
   */
  public reset(): void {
    this._gap = ANIMATION_MS;
    this._lastDraw = -Infinity;
    this._lastChange = -Infinity;
    this._isTiming = false;
    this._isSettled = false;
  }
}
