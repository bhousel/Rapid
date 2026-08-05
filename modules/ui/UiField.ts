import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';
import { utilUniqueString } from '@rapid-sdk/util';

import { uiIcon } from './icon.js';
import { uiTooltip } from './tooltip.js';
// import { uiFieldHelp } from './field_help.js';
import { UiTagReference } from './UiTagReference.js';
import { utilTotalExtent } from '../util/index.ts';
import { LANGUAGE_SUFFIX_REGEX } from './fields/types.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Extent } from '@rapid-sdk/math';
import type { Field } from '../lib/index.ts';
import type { Tags } from './fields/types.ts';


/** Display options controlling how a `UiField` renders its chrome. */
export interface UiFieldOptions {
  /** Whether the field is shown, or tucked away in the "Add field" list */
  show: boolean;
  /** Whether to wrap the input with the label/chrome */
  wrap: boolean;
  /** Whether to show the remove (trash) button */
  remove: boolean;
  /** Whether to show the revert (undo) button */
  revert: boolean;
  /** Whether to show the tag-reference info button */
  info: boolean;
}


/**
 * `UiField` is the base class for an editable field in the entity editor. It renders the shared
 * field "chrome" (label, lock, remove/revert buttons, tag reference) and delegates the
 * field-specific input UI to a `UiFieldX` subclass via `renderContent()` / `syncTags()`.
 *
 * Construct a concrete field with `createUiField(context, presetField, …)` from `fields/index.ts`,
 * which picks the subclass by `presetField.type`.
 */
export class UiField extends EventEmitter {
  public context: Context;
  public presetField: Field;
  public entityIDs: EntityID[];
  public options: UiFieldOptions;
  public id: string;
  public type: string;
  public label: string;
  public terms: string[];
  public placeholder: string;
  public default: string;
  public key: string;
  public keys: string[];
  public safeid: string;
  public uid: string;
  public entityExtent: Extent | null;

  public static supportsMultiselection = true;

  protected _show: boolean;
  protected _state: string;
  protected _tags: Tags;
  protected _locked: boolean;
  protected _lockedTip: any;


  /**
   * @param context - Global shared application context
   * @param presetField - the original Field tracked by the SchemaSystem
   * @param entityIDs - the entities this field applies to
   * @param options - field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super();
    this.context = context;
    this.presetField = presetField;
    this.entityIDs = entityIDs;

    this.options = Object.assign({
      show: true,
      wrap: true,
      remove: true,
      revert: true,
      info: true
    }, options);

//    // Don't show the remove and revert buttons if any of the entity IDs are FB features
//    // with source=digitalglobe or source=maxar
//    const someFbRoadsSelected = entityIDs ? entityIDs.some(function(entity) {
//      return entity.props.__fbid__ && (entity.tags.source === 'maxar' || entity.tags.source === 'digitalglobe');
//    }) : false;
//    if (someFbRoadsSelected) {
//      this.options.remove = false;
//      this.options.revert = false;
//    }

    // copy some commonly used stuff from the Field
    this.id = presetField.id;
    this.type = presetField.type;
    this.label = presetField.label;
    this.terms = presetField.terms;
    this.placeholder = presetField.placeholder;
    this.default = presetField.props.default;
    this.key = presetField.props.key;
    this.keys = presetField.props.keys;
    this.safeid = presetField.safeid;
    this.uid = utilUniqueString(`form-field-${presetField.safeid}`);

    this._show = this.options.show;
    this._state = '';
    this._tags = {};

    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const l10n = context.systems.l10n!;

    this.entityExtent = null;
    if (entityIDs?.length) {
      this.entityExtent = utilTotalExtent(entityIDs, graph);
    }

    this._locked = false;
    this._lockedTip = uiTooltip(context)
      .title(l10n.t('inspector.lock.suggestion', { label: this.label }))
      .placement('bottom');


    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.isAllowed = this.isAllowed.bind(this);
    this.isModified = this.isModified.bind(this);
    this.isShown = this.isShown.bind(this);
    this.remove = this.remove.bind(this);
    this.render = this.render.bind(this);
    this.renderContent = this.renderContent.bind(this);
    this.revert = this.revert.bind(this);
    this.syncTags = this.syncTags.bind(this);
    this.tagsContainFieldKey = this.tagsContainFieldKey.bind(this);
  }


  /**
   * Returns whether any of the field's keys have been modified from the base graph.
   * @return `true` if any watched tag differs from its original value
   */
  public isModified(): boolean {
    if (!this.entityIDs?.length) return false;

    const editor = this.context.systems.editor!;
    const baseGraph = editor.base.graph;
    const currGraph = editor.staging.graph;

    return this.entityIDs.some(entityID => {
      const original: any = baseGraph.hasEntity(entityID);
      const current: any = currGraph.hasEntity(entityID);
      return this.keys.some(key => {
        return original ? current.tags[key] !== original.tags[key] : current.tags[key];
      });
    });
  }


