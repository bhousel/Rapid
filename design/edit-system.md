# Edit System Design

`EditSystem` (`modules/core/EditSystem.ts`) is Rapid's **undo/redo system**. It keeps the history of
the user's edits, lets them step back and forth through it, and saves it so an editing session can
be restored after a restart.

This system is older than the design docs. This doc started in October 2026, when it became clear
that an edit has to record more than changes to the OSM graph, and records where it's heading.

> **Status:** In progress. Done so far: a backup never includes the redo part of the history, a
> session the user undid back to nothing is removed, and edits are a graph plus props with translated
> labels and a `type` (Rollout step 3), so a session of only Rapid ignores is backed up too. Undo and
> redo now show where the change is, move the map only when needed, restore the selection from before
> or after the edit, and one more redo returns the user to where they were (step 4). Backups are v4:
> they save base versions instead of base entities, and restore fetches them (step 5).
> Next: edits that use external data on OSM features (see [Rollout](#rollout)).

## Words used here

- **Graph**: a collection of OSM entities (`modules/lib/Graph.ts`). Each graph holds its changes on
  top of the graph before it.
- **Action**: a function that takes a graph and returns it changed, like "add a node" or "move a way".
- **Edit**: one step in the history (`modules/lib/Edit.ts`): the graph after the step, plus props
  (its label, what was selected before and after, where the change is, the map position, the sources
  used, and so on).
- **History**: the list of edits. `history[0]` is **base** (OSM as loaded, before any edits), and
  `history[index]` is **stable** (the latest edit the user kept). Edits after `index` are the
  **redo** part: undone, but not thrown away until the user makes a new edit.
- **Staging**: the edit in progress, not in the history yet. Actions are performed on it, and
  `commit()` adds it to the history.
- **Edit props**: everything about an edit except its graph, as a plain JSON object, like the
  props of `Preset` and the other library classes.
- **Edit type**: a prop saying what kind of edit it is, for edits that aren't classic OSM
  edits, like `'rapid_ignore_feature'`. Its other props record what it did that isn't in the OSM
  graph, like which external feature the user ignored.
- **Label**: what the undo/redo menu says about an edit. Stored as a string ID and parameters
  (`EditLabel`), translated when shown.
- **Backup** / **session**: the saved copy of the history, in the `DatabaseSystem` `sessions` store,
  that the restore dialog offers after a restart.
- **Selection**: selected data IDs grouped by the layer that draws them (`EditSelection`), like
  `{ osm: ['w1'] }` or `{ rapid: ['ds:abc:0'] }`. The same shape `select-osm` takes.
- **Extent** (of an edit): where its change is, as `[minLon, minLat, maxLon, maxLat]`.
- **Return view**: where the user was, and what they had selected, when they first undid away from
  the newest edit. Offered as one more redo past the newest edit. It's never in the history.

## What it owns

- The history, the stable index and the staging edit; `perform`, `commit`, `undo`, `redo`,
  checkpoints and transactions (see the class JSDoc for the API).
- The `editor_base`, `editor_stable` and `editor_staging` spatial caches, kept in step with the graphs.
- Merging newly loaded OSM data into the base graph, and into every graph in the history.
- Backing up the history to a session and restoring it.
- The return view (`returnEdit`).
- Events: `stagingchange`, `stablechange`, `historyjump` (undo, redo, restore), `returnview`, `merge`,
  and `backupstatuschange`.

`MapSystem` owns the other half of undo and redo: moving the map and restoring the selection, in its
`historyjump` and `returnview` handlers.

## How it got here

In iD, the history was a **stack of immutable OSM graphs**. Every action returned a new graph, and
undo meant stepping back to an older one. The idea was that the whole state of the editor could be
encoded in a graph, so pushing and popping graphs was all undo/redo needed.

That assumption didn't hold up, and comments about it are scattered around the code:
- **Graphs aren't immutable anymore.** Making a new graph for every change was too slow, so graphs
  are transactional: change them, then `commit()` (see the `Graph` JSDoc).
- **Loaded data changes old graphs in place.** When more of the map loads, `merge()` adds the new
  entities to the base graph and to every graph in the history (`rebase`), and bumps relations
  whose members arrived (`touch()`) so multipolygons redraw. A graph's `key` doesn't change when
  this happens.
- **Three graphs, not one.** `base`, `stable` and `staging` each have a spatial cache, and the system
  works hard to keep the right things redrawn after edits, undo, redo and merges.
- **Edits started to mean more than OSM changes.** Accepting and ignoring Rapid features had to be
  undoable, so their edits carry an object in `annotation` instead of a string:
  `{ type: 'rapid_accept_feature', acceptIDs, dataUsed }` or `{ type: 'rapid_ignore_feature', ignoreID }`.
  `RapidSystem` reads these back on every `stablechange` to know what the user accepted and ignored.
  Ignoring changes nothing in the graph (it commits `actionNoop()`).

## Problems today

1. **`annotation` does two jobs.** It's typed `string` and used as the undo/redo label, but Rapid edits
   store an object there to record what they did. Code that needs that record casts it
   (`RapidSystem._stablechange`, and `EditSystem` itself when gathering `dataUsed`). Nothing else
   knows the second job exists.
2. **"Did the graph change?" is used as "is there work worth saving?"** The backup only happens if
   `hasChanges()` (the graph differs from base). So a session where the user only ignored features
   is never backed up, and those ignores are lost on restart, even though Rapid now gives external
   features stable IDs so they'd survive one.
3. **Edits we want can't be expressed.** For example, selecting an OSM feature and an external
   feature and copying some tags or geometry from one to the other. That's a graph change plus a
   fact about the external feature ("used to update w123"), and there's nowhere to put the second part.
4. **Labels are translated when the edit is made.** A restored session shows its undo/redo labels in
   whatever language it was saved in.
5. **The map jumps around on undo, redo and restore.** `MapSystem` moves to `edit.transform`, which is
   where the map happened to be when the edit was committed, not where the change is. Undo uses the
   transform of the edit being undone. The result can be a jump to somewhere unrelated, or no move at
   all when the change is off screen, so it's hard to see what an undo did. And after the user looks
   around, undoes and redoes, there's no way back to where they were. (Fixed in step 4.)
6. **Backups store base entities, and restoring them is brittle.** A v3 backup stores the original
   (base) copy of every edited entity, plus their child nodes and parent ways, gathered with
   heuristics (iD#4108). To restore, `_loadMissingEntitiesAsync` works out which child nodes are still
   missing, fetches them, and for nodes deleted since, walks back through versions one at a time. Its
   own comments list the problems: callbacks that run more than once, possible endless recursion on
   redacted versions, and a UI that must stay blocked meanwhile. The base copies are also a snapshot of
   OSM at backup time, which can be older than what's on the server. And it has rotted: it reads
   `result.data` from `loadMultipleAsync`, which now returns a plain array (unnoticed because `osm` is
   typed `any`), so restoring a backup that needs missing nodes probably doesn't work. (Fixed in step 5.)
7. **No cheap way to know data changed.** Apps that embed Rapid want to cache things derived from the
   graph. Graph keys don't change on `merge()`, so they can't rely on them. PR #5 (APIs for embedding
   apps) proposes `EditSystem.dataVersion`, a number that changes whenever any graph's data may have
   changed.

## Design

### An edit is a graph plus a bag of props

`Edit` works like the other library classes (`Preset`, `Field`, `ImagerySource`): a props object with
the fields it understands, which owners can extend with their own.

```ts
// lib/Edit.ts: the fields EditSystem itself understands
export interface EditLabel {
  stringID: StringID;                 // e.g. 'operations.move.annotation.feature'
  stringParams?: EditLabelParams;     // e.g. { n: 3 } for "Moved {n} features"
}

export interface EditProps {
  type?: string;            // kind of edit, set by whoever commits it; classic OSM edits leave it unset
  stringID?: StringID;      // undo/redo label, translated when shown (replaces `annotation`)
  stringParams?: EditLabelParams;
  annotation?: string;      // plain-text label, only for edits restored from a v3 backup
  selection?: EditSelection;        // what's selected after the edit; redo restores it
  selectionBefore?: EditSelection;  // what was selected before; undo restores it (filled in at commit)
  extent?: Vec4;            // where the change is (computed at commit, or given by the committer)
  sources?: EditSources;
  transform?: TransformProps;   // where the user was looking when they made it
}

export type EditSelection = Record<LayerID, DataID[]>;   // e.g. { osm: ['w1'] }

export class Edit<P extends EditProps = EditProps> {
  public context: Context;
  public graph: Graph;      // the OSM graph after this edit; runtime state, so not in `props`
  public props: P;          // plain JSON (copied on construction), saved in backups as is
  public constructor(context: Context, graph: Graph, props: Partial<P> = {}) { … }
  public get label(): string { … }        // l10n.t(stringID, stringParams), or else `annotation`
  public get hasLabel(): boolean { … }
  public isLabeled(label: Nullable<EditLabel>): boolean { … }   // same string ID and params?
}

// RapidSystem.ts: Rapid's own kinds of edit, typed
export interface RapidAcceptEditProps extends EditProps {
  type: 'rapid_accept_feature';
  acceptIDs: DataID[];
}
export interface RapidIgnoreEditProps extends EditProps {
  type: 'rapid_ignore_feature';
  ignoreID: DataID;
}
```

```ts
// committing an ignore
editor.commit<RapidIgnoreEditProps>({
  type: 'rapid_ignore_feature',
  stringID: 'rapid_inspector.option_ignore.annotation',
  ignoreID: datum.id,
  extent: datum.extent()?.rectangle()   // no graph change, so it says where it is
});
```

- **Labels are string IDs** (with parameters). `edit.label` translates them when the menu shows them,
  so they follow the user's language, including in a restored session. Like `Preset.name`.
- **The code that commits picks the label,** as it picks the annotation today. Parameters should be
  values like counts, not translated words, or those words stay in the language they were made in.
- **Comparing labels compares string IDs.** A few places merge a repeated edit into the previous undo
  step when its label matches (`commitAppend` in `SelectOsmMode`, `UiEntityEditor`,
  `CycleHighwayTagOperation`), and the walkthrough checks the last edit (`UiIntroBuilding`,
  `UiIntroLine`, `UiIntroRapid`). They used to compare translated text; now they use
  `editor.getUndoEdit()?.isLabeled(label)` (string ID and params) or check `props.type`.
  Operations have `editLabel()` (it was `annotation()`), which returns an `EditLabel`; callers spread it
  into the commit props, and the edit menu translates it for its flash message. Validator autofixes
  carry an `[action, EditLabel]` pair.
- **`type` says what kind of edit it is.** Classic OSM edits leave it unset. Each kind of edit is
  defined by the system that makes it, with its own props interface, so code reads `edit.props.ignoreID`
  with a type instead of casting an annotation. The existing type strings stay
  (`'rapid_accept_feature'`, `'rapid_ignore_feature'`).
- **`EditSystem` doesn't interpret an owner's props.** It stores them, saves them and restores them.
  The owner folds over the kept history (`history[1..index]`) to work out its state, which is what
  `RapidSystem._stablechange` already does with annotations. Undo, redo and restore then work without
  any extra bookkeeping.
- **Props must be plain JSON,** since backups save them as they are. `graph` stays outside `props` for
  that reason.
- **One kind of edit per `Edit`.** An edit that changes OSM and records something else is still one
  kind: copying tags from an external feature onto w123 would be a graph change plus
  `{ type: 'rapid_use_feature', dataID, entityID }`. If an edit ever needs to record several things,
  its props can hold arrays (as `acceptIDs` already does).
- **`sources.data` comes from the committed props.** The Rapid inspector passes
  `sources: { data: [...] }` for the dataset it accepted from, and `commit()` adds the imagery, photos
  and custom data in use, instead of reading `annotation.dataUsed`.

*Why not a separate list of "effects" on each edit?* An earlier draft of this doc had
`effects: EditEffect[]`, a list of typed records, so one edit could carry several. Nothing needs more
than one, and a props bag with a `type` is how the rest of the library works.

### Three different questions

| Question | Method | Used by |
|---|---|---|
| Is there anything to upload? | `hasChanges()`: the graph differs from base (unchanged) | Save and Download buttons, upload |
| Is there work the user would hate to lose? | `hasWork()`: the graph changed, or a kept edit has a `type` | Backups, the browser's "leave this page?" prompt, the source switcher's warning |
| Did any data change since I last looked? | `dataVersion` (PR #5): changes on any edit, undo/redo, merge, restore or reset | Caches of derived data, in Rapid and in embedding apps |

`hasChanges()` keeps its meaning: an add-then-delete that cancels out still isn't saved, and an
ignore still can't be uploaded. `hasWork()` is what's missing for backups.

### Showing what changed (viewport and selection)

On undo, redo and restore, the map shows **where the change is**, and moves only when it has to:
jumping around on every undo is jarring.

**Each edit records two places:**

| Prop | What | Why |
|---|---|---|
| `transform` | where the user was looking when they made the edit | a familiar view to go back to |
| `extent` | where the change is, as lon/lat bounds | works on any screen size or device, unlike a transform |

`EditSystem` computes `extent` at commit from the difference between the graph before and after: the
nodes, and the nodes of ways, that were created, modified or deleted (deleted ones where they were).
An edit with no graph change passes its own, as an ignore passes the ignored feature's extent. Edits
restored from older backups get one computed from their graphs. An edit with no extent falls back
to its `transform`.

**Moving only when needed** (`MapSystem.viewForExtent`, `showExtentAsync`):
1. If the change is already in view, don't move. "In view" means most of it (80%) is in the part of
   the map not covered by the header and footer, and the map isn't zoomed too far out to see it
   (2 levels out from the zoom that fits it, but anything counts as visible at z16 or closer). A change
   too big to fit counts if any of it is in view.
2. Otherwise, if the edit's own `transform` shows it, go there.
3. Otherwise, center on it, keeping the current zoom where possible: zoom out only to fit it, never
   past z16 (or past where the user already is), and zoom in only as far as needed to see it.

**How far and how fast** (`MapSystem.easeDuration`): by the distance in screens (measured at the lower
of the two zooms) and the change in zoom. Within about a screen, ease 250 ms; within a few, 500 ms.
Undo and redo jump to anything farther, since a long ease across the map is just a blur; the
walkthrough, which used to measure in meters with its own `transitionTime`, uses the same durations
and still eases far moves (1000 ms).

**Which edit and which selection:** undo shows the edit it took back and restores what was selected
**before** it (`selectionBefore`, recorded at commit from the current mode). Redo and restore show the
edit they brought in and restore what was selected **after** it (`selection`, given by the committer).
So undoing an accept selects the Rapid feature again, ready to accept or look at, and undoing a
delete selects what was deleted. OSM IDs must be in the graph; other data is looked up on the layer
that draws it, which can take a redraw or two after undo (the feature has to come back first), so
`MapSystem` tries again after the next few redraws. The modes can't select OSM and other data
together yet, so OSM wins.

**The return view.** On the first undo away from the newest edit, `EditSystem` remembers where the user
is and what they have selected (`returnEdit`). Redoing back to the newest edit shows that edit's change
as usual; then **one more redo** returns the user to where they were before they started undoing, with
their selection ("Redo: Return to where you were."). For example: accept a sidewalk, scroll to its
other end to see what's there, undo (the map goes back to the sidewalk), redo (the sidewalk comes back),
redo again (back at the other end).
- It's an `Edit` that lives only in the redo slot, never in the history: it isn't backed up, can't
  discard the redo stack, and `hasWork()` never sees it. `getRedoEdit()` returns it, so the undo/redo
  tool's tooltip and shortcut work unchanged; `redo()` uses it up and emits `returnview`.
- Further undos and redos keep the first place the user left from, even if they pan in between.
- Any new commit, a reset, a restore, or restoring a checkpoint clears it.
- If redo's move to the newest edit leaves the map about where the return view is (centers within a
  quarter screen, zoom within one level), `MapSystem` clears it, so there's no extra redo that does
  nothing. If the user pans there by hand afterward, the extra redo does nothing visible; that's
  accepted.

**Undo during a drag or draw** (work in progress) throws the work away and emits `historyjump` with the
same index. The map doesn't move (nothing in the history changed), but `MapSystem` still enters a mode,
which ends the drag. Draw modes handle `historyjump` themselves. It doesn't save the return view;
the next undo, which actually leaves the newest edit, does.

**Restore** shows the extent of the last kept edit.

### Backup format v4

```ts
{
  version: 4,
  entities: [ … ],                         // copies of every entity the kept edits changed (by key, e.g. 'n1v1')
  baseVersions: { n1: 1, n2: 2, w1: 4 },   // the OSM version each base entity was edited from
  stack: [ {}, { modified: ['n1v1'], deleted: ['n3'], props: { … } }, … ],
  nextIDs: { … }, index: 1, timestamp: …
}
```

- **Store base versions, not base entities.** The entities saved are the same as before (iD#4108):
  each entity the history touches, the child nodes of edited ways, the parent ways of edited entities,
  and now also the child nodes of those parent ways, so nothing is left to fetch afterward. Only the
  ID and version of each is stored. Entities without a version didn't come from OSM and are left out.
- **Restore fetches exactly those versions** in one versioned multi-fetch per type (`/nodes?nodes=123v4,456v2`,
  `OsmService.loadEntityVersionsAsync`, in chunks of 150). That replaces `_loadMissingEntitiesAsync` and its
  version walking, and restored entities are exactly what the edits were made against.
- **Restoring needs a network,** like the rest of Rapid. Keeping everything in IndexedDB so Rapid works
  offline may come someday, but not for this. If the OSM API can't be reached, the restore fails before
  touching the history: the session stays saved, and the user sees "Couldn't restore your edits…" with a
  suggestion to reload and try again. Finishing anyway isn't an option: a way whose child nodes are
  missing breaks drawing (`graph.childNodes()` throws).
- **A version that can't be fetched** (redacted, or missing) is restored against the current version
  of the entity instead, and save-time conflict resolution sorts out any differences. If the entity has
  been deleted since, the version before the deletion is used. Anything still missing is left out.
  The API answers 404 for a whole multi-fetch if any version in it can't be found (checked against the
  live API; fetching a redacted version on its own is a 403), so the service splits a chunk that fails
  that way in half and tries again, until only the versions that can't be found are left out.
- **The restore list's location** (the session's bbox) comes from the changed entities and each edit's
  `extent`, which also covers what was deleted, now that deleted entities aren't stored.
- **Store each edit's `props` as they are,** next to what changed in its graph. Restore passes them
  back to the `Edit` constructor without knowing what any owner's props mean. (Done already: since
  step 3, each history item in a v3 backup has `props` in place of `annotation`, `selectedIDs`,
  `transform` and `*Used`. The version stayed 3, since only the items changed and restore reads both.)
