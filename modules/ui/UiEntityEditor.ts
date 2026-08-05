import { EventEmitter } from 'tseep/lib/ee-safe';
import { selection } from 'd3-selection';
import { utilArrayIdentical, utilCleanTags } from '@rapid-sdk/util';
import deepEqual from 'fast-deep-equal';

import { actionChangeTags, actionSyncCrossingTags } from '../actions/index.ts';
import { uiIcon } from './icon.js';

import { UiSectionEntityIssues } from './sections/UiSectionEntityIssues.js';
import { UiSectionFeatureType } from './sections/UiSectionFeatureType.js';
import { UiSectionPresetFields } from './sections/UiSectionPresetFields.js';
import { UiSectionRawMemberEditor } from './sections/UiSectionRawMemberEditor.js';
import { UiSectionRawMembershipEditor } from './sections/UiSectionRawMembershipEditor.js';
import { UiSectionRawTagEditor } from './sections/UiSectionRawTagEditor.js';
import { UiSectionSelectionList } from './sections/UiSectionSelectionList.js';

import type { AbstractUiSection } from './AbstractUiSection.ts';
import type { Category } from '../lib/Category.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Difference } from '../lib/Difference.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Preset } from '../lib/Preset.ts';
import type { Tags } from './fields/types.ts';


let _wasSelectedIDs: EntityID[] = [];


/**
 * The `UiEntityEditor` renders the editing UI for the currently selected OSM entities.
 * It gathers the various inspector sections (feature type, fields, raw tags, members, etc.)
 * and renders them into the sidebar.
 */
export class UiEntityEditor extends EventEmitter {
  public context: Context;

  public $parent: D3Selection | null;

  protected _crossingKeys: Set<string>;
  protected _sections: AbstractUiSection[];
  protected _state: string;          // can be 'hide', 'hover', or 'select'
  protected _modified: boolean;
  protected _startGraph: Graph | undefined;
  protected _entityIDs: EntityID[];
  protected _selectedPresets: (Preset | undefined)[];
  protected _newFeature: boolean | undefined;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    const editor = context.systems.editor!;
    const schema = context.systems.schema;
    // Crossings.. :-(  If touching any of these, call the sync action.  Rapid#1260
    this._crossingKeys = schema?.getScope('osm')?.variables.get('crossing_sync_keys')?.asSet() ?? new Set();

    this.$parent = null;
    this._state = '';
    this._modified = false;
    this._startGraph = undefined;
    this._entityIDs = [];
    this._selectedPresets = [];
    this._newFeature = undefined;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._onStagingChange = this._onStagingChange.bind(this);
    this._changeTags = this._changeTags.bind(this);
    this._changeRawTags = this._changeRawTags.bind(this);
    this._revertTags = this._revertTags.bind(this);

    this._sections = [
      new UiSectionSelectionList(context),
      new UiSectionFeatureType(context).on('choose', (selected: Preset | Category) => { this.emit('choose', selected); }),
      new UiSectionEntityIssues(context),
      new UiSectionPresetFields(context).on('change', this._changeTags).on('revert', this._revertTags),
      new UiSectionRawTagEditor(context, 'raw-tag-editor').on('change', this._changeRawTags),
      new UiSectionRawMemberEditor(context),
      new UiSectionRawMembershipEditor(context)
    ];

    // reset listener
    editor.off('stagingchange', this._onStagingChange);
    editor.on('stagingchange', this._onStagingChange);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * @param  $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const combinedTags = this._getCombinedTags(this._entityIDs, editor.staging.graph);
    const isRTL = l10n.isRTL;

    // Header
    let $header: D3Selection = this.$parent.selectAll('.header')
      .data([0]);

