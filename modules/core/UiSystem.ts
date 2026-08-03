import { AbstractSystem } from './AbstractSystem.ts';
import { select } from 'd3-selection';
import { utilDetect } from '../util/detect.ts';
import { vecAdd } from '@rapid-sdk/math';
import {
  UiApiStatus, UiDefs, UiEditMenu, UiFlash, UiFullscreen, UiIntro,
  uiLoading, UiMapFooter, UiMapToolbar, UiMapRouletteMenu, UiOvermap,
  UiSplash, UiRestore, UiShortcuts, UiSidebar, UiWhatsNew
} from '../ui/index.js';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { Vec2 } from '@rapid-sdk/math';


/** The data properties of a DOMRect (without methods like toJSON) */
type DOMRectData = Pick<DOMRectReadOnly, 'x' | 'y' | 'width' | 'height' | 'top' | 'right' | 'bottom' | 'left'>;


/**
 * `UiSystem` maintains Rapid's user interface, including the toolbars, inspector,
 *  and the `.main-content` container where the map canvas lives.
 *
 * Events available:
 * - `uichange`  Fires on any change in the ui (such as resize)
 */
export class UiSystem extends AbstractSystem {

  // Private state
  /** Last measured bounding rect of the map container */
  protected _mapRect: DOMRectData | null;
  /** Map of element keys to their required widths, used for responsive toolbar overflow */
  protected _needWidth: Record<string, number>;
  /** Debounce timer ID for resize events */
  protected _resizeTimeout: number | null;
  /** Whether the MapRoulette context menu is currently open */
  protected _showsMapRouletteMenu: boolean;

  // Child UI components, created during initAsync
  /** API status indicator component */
  public ApiStatus: any;
  /** Authentication loading modal */
  public AuthModal: any;
  /** SVG `<defs>` container for sprites and clip paths */
  public Defs: any;
  /** Context menu shown when right-clicking map features */
  public EditMenu: any;
  /** MapRoulette-specific context menu */
  public MapRouletteMenu: any;
  /** Transient notification/flash overlay */
  public Flash: any;
  /** Fullscreen toggle button and state manager */
  public Fullscreen: any;
  /** Footer bar with attribution and zoom indicator */
  public MapFooter: any;
  /** Top toolbar containing mode buttons and search */
  public MapToolbar: any;
  /** Overlay panels drawn on top of the map (zoom controls, issue pins, etc.) */
  public Overmap: any;
  /** Keyboard shortcut reference panel */
  public Shortcuts: any;
  /** Right-side inspector / tag editor panel */
  public Sidebar: any;

  // References to components that live deeper in the tree
  /** Info-card components displayed over the map (e.g. measurement, history) */
  public InfoCards: any;
  /** Mini-map overview panel */
  public Minimap: any;
  /** Photo viewer panel (Mapillary, Streetside, KartaView, etc.) */
  public PhotoViewer: any;
  /** WebGL Spector debugging overlay */
  public Spector: any;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'ui';
    // Require any systems that might be required by any UI component.
    this.requiredDependencies = new Set<SystemID>(['assets', 'editor', 'gfx', 'imagery', 'l10n', 'map', 'network', 'spatial', 'urlhash']);
    this.optionalDependencies = new Set<SystemID>(['scheduler', 'settings']);

    this._mapRect = null;
    this._needWidth = {};
    this._resizeTimeout = null;
    this._showsMapRouletteMenu = false;

    // Child components, we will defer creating these until after some other things have initted.
    this.ApiStatus = null;
    this.AuthModal = null;
    this.Defs = null;
    this.EditMenu = null;
    this.MapRouletteMenu = null;
    this.Flash = null;
    this.Fullscreen = null;
    this.MapFooter = null;
    this.MapToolbar = null;
    this.Overmap = null;
    this.Shortcuts = null;
    this.Sidebar = null;

