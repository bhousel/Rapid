---
applyTo: "modules/pixi/**"
---

# Pixi Module Guidelines

Guidelines for working with the `modules/pixi/` folder during TypeScript conversion.

## Working with Untyped Services

All services are still JavaScript and should be cast `as any`:
- Example: `const mapillary = context.services.mapillary as any;`

All core systems ARE now TypeScript - use non-null assertion:
- `const photos = context.systems.photos!;`
- `const editor = context.systems.editor!;`

Use `!` for systems that definitely exist when the code runs. Only use `?.` for truly optional dependencies (see `copilot-instructions.md` for the list of optional systems).

## Viewport Type

Import `Viewport` from `@rapid-sdk/math`, not from `pixi-viewport`:
```typescript
import type { Viewport } from '@rapid-sdk/math';
```

## Style Objects

All style properties are **optional**. Use type assertions (`as`) when defining constant style objects:

```typescript
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint, type PointStyle } from './PixiFeaturePoint.ts';

import type { MatchedStyle } from '../core/StyleSystem.ts';

const LINESTYLE = {
  casing: { alpha: 0 },
  stroke: { alpha: 0.7, width: 4, color: 0x0fffc4 }
} as Partial<MatchedStyle>;

const MARKERSTYLE: Partial<PointStyle> = {
  marker: { name: 'mediumCircle', tint: 0x0fffc4, alpha: 0.8 }
};
```

When creating dynamic styles, use `Object.assign()` with spread or mutation:
```typescript
const style: Partial<PointStyle> = Object.assign({}, MARKERSTYLE);
style.viewfieldAngles = [bearing];
```

## Type-Only Imports

When importing data classes (`GeoJSON`, `Marker`) only for type annotations, use `import type`:
```typescript
import type { GeoJSON } from '../data/GeoJSON.ts';
import type { Marker } from '../data/Marker.ts';
```

## Filtering Data (Marker, GeoJSON, etc.)

When filtering `Marker` or `GeoJSON` data, always access `.props` for filterable data (not `.properties`):

```typescript
filterMarkers(markers: Marker[]): Marker[] {
  return markers.filter(marker => {
    const props = marker.props;
    // Check types before using values
    const capturedAt = props.captured_at;
    if (typeof capturedAt === 'number' || typeof capturedAt === 'string') {
      const timestamp = new Date(capturedAt).getTime();
      if (fromTimestamp && fromTimestamp > timestamp) return false;
    }
    return true;
  });
}
```

Key points:
- Use `marker.props` or `sequence.props` (not `.properties`)
- Extract values into variables and check their types before using
- Cast when needed: `props.captured_by as string`

## D3 Selection Callbacks

D3's `.data()` and other selection methods have complex generic signatures. TypeScript often can't infer the datum type in callbacks. Explicitly annotate callback parameters:
```typescript
.data(blocks, (d: GeoJSON) => d.id)
.text((d: GeoJSON) => d.props.text as string)
```

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

