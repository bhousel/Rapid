// What a line builder makes from a line: the triangles that draw it (built without knowing how
// wide the line is), the outline of the line at a distance, and whether a point is within a distance.
// See `design/graphics-system.md` section 15, "The line builder".

/** How a line ends: at its last point (`butt`), half a width past it (`square`), or in a half circle (`round`) */
export type StrokeCap = 'butt' | 'round' | 'square';

/** How two segments of a line meet at a corner */
export type StrokeJoin = 'bevel' | 'miter' | 'round';

/** Options for `geomStrokeMesh` */
export interface StrokeOptions {
  /** Whether the last point joins the first (a ring). A closed line has no caps. */
  closed: boolean;
  /** How the ends of an open line are drawn */
  cap: StrokeCap;
  /** How the corners are drawn */
  join: StrokeJoin;
  /** A `miter` corner longer than this many half widths is drawn as a `bevel` */
  miterLimit: number;
  /** How many slices make a half circle, in round caps and joins */
  roundSlices: number;
}

/**
 * The triangles of a stroke. A vertex isn't a position: it's a point on the line and a direction
 * to move away from it, so the same mesh draws the line at any width. See `geomStrokePositions`.
 */
export interface StrokeMesh {
  /** How many vertices there are */
  vertexCount: number;
  /**
   * `STROKE_VERTEX_SIZE` numbers for each vertex:
   * - 0, 1: the point on the line that the vertex belongs to
   * - 2, 3: how far the vertex is from that point, for a half width of 1
   * - 4: the distance along the line, from its start to that point
   * - 5: how much further along the line the vertex is, for a half width of 1
   * - 6: which side of the line it's on: 1 (left of the direction of travel), -1, or 0 (on the line)
   */
  vertices: Float32Array;
  /** Three vertex indices for each triangle (16 bits each when the vertices can be counted in that) */
  indices: Uint16Array | Uint32Array;
  /**
   * `STROKE_FALLBACK_SIZE` numbers for each vertex that has a second place to be (see `geomStrokeMesh`):
   * - 0: the vertex's index
   * - 1: the largest half width that the vertex's own numbers are good for
   * - 2, 3, 4, 5: what replaces numbers 2, 3, 5 and 6 of the vertex at a larger half width
   */
  fallbacks: Float32Array;
  /** The length of the line (of the ring, if it's closed) */
  length: number;
  /** Whether it was built as a ring (a line asked to be closed that has too few points isn't) */
  closed: boolean;
  /** The cap it was built with */
  cap: StrokeCap;
  /** The join it was built with */
  join: StrokeJoin;
}

/**
 * The edge of a stroke: the rings at a distance from a line. Each is `[x, y, x, y, …]`, and
 * ends with its first point again.
 */
export interface StrokeOutline {
  /** The ring around an open line, or around the outside of a closed one. Empty if the line has fewer than two points. */
  outer: Float64Array;
  /** The ring inside a closed line, or `null` for an open line */
  inner: Float64Array | null;
}

/** How many numbers a vertex takes in `StrokeMesh.vertices` */
export const STROKE_VERTEX_SIZE = 7;

/** How many numbers an entry takes in `StrokeMesh.fallbacks` */
export const STROKE_FALLBACK_SIZE = 6;

// Points closer together than this are one point.
const EPSILON = 1e-6;

// A corner that turns less than about 16° is drawn as a miter on both sides, whatever join was
// asked for: the difference is under 1% of the half width, and it takes 2 vertices, not 5 or more.
// (This is the cosine of that angle.)
const SMOOTH_DOT = 0.9602;

// A corner that turns back on itself by more than about 172° has no inside miter.
const REVERSE_DOT = -0.99;

// How much of the shorter segment at a corner an inside miter may use up. With all of it (Pixi's
// rule too), the miter is still inside both segments, so nothing pokes out. The corners at
// both ends of a short segment can then use more than there is, and overlap each other a little.
const INSIDE_SHARE = 1;

// How far from a corner the inside of an outline may go, in distances, when the corner's segments
// are too short for the outline's edges to cross beside them (see `addOutlineCorner`).
const INSIDE_REACH = 2;

const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_INDICES = new Uint16Array(0);
const EMPTY_RING = new Float64Array(0);


// Scratch space, used while a mesh is built and reset by every call to `geomStrokeMesh`.
// Nothing reads it between calls: the result is copied out at the end.
const LINE_SIZE = 6;                              // x, y, dx, dy, length, distance (of each point, and the segment after it)
let _line = new Float64Array(LINE_SIZE * 256);
let _verts = new Float32Array(STROKE_VERTEX_SIZE * 1024);
let _numVerts = 0;
let _indices = new Uint32Array(3 * 1024);
let _numIndices = 0;
let _fallbacks = new Float32Array(STROKE_FALLBACK_SIZE * 256);
let _numFallbacks = 0;
let _numPoints = 0;
let _closed = false;
let _ring = new Float64Array(2 * 1024);   // the outline's ring that's being built
let _numRing = 0;                         // how many numbers of it are used

