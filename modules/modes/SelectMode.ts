import { AbstractMode } from './AbstractMode.ts';
import { AbstractData, GeoJSONData, MarkerData } from '../data/index.ts';
import { Extent } from '@rapid-sdk/math';
import { uiOsmoseEditor } from '../ui/osmose_editor.js';
import { uiDataEditor } from '../ui/data_editor.js';
import { uiDetectionInspector } from '../ui/detection_inspector.js';
import { uiKeepRightEditor } from '../ui/keepRight_editor.js';
import { uiNoteEditor } from '../ui/note_editor.js';
import { uiMapRouletteEditor } from '../ui/maproulette_editor.js';

import type { Context } from '../Context.ts';

const DEBUG = false;


/** Options for entering `SelectMode` */
export interface SelectModeOptions {
  /** A Map of datumID -> datum for selected items */
  selection?: Map<DataID, AbstractData>;
}


/**
 * In `SelectMode`, the user has selected one or more (non-OSM) map features.
 * - `selectedData` contains the information about what is selected.
 * - The sidebar shows something depending on what the selection contains.
 * - We also can set up the "operations" allowed (right click edit menu)
 */
export class SelectMode extends AbstractMode {

  /** The total extent of selected features */
  public extent: Extent | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'select';

    this.extent = null;
  }


  /**
   * Expects a `selection` property in the options argument as a `Map<datumID, datum>`
   * @param  options - Optional options object
   * @return `true` if mode could be entered, `false` it not
   */
  public enter(options: SelectModeOptions = {}): boolean {
    const selection = options.selection;
    if (!(selection instanceof Map)) return false;
    if (!selection.size) return false;
    const [[datumID, datum]] = selection.entries();   // the first thing in the selection

    if (DEBUG) {
      console.log(`SelectMode: entering, selected ${datumID}`);  // eslint-disable-line no-console
    }

    this._selectedData = selection;
    this._active = true;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const photos = context.systems.photos!;
    const ui = context.systems.ui;
    const scene = gfx.scene!;
    const Sidebar = ui?.Sidebar;

    context.enableBehaviors(['hover', 'select', 'drag', 'mapInteraction', 'lasso', 'paste']);

    // Compute the total extent of selected items
    this.extent = new Extent();
    for (const datum of selection.values()) {
      const other = datum.extent();
      if (other instanceof Extent) {
        this.extent.extendSelf(other);
      }
    }

    // Handle select style class
    scene.clearClass('select');
    for (const datum of selection.values()) {
      let layerID = null;

      // hacky - improve?
      if (datum instanceof MarkerData && datum.type === 'detection') {  // A detection (object or sign)
        if (datum.serviceID === 'mapillary' && datum.props.object_type === 'point') {
          layerID = 'mapillary-detections';
        } else if (datum.serviceID === 'mapillary' && datum.props.object_type === 'traffic_sign') {
          layerID = 'mapillary-signs';
        }
      } else if (datum instanceof MarkerData) {  // in most cases the `serviceID` is the `layerID`
        const serviceID = datum.serviceID;       // 'keepright', 'osmose', etc.
        if (serviceID === 'osm') {
          if (datum.type === 'note') {
            layerID = 'notes';   // OSM Notes
          }
        } else {
          layerID = serviceID;
        }
      } else if (datum.props.__fbid__) {      // a Rapid feature
        layerID = 'rapid';
      } else if (datum.props.overture) {      // Overture data
        layerID = 'rapid';
      } else if (datum instanceof GeoJSONData) {  // custom data
        layerID = 'custom-data';
      }

      if (layerID) {
        scene.setClass('select', layerID, datumID);
      }
    }


    // What was selected?
    Sidebar?.reset();
 // The update handlers feel like they should live with the sidebar content components, not here
    let sidebarContent: any = null;
    // Selected a note...
    if (datum instanceof MarkerData && datum.serviceID === 'osm' && datum.type === 'note') {
      sidebarContent = (uiNoteEditor as any)(context).note(datum);
      sidebarContent
        .on('change', () => {
          gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
          const osm = context.services.osm as any;
          const note = osm?.getNote(datumID);
          if (!(note instanceof MarkerData)) return;  // or - go to browse mode
          Sidebar?.show(sidebarContent.note(note));
          this._selectedData.set(datumID, note);  // update selectedData after a change happens?
        });

    } else if (datum instanceof MarkerData && datum.serviceID === 'keepright') {
      sidebarContent = (uiKeepRightEditor as any)(context).error(datum);
      sidebarContent
        .on('change', () => {
          gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
          const keepright = context.services.keepright as any;
          const error = keepright?.getError(datumID);
          if (!(error instanceof MarkerData)) return;  // or - go to browse mode?
          Sidebar?.show(sidebarContent.error(error));
          this._selectedData.set(datumID, error);  // update selectedData after a change happens?
        });

    } else if (datum instanceof MarkerData && datum.serviceID === 'osmose') {
      sidebarContent = (uiOsmoseEditor as any)(context).error(datum);
      sidebarContent
        .on('change', () => {
          gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
          const osmose = context.services.osmose as any;
          const error = osmose?.getError(datumID);
          if (!(error instanceof MarkerData)) return;  // or - go to browse mode?
          Sidebar?.show(sidebarContent.error(error));
          this._selectedData.set(datumID, error);  // update selectedData after a change happens?
        });

    } else if (datum instanceof MarkerData && datum.serviceID === 'maproulette') {
      sidebarContent = (uiMapRouletteEditor as any)(context).error(datum);
      (ui as any)?.MapRouletteMenu?.error(datum);
      sidebarContent
        .on('change', () => {
          gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
          const maproulette = context.services.maproulette as any;
          const error = maproulette?.getError(datumID);
          if (!(error instanceof MarkerData)) return;  // or - go to browse mode?
          Sidebar?.show(sidebarContent.error(error));
          this._selectedData.set(datumID, error);  // update selectedData after a change happens?
        });

    } else if (datum instanceof MarkerData && datum.type === 'detection') {
      sidebarContent = (uiDetectionInspector as any)(context).datum(datum);
      const serviceID = datum.serviceID;
      const type = (datum.props.object_type === 'traffic_sign') ? 'signs' : 'detections';
      const layerID = `${serviceID}-${type}`;    // e.g. 'mapillary-signs' or 'mapillary-detections'
      photos.selectDetection(layerID, datum.id);

    // Selected custom data (e.g. gpx track)...
    } else if (datum instanceof GeoJSONData) {
      sidebarContent = (uiDataEditor as any)(context).datum(datum);

    // Selected Overture feature...
    } else if (datum.props.overture) {
      if (Sidebar) {
        Sidebar.OvertureInspector.datum = datum;
        sidebarContent = Sidebar.OvertureInspector.render;
      }

    // Selected Rapid feature...
    } else if (datum.props?.__fbid__) {
      if (Sidebar) {
        Sidebar.RapidInspector.datum = datum;
        sidebarContent = Sidebar.RapidInspector.render;
      }
    }

    // Todo: build a sidebar UI for:
    //  multi selections - (support merge between types) or
    //  selections that are unrecognizable?

    // setup the sidebar
    if (sidebarContent) {
      Sidebar?.show(sidebarContent); //.newNote(_newFeature));
      // Attempt to expand the sidebar, avoid obscuring the selected thing if we can..
      // For this to work the datum must have an extent already
      // Sidebar.expand(Sidebar.intersects(datum.extent()));
    }

    return true;
  }


  /**
   * Exits the mode, clearing selection state and hiding sidebar.
   */
  public exit(): void {
    if (!this._active) return;
    this._active = false;

    const context = this.context;
    const photos = context.systems.photos!;
    const gfx = context.systems.gfx!;
    const ui = context.systems.ui!;
    const scene = gfx.scene!;
    const Sidebar = ui.Sidebar;

    this.extent = null;

    if (DEBUG) {
      console.log('SelectMode: exiting');  // eslint-disable-line no-console
    }

    this._selectedData.clear();
    scene.clearClass('select');
    Sidebar.hide();
    photos.selectDetection(null);
  }

}
