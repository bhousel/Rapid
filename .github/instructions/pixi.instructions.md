---
applyTo: "modules/pixi/**"
---

# Pixi Module Guidelines

Guidelines for working with the `modules/pixi/` folder during TypeScript conversion.

## GraphicsSystem Access

- `GraphicsSystem` (`modules/core/GraphicsSystem.js`) is not yet converted to TypeScript
- Cast it as `any`: `const gfx = context.systems.gfx as any;`
- Use non-null assertion `!.` (not optional chaining `?.`) since gfx **definitely exists** when layers are running
- Example: `gfx!.immediateRedraw();`

## Other Untyped Systems and Services

Services not yet converted to TypeScript should be cast `as any`:
- Example: `const mapillary = context.services.mapillary;` (already typed loosely)

Systems that ARE converted (use non-null assertion, not `as any`):
- `photos`: `const photos = context.systems.photos!;` (PhotoSystem is typed)

Use `!.` for systems that definitely exist when the code runs. Only use `?.` for truly optional dependencies.

## Viewport Type

Import `Viewport` from `@rapid-sdk/math`, not from `pixi-viewport`:
```typescript
import type { Viewport } from '@rapid-sdk/math';
```

## Style Objects

Use the proper style type from the feature class:
- `PixiFeaturePoint` → `PointStyle`
- `PixiFeatureLine` → `LineStyle`
- `PixiFeaturePolygon` → `PolygonStyle`

```typescript
import { PixiFeaturePoint, type PointStyle } from './PixiFeaturePoint.ts';

const style: PointStyle = Object.assign({}, MARKERSTYLE);
style.viewfieldAngles = [bearing];
```

## D3 Selection Callbacks

D3's `.data()` and other selection methods have complex generic signatures. TypeScript often can't infer the datum type in callbacks. Explicitly annotate callback parameters:
```typescript
.data(blocks, (d: GeoJSON) => d.id)
.text((d: GeoJSON) => d.properties.text as string)
```

## GeoJSON Class vs GeoJSON Feature Properties

The `GeoJSON` class from `../data/GeoJSON.ts` wraps GeoJSON data:
- `d.props` → `GeoJSONProps` (class properties: `id`, `geojson`, `serviceID`, etc.)
- `d.properties` → `Record<string, unknown>` (the wrapped GeoJSON feature's properties)

Use `.properties` to access feature-level data like `text`, `url`, `captured_at`, etc.

## ScaleLinear Import

Consolidate d3-scale imports to avoid duplicate import warnings:
```typescript
import { scaleLinear, type ScaleLinear } from 'd3-scale';
```
Not:
```typescript
import { scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';  // duplicate!
```
