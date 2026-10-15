# Validators

Validation rules that check map data for errors, warnings, and suggestions. These help mappers catch mistakes before uploading to OpenStreetMap.

## Overview

Each validator is a function that examines entities and returns a `ValidatorResult` containing
detected issues. Validators are run by the `ValidationSystem` and results are displayed in the issues panel.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel exports - every validator exported here is registered by the `ValidationSystem` |
| `types.ts` | `ValidatorFactory`, `ValidatorFunction`, and `ValidatorResult` types |
| `almost_junction.ts` | Roads that almost connect but don't |
| `ambiguous_crossing_tags.ts` | Crossings with unclear tagging |
| `close_nodes.ts` | Nodes that are very close together |
| `crossing_ways.ts` | Ways that cross without a proper connection (shared node, bridge, tunnel, or ford) |
| `curb_nodes.ts` | Crossing ways missing curb (kerb) nodes at their ends |
| `disconnected_way.ts` | Ways that should connect to the road network |
| `duplicate_segments.ts` | Ways with duplicate segments |
| `help_request.ts` | Features tagged with `fixme` |
| `impossible_oneway.ts` | Oneway roads or waterways with impossible connections |
| `incompatible_source.ts` | Features sourced from incompatible providers (e.g. Google) |
| `invalid_format.ts` | Tags with invalid formatting |
| `mismatched_geometry.ts` | Tags that don't match the geometry type |
| `missing_role.ts` | Multipolygon members missing their `inner`/`outer` role |
| `missing_tag.ts` | Features missing descriptive tags |
| `outdated_tags.ts` | Deprecated or incomplete tags that should be updated (including NSI brand upgrades) |
| `private_data.ts` | Personal contact info on private buildings |
| `short_road.ts` | Very short road segments (currently disabled - not exported from `index.ts`) |
| `suspicious_name.ts` | Generic names that match tags (e.g. a park named "Park") or are flagged by NSI |
| `unsquare_way.ts` | Buildings with unsquare corners |
| `y_shaped_connection.ts` | Y-shaped road connections (common in ML-generated roads) |

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
  };

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
