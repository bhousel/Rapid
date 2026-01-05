# Geo

Geometry utilities for working with coordinates, shapes, and spatial calculations.

## Overview

This module provides low-level geometric functions used throughout Rapid for coordinate transformations, shape analysis, and spatial operations.

Note: The code here should probably be moved into either `/util` or into [`@rapid-sdk/math`](https://github.com/rapideditor/rapid-sdk/tree/main/packages/math).


## Key Files

| File | Description |
|------|-------------|
| `geom.ts` | Core geometry functions (angles, distances, intersections, etc.) |
| `ortho.ts` | Orthogonalization utilities (squaring corners) |
| `index.ts` | Barrel export file |

## Common Functions

The `geom.ts` file includes utilities for:
- Calculating angles and bearings
- Finding intersections between lines
- Computing distances and areas
- Point-in-polygon tests
- Simplification algorithms
- Coordinate transformations

The `ortho.ts` file includes utilities for:
- Detecting corner angles
- Calculating orthogonalization transformations
- Determining which corners can be squared
