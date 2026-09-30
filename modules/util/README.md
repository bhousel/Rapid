# Util

General-purpose utility functions used throughout Rapid.

## Overview

This module contains helper functions that don't belong to any specific domain. All files have been converted to TypeScript.

## Key Files

| File | Description |
|------|-------------|
| `cmd.ts` | Platform-specific command key handling (⌘ on Mac, Ctrl elsewhere) |
| `date.ts` | Date formatting and parsing utilities |
| `detect.ts` | Browser and platform detection |
| `dimensions.ts` | DOM dimension calculations |
| `fetch_response.ts` | Fetch API response handling utilities |
| `get_set_value.ts` | Get/set value helper for form elements |
| `iterable.ts` | Utilities for working with iterables |
| `jsonp_request.ts` | JSONP request helper for cross-origin APIs |
| `jxon.ts` | XML ↔ JSON conversion (JXON format) |
| `rebind.ts` | D3-style method rebinding |
| `string.ts` | String manipulation utilities |
| `util.ts` | Miscellaneous utilities |

## Common Utilities

### cmd.ts
```javascript
import { utilCmd } from './util/cmd.ts';
// Returns '⌘A' on Mac, 'Ctrl+A' elsewhere
const shortcut = utilCmd('⌘A');
```

### detect.ts
```javascript
import { utilDetect } from './util/detect.ts';
const detected = utilDetect();
if (detected.os === 'mac') { /* ... */ }
```

## Related

For array/object/string utilities, see the `@rapid-sdk/util` package which provides:
- `utilArrayChunk`, `utilArrayUniq`, etc.
- `utilObjectOmit`, `utilObjectPick`, etc.
- `utilQsString`, `utilStringQs`, etc.
