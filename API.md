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


## Customized Deployments

Rapid may be used to edit maps in a non-OpenStreetMap environment.  This requires
certain parts of the Rapid code to be replaced at runtime by custom code or data.

Rapid uses a highly modular architecture.  Core components called `Systems` each have
different areas of responsibility.  When Rapid starts up, the available systems are constructed
automatically. At that time, you can make customizations.

Then, your code must call `rapidContext.initAsync()`, which will initialize all of the components
and complete the startup process.

```javascript
const context = new Rapid.Context();
window.rapidContext = context;

// customizations may happen here…

context.initAsync()
  .then(() => console.log('Rapid is running'));
```


### Background Imagery

Rapid's background imagery is managed by the `ImagerySystem`.
Default imagery assets are loaded at init time, but customizations and overrides can be
made to the imagery by calling `ImagerySystem.merge(…)` with new data to merge in.

Note that the "None" and "Custom" options will always be shown in the list.

TODO: document merging sceneraios.

Each imagery source should have the following properties:
* `id` - Unique identifier for this source (also used as a url parameter)
* `name` - Display name for the source
* `type` - Source type, 'wms', 'tms', or 'bing'.
* `template` - Url template, valid replacement tokens include:
  * `{z}`, `{x}`, `{y}` - for Z/X/Y scheme
  * `{-y}` or `{ty}` - for flipped Y
  * `{u}` - for quadtile scheme
  * `{switch:a,b,c}` - for parts of the url that can be cycled for connection parallelization

Optional properties:
* `description` - A longer source description which, if included, will be
  displayed in a popup when viewing the background imagery list.
* `overlay` - If `true`, this is an overlay layer (a transparent layer rendered
  above base imagery). Defaults to `false`.
* `zoomExtent` - Allowable min and max zoom levels, defaults to `[0, 22]`.
* `feature` - A GeoJSON `Polygon` or `MultiPolygon` within which imagery is valid.
  If omitted, imagery is assumed to be valid worldwide.
* `terms_url` - Url to link to when displaying the imagery terms.
* `terms_html` - Html content to display in the imagery terms.
* `terms_text` - Text content to display in the imagery terms.
* `best` - If set to `true`, this imagery is considered "better than Bing" and
  may be chosen by default when Rapid starts. It will display with a star in the
  background imagery list. Defaults to `false`.


### Tagging Schema (aka "Presets")

Rapid's tagging schema is managed by the `SchemaSystem`.
Default schema assets are loaded at init time, but customizations and overrides can be
made to the schema by calling `SchemaSystem.merge(…)` with new data to merge in.

TODO: document merging sceneraios.


### Map Styling

Rapid's map styling is managed by the `StyleSystem`.
Default style assets are loaded at init time, but customizations and overrides can be
made to the styles by calling `StyleSystem.merge(…)` with new data to merge in.

Each style asset should have the following structure:
```javascript
{
  assetID: 'my_styles',        // Required: unique identifier for this asset
  assetVersion: '1.0.0',       // Optional: version string

  // Style declarations define how features look (fill, casing, stroke properties)
  declarations: {
    "my_style_id": {
      fill:   { color: 0xff0000, opacity: 0.3 },           // fill properties
      casing: { width: 10, color: 0x444444 },              // casing line properties
      stroke: { width: 8, color: 0xffffff, dash: [8, 8] }  // stroke line properties
    },
    "forest": {
      fill: { pattern: "forest" }   // pattern-only style
    }
  },

  // Style selectors map OSM tags to styles using styleIDs array
  // ALL matching selectors are applied, merged in specificity order (most specific wins)
  // Multiple styleIDs within a selector are merged in order (later overrides earlier)
  selectors: {
    "highway-motorway": {
      "styleIDs": ["my_style_id"],  // array of styleIDs to apply
      "match": { "tags": [{ "key": "highway", "value": "motorway" }] }
    },
    "landuse-forest": {
      "styleIDs": ["green", "forest"],  // color + pattern composed together
      "match": { "tags": [{ "key": "landuse", "value": "forest" }] }
    }
  }
}
```

Available properties for style declarations:
* `width` - line width in pixels
* `color` - color as hex number, e.g. `0xcf2081`
* `opacity` - opacity: 0 = transparent, 1 = opaque
* `cap` - line cap: 'butt', 'round', or 'square'
* `join` - line join: 'bevel', 'miter', or 'round'
* `dash` - dash pattern array, e.g. `[8, 4]` for dashed line
* `pattern` - (fill only) pattern ID for fill patterns

When merging:
* New items replace existing items with the same ID
* Setting a value to `null` deletes that item
* Wildcards `*` and `?` are allowed when deleting
* The `DEFAULTS` and `LIFECYCLE` declarations cannot be deleted


