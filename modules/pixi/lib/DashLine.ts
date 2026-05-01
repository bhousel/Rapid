import * as PIXI from 'pixi.js';
import { vecLength, type Vec2 } from '@rapid-sdk/math';


/** Define the dash: [dash length, gap size, dash size, gap size, ...] */
export type Dashes = number[];

/** Options for configuring DashLine */
export interface DashLineOptions {
  /** The dash pattern as alternating dash/gap lengths */
  dash?: Dashes;
  /** Width of the dashed line */
  width?: number;
  /** Color of the dashed line */
  color?: number;
  /** Alpha/opacity of the dashed line */
  alpha?: number;
  /** Scale factor for the dash pattern */
  scale?: number;
  /** Whether to use texture-based rendering */
  useTexture?: boolean;
  /** Line cap style (only works for useTexture: false) */
  cap?: PIXI.LineCap;
  /** Line join style (only works for useTexture: false) */
  join?: PIXI.LineJoin;
  /** Line alignment (0.5 = middle, 1 = outer, 0 = inner) */
  alignment?: number;
}

/** Default options merged with user-provided options */
interface ResolvedDashLineOptions {
  dash: Dashes;
  width: number;
  color: number;
  alpha: number;
  scale: number;
  useTexture: boolean;
  alignment: number;
  cap?: PIXI.LineCap;
  join?: PIXI.LineJoin;
}

const dashLineOptionsDefault: ResolvedDashLineOptions = {
  dash: [10, 5],
  width: 1,
  color: 0xffffff,
  alpha: 1,
  scale: 1,
  useTexture: false, //true,
  alignment: 0.5
};


export class DashLine {
  /** Reference to the GraphicsSystem for texture caching */
  gfx: any;
  /** Resolved options for this DashLine */
  options: ResolvedDashLineOptions;
  /** Current length of the line being drawn */
  lineLength: number | null;
  /** Current cursor position */
  cursor: PIXI.Point;
  /** Starting point of the current path */
  start: PIXI.Point | null;
  /** The Pixi graphics object to draw with */
  graphics: PIXI.Graphics;
  /** The dash pattern */
  dash: Dashes;
  /** Total size of one complete dash pattern cycle */
  dashSize: number;
  /** Scale factor for the dash pattern */
  scale: number;
  /** Whether to use texture-based rendering */
  useTexture: boolean;
  /** The texture used for texture-based dashing */
  activeTexture: PIXI.Texture | null;
  /** Stroke style configuration */
  strokeStyle: PIXI.StrokeStyle;

  /**
   * Create a DashLine
   * @param gfx - Reference back to the GraphicsSystem, so we can find the texture cache
   * @param graphics - The Pixi graphics object to draw with a dashed-line style
   * @param options - DashLine configuration options
   */
  constructor(gfx: any, graphics: PIXI.Graphics, options: DashLineOptions = {}) {
    this.gfx = gfx;

    const resolvedOptions = { ...dashLineOptionsDefault, ...options };
    this.options = resolvedOptions;

    this.lineLength = null;
    this.cursor = new PIXI.Point();
    this.start = null;

    this.graphics = graphics;
    this.dash = resolvedOptions.dash;
    this.dashSize = this.dash.reduce((a, b) => a + b);
    this.scale = resolvedOptions.scale;
    this.useTexture = resolvedOptions.useTexture;

    if (this.useTexture) {
      this.activeTexture = this._getTexture(resolvedOptions, this.dashSize);
      this.strokeStyle = {
        alignment: resolvedOptions.alignment,
        alpha: resolvedOptions.alpha,
        color: resolvedOptions.color,
        matrix: new PIXI.Matrix(),
        texture: this.activeTexture!,
        textureSpace: 'global',
        width: resolvedOptions.width * resolvedOptions.scale
      };
    } else {
      this.activeTexture = null;
      this.strokeStyle = {
        alignment: resolvedOptions.alignment,
        alpha: resolvedOptions.alpha,
        cap: resolvedOptions.cap,
        color: resolvedOptions.color,
        join: resolvedOptions.join,
        width: resolvedOptions.width * resolvedOptions.scale
      };
    }
  }


  /**
   * Move to a position to prepare to draw a line.
   * This is essentially our 'reset' function.
   */
  moveTo(x: number, y: number): this {
    this.lineLength = 0;
    this.cursor.set(x, y);
    this.start = new PIXI.Point(x, y);
    this.graphics.moveTo(this.cursor.x, this.cursor.y);
    return this;
  }


