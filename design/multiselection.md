# Multiselection Editing

**Status:** Proposed (October 2026). Not started. It follows
[`data-ids.md`](data-ids.md), which made it possible to select any mix of data (Steps 1–5).

## The goal

The user shift-clicks an old OSM building and the Rapid building drawn over it. The sidebar
lists both and offers what can be done with that pair: **Replace geometry** first. The user picks
it, and the sidebar slides over to show what will happen (the OSM building keeps its ID, history and
tags, and takes the Rapid building's shape), with a button to do it. It's one edit, and undo takes it back.

The same sidebar works for any multiselection: copy tags from one feature to others, merge
overlapping lines, union or subtract areas, align or distribute features.

## Vocabulary

- **Multiselection**: more than one feature selected, from any source (OSM, Rapid datasets,
  custom data, notes and other markers).
- **Command**: something the user can do with the selection, like "Replace geometry" or "Copy
  tags". A command may need options or roles, which the operations on today's edit menu never do.
- **Role**: what a feature does in a command. "Copy tags" has one **source** and one or more
  **targets**; "Replace geometry" has a **target** (the OSM feature that's kept) and a **source**
  (the shape it takes).
- **Selection pane** and **command pane**: the two sides of the sidebar described below.

## What people ask for

| Command | What's selected | Requests |
|---------|-----------------|----------|
| Replace geometry | An OSM feature, and the feature whose shape it takes (often a Rapid feature) | Rapid#290, #407, #802, #1491 |
| Copy tags | A source and one or more targets | iD#9191 (and iD#6177) |
| Merge overlapping lines | Two lines that overlap along part of their length | Rapid#1725 |
| Union / Difference | Areas | Rapid#225, iD#435 |
| Split an area along a line | An area and a line across it | iD#9334 |
| Align | Several features | iD#2987 |
| Distribute evenly | Several features (points, or areas like a row of houses) | iD#12669 |

The requests have something in common: today people do these by deleting and redrawing,
or by editing many features one at a time.
- **Replace geometry** is the most requested. Without it, users delete the old feature and add the
  new one, which loses the feature's history and any tags they don't copy over. Rapid#1491 is
  a complaint about exactly that: buildings mapped by local mappers deleted to make room for AI
  buildings. Rapid#407 asks for the old building to keep its history and take the new shape.
- It's also where conflation leads. Conflation marks source features that are "Already
  mapped"; replace geometry is how the user updates the OSM feature from them.
- **Copy tags**: in iD#9191, people use the multiselection tag editor's "Multiple values" lists, or copy
  the text view of the tags, as workarounds. They're asking for something like a format painter.

## The flow

A multiselection shows the **selection pane**: what's selected, and the commands that apply to it.
Picking a command slides the sidebar over to its **command pane**, which shows the details, the
roles and options, and a button to run it. A back button returns to the selection pane.

This is the pattern `UiInspector` already uses to slide between the preset list and the entity
editor (`.panewrap`, moved with `margin-left`, mirrored for right-to-left languages).

```
  Selection pane                        Command pane
+------------------------------+      +------------------------------+
| Multiple Selection        X  |      | <  Replace geometry       X  |
|------------------------------|      |------------------------------|
| Features (2)                 |      | Keep (target)                |
|  [area] Building    OSM   x  |      |  [area] Building    OSM      |
|  [area] Building    msBl. x  | ---> | Take the shape of (source)   |
|                              |      |  [area] Building    msBl.    |
| Commands                     |      |                   [ Swap ]   |
|  > Replace geometry          |      |                              |
|  > Copy tags                 |      | Tags: keep the target's tags |
|  > Edit tags                 |      |  (+ 1 tag from the source)   |
|    Union (areas only)   ...  |      |                              |
|                              |      |          [ Replace ]         |
+------------------------------+      +------------------------------+
```

The selection pane:
- Lists what's selected (today's `UiSectionSelectionList`, from Step 4 of `data-ids.md`). A long list
  is cut short, grouped by source and type with counts (e.g. "48 buildings from OSM, 12 from
  msBuildings"), and each group can be opened.
- Lists the commands that make sense for the selection. A command that doesn't apply is either left
  out or shown disabled with the reason, the way the edit menu's operations are today.
- Hovering a row highlights that feature on the map; the "x" takes it out of the selection.

The command pane:
- Shows the roles, with sensible defaults (for replace geometry, the OSM feature is the target and
  the other feature the source), and lets the user change them. The map marks each feature's role.
- Shows options, if any (which tags to copy; whether to delete the source after a union).
- Previews the result on the map where it can, before anything is edited.
- Runs the command as one edit, then selects the result.

"Edit tags" is a command too: its command pane is today's entity editor with the fields and tags
of all the selected OSM features (the "Multiple values" editor). So every multiselection, all
OSM or not, starts at the selection pane. A single OSM feature still opens the entity editor
directly, as now.

## Commands, operations and the edit menu

Today's operations (`modules/operations/`) are run in one step from the edit menu or a keyboard
shortcut, with no options. Commands that need roles or options don't fit that. The plan:
- A command is an operation that may also have a command pane. Operations that need no input
  (delete, move, rotate, merge, straighten…) keep working as they do, with their shortcuts, and also
  appear in the selection pane's list.
- The edit menu on the map offers the same commands. Picking one with a command pane opens the
  sidebar on that pane.
- Commands work with data IDs (`data-ids.md`), so they can take features that aren't OSM.
  Today's operations take only OSM entity IDs, which is why they're offered only when everything
  selected is OSM.

## Renaming

- `UiInspector` becomes `UiOsmInspector`: it's the inspector for OSM entities.
- `UiSelectionInspector` (the stopgap from `data-ids.md` Step 4) grows into the two-pane
  multiselection inspector.

## Prior art

- **JOSM**:
  - The utilsplugin2 plugin's "Replace Geometry" keeps the OSM object and its ID, reuses its nodes
    where it can, and asks about tag conflicts.
  - "Paste Tags" copies all the tags from the copied objects onto the selection.
  - utilsplugin2's "Split area" splits an area along a line.
- **iD** has the multiselection tag editor ("Multiple values").
- **Drawing apps**:
  - Figma, Illustrator and Inkscape have align and distribute buttons for a multiselection, and
    show "Mixed" for a property that differs across it.
  - Illustrator's Pathfinder (and the same operations in Figma and Inkscape) does union,
    subtract, intersect and exclude.
  - Figma's right sidebar changes with the selection, which is close to the selection pane.

## Steps

1. **The two panes**: the selection pane (list and commands) and sliding to a command pane, with
   "Edit tags" (today's multiselection editor) as the first command. Rename `UiInspector`.
2. **Replace geometry**, the most requested. An OSM feature takes the shape of another feature
   (a Rapid feature, or another OSM feature), keeping its ID, history and tags. It reuses nodes where
   it can, and must not touch nodes that other ways or relations use.
3. **Copy tags**, from a source to targets.
4. **Merge overlapping lines** (Rapid#1725).
5. Later: union and difference, splitting an area along a line, align, and distribute.

## Open questions

1. Is a command offered when it doesn't apply, but disabled with the reason, or left out? The
   edit menu shows them disabled today, which helps people learn what's possible.
2. How are roles chosen when the defaults aren't clear (two OSM features for replace geometry,
   several features for copy tags)? Order of selection, a "Swap" button, or picking from the list?
3. How does replace geometry handle tags: keep the target's, add the source's that are missing,
   and ask when both have a value?
4. Previewing on the map: how is a preview drawn without editing (a temporary graph, or a layer)?
5. Does accepting a Rapid feature become one of these commands ("Add to OSM"), so a selection of
   several Rapid features can be accepted at once?
6. How long can the list be before it's grouped, and what's the grouping?