  /**
   * Returns whether the current tags contain a value for any of this field's keys.
   * @return `true` if a matching tag is present
   */
  public tagsContainFieldKey(): boolean {
    return this.keys.some(key => {

      if (this.type === 'multiCombo') {
        for (const tagKey in this._tags) {
          if (tagKey.indexOf(key) === 0) {
            return true;
          }
        }
        return false;

      } else if (this.type === 'localized') {
        for (const tagKey in this._tags) {
          // Matches 'key:<code>', where <code> is a BCP47 locale code.
          const match = tagKey.match(LANGUAGE_SUFFIX_REGEX);
          if (match && match[1] === this.key && match[2]) {
            return true;
          }
        }
      }

      return this._tags[key] !== undefined;
    });
  }


  /**
   * Reverts the field's tags to their original values.
   * @param d3_event - The triggering DOM event
   */
  public revert(d3_event: Event): void {
    d3_event.stopPropagation();
    d3_event.preventDefault();
    if (!this.entityIDs?.length || this._locked) return;

    // Crossings.. :-(  If reverting any of these, revert the related ones.  Rapid#1260
    const keys = new Set(this.keys);
    if (keys.has('crossing')) {
      keys.add('crossing:markings');
      keys.add('crossing:signals');
    }
    if (keys.has('crossing:markings') || keys.has('crossing:signals')) {
      keys.add('crossing');
    }

    this.emit('revert', [...keys]);
  }


  /**
   * Removes the field's tags from the entity.
   * @param d3_event - The triggering DOM event
   */
  public remove(d3_event: Event): void {
    d3_event.stopPropagation();
    d3_event.preventDefault();
    if (this._locked) return;

    // Crossings.. :(  If removing any of these, remove the related ones.  Rapid#1260
    const keys = new Set(this.keys);
    if (keys.has('crossing')) {
      keys.add('crossing:markings');
      keys.add('crossing:signals');
    }
    if (keys.has('crossing:markings') || keys.has('crossing:signals')) {
      keys.add('crossing');
    }

    const tagChange: Tags = {};
    for (const k of keys) {
      tagChange[k] = undefined;
    }
    this.emit('change', tagChange);
  }



  /**
   * @param $selection - A d3-selection to a parent element that the field should render itself into
   */
  public render($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;

    let $container: D3Selection = $selection.selectAll('.form-field')
      .data([this]);

    // Enter
    const $$container: D3Selection = $container.enter()
      .append('div')
      .attr('class', `form-field form-field-${this.safeid}`)
      .classed('nowrap', !this.options.wrap);

    if (this.options.wrap) {
      const $$label: D3Selection = $$container
        .append('label')
        .attr('class', 'field-label')
        .attr('for', this.uid);

      const $$text: D3Selection = $$label
        .append('span')
        .attr('class', 'label-text');

      $$text
        .append('span')
        .attr('class', 'label-textvalue');

      $$text
        .append('span')
        .attr('class', 'label-textannotation');

      if (this.options.remove) {
        $$label
          .append('button')
          .attr('class', 'remove-icon')
          .call(uiIcon('#rapid-operation-delete'));
      }

      if (this.options.revert) {
        $$label
          .append('button')
          .attr('class', 'modified-icon')
          .call(uiIcon(l10n.isRTL ? '#rapid-icon-redo' : '#rapid-icon-undo'));
      }
    }


    // Update
    $container = $container
      .merge($$container);

    // Set localized text/titles on the update selection so they re-localize on language change.
    $container.select('.field-label .label-textvalue')
      .text(this.label);

    $container.select('.field-label > .remove-icon')  // propagate bound data
      .attr('title', l10n.t('icons.remove'))
      .on('click', this.remove);

    $container.select('.field-label > .modified-icon')  // propagate bound data
      .attr('title', l10n.t('icons.undo'))
      .on('click', this.revert);

// kind of a convoluted way to do it.. selection.each over one thing that is just `this`? :-/
    $container
      .each((d, i, nodes) => {
        const $selection: D3Selection = d3_select(nodes[i]);

//        // instantiate field help
//        let help;
//        if (this.options.wrap && this.type === 'restrictions') {
//           help = uiFieldHelp(this.context, 'restrictions');
//        }

        // instantiate tag reference
        let reference: any;
        if (this.options.wrap && this.options.info) {
          let referenceKey = this.key || '';
          if (this.type === 'multiCombo') {   // lookup key without the trailing ':'
            referenceKey = referenceKey.replace(/:$/, '');
          }

          reference = new UiTagReference(this.context, (this as any).reference || { key: referenceKey });
          if (this._state === 'hover') {
            reference.showing(false);
          }
        }

        $selection
          .call(this.renderContent);

//        // add field help components
//        if (help) {
//          $selection
//            .call(help.body)
//            .select('.field-label')
//            .call(help.button);
//        }

        // add tag reference components
        if (reference) {
          $selection
            .call(reference.body)
            .select('.field-label')
            .call(reference.button);
        }

        this.syncTags(this._tags);
      });


    $container
      .classed('locked', this._locked)
      .classed('modified', this.isModified())
      .classed('present', this.tagsContainFieldKey());

    // show a tip and lock icon if the field is locked
    const $annotation: D3Selection = $container.selectAll('.field-label .label-textannotation');
    const $icon: D3Selection = $annotation.selectAll('.icon')
      .data(this._locked ? [0]: []);

    $icon.exit()
      .remove();

    $icon.enter()
      .append('svg')
      .attr('class', 'icon')
      .append('use')
      .attr('xlink:href', '#fas-lock');

    $container.call(this._locked ? this._lockedTip : this._lockedTip.destroy);
  }



