# Agent Working Memory

Persistent notes for AI coding agents across sessions. Committed to git.

## Files

| File | Purpose | Update frequency |
|------|---------|-----------------|
| `current.md` | Active/in-progress work only | Every session |
| `decisions.md` | Non-obvious design choices (the "why" git doesn't capture) | When decisions are made |
| `lessons.md` | Patterns, gotchas, things that went wrong once | When learning happens |
| `quirks.md` | Known runtime issues, workarounds, timing problems | As discovered/fixed |

## Conventions

- **`current.md` stays small** — when work completes, move the "why" to `decisions.md` and delete the rest
- **Size budget**: aim to keep each file under ~80 lines. Prioritize what to keep.
- **Expiry heuristic**: if an entry references code/files that no longer exist, remove it
- **No commit hashes or file-by-file changelogs** — git tracks those. Focus on context that *isn't* in the code.
- **One-liners for completed work** — a sentence summary is enough as a breadcrumb. Details live in git history.
