# Edit System Design

`EditSystem` (`modules/core/EditSystem.ts`) is Rapid's **undo/redo system**. It keeps the history of
the user's edits, lets them step back and forth through it, and saves it so an editing session can
be restored after a restart.

This system is older than the design docs. This doc started in October 2026, when it became clear
that an edit has to record more than changes to the OSM graph, and records where it's heading.

> **Status:** Design in progress. Done so far: a backup never includes the redo part of the history,
> and a session the user undid back to nothing is removed instead of being offered for restore.
> Next: edit props and labels, then the v4 backup format (see [Rollout](#rollout)).

## Words used here

- **Graph**: a collection of OSM entities (`modules/lib/Graph.ts`). Each graph holds its changes on
  top of the graph before it.
- **Action**: a function that takes a graph and returns it changed, like "add a node" or "move a way".
- **Edit**: one step in the history (`modules/lib/Edit.ts`): the graph after the step, plus a
  description, what was selected, the map position, and the sources used.
- **History**: the list of edits. `history[0]` is **base** (OSM as loaded, before any edits), and
  `history[index]` is **stable** (the latest edit the user kept). Edits after `index` are the
  **redo** part: undone, but not thrown away until the user makes a new edit.
- **Staging**: the edit in progress, not in the history yet. Actions are performed on it, and
  `commit()` adds it to the history.
- **Edit props** (proposed): everything about an edit except its graph, as a plain JSON object, like the
  props of `Preset` and the other library classes.
- **Edit type** (proposed): a prop saying what kind of edit it is, for edits that aren't classic OSM
  edits, like `'rapid_ignore_feature'`. Its other props record what it did that isn't in the OSM
  graph, like which external feature the user ignored.
- **Label** (proposed): what the undo/redo menu says about an edit.
- **Backup** / **session**: the saved copy of the history, in the `DatabaseSystem` `sessions` store,
  that the restore dialog offers after a restart.

## What it owns

- The history, the stable index and the staging edit; `perform`, `commit`, `undo`, `redo`,
  checkpoints and transactions (see the class JSDoc for the API).
- The `editor_base`, `editor_stable` and `editor_staging` spatial caches, kept in step with the graphs.
- Merging newly loaded OSM data into the base graph, and into every graph in the history.
- Backing up the history to a session and restoring it.
- Events: `stagingchange`, `stablechange`, `historyjump` (undo, redo, restore), `merge`, and
  `backupstatuschange`.

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
   all when the change is off screen, so it's hard to see what an undo did.
6. **Backups store base entities, and restoring them is brittle.** A v3 backup stores the original
   (base) copy of every edited entity, plus their child nodes and parent ways, gathered with
   heuristics (iD#4108). To restore, `_loadMissingEntitiesAsync` works out which child nodes are still
   missing, fetches them, and for nodes deleted since, walks back through versions one at a time. Its
   own comments list the problems: callbacks that run more than once, possible endless recursion on
   redacted versions, and a UI that must stay blocked meanwhile. The base copies are also a snapshot of
   OSM at backup time, which can be older than what's on the server. And it has rotted: it reads
   `result.data` from `loadMultipleAsync`, which now returns a plain array (unnoticed because `osm` is
   typed `any`), so restoring a backup that needs missing nodes probably doesn't work.
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
export interface EditProps {
  type?: string;            // kind of edit, set by whoever commits it; classic OSM edits leave it unset
  stringID?: StringID;      // undo/redo label, translated when shown (replaces `annotation`)
  stringParams?: Record<string, string | number>;   // e.g. { n: 3 } for "Moved {n} features"
  annotation?: string;      // plain-text label, only for edits restored from a v3 backup
  selectedIDs?: EntityID[];
  sources?: EditSources;
  transform?: TransformProps;
}

export class Edit<P extends EditProps = EditProps> {
  public context: Context;
  public graph: Graph;      // the OSM graph after this edit; runtime state, so not in `props`
  public props: P;          // plain JSON, saved in backups as is
  public constructor(context: Context, graph: Graph, props: Partial<P> = {}) { … }
  public get label(): string { … }   // l10n.t(stringID, stringParams), or else `annotation`
}

// RapidSystem.ts: Rapid's own kinds of edit, typed
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
  ignoreID: datum.id
});
```

- **Labels are string IDs** (with parameters). `edit.label` translates them when the menu shows them,
  so they follow the user's language, including in a restored session. Like `Preset.name`.
- **The code that commits picks the label,** as it picks the annotation today. Parameters should be
  values like counts, not translated words, or those words stay in the language they were made in.
- **Comparing labels compares string IDs.** A few places merge a repeated edit into the previous undo
  step when its annotation matches (`commitAppend` in `SelectOsmMode`, `UiEntityEditor`,
  `CycleHighwayTagOperation`), and the walkthrough checks the last edit's annotation (`UiIntroBuilding`,
  `UiIntroLine`, `UiIntroRapid`). Today they compare translated text; they'll compare `stringID` (and
  params) or `type` instead, which is more reliable. Operations' `annotation()` methods return a string
  ID and params instead of translated text.
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
- **`sources.data` comes from Rapid's edit props** (the dataset of what was accepted or used) instead
  of the `annotation.dataUsed` cast.

*Why not a separate list of "effects" on each edit?* An earlier draft of this doc had
`effects: EditEffect[]`, a list of typed records, so one edit could carry several. Nothing needs more
than one, and a props bag with a `type` is how the rest of the library works.

### Three different questions

| Question | Method | Used by |
|---|---|---|
| Is there anything to upload? | `hasChanges()`: the graph differs from base (unchanged) | Save and Download buttons, upload |
| Is there work the user would hate to lose? | `hasWork()` (new): the graph changed, or a kept edit has a `type` | Backups, "you'll lose your changes" prompts (e.g. the source switcher) |
| Did any data change since I last looked? | `dataVersion` (PR #5): changes on any edit, undo/redo, merge, restore or reset | Caches of derived data, in Rapid and in embedding apps |

`hasChanges()` keeps its meaning: an add-then-delete that cancels out still isn't saved, and an
ignore still can't be uploaded. `hasWork()` is what's missing for backups.

### Showing what changed (viewport)

On undo, redo and restore, the map should show **where the change is**, not where the map happened to
be. The difference between the two graphs (or, for edits with no graph change like an ignore, the
location of what they're about) gives an extent. If it's already in view, don't move; otherwise ease
to fit it, keeping the zoom where possible. `edit.transform` can stay as a fallback for edits with no location.

### Backup format v4

- **Store base versions, not base entities.** For each entity the history touches, store its ID and
  the version it was edited from. To restore, fetch exactly those versions from the OSM API in one
  versioned multi-fetch (`/nodes?nodes=123v4,456v2`, and the same for ways and relations), with their
  child nodes. That replaces the heuristics for collecting base copies and the version walking in
  `_loadMissingEntitiesAsync`, and restored entities are exactly what the edits were made against.
- **Restoring needs a network,** like the rest of Rapid. Keeping everything in IndexedDB so Rapid works
  offline may come someday, but not for this.
- **A version that can't be fetched** (redacted, or missing) is restored against the current version
  of the entity instead, and save-time conflict resolution sorts out any differences.
- **Store each edit's `props` as they are,** next to what changed in its graph. Restore passes them
  back to the `Edit` constructor without knowing what any owner's props mean.
- **Only the kept history** (up to `index`); done for v3 already.
- **v3 stays restorable, best effort,** for a while. An object annotation spreads into props (its
  `type`, `acceptIDs`, `ignoreID`, `dataUsed` keep their names). A string annotation, or an object
  annotation's `description`, was already translated, so it can't follow the user's language; it's
  kept as the plain-text `annotation` prop, which `label` falls back to.

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

## Open questions

None right now. Questions from the first draft are answered under Decisions.

## Rollout

1. **This doc.** ✅
2. **Undone edits aren't saved.** ✅
3. **Edit props, labels and `hasWork()`.** `Edit<P>` with `props` and a translating `label`; `commit()`
   takes props instead of an annotation; move Rapid accept and ignore to typed props; use `hasWork()`
   for backups. This fixes the ignore-only session. Consider landing `dataVersion` from PR #5 alongside.
4. **Viewport on undo, redo and restore.** Show where the change is.
5. **Backup v4.** Base versions and a versioned multi-fetch on restore; v3 restore converted best effort.
6. **Later:** edits that copy from external data onto OSM features; accept and ignore that outlive the
   session (a `RapidSystem` change).
