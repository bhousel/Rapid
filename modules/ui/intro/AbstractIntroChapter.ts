import { EventEmitter } from 'tseep/lib/ee-safe';

import type { Context } from '../../Context.ts';
import type { UiCurtain } from './UiCurtain.ts';


/**
 * An `IntroStep` is one step of a walkthrough chapter. It performs some setup, waits for the user
 * to do the right thing, then resolves to the *next* `IntroStep` to run (or `void` when the chapter
 * is finished). Steps are methods on the chapter, invoked by `_runAsync` with the chapter as `this`.
 */
export type IntroStep = () => Promise<IntroStep | void>;


/**
 * `AbstractIntroChapter` is the shared base for the walkthrough chapters.
 *
 * Unlike normal `modules/ui` components, a chapter is a small state machine, not an idempotent
 * `render($parent)` component. The base owns the machinery every chapter needs:
 *  - a `title` and a `'done'` event (emitted via `EventEmitter`; listen with `on('done')`)
 *  - the `enter()` / `exit()` / `restart()` lifecycle
 *  - an async step runner (`_runAsync`) that advances through the steps a chapter returns
 *  - four event-wait hooks (`_onModeChange`, `_onStableChange`, `_onStagingChange`, `_onMapMove`)
 *    wired once as listener proxies in `enter()` and torn down in `finally`. A step sets the hooks
 *    it needs (e.g. `this._onModeChange = () => resolve(this._nextStep)`); unused hooks stay null.
 *
 * A subclass sets `this.title`, implements `_firstStep()`, and implements its `_stepAsync()` methods.
 */
export abstract class AbstractIntroChapter extends EventEmitter {
  public context: Context;

  /** The chapter's title (an l10n string id) - set by the subclass. */
  public title: string;

  protected _curtain: UiCurtain;

  /** `true` once `exit()` has been called, so the step runner bails out. */
  protected _cancelled: boolean;

  /** When set, calling this rejects the in-flight step so `exit()` can interrupt a chapter. */
  protected _rejectStep: (() => void) | null;

  // Event-wait hooks - a step assigns the ones it needs; the listener proxies call them.
  protected _onModeChange: ((...args: any[]) => void) | null;
  protected _onStableChange: ((...args: any[]) => void) | null;
  protected _onStagingChange: ((...args: any[]) => void) | null;
  protected _onMapMove: ((...args: any[]) => void) | null;


  /**
   * @param context - Global shared application context
   * @param curtain - `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super();
    this.context = context;
    this._curtain = curtain;
    this.title = '';   // subclass overrides

    this._cancelled = false;
    this._rejectStep = null;
    this._onModeChange = null;
    this._onStableChange = null;
    this._onStagingChange = null;
    this._onMapMove = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.enter = this.enter.bind(this);
    this.exit = this.exit.bind(this);
    this.restart = this.restart.bind(this);
    this._modeChangeListener = this._modeChangeListener.bind(this);
    this._stableChangeListener = this._stableChangeListener.bind(this);
    this._stagingChangeListener = this._stagingChangeListener.bind(this);
    this._mapMoveListener = this._mapMoveListener.bind(this);
  }


  /**
   * The first step to run when the chapter is entered.
   * @return The chapter's first `IntroStep`
   */
  protected abstract _firstStep(): IntroStep;


  /**
   * Enter the chapter: reset state, wire the event-wait listeners, and run the step machine.
   * Listeners are torn down when the run settles (completed or interrupted).
   */
  public enter(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;

    this._cancelled = false;
    this._rejectStep = null;
    this._onModeChange = null;
    this._onStableChange = null;
    this._onStagingChange = null;
    this._onMapMove = null;

    context.on('modechange', this._modeChangeListener);
    editor.on('stablechange', this._stableChangeListener);
    editor.on('stagingchange', this._stagingChangeListener);
    map.on('move', this._mapMoveListener);

    this._runAsync(this._firstStep())
      .catch(e => { if (e instanceof Error) console.error(e); })   // eslint-disable-line no-console
      .finally(() => {
        context.off('modechange', this._modeChangeListener);
        editor.off('stablechange', this._stableChangeListener);
        editor.off('stagingchange', this._stagingChangeListener);
        map.off('move', this._mapMoveListener);
      });
  }


  /**
   * Exit the chapter, interrupting whatever step is in flight.
   */
  public exit(): void {
    this._cancelled = true;

    if (this._rejectStep) {   // bail out of whatever step we are in
      this._rejectStep();
      this._rejectStep = null;
    }
  }


  /**
   * Exit and re-enter the chapter from the beginning.
   */
  public restart(): void {
    this.exit();
    this.enter();
  }


  /**
   * The async step runner. Runs the current step, awaits it, and advances to the step it returns.
   * On cancel it stops; on error it logs and retries the same step (preserving the original,
   * deliberately forgiving behavior).
   * @param step - The step to run (or `void` when there is nothing left to do)
   */
  protected async _runAsync(step?: IntroStep | void): Promise<void> {
    let currStep = step;
    while (typeof currStep === 'function') {
      if (this._cancelled) return;
      try {
        currStep = await currStep.call(this);
      } catch (e) {
        if (e instanceof Error) console.error(e);   // eslint-disable-line no-console
        // otherwise retry the same step on the next loop
      }
    }
  }


  /**
   * Emit the `'done'` event to signal the chapter is complete.
   */
  protected _done(): void {
    this.emit('done');
  }


  /** Proxies the `modechange` event to the current `_onModeChange` hook (if any). */
  protected _modeChangeListener(...args: any[]): void {
    this._onModeChange?.(...args);
  }

  /** Proxies the editor `stablechange` event to the current `_onStableChange` hook (if any). */
  protected _stableChangeListener(...args: any[]): void {
    this._onStableChange?.(...args);
  }

  /** Proxies the editor `stagingchange` event to the current `_onStagingChange` hook (if any). */
  protected _stagingChangeListener(...args: any[]): void {
    this._onStagingChange?.(...args);
  }

  /** Proxies the map `move` event to the current `_onMapMove` hook (if any). */
  protected _mapMoveListener(...args: any[]): void {
    this._onMapMove?.(...args);
  }
}