// The vertices on each side of a segment's start and end, set by the caps and joins.
let _startL = 0;
let _startR = 0;
let _endL = 0;
let _endR = 0;


/**
 * Adds a vertex.
 * @param x - The point on the line it belongs to
 * @param y - The point on the line it belongs to
 * @param ex - How far it is from that point, for a half width of 1
 * @param ey - How far it is from that point
 * @param distance - The point's distance along the line
 * @param along - How much further along the line the vertex is, for a half width of 1
 * @param side - 1 for the left side of the line, -1 for the right, 0 for neither
 * @return The vertex's index
 */
function addVertex(x: number, y: number, ex: number, ey: number, distance: number, along: number, side: number): number {
  let k = _numVerts * STROKE_VERTEX_SIZE;
  if (k + STROKE_VERTEX_SIZE > _verts.length) {
    const bigger = new Float32Array(_verts.length * 2);
    bigger.set(_verts);
    _verts = bigger;
  }
  _verts[k++] = x;
  _verts[k++] = y;
  _verts[k++] = ex;
  _verts[k++] = ey;
  _verts[k++] = distance;
  _verts[k++] = along;
  _verts[k] = side;
  return _numVerts++;
}


/**
 * Adds a triangle.
 * @param a - The index of its first vertex
 * @param b - ..its second
 * @param c - ..its third
 */
function addTriangle(a: number, b: number, c: number): void {
  if (_numIndices + 3 > _indices.length) {
    const bigger = new Uint32Array(_indices.length * 2);
    bigger.set(_indices);
    _indices = bigger;
  }
  _indices[_numIndices++] = a;
  _indices[_numIndices++] = b;
  _indices[_numIndices++] = c;
}


/**
 * Gives a vertex a second place to be, for half widths over `limit`.
 * @param index - The vertex's index
 * @param limit - The largest half width that the vertex's own numbers are good for
 * @param ex - How far it is from its point then, for a half width of 1
 * @param ey - How far it is from its point then
 * @param along - How much further along the line it is then, for a half width of 1
 * @param side - Which side of the line it's on then
 */
function addFallback(index: number, limit: number, ex: number, ey: number, along: number, side: number): void {
  let k = _numFallbacks * STROKE_FALLBACK_SIZE;
  if (k + STROKE_FALLBACK_SIZE > _fallbacks.length) {
    const bigger = new Float32Array(_fallbacks.length * 2);
    bigger.set(_fallbacks);
    _fallbacks = bigger;
  }
  _fallbacks[k++] = index;
  _fallbacks[k++] = limit;
  _fallbacks[k++] = ex;
  _fallbacks[k++] = ey;
  _fallbacks[k++] = along;
  _fallbacks[k] = side;
  _numFallbacks++;
}


/**
 * Copies the points of a line into `_line`, leaving out the ones that repeat the point before,
 * and works out each segment's direction and length. Sets `_numPoints` and `_closed`.
 * @param coords - The line's points as `[x, y, x, y, …]`
 * @param closed - Whether the last point joins the first
 */
