# Validators

Validation rules that check map data for errors, warnings, and suggestions. These help mappers catch mistakes before uploading to OpenStreetMap.

## Overview

Each validator is a function that examines entities and returns a `ValidatorResult` containing
detected issues. Validators are run by the `ValidationSystem` and results are displayed in the issues panel.

## Key Files

| File | Description |
|------|-------------|
| `almost_junction.ts` | Roads that almost connect but don't (currently disabled) |
| `ambiguous_crossing_tags.ts` | Crossings with unclear tagging |
| `close_nodes.ts` | Nodes that are very close together |
| `crossing_ways.ts` | Ways that cross without a shared node (currently disabled) |
| `curb_nodes.ts` | Missing or incorrect curb nodes at crossings |
| `disconnected_way.ts` | Ways that should connect to the road network |
| `duplicate_segments.ts` | Ways with duplicate segments |
| `help_request.ts` | Features tagged with fixme or help requests |
| `impossible_oneway.ts` | Oneway roads with impossible connections |
| `incompatible_source.ts` | Problematic source tags |
| `invalid_format.ts` | Tags with invalid formatting |
| `mismatched_geometry.ts` | Tags that don't match the geometry type |
| `missing_role.ts` | Relation members without required roles |
| `missing_tag.ts` | Features missing required tags |
| `outdated_tags.ts` | Deprecated tags that should be updated |
| `private_data.ts` | Potentially private information in tags |
| `short_road.ts` | Very short road segments (currently disabled) |
| `suspicious_name.ts` | Names that look like tags or descriptions |
| `unsquare_way.ts` | Buildings with unsquare corners |
| `y_shaped_connection.ts` | Roads connecting at sharp Y-angles |

## Validation Interface

Each validator is a factory function that accepts a `Context` and returns a `ValidatorFunction`:

```typescript
export function validateExample(context: Context): ValidatorFunction {
  const type = 'example' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;

  const validator = function checkExample(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };

    // Check for problems...
    if (problem) {
      result.issues.push(new ValidationIssue(context, {
        type: type,
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.example.message', {
            feature: l10n.displayLabel(entity, graph)
          }) : '';
        },
        // ... other properties
      }));
    }

    return result;
  } as ValidatorFunction;

  validator.type = type;
  return validator;
}
```

## Issue Severity

- `error` - Must be fixed before uploading
- `warning` - Should probably be fixed
- `suggestion` - Optional improvement

## Fixes

Issues can include suggested fixes that users can apply with one click:

```typescript
dynamicFixes: function(this: any) {
  return [
    new ValidationFix({
      title: l10n.t('issues.fix.fix_the_problem.title'),
      onClick: function(this: any) {
        // apply fix
      }
    })
  ];
}
```
