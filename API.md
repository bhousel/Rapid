This file documents efforts toward establishing a public API for Rapid.

## URL parameters

Rapid supports many URL parameters, listed below.
When constructing a URL to Rapid the parameters should appear in the
[fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)
part of the URL. For example: `https://rapideditor.com/edit#<param1>=<val1>&<param2>=<val2>…`

By convention Rapid expects these parameters to look like:
- simple strings, for example  `thing=true`
- comma-delimited lists, for example: `thing=one,two,three`
- comma-delimited k|v pairs, for example:  `thing=foo|bar,fizz|buzz`
(other list delimiters, such as '/' or ';', are generally accepted)

Note that values are first passed through
[`decodeURIComponent()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/decodeURIComponent).
URL-encoding is therefore optional but can be used to encode URL-unsafe characters.
- `thing=%23one%2C%23two`   (same as `#one,#two`)
- `thing=val%7Chttp%3A%2F%2Fexample.com`  (same as `val|http://example.com`)

### Initial only (these params take effect at init time)
* __`assets`__ - Custom asset overrides as `assetID|url` pairs separated by commas. These
  can be used to override the default assets loaded by Rapid (e.g. schema presets, imagery index).<br/>
  _Example:_ `assets=my_presets|https://example.com/presets.json,my_imagery|https://example.com/imagery.json`<br/>
* __`comment`__ - Prefills the changeset comment. Pass a URL-encoded string.<br/>
  _Example:_ `comment=CAR%20crisis%2C%20refugee%20areas%20in%20Cameroon`
* __`hashtags`__ - Prefills the changeset hashtags.  Pass a URL-encoded list of event
  hashtags separated by commas, semicolons, or spaces.  Leading '#' symbols are
  optional and will be added automatically. (Note that hashtag-like strings are
  automatically detected in the `comment`).<br/>
  _Example:_ `hashtags=%23hotosm-task-592,%23MissingMaps`
* __`presets`__ - A comma-separated list of preset IDs. These will be the only presets the user may select.<br/>
  _Example:_ `presets=building,highway/residential,highway/unclassified`
* __`renderer`__ - Force the renderer to use one of: `webgpu`, `webgl1`, or `webgl2` (the default)<br/>
  _Example:_ `renderer=webgpu`
* __`source`__ - Prefills the changeset source. Pass a URL-encoded string.<br/>
  _Example:_ `source=Bing%3BMapillary`
* __`validationDisable`__ - The issues identified by these types/subtypes will be disabled
  (i.e. Issues will not be shown at all). Each parameter value should contain a URL-encoded,
  comma-separated list of type/subtype match rules.  An asterisk `*` may be used as a wildcard.<br/>
  _Example:_ `validationDisable=crossing_ways/highway*,crossing_ways/tunnel*`
* __`validationWarning`__ - The issues identified by these types/subtypes will be treated as warnings
  (i.e. Issues will be surfaced to the user but not block changeset upload). Each parameter value
  should contain a URL-encoded, comma-separated list of type/subtype match rules.  An asterisk `*`
  may be used as a wildcard.<br/>
  _Example:_ `validationWarning=crossing_ways/highway*,crossing_ways/tunnel*`
* __`validationError`__ - The issues identified by these types/subtypes will be treated as errors
  (i.e. Issues will be surfaced to the user but will block changeset upload). Each parameter value
  should contain a URL-encoded, comma-separated list of type/subtype match rules.  An asterisk `*`
  may be used as a wildcard.<br/>
  _Example:_ `validationError=crossing_ways/highway*,crossing_ways/tunnel*`
* __`walkthrough=true`__ - Enter the walkthrough automatically upon startup.


### Responsive (you can change these anytime and Rapid will respond to the change)

#### Selecting Features
* __`id`__ - The character 'n', 'w', or 'r', followed by the OSM ID of a node, way or relation, respectively.
  Selects the specified entity, and, unless a `map` parameter is also provided, centers the map on it.<br/>
  _Example:_ `id=n1207480649`

#### Map and Rendering
* __`background`__ - The value of the `id` property of the source in Rapid's imagery list,
  or a custom tile URL. A custom URL is specified in the format `custom:<url>`, where the URL can
  contain the standard tile URL placeholders `{x}`, `{y}` and `{z}`/`{zoom}`, `{ty}` for flipped
  TMS-style Y coordinates, and `{switch:a,b,c}` for DNS multiplexing.<br/>
  _Example:_ `background=custom:https://{switch:a,b,c}.tile.openstreetmap.org/{zoom}/{x}/{y}.png`
* __`disable_features`__ - Disables features that match the given filterID.<br/>
  _Example:_ `disable_features=water,service_roads,points,paths,boundaries`<br/>
  _Available filterIDs:_
  `points`, `traffic_roads`, `service_roads`, `paths`, `buildings`, `building_parts`,
  `indoor`, `landuse`, `boundaries`, `water`, `rail`, `pistes`, `aerialways`, `power`,
  `past_future`, `others`
* __`map`__ - A slash-separated `zoom/latitude/longitude/bearing`.  Bearing is optional and can be
   specified in degrees.  (The map bearing is the compass direction that is "up").<br/>
  _Example:_ `map=18.00/47.62051/-122.34930`, `map=18.00/39.95239/-75.16361/9.5`
* __`offset`__ - Background imagery alignment offset in meters, formatted as `east,north`.<br/>
  _Example:_ `offset=-10,5`
* __`overlays`__ - A comma-separated list of imagery sourceIDs to display as overlays

#### Photo Layers
* __`detection`__ - The layerID and detectionID of the detection to show.<br/>
  _Example:_ `detection=mapillary-signs|481941836449560`<br/>
  _Available prefixes:_ `mapillary-detections`, `mapillary-signs`
* __`photo`__ - The layerID and photoID of the photo to show.<br/>
  _Example:_ `photo=mapillary|1157313301398079`<br/>
  _Available prefixes:_ `streetside`, `mapillary`, `kartaview`
* __`photo_overlay`__ - The street-level photo overlay layerIDs to enable.<br/>
  _Example:_ `photo_overlay=streetside,mapillary,kartaview`<br/>
  _Available values:_ `streetside` (Microsoft Bing), `mapillary`, `mapillary-signs`, `mapillary-detections`, `kartaview`
* __`photo_dates`__ - The range of capture dates by which to filter street-level photos.
  Dates are given in YYYY-MM-DD format and separated by `|`. One-sided ranges are supported.<br/>
  _Example:_ `photo_dates=2019-01-01|2020-12-31`<br/>
  _Example:_ `photo_dates=2019-01-01|`, `photo_dates=|2020-12-31`
* __`photo_username`__ - The Mapillary or KartaView username by which to filter street-level photos.
  Multiple comma-separated usernames are supported.<br/>
  _Example:_ `photo_username=quincylvania`, `photo_username=quincylvania,chrisbeddow`

#### Other Layers
* __`data`__ - (or legacy name __`gpx`__) A custom data URL for loading a gpx track, vector data source,
  or URL-encoded [WKT](https://en.wikipedia.org/wiki/Well-known_text_representation_of_geometry)
  POLYGON or MULTIPOLYGON text string to render as custom data.<br/>
  _Example:_ `data=https://tasks.hotosm.org/project/592/task/16.gpx`<br/>
  _Example:_ `data=POLYGON((-10%2010,%20-10%20-10,%2010%20-10,%2010%2010,%20-10%2010))`
* __`datasets`__ - A comma-separated list of datasetIDs to enable.<br/>
  _Example:_ `datasets=fbRoads,msBuildings,e75b56f13b404d7d8b47ef8be1c619ec`
* __`maproulette`__ - Enable the MapRoulette task layer. Optionally provide a
  comma-separated list of challenge IDs to filter the tasks shown.<br/>
  _Example:_ `maproulette=true` -or- `maproulette=<challengeIDs>`
* __`note`__ - Enable the Notes layer, optionally select a given note.<br/>
  _Example:_ `note=true` -or- `note=<noteID>`

#### Localization
Rapid will choose a default locale based on the values suggested by your web browser
(see [Navigator.languages](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages)),
but you can override it here.
* __`locale`__ - A code specifying the localization to use, affecting the language, layout,
  and keyboard shortcuts. Multiple codes may be specified in order of preference.<br/>
  _Example:_ `locale=ja`, `locale=pt-BR`, `locale=nl,fr,de`

#### Customization
These parameters allow you to override Rapid's default behavior.
If any asset files were specified in the `assets=` parameter, you can refer to them here.
Files will be applied in the order that they are listed.  The keyword `default`
means to apply the default assets in that position.
* __`imagery`__ - A comma-separated list of assetIDs to load imagery from.<br/>
  _Example:_ `imagery=default,my_imagery`
* __`schema`__ - A comma-separated list of assetIDs to load schema (presets) from.<br/>
  _Example:_ `schema=default,my_presets`
* __`style`__ - A comma-separated list of assetIDs to load styles from.<br/>
  _Example:_ `style=default,my_styles`

#### Advanced
* __`download_osc=true`__ - Set to `true` to enable the "download" button.
* __`poweruser=true`__ - Set to `true` to enable poweruser features.
* __`rtl=true`__ - Set to `true` for right-to-left rendering
  (useful for testing, normally RTL is controlled by the `locale` parameter).


## Customization

Rapid is designed to be highly customizable.
This requires certain parts of the Rapid code to be replaced at runtime by custom code or data.

Rapid uses a highly modular architecture.  Core components called `Systems` each have
different areas of responsibility.  When Rapid starts up, the available systems are constructed,
initialized, and started in a multi-phase process that you can hook into.

### Startup Lifecycle

The startup process is split into three phases:

1. **`prepareAsync()`** — Constructs all systems, modes, behaviors, and services.
   After this resolves, all components exist on `context.systems`, `context.modes`, etc.
   and can be configured (e.g. register assets, set properties on systems).

2. **`initAsync()`** — Initializes all systems and services (loads default assets, sets up
   event listeners, establishes dependency graphs).  Implicitly calls `prepareAsync()` first.
   After this resolves, you can call `merge()` on systems to customize schema, styles, or imagery.

3. **`startAsync()`** — Starts all auto-start systems and services (begins network fetches,
   rendering, event dispatching).  Implicitly calls `initAsync()` first.
   After this resolves, Rapid is fully running.

Each method is idempotent — calling it multiple times returns the same promise.
Each method implicitly calls the previous phase, so you only need to call the methods
for phases where you want to insert customization hooks.

**Simple usage** — If you don't need to customize anything between phases,
you can just call `runAsync()`:

```javascript
const context = new Rapid.Context();
window.rapidContext = context;
context.runAsync()
  .then(() => console.log('Rapid is running'));
```

**Customizing between phases** — Hook into the pipeline with `.then()`:

```javascript
const context = new Rapid.Context();
window.rapidContext = context;

context.prepareAsync()
  .then(() => {
    // All systems are constructed — configure them before init
    const assets = context.systems.assets;
    assets.registerAsset('my_schema', { preferred: 'https://example.com/schema.json' });
  })
  .then(() => context.initAsync())
  .then(() => {
    // All systems are initialized — merge custom data before start
    const schema = context.systems.schema;
    schema.merge(myCustomSchemaData);
  })
  .then(() => context.startAsync())
  .then(() => console.log('Rapid is running with customizations'));
```


### Scoped Architecture

The `ImagerySystem`, `SchemaSystem`, and `StyleSystem` all organize their data into
**scopes**.  A scope is a named container (like `'osm'` or `'*'`) that holds a set
of related configuration properties.  Scopes allow different data to coexist cleanly.
For example, default OpenStreetMap rules and configuration lives in the `'osm'` scope,
but these rules can be overridden or replaced when working with other data providers.

When you call `merge()`, you provide data grouped under scope identifiers.  The system
creates scopes on demand, so you can introduce your own (e.g. `'my_custom_scope'`).
Public-facing getters aggregate all scopes together into a single view.

Each asset data file has this general shape:
```javascript
{
  assetID: 'my_asset',       // Required: unique identifier for this asset
  assetVersion: '1.0.0',     // Optional: version string
  scopes: [
    { scope: '*',   /* common configuration */ },
    { scope: 'osm', /* scope-specific configuration */ }
  ]
}
```


### Merge Semantics

All three systems follow the same merge rules:
* **Replace** — New items replace existing items that have the same ID.
* **Delete** — Setting a value to `null` deletes that item.
* **Wildcard delete** — `*` and `?` wildcards are allowed in the ID when deleting.
  For example, `"crossing*": null` deletes all IDs that start with `crossing`.
* **Ordering** — Items are processed in the order they appear in the input.
* **Assets** — Each `merge()` call must include a unique `assetID`.  An `assetID`
  cannot be merged twice.


### Variables and `var()` References

The `SchemaSystem` and `StyleSystem` both support **variables** — named value lists
that can be referenced elsewhere using `var()` syntax.

Variables are defined per-scope and processed before other data in the same scope.
This lets styles, selectors, and rulesets reference shared values:

```javascript
{
  assetID: 'my_config',
  scopes: [{
    scope: 'osm',
    variables: {
      major_road_color: 0xcf2081,
      paved_surfaces: ["asphalt", "concrete", "paved", "chipseal"]
    }
  }]
}
```

Once defined, `var(paved_surfaces)` in a PropMatcher value resolves to the array
`["asphalt", "concrete", "paved", "chipseal"]`.  Variable values can be any JSON
type: string, number, boolean, array, or object.

Setting a variable to `null` deletes it (with wildcard support):
```javascript
variables: { "paved*": null }   // deletes all variables starting with "paved"
```


### Background Imagery

Rapid's background imagery is managed by the `ImagerySystem`.

At init time, Rapid loads default imagery assets (`editor_layer_index` and
`rapid_imagery`).  You can override which assets are loaded using the `imagery=`
URL parameter, or customize them programmatically by calling
`ImagerySystem.merge(…)` with new data.

Note that the "None" and "Custom" options always appear in the imagery list
(they live in the `'*'` common scope).

#### Imagery data format

```javascript
{
  assetID: 'my_imagery',        // required asset identifier
  assetVersion: '2026-01-01',   // optional asset version

  scopes: [{
    scope: 'osm',

    // Imagery definitions appear in an `imagery` block
    imagery: {
      "my_imagery_source": {    // add or update an imagery source
        id: 'my_source',
        name: 'My Satellite Imagery',
        type: 'tms',
        template: 'https://{switch:a,b,c}.tiles.example.com/{z}/{x}/{y}.png'
      },
      "old_source": null       // delete an existing imagery source
    }
  }]
}
```

#### Imagery source properties

Required:
* `id` — Unique identifier for this source (also used as a URL parameter)
* `name` — Display name for the source
* `type` — Source type: `'wms'`, `'tms'`, or `'bing'`
* `template` — URL template with replacement tokens:
  * `{z}`, `{x}`, `{y}` — standard Z/X/Y tile scheme
  * `{-y}` or `{ty}` — flipped (TMS-style) Y coordinate
  * `{u}` — quadtile scheme
  * `{switch:a,b,c}` — DNS multiplexing

Optional:
* `description` — Longer description, displayed in a popup in the imagery list
* `overlay` — If `true`, rendered as a transparent overlay above base imagery (default `false`)
* `zoomExtent` — Allowable min and max zoom levels (default `[0, 22]`)
* `feature` — A GeoJSON `Polygon` or `MultiPolygon` within which imagery is valid.
  If omitted, imagery is assumed valid worldwide.
* `terms_url` — URL to link to when displaying the imagery terms
* `terms_html` — HTML content for the imagery terms
* `terms_text` — Text content for the imagery terms
* `best` — If `true`, considered "better than Bing" and may be chosen by default.
  Displays with a star in the imagery list. (default `false`)


### Tagging Schema (aka "Presets")

Rapid's tagging schema is managed by the `SchemaSystem`.

At init time, Rapid loads default schema assets (`id_tagging_schema`, `osm_rulesets`,
and `rapid_schema`).  You can override which assets are loaded using the `schema=`
URL parameter, or customize them by calling `SchemaSystem.merge(…)`.

#### Schema data format

```javascript
{
  assetID: 'my_schema',

  scopes: [{
    scope: 'osm',

    // Variables: Named values or lists, reusable via 'var()' syntax
    variables: {
      lifecycle_prefixes: ["abandoned", "construction", "disused", "planned", "proposed"]
    },

    // Fields: Controls shown in the user interface when editing a feature.
    fields: {
      "my_field": {         // add or update a Field
        key: "my_tag",
        type: "combo",
        label: "My Tag"
      },
      "old_field*": null    // delete all Fields matching 'old_field*'
    },

    // Presets: Feature types with associated tags and fields
    presets: {
      "amenity/custom_shop": {      // add or update a Preset
        name: "Custom Shop",
        tags: { amenity: "custom_shop" },
        geometry: ["point", "area"],
        fields: ["name", "opening_hours"],
        icon: "maki-shop"
      }
    },

    // Categories: Groups of Presets - appear in the user interface as an expandable folder.
    categories: {
      "category-custom": {       // add or update a Category
        name: "Custom Features",
        members: ["amenity/custom_shop"]
      }
    },

    // Rulesets: Tag matching rules with include/exclude semantics.
    // A feature matches a ruleset if ANY 'include' rule matches AND NO 'exclude' rule matches.
    // These are used extensively for filtering and validation.
    rulesets: {
      "filter_paved": {   // add a ruleset for matching tags
        include: [
          { key: "surface", op: "in", value: "var(paved_surfaces)" }    // can reference a var()
        ],
        exclude: []
      }
    },

    // Defaults: PresetIDs/CategoryIDs that are shown by default for each geometry type.
    defaults: {
      area: ["category-custom", "amenity/custom_shop"],
      point: ["amenity/custom_shop"]
    },

    // Deprecations: If detected, users will be prompted to replace old tags with new tags.
    deprecated: [
      {
        old: { "amenity": "gym" },
        replace: { "leisure": "fitness_centre" }
      }
    ],

    // Discards:  Keys silently removed (stripped on upload)
    discarded: {
      "odbl": true,
      "odbl:note": true
    }
  }]
}
```


### Map Styling

Rapid's map styling is managed by the `StyleSystem`.

At init time, Rapid loads the default style asset (`rapid_style`).  You can override
which assets are loaded using the `style=` URL parameter, or customize them by calling
`StyleSystem.merge(…)`.

#### Style data format

```javascript
{
  assetID: 'my_styles',
  scopes: [{
    scope: 'osm',

    // Variables: Named values or lists, reusable via 'var()' syntax.
    variables: {
      road_casing_color: 0x444444
    },

    // Styles: Named visual property sets.  Styles control how things look.
    styles: {
      "my_red_highway": {
        fill:   { color: 0xff0000, opacity: 0.3 },
        casing: { width: 10, color: 'var(road_casing_color)' },  // can reference a var()
        stroke: { width: 8, color: 0xff0000, dash: [8, 8] }
      },
      "forest": {
        fill: { pattern: "forest" }
      }
    },

    // Selectors:  Map of tag matching patterns to Styles.
    // ALL matching selectors are applied, merged in specificity order (most specific wins).
    // Multiple styleIDs within a selector are merged in order (later overrides earlier).
    selectors: {
      "highway-motorway": {
        styleIDs: ["my_red_highway"],
        match: { tags: [{ key: "highway", value: "motorway" }] }
      },
      "landuse-forest": {
        styleIDs: ["green", "forest"],
        match: { tags: [{ key: "landuse", value: "forest" }] }
      }
    }
  }]
}
```

The `'*'` common scope holds the built-in `DEFAULTS` style (fallback when no selector
matches) and the `LIFECYCLE` style (applied to features with lifecycle-prefixed tags
like `disused:railway`).  These styles can be overridden but not deleted.

#### Style properties

Each style can include `fill`, `casing`, and `stroke` property groups:
* `width` — line width in pixels (for fills, the width of the outline)
* `color` — color as hex number, e.g. `0xcf2081`
* `opacity` — opacity: 0 = transparent, 1 = opaque
* `cap` — line cap: `'butt'`, `'round'`, or `'square'`
* `join` — line join: `'bevel'`, `'miter'`, or `'round'`
* `dash` — dash pattern array, e.g. `[8, 4]`
* `pattern` — (fill only) pattern ID for fill patterns

#### Selector matching

Each selector has a `match` property containing an array of `tags` rules.  All rules
in a selector must match (AND semantics).  A rule can specify:
* `key` — tag key to match (exact match by default)
* `value` — tag value to match
* `op` — comparison operator: `'='`, `'!='`, `'exists'`, `'!exists'`, `'~'`, `'!~'`,
  `'in'`, `'!in'`, `'>'`, `'>='`, `'<'`, `'<='`
* `keyOp` — key matching mode: `'='` (exact, default) or `'~'` (regex)

Values can reference variables using `var()` syntax, e.g. `value: "var(paved_surfaces)"`.


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

To validate all data files against the schemas:
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

