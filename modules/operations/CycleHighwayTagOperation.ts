import { utilArrayIdentical } from '@rapid-sdk/util';

import { actionChangePreset } from '../actions/change_preset.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';

import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/types.ts';


// The last selection we cycled. This is intentionally module-level state: an operation
// instance is recreated on every menu setup / keypress, so per-instance state can't
// remember whether the *previous* cycle acted on this same selection. (A future
// improvement would be to move this onto a system, per the system-ownership rule.)
let _lastSelectedIDs: EntityID[] = [];

// If the presetID matches any of these, we can cycle through highways
const highwayLinePresetRegex = [
  /^highway\/(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)/,
  /^line$/,   // untagged line
];

const highwayLinePresetIDs = [
  'highway/residential',
  'highway/service',
  'highway/service/driveway',
  'highway/track',
  'highway/unclassified',
  'highway/tertiary',
  'line'
];

// If the presetID matches any of these, we can cycle through line crossings
const crossingLinePresetRegex = [
  /^highway\/footway\/(crossing|sidewalk)/,
  /^highway\/footway$/
];

const crossingLinePresetIDs = [
  'highway/footway/crossing2/dashes',
  'highway/footway/crossing2/dots',
  'highway/footway/crossing2/ladder',
  'highway/footway/crossing2/ladder:skewed',
  'highway/footway/crossing2/lines',
  'highway/footway/crossing2/surface',
  'highway/footway/crossing2/unmarked',
  'highway/footway/crossing2/zebra',
  'highway/footway/crossing2/other'
];

// If the presetID matches any of these, we can cycle through vertex crossings
const crossingVertexPresetRegex = [
  /^highway\/crossing/
];

const crossingVertexPresetIDs = [
  'highway/crossing2/dashes',
  'highway/crossing2/dots',
  'highway/crossing2/ladder',
  'highway/crossing2/ladder:skewed',
  'highway/crossing2/lines',
  'highway/crossing2/surface',
  'highway/crossing2/unmarked',
  'highway/crossing2/zebra',
  'highway/crossing2/other'
];


/**
 * `CycleHighwayTagOperation` cycles the selected feature(s) through a related set of
 * highway or crossing presets.
 */
export class CycleHighwayTagOperation extends AbstractOperation {

  /** The eligible entities */
  protected _entities: OsmEntity[];
  /** The preset cycle to move through, or `null` if the selection isn't eligible */
  protected _presetIDs: string[] | null;
  /** The undo annotation */
  protected _annotation: string;
  /** Whether the same selection was cycled last time */
  protected _isSameSelection: boolean;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to cycle
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;

    const graph = editor.staging.graph;

    // Gather eligible entities and determine which list we are cycling through..
    let entities: OsmEntity[] = [];
    let presetIDs: string[] | null = null;
    let annotation = '';

    for (const entityID of selectedIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) continue;

      const geometry = entity.geometry(graph);
      const preset = schema.match(entity, graph);
      if (!preset) continue;

      const isHighwayLine = (geometry === 'line' && highwayLinePresetRegex.some(regex => regex.test(preset.id)));
      const isCrossingLine = (geometry === 'line' && crossingLinePresetRegex.some(regex => regex.test(preset.id)));
      const isCrossingVertex = (geometry === 'vertex' && crossingVertexPresetRegex.some(regex => regex.test(preset.id)));

      if (isHighwayLine) {
        entities.push(entity);
        if (!presetIDs) {   // lock it in
          presetIDs = highwayLinePresetIDs;
          annotation = l10n.t('operations.cycle_highway_tag.highway_annotation');
        } else if (presetIDs !== highwayLinePresetIDs) {   // mix of types, bail out
          entities = []; presetIDs = null; annotation = ''; break;
        }
      }

      if (isCrossingLine) {
        entities.push(entity);
        if (!presetIDs) {  // lock it in
          presetIDs = crossingLinePresetIDs;
          annotation = l10n.t('operations.cycle_highway_tag.crosswalk_annotation');
        } else if (presetIDs !== crossingLinePresetIDs) {   // mix of types, bail out
          entities = []; presetIDs = null; annotation = ''; break;
        }
      }

      if (isCrossingVertex) {
        entities.push(entity);
        if (!presetIDs) {  // lock it in
          presetIDs = crossingVertexPresetIDs;
          annotation = l10n.t('operations.cycle_highway_tag.crosswalk_annotation');
        } else if (presetIDs !== crossingVertexPresetIDs) {   // mix of types, bail out
          entities = []; presetIDs = null; annotation = ''; break;
        }
      }
    }

    this._entities = entities;
    this._presetIDs = presetIDs;
    this._annotation = annotation;

    // If the user has the same selection as before, we continue through the cycle..
    this._isSameSelection = utilArrayIdentical(selectedIDs, _lastSelectedIDs);
    if (!this._isSameSelection) {
      _lastSelectedIDs = selectedIDs.slice();  // take copy
    }

    this.id = 'cycle_highway_tag';
    this.keys = ['⇧' + l10n.t('shortcuts.command.cycle_highway_tag.key')];
    this.title = l10n.t('operations.cycle_highway_tag.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;

    const presetIDs = this._presetIDs;
    if (!this._entities.length || !presetIDs) return;

    // Pick the next preset in the cycle...
    let graph = editor.staging.graph;
    const currPreset = schema.match(this._entities[0], graph);
    const index = currPreset ? presetIDs.indexOf(currPreset.id) : -1;
    const newPresetID = presetIDs[(index + 1) % presetIDs.length];
    const newPreset = schema.getScope('osm').presets.get(newPresetID) ?? null;

    editor.beginTransaction();

    // Update all eligible entities...
    for (const entity of this._entities) {
      graph = editor.staging.graph;   // note that staging graph changes each time we call perform
      const oldPreset = schema.match(entity, graph);
      const action = actionChangePreset(entity.id, oldPreset, newPreset, true /* skip field defaults */);
      editor.perform(action);
    }

    const options = { annotation: this._annotation, selectedIDs: this.selectedIDs };
    if (this._isSameSelection && editor.getUndoAnnotation() === this._annotation) {
      editor.commitAppend(options);
    } else {
      editor.commit(options);
    }

    editor.endTransaction();
    context.enter('select-osm', { selection: { osm: this.selectedIDs } });  // reselect
  }


  public available(): boolean {
    return this._entities.length > 0 && Boolean(this._presetIDs);
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('operations.cycle_highway_tag.description');
  }


  public annotation(): string {
    return this._annotation;
  }
}