- **Only the kept history** (up to `index`); done for v3 already.
- **v3 stays restorable, best effort,** for a while. Its base entities are used as saved, and child
  nodes it's missing are fetched at their current version through the same path (which fixed the
  `result.data` bug). An object annotation spreads into props (its
  `type`, `acceptIDs`, `ignoreID`, `dataUsed` keep their names). A string annotation, or an object
  annotation's `description`, was already translated, so it can't follow the user's language; it's
  kept as the plain-text `annotation` prop, which `label` falls back to. `selectedIDs` (on old items,
  or in props saved briefly before step 4) becomes `selection: { osm: selectedIDs }`.

## Decisions

- **Undone edits aren't saved** (October 2026). A backup stops at `index`, and a session undone back to
  nothing is deleted, since users don't expect to get back work they undid.
- **`hasChanges()` keeps meaning "the graph changed".** The new `hasWork()` answers "is there work to
  save", so the Save button and backups can disagree (an ignore is work, but nothing to upload).
- **An `Edit` is a graph plus a props bag**, like `Preset` and the other library classes, with a `type`
  for edits that aren't classic OSM edits. Each kind of edit belongs to the system that makes it;
  `EditSystem` stays the undo/redo wrapper and doesn't learn about Rapid or any other owner.
  (Chosen over a separate list of "effects" per edit, October 2026.)
