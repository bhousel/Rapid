import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';


// ---------------------------------------------------------------------------
// File categorization ruleset (advisory — consumers may ignore `kind`).
// One place for the accept lists, replacing duplicated `ACCEPT` arrays.
// ---------------------------------------------------------------------------

/** Extensions we treat as geo *data* files. */
const DATA_EXTENSIONS = new Set<string>([
  '.geojson', '.json', '.gpx', '.kml', '.pbf', '.pmtiles'
]);

/** Extensions we treat as *image* files. */
const IMAGE_EXTENSIONS = new Set<string>([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tif', '.tiff'
]);


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Advisory categorization of a dropped file. */
export type DroppedFileKind = 'data' | 'image' | 'other';

/** A single dropped file, with a convenience categorization. */
export interface DroppedFile {
  /** The raw `File` (a `Blob`) — unparsed and un-persisted. */
  file: File;
  /** Advisory categorization (consumers may ignore it and inspect `file.name`/`file.type`). */
  kind: DroppedFileKind;
  /** Lowercased file extension including the dot, e.g. `'.geojson'`. */
  extension: string;
}

/**
 * The payload offered to consumers on a drop. A consumer inspects it and, if it wants the drop,
 * calls `claim()` — after which no lower-priority consumer is offered. `handle` may be async, so a
 * consumer can parse/validate before deciding whether to claim.
 */
export interface DropPayload {
  /** All dropped files, categorized. */
  files: DroppedFile[];
  /** Convenience: the `kind === 'data'` subset. */
  data: DroppedFile[];
  /** Convenience: the `kind === 'image'` subset. */
  images: DroppedFile[];
  /** The raw dropped `FileList`, for consumers that want it as-is (`null` for programmatic drops). */
  fileList: FileList | null;
  /** Drop location in container-relative screen coordinates. */
  point: Vec2;
  /** Drop location as map lng/lat, if a viewport projection was available. */
  loc?: Vec2;
  /** Call to take responsibility for the drop; stops it being offered to lower-priority consumers. */
  claim(): void;
  /** Whether a consumer has claimed this drop. */
  readonly claimed: boolean;
  /** The originating DOM `DragEvent`, or `null` for a programmatic drop. */
  originalEvent: DragEvent | null;
}

/** A registered drop consumer. Consumers are offered drops in descending `priority` order. */
export interface DropConsumer {
  /** Unique id (used to unregister). */
  id: string;
  /** Higher priority consumers are offered the drop first. */
  priority: number;
  /** Optional cheap synchronous pre-filter; if it returns `false`, `handle` is not called. */
  accepts?: (payload: DropPayload) => boolean;
  /** Inspect the payload and, if interested, call `payload.claim()`. May be async. */
  handle: (payload: DropPayload) => void | Promise<void>;
}


/**
 * The `DragAndDropSystem` is the single, central owner of the browser's file drag-and-drop
 * interaction. It attaches its listeners to the whole app container and routes dropped files to
 * **registered consumers** via a claim-based registry: on a drop it offers the files to consumers
 * in descending priority order until one calls `claim()`. If nobody claims, nothing happens.
 *
 * It is deliberately **domain-agnostic** — it knows nothing about GeoJSON, datasets, photos, or
 * persistence. It categorizes files (`data`/`image`/`other`) only as a convenience. A claiming
 * consumer is responsible for everything that follows: parsing, loading, and (if it wants)
 * persisting the raw `File` via `DatabaseSystem`. This keeps the system decoupled from storage.
 *
 * It is an **optional system**: in a non-browser/CLI build or tests without a DOM, `startAsync`
 * attaches nothing and the system simply never sees a drop.
 *
 * See `.github/design/draganddrop-system.md` for the full design.
 *
 * Events available:
 * - `dragstart` - Fires when a file drag enters the container (overlay shown)
 * - `dragend`   - Fires when the drag leaves or a drop completes (overlay hidden)
 */
export class DragAndDropSystem extends AbstractSystem {

  /** Registered consumers, keyed by id. */
  protected _consumers: Map<string, DropConsumer>;
  /** Whether the container DOM listeners are attached. */
  protected _listening: boolean;
  /** Whether a drop is currently being processed (concurrent drops are ignored). */
  protected _processing: boolean;
  /** Nesting counter for dragenter/dragleave (they fire per descendant element). */
  protected _dragDepth: number;
  /** The drop overlay element, created lazily. */
  protected _$overlay: D3Selection | null;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'dragdrop';
    this.optionalDependencies = new Set<SystemID>(['l10n', 'ui']);

