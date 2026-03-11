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
- **`osm_rulesets.json5`** - Tag classification rulesets and variables for OSM data
  (e.g. surface types, highway classifications, lifecycle prefixes)
- **`phone_formats.json`** - International phone number formats
- **`qa_data.json5`** - Quality assurance validation rules for KeepRight and Osmose
- **`rapid_imagery.json5`** - Rapid-specific imagery source definitions
- **`rapid_schema.json5`** - Rapid-specific schema customizations (presets, fields, categories)
- **`rapid_style.json5`** - Map styling rules: style declarations, selectors, variables, and
  the `DEFAULTS`/`LIFECYCLE` base styles
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
Rapid treats them all equally, but note that classic JSON will load slightly quicker.

- **JSON** (`.json`) - Classic JSON format - [json.org](https://www.json.org/)
- **JSONC** (`.jsonc`) - JSON with comments - Used by VS Code for config files like `tsconfig.json`
- **JSON5** (`.json5`) - Extended JSON format, allows comments, unquoted keys,
  single quotes, hexidecimal, and more - [json5.org](https://json5.org/)

### JSON Schemas

Rapid's imagery, schema, and styling data files may be validated against
[JSON Schema](http://json-schema.org/draft-07/schema#) definitions located
in the `data/schema/` directory.  The schemas are organized into a "main"
datafile schema and component schemas for each domain type:

| Schema file | Description |
|-------------|-------------|
| `main.schema.json` | Main data file: `assetID`, `assetVersion`, `scopes[]` |
| `imagery.schema.json` | Imagery source definitions |
| `style.schema.json` | Style declarations (`fill`, `casing`, `stroke`, `marker`, `icon`, `label`, etc.) |
| `selector.schema.json` | Selector rules mapping tag patterns to styles |
| `matcher.schema.json` | Tag matching rules used by selectors and rulesets |
| `variable.schema.json` | Variable values (string, number, or arrays thereof) |
| `ruleset.schema.json` | Include/exclude tag rulesets |
| `field.schema.json` | Editor field definitions (compatible with id-tagging-schema) |
| `preset.schema.json` | Preset (feature type) definitions |
| `category.schema.json` | Preset category groupings |
| `defaults.schema.json` | Default preset/category lists per geometry type |
| `deprecated.schema.json` | Tag deprecation rules (`old` → `replace`) |
| `discarded.schema.json` | Tags to silently discard on upload |

The schemas use `$ref` to reference each other — for example, `main.schema.json` references
`imagery.schema.json` for each imagery entry, and `selector.schema.json` references
`matcher.schema.json` for tag match rules.

To validate all data files:
```bash
bun run validate:json
```

#### Compatibility

Several schemas are designed to be compatible with data produced by external projects.
Our definitions may deviate slightly (e.g. additional optional properties), but they
accept the same data formats:

* **`imagery.schema.json`** — tracks the
  [editor-layer-index](https://github.com/osmlab/editor-layer-index) project,
  which is the source for default imagery definitions.
* **`field.schema.json`**, **`preset.schema.json`**, **`category.schema.json`**,
  **`defaults.schema.json`**, **`deprecated.schema.json`**, **`discarded.schema.json`** —
  compatible with data produced by
  [schema-builder](https://github.com/ideditor/schema-builder),
  the build tool behind the
  [id-tagging-schema](https://github.com/openstreetmap/id-tagging-schema) project.