- **Labels are l10n string IDs** with parameters, translated when shown. The code that commits still
  picks the label. A label restored from a v3 backup is kept as plain text (`annotation`).
- **Edit types aren't registered.** Almost all edits are classic, untyped OSM edits; any edit with a
  `type` counts as work and is saved as is.
- **Backups move to v4**, storing base versions instead of base entities. v3 restore stays, best effort.
- **Restoring needs a network.** v4 rebuilds base entities from the OSM API, and nothing else in Rapid
  works offline today either.
- **A version that can't be fetched is restored against the current version,** and save-time conflict
  resolution handles the rest.
- **Accept and ignore outliving the session is a Rapid question,** recorded in
  [`rapid-system.md`](rapid-system.md). Within a session they stay edits in the history, so undoing an
  ignore brings the feature back.
- **Selection is grouped by layer** (`EditSelection`), not a flat `DataID[]`: restoring a selection
  needs to know which layer to find each ID in. Moved up from the backup v4 step into step 4, since
  undoing back to the selection before an edit is when it starts to matter. (October 2026)
- **Each edit records the selection before and after.** Undo restores before, redo restores after.
- **An edit records where the change is as an extent, not a transform**, so it can be shown on any
  screen size or device. The `transform` (where the user was looking) is kept too; it's cheap.
