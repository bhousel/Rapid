# Lessons: TypeScript

Types, and editing code with tools.

- **`Object.entries()` widens keys** — Always returns `[string, V][]`. Cast at iteration site: `Object.entries(obj) as [keyof MyType, unknown][]`. Or iterate a known key set and index directly.
- **Tiler method chaining** — `new Tiler().tileSize(512)` returns `number | Tiler`. Need `as Tiler` casts on the chain.
- **`utilQsString`** requires 2 args `(obj, noencode: boolean)` — pass `false` for the second.
- **JSDoc first-line duplication** — Two redundant patterns to watch for and avoid:
  1. A line that is just the backticked class name: `` * `ClassName` ``
  2. A `ClassName - description` prefix on the first line
  Both clutter IntelliSense by repeating the symbol name that's already shown. Start the description directly on the first line instead.
- **`multi_replace_string_in_file` substring trap** — A 4-space-indented `    this.dispatch.call(...)`
  oldString matches as a substring inside a more-indented line. Anchor with a leading newline or add
  more surrounding context to force a unique match.
- **`multi_replace_string_in_file` can silently break code** — When `oldString` includes text that spans a structural boundary (like `}\n    this._cache = {`), the replacement must include ALL the matched text. A partial replacement dropped the closing brace and object assignment in WaybackService. Always verify structural edits immediately.
