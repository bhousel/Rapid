# Style System Design

This document describes the design for Rapid's map styling system, including the data model, matching logic, and external style file format.

## Overview

The StyleSystem manages how map features are visually rendered. It determines colors, line widths, dash patterns, and fill patterns based on feature properties (tags), geometry type, and dataset source.

**Goals:**
- Externalize style definitions to JSON5 files for easy customization
- Support dataset-aware styling (e.g., OSM vs Rapid AI suggestions)
- Composable styles via multi-selector matching
- Lightweight, testable classes with minimal dependencies

## Core Concepts

### Style

A **Style** describes *what something looks like*. It contains visual properties for rendering.

Styles have property groups for each visual element: fill (areas), casing/stroke (lines), marker/icon (points), viewfield (photo directions), lineMarker/sidedMarker (line decorations), and label (text).

```typescript
interface StyleProps {
  id: StyleID;
  assetID?: AssetID;         // The asset this style came from
  assetVersion?: string;     // Version of the asset

  base?: BaseStyleProps;     // Base properties (fallback color)
  fill?: FillStyleProps;     // Area fill properties
  casing?: LineStyleProps;   // Line casing (draws below stroke)
  stroke?: LineStyleProps;   // Line stroke (draws above casing)
  marker?: PointStyleProps;  // Point marker (background shape)
  icon?: PointStyleProps;    // Icon (rendered inside marker)
  viewfield?: ViewfieldStyleProps;  // Viewfield (photo directions)
  lineMarker?: PointStyleProps;     // Repeating line markers (e.g. oneway arrows)
  sidedMarker?: PointStyleProps;    // One-sided markers (e.g. cliffs)
  label?: LabelStyleProps;   // Label properties
}

interface BaseStyleProps {
  color?: number;            // Fallback color, used if fill/stroke don't specify one
  opacity?: number;
}

interface FillStyleProps {
  color?: number;            // Hex color, e.g. 0xcf2081
  opacity?: number;          // Opacity: 0 = transparent, 1 = opaque
  width?: number;            // Outline width in pixels
  pattern?: string;          // Fill pattern ID, e.g. 'grass', 'waves'
  type?: 'full' | 'partial'; // Fill type
}

interface LineStyleProps {
  color?: number;            // Hex color
  opacity?: number;          // Opacity
  width?: number;            // Line width in pixels
  cap?: 'butt' | 'round' | 'square';
  join?: 'bevel' | 'miter' | 'round';
  dash?: number[];           // Dash pattern, e.g. [10, 5] for 10px on, 5px off
}

interface PointStyleProps {
  color?: number;            // Display color applied to the graphic
  opacity?: number;          // Opacity
  image?: string;            // Image identifier (symbol name from spritesheet)
  size?: number;             // Size in pixels
  anchor?: Vec2;             // Anchor position [x, y] where [0.5, 0.5] = centered
  scale?: number | Vec2;     // Scale multiplier: uniform or per-axis [x, y]
}

interface ViewfieldStyleProps extends PointStyleProps {
  angles?: number[];         // Angles (degrees) that viewfields extend from the point
}

interface LabelStyleProps {
  color?: number;            // Display color
  opacity?: number;          // Opacity
  size?: number;             // Size in pixels
}
```

**Examples:**
```json5
// A simple fill color
"green": {
  "fill": { "color": 0x8cd05f, "opacity": 0.3 }
}

// A road with casing and stroke
"motorway": {
  "casing": { "width": 10, "color": 0x70372f },
  "stroke": { "width": 8, "color": 0xcf2081 }
}

// A dashed path
"footway": {
  "casing": { "width": 5, "color": 0xffffff },
  "stroke": { "width": 3, "color": 0x998888, "dash": [6, 6], "cap": "butt" }
}

// A point style with marker and icon properties
"poi_pin": {
  "marker": { "image": "pin", "color": 0xffffff },
  "icon": { "color": 0x111111, "size": 11 },
  "label": { "color": 0xdddddd }
}
```

### StyleSelector

A **StyleSelector** describes *when to apply a style*. It contains matching conditions and references one or more Styles.

```typescript
interface StyleSelectorProps {
  id: StyleSelectorID;
  styleIDs: StyleID[];   // Styles to apply (merged in order)
  match: {
    dataset?: DatasetID | DatasetID[];  // 'osm', 'rapid', '*'
    geometry?: GeometryType | GeometryType[];  // 'point', 'line', 'area', '*'
    tags?: PropMatcher[];          // Tag conditions (AND logic)
  };
}
```

**Specificity** determines which selectors win when multiple match:
- Dataset condition: +100
- Geometry condition: +50
- Each tag matcher: +10

