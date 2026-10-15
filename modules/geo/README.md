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
| `index.ts` | Barrel export file |

## Common Functions

The `geom.ts` file includes:
- `geomCoverageBoxes` - Cover a point or polyline with a chain of square boxes (a fast approximate buffer, used for conflation coverage and label placement)
- `geoMetersToWorld` - Convert a distance in meters to world units at a given latitude (used for conflation buffer radii)
- `geomLineSegments` - Break a line into evenly-spaced positions that share a heading (used to place oneway arrows and sided markers)
- `geoHasSelfIntersections` - Test whether a way being dragged or drawn intersects itself

The `ortho.ts` file includes utilities for:
- Detecting corner angles
- Scoring how far a shape is from orthogonal
- Determining whether a shape can be squared
