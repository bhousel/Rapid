import { EventEmitter } from 'tseep/lib/ee-safe';
import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { uiCombobox} from './combobox.ts';
import { createUiField } from './fields/index.ts';
import { uiFormFields } from './form_fields.ts';

import type { Context } from '../Context.ts';
import type { D3Selection, D3EnterSelection } from 'd3-selection';
import type { SchemaScope } from '../core/SchemaSystem.ts';
import type { OsmTags } from '../data/types.ts';
import type { UiField } from './UiField.ts';


/**
 * The `UiChangesetEditor` renders the changeset comment / source / hashtags
 * fields in the commit sidebar. Set the changeset via `.changesetID(id)` and
 * `.tags(tags)`, then call `.render($selection)`. Emits `change` on edits.
 */
export class UiChangesetEditor extends EventEmitter {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;

  protected _scope: SchemaScope;
  protected _formFields: any;
  protected _commentCombo: any;
  protected _uifields: UiField[] | null | undefined;
  protected _tags: OsmTags | undefined;
  protected _changesetID: string | undefined;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // D3 selections
    this.$parent = null;

    const schema = context.systems.schema!;
    this._scope = schema.getScope('osm');

    this._formFields = uiFormFields(context);
    this._commentCombo = uiCombobox(context, 'comment').caseSensitive(true);
    this._uifields = undefined;
    this._tags = undefined;
    this._changesetID = undefined;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }
    const context = this.context;
    const l10n = context.systems.l10n!;

    let initial = false;

    if (!this._uifields) {
      initial = true;

      this._uifields = [
        createUiField(context, this._scope?.fields.get('comment'), [], { show: true, revert: false }),
        createUiField(context, this._scope?.fields.get('source'), [], { show: false, revert: false }),
        createUiField(context, this._scope?.fields.get('hashtags'), [], { show: false, revert: false }),
      ];

      for (const field of this._uifields) {
        field
          .on('change', (t: OsmTags, onInput: boolean) => {
            this.emit('change', undefined, t, onInput);
          });
      }
    }

    for (const field of this._uifields) {
      field
        .tags(this._tags);
    }


    $parent
      .call(this._formFields.fieldsArr(this._uifields));


    if (initial) {
      const commentField = $parent.select('.form-field-comment textarea');
      const commentNode = commentField.node() as HTMLTextAreaElement | null;

      if (commentNode) {
        commentNode.focus();
        commentNode.select();
      }

      // trigger a 'blur' event so that comment field can be cleaned
      // and checked for hashtags, even if retrieved from localstorage
      (commentField.node() as HTMLTextAreaElement | null)?.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

      // Populate dropdown with user's recent changeset comments, if possible
      const osm = context.services.osm;
      if (osm) {
        osm.getUserChangesetsAsync()
          .then((changesets: any) => {
            const data = [];
            const seen = new Set();
            for (const changeset of changesets) {
              const comment = changeset?.tags?.comment;
              if (!comment) continue;   // skip empty
              if (seen.has(comment)) continue;   // deduplicate
              seen.add(comment);
              data.push({ title: comment, value: comment });
            }

            commentField
              .call(this._commentCombo.data(data));
        });
      }
    }

    // Add warning if comment mentions Google
    const commentVal = this._tags?.comment || '';
    const hasGoogle = commentVal.match(/google/i);
    let $commentWarning = $parent.select('.form-field-comment').selectAll('.comment-warning')
      .data(hasGoogle ? [0] : []);

    $commentWarning.exit()
      .transition()
      .duration(200)
      .style('opacity', 0)
      .remove();

    const $$commentWarning: D3EnterSelection = $commentWarning.enter()
      .insert('div', '.tag-reference-body')
      .attr('class', 'field-warning comment-warning')
      .style('opacity', 0);

    const $$link = $$commentWarning
      .append('a')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-alert', 'inline'));

    $$link
      .append('span');

    $$commentWarning
      .transition()
      .duration(200)
      .style('opacity', 1);

    // update - set localized href/text here so they re-localize on language change
    $commentWarning = $commentWarning
      .merge($$commentWarning);

    $commentWarning.select('a')
      .attr('href', l10n.t('commit.google_warning_link'));

    $commentWarning.select('a span')
      .text(l10n.t('commit.google_warning'));
  }


  /**
   * Gets or sets the changeset tags.
   * @param val - the tags to set; omit to get the current value
   */
  public tags(val?: OsmTags): any {
    if (val === undefined) return this._tags;
    this._tags = val;
    // Don't reset _uifields here.
    return this;
  }


  /**
   * Gets or sets the changeset ID.
   * @param val - the changeset ID to set; omit to get the current value
   */
  public changesetID(val?: string): any {
    if (val === undefined) return this._changesetID;
    if (this._changesetID === val) return this;
    this._changesetID = val;
    this._uifields = null;
    return this;
  }
}