function readLine(coords: ArrayLike<number>, closed: boolean): void {
  const numCoords = coords.length >> 1;
  if ((numCoords + 1) * LINE_SIZE > _line.length) {
    _line = new Float64Array((numCoords + 1) * LINE_SIZE * 2);
  }

  let n = 0;
  for (let i = 0; i < numCoords; i++) {
    const x = coords[i * 2];
    const y = coords[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (n > 0) {
      const k = (n - 1) * LINE_SIZE;
      if (Math.abs(x - _line[k]) < EPSILON && Math.abs(y - _line[k + 1]) < EPSILON) continue;
    }
    _line[n * LINE_SIZE] = x;
    _line[n * LINE_SIZE + 1] = y;
    n++;
  }

  // A ring's last point may repeat its first.
  if (closed && n > 1) {
    const k = (n - 1) * LINE_SIZE;
    if (Math.abs(_line[0] - _line[k]) < EPSILON && Math.abs(_line[1] - _line[k + 1]) < EPSILON) n--;
  }
  if (n < 3) closed = false;   // two points make a line, there and back

  const numSegments = closed ? n : n - 1;
  let distance = 0;
  for (let i = 0; i < numSegments; i++) {
    const k = i * LINE_SIZE;
    const k2 = ((i + 1) % n) * LINE_SIZE;
    const dx = _line[k2] - _line[k];
    const dy = _line[k2 + 1] - _line[k + 1];
    const length = Math.sqrt(dx * dx + dy * dy);
    _line[k + 2] = dx / length;
    _line[k + 3] = dy / length;
    _line[k + 4] = length;
    _line[k + 5] = distance;
    distance += length;
  }
  _line[n * LINE_SIZE + 5] = distance;   // the total, after the last point
  if (!closed && n > 0) {
    _line[(n - 1) * LINE_SIZE + 5] = distance;
  }

  _numPoints = n;
  _closed = closed;
}


/**
 * Starts an open line: sets `_startL` and `_startR`, and adds the cap.
 * @param cap - The kind of cap
 * @param slices - How many slices make a half circle
 */
function startCap(cap: StrokeCap, slices: number): void {
  const x = _line[0];
  const y = _line[1];
  const dx = _line[2];
  const dy = _line[3];
  const nx = -dy;   // the left side
  const ny = dx;

  if (cap === 'square') {
    _startL = addVertex(x, y, nx - dx, ny - dy, 0, -1, 1);
    _startR = addVertex(x, y, -nx - dx, -ny - dy, 0, -1, -1);
    return;
  }

  _startL = addVertex(x, y, nx, ny, 0, 0, 1);
  _startR = addVertex(x, y, -nx, -ny, 0, 0, -1);
  if (cap === 'round') {
    addFan(x, y, 0, dx, dy, _startL, _startR, nx, ny, Math.PI, slices);
  }
}


/**
 * Ends an open line: sets `_endL` and `_endR`, and adds the cap.
 * @param last - The index of the last point
 * @param cap - The kind of cap
 * @param slices - How many slices make a half circle
 */
function endCap(last: number, cap: StrokeCap, slices: number): void {
  const k = last * LINE_SIZE;
  const x = _line[k];
  const y = _line[k + 1];
  const dx = _line[k - LINE_SIZE + 2];   // the direction of the last segment
  const dy = _line[k - LINE_SIZE + 3];
  const distance = _line[k + 5];
  const nx = -dy;
  const ny = dx;

  if (cap === 'square') {
    _endL = addVertex(x, y, nx + dx, ny + dy, distance, 1, 1);
    _endR = addVertex(x, y, -nx + dx, -ny + dy, distance, 1, -1);
    return;
  }

  _endL = addVertex(x, y, nx, ny, distance, 0, 1);
  _endR = addVertex(x, y, -nx, -ny, distance, 0, -1);
  if (cap === 'round') {
    addFan(x, y, distance, dx, dy, _endR, _endL, -nx, -ny, Math.PI, slices);
  }
}


/**
 * Adds a fan of triangles around a point, from one vertex on the circle around it to another.
 * @param x - The point
 * @param y - The point
 * @param distance - The point's distance along the line
 * @param dx - The line's direction at the point, to say how far along the line each vertex is (0 for a join)
 * @param dy - The line's direction at the point
 * @param from - The vertex the fan starts at
 * @param to - The vertex it ends at
 * @param ex - Where `from` is, from the point (a unit vector)
 * @param ey - Where `from` is
 * @param angle - The angle to turn through, from `from` to `to` (negative for the other way)
 * @param slices - How many slices make a half circle
 * @param center - The vertex in the middle of the fan, if there is one already
 */
function addFan(
  x: number, y: number, distance: number, dx: number, dy: number,
  from: number, to: number, ex: number, ey: number, angle: number, slices: number, center: number = -1
): void {
  if (center < 0) {
    center = addVertex(x, y, 0, 0, distance, 0, 0);
  }
  const steps = Math.max(1, Math.ceil(Math.abs(angle) * slices / Math.PI - 1e-9));
  const cos = Math.cos(angle / steps);
  const sin = Math.sin(angle / steps);

  let prev = from;
  for (let i = 1; i < steps; i++) {
    const rx = ex * cos - ey * sin;
    const ry = ex * sin + ey * cos;
    ex = rx;
    ey = ry;
    const vertex = addVertex(x, y, ex, ey, distance, ex * dx + ey * dy, 0);
    addTriangle(center, prev, vertex);
    prev = vertex;
  }
  addTriangle(center, prev, to);
}


/**
 * Adds the corner at a point: sets `_endL` and `_endR` for the segment that arrives there,
 * `_startL` and `_startR` for the segment that leaves, and adds what fills the outside of the turn.
 * @param point - The index of the point
 * @param prev - The index of the segment that arrives
 * @param next - The index of the segment that leaves
 * @param distPrev - The point's distance along the line, as the end of `prev`
 * @param distNext - ..and as the start of `next` (they differ where a ring closes)
 * @param join - The kind of join
 * @param miterLimit - The longest miter, in half widths
 * @param slices - How many slices make a half circle
 */
function addJoin(
  point: number, prev: number, next: number, distPrev: number, distNext: number,
  join: StrokeJoin, miterLimit: number, slices: number
): void {
  const x = _line[point * LINE_SIZE];
  const y = _line[point * LINE_SIZE + 1];
  const ax = _line[prev * LINE_SIZE + 2];   // the direction it arrives in
  const ay = _line[prev * LINE_SIZE + 3];
  const bx = _line[next * LINE_SIZE + 2];   // the direction it leaves in
  const by = _line[next * LINE_SIZE + 3];
  const anx = -ay;   // the left side of each
  const any = ax;
  const bnx = -by;
  const bny = bx;
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;

  // Nearly straight: one vertex on each side, where the two edges meet.
  if (dot > SMOOTH_DOT) {
    const k = 1 / (1 + dot);
    const mx = (anx + bnx) * k;
    const my = (any + bny) * k;
    _endL = addVertex(x, y, mx, my, distPrev, 0, 1);
    _endR = addVertex(x, y, -mx, -my, distPrev, 0, -1);
    if (distPrev === distNext) {
      _startL = _endL;
      _startR = _endR;
    } else {
      _startL = addVertex(x, y, mx, my, distNext, 0, 1);
      _startR = addVertex(x, y, -mx, -my, distNext, 0, -1);
    }
    return;
  }

  // The line turns towards one side (the inside), and the other side (the outside) has a gap to fill.
  const o = (cross > 0) ? -1 : 1;   // the outside: 1 if it's the left

  // A miter: both segments run on to where their edges cross, the outside ones at the tip and the
  // inside ones at the inside miter, so two vertices on each side are the whole corner. (Two, not
  // one, because each segment counts its own distance along the line to get there.) When the line
  // is too wide for the inside miter (below), the inside vertices move back to their segments'
  // square ends, and the triangle between them and the tip fills what that opens.
  if (join === 'miter' && dot > REVERSE_DOT && (1 + dot) * miterLimit * miterLimit >= 2) {   // the miter is 1 / cos(half the turn) long
    const k = 1 / (1 + dot);
    const mx = o * (anx + bnx) * k;
    const my = o * (any + bny) * k;
    const tan = Math.sqrt((1 - dot) * k);
    const limit = INSIDE_SHARE * Math.min(_line[prev * LINE_SIZE + 4], _line[next * LINE_SIZE + 4]) / tan;
    const tipPrev = addVertex(x, y, mx, my, distPrev, tan, o);
    const tipNext = addVertex(x, y, mx, my, distNext, -tan, o);
    const insidePrev = addVertex(x, y, -mx, -my, distPrev, -tan, -o);
    const insideNext = addVertex(x, y, -mx, -my, distNext, tan, -o);
    addFallback(insidePrev, limit, -o * anx, -o * any, 0, -o);
    addFallback(insideNext, limit, -o * bnx, -o * bny, 0, -o);
    addTriangle(tipNext, insidePrev, insideNext);
    if (o === 1) {
      _endL = tipPrev;
      _endR = insidePrev;
      _startL = tipNext;
      _startR = insideNext;
    } else {
      _endL = insidePrev;
      _endR = tipPrev;
      _startL = insideNext;
      _startR = tipNext;
    }
    return;
  }

  const outerPrev = addVertex(x, y, o * anx, o * any, distPrev, 0, o);
  const outerNext = addVertex(x, y, o * bnx, o * bny, distNext, 0, o);

  // On the inside the two segments overlap. As long as the line is narrow enough for the corner,
  // both end where their inside edges cross (the inside miter), and the fan that fills the outside
  // starts from there too, so that nothing is covered twice. When the line is wider than that, the
  // crossing would be past the end of a segment: then each segment keeps its own square end, and the
  // fan starts from the point itself. The triangles are the same either way: three vertices move.
  let innerPrev: number;
  let innerNext: number;
  let center: number;
  if (dot > REVERSE_DOT) {
    const k = 1 / (1 + dot);
    const mx = -o * (anx + bnx) * k;
    const my = -o * (any + bny) * k;
    const tan = Math.sqrt((1 - dot) * k);   // of half the turn: how much of each segment the miter uses, in half widths
    const limit = INSIDE_SHARE * Math.min(_line[prev * LINE_SIZE + 4], _line[next * LINE_SIZE + 4]) / tan;
    innerPrev = addVertex(x, y, mx, my, distPrev, -tan, -o);
    innerNext = addVertex(x, y, mx, my, distNext, tan, -o);
    center = addVertex(x, y, mx, my, distNext, 0, -o);
    addFallback(innerPrev, limit, -o * anx, -o * any, 0, -o);
    addFallback(innerNext, limit, -o * bnx, -o * bny, 0, -o);
    addFallback(center, limit, 0, 0, 0, 0);
  } else {
    innerPrev = addVertex(x, y, -o * anx, -o * any, distPrev, 0, -o);
    innerNext = addVertex(x, y, -o * bnx, -o * bny, distNext, 0, -o);
    center = addVertex(x, y, 0, 0, distNext, 0, 0);
  }

  // Fill the outside of the turn.
  if (join === 'round') {
    const angle = -o * Math.atan2(Math.abs(cross), dot);   // from `outerPrev` around to `outerNext`
    addFan(x, y, distNext, 0, 0, outerPrev, outerNext, o * anx, o * any, angle, slices, center);

  } else {   // a bevel, or a miter that's too long
    addTriangle(center, outerPrev, outerNext);
  }

  if (o === 1) {
    _endL = outerPrev;
    _endR = innerPrev;
    _startL = outerNext;
    _startR = innerNext;
  } else {
    _endL = innerPrev;
    _endR = outerPrev;
    _startL = innerNext;
    _startR = outerNext;
  }
}


/**
 * Builds the triangles that draw a line, for any width.
 *
 * Each vertex is a point on the line and a direction away from it. Its place for a line of a
 * given width is `point + direction × half the width` (`geomStrokePositions`). So a line is built
 * once, and a change of width or of zoom only works those sums out again, in place.
 *
 * One thing does depend on the width: the inside of a corner. While the line is narrower than
 * the segments at the corner are long, they end where their inside edges cross, and no pixel is
 * covered twice (which shows on a translucent line). A wider line can't do that, and its segments
 * overlap there. The vertices concerned have a second place to be, in `fallbacks`, and the half
 * width from which to use it. A corner of less than about 16° has no second place: where such
 * corners follow each other more closely than the line is wide, triangles overlap.
 *
 * Points that repeat the one before are left out. A line with fewer than two different points
 * has no triangles.
 *
 * @param coords - The line's points as `[x, y, x, y, …]`
 * @param options - How to cap and join it, and whether it's closed. Defaults to an open line
 *   with butt caps and miter joins.
 * @return The mesh. Its arrays are its own.
 */
export function geomStrokeMesh(coords: ArrayLike<number>, options: Partial<StrokeOptions> = {}): StrokeMesh {
  const cap = options.cap ?? 'butt';
  const join = options.join ?? 'miter';
  const miterLimit = options.miterLimit ?? 10;
  const slices = Math.max(1, Math.floor(options.roundSlices ?? 10));

  readLine(coords, options.closed ?? false);
  const numPoints = _numPoints;
  const closed = _closed;
  if (numPoints < 2) {
    return {
      vertexCount: 0, vertices: EMPTY_FLOATS, indices: EMPTY_INDICES, fallbacks: EMPTY_FLOATS, length: 0,
      closed: false, cap: cap, join: join
    };
  }

  _numVerts = 0;
  _numIndices = 0;
  _numFallbacks = 0;

  const length = _line[numPoints * LINE_SIZE + 5];
  let lastL = 0;   // where a ring's last segment ends
  let lastR = 0;

  if (closed) {
    addJoin(0, numPoints - 1, 0, length, 0, join, miterLimit, slices);
    lastL = _endL;
    lastR = _endR;
  } else {
    startCap(cap, slices);
  }

  const lastJoin = closed ? numPoints - 1 : numPoints - 2;
  for (let i = 1; i <= lastJoin; i++) {
    const fromL = _startL;
    const fromR = _startR;
    const distance = _line[i * LINE_SIZE + 5];
    addJoin(i, i - 1, i, distance, distance, join, miterLimit, slices);
    addTriangle(fromL, fromR, _endL);
    addTriangle(fromR, _endR, _endL);
  }

  // The last segment.
  const fromL = _startL;
  const fromR = _startR;
  if (closed) {
    _endL = lastL;
    _endR = lastR;
  } else {
    endCap(numPoints - 1, cap, slices);
  }
  addTriangle(fromL, fromR, _endL);
  addTriangle(fromR, _endR, _endL);

  return {
    vertexCount: _numVerts,
    vertices: _verts.slice(0, _numVerts * STROKE_VERTEX_SIZE),
    indices: (_numVerts <= 0x10000) ? new Uint16Array(_indices.subarray(0, _numIndices)) : _indices.slice(0, _numIndices),
    fallbacks: _numFallbacks ? _fallbacks.slice(0, _numFallbacks * STROKE_FALLBACK_SIZE) : EMPTY_FLOATS,
    length: length,
    closed: closed,
    cap: cap,
    join: join
  };
}


/**
 * Works out where a stroke's vertices are, for a line of a given width.
 * @param mesh - The stroke
 * @param halfWidth - Half the line's width, in the units of the line's coordinates
 * @param out - Where to write `[x, y, x, y, …]`: at least two numbers for each vertex. A new array if left out.
 * @return `out`
 */
export function geomStrokePositions(mesh: StrokeMesh, halfWidth: number, out?: Float32Array): Float32Array {
  const vertices = mesh.vertices;
  const numVerts = mesh.vertexCount;
  out ??= new Float32Array(numVerts * 2);

  for (let i = 0, k = 0; i < numVerts; i++, k += STROKE_VERTEX_SIZE) {
    out[i * 2] = vertices[k] + vertices[k + 2] * halfWidth;
    out[i * 2 + 1] = vertices[k + 1] + vertices[k + 3] * halfWidth;
  }

  const fallbacks = mesh.fallbacks;
  for (let f = 0; f < fallbacks.length; f += STROKE_FALLBACK_SIZE) {
    if (halfWidth <= fallbacks[f + 1]) continue;
    const i = fallbacks[f];
    const k = i * STROKE_VERTEX_SIZE;
    out[i * 2] = vertices[k] + fallbacks[f + 2] * halfWidth;
    out[i * 2 + 1] = vertices[k + 1] + fallbacks[f + 3] * halfWidth;
  }

  return out;
}


/**
 * Works out a stroke's texture coordinates, for a line of a given width: `u` runs along the line
 * and `v` across it, from 0 on the right edge to 1 on the left. A dash pattern is a texture that
 * repeats along `u`.
 * @param mesh - The stroke
 * @param halfWidth - Half the line's width, in the units of the line's coordinates
 * @param perUnit - How much `u` grows for each unit of distance along the line (1 / the length of the pattern)
 * @param out - Where to write `[u, v, u, v, …]`: at least two numbers for each vertex. A new array if left out.
 * @return `out`
 */
export function geomStrokeUVs(mesh: StrokeMesh, halfWidth: number, perUnit: number, out?: Float32Array): Float32Array {
  const vertices = mesh.vertices;
  const numVerts = mesh.vertexCount;
  out ??= new Float32Array(numVerts * 2);

  for (let i = 0, k = 0; i < numVerts; i++, k += STROKE_VERTEX_SIZE) {
    out[i * 2] = (vertices[k + 4] + vertices[k + 5] * halfWidth) * perUnit;
    out[i * 2 + 1] = 0.5 + 0.5 * vertices[k + 6];
  }

  const fallbacks = mesh.fallbacks;
  for (let f = 0; f < fallbacks.length; f += STROKE_FALLBACK_SIZE) {
    if (halfWidth <= fallbacks[f + 1]) continue;
    const i = fallbacks[f];
    const k = i * STROKE_VERTEX_SIZE;
    out[i * 2] = (vertices[k + 4] + fallbacks[f + 4] * halfWidth) * perUnit;
    out[i * 2 + 1] = 0.5 + 0.5 * fallbacks[f + 5];
  }

  return out;
}


/**
 * Adds a point to the ring that's being built, unless it's where the last one is.
 * @param x - The point
 * @param y - The point
 */
function addRingPoint(x: number, y: number): void {
  const n = _numRing;
  if (n >= 2 && Math.abs(x - _ring[n - 2]) < EPSILON && Math.abs(y - _ring[n - 1]) < EPSILON) return;
  if (n + 2 > _ring.length) {
    const grown = new Float64Array(_ring.length * 2);
    grown.set(_ring);
    _ring = grown;
  }
  _ring[n] = x;
  _ring[n + 1] = y;
  _numRing = n + 2;
}


/**
 * Adds the points of an arc around a point to the ring, without the arc's two ends.
 * @param x - The point
 * @param y - The point
 * @param ex - Where the arc starts, from the point
 * @param ey - Where the arc starts
 * @param angle - The angle to turn through (negative for clockwise, when y is up)
 * @param slices - How many slices make a half circle
 */
function addRingArc(x: number, y: number, ex: number, ey: number, angle: number, slices: number): void {
  const steps = Math.max(1, Math.ceil(Math.abs(angle) * slices / Math.PI - 1e-9));
  const cos = Math.cos(angle / steps);
  const sin = Math.sin(angle / steps);
  for (let i = 1; i < steps; i++) {
    const rx = ex * cos - ey * sin;
    const ry = ex * sin + ey * cos;
    ex = rx;
    ey = ry;
    addRingPoint(x + ex, y + ey);
  }
}


/**
 * Adds the outline's points at a corner, on the left of the way the ring goes around it.
 *
 * Where the line turns away from that side, there's a gap to go around: with a miter, a bevel or
 * an arc. Where it turns towards it, the outline is one point, where the edges of the two
 * segments cross.
 *
 * Each edge runs along its segment for `distance × tan(half the turn)` before it gets to that
 * crossing, and a short segment isn't that long. The outline goes there all the same, and so it
 * doubles back for the difference and leaves a small loop (in lines that bend gently, most are
 * under a tenth of the distance). Stopping short of the crossing has no loop, but puts a notch
 * in the outline wherever a line wiggles, which looks worse. Only where the turn is sharp as
 * well, and the crossing far away, does it stop: at `INSIDE_REACH` distances from the corner.
 *
 * @param x - The corner
 * @param y - The corner
 * @param ax - The direction the ring arrives in (a unit vector)
 * @param ay - The direction it arrives in
 * @param lenA - The length of the segment it arrives on
 * @param bx - The direction it leaves in
 * @param by - The direction it leaves in
 * @param lenB - The length of the segment it leaves on
 * @param distance - How far the outline is from the line
 * @param join - How to go around the outside of a corner
 * @param miterLimit - The longest miter, in distances
 * @param slices - How many slices make a half circle
 */
function addOutlineCorner(
  x: number, y: number, ax: number, ay: number, lenA: number, bx: number, by: number, lenB: number,
  distance: number, join: StrokeJoin, miterLimit: number, slices: number
): void {
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;

  // It turns towards this side, however little. From the corner, the edges cross along `b - a`,
  // which is `2 sin(half the turn)` long.
  if (cross > 0) {
    const ex = bx - ax;
    const ey = by - ay;
    const chord = Math.sqrt(ex * ex + ey * ey);
    if (chord > 1e-9) {
      const sin = chord / 2;
      const cos = Math.sqrt(Math.max(0, (1 + dot) / 2));
      let reach = INSIDE_REACH * distance;
      if (cos > 0 && (distance * sin <= Math.min(lenA, lenB) * cos || distance <= reach * cos)) {   // there's room, or it isn't far
        reach = distance / cos;
      }
      addRingPoint(x + ex / chord * reach, y + ey / chord * reach);
      return;
    }
  }

  // Nearly straight, or a miter that isn't too long: one point, where the two edges cross.
  if (dot > SMOOTH_DOT || (join === 'miter' && (1 + dot) * miterLimit * miterLimit >= 2)) {
    const k = distance / (1 + dot);
    addRingPoint(x - (ay + by) * k, y + (ax + bx) * k);
    return;
  }

  addRingPoint(x - ay * distance, y + ax * distance);
  if (join === 'round') {
    addRingArc(x, y, -ay * distance, ax * distance, -Math.atan2(-cross, dot), slices);
  }
  addRingPoint(x - by * distance, y + bx * distance);
}


/**
 * Adds one side of an open line to the ring: the left of the direction it's walked in, from
 * one end to the other, and the cap around the end it arrives at.
 * @param forward - `true` to walk from the first point to the last (the line's left side), `false` for the other way (its right side)
 * @param distance - How far the outline is from the line
 * @param cap - How to go around the end
 * @param join - How to go around the outside of a corner
 * @param miterLimit - The longest miter, in distances
 * @param slices - How many slices make a half circle
 */
function addOutlineSide(forward: boolean, distance: number, cap: StrokeCap, join: StrokeJoin, miterLimit: number, slices: number): void {
  const last = _numPoints - 1;
  const sign = forward ? 1 : -1;
  const back = (cap === 'square') ? distance : 0;   // a square cap starts and ends this far past the line's ends

  // The first point. (Walking backwards, a segment's direction is the other way, and it's kept with the point before it.)
  let i = forward ? 0 : last;
  let k = (forward ? 0 : last - 1) * LINE_SIZE;
  let dx = sign * _line[k + 2];
  let dy = sign * _line[k + 3];
  let length = _line[k + 4];
  addRingPoint(_line[i * LINE_SIZE] - (dy + dx) * back - dy * (distance - back), _line[i * LINE_SIZE + 1] + (dx - dy) * back + dx * (distance - back));

  for (let n = 1; n < last; n++) {
    i += sign;
    k = (forward ? i : i - 1) * LINE_SIZE;
    const nextX = sign * _line[k + 2];
    const nextY = sign * _line[k + 3];
    const nextLength = _line[k + 4];
    addOutlineCorner(_line[i * LINE_SIZE], _line[i * LINE_SIZE + 1], dx, dy, length, nextX, nextY, nextLength, distance, join, miterLimit, slices);
    dx = nextX;
    dy = nextY;
    length = nextLength;
  }

  // The last point, and around the end to where the other side starts.
  i = forward ? last : 0;
  const x = _line[i * LINE_SIZE];
  const y = _line[i * LINE_SIZE + 1];
  addRingPoint(x - dy * distance + dx * back, y + dx * distance + dy * back);
  if (cap === 'round') {
    addRingArc(x, y, -dy * distance, dx * distance, -Math.PI, slices);
  }
}


/**
 * Adds one side of a closed line to the ring, all the way around: the left of the direction
 * it's walked in.
 * @param forward - `true` to walk the points in their order (the line's left side), `false` for the other way (its right side)
 * @param distance - How far the outline is from the line
 * @param join - How to go around the outside of a corner
 * @param miterLimit - The longest miter, in distances
 * @param slices - How many slices make a half circle
 */
function addOutlineLoop(forward: boolean, distance: number, join: StrokeJoin, miterLimit: number, slices: number): void {
  const numPoints = _numPoints;
  for (let n = 0; n < numPoints; n++) {
    const i = forward ? n : numPoints - 1 - n;
    const before = ((i + numPoints - 1) % numPoints) * LINE_SIZE;   // the segment that ends at this point
    const after = i * LINE_SIZE;                                    // ..and the one that starts there
    const x = _line[after];
    const y = _line[after + 1];
    if (forward) {
      addOutlineCorner(x, y, _line[before + 2], _line[before + 3], _line[before + 4], _line[after + 2], _line[after + 3], _line[after + 4], distance, join, miterLimit, slices);
    } else {
      addOutlineCorner(x, y, -_line[after + 2], -_line[after + 3], _line[after + 4], -_line[before + 2], -_line[before + 3], _line[before + 4], distance, join, miterLimit, slices);
    }
  }
}


/**
 * Ends the ring that's being built with its first point, and copies it out.
 * @return The ring, in an array of its own
 */
function takeRing(): Float64Array {
  // (the last point may be where the first is already: then it's replaced, not followed)
  if (_numRing >= 4 && Math.abs(_ring[0] - _ring[_numRing - 2]) < EPSILON && Math.abs(_ring[1] - _ring[_numRing - 1]) < EPSILON) {
    _numRing -= 2;
  }
  const ring = new Float64Array(_numRing + 2);
  ring.set(_ring.subarray(0, _numRing));
  ring[_numRing] = _ring[0];
  ring[_numRing + 1] = _ring[1];
  _numRing = 0;
  return ring;
}


/**
 * Works out the outline of a line at a distance: the edge of the stroke that `geomStrokeMesh`
 * would fill at that half width. An open line has one ring around it. A closed one has two, one
 * outside it and one inside.
 *
 * It's for what follows a line's edge: a halo around a selected feature, or the path of a label
 * inside an area. Each side is worked out corner by corner, and nothing is cleaned up afterwards:
 * - An inside corner whose segments are shorter than the distance needs leaves a small loop
 *   (see `addOutlineCorner`), and a curve that's tighter than the distance a larger one.
 * - Parts of a line that are far apart along it and close together on the map don't know of
 *   each other: where an area is narrower than twice the distance, its inside ring crosses itself.
 *
 * So it isn't the outline for a partial fill's band, which shows every fold.
 *
 * @param coords - The line's points as `[x, y, x, y, …]`
 * @param distance - How far the outline is from the line, in the units of its coordinates
 * @param options - How to go around the ends and the corners, and whether the line is closed.
 *   Defaults to an open line with butt caps and miter joins.
 * @return The rings. Their arrays are their own.
 */
export function geomStrokeOutline(coords: ArrayLike<number>, distance: number, options: Partial<StrokeOptions> = {}): StrokeOutline {
  const cap = options.cap ?? 'butt';
  const join = options.join ?? 'miter';
  const miterLimit = options.miterLimit ?? 10;
  const slices = Math.max(1, Math.floor(options.roundSlices ?? 10));

  readLine(coords, options.closed ?? false);
  const numPoints = _numPoints;
  if (numPoints < 2) {
    return { outer: EMPTY_RING, inner: null };
  }

  _numRing = 0;
  if (!_closed) {
    addOutlineSide(true, distance, cap, join, miterLimit, slices);
    addOutlineSide(false, distance, cap, join, miterLimit, slices);
    return { outer: takeRing(), inner: null };
  }

  // Which side is the inside: the left, if the points go around counterclockwise (when y is up).
  let area = 0;
  for (let i = 0; i < numPoints; i++) {
    const k = i * LINE_SIZE;
    const k2 = ((i + 1) % numPoints) * LINE_SIZE;
    area += _line[k] * _line[k2 + 1] - _line[k2] * _line[k + 1];
  }

  addOutlineLoop(true, distance, join, miterLimit, slices);
  const left = takeRing();
  addOutlineLoop(false, distance, join, miterLimit, slices);
  const right = takeRing();
  return (area > 0) ? { outer: right, inner: left } : { outer: left, inner: right };
}


/**
 * Whether a point is within a distance of a line: inside the line's stroke at that half width,
 * with round caps and joins. It needs no outline, only the line.
 * @param coords - The line's points as `[x, y, x, y, …]`
 * @param halfWidth - The distance, in the units of the line's coordinates
 * @param x - The point
 * @param y - The point
 * @param closed - Whether the last point joins the first
 * @return `true` if the point is that close to the line
 */
export function geomStrokeContains(coords: ArrayLike<number>, halfWidth: number, x: number, y: number, closed: boolean = false): boolean {
  const numPoints = coords.length >> 1;
  if (numPoints < 1 || !(halfWidth >= 0)) return false;

  const reach = halfWidth * halfWidth;
  const numSegments = (closed && numPoints > 2) ? numPoints : numPoints - 1;
  let ax = coords[0];
  let ay = coords[1];
  if (numSegments === 0) {
    return (x - ax) * (x - ax) + (y - ay) * (y - ay) <= reach;
  }

  for (let i = 1; i <= numSegments; i++) {
    const k = (i % numPoints) * 2;
    const bx = coords[k];
    const by = coords[k + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const px = x - ax;
    const py = y - ay;
    const length2 = dx * dx + dy * dy;
    let t = (length2 > 0) ? (px * dx + py * dy) / length2 : 0;   // how far along the segment the nearest point is
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const ex = px - t * dx;
    const ey = py - t * dy;
    if (ex * ex + ey * ey <= reach) return true;
    ax = bx;
    ay = by;
  }
  return false;
}
