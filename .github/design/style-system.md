# Style System Design

This document describes the design for Rapid's map styling system, including the data model, matching logic, and external style file format.

## Overview

The StyleSystem manages how map features are visually rendered. It determines colors, line widths, dash patterns, and fill patterns based on feature properties (tags), geometry type, and dataset source.

**Goals:**
- Externalize style definitions to JSON5 files for easy customization
- Support dataset-aware styling (e.g., OSM vs Rapid AI suggestions)
- Explicit priority-based matching (no "magic" selectivity rules)
- Lightweight, testable classes with minimal dependencies

## Core Concepts

### Style

A **Style** describes *what something looks like*. It contains visual properties for rendering.

```typescript
interface StyleProps {
  id: StyleID;
  fill?: FillStyle;      // Area fill properties
  casing?: LineStyle;    // Line casing (draws below stroke)
  stroke?: LineStyle;    // Line stroke (draws above casing)
}

interface FillStyle {
  width?: number;        // Outline width in pixels
  color?: number;        // Hex color, e.g. 0xcf2081
  alpha?: number;        // Opacity: 0 = transparent, 1 = opaque
  pattern?: string;      // Fill pattern ID, e.g. 'grass', 'waves'
}

interface LineStyle {
  width?: number;        // Line width in pixels
  color?: number;        // Hex color
  alpha?: number;        // Opacity
  cap?: 'butt' | 'round' | 'square';
  join?: 'bevel' | 'miter' | 'round';
  dash?: number[];       // Dash pattern, e.g. [10, 5] for 10px on, 5px off
}
```

**Examples:**
```json5
// A simple fill color
"green": {
  "fill": { "color": 0x8cd05f, "alpha": 0.3 }
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
```

### StyleSelector

A **StyleSelector** describes *when to apply a style*. It contains matching conditions and references a Style.

```typescript
interface StyleSelectorProps {
  id: StyleSelectorID;
  styleID: StyleID;  // Which Style to apply
  priority?: number;              // Higher wins (default: 0)
  match: {
    dataset?: DatasetID | DatasetID[];  // 'osm', 'rapid', '*'
    geometry?: GeometryType | GeometryType[];  // 'point', 'line', 'area', '*'
    tags?: PropMatcher[];          // Tag conditions (AND logic)
  };
}
```

**Examples:**
```json5
// Match all buildings on any dataset
"building-default": {
  "styleID": "building_red",
  "priority": 5,
  "match": {
    "tags": [{ "key": "building" }]
  }
}

// Match motorways with higher priority
"highway-motorway": {
  "styleID": "motorway",
  "priority": 10,
  "match": {
    "tags": [{ "key": "highway", "value": "motorway" }]
  }
}

// Dataset-specific styling for Rapid AI suggestions
"rapid-building": {
  "styleID": "building_rapid",
  "priority": 6,
  "match": {
    "dataset": "rapid",
    "tags": [{ "key": "building" }]
  }
}

// Geometry-specific default
"area-default": {
  "styleID": "DEFAULTS",
  "priority": -1,
  "match": {
    "geometry": "area"
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

When determining the style for a feature:

1. **Collect matching selectors**: Iterate through all StyleSelectors and find those whose `match` conditions are satisfied by the feature.

2. **Sort by priority**: Higher priority wins. If priorities are equal, more specific matches win (more tag matchers = more specific).

3. **Return the style**: Look up the winning selector's `styleID` and return the corresponding Style.

```typescript
function styleMatch(feature: FeatureInfo): Style {
  const { dataset, geometry, tags } = feature;

  let bestSelector: StyleSelector | null = null;
  let bestPriority = -Infinity;

  for (const selector of selectors.values()) {
    if (!selectorMatches(selector, feature)) continue;

    const priority = selector.priority ?? 0;
    if (priority > bestPriority) {
      bestPriority = priority;
      bestSelector = selector;
    }
  }

  if (bestSelector) {
    return styles.get(bestSelector.styleID);
  }
  return styles.get('DEFAULTS');
}
```

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
    "building_red": { ... }
  },

  // StyleSelectors: matching rules
  "selectors": {
    "highway-motorway": {
      "styleID": "motorway",
      "priority": 10,
      "match": {
        "tags": [{ "key": "highway", "value": "motorway" }]
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
- Update `rapid_style.json5` to new selector format with explicit priority
- Add dataset-aware matching

### Phase 4 (Future)
- MapCSS import tool (transforms subset of MapCSS → Rapid style format)
- UI for editing styles in-app
- Style "themes" (complete swappable style sets)

## Comparison with Other Systems

| System | Entity | Data vs Class |
|--------|--------|---------------|
| ImagerySystem | `ImagerySource` | Class with methods (URL templating, attribution) |
| SchemaSystem | `Preset`, `Field`, `Category` | Classes with methods (localization, matching) |
| StyleSystem | `Style`, `StyleSelector` | Props bundles, logic on system |

Unlike Presets which need localization, styles are purely visual and don't need l10n support. Keeping them lightweight avoids unnecessary dependencies.

## Inspiration

- **CSS**: Selectors + declarations model
- **MapCSS**: Tag matching syntax (`[highway=motorway]`)
- **Test assertion libraries**: PropMatcher concept (Chai's `deep.include`)

The goal is to be simpler than MapCSS while supporting the most useful subset of its features.

## Related Issues

- [Rapid#451](https://github.com/facebook/Rapid/issues/451) - Custom styling support

## Open Questions

1. **Pattern handling**: Should patterns move into `fill.pattern` in declarations, or stay as separate pattern selectors?
2. **Lifecycle styles**: How do `new`, `modified`, `deleted` states interact with selectors? Special pseudo-selectors?
3. **Caching**: Should we cache selector matches per feature, or is matching fast enough?

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
