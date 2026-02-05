# Data

This folder contains various source data files for Rapid, including configuration,
presets, imagery definitions, translations, and validation rules.

### Data files

- **`address_formats.json`** - Address formatting rules by country
- **`editor_layer_index.json`** - Default imagery source definitions (generated)
- **`intro_graph.json`** - Tutorial walkthrough OSM graph data
- **`intro_rapid_graph.json`** - Rapid-specific tutorial data
- **`languages.json`** - Language metadata (generated from CLDR)
- **`locales.json`** - Locale settings and RTL configurations (generated from Transifex)
- **`phone_formats.json`** - International phone number formats
- **`qa_data.json5`** - Quality assurance validation rules for KeepRight and Osmose
- **`rapid_imagery.json5`** - Rapid-specific imagery
- **`rapid_schema.json5`** - Rapid-specific schema
- **`shortcuts.json5`** - Keyboard shortcuts and gesture definitions
- **`territory_languages.json`** - Territory to language mappings (generated from CLDR)
- **`wayback.json`** - Esri Wayback imagery metadata (generated)

- **`core.yaml`** - Core localization strings (YAML format for easier editing)

### Translation Files

The `l10n/` directory contains localization files for multiple languages:
- `core.*.json` - Core UI strings
- `community.*.json` - Community index strings
- `imagery.*.json` - Imagery layer names and descriptions
- `tagging.*.json` - Preset and field labels

These are pulled automatically from the Transifex translation platform.

## Supported File Formats

The following formats are supported for the data files.
(Rapid treats them all equally).

- **JSON** (`.json`) - Classic JSON format - [json.org](https://www.json.org/)
- **JSONC** (`.jsonc`) - JSON with comments - Used by VS Code for config files like `tsconfig.json`
- **JSON5** (`.json5`) - Extended JSON format, allows comments, unquoted keys,
  single quotes, hexidecimal, and more - [json5.org](https://json5.org/)
