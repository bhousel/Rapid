# Geo

Geometry utilities for working with coordinates, shapes, and spatial calculations.

## Overview

This module provides a few low-level geometric functions used by Rapid for line layout, coverage, and shape analysis. Most general-purpose vector and geometry math (angles, distances, intersections, extents, projections) lives in [`@rapid-sdk/math`](https://github.com/rapideditor/rapid-sdk/tree/main/packages/math).

Note: The code here should probably be moved into either `/util` or into [`@rapid-sdk/math`](https://github.com/rapideditor/rapid-sdk/tree/main/packages/math).


## Key Files

| File | Description |
|------|-------------|
| `geom.ts` | Line layout, coverage boxes, and self-intersection tests |
| `ortho.ts` | Orthogonalization utilities (squaring corners) |
| `stroke.ts` | The triangles that draw a line, built once for any width (see [`design/graphics-system.md`](../../design/graphics-system.md) section 15) |
| `index.ts` | Barrel export file |

## Common Functions

The `geom.ts` file includes:
- `geomCoverageBoxes` - Cover a point or polyline with a chain of square boxes, evenly spaced along the whole line (a fast approximate buffer, used for conflation coverage)
- `geomLineDistances`, `geomPositionAlong`, `geomHeadingAlong` - Find the position at a distance along a line, and the line's heading there measured over a window (used by `geomCoverageBoxes` and conflation)
- `geoMetersToWorld` - Convert a distance in meters to world units at a given latitude (used for conflation buffer radii)
- `geomLineSegments` - Break a line into evenly-spaced positions that share a heading (used to place oneway arrows and sided markers)
- `geoHasSelfIntersections` - Test whether a way being dragged or drawn intersects itself

The `stroke.ts` file includes:
- `geomStrokeMesh` - Build a line's triangles, with caps and joins. Each vertex is a point on the line and a direction away from it, so the mesh doesn't depend on the line's width
- `geomStrokePositions`, `geomStrokeUVs` - Work out the vertices' positions and texture coordinates for a width, into an array that can be reused

The `ortho.ts` file includes utilities for:
- Detecting corner angles
- Scoring how far a shape is from orthogonal
- Determining whether a shape can be squared
