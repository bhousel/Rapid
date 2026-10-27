# Uploader System Design

`UploaderSystem` (`modules/core/UploaderSystem.ts`) **uploads the user's edits to OpenStreetMap** as a
changeset, and handles what happens when someone else changed the same features in the meantime.

This system is older than the design docs. This doc started in October 2026 with an audit of the
conflict handling, which had been broken for a long time (see [The October 2026 audit](#the-october-2026-audit)).

> **Status:** Conflicts work again: checking them, merging other mappers' changes, the conflict
> screen, and retrying. Still open: upload errors that hang the save, and losing the backup while a
> save is in progress (see [Rollout](#rollout)).

## Words used here

- **Local**: the user's copy of an entity (in `editor.stable`).
- **Remote**: the copy on the OSM server now.
- **Base**: the copy the user's edits were made from (in `editor.base`). Normally the common ancestor
  of local and remote.
- **Version**: the OSM `version` of an entity. Every modify or delete is uploaded with the version it
  was made against; if the server has a newer one, the whole upload fails with **409 Conflict**.
- **Conflict check**: fetching the remote copy of everything the upload would change, comparing it with
  the local copy, and merging what can be merged.
- **Merge** (`actionMergeRemoteChanges`): a three-way merge of local and remote against base, per
  entity. `safe` merges only what doesn't collide; `force_local` ("Keep mine") and `force_remote`
  ("Use theirs") pick a side.
- **Conflict**: an entity the safe merge couldn't merge. The user chooses a side on the conflict screen
  (`UiConflicts`, shown by `SaveMode`).

## What it owns

- The save flow: upload, conflict check, merges, the list of conflicts, retrying. Events:
  `saveStarted`, `willAttemptUpload`, `progressChanged`, one of `resultSuccess`, `resultErrors`,
  `resultConflicts` or `resultNoChanges`, then `saveEnded`.
- The draft changeset comment, source and hashtags.

`OsmService` owns the requests (`sendChangeset`, `loadEntityVersionsAsync`). `SaveMode` owns the
screens, and `UiConflicts` the conflict screen.

## How a save works

1. **Upload first.** Most saves have no conflicts, so `save()` uploads right away.
2. **On 409, check for conflicts** (`_checkConflictsAsync`) and try again. The API's message names the
   entity that didn't match ("Version mismatch: Provided 8, server had: 10 of Relation 123").
3. **What's checked:** every entity the upload would **modify or delete** (`difference.modified()` and
   `deleted()`), since those are what carry a version, plus anything a 409 named. It used to be the
   `summary()` list made for the upload panel, which leaves out local deletions and untagged vertices.
4. **What's loaded:** the current version of each of those, and of the child nodes of those ways, in one
   versioned multi-fetch per type (`OsmService.loadEntityVersionsAsync`, the same call backup restore
   uses). Then the child nodes of the remote ways that we don't have yet, since merging a way needs
   them. Nothing more: relation members aren't loaded (merging a relation only compares member lists).
5. **Compare and merge** (`_detectConflicts`): skip anything whose version (and, for ways, whose child
   nodes' versions) didn't change; otherwise run the safe merge. A merge sets the entity to the remote
   version, so it can be uploaded.
6. **Merges happen in `staging`**, as work in progress. If there are no conflicts, they're committed
   ("Merged changes from other mappers.") and uploaded. If there are, the conflict screen shows them;
   choosing a side performs that merge in `staging` too, Save commits everything and uploads, and Cancel
   (or Escape, or leaving save mode) reverts `staging`, throwing the merges away.
7. **Retry, but not forever.** Each 409 runs the check again, up to `MAX_CONFLICT_CHECKS` (3) times per
   save. It stops with an error ("OpenStreetMap still reports a conflict that Rapid couldn't resolve…",
   with the API's message) if the same entity is reported twice (the check didn't fix it), if the limit
   is reached, or if the changeset was closed (also a 409, and no check can reopen it). The user's
   choices on the conflict screen start the count again.

### Local deletions

When the user deleted something another mapper changed:
- **Both deleted it:** nothing to upload, so the merge takes the deletion back.
- **"Leave Deleted"** (`force_local`): the deletion is uploaded against the base copy's version, which is
  older than the server's. So before merging, the uploader replaces the base copy with the remote one,
  along with child nodes the user didn't change (`EditSystem.updateBase`). The upload then deletes the
  newest version. If a child node of the remote way couldn't be loaded, the base is left alone (a way
  can't be drawn without its nodes), and the upload fails with the API's reason.
- **"Restore"** (`force_remote`): `actionRevert` brings it back, with the child nodes and members that
  were deleted along with it.

`Graph.rebase` used to restore a locally deleted node when newly loaded data showed a way using it
(iD#2085). For a way the user deleted along with its nodes, that undid part of the deletion, so it no
longer applies there.

## The October 2026 audit

Prompted by iD#7199 ("Endless conflict check loop", open since 2020), Rapid#1361, #1366 and #1480, and
k-yle's iD PR #12814, which found three bugs in iD's copy of this code. Rapid had those and more. The
conflict path had no tests, so each bug stayed hidden behind the one before it.

| # | Problem | Status |
|---|---|---|
| 1 | The check never finished: it read `results.data` from `loadMultipleAsync`, which has returned a plain array since September 2025, and called `createOsmEntity(props)` without `context`. Progress sat at "0 of N". | Fixed |
| 2 | Merges never reached the upload: they were made in `staging`, but uploads read `stable`. Every retry sent the old versions, got 409, and checked again. A leftover of iD's single-graph history. | Fixed: merges are committed before uploading |
| 3 | 409s were retried forever. | Fixed: limited, and stops when the same entity is reported again or the changeset was closed |
| 4 | Local deletions and deleted untagged vertices were never checked, so their 409s looped (iD's bugs 2 and 3). | Fixed |
| 5 | A failed fetch (rate limit, timeout, offline, or one ID that 404s a chunk of 150) was ignored, so the check waited forever. | Fixed: `loadEntityVersionsAsync` rejects on real failures and splits a request on 404 |
| 6 | The check expanded to remote-only entities (new child nodes, every multipolygon member and its nodes), then threw on `localGraph.entity()` for them. Huge relations also took forever. | Fixed: only the remote ways' child nodes are loaded, and only for merging |
| 7 | The conflict screen's choices: `chosen` held the entity ID while the uploader compared it to `1`, so the default wasn't applied, and coming back to a conflict ran both choices ("Use theirs" won). iD's bug 1, in a different form. | Fixed: `chosen` is `'local'` or `'remote'` |
| — | The conflict screen never opened at all: `SaveMode._resultConflicts` took `(conflicts, origChanges)`, but the uploader emits `(changeset, conflicts, origChanges)`. Broken since at least June 2023. | Fixed |
| — | The "download osmChange file" link on the conflict screen was never created (`selectAll().append()` on nothing). iD has the same bug, which is why users had to dig the file out with the browser inspector. | Fixed |
| — | Escape on the conflict screen went to save mode's own Escape, leaving the merges in `staging` and a stale conflict screen. | Fixed: Escape cancels the conflict screen; leaving save mode cancels it too |
| 8 | Upload errors that aren't HTTP errors (offline, the 30 s default timeout) are swallowed by `sendChangeset`, and the save never finishes. A large upload can be cut off by that timeout while the server still applies it. | Open |
| 9 | The session backup is deleted before uploading (iD#5200), and backups are skipped in save mode, so a reload during a stalled save or the conflict screen loses the edits (Rapid#1480). | Open |
| 10 | Results of an earlier attempt that arrive late could change a newer attempt's state. | Fixed: each `save()` is a numbered attempt |

Found along the way, not fixed:
- **"Moved by both" when only the other mapper moved it.** `mergeLocation` compares local and remote but
  not base, so a node the user retagged (or a child node of a way they changed) that someone else moved
  is reported as moved by both. iD has the same.
- **Updating a base node doesn't update its parent ways' cached extents** (`Graph.rebase` with `force`).

## Decisions

- **Check what's uploaded, not what's listed.** The check set comes from `difference.modified()` and
  `deleted()`, not `summary()`. (October 2026)
- **Merges stay in `staging` until the user saves**, then are committed as one edit. Cancel then really
  cancels, which iD's conflict screen can't do. (October 2026)
- **Reuse the versioned multi-fetch.** The conflict check and backup restore both use
  `OsmService.loadEntityVersionsAsync`, which rejects on real failures and works around
  openstreetmap-website#5005 (one missing version makes the whole request 404) by splitting the request.
- **The default choice stays "Use theirs"** (`chosen: 'remote'`), as it was. A user clicking through
  doesn't overwrite another mapper's work. iD's PR #12814 switches to "Keep mine"; see Open questions.
- **A deletion the user keeps is uploaded against the remote version**, by updating the base copy
  (`EditSystem.updateBase`), like iD's PR does with its rebaser.

## Prior art

- iD#7199, and k-yle's [iD PR #12814](https://github.com/openstreetmap/iD/pull/12814), which lists
  Rapid#1361, #1366 and #1480 as the same bug. Its local-deletion handling and recursive `actionRevert`
  are close to what's here.
- openstreetmap-website#5005 (multi-fetch 404s without saying which ID) and #5008 (no multi-fetch for
  histories).
- JOSM resolves conflicts per entity in its own dialog; users stuck in iD's loop download the osmChange
  file and finish there.

## Open questions

- **Default choice:** keep "Use theirs", or switch to "Keep mine" as iD's PR does?
- **A closed changeset** stops the save with the API's message. Should it open a new changeset and
  upload again instead?

## Rollout

1. **This doc and the audit.** ✅
2. **Conflicts work:** findings 1–7 and 10, the conflict screen opening, its download link, and Escape. ✅
   Checked in a headless Chromium against the real app, with the OSM service's upload and fetch faked:
   a tag conflict ("Keep mine" uploads the user's value at the server's version), and a local deletion
   ("Leave Deleted" deletes the server's version).
3. **Upload errors** (finding 8): report every failure, and give the upload a longer timeout (or none).
4. **Don't lose the edits during a save** (finding 9): keep the session until the upload succeeds, or
   save it again on conflicts and errors.
5. **Later:** the "moved by both" false conflict; a new changeset when the old one was closed.
