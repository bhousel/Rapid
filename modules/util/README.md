# Util

General-purpose utility functions used throughout Rapid.

## Overview

This module contains helper functions that don't belong to any specific domain. All files have been converted to TypeScript.

Keyboard shortcut handling used to live here as `keybinding`; it is now the `KeyboardSystem` in `modules/core/`.

## Key Files

| File | Description |
|------|-------------|
| `cmd.ts` | Convert MacOS-style key combos for the current platform (⌘ on Mac, ⌃ elsewhere) |
| `date.ts` | Date formatting and parsing utilities |
| `deep_merge.ts` | Recursive object merge (used by the style system in place of `lodash.merge`) |
| `detect.ts` | Browser and platform detection |
| `dimensions.ts` | Get/set cached dimensions of a D3 selection |
| `fetch_response.ts` | Fetch API response handling utilities (`utilFetchResponse`, `fetchEnvelope`, `FetchError`) |
| `get_set_value.ts` | Get/set the `value` of form elements, skipping no-op sets |
| `iterable.ts` | Utilities for working with iterables |
| `jsonp_request.ts` | JSONP request helper for cross-origin APIs |
| `jxon.ts` | XML ↔ JSON conversion (JXON format) |
| `sanitize.ts` | Escape text and sanitize untrusted HTML |
| `string.ts` | String manipulation utilities |
| `url.ts` | Accept only URLs with safe protocols |
| `util.ts` | Miscellaneous utilities |
| `index.ts` | Barrel export file |

## Common Utilities

### cmd.ts
```typescript
import { utilCmd } from './util/cmd.ts';
// Returns '⌘A' on Mac, '⌃A' elsewhere
const shortcut = utilCmd('⌘A');
```

### detect.ts
```typescript
import { utilDetect } from './util/detect.ts';
const detected = utilDetect();
if (detected.os === 'mac') { /* ... */ }
```

## Related

For array/object/string utilities, see the `@rapid-sdk/util` package which provides:
- `utilArrayChunk`, `utilArrayUniq`, etc.
- `utilObjectOmit`
- `utilQsString`, `utilStringQs`, `utilSortString`, etc.
