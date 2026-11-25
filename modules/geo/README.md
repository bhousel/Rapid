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
| `band.ts` | The band along the inside of an area's edge, which a partial fill fills: the area minus its middle (offsetting by [Clipper2](https://github.com/countertype/clipper2-ts)) |
| `stroke.ts` | What a line builder makes from a line: the triangles that draw it (built once for any width), its outline at a distance, and whether a point is within a distance of it (see "The line builder" in [`design/graphics-system.md`](../../design/graphics-system.md)) |
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
- `geomStrokeOutline` - The rings at a distance from a line: one around an open line, one outside and one inside a closed one (halos, and the path of a label inside an area). It doesn't clean up where an outline crosses itself
- `geomStrokeContains` - Whether a point is within a distance of a line (hit testing)

The `band.ts` file includes:
- `geomAreaBand` - The part of an area within a distance of its edge, as polygons with holes, or `null` if that's the whole area (it has no middle that far from its edge)

The `ortho.ts` file includes utilities for:
- Detecting corner angles
- Scoring how far a shape is from orthogonal
- Determining whether a shape can be squared