  /**
   * Extend the line to given x,y coordinate
   */
  lineTo(x: number, y: number, doClosePath?: boolean): this {
    if (this.lineLength === null) {  // lineTo() called before moveTo()?
      this.moveTo(0, 0);
    }
    let [x0, y0] = [this.cursor.x, this.cursor.y];   // the start position of the cursor
    const length = vecLength([x0, y0] as Vec2, [x, y] as Vec2);
    if (length < 1) {
      this.lineLength! += length;  // advance length, but don't draw anything (these tiny lengths add up)
      return this;
    }

    const angle = Math.atan2(y - y0, x - x0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const final = doClosePath && x === this.start!.x && y === this.start!.y;

    if (this.useTexture) {
      if (final && this.dash.length % 2 === 0) {
        const gap = Math.min(this.dash[this.dash.length - 1], length);
        this.graphics.lineTo(x - cos * gap, y - sin * gap);
        this.graphics.closePath();
      } else {
        this.graphics.lineTo(x, y);
      }

      // set texture matrix
      const m = this.strokeStyle.matrix!;
      m.identity();
      if (angle) {
        m.rotate(angle);
      }
      if (this.scale !== 1) {
        m.scale(this.scale, this.scale);
      }
      const textureStart = -this.lineLength!;
      m.translate(
        this.cursor.x + textureStart * cos,
        this.cursor.y + textureStart * sin
      );

      this.lineLength! += length;
      this.cursor.set(x, y);

    } else {
      // Determine where in the dash pattern the cursor is starting from.
      const origin = this.lineLength! % (this.dashSize * this.scale);
      let dashIndex = 0;  // which dash in the pattern
      let dashStart = 0;  // how far in the dash
      let dashX = 0;
      for (let i = 0; i < this.dash.length; i++) {
        const dashSize = this.dash[i] * this.scale;
        if (origin < dashX + dashSize) {
          dashIndex = i;
          dashStart = origin - dashX;
          break;
        } else {
          dashX += dashSize;
        }
      }

      // Advance the line
      let remaining = length;
      while (remaining > 1) {   // stop if we are within 1 pixel
        const dashSize = (this.dash[dashIndex] * this.scale) - dashStart;
        const dist = (remaining > dashSize) ? dashSize : remaining;

        if (final) {
          const remainingDistance = vecLength([x0 + cos * dist, y0 + sin * dist] as Vec2, [this.start!.x, this.start!.y] as Vec2);
          if (remainingDistance <= dist) {
            if (dashIndex % 2 === 0) {
              const lastDash = vecLength([x0, y0] as Vec2, [this.start!.x, this.start!.y] as Vec2) - this.dash[this.dash.length - 1] * this.scale;
              x0 += cos * lastDash;
              y0 += sin * lastDash;
              this.graphics.lineTo(x0, y0);
              this.lineLength! += lastDash;
              this.cursor.set(x0, y0);
            }
            break;
          }
        }

        x0 += cos * dist;
        y0 += sin * dist;
        if (dashIndex % 2) {  // odd dashIndex = 'on', even dashIndex = 'off'
          this.graphics.moveTo(x0, y0);
        } else {
          this.graphics.lineTo(x0, y0);
        }
        this.lineLength! += dist;
        this.cursor.set(x0, y0);
        remaining -= dist;

        // Prepare for next dash (only really matters if there is remaining length)
        dashIndex++;
        dashIndex = dashIndex === this.dash.length ? 0 : dashIndex;
        dashStart = 0;
      }
    }

    // Pixi v8: call `stroke()` after issuing draw instructions
    this.graphics.stroke(this.strokeStyle);

    return this;
  }


  closePath(): void {
    this.lineTo(this.start!.x, this.start!.y, true);
  }


  /**
   * Draw a dashed circle
   * @param x - Center x coordinate
   * @param y - Center y coordinate
   * @param radius - Circle radius
   * @param points - Number of points to approximate the circle
   * @param matrix - Optional transformation matrix
   * @return this
   */
  circle(x: number, y: number, radius: number, points: number = 80, matrix: PIXI.Matrix | null = null): this {
    const interval = (Math.PI * 2) / points;
    let angle = 0;
    const first = new PIXI.Point(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    if (matrix) {
      matrix.apply(first, first);
      this.moveTo(first.x, first.y);
    } else {
      this.moveTo(first.x, first.y);
    }
    angle += interval;
    for (let i = 1; i < points + 1; i++) {
      const next: Vec2 = (i === points) ? [first.x, first.y] : [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
      this.lineTo(next[0], next[1]);
      angle += interval;
    }

    return this;
  }


  /**
   * Draw a dashed ellipse
   * @param x - Center x coordinate
   * @param y - Center y coordinate
   * @param radiusX - Ellipse horizontal radius
   * @param radiusY - Ellipse vertical radius
   * @param points - Number of points to approximate the ellipse
   * @param matrix - Optional transformation matrix
   * @return this
   */
  ellipse(x: number, y: number, radiusX: number, radiusY: number, points: number = 80, matrix: PIXI.Matrix | null = null): this {
    const interval = (Math.PI * 2) / points;
    let first: { x: number; y: number } | undefined;

    const point = new PIXI.Point();
    for (let i = 0; i < Math.PI * 2; i += interval) {
      let x0 = x - radiusX * Math.sin(i);
      let y0 = y - radiusY * Math.cos(i);
      if (matrix) {
        point.set(x0, y0);
        matrix.apply(point, point);
        x0 = point.x;
        y0 = point.y;
      }
      if (i === 0) {
        this.moveTo(x0, y0);
        first = { x: x0, y: y0 };
      } else {
        this.lineTo(x0, y0);
      }
    }

    this.lineTo(first!.x, first!.y, true);

    return this;
  }


  /**
   * Draw a dashed polygon from points
   * @param points - Array of points (either PIXI.Point[] or flat number[])
   * @param matrix - Optional transformation matrix
   * @return this
   */
  poly(points: PIXI.Point[] | number[], matrix: PIXI.Matrix | null = null): this {
    const p = new PIXI.Point();

    if (typeof points[0] === 'number') {   // flat array of numbers
      const numPoints = points as number[];
      if (matrix) {
        p.set(numPoints[0], numPoints[1]);
        matrix.apply(p, p);
        this.moveTo(p.x, p.y);
        for (let i = 2; i < numPoints.length; i += 2) {
          p.set(numPoints[i], numPoints[i + 1]);
          matrix.apply(p, p);
          this.lineTo(p.x, p.y, i === numPoints.length - 2);
        }
      } else {
        this.moveTo(numPoints[0], numPoints[1]);
        for (let i = 2; i < numPoints.length; i += 2) {
          this.lineTo(numPoints[i], numPoints[i + 1], i === numPoints.length - 2);
        }
      }

    } else {   // Array of PIXI.Point
      const ptPoints = points as PIXI.Point[];
      if (matrix) {
        const point = ptPoints[0];
        p.copyFrom(point);
        matrix.apply(p, p);
        this.moveTo(p.x, p.y);
        for (let i = 1; i < ptPoints.length; i++) {
          const point = ptPoints[i];
          p.copyFrom(point);
          matrix.apply(p, p);
          this.lineTo(p.x, p.y, i === ptPoints.length - 1);
        }
      } else {
        const point = ptPoints[0];
        this.moveTo(point.x, point.y);
        for (let i = 1; i < ptPoints.length; i++) {
          const point = ptPoints[i];
          this.lineTo(point.x, point.y, i === ptPoints.length - 1);
        }
      }
    }

    return this;
  }


  /**
   * Draw a dashed rectangle
   * @param x - Top-left x coordinate
   * @param y - Top-left y coordinate
   * @param width - Rectangle width
   * @param height - Rectangle height
   * @param matrix - Optional transformation matrix
   * @return this
   */
  rect(x: number, y: number, width: number, height: number, matrix: PIXI.Matrix | null = null): this {
    if (matrix) {
      const p = new PIXI.Point();

      // moveTo(x, y)
      p.set(x, y);
      matrix.apply(p, p);
      this.moveTo(p.x, p.y);

      // lineTo(x + width, y)
      p.set(x + width, y);
      matrix.apply(p, p);
      this.lineTo(p.x, p.y);

      // lineTo(x + width, y + height)
      p.set(x + width, y + height);
      matrix.apply(p, p);
      this.lineTo(p.x, p.y);

      // lineto(x, y + height)
      p.set(x, y + height);
      matrix.apply(p, p);
      this.lineTo(p.x, p.y);

      // lineTo(x, y, true)
      p.set(x, y);
      matrix.apply(p, p);
      this.lineTo(p.x, p.y, true);

    } else {
      this.moveTo(x, y)
        .lineTo(x + width, y)
        .lineTo(x + width, y + height)
        .lineTo(x, y + height)
        .lineTo(x, y, true);
    }

    return this;
  }


  /**
   * Creates or uses cached texture for dashed line pattern
   * @param options - DashLine options
   * @param dashSize - Total size of the dash pattern
   * @return The texture for the dash pattern, or null on error
   */
  private _getTexture(options: ResolvedDashLineOptions, dashSize: number): PIXI.Texture | null {
    const dashTextureCache = this.gfx.textureManager?._dashTextureCache;
    if (!dashTextureCache) {    // called too early?
      console.error('No DashTextureCache found');   // eslint-disable-line no-console
      return null;
    }

    const key = options.dash.toString();
    if (dashTextureCache[key]) {
      return dashTextureCache[key];
    }

    // For WebGL1 support, this canvas should have power of 2 dimensions.
    const canvas = document.createElement('canvas');
    const drawWidth = dashSize;
    const drawHeight = Math.ceil(options.width);
    canvas.width = PIXI.nextPow2(drawWidth);
    canvas.height = PIXI.nextPow2(drawHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Did not get context from canvas');   // eslint-disable-line no-console
      return null;
    }

    // scale up to fill canvas
    const scaleX = canvas.width / drawWidth;
    const scaleY = canvas.height / drawHeight;
    ctx.scale(scaleX, scaleY);

    ctx.strokeStyle = 'white';
    ctx.globalAlpha = options.alpha;
    ctx.lineWidth = options.width;

    let x = 0;
    const y = options.width / 2;
    ctx.moveTo(x, y);

    for (let i = 0; i < options.dash.length; i += 2) {
      x += options.dash[i];
      ctx.lineTo(x, y);
      if (options.dash.length !== i + 1) {
        x += options.dash[i + 1];
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();

    const texture = (dashTextureCache[key] = PIXI.Texture.from(canvas));
    texture.source.scaleMode = 'nearest';

    return texture;
  }
}
