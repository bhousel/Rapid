# Agent Working Memory

Persistent notes for AI coding agents across sessions. Committed to git.

## Files

| File | Purpose | Update frequency |
|------|---------|---------------|
| `current.md` | Active/in-progress work only | Every session |
| `backlog.md` | Future ideas and planned work | When ideas are captured |
| `completed.md` | Completed work archive (one-liners) | When work lands |
| `decisions.md` | Non-obvious design choices (the "why" git doesn't capture) | When decisions are made |
| `lessons.md` | Patterns, gotchas, things that went wrong once | When learning happens |
| `quirks.md` | Known runtime issues, workarounds, timing problems | As discovered/fixed |

## Conventions

- **`current.md` stays small** — only active/in-progress work. When complete, move the "why" to `decisions.md`, add a one-liner to `completed.md`, and delete the rest.
- **`backlog.md`** — future ideas, planned features, deferred work. Delete items once they start (move to `current.md`) or are decided against.
- **`completed.md`** — reverse-chronological one-liners. A sentence or two is enough as a breadcrumb; details live in git history.
- **Size budget**: aim to keep `current.md` under ~40 lines. Other files can grow but prune stale entries.
- **Expiry heuristic**: if an entry references code/files that no longer exist, remove it.
- **No commit hashes or file-by-file changelogs** — git tracks those. Focus on context that *isn't* in the code.
