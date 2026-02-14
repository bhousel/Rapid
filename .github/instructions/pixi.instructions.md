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

### Getting Styles from StyleSystem

For OSM features (polygons, lines, vertices, points), always get the base style from `StyleSystem.styleMatch()`:

```typescript
const styles = context.systems.styles!;
const style = styles.styleMatch(entity.tags, geometry) as MatchedStyle;

// Then apply any necessary overrides
if (node.hasInterestingTags()) {
  style.marker.image = 'taggedCircle';
}
feature.style = style;
```

**Why:** `styleMatch()` returns a fully resolved style with:
- Defaults filled in from `styleDefaults`
- Fallback cascading (base.color → marker.color, etc.)
- Selector-based style matching (highway=primary → road_primary style)
- Structure overrides (bridge, tunnel, surface)
- Lifecycle overrides (abandoned, proposed, etc.)

**Don't** construct hardcoded style objects when `styleMatch()` could be used:
```typescript
// BAD - bypasses styleMatch(), ignores custom styles
const markerStyle: Partial<MatchedStyle> = {
  icon: { image: iconName, color: 0x111111, opacity: 1, size: 11 },
  marker: { image: 'smallCircle', color: 0xffffff, opacity: 1 }
};
```

### Constant Styles for Non-OSM Features

For non-OSM layers (photos, QA issues, debug overlays), define constant style objects. All style properties are **optional** — use type assertions:

```typescript
import type { MatchedStyle } from '../core/StyleSystem.ts';

const LINESTYLE = {
  casing: { alpha: 0 },
  stroke: { alpha: 0.7, width: 4, color: 0x0fffc4 }
} as Partial<MatchedStyle>;

const MARKERSTYLE = {
  marker: { image: 'mediumCircle', color: 0x0fffc4, opacity: 0.8 }
} as Partial<MatchedStyle>;
```

Style type interfaces are defined in `modules/lib/Style.ts`:
- `StyleProps` — Full style with all property groups
- `FillStyleProps` — Area fill (color, opacity, width, pattern)
- `LineStyleProps` — Line casing/stroke (color, opacity, width, cap, join, dash)
- `PointStyleProps` — Marker, icon, lineMarker, sidedMarker (color, opacity, image, size, anchor, scale)
- `ViewfieldStyleProps` — Extends PointStyleProps with `angles` array
- `LabelStyleProps` — Label (color, opacity, size)

The resolved style returned by `StyleSystem.styleMatch()` is a `MatchedStyle` (defined in `modules/core/StyleSystem.ts`).

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

