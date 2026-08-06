import { EventEmitter } from 'tseep/lib/ee-safe';

import { uiIcon } from './icon.js';
import { uiCombobox} from './combobox.js';
import { createUiField } from './fields/index.js';
import { uiFormFields } from './form_fields.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { SchemaScope } from '../core/SchemaSystem.ts';
import type { Tags } from './fields/types.ts';
import type { UiField } from './UiField.js';


/**
 * The `UiChangesetEditor` renders the changeset comment / source / hashtags
 * fields in the commit sidebar. Set the changeset via `.changesetID(id)` and
 * `.tags(tags)`, then call `.render($selection)`. Emits `change` on edits.
 */
export class UiChangesetEditor extends EventEmitter {
  public context: Context;

  protected _scope: SchemaScope;
  protected _formFields: any;
  protected _commentCombo: any;
  protected _uifields: UiField[] | null | undefined;
  protected _tags: Tags | undefined;
  protected _changesetID: string | undefined;

  public constructor(context: Context) {
    super();
    this.context = context;

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
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent (the save flow /
   *  `UiCommit`) on each render, so it renders into `$selection` directly rather than
   *  capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
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

      this._uifields.forEach((field: UiField) => {
        field
          .on('change', (t: Tags, onInput: boolean) => {
            this.emit('change', undefined, t, onInput);
          });
      });
    }

    this._uifields.forEach((field: UiField) => {
      field
        .tags(this._tags);
    });


    $selection
      .call(this._formFields.fieldsArr(this._uifields));


    if (initial) {
      const commentField = $selection.select('.form-field-comment textarea');
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
    const hasGoogle = this._tags.comment.match(/google/i);
    const commentWarning = $selection.select('.form-field-comment').selectAll('.comment-warning')
      .data(hasGoogle ? [0] : []);

    commentWarning.exit()
      .transition()
      .duration(200)
      .style('opacity', 0)
      .remove();

    const commentEnter = commentWarning.enter()
      .insert('div', '.tag-reference-body')
      .attr('class', 'field-warning comment-warning')
      .style('opacity', 0);

    const $$link = commentEnter
      .append('a')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-alert', 'inline'));

    $$link
      .append('span');

    commentEnter
      .transition()
      .duration(200)
      .style('opacity', 1);

    // update - set localized href/text here so they re-localize on language change
    const $commentWarning: D3Selection = commentWarning.merge(commentEnter as D3Selection) as D3Selection;

    $commentWarning.select('a')
      .attr('href', l10n.t('commit.google_warning_link'));

    $commentWarning.select('a span')
      .text(l10n.t('commit.google_warning'));
  }


  /**
   * Gets or sets the changeset tags.
   * @param val - the tags to set; omit to get the current value
   */
  public tags(val?: Tags): any {
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
