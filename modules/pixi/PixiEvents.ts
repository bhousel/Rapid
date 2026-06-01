import * as PIXI from 'pixi.js';
import { EventEmitter } from 'tseep';
import { vecRotate } from '@rapid-sdk/math';
import { utilDetect } from '../util/detect.ts';

import type { Context } from '../Context.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Coordinate data containing screen and map positions */
export interface CoordData {
  /** Screen coordinates where [0,0] is top-left of the screen */
  screen: Vec2;
  /** Map coordinates where [0,0] is the origin of the viewport (rotation removed) */
  map: Vec2;
  /** World coordinate where [0,0] is world origin */
  world: Vec2;
}

/** Extended WheelEvent with normalized delta values */
export interface NormalizedWheelEvent extends WheelEvent {
  _gesture: 'zoom' | 'pan';
  _normalizedDeltaX: number;
  _normalizedDeltaY: number;
  _coord: CoordData;
}


/**
 * PixiEvents does the work of managing the events that other parts of the code are interested in.
 * We bind them once here and dispatch them so that other code can do less work.
 *
 * Properties available:
 * - `enabled`              `true` if the event handlers are enabled, `false` if not.
 * - `coord`                `[x,y]` coordinates of the latest event (provided in "screen", "map", and "world")
 * - `pointerOverRenderer`  `true` if the pointer is over the renderer, `false` if not
 * - `modifierKeys`         Set containing the modifier keys that are currently down ('Alt', 'Control', 'Meta', 'Shift')
 *
 * Events available:
 * - `click`             Fires on stage.click, receives a Pixi FederatedPointerEvent
 * - `keydown`           Fires on window.keydown, receives a DOM KeyboardEvent
 * - `keyup`             Fires on window.keyup, receives a DOM KeyboardEvent
 * - `modifierchange`    Fires when any modifier key is changed, receives the updated modifierKeys Set
 * - `pointercancel`     Fires on stage.pointercancel, receives a Pixi FederatedPointerEvent
 * - `pointerdown`       Fires on stage.pointerdown, receives a Pixi FederatedPointerEvent
 * - `pointermove`       Fires on stage.pointermove, receives a Pixi FederatedPointerEvent
 * - `pointerout`        Fires on canvas.pointerout, receives a DOM PointerEvent
 * - `pointerover`       Fires on canvas.pointerover, receives a DOM PointerEvent
 * - `pointerup`         Fires on stage.pointerup, receives a Pixi FederatedPointerEvent
 * - `wheel`             Fires on supersurface.wheel, receives a DOM WheelEvent + some properties containing normalized wheel delta values
 */
export class PixiEvents extends EventEmitter {
  /** Reference to the owning GraphicsSystem */
  public gfx: GraphicsSystem;
  /** Global shared application context */
  public context: Context;
  /** Whether the pointer is currently over the Pixi renderer canvas */
  public pointerOverRenderer: boolean;
  /** Set of currently held modifier keys (e.g. 'Alt', 'Control', 'Meta', 'Shift') */
  public modifierKeys: Set<string>;
  /** Most recently seen pointer coordinates in screen, map, and world space */
  public coord: CoordData;

  /** Whether event dispatching is currently enabled */
  protected _enabled: boolean;
  /** Default behavior for the mouse wheel: 'zoom' or 'auto' (let the browser decide) */
  protected _wheelDefault: 'auto' | 'zoom';

