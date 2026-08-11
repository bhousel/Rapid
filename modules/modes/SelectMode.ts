import { AbstractMode } from './AbstractMode.ts';
import { AbstractData, OsmEntity, GeoJSONData, MarkerData } from '../data/index.ts';
import { Extent } from '@rapid-sdk/math';
import { UiOsmoseEditor } from '../ui/UiOsmoseEditor.ts';
import { UiDataEditor } from '../ui/UiDataEditor.ts';
import { UiDetectionInspector } from '../ui/UiDetectionInspector.ts';
import { UiKeepRightEditor } from '../ui/UiKeepRightEditor.ts';
import { UiNoteEditor } from '../ui/UiNoteEditor.ts';
import { UiMapRouletteEditor } from '../ui/UiMapRouletteEditor.ts';

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

    // Handle 'select' style class.
    // This code chooses the layer that the data came from, so it can be 'select' classed.
    // It's hacky and we should remove this, maybe by including layerID in the `options` passed in.
    scene.clearClass('select');
    for (const datum of selection.values()) {
      const serviceID = (datum.props?.serviceID ?? '') as ServiceID;
      let layerID = null;

      if (['mapwithai', 'esri', 'overture'].includes(serviceID)) {
        layerID = 'rapid';
      } else if (datum instanceof MarkerData && datum.type === 'detection') {
        if (serviceID === 'mapillary' && datum.props.object_type === 'point') {
          layerID = 'mapillary-detections';
        } else if (serviceID === 'mapillary' && datum.props.object_type === 'traffic_sign') {
          layerID = 'mapillary-signs';
        }
      } else if (datum instanceof MarkerData) {   // in most cases the `serviceID` is the `layerID`
        if (serviceID === 'osm') {
          if (datum.type === 'note') {
            layerID = 'notes';   // OSM Notes
          }
        } else {
          layerID = serviceID;
        }
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
      const noteEditor = new UiNoteEditor(context);
      noteEditor.datum = datum;
      noteEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const osm = context.services.osm;
        const d = osm?.getNote(datumID);   // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode
        noteEditor.datum = d;
        Sidebar?.show(noteEditor.render);
        this._selectedData.set(datumID, d);  // update selectedData after a change happens?
      });
      sidebarContent = noteEditor.render;

    } else if (datum instanceof MarkerData && datum.serviceID === 'keepright') {
      const keepRightEditor = new UiKeepRightEditor(context);
      keepRightEditor.datum = datum;
      keepRightEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const keepright = context.services.keepright;
        const d = keepright?.getError(datumID);  // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode?
        keepRightEditor.datum = d;
        Sidebar?.show(keepRightEditor.render);
        this._selectedData.set(datumID, d);  // update selectedData after a change happens?
      });
      sidebarContent = keepRightEditor.render;

    } else if (datum instanceof MarkerData && datum.serviceID === 'osmose') {
      const osmoseEditor = new UiOsmoseEditor(context);
      osmoseEditor.datum = datum;
      osmoseEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const osmose = context.services.osmose;
        const d = osmose?.getError(datumID);     // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;  // or - go to browse mode?
        osmoseEditor.datum = d;
        Sidebar?.show(osmoseEditor.render);
        this._selectedData.set(datumID, d);  // update selectedData after a change happens?
      });
      sidebarContent = osmoseEditor.render;

    } else if (datum instanceof MarkerData && datum.serviceID === 'maproulette') {
      const maprouletteEditor = new UiMapRouletteEditor(context);
      maprouletteEditor.datum = datum;
      const menu = ui?.MapRouletteMenu;
      if (menu) menu.datum = datum;
      maprouletteEditor.on('change', () => {
        gfx?.immediateRedraw();  // force a redraw (there is no history change that would otherwise do this)
        const maproulette = context.services.maproulette;
        const d = maproulette?.getTask(datumID);  // marker may contain stale data - get latest
        if (!(d instanceof MarkerData)) return;   // or - go to browse mode?
        maprouletteEditor.datum = d;
        Sidebar?.show(maprouletteEditor.render);
        this._selectedData.set(datumID, d);  // update selectedData after a change happens?
      });
      sidebarContent = maprouletteEditor.render;

    } else if (datum instanceof MarkerData && datum.type === 'detection') {
      const detectionInspector = new UiDetectionInspector(context);
      detectionInspector.datum = datum;
      sidebarContent = detectionInspector.render;
      const serviceID = datum.serviceID;
      const type = (datum.props.object_type === 'traffic_sign') ? 'signs' : 'detections';
      const layerID = `${serviceID}-${type}`;    // e.g. 'mapillary-signs' or 'mapillary-detections'
      photos.selectDetection(layerID, datum.id);

    // Selected Overture feature...
    } else if (datum.props.serviceID === 'overture') {
      if (Sidebar) {
        Sidebar.OvertureInspector.datum = datum as GeoJSONData;
        sidebarContent = Sidebar.OvertureInspector.render;
      }

    // Selected MapWithAI/Esri feature...
    } else if (datum.props.serviceID === 'mapwithai' || datum.props.serviceID === 'esri') {
      if (Sidebar) {
        Sidebar.RapidInspector.datum = datum as OsmEntity;
        sidebarContent = Sidebar.RapidInspector.render;
      }

    // Selected other unspecified Geo Data (vector tile, geojson, etc..)
    } else if (datum instanceof GeoJSONData) {
      const dataEditor = new UiDataEditor(context);
      dataEditor.datum = datum;
      sidebarContent = dataEditor.render;
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
