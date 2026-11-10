# Uploader System Design

`UploaderSystem` (`modules/core/UploaderSystem.ts`) **uploads the user's edits to OpenStreetMap** as a
changeset, and handles what happens when someone else changed the same features in the meantime.

This system is older than the design docs. This doc started in October 2026 with an audit of the
conflict handling, which had been broken for a long time (see [The October 2026 audit](#the-october-2026-audit)).

> **Status:** Conflicts work again: checking them, merging other mappers' changes, the conflict
> screen, and retrying. Upload errors end the save, and the backup is kept until the upload succeeds
> (see [Rollout](#rollout)).

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
   For whatever changed remotely, it then asks for the version the edits were made from, to find the
   ones that were redacted (see "Redacted versions").
5. **Compare and merge** (`_detectConflicts`): skip anything whose version (and, for ways, whose child
   nodes' versions) didn't change; otherwise run the safe merge. A merge sets the entity to the remote
   version, so it can be uploaded.
6. **Merges happen in `staging`**, as work in progress. If there are no conflicts, they're committed
   ("Merged changes from other mappers.") and uploaded. If there are, the conflict screen shows them;
   choosing a side performs that merge in `staging` too, Save commits everything and uploads, and Cancel
   (or Escape, or leaving save mode) reverts `staging`, throwing the merges away. Nothing outside
   `staging` changes before the user saves (not even the base, see "Local deletions").
   The choices of one conflict replace each other: the screen applies the default when it shows the
   conflict, so before a choice applies, what the previous one changed is put back as the safe merges
   left it (`_mergedGraph`). Otherwise "Keep mine" after the default "Use theirs" restored a deleted node
   but left its parent way without it.
   If what's left matches OSM (e.g. "Use theirs" for everything), there's nothing to upload
   (`resultNoChanges`), and the session backup is removed, as after an upload.
7. **Retry, but not forever.** Each 409 runs the check again, up to `MAX_CONFLICT_CHECKS` (3) times per
   save. It stops with an error ("OpenStreetMap still reports a conflict that Rapid couldn't resolve…",
   with the API's message) if the same entity is reported twice (the check didn't fix it), if the limit
   is reached, or if the changeset was closed (also a 409, and no check can reopen it). The user's
   choices on the conflict screen start the count again.

### Local deletions

When the user deleted something another mapper changed:
- **Both deleted it:** the local deletion stays, and the uploader leaves it out of the upload
  (`_deletedRemotelyIDs`: everything the check found deleted on the server, for the rest of the save).
  The nodes the user deleted along with a way still upload, unless they're deleted on the server too.
  (Until November 2026 the merge took the deletion back, and since `actionRevert` restores what was
  deleted along with a way, that brought back its nodes, and the user's deletion of them was lost.)
- **"Leave Deleted"** (`force_local`): the deletion is uploaded against the base copy's version, which is
  older than the server's. So once the user saves the conflict screen, the uploader replaces the base
  copy with the remote one, along with child nodes the user didn't change (`EditSystem.updateBase`). The
  upload then deletes the newest version. If a child node of the remote way couldn't be loaded, the base
  is left alone (a way can't be drawn without its nodes), and the upload fails with the API's reason.
  (Until November 3, 2026 the base was updated while detecting, so Cancel kept it, and the next Save
  deleted the other mapper's version without asking.)
  The remote way's untagged nodes that nothing else uses are deleted too (`_deleteOrphanedNodes`), as
  deleting the way did with the nodes it had. Otherwise nodes the other mapper added would be left on
  OSM, untagged and unused (until November 2026, they were).
- **"Restore"** (`force_remote`): `actionRevert` brings it back, with the child nodes and members that
  were deleted along with it. The base gets the remote version too, so the map shows it.

### "Use theirs" for a way

It takes the other mapper's way, and the nodes only that way uses (the way's shape). A node another way
shares keeps the user's change, unless the other mapper changed that node too: the change is an edit
of the other way as well, which isn't in conflict. (iD reverts every child node. Until November 3, 2026
Rapid did too, so moving a junction and retagging one of its roads lost the move when the retag
conflicted.)

**A node with its own conflict follows its own choice,** whatever is chosen for its way: the forced
merges skip the child nodes in `ownChoiceIDs` (the uploader's `_conflictIDs`). Until November 2026,
"Use theirs" on a way overrode "Keep mine" on one of its nodes, so the node went back to its base
position (neither version), and the result also depended on which conflict the screen showed last.
Saving the conflict screen applies every conflict's choice once more, so they're all in, in any order.

**What's left just as the other mapper has it isn't an edit** (`_settleSameAsRemote`, when the merges
are committed and when the conflict screen is saved): an entity whose local copy has the same version,
tags and shape as the remote one goes into the base, and its local copy is dropped. That covers "Use
theirs" (the way, and its nodes), and the nodes the other mapper changed under a way the user changed.
It shows their version on the map, instead of the base the user started from (as "Use theirs" used to),
and nothing is uploaded for it (it used to upload copies of the shared nodes the other mapper changed:
changes that changed nothing).

**A child node the user didn't change takes the other mapper's version** in a safe merge of its way,
location and tags. A child node the user changed is left to its own merge: everything the user
modified is checked on its own. (Until November 2026, the way's merge rebuilt the node from the user's
copy, which dropped the other mapper's tag changes on it, or reported "moved by both".)

`Graph.rebase` used to restore a locally deleted node when newly loaded data showed a way using it
(iD#2085). For a way the user deleted along with its nodes, that undid part of the deletion, so it no
longer applies there.

### Redacted versions

The Data Working Group redacts versions that hold data which never should have been added (for
licence or copyright reasons), and the API stops serving them. Only a version that isn't current can be
redacted. If the version the user's edits were made from has been redacted, the edits are left out, as
a restore leaves them out (see [`edit-system.md`](edit-system.md)): they were made to data that was
removed, the user's copy may still hold it, and the real base can't be compared against any more. Without
this, a three-way merge with the real base already drops redacted tags the user didn't touch, but a
redacted tag the user changed was an ordinary conflict, and "Keep mine" uploaded it again.

- **Finding them** (`_findRedactedAsync`): after loading the remote versions, the uploader asks for the
  version each edit was made from, for the entities whose version changed remotely, in one more versioned
  multi-fetch. The versions left out of the answer were redacted. Usually nothing changed remotely, so
  there's no request.
- **No merge:** a redacted entity skips the safe merge and is listed on the conflict screen with "The
  version of this feature you edited has since been removed from OpenStreetMap…", and "Use theirs" (or
  "Restore", or "Leave Deleted" when the other mapper deleted it) as its only choice. The base gets the
  remote version, as for "Restore" of a local deletion, so the map shows what's on OSM now.
- **Not quite the same as a restore:** for a way, "Use theirs" also takes back the user's changes to the
  nodes only that way uses (see above), while a restore keeps them, since they're edits of the nodes,
  whose versions weren't redacted. Both leave out everything that was the redacted entity's own.

### When an upload gets no answer

`OsmService.sendChangeset` creates a changeset, uploads to it, and closes it. Every failure reaches the
uploader, so the save always ends. An HTTP error means the server answered, and an upload is all or
nothing, so nothing was applied. With no answer (offline, the connection dropped, or the upload's
5-minute timeout), the server may have applied it anyway, or may still be applying it. So
`sendChangeset` first closes the changeset, then asks the API for it (`loadChangesetAsync`): if it has
changes, the upload went through and the save succeeds; if it's closed with none, the error says the
changes weren't saved (status `-5`), and the next save opens a new changeset; if the close or the
question fails, Rapid can't tell (`-6`, see below).

Closing first is what makes "no changes" an answer. The API (cgimap) locks the changeset row while it
applies an upload (`SELECT ... FOR UPDATE NOWAIT`), and a close takes the same lock without waiting:
while an upload is being applied, the close fails at once with 409 "locked by another process". So a
close that succeeds means no upload is being applied, and none can land later (an upload to a closed
changeset is rejected), so its count is final. (Until November 2026 the count was taken without
closing, so a large upload still being applied read as `-5`, and the retry reused the changeset: if
the first upload then landed, the edits were applied twice.)
It's `-6` too when the connection was switched while the upload was out: its answer is dropped, even
a success (`_wrapcb`), and we can't ask the server that got it. (Until November 3, 2026 that was `-1`,
which the uploader took as "the server answered, nothing applied", so it removed the upload mark.)

The upload timeout is 5 minutes, not the `NetworkSystem` default of 30 s, because a large upload can
take the server longer than that, and giving up early is what leaves us not knowing.

### Keeping the edits during a save

iD deleted the session backup as soon as an upload started (iD#5200): users would click Save, close
the tab right away, open a new one, and restore edits that were already on their way to OSM, so they
were uploaded twice. That made any save that didn't finish lose the edits instead (Rapid#1480). Now that
`DatabaseSystem` keeps several sessions and we own their shape, the session is kept and marked:

1. **Mark before uploading.** After the changeset is created, `sendChangeset` waits for its
   `beforeUpload` hook, where the uploader calls `editor.markUploadAsync`. That backs up the edits
   (save mode skips ordinary backups) with `upload: { changesetID, apiURL, startedAt }`. A
   session without the mark was never uploaded.
2. **In the same tab:** success deletes the session (`clearBackup`). Until the reset that follows the
   success screen, Rapid stays in save mode (Escape is off) and `hasWork()` is false, so the uploaded
   edits can't be edited or backed up as a new session (Nov 2026). An error where we know nothing
   was applied (any HTTP error, or `-5`) removes this changeset's mark, so it's an ordinary backup
   again, and the draft comment is kept. (A save that fails before creating a changeset has no mark
   to remove.) When we can't tell (`-6`), the tab lets go of the session (`releaseSessionAsync`): the
   session keeps its mark and loses its heartbeat, the tab resets and returns to browse mode, and the
   error asks the user to reload once OpenStreetMap is reachable. The reload settles it (step 3).
   Letting the user keep editing edits that may already be on OSM made every later step uncertain:
   a second save over an unsettled mark, or edits after the mark that the next tab had to tell apart.
   With no durable storage (the database is unavailable, or the write fails), there's nothing to
   reload, so the edits stay in the tab and the error says to check the changeset before uploading
   again.
3. **In the next tab:** a marked session that no live tab owns (the heartbeat covers a tab that's still
   uploading) is settled by `EditSystem.startAsync`, before the restore screen, by asking the API for
   the changeset (a public read, so no login needed). Uploads are all or nothing, so:
   - **It has changes:** the upload went through, and the session is deleted quietly. Nothing edits a
     marked session (the tab lets go of it), so it holds only the uploaded edits.
   - **It has none, and it's closed or the upload started over 5 minutes ago:** it never landed. The
     mark is removed and the session is offered as usual.
   - **It has none, it's open, and the upload is recent:** the server may still be working on it, so
     the session isn't offered this time.
   - **The API can't be asked** (offline, no answer in 10 s, or the session was uploaded to a different
     API): the restore screen warns that some edits may already be on OSM, with a link to the changeset.
     Restoring it anyway removes the mark.

The changeset's count can be trusted because Rapid only reuses an open changeset after an upload the
server answered with an error, which applied nothing. After `-5` the changeset is closed, and after
`-6` it's forgotten, so the next save opens a new one.
(Until November 3, 2026 it was reused: if that upload had landed, the next save's check would have
counted its changes, and could have reported a later upload as done when it wasn't.)

### A closed changeset

Rapid keeps one changeset open between tries of a save (after conflicts, or a failure we know wasn't
applied), so a save doesn't leave an empty changeset on OSM for every try. The API closes a changeset
on its own an hour after its last upload (for example while the user is on the conflict screen), 24
hours after it opened, or when the user closes it, and then answers an upload with 409 "The changeset
N was closed at …" (`OsmService.isChangesetClosedError`).

- **The service forgets a changeset the API says is closed**, so the next save opens a new one.
  (Before November 2026 it kept it, and every later save got the same 409 until a reload.)
- **The uploader uploads again in a new changeset, once, without asking.** A 409 means nothing was
  applied, so the same changes go again, with the same comment and tags. The old changeset's mark is
  removed like any known failure's, and the new upload marks its own changeset. If the new changeset
  is reported closed too, the save stops with the API's message.

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
| 8 | Upload errors that aren't HTTP errors (offline, the 30 s default timeout) are swallowed by `sendChangeset`, and the save never finishes. A large upload can be cut off by that timeout while the server still applies it. | Fixed: every failure is reported, and with no answer the changeset is checked (see [When an upload gets no answer](#when-an-upload-gets-no-answer)) |
| 9 | The session backup is deleted before uploading (iD#5200), and backups are skipped in save mode, so a reload during a stalled save or the conflict screen loses the edits (Rapid#1480). | Fixed: the session is kept, marked while uploading, and settled with the API by the next tab (see [Keeping the edits during a save](#keeping-the-edits-during-a-save)) |
| 10 | Results of an earlier attempt that arrive late could change a newer attempt's state. | Fixed: each `save()` is a numbered attempt |

Found along the way, fixed in November 2026:
- **"Moved by both" when only the other mapper moved it.** `mergeLocation` compared local and remote but
  not base, so a node the user retagged (or a child node of a way they changed) that someone else moved
  was reported as moved by both. iD has the same. It's a three-way merge now, like tags: a move on only
  one side is kept.
- **Updating a base node didn't update its parent ways' cached extents** (`Graph.rebase` with `force`).
  The graph-geometry rollout fixed it: a forced rebase recomputes the shapes of what contains the
  replaced entities.

## Decisions

- **Check what's uploaded, not what's listed.** The check set comes from `difference.modified()` and
  `deleted()`, not `summary()`. (October 2026)
- **Merges stay in `staging` until the user saves**, then are committed as one edit. Cancel then really
  cancels, which iD's conflict screen can't do. (October 2026)
- **Reuse the versioned multi-fetch.** The conflict check and backup restore both use
  `OsmService.loadEntityVersionsAsync`, which rejects on real failures and works around
  openstreetmap-website#5005 (one missing version makes the whole request 404) by splitting the request.
- **The default choice stays "Use theirs"** (`chosen: 'remote'`), as it was. The first thing a user
  wants to see is what the other mapper did, and "Use theirs" shows it on the map. A user clicking
  through also doesn't overwrite another mapper's work. iD's PR #12814 switches to "Keep mine".
- **A deletion the user keeps is uploaded against the remote version**, by updating the base copy
  (`EditSystem.updateBase`), like iD's PR does with its rebaser. The base is updated only once the user
  saves the conflict screen (November 2026).
- **"Use theirs" for a way leaves shared nodes alone** (unless the other mapper changed them), unlike
  iD. (November 2026)

## Prior art

- iD#7199, and k-yle's [iD PR #12814](https://github.com/openstreetmap/iD/pull/12814), which lists
  Rapid#1361, #1366 and #1480 as the same bug. Its local-deletion handling and recursive `actionRevert`
  are close to what's here.
- openstreetmap-website#5005 (multi-fetch 404s without saying which ID) and #5008 (no multi-fetch for
  histories).
- JOSM resolves conflicts per entity in its own dialog; users stuck in iD's loop download the osmChange
  file and finish there.

## Rollout

1. **This doc and the audit.** ✅
2. **Conflicts work:** findings 1–7 and 10, the conflict screen opening, its download link, and Escape. ✅
   Checked in a headless Chromium against the real app, with the OSM service's upload and fetch faked:
   a tag conflict ("Keep mine" uploads the user's value at the server's version), and a local deletion
   ("Leave Deleted" deletes the server's version).
3. **Upload errors** (finding 8): report every failure, give the upload a 5-minute timeout, and check
   the changeset when an upload gets no answer. ✅
4. **Don't lose the edits during a save** (finding 9): keep the session until the upload succeeds,
   marked while uploading, and settle interrupted uploads with the API in the next tab. ✅ Checked in a
   headless Chromium with every OSM write intercepted: a tab closed mid-upload, then a new tab, with
   the changeset answering "has changes" (deleted quietly), "no changes" (offered), and unreachable
   (offered with the warning).
5. **Choices for ways and their nodes, and deletions** (bug hunt 2, November 2026): the "moved by both"
   false conflict, a node's own choice over its way's, nothing uploaded that's just as the other mapper
   has it, "deleted by both" keeping the nodes' deletions, and "Leave Deleted" taking the nodes the
   other mapper added. ✅
6. **A new changeset when the old one was closed** (November 2026, see "A closed changeset"). ✅
