# Validations

Validation rules that check map data for errors, warnings, and suggestions. These help mappers catch mistakes before uploading to OpenStreetMap.

## Overview

Each validation is a function that examines entities and returns an array of `ValidationIssue` objects. Validations are run by the `ValidationSystem` and results are displayed in the issues panel.

## Key Files

| File | Description |
|------|-------------|
| `almost_junction.js` | Roads that almost connect but don't (currently disabled) |
| `ambiguous_crossing_tags.js` | Crossings with unclear tagging |
| `close_nodes.js` | Nodes that are very close together |
| `crossing_ways.js` | Ways that cross without a shared node (currently disabled) |
| `curb_nodes.js` | Missing or incorrect curb nodes at crossings |
| `disconnected_way.js` | Ways that should connect to the road network |
| `duplicate_way_segments.js` | Ways with duplicate segments |
| `help_request.js` | Features tagged with fixme or help requests |
| `impossible_oneway.js` | Oneway roads with impossible connections |
| `incompatible_source.js` | Problematic source tags |
| `invalid_format.js` | Tags with invalid formatting |
| `mismatched_geometry.js` | Tags that don't match the geometry type |
| `missing_role.js` | Relation members without required roles |
| `missing_tag.js` | Features missing required tags |
| `outdated_tags.js` | Deprecated tags that should be updated |
| `private_data.js` | Potentially private information in tags |
| `short_road.js` | Very short road segments (currently disabled) |
| `suspicious_name.js` | Names that look like tags or descriptions |
| `unsquare_way.js` | Buildings with unsquare corners |
| `y_shaped_connection.js` | Roads connecting at sharp Y-angles |

## Validation Interface

Each validation function returns a validation object:

```javascript
export function validationExample(context) {
  const validation = function(entity, graph) {
    const issues = [];

    // Check for problems...
    if (problem) {
      issues.push(new ValidationIssue({
        type: 'example',
        severity: 'warning',
        message: () => 'Description of the problem',
        // ... other properties
      }));
    }

    return issues;
  };

  validation.type = 'example';
  return validation;
}
```

## Issue Severity

- `error` - Must be fixed before uploading
- `warning` - Should probably be fixed
- `suggestion` - Optional improvement

## Fixes

Issues can include suggested fixes that users can apply with one click:

```javascript
fixes: [
  new ValidationFix({
    title: 'Fix the problem',
    onClick: () => { /* apply fix */ }
  })
]
```
