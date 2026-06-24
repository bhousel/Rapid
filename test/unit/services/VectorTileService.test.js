import { beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('VectorTileService', () => {
  // Setup context..
  // VectorTileService only requires `network` + `spatial`; `gfx` is optional and is
  // safely skipped here (the service no-ops on `gfx?.deferredRedraw()`).
  const context = new Rapid.MockContext();
  context.systems = {
    network: new Rapid.NetworkSystem(context),
    spatial: new Rapid.SpatialSystem(context)
  };

  const TEMPLATE = 'https://example.com/{z}/{x}/{y}.vector.pbf';


  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build a GeoJSON Polygon Feature from WGS84 [west, south, east, north]. */
  function rect(w, s, e, n, props) {
    return {
      type: 'Feature',
      properties: { ...props },
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
    };
  }

  /** Build a GeoJSON Polygon from fractional [x0,y0,x1,y1] coords (0..1) within a tile. */
  function subRect(tile, x0, y0, x1, y1, props) {
    const ex = tile.wgs84Extent;
    const w = ex.max[0] - ex.min[0];
    const h = ex.max[1] - ex.min[1];
    return rect(ex.min[0] + w * x0, ex.min[1] + h * y0, ex.min[0] + w * x1, ex.min[1] + h * y1, props);
  }

  /** Build a GeoJSON LineString Feature. */
  function line(coords, props) {
    return {
      type: 'Feature',
      properties: { ...props },
      geometry: { type: 'LineString', coordinates: coords }
    };
  }


  let _service;
  let _source;

  beforeEach(async () => {
    _service = new Rapid.VectorTileService(context);
    await _service.initAsync();
    await _service.resetAsync();   // clear any `vt-` spatial caches left by a prior test

    // Set up a viewport large enough that the tiler returns a 2x2+ block of tiles.
    // The absolute location doesn't matter - feature coords are derived from the tile extents.
    context.viewport.transform = { x: -100000, y: -100000, z: 16 };
    context.viewport.dimensions = [1024, 1024];

    _source = await _service._getSourceAsync(TEMPLATE);
  });

  /** Find a mutually-adjacent 2x2 block among the tiles covering the viewport. */
  function getGrid() {
    const tiles = _source.tiler.getTiles(context.viewport).tiles;
    const byId = new Map(tiles.map(t => [t.id, t]));
    for (const TL of tiles) {
      const [x, y, z] = TL.xyz;
      const TR = byId.get(`${x + 1},${y},${z}`);
      const BL = byId.get(`${x},${y + 1},${z}`);
      const BR = byId.get(`${x + 1},${y + 1},${z}`);
      if (TR && BL && BR) return { TL, TR, BL, BR, z };
    }
    throw new Error('test setup: viewport did not yield a 2x2 tile block');
  }

  /** Feed parsed features into a tile (mimics a completed tile fetch + parse). */
  function feed(tile, features) {
    _source.loaded.set(tile.id, tile);
    const results = features.map((feature, i) => ({ layerID: 'test', origID: i + 1, feature }));
    _service._processVTResults(_source, tile, results);
  }

  /** All GeoJSONData currently cached for the given zoom. */
  function cached(z) {
    return context.systems.spatial.getAllItems(`vt-${_source.id}-z${z}`);
  }

  /** WGS84 extent of a cached GeoJSONData feature. */
  function extentOf(d) {
    return _service._calcExtent(d.props.geojson);
  }


  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a VectorTileService from a context', () => {
        const service = new Rapid.VectorTileService(context);
        assert.instanceOf(service, Rapid.VectorTileService);
        assert.strictEqual(service.id, 'vectortile');
        assert.strictEqual(service.context, context);
        assert.instanceOf(service.requiredDependencies, Set);
        assert.isTrue(service.requiredDependencies.has('network'));
        assert.isTrue(service.requiredDependencies.has('spatial'));
        assert.isTrue(service.optionalDependencies.has('gfx'));
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const service = new Rapid.VectorTileService(context);
        const prom = service.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('rejects if a required dependency is missing', () => {
        const service = new Rapid.VectorTileService(context);
        service.requiredDependencies.add('missing');
        return service.initAsync()
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(String(err), /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const service = new Rapid.VectorTileService(context);
        return service.initAsync()
          .then(() => service.startAsync())
          .then(() => assert.isTrue(service._started));
      });
    });

    describe('resetAsync', () => {
      it('clears sources and cached data', async () => {
        const { TL, z } = getGrid();
        feed(TL, [ subRect(TL, 0.4, 0.4, 0.6, 0.6, { leisure: 'park' }) ]);
        assert.isAbove(cached(z).length, 0, 'data cached before reset');
        assert.strictEqual(_service._sources.size, 1, 'source exists before reset');

        await _service.resetAsync();
        assert.strictEqual(_service._sources.size, 0, 'sources cleared');
        assert.lengthOf(cached(z), 0, 'spatial cache cleared');
      });
    });
  });


  // ---------------------------------------------------------------------------
  // _getSourceAsync
  // ---------------------------------------------------------------------------
  describe('_getSourceAsync', () => {
    it('creates a source for a z/x/y template', async () => {
      const src = await _service._getSourceAsync(TEMPLATE);
      assert.isString(src.id);
      assert.strictEqual(src.template, TEMPLATE);
      assert.exists(src.tiler);
      assert.instanceOf(src.loaded, Map);
      assert.strictEqual(src.loaded.size, 0);
      assert.isNull(src.lastv);
    });

    it('returns the same source object for the same template', async () => {
      const a = await _service._getSourceAsync(TEMPLATE);
      const b = await _service._getSourceAsync(TEMPLATE);
      assert.strictEqual(a, b);
    });

    it('gives each source its own tiler (no cross-source zoom-range leakage)', async () => {
      const a = await _service._getSourceAsync(TEMPLATE);
      const b = await _service._getSourceAsync('https://other.example.com/{z}/{x}/{y}.pbf');
      assert.notStrictEqual(a.tiler, b.tiler);
    });

    it('rejects when no template is given', () => {
      return _service._getSourceAsync('')
        .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
        .catch(err => assert.match(String(err), /no template/i));
    });
  });


  // ---------------------------------------------------------------------------
  // _processVTResults
  // ---------------------------------------------------------------------------
  describe('_processVTResults', () => {
    it('adds parsed features to the spatial cache', () => {
      const { TL, z } = getGrid();
      feed(TL, [ subRect(TL, 0.4, 0.4, 0.6, 0.6, { leisure: 'park' }) ]);

      const data = cached(z);
      assert.lengthOf(data, 1);
      assert.instanceOf(data[0], Rapid.GeoJSONData);
    });

    it('splits Multi features into single-part features', () => {
      const { TL, z } = getGrid();
      const ex = TL.wgs84Extent;
      const w = ex.max[0] - ex.min[0];
      const h = ex.max[1] - ex.min[1];
      const multi = {
        type: 'Feature',
        properties: { leisure: 'park' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            rect(ex.min[0] + w * 0.1, ex.min[1] + h * 0.1, ex.min[0] + w * 0.3, ex.min[1] + h * 0.3).geometry.coordinates,
            rect(ex.min[0] + w * 0.6, ex.min[1] + h * 0.6, ex.min[0] + w * 0.8, ex.min[1] + h * 0.8).geometry.coordinates
          ]
        }
      };
      feed(TL, [ multi ]);

      assert.lengthOf(cached(z), 2, 'MultiPolygon split into two single-part features');
    });
  });


  // ---------------------------------------------------------------------------
  // Cross-tile merging (issue Rapid#1080)
  // ---------------------------------------------------------------------------
  describe('merging across tile edges', () => {
    const PARK = { leisure: 'park' };

    it('reassembles a polygon split across a vertical tile edge', () => {
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];                            // shared longitude
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;                                        // buffer past the edge
      const s = TL.wgs84Extent.min[1] + h * 0.25;
      const n = TL.wgs84Extent.min[1] + h * 0.75;

      feed(TL, [ rect(TL.wgs84Extent.min[0] + w * 0.1, s, L + dx, n, PARK) ]);
      feed(TR, [ rect(L - dx, s, TR.wgs84Extent.max[0] - w * 0.1, n, PARK) ]);
      assert.lengthOf(cached(z), 2, 'two pieces before merge');

      _service._performMerges(_source);

      const merged = cached(z);
      assert.lengthOf(merged, 1, 'one feature after merge');
      const ext = extentOf(merged[0]);
      assert.isBelow(ext.min[0], L, 'merged feature reaches into the left tile');
      assert.isAbove(ext.max[0], L, 'merged feature reaches into the right tile');
    });

    it('reassembles a polygon split across a horizontal tile edge', () => {
      const { TL, BL, z } = getGrid();
      const Ly = TL.wgs84Extent.min[1];                          // shared latitude
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dy = h * 0.05;
      const wlon0 = TL.wgs84Extent.min[0] + w * 0.25;
      const wlon1 = TL.wgs84Extent.min[0] + w * 0.75;

      feed(TL, [ rect(wlon0, Ly - dy, wlon1, TL.wgs84Extent.max[1] - h * 0.1, PARK) ]);
      feed(BL, [ rect(wlon0, BL.wgs84Extent.min[1] + h * 0.1, wlon1, Ly + dy, PARK) ]);
      assert.lengthOf(cached(z), 2, 'two pieces before merge');

      _service._performMerges(_source);

      const merged = cached(z);
      assert.lengthOf(merged, 1, 'one feature after merge');
      const ext = extentOf(merged[0]);
      assert.isBelow(ext.min[1], Ly, 'merged feature reaches into the bottom tile');
      assert.isAbove(ext.max[1], Ly, 'merged feature reaches into the top tile');
    });

    it('merges across an edge even when the second tile loads in a later pass', () => {
      // Incremental correctness: TL is merged on its own first, then TR loads in a separate pass.
      // TR is the only new tile, so the sweep must still process TR's *left* edge back to TL.
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      const s = TL.wgs84Extent.min[1] + h * 0.25;
      const n = TL.wgs84Extent.min[1] + h * 0.75;

      feed(TL, [ rect(TL.wgs84Extent.min[0] + w * 0.1, s, L + dx, n, { leisure: 'park' }) ]);
      _service._performMerges(_source);
      assert.lengthOf(cached(z), 1, 'TL piece present, queued on its (not-yet-loaded) east edge');

      feed(TR, [ rect(L - dx, s, TR.wgs84Extent.max[0] - w * 0.1, n, { leisure: 'park' }) ]);
      _service._performMerges(_source);
      assert.lengthOf(cached(z), 1, 'TL and TR pieces merged across separate passes');
    });

    it('reassembles a polygon spanning a 2x2 block of tiles loaded out of order', () => {
      const { TL, TR, BL, BR, z } = getGrid();
      const Lx = TL.wgs84Extent.max[0];   // vertical boundary (left|right columns)
      const Ly = TL.wgs84Extent.min[1];   // horizontal boundary (top|bottom rows)
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      const dy = h * 0.05;
      const pw = TL.wgs84Extent.min[0] + w * 0.1;   // park west
      const pe = TR.wgs84Extent.max[0] - w * 0.1;   // park east
      const pn = TL.wgs84Extent.max[1] - h * 0.1;   // park north
      const ps = BL.wgs84Extent.min[1] + h * 0.1;   // park south

      // Each quadrant of the park, clipped to its tile (+ a small buffer past internal edges).
      const pieces = [
        [BR, rect(Lx - dx, ps, pe, Ly + dy, PARK)],
        [TL, rect(pw, Ly - dy, Lx + dx, pn, PARK)],
        [BL, rect(pw, ps, Lx + dx, Ly + dy, PARK)],
        [TR, rect(Lx - dx, Ly - dy, pe, pn, PARK)]
      ];
      for (const [tile, feature] of pieces) {   // intentionally scrambled order
        feed(tile, [ feature ]);
      }
      assert.lengthOf(cached(z), 4, 'four pieces before merge');

      _service._performMerges(_source);

      const merged = cached(z);
      assert.lengthOf(merged, 1, 'the four pieces reassemble into one feature');

      // The merged feature should cover the center of every tile.
      const ext = extentOf(merged[0]);
      for (const tile of [TL, TR, BL, BR]) {
        const c = tile.wgs84Extent.center();
        const covered = c[0] >= ext.min[0] && c[0] <= ext.max[0] && c[1] >= ext.min[1] && c[1] <= ext.max[1];
        assert.isTrue(covered, `merged feature covers the center of tile ${tile.id}`);
      }
    });

    it('is idempotent - a redundant pass does not churn already-merged features', () => {
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      const s = TL.wgs84Extent.min[1] + h * 0.25;
      const n = TL.wgs84Extent.min[1] + h * 0.75;

      feed(TL, [ rect(TL.wgs84Extent.min[0] + w * 0.1, s, L + dx, n, PARK) ]);
      feed(TR, [ rect(L - dx, s, TR.wgs84Extent.max[0] - w * 0.1, n, PARK) ]);

      _service._performMerges(_source);
      const after1 = cached(z);
      assert.lengthOf(after1, 1, 'merged on the first pass');
      const id = after1[0].id;

      _service._performMerges(_source);   // run again
      const after2 = cached(z);
      assert.lengthOf(after2, 1, 'still one feature');
      assert.strictEqual(after2[0].id, id, 'feature id is unchanged (no churn)');
    });

    it('keeps distinct same-property features apart when they are not adjacent', () => {
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      // Two disjoint latitude bands, both straddling the edge, identical properties.
      const aS = TL.wgs84Extent.min[1] + h * 0.6, aN = TL.wgs84Extent.min[1] + h * 0.8;
      const bS = TL.wgs84Extent.min[1] + h * 0.2, bN = TL.wgs84Extent.min[1] + h * 0.4;
      const lw = TL.wgs84Extent.min[0] + w * 0.1;
      const rw = TR.wgs84Extent.max[0] - w * 0.1;

      feed(TL, [ rect(lw, aS, L + dx, aN, PARK), rect(lw, bS, L + dx, bN, PARK) ]);
      feed(TR, [ rect(L - dx, aS, rw, aN, PARK), rect(L - dx, bS, rw, bN, PARK) ]);
      assert.lengthOf(cached(z), 4, 'four pieces before merge');

      _service._performMerges(_source);

      assert.lengthOf(cached(z), 2, 'each band reassembles, but the two bands stay separate');
    });

    it('does not merge or churn disjoint same-property features that merely touch the edge', () => {
      // Two parks with identical properties that both touch the A|B edge from their own side, but
      // are completely disjoint from each other (no overlap).  The union returns 2 parts = input
      // count, so nothing should be replaced and the features should keep their original ids.
      //
      //    A  ┆    B
      //  ┌────┐
      //  └────┘
      //       ┆
      //       ┌────┐
      //       └────┘
      //       ┆
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];   // A|B boundary
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];

      // Park A is entirely in tile TL but its right edge = L (touches the boundary).
      const parkA = rect(TL.wgs84Extent.min[0] + w * 0.1, h * 0.6, L, h * 0.9, PARK);
      // Park B is entirely in tile TR but its left edge = L (touches the boundary).
      const parkB = rect(L, h * 0.1, TR.wgs84Extent.max[0] - w * 0.1, h * 0.4, PARK);

      feed(TL, [ parkA ]);
      feed(TR, [ parkB ]);
      assert.lengthOf(cached(z), 2, 'two disjoint features before merge attempt');

      const idA = cached(z).find(d => extentOf(d).max[0] <= L)?.id;
      const idB = cached(z).find(d => extentOf(d).min[0] >= L)?.id;
      assert.exists(idA, 'park A found');
      assert.exists(idB, 'park B found');

      _service._performMerges(_source);

      assert.lengthOf(cached(z), 2, 'still two features - they did not merge');
      // The features must not have been replaced with new objects (no id churn).
      assert.strictEqual(cached(z).find(d => d.id === idA)?.id, idA, 'park A id unchanged');
      assert.strictEqual(cached(z).find(d => d.id === idB)?.id, idB, 'park B id unchanged');
    });

    it('does not merge features with different properties', () => {
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      const s = TL.wgs84Extent.min[1] + h * 0.25;
      const n = TL.wgs84Extent.min[1] + h * 0.75;
      const lw = TL.wgs84Extent.min[0] + w * 0.1;
      const rw = TR.wgs84Extent.max[0] - w * 0.1;
      const WATER = { natural: 'water' };

      feed(TL, [ rect(lw, s, L + dx, n, PARK), rect(lw, s, L + dx, n, WATER) ]);
      feed(TR, [ rect(L - dx, s, rw, n, PARK), rect(L - dx, s, rw, n, WATER) ]);
      assert.lengthOf(cached(z), 4, 'four pieces before merge');

      _service._performMerges(_source);

      // park pieces merge with each other, water pieces merge with each other, but not across.
      assert.lengthOf(cached(z), 2, 'park and water reassemble independently');
    });

    it('does not stitch lines that share no coincident segment', () => {
      // Two pieces that overlap geometrically but share no identical segment (2-point lines) - this
      // also covers the road-junction case (a shared point is not enough to stitch).
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const dx = w * 0.05;
      const mid = TL.wgs84Extent.min[1] + h * 0.5;

      feed(TL, [ line([[TL.wgs84Extent.min[0] + w * 0.1, mid], [L + dx, mid]], { highway: 'residential' }) ]);
      feed(TR, [ line([[L - dx, mid], [TR.wgs84Extent.max[0] - w * 0.1, mid]], { highway: 'residential' }) ]);
      assert.lengthOf(cached(z), 2, 'two line pieces before merge');

      _service._performMerges(_source);

      assert.lengthOf(cached(z), 2, 'left untouched (no coincident segment to stitch on)');
    });

    it.skip('stitches LineStrings split across a tile edge (trimming buffer stubs)', () => {
      // NOTE: line stitching is currently disabled in _considerForMerge ('// for now').
      // (the tile-buffer overlap) plus a clip stub past the boundary.  The shared p-q segment lets
      // us stitch them, and the stubs (clipA/clipB) get pruned.
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const mid = TL.wgs84Extent.min[1] + h * 0.5;
      const a = [L - w * 0.4, mid];        // well inside TL
      const p = [L - w * 0.02, mid];       // shared (buffer band)
      const q = [L + w * 0.02, mid];       // shared (buffer band)
      const b = [L + w * 0.4, mid];        // well inside TR
      const clipA = [L + w * 0.05, mid];   // TL's clip stub (past the edge)
      const clipB = [L - w * 0.05, mid];   // TR's clip stub (before the edge)

      feed(TL, [ line([a, p, q, clipA], { highway: 'residential' }) ]);
      feed(TR, [ line([clipB, p, q, b], { highway: 'residential' }) ]);
      assert.lengthOf(cached(z), 2, 'two line pieces before stitch');

      _service._performMerges(_source);

      const merged = cached(z);
      assert.lengthOf(merged, 1, 'stitched into a single line');
      const coords = merged[0].geoms.parts[0].orig.coords;
      assert.lengthOf(coords, 4, 'buffer stubs trimmed - original 4 vertices kept');
      const lons = coords.map(c => c[0]);
      assert.isBelow(Math.min(...lons), L, 'line reaches into the left tile');
      assert.isAbove(Math.max(...lons), L, 'line reaches into the right tile');
    });

    it('reassembles a C-shape whose arms are disconnected in the middle tiles', () => {
      // A "C" opening to the right, spanning three tiles in a row (A | B | C).  The left wall lives
      // in tile A and joins both arms there, so in the middle/right tiles (B, C) the top and bottom
      // arms are *separate* pieces.  This is the case where merging the B|C edge reassembles each
      // arm without dropping the overall piece count - the per-component progress check must still
      // see each arm-merge as progress, and the notch must survive into the final feature.
      //
      //    A    ┆    B    ┆   C
      //  ┌──────┆─────────┆──────┐
      //  │  ┌───┆─────────┆──────┘   <- top arm
      //  │  │   ┆(hollow) ┆
      //  │  └───┆─────────┆──────┐
      //  └──────┆─────────┆──────┘   <- bottom arm
      //
      const tiles = _source.tiler.getTiles(context.viewport).tiles;
      const byId = new Map(tiles.map(t => [t.id, t]));
      let A, B, C;
      for (const t of tiles) {
        const [x, y, zz] = t.xyz;
        const right = byId.get(`${x + 1},${y},${zz}`);
        const right2 = byId.get(`${x + 2},${y},${zz}`);
        if (right && right2) { A = t; B = right; C = right2; break; }
      }
      if (!A) throw new Error('test setup: viewport did not yield three tiles in a row');

      const z = A.xyz[2];
      const PARK = { leisure: 'park' };
      const w = A.wgs84Extent.max[0] - A.wgs84Extent.min[0];
      const h = A.wgs84Extent.max[1] - A.wgs84Extent.min[1];
      const s0 = A.wgs84Extent.min[1];        // tiles' south edge
      const dx = w * 0.05;                     // buffer past shared edges
      const Lab = A.wgs84Extent.max[0];        // A|B boundary
      const Lbc = B.wgs84Extent.max[0];        // B|C boundary
      const pw = A.wgs84Extent.min[0] + w * 0.1;    // park west (in A)
      const ce = C.wgs84Extent.max[0] - w * 0.1;    // park east (in C)
      const n = s0 + h * 0.9;                  // park north
      const s = s0 + h * 0.1;                  // park south
      const topArmBot = s0 + h * 0.65;         // bottom of the top arm
      const botArmTop = s0 + h * 0.35;         // top of the bottom arm
      const leftWallRight = A.wgs84Extent.min[0] + w * 0.4;

      // Tile A: a single C-shaped polygon (left wall + both arm stubs, all connected).
      const cShape = {
        type: 'Feature',
        properties: { ...PARK },
        geometry: { type: 'Polygon', coordinates: [[
          [pw, s],
          [Lab + dx, s],
          [Lab + dx, botArmTop],
          [leftWallRight, botArmTop],
          [leftWallRight, topArmBot],
          [Lab + dx, topArmBot],
          [Lab + dx, n],
          [pw, n],
          [pw, s]
        ]] }
      };

      // Tiles B and C: top and bottom arms as separate pieces (the notch splits them).
      const pieces = [
        [C, rect(Lbc - dx, s, ce, botArmTop, PARK)],          // C bottom arm
        [A, cShape],
        [B, rect(Lab - dx, topArmBot, Lbc + dx, n, PARK)],    // B top arm
        [C, rect(Lbc - dx, topArmBot, ce, n, PARK)],          // C top arm
        [B, rect(Lab - dx, s, Lbc + dx, botArmTop, PARK)]     // B bottom arm
      ];
      for (const [tile, feature] of pieces) {   // intentionally scrambled order
        feed(tile, [ feature ]);
      }
      assert.lengthOf(cached(z), 5, 'five pieces before merge (1 in A, 2 in B, 2 in C)');

      _service._performMerges(_source);

      const merged = cached(z);
      assert.lengthOf(merged, 1, 'the C reassembles into a single feature');

      // The notch must survive - it should be a C, not a filled rectangle.
      const poly = merged[0].props.geojson.geometry.coordinates[0];  // outer ring
      const midLon = B.wgs84Extent.center()[0];
      assert.isTrue(Rapid.sdk.geomPointInPolygon([midLon, s0 + h * 0.775], poly), 'top arm is filled');
      assert.isTrue(Rapid.sdk.geomPointInPolygon([midLon, s0 + h * 0.225], poly), 'bottom arm is filled');
      assert.isFalse(Rapid.sdk.geomPointInPolygon([midLon, s0 + h * 0.5], poly), 'the notch stays hollow');
    });

    it('merges heavily-overlapping buffer copies of a crossing feature', () => {
      // Simulate MVT tile buffers: each tile carries a copy that extends well past the shared edge,
      // so the two copies overlap in a wide band rather than meeting cleanly at the seam.  They must
      // still collapse to a single feature with no leftover overlap.
      const { TL, TR, z } = getGrid();
      const L = TL.wgs84Extent.max[0];
      const w = TL.wgs84Extent.max[0] - TL.wgs84Extent.min[0];
      const h = TL.wgs84Extent.max[1] - TL.wgs84Extent.min[1];
      const buf = w * 0.25;   // wide overlap band straddling the edge
      const s = TL.wgs84Extent.min[1] + h * 0.25;
      const n = TL.wgs84Extent.min[1] + h * 0.75;

      feed(TL, [ rect(TL.wgs84Extent.min[0] + w * 0.1, s, L + buf, n, { leisure: 'park' }) ]);
      feed(TR, [ rect(L - buf, s, TR.wgs84Extent.max[0] - w * 0.1, n, { leisure: 'park' }) ]);
      assert.lengthOf(cached(z), 2, 'two overlapping copies before merge');

      _service._performMerges(_source);
      assert.lengthOf(cached(z), 1, 'overlapping copies collapse into one');
    });
  });


  // ---------------------------------------------------------------------------
  // getData
  // ---------------------------------------------------------------------------
  describe('getData', () => {
    it('returns an empty array for an unknown template', () => {
      assert.lengthOf(_service.getData('https://unknown.example.com/{z}/{x}/{y}'), 0);
    });

    it('returns cached data visible in the current map view', () => {
      const tiles = _source.tiler.getTiles(context.viewport).tiles;
      const c = context.viewport.visibleWorldExtent().center();
      const tile = tiles.find(t => {
        const b = t.worldExtent.bbox();
        return c[0] >= b.minX && c[0] <= b.maxX && c[1] >= b.minY && c[1] <= b.maxY;
      }) ?? tiles[0];

      feed(tile, [ subRect(tile, 0.4, 0.4, 0.6, 0.6, { leisure: 'park' }) ]);

      const data = _service.getData(TEMPLATE);
      assert.lengthOf(data, 1);
      assert.instanceOf(data[0], Rapid.GeoJSONData);
    });
  });

});