    // These components live below in the tree, but we will hold a reference
    // to them here in the UiSystem, so other code can find them easily.
    this.InfoCards = null;
    this.Minimap = null;
    this.PhotoViewer = null;
    this.Spector = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.resize = this.resize.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets!;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const network = context.systems.network!;
    const urlhash = context.systems.urlhash!;

    // Many UI components require l10n and gfx (for scene/layers)

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets.initAsync(),
          gfx.initAsync(),
          l10n.initAsync(),
          network.initAsync(),
          urlhash.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        window.addEventListener('resize', this.resize);

        this._checkEnvironment();  // are we in a dev or staging environment?

        // Create UI components
        this.ApiStatus = new UiApiStatus(context);
        const loading = uiLoading(context) as any;
        this.AuthModal = loading.blocking(true).message(l10n.t('loading_auth'));
        this.Defs = new UiDefs(context);
        this.EditMenu = new UiEditMenu(context);
        this.MapRouletteMenu = new UiMapRouletteMenu(context);
        this.Flash = new UiFlash(context);
        this.Fullscreen = new UiFullscreen(context);
        this.MapFooter = new UiMapFooter(context);
        this.MapToolbar = new UiMapToolbar(context);
        this.Overmap = new UiOvermap(context);
        this.Shortcuts = new UiShortcuts(context);
        this.Sidebar = new UiSidebar(context);

        // These components live below in the tree, but we will hold a reference
        // to them here in the UiSystem, so that other code can find them easily.
        this.InfoCards = this.Overmap.InfoCards;
        this.Minimap = this.Overmap.Minimap;
        this.PhotoViewer = this.Overmap.PhotoViewer;
        this.Spector = this.Overmap.Spector;

        // Setup Event listeners..
        l10n.on('localechange', () => {
          if (this._started) {
            this.render();
          }
        });

        const osm = context.services.osm as any;
        if (osm) {
          osm
            .on('authLoading', () => context.container()?.call(this.AuthModal))
            .on('authDone', () => this.AuthModal.close());
        }
      });