    this._consumers = new Map<string, DropConsumer>();
    this._listening = false;
    this._processing = false;
    this._dragDepth = 0;
    this._$overlay = null;

    // Ensure DOM handlers always have `this` bound correctly (they're used as d3 callbacks).
    this._onDragEnter = this._onDragEnter.bind(this);
    this._onDragOver = this._onDragOver.bind(this);
    this._onDragLeave = this._onDragLeave.bind(this);
    this._onDrop = this._onDrop.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * Attaches the container drag-and-drop listeners — chained after `UiSystem` startup so the
   * container element exists. No-op when there is no DOM (headless/CLI).
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const ui = this.context.systems.ui;   // optional — owns the container
    const prerequisite = ui ? ui.startAsync() : Promise.resolve();

    return this._startPromise = prerequisite.then(() => {
      this._attach();
      this._started = true;
    });
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * Registered consumers persist across resets; this is a no-op.
   * @return  Promise resolved immediately
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  /**
   * Register a consumer to be offered dropped files.
   * Registering again with the same id replaces the previous consumer.
   * @param consumer - The consumer to register
   * @throws Error if the consumer has no `id`
   */
  public register(consumer: DropConsumer): void {
    if (!consumer?.id) {
      throw new Error('DragAndDropSystem: a consumer requires an id');
    }
    this._consumers.set(consumer.id, consumer);
  }


  /**
   * Unregister a previously registered consumer.
   * @param id - The consumer id to remove
   */
  public unregister(id: string): void {
    this._consumers.delete(id);
  }


  /**
   * The ids of the currently registered consumers.
   * @readonly
   */
  public get consumerIDs(): string[] {
    return [...this._consumers.keys()];
  }


  /**
   * Route a set of files through the claim pipeline programmatically (no DOM drop needed).
   * Useful for `<input type="file">` flows and tests.
   * @param files - The files to route
   * @return Promise resolved once the pipeline finishes (a consumer claimed, or none did)
   */
  public dropFilesAsync(files: File[] | FileList): Promise<void> {
    const list = (typeof FileList !== 'undefined' && files instanceof FileList) ? files : null;
    return this._processDropAsync(files, list, null);
  }


  // -------------------------------------------------------------------------
  // Drop pipeline
  // -------------------------------------------------------------------------

  /**
   * Offer the dropped files to registered consumers in descending priority order until one claims.
   * Concurrent drops are ignored while one is being processed.
   * @param files - The dropped files
   * @param fileList - The raw `FileList`, if the drop came from the DOM (`null` otherwise)
   * @param event - The originating `DragEvent`, if any
   * @return Promise resolved when the pipeline finishes
   */
  protected async _processDropAsync(
    files: File[] | FileList,
    fileList: FileList | null,
    event: DragEvent | null
  ): Promise<void> {
    if (this._processing) return;   // ignore concurrent drops (by design, for now)

    const arr = Array.from(files);
    if (!arr.length) return;

    this._processing = true;
    try {
      const payload = this._buildPayload(arr, fileList, event);
      const consumers = [...this._consumers.values()].sort((a, b) => b.priority - a.priority);
      for (const consumer of consumers) {
        if (consumer.accepts && !consumer.accepts(payload)) continue;
        await consumer.handle(payload);
        if (payload.claimed) break;   // first claimer wins
      }
      // If nobody claimed, nothing happens — quietly.
    } finally {
      this._processing = false;
    }
  }


  /**
   * Build the `DropPayload` for a set of files.
   * @param files - The dropped files
   * @param fileList - The raw `FileList`, if any
   * @param event - The originating `DragEvent`, if any
   * @return The payload offered to consumers
   */
  protected _buildPayload(files: File[], fileList: FileList | null, event: DragEvent | null): DropPayload {
    const dropped = files.map(f => this._classify(f));
    const point = this._eventPoint(event);
    let claimed = false;

    return {
      files: dropped,
      data: dropped.filter(d => d.kind === 'data'),
      images: dropped.filter(d => d.kind === 'image'),
      fileList,
      point,
      loc: event ? this._pointToLoc(point) : undefined,
      claim: () => { claimed = true; },
      get claimed(): boolean { return claimed; },
      originalEvent: event
    };
  }


  /**
   * Categorize a dropped file by extension and MIME type.
   * @param file - The file to categorize
   * @return The categorized `DroppedFile`
   */
  protected _classify(file: File): DroppedFile {
    const extension = fileExtension(file.name ?? '');
    const type = file.type ?? '';

    let kind: DroppedFileKind = 'other';
    if (DATA_EXTENSIONS.has(extension) || /geo\+json|gpx|kml/.test(type)) {
      kind = 'data';
    } else if (IMAGE_EXTENSIONS.has(extension) || type.startsWith('image/')) {
      kind = 'image';
    }
    return { file, kind, extension };
  }