- **Move the map only when needed** on undo and redo, and jump instead of easing when it's far.
- **No placeholder edits for map moves.** A "view" edit in the history would discard the redo stack
  the moment the user panned after an undo, and undo would start stepping through map moves. The
  return view gives the one thing that was wanted (redo back to where you were) without either.
- **The return view keeps the first place the user left from**, through any panning, undos and redos,
  until a new edit.
- **Undo during a drag throws the drag away** (as before), rather than committing it first so redo could
  bring it back. Some apps disable undo during drags instead; either is fine.
- **A series of tag changes still merges into one undo step** (`commitAppend` when the label and
  selection match), however far apart in time. It's a bit unintuitive, and undoing it can take back
  changes the user can't see, but leave it alone for now.
- **A restore that can't reach the OSM API fails** rather than restoring part of the session (October
  2026). The session stays saved for another try. This applies to the walkthrough too, which saves the
  user's edits as a backup when it starts and restores them when it ends, so that now fetches as well.
- **v4 backups save the child nodes of parent ways too**, so a restore is one fetch per type, with no
  second round for nodes that turn out to be missing.
- **Undo and redo restore a non-OSM selection by finding the data on its layer** (`AbstractPixiLayer.getData`),
  so only data that's drawn can be selected again. Good enough for Rapid features, which come back on
  the next redraw.

