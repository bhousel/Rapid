import { dispatch as d3_dispatch } from 'd3-dispatch';

import { uiIcon } from './icon.js';
import { uiCombobox} from './combobox.js';
import { UiField } from './UiField.js';
import { uiFormFields } from './form_fields.js';
import { utilRebind } from '../util/index.ts';


export function uiChangesetEditor(context) {
    const l10n = context.systems.l10n;
    const schema = context.systems.schema;
    const scope = schema.getScope('osm');

    const dispatch = d3_dispatch('change');
    var formFields = uiFormFields(context);
    var commentCombo = uiCombobox(context, 'comment').caseSensitive(true);
    var _uifields;
    var _tags;
    var _changesetID;


    function changesetEditor(selection) {
        render(selection);
    }


    function render(selection) {
        let initial = false;

        if (!_uifields) {
            initial = true;

            _uifields = [
                new UiField(context, scope?.fields.get('comment'), null, { show: true, revert: false }),
                new UiField(context, scope?.fields.get('source'), null, { show: false, revert: false }),
                new UiField(context, scope?.fields.get('hashtags'), null, { show: false, revert: false }),
            ];

            _uifields.forEach(function(field) {
                field
                    .on('change', function(t, onInput) {
                        dispatch.call('change', field, undefined, t, onInput);
                    });
            });
        }

        _uifields.forEach(function(field) {
            field
                .tags(_tags);
        });


        selection
            .call(formFields.fieldsArr(_uifields));


        if (initial) {
            var commentField = selection.select('.form-field-comment textarea');
            var commentNode = commentField.node();

            if (commentNode) {
                commentNode.focus();
                commentNode.select();
            }

            // trigger a 'blur' event so that comment field can be cleaned
            // and checked for hashtags, even if retrieved from localstorage
            commentField.node()?.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

            // Populate dropdown with user's recent changeset comments, if possible
            const osm = context.services.osm;
            if (osm) {
              osm.getUserChangesetsAsync()
                .then(changesets => {
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
                    .call(commentCombo.data(data));
              });
            }
        }

        // Add warning if comment mentions Google
        var hasGoogle = _tags.comment.match(/google/i);
        var commentWarning = selection.select('.form-field-comment').selectAll('.comment-warning')
            .data(hasGoogle ? [0] : []);

        commentWarning.exit()
            .transition()
            .duration(200)
            .style('opacity', 0)
            .remove();

        var commentEnter = commentWarning.enter()
            .insert('div', '.tag-reference-body')
            .attr('class', 'field-warning comment-warning')
            .style('opacity', 0);

        commentEnter
            .append('a')
            .attr('target', '_blank')
            .call(uiIcon('#rapid-icon-alert', 'inline'))
            .attr('href', l10n.t('commit.google_warning_link'))
            .append('span')
            .text(l10n.t('commit.google_warning'));

        commentEnter
            .transition()
            .duration(200)
            .style('opacity', 1);
    }


    changesetEditor.tags = function(_) {
        if (!arguments.length) return _tags;
        _tags = _;
        // Don't reset _uifields here.
        return changesetEditor;
    };


    changesetEditor.changesetID = function(_) {
        if (!arguments.length) return _changesetID;
        if (_changesetID === _) return changesetEditor;
        _changesetID = _;
        _uifields = null;
        return changesetEditor;
    };


    return utilRebind(changesetEditor, dispatch, 'on');
}