**Examples:**
```json5
// Match all buildings on any dataset (specificity: 10)
"building-default": {
  "styleIDs": ["building_red"],
  "match": {
    "tags": [{ "key": "building" }]
  }
}

// Match motorways (specificity: 10)
"highway-motorway": {
  "styleIDs": ["motorway"],
  "match": {
    "tags": [{ "key": "highway", "value": "motorway" }]
  }
}

// Dataset-specific styling for Rapid AI suggestions (specificity: 110)
"rapid-building": {
  "styleIDs": ["building_rapid"],
  "match": {
    "dataset": "rapid",
    "tags": [{ "key": "building" }]
  }
}

// Compose color + pattern (specificity: 10)
"landuse-forest": {
  "styleIDs": ["green", "pattern-forest"],
  "match": {
    "tags": [{ "key": "landuse", "value": "forest" }]
  }
}
```

### PropMatcher

A **PropMatcher** is a declarative way to match properties/tags on a feature. It supports various comparison operators.

```typescript
interface PropMatcher {
  key: string;
  op?: PropMatcherOp;    // Default: '=' (or 'exists' if no value)
  value?: string | number | string[] | RegExp;
}

type PropMatcherOp =
  | '='          // Exact match
  | '!='         // Not equal
  | 'exists'     // Key exists (any value)
  | '!exists'    // Key does not exist
  | '~'          // Regex match
  | '!~'         // Regex does not match
  | 'in'         // Value in array
  | '!in'        // Value not in array
  | '>'          // Greater than (numeric)
  | '>='         // Greater than or equal
  | '<'          // Less than
  | '<='         // Less than or equal
  ;
```

**Examples:**
```typescript
// highway=motorway
{ key: 'highway', value: 'motorway' }

// highway exists (any value)
{ key: 'highway', op: 'exists' }
// Shorthand: { key: 'highway' }

// tunnel does not exist
{ key: 'tunnel', op: '!exists' }

// highway matches regex
{ key: 'highway', op: '~', value: '^(trunk|primary)$' }

// surface is one of these values
{ key: 'surface', op: 'in', value: ['asphalt', 'concrete', 'paved'] }

// lanes > 2
{ key: 'lanes', op: '>', value: 2 }
```

## Matching Algorithm

When determining the style for a feature, **all matching selectors are applied** (not just the best one). This enables style composition where base selectors provide color and refinement selectors add patterns.

1. **Collect matching selectors**: Iterate through all StyleSelectors and find those whose `match` conditions are satisfied by the feature.

2. **Sort by specificity**: Higher specificity wins. Specificity = dataset (+100) + geometry (+50) + tags (+10 each).

3. **Merge all styles**: Starting from DEFAULTS, merge all matching selectors in order (lowest specificity first, so higher specificity wins).

```typescript
function styleMatch(tags: Tags): MatchedStyle {
  const featureInfo = { tags };
  const matchingSelectors = StyleSelector.findAll(selectors.values(), featureInfo);

  // Start with defaults, merge all matching selectors
  // Iterate in reverse (lowest specificity first) so higher specificity wins
  let matched = styles.get('DEFAULTS');

  for (let i = matchingSelectors.length - 1; i >= 0; i--) {
    const selector = matchingSelectors[i];
    for (const styleID of selector.styleIDs) {
      matched = matched.merge(styles.get(styleID));
    }
  }

  return matched.resolvedStyle();  // applies defaults and fallbacks
}
```

### Style Resolution

After matching, `resolvedStyle()` applies defaults using a three-layer deep merge:

```
result = defaults ← fallbacks ← matched props
```

- **Defaults** (`styleDefaults`): Reasonable values for every property group
- **Fallbacks**: Properties that cascade — e.g. `base.color` falls back to `stroke.color` or `fill.color`
- **Matched props**: The style properties from all matching selectors

This ensures every property group is fully populated in the output.

### MatchedStyle

The resolved style object returned to renderers:

```typescript
interface MatchedStyle {
  fill: FillStyleProps;
  casing: LineStyleProps;
  stroke: LineStyleProps;
  marker: PointStyleProps;
  icon: PointStyleProps;
  viewfield: ViewfieldStyleProps;
  lineMarker?: PointStyleProps;   // optional — deleted for area features
  sidedMarker?: PointStyleProps;  // optional — deleted for area features
  label: LabelStyleProps;
}
```