  // -------------------------------------------------------------------------
  // DOM attachment + overlay
  // -------------------------------------------------------------------------

  /**
   * Attach the drag-and-drop listeners to the app container.
   * No-op when there is no DOM or no real container element, or when already attached.
   */
  protected _attach(): void {
    if (this._listening) return;
    if (typeof document === 'undefined') return;

    const $container = this.context.container();
    if (!$container.node()) return;   // no real container (e.g. tests)

    $container
      .attr('dropzone', 'copy')
      .on('dragenter.dragdrop', this._onDragEnter)
      .on('dragover.dragdrop', this._onDragOver)
      .on('dragleave.dragdrop', this._onDragLeave)
      .on('drop.dragdrop', this._onDrop);

    this._listening = true;
  }


  /**
   * `dragenter` handler — begins showing the overlay for a file drag.
   * @param e - The drag event
   */
  protected _onDragEnter(e: DragEvent): void {
    if (!this._isFileDrag(e)) return;   // ignore non-file drags (e.g. UI chip reordering)
    e.preventDefault();
    e.stopPropagation();

    this._dragDepth++;
    if (this._dragDepth === 1) {
      this.emit('dragstart');
      this._showOverlay();
    }
  }


  /**
   * `dragover` handler — must `preventDefault` so the drop is allowed.
   * @param e - The drag event
   */
  protected _onDragOver(e: DragEvent): void {
    if (!this._isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }


  /**
   * `dragleave` handler — hides the overlay once the drag has fully left the container.
   * @param e - The drag event
   */
  protected _onDragLeave(e: DragEvent): void {
    if (!this._isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();

    this._dragDepth = Math.max(0, this._dragDepth - 1);
    if (this._dragDepth === 0) {
      this.emit('dragend');
      this._hideOverlay();
    }
  }


  /**
   * `drop` handler — hides the overlay and routes the dropped files through the claim pipeline.
   * @param e - The drag event
   */
  protected _onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this._dragDepth = 0;
    this.emit('dragend');
    this._hideOverlay();

    const fileList = e.dataTransfer?.files ?? null;
    if (fileList && fileList.length) {
      this._processDropAsync(fileList, fileList, e);
    }
  }


  /**
   * Whether a drag event carries files (as opposed to text or internal UI element drags).
   * @param e - The drag event
   * @return `true` if the drag contains files
   */
  protected _isFileDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  }


  /**
   * Show the drop overlay (created lazily), with a localized message when `l10n` is present.
   */
  protected _showOverlay(): void {
    const l10n = this.context.systems.l10n;   // optional

    const $container = this.context.container();
    if (!$container.node()) return;

    if (!this._$overlay) {
      this._$overlay = $container.append('div').attr('class', 'dragdrop-overlay');
      this._$overlay.append('div').attr('class', 'dragdrop-overlay-message');
    }
    this._$overlay.select('.dragdrop-overlay-message')
      .text(l10n ? l10n.t('dragdrop.drop_files') : 'Drop files here');
    this._$overlay.classed('active', true);
  }


  /**
   * Hide the drop overlay.
   */
  protected _hideOverlay(): void {
    this._$overlay?.classed('active', false);
  }


  /**
   * Convert a drag event to container-relative screen coordinates.
   * @param event - The drag event, or `null`
   * @return The point as `[x, y]` (defaults to `[0, 0]` when there's no event)
   */
  protected _eventPoint(event: DragEvent | null): Vec2 {
    if (!event) return [0, 0];
    const node = this.context.container().node() as HTMLElement | null;
    const rect = node?.getBoundingClientRect?.();
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)];
  }


  /**
   * Project a container-relative screen point to a map lng/lat.
   * @param point - The screen point
   * @return The map coordinate, or `undefined` if projection failed
   */
  protected _pointToLoc(point: Vec2): Vec2 | undefined {
    try {
      return this.context.viewport.unproject(point);
    } catch {
      return undefined;
    }
  }
}


/**
 * Derives a lowercased file extension (including the leading dot) from a filename.
 * @param name - The filename, e.g. `'Buildings.GeoJSON'`
 * @return The extension, e.g. `'.geojson'`, or `''` if there is none
 */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0) ? name.slice(dot).toLowerCase() : '';
}