  // old style getter/setters

  /**
   * Gets or sets the field's UI state (e.g. 'hover').
   * @param val - The new state, or omit to get the current state
   * @return The current state (getter) or `this` (setter)
   */
  public state(val?: string): any {
    if (val === undefined) return this._state;
    this._state = val;
    return this;
  }


  /**
   * Gets or sets the field's tags.
   * @param val - The new tags, or omit to get the current tags
   * @return The current tags (getter) or `this` (setter)
   */
  public tags(val?: Tags): any {
    if (val === undefined) return this._tags;
    this._tags = val;

    // always show a field if it has a value to display
    if (this.tagsContainFieldKey() && !this._show) {
      this._show = true;
    }

    return this;
  }


  /**
   * Gets or sets the field's locked state.
   * @param val - The new locked state, or omit to get the current state
   * @return The current locked state (getter) or `this` (setter)
   */
  public locked(val?: boolean): any {
    if (val === undefined) return this._locked;
    this._locked = val;
    return this;
  }


  /** Shows the field, applying any default value. */
  public show(): void {
    this._show = true;
    if (this.default && this.key && this._tags[this.key] !== this.default) {
      const tagChange: Tags = {};
      tagChange[this.key] = this.default;
      this.emit('change', tagChange);
    }
  }


  /**
   * A shown field has a visible UI, a non-shown field is in the 'Add field' dropdown.
   * @return `true` if the field is shown
   */
  public isShown(): boolean {
    return this._show;
  }


  /**
   * An allowed field can appear in the UI or in the 'Add field' dropdown.
   * A non-allowed field is hidden from the user altogether
   * Some reasons why a field may be hidden:
   *   - the user has selected multiple things and they don't all apply to the field
   *   - the field is not available in the location where the user is editing
   *
   * @return `true` if the field can be shown, `false` if the field should be hidden
   */
  public isAllowed(): boolean {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const locations = context.systems.locations;  // optional
    const presetField = this.presetField;

    // Most of the time we have entityIDs to consider, but if not, just return `true`.
    // For example: the fields on the upload dialog that set the changeset tags.
    if (!this.entityIDs?.length) return true;

    // Does this field support multiselection?
    if (this.entityIDs.length > 1 && (this.constructor as typeof UiField).supportsMultiselection === false) {
      return false;
    }

    // Does this field work with all the geometries of the entities selected?
    for (const entityID of this.entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (!entity) return false;
      if (!presetField.geometries.has(entity.geometry(graph))) return false;
    }

    // Is this field allowed in this location?
    const locID = presetField.props.locationSetID;
    if (locID && this.entityExtent) {   // if !locID, field is valid everywhere
      // Without a locations system we can't restrict by location, so allow it everywhere.
      const validHere = locations?.locationSetsAt(this.entityExtent.center());
      if (validHere && !validHere.has(locID)) return false;
    }

    // Does this field require another tag to be set first?
    // (ignore tagging prerequisites if the field already has a value)
    const prerequisiteTag = presetField.props.prerequisiteTag;
    if (prerequisiteTag && !this.tagsContainFieldKey()) {
      const isPrerequisiteSatisfied = this.entityIDs.every(entityID => {
        const entity = graph.entity(entityID);
        if (prerequisiteTag.key) {
          const value = entity.tags[prerequisiteTag.key];
          if (!value) return false;

          if (prerequisiteTag.valueNot) {
            return prerequisiteTag.valueNot !== value;
          }
          if (prerequisiteTag.value) {
            return prerequisiteTag.value === value;
          }
        } else if (prerequisiteTag.keyNot) {
          if (entity.tags[prerequisiteTag.keyNot]) return false;
        }
        return true;
      });

      if (!isPrerequisiteSatisfied) return false;
    }

    return true;
  }


  /**
   * Renders the field-specific input UI into the field container.
   * The base renders nothing; each `UiFieldX` subclass overrides this.
   * @param $selection - A d3-selection to the `.form-field` container
   */
  public renderContent($selection: D3Selection): void {}

  /**
   * Updates the field-specific input UI to reflect the current tags.
   * The base does nothing; each `UiFieldX` subclass overrides this.
   * @param tags - The current tags
   */
  public syncTags(tags: Tags): void {}

  /** Moves keyboard focus to the field's input. The base does nothing; subclasses override this. */
  public focus(): void {}

}