## Prior art

Steve Ruiz (tldraw, a drawing app with many of the same problems) wrote up what he learned building
undo/redo: [things I've learned](https://x.com/steveruizok/status/1566142910546038784), [a manager on
JSON patches](https://x.com/steveruizok/status/1487052071685734410), and [edge
cases](https://x.com/steveruizok/status/1487072814049943552). What applies here:
- **Commands that do something different on redo than the first time** (his "soft delete"). Not a
  problem for us: every edit is a whole graph, and owners like `RapidSystem` derive their state from
  the kept history, so redo just goes back to it.
- **Continuous interactions** (dragging, a color picker) make one history entry when they end. Ours
  build up in `staging` and commit once.
- **A change after undo drops the redo stack**, and you can never redo after a change. Same here; the
  return view is cleared by any commit too.
- **Figma records selection changes in the history, but only when there's nothing to redo**, so you can
  undo, change the selection, and still redo. That's the idea behind restoring the selection from
  before an edit, and behind the return view (one slot, never in the history).
- **Undo during a continuous interaction must end it**, or the app gets stuck mid-drag (he shows apps
  with this bug). Ours ends it by entering a mode, even when the map doesn't move.
- **Timed coalescing** (from a reply): merge repeated changes only within a short time, as text
  inputs do. We merge tag changes regardless of time; see Decisions.

## Open questions

None right now. Questions from the first draft are answered under Decisions.

## Rollout

1. **This doc.** ✅
2. **Undone edits aren't saved.** ✅
3. **Edit props, labels and `hasWork()`.** ✅ `Edit<P>` with `props` and a translating `label`;
   `commit()` takes props; every caller commits a `stringID` (operations, modes, validators, UI, the
   walkthrough); Rapid accept and ignore are typed props; backups use `hasWork()` and save props, so an
   ignore-only session is backed up (checked live). `dataVersion` from PR #5 didn't land with it.
4. **Viewport and selection on undo, redo and restore.** ✅ Edits record their `extent` and the
   selection before and after (`EditSelection`, by layer; `selectedIDs` is gone). `MapSystem` shows
   the change only when it isn't already in view (`viewForExtent`, `showExtentAsync`, `easeDuration`,
   which also replaced the walkthrough's `transitionTime`), undo restores the selection before and
   redo the selection after, and the return view takes the user back to where they were. Checked live:
   accept a sidewalk, pan away, undo (Rapid feature selected again), redo (no move), redo (back where
   they panned to).
5. **Backup v4.** ✅ Backups save base versions (`baseVersions`), and restore fetches them with a
   versioned multi-fetch (`OsmService.loadEntityVersionsAsync`), falling back to the current version.
   v3 restore still works, best effort. A restore that can't reach the API fails and keeps the session.
   Checked live: a v3 session restored, was backed up as v4 (3 versions instead of copies), and that
   restored the same graph from one request; a failed fetch showed the message and left the session saved.
6. **Later:** edits that copy from external data onto OSM features; accept and ignore that outlive the
   session (a `RapidSystem` change).
