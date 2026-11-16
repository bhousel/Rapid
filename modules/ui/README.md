# UI

User interface components built with D3.js. This module contains all the UI panels, dialogs, forms, and controls.

> [!NOTE]
> Coding conventions and the review checklist for this folder are in [`AGENTS.md`](AGENTS.md).

## Overview

Rapid's UI is built using D3.js for DOM manipulation. Every component is a TypeScript class (`UiFoo` in `UiFoo.ts`) that renders into a D3 selection and re-renders when data or the locale changes.

The root components (sidebar, toolbar, footer, over-map container, etc.) are created and owned by `UiSystem` in `modules/core/UiSystem.ts`, which also tracks the stack of open modals. Each folder has an `index.ts` barrel.

## Key Files

### Top-Level Components

| File | Description |
|------|-------------|
| `UiAccount.ts` | User account info in the footer |
| `UiApiStatus.ts` | Status bar across the bottom of the map (e.g. OSM API unavailable) |
| `UiAttribution.ts` | Imagery attribution display |
| `UiContributors.ts` | Nearby contributors list in the footer |
| `UiDefs.ts` | Hidden `<svg><defs>` holding the icon spritesheets |
| `UiEditMenu.ts` | Right-click / long-press menu of operations for the selection |
| `UiFeatureList.ts` | Feature search and search results |
| `UiFilterStatus.ts` | Filtering badge and counts in the footer |
| `UiFullscreen.ts` | Fullscreen key bindings |
| `UiInfoCards.ts` | Container for the info cards floating over the map |
| `UiInspector.ts` | Sidebar inspector: preset list and entity editor that slide side to side |
| `UiMap3dViewer.ts` | 3D map viewer (MapLibre wrapper) |
| `UiMapControls.ts` | Map controls bar (bearing, zoom, zoom to selection, geolocate) |
| `UiMapFooter.ts` | Footer at the bottom of the map (scale, status chips, links, account) |
| `UiMapPanes.ts` | Container for the slide-out map panes |
| `UiMapToolbar.ts` | Top toolbar |
| `UiMinimap.ts` | Mini overview map |
| `UiOvermap.ts` | Container for UI elements that float over the map |
| `UiPhotoViewer.ts` | Resizable street-level photo viewer |
| `UiProjectLinks.ts` | "Help translate" / "report a bug" links in the footer |
| `UiScale.ts` | Map scale bar |
| `UiSidebar.ts` | Main sidebar container |
| `UiSourceSwitch.ts` | Footer switch between "live" and "dev" map instance |
| `UiSpector.ts` | Spector.js WebGL debugger (development build only) |
| `UiValidatorStatus.ts` | Validation issue badges and counts in the footer |
| `UiVersionInfo.ts` | Rapid version, changelog link and "new version" badge |

### Shared Primitives

| File | Description |
|------|-------------|
| `UiCombobox.ts` | Autocomplete/suggestion behavior attached to an `<input>` |
| `UiDisclosure.ts` | Toggleable label over collapsible content |
| `UiPane.ts` | Base class for the map panes in `panes/` |
| `UiTooltip.ts` | Hover/focus tooltip attached to anchor elements |
| `icon.ts` | `uiIcon()` helper that renders a sprite `<svg>` icon |

### Dialogs, Modals & Save Flow

| File | Description |
|------|-------------|
| `UiCommit.ts` | Changeset upload sidebar |
| `UiCommitWarnings.ts` | Validation warnings shown in the upload sidebar |
| `UiConfirm.ts` | Confirmation dialog |
| `UiConflicts.ts` | Edit conflicts resolution |
| `UiFlash.ts` | Transient messages that slide over the footer |
| `UiLoading.ts` | Loading spinner modal |
| `UiModal.ts` | Modal dialog base (stackable, managed by `UiSystem`) |
| `UiRestore.ts` | Restore unsaved edits dialog |
| `UiShortcuts.ts` | Keyboard shortcuts dialog |
| `UiSplash.ts` | Welcome / privacy policy splash screen |
| `UiSuccess.ts` | Upload success screen |
| `UiWhatsNew.ts` | What's new dialog |

### Editors & Inspectors

