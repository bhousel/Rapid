# UI

User interface components built with D3.js. This module contains all the UI panels, dialogs, forms, and controls.

## Overview

Rapid's UI is built using D3.js for DOM manipulation. Components follow a pattern of rendering into a selection and updating when data changes.

## Key Files

### Top-Level Components

| File | Description |
|------|-------------|
| `UiAccount.js` | User account display and login |
| `UiApiStatus.js` | OSM API status indicator |
| `UiAttribution.js` | Map attribution display |
| `UiContributors.js` | Contributor list display |
| `UiDefs.js` | SVG definitions (patterns, gradients) |
| `UiFeatureList.js` | Search results and feature list |
| `UiField.js` | Form field wrapper |
| `UiFilterStatus.js` | Filter status display |
| `UiFullscreen.js` | Fullscreen toggle |
| `UiInfoCards.js` | Expandable info cards |
| `UiInspector.js` | Main feature inspector panel |
| `UiMap3dViewer.js` | 3D map viewer panel |
| `UiMapControls.js` | Map zoom/rotate controls |
| `UiMapFooter.js` | Map footer with coordinates |
| `UiMapPanes.js` | Sidebar panes container |
| `UiMapToolbar.js` | Top toolbar |
| `UiMinimap.js` | Mini overview map |
| `UiOvermap.js` | Overlay UI above the map |
| `UiPhotoViewer.js` | Street-level photo viewer |
| `UiRapidCatalog.js` | Rapid dataset catalog |
| `UiScale.js` | Map scale indicator |
| `UiShortcuts.js` | Keyboard shortcuts dialog |
| `UiSidebar.js` | Main sidebar container |
| `UiValidatorStatus.js` | Validation issue status |

### Dialogs & Modals

| File | Description |
|------|-------------|
| `commit.js` | Changeset upload dialog |
| `confirm.js` | Confirmation dialog |
| `conflicts.js` | Edit conflicts resolution |
| `flash.js` | Flash messages |
| `loading.js` | Loading indicator |
| `modal.js` | Modal dialog base |
| `restore.js` | Restore unsaved edits dialog |
| `splash.js` | Welcome splash screen |
| `success.js` | Upload success message |
| `whats_new.js` | What's new dialog |

### Editors

| File | Description |
|------|-------------|
| `entity_editor.js` | Main entity tag editor |
| `changeset_editor.js` | Changeset tag editor |
| `data_editor.js` | Custom data editor |
| `note_editor.js` | OSM note editor |
| `keepRight_editor.js` | KeepRight issue editor |
| `osmose_editor.js` | Osmose issue editor |
| `maproulette_editor.js` | MapRoulette task editor |

### Subfolders

| Folder | Description |
|--------|-------------|
| `cards/` | Info card components |
| `controls/` | Map control buttons |
| `fields/` | Form field types (text, combo, address, etc.) |
| `intro/` | Tutorial/introduction walkthrough |
| `panes/` | Sidebar pane components |
| `sections/` | Collapsible sections |
| `settings/` | Settings panels |
| `tools/` | Toolbar tool buttons |

## Component Pattern

UI components typically follow this pattern:

```javascript
export function uiExample(context) {
  function render(selection) {
    // Render into D3 selection
  }

  return render;
}
```

Or as a class:

```javascript
export class UiExample {
  constructor(context) {
    this.context = context;
  }

  render(selection) {
    // Render into D3 selection
  }
}
```