`lineMarker` and `sidedMarker` are optional because they are removed from area features (areas don't need oneway arrows or cliff markers).

### Style Composition Example

A feature with `landuse=forest` and `leaf_type=needleleaved` matches two selectors:

```json5
// Base selector (specificity: 10)
"landuse-forest": {
  "styleIDs": ["green", "pattern-forest"],
  "match": { "tags": [{ "key": "landuse", "value": "forest" }] }
}

// Refinement selector (specificity: 10)
"leaf_type-needleleaved": {
  "styleIDs": ["pattern-forest_needleleaved"],
  "match": { "tags": [{ "key": "leaf_type", "value": "needleleaved" }] }
}
```

Both selectors are applied. The final style has the green fill color from `landuse-forest` and the needleleaved pattern from `leaf_type-needleleaved`.

This approach is analogous to how SchemaSystem's `matchTags()` calculates scores based on tag matches and uses `matchScore` to weight presets.

## File Format

Style data is stored in JSON5 format for human readability (supports comments, trailing commas, hex literals).

```json5
{
  "assetID": "rapid_style",
  "assetVersion": "2.0.0",

  // Styles: visual properties
  "styles": {
    "DEFAULTS": { ... },
    "motorway": { ... },
    "building_red": { ... },
    "pattern-forest": { "fill": { "pattern": "forest" } }
  },

  // StyleSelectors: matching rules
  "selectors": {
    "highway-motorway": {
      "styleIDs": ["motorway"],
      "match": {
        "tags": [{ "key": "highway", "value": "motorway" }]
      }
    },
    "landuse-forest": {
      "styleIDs": ["green", "pattern-forest"],
      "match": {
        "tags": [{ "key": "landuse", "value": "forest" }]
      }
    },
    ...
  }
}
```

## Migration Path

### Phase 1 (Complete)
- Extract hardcoded styles to `data/rapid_style.json5`
- StyleSystem loads and merges style assets
- Current flat selector format (`osmKey: { osmValue: styleID }`)

### Phase 2 (Complete)
- Create `Style`, `StyleSelector`, `PropMatcher` classes in `modules/lib/`
- Comprehensive unit test coverage
- Classes are lightweight "props bundles" with optional methods

### Phase 3 (Complete)
- Migrate StyleSystem to use new classes
- Update `rapid_style.json5` to new selector format
- Add dataset-aware matching

### Phase 4 (Complete)
- Multi-selector matching: all matching selectors applied, not just best
- Removed explicit `priority` in favor of calculated specificity
- Style composition via `styleIDs` array
- Refinement selectors for patterns (e.g., `leaf_type=needleleaved`)

### Phase 5 (Future)
- MapCSS import tool (transforms subset of MapCSS → Rapid style format)
- UI for editing styles in-app
- Style "themes" (complete swappable style sets)
- Optional `matchScore` property if finer control needed (like Preset.matchScore)

## Comparison with Other Systems

| System | Entity | Data vs Class |
|--------|--------|---------------|
| ImagerySystem | `ImagerySource` | Class with methods (URL templating, attribution) |
| SchemaSystem | `Preset`, `Field`, `Category` | Classes with methods (localization, matching) |
| StyleSystem | `Style`, `StyleSelector` | Classes with methods (`resolvedStyle`, `merge`, `clone`) |

The Style class has `resolvedStyle()` for applying defaults and fallbacks, `merge()` for composing styles, and `clone()` for copying. StyleSelector has `findAll()` for matching.

## Inspiration

- **CSS**: Selectors + declarations model
- **MapCSS**: Tag matching syntax (`[highway=motorway]`)
- **Test assertion libraries**: PropMatcher concept (Chai's `deep.include`)

The goal is to be simpler than MapCSS while supporting the most useful subset of its features.

## Related Issues

- [Rapid#451](https://github.com/facebook/Rapid/issues/451) - Custom styling support

## Open Questions

1. ~~**Pattern handling**: Should patterns move into `fill.pattern` in declarations, or stay as separate pattern selectors?~~ **Resolved**: Patterns are now in `fill.pattern` and composed via multi-selector matching.
2. **Lifecycle styles**: How do `new`, `modified`, `deleted` states interact with selectors? Currently handled via tag scanning after style match.
3. **Caching**: Should we cache selector matches per feature, or is matching fast enough?
4. **matchScore**: If specificity alone isn't sufficient, we could add an optional `matchScore` property (like Preset) to weight specific selectors.

## Future: PropMatcher as Side Project

The `PropMatcher` class may eventually be spun out into its own library (similar to `location-conflation` for geographic location sets). This would enable:

**Registry/Cache Pattern**
- Validate matchers at load time, fail fast on invalid patterns
- Generate canonical `PropMatcherID` as a stable hash of properties (e.g., `"highway=motorway"` → `"hw_mot_abc123"`)
- Share instances across selectors that use the same condition
- Pre-compile regexes once, reuse everywhere

**Validation API**
```typescript
PropMatcher.validate(props)  // throws or returns normalized props + ID
```

**Composite Matchers** (potential future syntax)
```json5
{ "any": [{ "key": "highway" }, { "key": "railway" }] }  // OR logic
{ "not": { "key": "abandoned" } }  // negation
```

For now, the current design is simple and works. The registry pattern becomes valuable if we find ourselves loading hundreds of selectors with duplicate tag conditions.