| File | Description |
|------|-------------|
| `UiEntityEditor.ts` | Main entity editor (gathers the inspector sections) |
| `UiPresetList.ts` | Searchable preset list for choosing a feature type |
| `UiFormFields.ts` | Renders the preset fields, plus the "more fields" combo |
| `UiChangesetEditor.ts` | Changeset comment / source / hashtags editor |
| `UiDataEditor.ts` | Custom data editor |
| `UiNoteEditor.ts` | OSM note editor |
| `UiKeepRightEditor.ts` | KeepRight issue editor |
| `UiOsmoseEditor.ts` | Osmose issue editor |
| `UiMapRouletteEditor.ts` | MapRoulette task editor (`UiMapRouletteMenu.ts` is its right-click menu) |
| `UiRapidInspector.ts` | Rapid feature inspector (accept / ignore) |
| `UiOvertureInspector.ts` | Overture feature inspector |
| `UiDetectionInspector.ts` | Mapillary detection inspector |
| `UiSelectionInspector.ts` | List of what's selected, when several features aren't all OSM entities |
| `UiTagReference.ts` | Tag documentation from the OSM Wiki / Wikidata |
| `UiPresetIcon.ts` | Icon for a preset, category, or features |
| `UiViewOn.ts` | "View on OSM" (or other service) link at the bottom of an inspector |

The data, note, QA and detection editors are composed from smaller `…Header`, `…Details` (and for notes, `UiNoteComments` / `UiNoteReport`) components in the same folder.

### Rapid

| File | Description |
|------|-------------|
| `UiRapidAddDataset.ts` | Add a custom dataset |
| `UiRapidCatalog.ts` | Browse the catalog of Rapid datasets |
| `UiRapidColorpicker.ts` | Dataset color swatch and picker |
| `UiRapidDatasetSettings.ts` | Change a dataset's settings |
| `UiRapidDatasetToggle.ts` | Toggle datasets on and off (the main "Rapid" button) |
| `UiRapidFirstEditDialog.ts` | Shown after the user's first Rapid edit (currently disabled) |
| `UiRapidPowerUserFeatures.ts` | Toggle power-user features (`&poweruser=true`) |

### Subfolders

| Folder | Description |
|--------|-------------|
| `cards/` | Info cards (background, history, location, measurement), extending `AbstractUiCard` |
| `controls/` | Map control buttons (bearing, zoom, zoom to selection, geolocate) |
| `fields/` | Form field types (text, combo, address, etc.), extending `AbstractUiField`. `createUiField()` picks the class from the preset field's `type` |
| `intro/` | Tutorial walkthrough: `UiIntro` orchestrator, `UiCurtain`, and chapters extending `AbstractIntroChapter` |
| `panes/` | Map panes (Background, Map Data, Issues, Preferences, Help), extending `UiPane` |
| `sections/` | Sections of the inspector, panes and upload screen, extending `AbstractUiSection` |
| `settings/` | Modals for custom background imagery and custom data |
| `tools/` | Toolbar sections (draw modes, Rapid, undo/redo, save, download OSC) |

### Disabled & Legacy

| File | Description |
|------|-------------|
| `field_help.ts` | Help panel for the restrictions field (all commented out) |
| `fields/UiFieldRestrictions.ts` | Turn restrictions field, placeholder until it's rebuilt on Pixi (not shown yet) |
| `sections/section.ts` | Old `uiSection()` factory, only used by the React demo below |
| `sections/*.jsx` | Quarantined React demo, not wired up |

## Component Pattern

A typical component captures its parent selection on the first `render()` and reuses it on later renders:

```ts
export class UiExample extends EventEmitter {
  public context: Context;
  public $parent: D3Selection | null;

  constructor(context: Context) {
    super();
    this.context = context;
    this.$parent = null;

    this.render = this.render.bind(this);
  }

  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }
    // Render into D3 selection
  }
}
```

Components that emit events extend `EventEmitter` (from `tseep`), and consumers listen with `.on()` / `.off()`.

Some components work differently:
- Components handed their target by a parent on each render (fields, the save-flow parts, menus) take it as `render($selection)`.
- Inspector parts (headers, details, editors) get their data from a public property like `datum`, set before `render()`.
- `UiCombobox` and `UiTooltip` are configured with fluent setters and attached with `selection.call(x.attach)`.
- Modals render into the `$content` selection of a `UiModal`.
- The walkthrough chapters are small state machines with `enter()` / `exit()`, not `render()`.