// not sure what these were for
//    $container.on('click.ui', d3_event => {
//      if (d3_event.button !== 0) return;  // we're only concerned with the primary mouse button
//      if (!d3_event.composedPath) return;
//
//      // some targets have default click events we don't want to override
//      const isOkayTarget = d3_event.composedPath().some(node => {
//        return node.nodeType === 1 && (  // we only care about element nodes
//          node.nodeName === 'INPUT' ||   // clicking <input> focuses it and/or changes a value
//          node.nodeName === 'LABEL' ||   // clicking <label> affects its <input> by default
//          node.nodeName === 'A');        // clicking <a> opens a hyperlink by default
//       });
//      if (isOkayTarget) return;
//
//      d3_event.preventDefault();   // disable double-tap-to-zoom on touchscreens
//    });
//
//    // only WebKit supports gesture events
//    // Listening for gesture events on iOS 13.4+ breaks double-tapping,
//    // but we only need to do this on desktop Safari anyway. – #7694
//    if ('GestureEvent' in window && !detected.isMobileWebKit) {
//      // On iOS we disable pinch-to-zoom of the UI via the `touch-action`
//      // CSS property, but on desktop Safari we need to manually cancel the
//      // default gesture events.
//      $container.on('gesturestart.ui gesturechange.ui gestureend.ui', d3_event => {
//        // disable pinch-to-zoom of the UI via multitouch trackpads on macOS Safari
//        d3_event.preventDefault();
//      });
//    }

  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash!;
    const $container: D3Selection = context.container();

    if (!$container.size()) {
      return Promise.reject(new Error('No container to render to.'));
    }

    // These systems currently don't do anything in start,
    // but if they did, we'd want them to settle first.
    const prerequisites = Promise.all([
      editor.startAsync(),
      map.startAsync()
    ]);

    return this._startPromise = prerequisites
      .then(() => {
        this.render();  // Render one time
        this.resize();  // Update map dimensions - this should happen after .main-content and toolbars exist.

        context.enter('browse');

        // What to show first?
        const startWalkthrough = urlhash.initialHashParams.get('walkthrough') === 'true';
        const sawPrivacyVersion = parseInt(settings?.get('ui.sawPrivacyVersion') ?? '', 10) || 0;
        const sawWhatsNewVersion = parseInt(settings?.get('ui.sawWhatsNewVersion') ?? '', 10) || 0;

        if (startWalkthrough) {
          new UiIntro(context).start($container);     // Jump right into walkthrough..
        } else if (editor.canRestoreBackup) {
          new UiRestore(context).render($container);   // Offer to restore backup edits..
        } else if (sawPrivacyVersion !== context.privacyVersion) {
          new UiSplash(context).render($container);    // Show "Welcome to Rapid" / Privacy Policy
        } else if (sawWhatsNewVersion !== context.whatsNewVersion) {
          new UiWhatsNew(context).render($container);  // Show "Whats New"
        }

        this._started = true;
      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    // don't leave stale state in the inspector
    const context = this.context;
    const $container: D3Selection = context.container();
    if ($container.size()) {
      $container.select('.inspector-wrap *').remove();
    }

    return Promise.resolve();
  }


  /**
   * Renders the Rapid user interface into the main container.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - `$container` is always the parent.
   */
  public render(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const $container: D3Selection = context.container();

    $container
      .attr('lang', l10n.localeCode)
      .attr('dir', l10n.textDirection)
      .call(this.Fullscreen.render)
      .call(this.Defs.render)
      .call(this.Sidebar.render);

    // .main-content
    // Contains the map and everything floating above it, such as toolbars, etc.
    let $mainContent: D3Selection = $container.selectAll('.main-content')
      .data([0]);

    // enter
    const $$mainContent: D3EnterSelection = $mainContent.enter()
      .append('div')
      .attr('class', 'main-content active');

    // update
    $mainContent = $mainContent.merge($$mainContent);

    $mainContent
      .call(map.render)
      .call(this.MapToolbar.render)
      .call(this.Overmap.render)
      .call(this.ApiStatus.render)
      .call(this.MapFooter.render);
  }


  /**
   * Handler for resize events on the window.
   * Note that this can just be called with no event to recheck the dimensions.
   * @param  e - the resize event (if any)
   */
  public resize(e?: Event): void {
    const context = this.context;
    const map = context.systems.map!;
    const viewport = context.viewport;
    const $container: D3Selection = context.container();

    // This is an actual resize event - class the container as resizing.
    if (e) {
      window.clearTimeout(this._resizeTimeout!);
      $container.classed('resizing', true);
      this._resizeTimeout = window.setTimeout(() => {
        $container.classed('resizing', false);
      }, 400) as unknown as number;  // if no resizes for 400ms, remove class
    }

    const $mainContent: D3Selection = $container.selectAll('.main-content');
    if (!$mainContent.size()) return;  // called too early?

    const curr = this._copyRect($mainContent.node().getBoundingClientRect());
    const prev = this._mapRect || curr;
    this._mapRect = curr;

    // Determine how the map is getting resized
    // (we do prev-curr because we want negative values to pan with)
    const dtop = prev.top - curr.top;
    const dright = prev.right - curr.right;
    const dbottom = prev.bottom - curr.bottom;
    const dleft = prev.left - curr.left;

    // Un-pan map to keep it centered in the same spot.
    // (div/2 because the map grows/shrinks from the middle, so we only need to pan half this distance)
    const [dw, dh] = [dleft + dright, dtop + dbottom];
    if (dw || dh) {
      map.pan([dw / 2, dh / 2]);
    }

    let dims: Vec2 = [curr.width, curr.height];

// experiment:
// Previously, the map surfaces were anchored to the top left of the main-map.
// Now, the map surfaces are centered in a CSS Grid, to support rotation around the center.
// We can extend the map dimensions a little bit so that as the user pans, we dont see seams at the edges of the map.
const overscan = 50;
dims = vecAdd(dims, [overscan * 2, overscan * 2]);

    viewport.dimensions = dims;

    // check if header or footer have overflowed
    this.checkOverflow('.map-toolbar');
    this.checkOverflow('.map-footer');

    this.emit('uichange');

// this was for the restrictions editor?
// or any other component that needs to know when resizing is happening
//    // Use outdated code so it works on Explorer
//    const resizeWindowEvent = document.createEvent('Event');
//    resizeWindowEvent.initEvent('resizeWindow', true, true);
//    document.dispatchEvent(resizeWindowEvent);
  }


  /**
   * Call checkOverflow when resizing or whenever the contents change.
   * I think this was to make button labels in the top bar disappear
   * when more buttons are added than the screen has available width
   * @param  selector - selector to select the thing to check
   * @param  reset - whether to reset the needed width cache
   */
  public checkOverflow(selector: string, reset?: boolean): void {
    if (reset) {
      delete this._needWidth[selector];
    }

    const context = this.context;
    const $selection: D3Selection = context.container().select(selector);
    if ($selection.empty()) return;

    const scrollWidth = $selection.property('scrollWidth');
    const clientWidth = $selection.property('clientWidth');
    const needed = this._needWidth[selector] || scrollWidth;

    if (scrollWidth > clientWidth) {    // overflow happening
      $selection.classed('narrow', true);
      if (!this._needWidth[selector]) {
        this._needWidth[selector] = scrollWidth;
      }

    } else if (scrollWidth >= needed) {
      $selection.classed('narrow', false);
    }
  }


  /**
   * If no `$showpane` is passed, all panes are hidden.
   * @param  $showpane - A d3-selection to the pane to show
   */
  public togglePanes($showpane?: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const $container: D3Selection = context.container();

    const $hidepanes: D3Selection = $container.selectAll('.map-pane.shown');
    const side = l10n.isRTL ? 'left' : 'right';

    $hidepanes
      .classed('shown', false)
      .classed('hide', true);

    $container.selectAll('.map-pane-control button')
      .classed('active', false);

    if ($showpane) {
      $hidepanes
        .classed('shown', false)
        .classed('hide', true)
        .style(side, '-500px');

      $container.selectAll('.' + $showpane.attr('pane') + '-control button')
        .classed('active', true);

      $showpane
        .classed('shown', true)
        .classed('hide', false);

      if ($hidepanes.empty()) {
        $showpane
          .style(side, '-500px')
          .transition()
          .duration(200)
          .style(side, '0px');
      } else {
        $showpane
          .style(side, '0px');
      }

    } else {
      $hidepanes
        .classed('shown', true)
        .classed('hide', false)
        .style(side, '0px')
        .transition()
        .duration(200)
        .style(side, '-500px')
        .on('end', function(this: Element) {
          select(this)
            .classed('shown', false)
            .classed('hide', true);
        });
    }
  }


  /**
   * This shows the contextual edit menu, called by the select behavior when the
   *  user right clicks, or long presses, or presses the menu key.
   * @param  anchorPoint - `[x,y]` screen coordinate where the menu should be anchored
   * @param  triggerType - (not used?)  'touch', 'pen', or 'rightclick' that triggered the menu
   */
  public showEditMenu(anchorPoint: Vec2, triggerType: string): void {
    this.EditMenu.close();   // remove any displayed menu

    const context = this.context;
    const gfx = context.systems.gfx!;
    const viewport = context.viewport;

    // The mode decides which operations are available
    const operations = context.mode?.operations ?? [];
    if (!operations.length) return;
    if (!context.editable()) return;

    // Focus the surface, otherwise clicking off the menu may not trigger browse mode
    // (bhousel - I don't know whether this is needed anymore in 2024)
    const surface = gfx.surface;
    if (surface.focus) {   // FF doesn't support it
      surface.focus();
    }

    for (const operation of operations as any[]) {
      if (typeof operation.point === 'function') {
        operation.point(anchorPoint);  // let the operation know where the menu is
      }
    }

    this.EditMenu
      .anchorLoc(viewport.unproject(anchorPoint))
      .triggerType(triggerType)
      .operations(operations);

    // render the menu
    const $overlay: D3Selection = select(gfx.overlay);
    $overlay.call(this.EditMenu.render);
  }


  /*
   * This just redraws the edit menu in place if it is already showing, used in
   * situations where its available operations may have changed, such as Rapid#1311
   */
  /** Redraws the edit context menu in-place if it is already visible. */
  public redrawEditMenu(): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const $overlay: D3Selection = select(gfx.overlay);

    // If the menu isn't showing, there's nothing to do
    if ($overlay.selectAll('.edit-menu').empty()) return;

    // The mode decides which operations are available
    const operations = context.mode?.operations ?? [];

    if (operations.length && context.editable()) {
      this.EditMenu.operations(operations);
      $overlay.call(this.EditMenu.render);   // redraw it
    } else {
      this.EditMenu.close();
    }
  }


  /** Closes and removes the edit context menu. */
  public closeEditMenu(): void {
    this.EditMenu.close();
  }


  /**
   * Shows the MapRoulette contextual menu at the given anchor point.
   * @param anchorPoint - `[x,y]` screen coordinate where the menu should be anchored
   * @param triggerType - 'touch', 'pen', or 'rightclick' that triggered the menu
   */
  public showMapRouletteMenu(anchorPoint: Vec2, triggerType: string): void {
    this.closeMapRouletteMenu(); // Close any existing menu
    const context = this.context;
    const gfx = context.systems.gfx!;
    const viewport = context.viewport;

    this.MapRouletteMenu.anchorLoc = viewport.unproject(anchorPoint);
    this.MapRouletteMenu.triggerType = triggerType;

    const $overlay: D3Selection = select(gfx.overlay);
    $overlay.call(this.MapRouletteMenu.render);
    this._showsMapRouletteMenu = true;
  }


  /** Closes and removes the MapRoulette task context menu. */
  public closeMapRouletteMenu(): void {
    this.MapRouletteMenu.close();
  }


  /**
   * This adjusts the favicon and document title if we detect a development or staging environment.
   * called by `initAsync()`
   */
  protected _checkEnvironment(): void {
    const context = this.context;
    const assets = context.systems.assets!;
    const urlhash = context.systems.urlhash!;
    const detected = utilDetect();

    const $head: D3Selection = select('head');
    let $favicon: D3Selection = $head.select(`link[rel~='icon']`);
    if (!$favicon.size()) {
      $favicon = $head
        .append('link')
        .attr('rel', 'icon')
        .attr('type', 'image/svg');
    }

    if (/\/canary/.test(detected.host ?? '')) {
      urlhash.titleBase = 'Rapid Canary';
      $favicon.attr('href', assets.getFileURL('img/rapid_favicon-canary.svg'));

    } else if (/(localhost|127\.0\.0\.1)/.test(detected.host ?? '')) {
      urlhash.titleBase = 'Rapid Dev';
      $favicon.attr('href', assets.getFileURL('img/rapid_favicon-dev.svg'));
    }
  }


  /**
   * ClientRects are immutable, so copy them to an Object in case we need to trim the height/width.
   * @param   src -  rectangle (or something that looks like one)
   * @returns the copied properties
   */
  protected _copyRect(src: DOMRect): DOMRectData {
    return {
      left: src.left,
      top: src.top,
      right: src.right,
      bottom: src.bottom,
      width: src.width,
      height: src.height,
      x: src.x,
      y: src.y
    };
  }

}