    // Enter
    const $$header = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'preset-reset preset-choose')
      .call(uiIcon(isRTL ? '#rapid-icon-forward' : '#rapid-icon-backward'));

    $$header
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3');

    // Update
    $header = $header
      .merge($$header);

    $header.selectAll('h3')
      .text(this._entityIDs.length === 1 ? l10n.t('map_data.layers.osm.feature') : l10n.t('inspector.multiselect'));

    $header.selectAll('.preset-reset')
      .on('click', () => this.emit('choose', this._selectedPresets));

    // Body
    let $body: D3Selection = this.$parent.selectAll('.inspector-body')
      .data([0]);

    // Enter
    const $$body = $body.enter()
      .append('div')
      .attr('class', 'entity-editor inspector-body');

    // Update
    $body = $body
      .merge($$body);

    for (const section of this._sections) {
      if (section.entityIDs)  section.entityIDs(this._entityIDs);
      if (section.presets)    section.presets(this._selectedPresets);
      if (section.tags)       section.tags(combinedTags);
      if (section.state)      section.state(this._state);

      $body.call(section.render);
    }
  }


  /**
   * Get or set whether the entity has been modified.
   * @param  val? - the flag to set; if omitted, returns the current value
   */
  public modified(val?: boolean): any {
    if (!arguments.length) return this._modified;
    this._modified = val!;
    return this;
  }


  /**
   * Get or set the editor state ('hide', 'hover', or 'select').
   * @param  val? - the state to set; if omitted, returns the current state
   */
  public state(val?: string): any {
    if (!arguments.length) return this._state;
    this._state = val!;
    return this;
  }


  /**
   * Get or set the entities being edited.
   * @param  val? - array of EntityIDs to set; if omitted, returns the current ids
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;

    const editor = this.context.systems.editor!;

    // always reload these even if the entityIDs are unchanged, since we
    // could be reselecting after something like dragging a node
    this._startGraph = editor.staging.graph;

    if (Array.isArray(val) && utilArrayIdentical(this._entityIDs, val)) return this;  // exit early if no change

    this._entityIDs = val ?? [];

    this._loadActivePresets(true);

    // reset scroll to top
    if (this.$parent) {
      const element = this.$parent.selectAll('.inspector-body').node() as HTMLElement;
      if (element) {
        element.scroll(0, 0);
      }
    }

    return this.modified(false);
  }


  /**
   * Get or set whether the edited entity is a newly created feature.
   * @param  val? - the value to set; if omitted, returns the current value
   */
  public newFeature(val?: boolean): any {
    if (!arguments.length) return this._newFeature;
    this._newFeature = val;
    return this;
  }


  /**
   * Get or set the presets currently selected for the edited entities.
   * @param  val? - array of presets to set; if omitted, returns the current presets
   */
  public presets(val?: (Preset | undefined)[]): any {
    if (!arguments.length) return this._selectedPresets;

    // don't reload the same preset
    if (!utilArrayIdentical(val!, this._selectedPresets)) {
      this._selectedPresets = val!;
    }
    return this;
  }


  /**
   * Responds to a staging change, re-rendering if the change affects the edited entities.
   * @param  difference - the Difference describing what changed
   */
  protected _onStagingChange(difference: Difference | null): void {
    const context = this.context;
    const editor = context.systems.editor!;

    if (!difference) return;
    if (!this.$parent) return;     // called before first render
    if (this.$parent.selectAll('.entity-editor').empty()) return;
    if (this._state === 'hide') return;

    const significant = difference.didChange.properties || difference.didChange.addition || difference.didChange.deletion;
    if (!significant) return;

    const graph = editor.staging.graph;
    this._entityIDs = this._entityIDs.filter(entityID => graph.hasEntity(entityID));
    if (!this._entityIDs.length) return;

    const prevPreset = this._selectedPresets.length === 1 && this._selectedPresets[0];
    this._loadActivePresets();
    const currPreset = this._selectedPresets.length === 1 && this._selectedPresets[0];

    this.modified(this._startGraph !== graph);
    this.$parent.call(this.render);  // rerender

    // If this difference caused the preset to change, flash the button.
    if (prevPreset !== currPreset) {
      context.container().selectAll('.entity-editor button.preset-reset .label')
        .style('background-color', '#fff')
        .transition()
        .duration(750)
        .style('background-color', null);
    }
  }


  /**
   * When using the fields, we will automatically run the `syncCrossingTags` action.
   * When using the raw tags editor, dont do this.
   * (It will trigger validation warnings for any crossing tags that go out of sync)
   * @param  entityIDs - the entities whose tags changed
   * @param  changed - object of the changed key/value pairs
   * @param  onInput? - true if the change fired on input (before blur)
   */
  protected _changeRawTags(entityIDs: EntityID[], changed: Record<string, string | undefined>, onInput?: boolean): void {
    this._changeTags(entityIDs, changed, onInput, true);
  }


  /**
   * Tag changes that fire on input can all get coalesced into a single
   * history operation when the user leaves the field.  iD#2342
   * Use explicit entityIDs in case the selection changes before the event is fired.
   * We'll also sync up the crossing tags if this update didn't come from the raw tag editor.
   * @param  entityIDs - the entities whose tags changed
   * @param  changed - object of the changed key/value pairs
   * @param  onInput? - true if the change fired on input (before blur)
   * @param  wasRawTagEditor - true if the change came from the raw tag editor
   */
  protected _changeTags(entityIDs: EntityID[], changed: Record<string, string | undefined>, onInput?: boolean, wasRawTagEditor = false): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const crossingKeys = this._crossingKeys;

    // same selection as before?
    const isSameSelection = utilArrayIdentical(this._entityIDs, _wasSelectedIDs);
    _wasSelectedIDs = this._entityIDs.slice();  // copy

    editor.beginTransaction();

    for (const entityID of this._entityIDs) {
      const graph = editor.staging.graph;
      const entity = graph.hasEntity(entityID);
      if (!entity) continue;

      let tags: Tags = { ...entity.tags };   // shallow copy
      let involvesCrossing = false;

      for (const [k, v] of Object.entries(changed) as [string, string | undefined][]) {
        if (!k) continue;
        if (crossingKeys.has(k)) {
          involvesCrossing = true;
        }

        // No op for source=digitalglobe or source=maxar on ML roads. TODO: switch to check on __fbid__
        const source = entity.tags.source;
        if ((entity as any).props.__fbid__ && k === 'source' && (source === 'digitalglobe' || source === 'maxar')) continue;

        if (v !== undefined || tags.hasOwnProperty(k)) {
          tags[k] = v;
        }
      }

      if (!onInput) {
        tags = utilCleanTags(tags);
      }

      if (!deepEqual(entity.tags, tags)) {
        editor.perform(actionChangeTags(entityID, tags));
        if (!wasRawTagEditor && involvesCrossing) {
          editor.perform(actionSyncCrossingTags(entityID));
        }
      }
    }

    // Only commit changes when leaving the field (i.e. on blur event)
    if (!onInput) {
      // If this is the same selection as before, and the previous edit was also a change_tags,
      // we can just replace the previous edit with this one.
      const annotation = l10n.t('operations.change_tags.annotation');
      const options = { annotation: annotation, selectedIDs: this._entityIDs };
      if (isSameSelection && editor.getUndoAnnotation() === annotation) {
        editor.commitAppend(options);
      } else {
        editor.commit(options);
      }
    }

    editor.endTransaction();
  }


  /**
   * Reverts the given tag keys back to their original values.
   * @param  keys - the tag keys to revert
   */
  protected _revertTags(keys: string[]): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const crossingKeys = this._crossingKeys;

    // same selection as before?
    const isSameSelection = utilArrayIdentical(this._entityIDs, _wasSelectedIDs);
    _wasSelectedIDs = this._entityIDs.slice();  // copy

    const baseGraph = editor.base.graph;
    editor.beginTransaction();

    for (const entityID of this._entityIDs) {
      const currGraph = editor.staging.graph;
      const original = baseGraph.hasEntity(entityID);
      const current = currGraph.entity(entityID);
      let tags: Tags = { ...current.tags };   // shallow copy

      const changed: Record<string, string | undefined> = {};
      for (const key of keys) {
        changed[key] = original?.tags[key] ?? undefined;
      }

      let involvesCrossing = false;
      for (const [k, v] of Object.entries(changed) as [string, string | undefined][]) {
        if (!k) continue;

        if (crossingKeys.has(k)) {
          involvesCrossing = true;
        }

        if (v !== undefined || tags.hasOwnProperty(k)) {
          tags[k] = v;
        }
      }

      tags = utilCleanTags(tags);

      if (!deepEqual(current.tags, tags)) {
        editor.perform(actionChangeTags(entityID, tags));
        if (involvesCrossing) {
          editor.perform(actionSyncCrossingTags(entityID));
        }
      }
    }

    // If this is the same selection as before, and the previous edit was also a change_tags,
    // we can just replace the previous edit with this one.
    const annotation = l10n.t('operations.change_tags.annotation');
    const options = { annotation: annotation, selectedIDs: this._entityIDs };
    if (isSameSelection && editor.getUndoAnnotation() === annotation) {
      editor.commitAppend(options);
    } else {
      editor.commit(options);
    }

    editor.endTransaction();
  }


  /**
   * Determines and stores the presets that best match the selected entities.
   * @param  isForNewSelection? - true if called for a freshly changed selection
   */
  protected _loadActivePresets(isForNewSelection?: boolean): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const graph = editor.staging.graph;

    // If multiple entities, try to pick a preset that matches most of them
    const counts: Record<string, number> = {};
    for (const entityID of this._entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) return;

      const preset = schema.match(entity, graph);
      if (!preset) continue;
      counts[preset.id] = (counts[preset.id] || 0) + 1;
    }

    const matches = Object.keys(counts)
      .sort((p1, p2) => counts[p2] - counts[p1])
      .map(presetID => schema.getScope('osm').presets.get(presetID));

    if (!isForNewSelection) {
      // A "weak" preset doesn't set any tags. (e.g. "Address")
      const isWeakPreset = this._selectedPresets.length === 1 &&
        !this._selectedPresets[0].isFallback() &&
        Object.keys(this._selectedPresets[0].addTags || {}).length === 0;

      // Don't replace a weak preset with a fallback preset (e.g. "Point")
      if (isWeakPreset && matches.length === 1 && matches[0]?.isFallback()) return;
    }

    this.presets(matches);
  }


  // Returns a single object containing the tags of all the given entities.
  // Example:
  // {
  //   highway: 'service',
  //   service: 'parking_aisle'
  // }
  //           +
  // {
  //   highway: 'service',
  //   service: 'driveway',
  //   width: '3'
  // }
  //           =
  // {
  //   highway: 'service',
  //   service: [ 'driveway', 'parking_aisle' ],
  //   width: [ '3', undefined ]
  // }
  /**
   * Returns a single object containing the combined tags of all the given entities.
   * @param  entityIDs - the entities to combine tags from
   * @param  graph - the Graph to look up entities in
   */
  protected _getCombinedTags(entityIDs: EntityID[], graph: Graph): Tags {
    const combined = new Map<string, Set<string | undefined>>();    // Map<key, Set<value>
    const counts = new Map<string, number>();      // Map<kv, number>

    const entities = entityIDs.map(entityID => graph.hasEntity(entityID)).filter(Boolean);

    // Gather the keys
    for (const entity of entities) {
      for (const k of Object.keys(entity.tags)) {
        if (k) {
          combined.set(k, new Set());
        }
      }
    }

    // Gather the values
    for (const entity of entities) {
      for (const [k, vals] of combined) {
        const v = entity.tags[k];
        vals.add(v);   // `v` may be 'undefined', we need to collect these also.

        const kv = `${k}=${v}`;
        const count = counts.get(kv) ?? 0;
        counts.set(kv, count + 1);
      }
    }

    // Return results as an Object, where the values are either single values or Arrays
    const results: Tags = {};
    for (const [k, vals] of combined) {
      const arr = [...vals];

      if (arr.length === 1) {   // entities all have same value..
        results[k] = arr[0];

      } else {   // entities have different values..
        // sort in place, by frequency then alphabetically
        results[k] = arr.sort((v1, v2) => {
          const count1 = counts.get(`${k}=${v1}`) ?? 0;
          const count2 = counts.get(`${k}=${v2}`) ?? 0;
          if (count2 !== count1) {
            return count2 - count1;
          }
          if (v2 && v1) {
            return v1.localeCompare(v2);
          }
          return v1 ? 1 : -1;
        });
      }
    }

    return results;
  }
}