  /**
   * @constructor
   * @param gfx - The GraphicsSystem that owns this event manager
   */
  public constructor(gfx: GraphicsSystem) {
    super();
    this._enabled = false;

    this.gfx = gfx;
    this.context = gfx.context;

    this.pointerOverRenderer = false;
    this.modifierKeys = new Set();
    this.coord = {
      screen: [0, 0],  // [0,0] is top,left of the screen
      map: [0, 0],     // [0,0] is the origin of the viewport (rotation removed)
      world: [0, 0]    // [0,0] is origin of the world coordinate (top left of world)
    };

    this._wheelDefault = utilDetect().os === 'mac' ? 'auto' : 'zoom';

    // Make sure the event handlers have `this` bound correctly
    this._click = this._click.bind(this);
    this._keydown = this._keydown.bind(this);
    this._keyup = this._keyup.bind(this);
    this._pointercancel = this._pointercancel.bind(this);
    this._pointerdown = this._pointerdown.bind(this);
    this._pointermove = this._pointermove.bind(this);
    this._pointerout = this._pointerout.bind(this);
    this._pointerover = this._pointerover.bind(this);
    this._pointerup = this._pointerup.bind(this);
    this._wheel = this._wheel.bind(this);

    this.enable();
  }


  /**
   * Whether the events are enabled
   * @return  `true` if pointer and keyboard events are bound
   * @readonly
   */
  public get enabled(): boolean {
    return this._enabled;
  }


  /**
   * Bind event handlers
   */
  public enable(): void {
    if (this._enabled) return;
    this._enabled = true;

    this.modifierKeys.clear();

    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);

    const gfx = this.gfx;

    // Attach wheel to supersurface so that content on the overlay (like the edit menu)
    // doesn't receive the wheel events and prevent panning and zooming.
    const supersurface = gfx.supersurface!;
    supersurface.addEventListener('wheel', this._wheel, { passive: false });  // false allows preventDefault

    const surface = gfx.surface!;
    surface.addEventListener('pointerover', this._pointerover);
    surface.addEventListener('pointerout', this._pointerout);

    const stage = gfx.stage!;
    stage.addEventListener('click', this._click);
    stage.addEventListener('rightclick', this._click);   // pixi has a special 'rightclick' event
    stage.addEventListener('pointerdown', this._pointerdown);
    stage.addEventListener('pointermove', this._pointermove);
    stage.addEventListener('pointerup', this._pointerup);
    stage.addEventListener('pointerupoutside', this._pointercancel);  // if up outide, just cancel
    stage.addEventListener('pointercancel', this._pointercancel);
  }


  /**
   * Unbind event handlers
   */
  public disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    this.modifierKeys.clear();

    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);

    const gfx = this.gfx;

    const supersurface = gfx.supersurface!;
    supersurface.removeEventListener('wheel', this._wheel);

    const surface = gfx.surface!;
    surface.removeEventListener('pointerover', this._pointerover);
    surface.removeEventListener('pointerout', this._pointerout);

    const stage = gfx.stage!;
    stage.removeEventListener('click', this._click);
    stage.removeEventListener('rightclick', this._click);
    stage.removeEventListener('pointerdown', this._pointerdown);
    stage.removeEventListener('pointermove', this._pointermove);
    stage.removeEventListener('pointerup', this._pointerup);
    stage.removeEventListener('pointerupoutside', this._pointercancel);
    stage.removeEventListener('pointercancel', this._pointercancel);
  }


  /**
   * Sets the cursor to the given style.
   * Pixi EventSystem uses the CSS cursor styles, but also allows for custom cursors in the EventSystem
   * see: https://pixijs.download/release/docs/PIXI.EventSystem.html#setCursor
   * @param style - String for one of the given CSS cursor styles (pass 'inherit' to reset)
   */
  public setCursor(style: string): void {
    // Pixi doesn't make this easy
    // On next pointerover event, the root event boundary will reset its perferred cursor
    // to whatever the .cursor property of the target is. (see EventBoundary.ts line 703)
    // We don't know when that event will be, next time user happens to shake the mouse?
    // So we'll also set it directly on the canvas so it locks in now
    const path = this.context.assetPath;
    const surface = this.gfx.surface;

    const cursors = {
      areaCursor: `url(${path}img/cursor-select-area.png), pointer`,
      connectLineCursor: `url(${path}img/cursor-draw-connect-line.png) 9 9, crosshair`,
      connectVertexCursor: `url(${path}img/cursor-draw-connect-vertex.png) 9 9, crosshair`,
      lineCursor: `url(${path}img/cursor-select-line.png), pointer`,
      pointCursor: `url(${path}img/cursor-select-point.png), pointer`,
      selectSplitCursor: `url(${path}img/cursor-select-split.png), pointer`,
      vertexCursor: `url(${path}img/cursor-select-vertex.png), pointer`,
    };

    switch (style) {
      case 'areaCursor':
        surface.style.cursor = cursors.areaCursor;
        break;
      case 'connectLineCursor':
        surface.style.cursor = cursors.connectLineCursor;
        break;
      case 'connectVertexCursor':
        surface.style.cursor = cursors.connectVertexCursor;
        break;
      case 'lineCursor':
        surface.style.cursor = cursors.lineCursor;
        break;
      case 'pointCursor':
        surface.style.cursor = cursors.pointCursor;
        break;
      case 'selectSplitCursor':
        surface.style.cursor = cursors.selectSplitCursor;
        break;
      case 'vertexCursor':
        surface.style.cursor = cursors.vertexCursor;
        break;
      default:
        surface.style.cursor = style;
        break;
      }
  }


  /**
   * For pointer and keyboard events that contain properties about the modifier keys,
   *   this code checks those properties and updates the `modifierKeys` set.
   * It's possible to miss a modifier key if it changed when the window was out of focus
   *   but we will know its state once the pointer events occur on the canvas again.
   *
   * @param e - A Pixi FederatedPointerEvent or DOM KeyboardEvent
   */
  protected _observeModifierKeys(e: PIXI.FederatedPointerEvent | KeyboardEvent): void {
    const modifiers = this.modifierKeys;
    const toCheck = [
      'Alt',      // ALT key, on Mac: ⌥ (option)
      'Control',  // CTRL key, on Mac: ⌃ (control)
      'Meta',     // META, on Mac: ⌘ (command), on Windows (Win), on Linux (Super)
      'Shift'     // Shift key, ⇧
    ];

    let didChange = false;
    for (const key of toCheck) {
      const keyIsDown = e.getModifierState(key);
      const keyWasDown = modifiers.has(key);

      if (keyIsDown && !keyWasDown) {
        modifiers.add(key);
        didChange = true;
      } else if (!keyIsDown && keyWasDown) {
        modifiers.delete(key);
        didChange = true;
      }
    }

    if (didChange) {
      this.emit('modifierchange', modifiers);
    }
  }


  /**
   * Gather the coordinate data from the event.
   * @param x - The x coordinate
   * @param y - The y coordinate
   */
  protected _observeCoordinate(x: number, y: number): void {
    const viewport = this.context.viewport;
    const r = viewport.transform.r;

    this.coord.screen = [x, y];
    this.coord.map = r ? vecRotate(this.coord.screen, -r, viewport.center()) : this.coord.screen;
    this.coord.world = viewport.screenToWorld(this.coord.map);
  }


  /**
   * On Mac, consider a control-left-click as a right-click - Rapid#920
   * https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
   * https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _checkButtons(e: PIXI.FederatedPointerEvent): void {
    if (e.ctrlKey && utilDetect().os === 'mac') {
      if (e.button === 0) {   // left button
        e.button = 2;         // right button
      }
      if ((e.buttons & 0b11) === 0b01) {  // left and not right
        e.buttons ^= 0b11;                // swap left and right
      }
    }
  }


  /**
   * Handler for keydown events on the window.
   * @param e - A DOM KeyboardEvent
   */
  protected _keydown(e: KeyboardEvent): void {
    this._observeModifierKeys(e);
    this.emit('keydown', e);
  }

  /**
   * Handler for keyup events on the window.
   * @param e - A DOM KeyboardEvent
   */
  protected _keyup(e: KeyboardEvent): void {
    this._observeModifierKeys(e);
    this.emit('keyup', e);
  }

  /**
   * Handler for pointerover events on the canvas.
   * @param e - A DOM PointerEvent
   */
  protected _pointerover(e: PointerEvent): void {
    this._observeModifierKeys(e as any);
    // Don't call `_checkButtons(e)` here.
    // The DOM PointerEvent button properties are readonly.
    // and we don't really need to remap control-left-click to right-click in this situation.
    this.pointerOverRenderer = true;
    this.emit('pointerover', e);
  }

  /**
   * Handler for pointerout events on the canvas.
   * @param e - A DOM PointerEvent
   */
  protected _pointerout(e: PointerEvent): void {
    this._observeModifierKeys(e as any);
    // Don't call `_checkButtons(e)` here.
    // The DOM PointerEvent button properties are readonly.
    // and we don't really need to remap control-left-click to right-click in this situation.
    this.pointerOverRenderer = false;
    this.emit('pointerout', e);
  }

  /**
   * Handler for pointerdown events on the stage.
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _pointerdown(e: PIXI.FederatedPointerEvent): void {
    this._observeModifierKeys(e);
    this._observeCoordinate(e.global.x, e.global.y);
    this._checkButtons(e);
    this.emit('pointerdown', e);
  }

  /**
   * Handler for pointermove events on the stage.
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _pointermove(e: PIXI.FederatedPointerEvent): void {
    this._observeModifierKeys(e);
    this._observeCoordinate(e.global.x, e.global.y);
    this._checkButtons(e);
    this.emit('pointermove', e);
  }

  /**
   * Handler for pointerup events on the stage.
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _pointerup(e: PIXI.FederatedPointerEvent): void {
    this._observeModifierKeys(e);
    this._observeCoordinate(e.global.x, e.global.y);
    this._checkButtons(e);
    this.emit('pointerup', e);
  }

  /**
   * Handler for pointercancel events on the stage.
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _pointercancel(e: PIXI.FederatedPointerEvent): void {
    this.emit('pointercancel', e);
  }

  /**
   * Handler for click events on the stage.
   * @param e - A Pixi FederatedPointerEvent
   */
  protected _click(e: PIXI.FederatedPointerEvent): void {
    // no need to _observeModifierKeys here, 'click' fires immediately after 'pointerup'
    this._checkButtons(e);
    this.emit('click', e);
  }


  /**
   * Handler for wheel events on the supersurface.
   * @param e - A DOM WheelEvent
   */
  protected _wheel(e: WheelEvent): void {
    e.preventDefault();             // don't scroll supersurface contents
    e.stopImmediatePropagation();   // don't scroll page contents either

    const context = this.context;
    const storage = context.systems.storage;

    this._observeCoordinate(e.offsetX, e.offsetY);
    const [dX, dY] = this._normalizeWheelDelta(e);

    // There is some code in here to try to detect when the user is 2-finger scrolling
    // on a trackpad, and if so allow this gesture to 'pan' the map instead of zooming it.

    // Round numbers
    //   - 2-finger pans on a trackpad
    //   - mouse wheels (occasionally)
    // Fractional numbers
    //   - 2-finger pinch-zooms on a trackpad (`e.ctrlKey` will be true in this case)
    //   - mouse wheels (usually)
    const isRoundNumber = (Number.isFinite(dY) && Math.floor(dY) === dY);

    // On a multitouch trackpad, this 'wheel' event came from a pinch/unpinch gesture IF:
    // - dY is a fractional number, AND
    // - e.ctrlKey is `true`
    // see https://kenneth.io/post/detecting-multi-touch-trackpad-gestures-in-javascript
    // (NB: We observe modifier keys elsewhere and can know whether the user really did press ctrlKey)
    const isPinchZoom = !isRoundNumber && e.ctrlKey && !this.modifierKeys.has('Control');

    let gesture: 'zoom' | 'pan';  // Detect this wheel event as 'zoom' or 'pan'
    let speed: number;         // Multiplier to adjust the zoom speed

    if (isPinchZoom) {   // A pinch-zoom gesture on a trackpad...
      gesture = 'zoom';
      speed = 6;

    } else if (e.shiftKey) {   // If shift is down, always zoom...
      gesture = 'zoom';
      speed = 3;

    } else {  // consider user mouse_wheel preference
      const wheelPref = storage?.getItem('prefs.mouse_wheel.interaction') ?? this._wheelDefault;

      // User wants to 'pan' by default OR
      // We autodetect - either horizontal scroll present or vertical scroll is a round number...
      if (
        (wheelPref === 'pan') ||
        (wheelPref === 'auto' && (dX || isRoundNumber))
      ) {
        gesture = 'pan';
        speed = 1;
      } else {
        gesture = 'zoom';
        speed = 3;
      }
    }

    // Decorate the wheel event with whatever we detected.
    const wheelEvent = e as NormalizedWheelEvent;
    wheelEvent._gesture = gesture;
    wheelEvent._normalizedDeltaX = dX * speed;
    wheelEvent._normalizedDeltaY = dY * speed;
    wheelEvent._coord = this.coord;

    this.emit('wheel', wheelEvent);
  }


  /**
   * This code performs some adjustment of the wheel event delta values.
   * The values may be given in PIXEL, LINES, or PAGE and we want them in PIXEL.
   *
   * Great summaries here:
   *   https://dev.to/danburzo/pinch-me-i-m-zooming-gestures-in-the-dom-a0e
   *   https://github.com/w3c/uievents/issues/181#issuecomment-392648065
   *
   * Note that Firefox will now change its behavior depending on how you look at the delta values!
   *   https://github.com/mdn/content/issues/11811
   *   https://bugzilla.mozilla.org/show_bug.cgi?id=1392460#c33
   * PixiJS reads deltaX/Y/Z before deltaMode in order to get consistent values from Firefox:
   *   https://github.com/pixijs/pixijs/pull/8972
   *   https://github.com/pixijs/pixijs/issues/8970
   *
   * Also see https://github.com/basilfx/normalize-wheel/blob/master/src/normalizeWheel.js
   *   for an older version of this sort of code.
   *
   * And this great page for testing what events your browser generates:
   *   https://domeventviewer.com/
   *
   * @param e - A native DOM WheelEvent
   * @returns Normalized `[deltaX, deltaY]` in pixels
   */
  protected _normalizeWheelDelta(e: WheelEvent): Vec2 {
    let [dX, dY] = [e.deltaX, e.deltaY];  // raw delta values

    if (dY === 0 && e.shiftKey) {         // Some browsers treat skiftKey as horizontal scroll
      [dX, dY] = [e.deltaY, e.deltaX];    // swap dx/dy values to undo it.
    }

    const [sX, sY] = [Math.sign(dX), Math.sign(dY)];    // signs
    let [mX, mY] = [Math.abs(dX), Math.abs(dY)];      // magnitudes

    // Fractional numbers are generated from wheel events on many mouse types, but notably by
    // 2-finger pinch/unpinch gestues on a trackpad. Because we want to handle these specially,
    // we'll try to keep the round numbers round and the fractional numbers fractional.
    const isRoundX = (Number.isFinite(mX) && Math.floor(mX) === mX);
    const isRoundY = (Number.isFinite(mY) && Math.floor(mY) === mY);
    const fuzzX = isRoundX ? 0 : 0.001;
    const fuzzY = isRoundY ? 0 : 0.001;

    // If the wheel delta values are not given in pixels, convert to pixels.
    // (These days only Firefox will _sometimes_ report wheel delta in LINE units).
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1392460#c33
    if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
      let pixels: number;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        pixels = 8;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        pixels = 24;
      } else {     /* unknown units? */
        pixels = 1;
      }

      mX *= pixels;
      mY *= pixels;
    }

    // Limit the returned values to prevent user from scrolling too fast.
    // Add fuzz if needed to keep round numbers round and fractional numbers fractional.
    const MAX = 40;
    const pX = sX * (Math.min(MAX, mX) + fuzzX);
    const pY = sY * (Math.min(MAX, mY) + fuzzY);

    // console.log(`deltaMode = ${e.deltaMode}, inX = ${e.deltaX}, inY = ${e.deltaY}, outX = ${pX}, outY = ${pY}`);
    return [pX, pY];
  }
}

