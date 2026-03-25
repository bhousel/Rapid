import { utilHashcode, utilTagDiff } from '@rapid-sdk/util';

import { actionChangePreset } from '../actions/change_preset.ts';
import { actionChangeTags } from '../actions/change_tags.ts';
import { actionUpgradeTags } from '../actions/upgrade_tags.ts';
import { Graph, ValidationIssue, ValidationFix } from '../lib/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity, OsmNode, OsmTags } from '../data/types.ts';
import type { TagDiff } from '@rapid-sdk/util';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting outdated, deprecated,
 * or incomplete tags. Also handles name-suggestion-index upgrades for
 * non-canonical brand tagging.
 * @param context
 * @returns Validator function
 */
export function validateOutdatedTags(context: Context): ValidatorFunction {
  const type = 'outdated_tags' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;


  /**
   * Tests whether the way is tagged as a crossing
   * (e.g. `highway=footway` + `footway=crossing`).
   * @param tags - The tags to check
   * @returns `true` if the way has crossing tags
   */
  function _isCrossingWay(tags: OsmTags): boolean {
    const pathVals = schema!.getScope('osm').variables.get('path_highway_values')?.asSet();
    for (const k of pathVals ?? []) {
      if (tags.highway === k && tags[k] === 'crossing') {
        return true;
      }
    }
    return false;
  }


  /**
   * Detects outdated, deprecated, or incomplete tags on an entity.
   * Performs preset upgrades, deprecated tag replacement, and NSI matching.
   * @param entity - The entity to check
   * @param graph - The current graph
   * @returns Array of issues, with `provisional` set if waiting on NSI
   */
  function oldTagIssues(entity: OsmEntity, graph: Graph): ValidatorResult {
    if (!schema) return [];
    if (!entity.hasInterestingTags()) return [];

    let preset = schema.match(entity, graph);
    if (!preset) return [];

// make a copy
graph = new Graph(graph);

    // Crossings are special, see Rapid#1260
    // This validator can perform preset upgrades on standalone crossing nodes
    //   that are NOT attached to a parent crossing way.
    // If the crossing is: 1. a way or 2. a node attached to a parent crossing way, bail out.
    // The `ambiguous_crossing_tags` validator will take care of them.
    // (i.e. that parent way is the thing that will get validated thoroughly)
    if (/crossing/.test(preset.id)) {
      if (entity.type === 'way') {
        return [];
      } else if (entity.type === 'node') {
        // Bail out if map not fully loaded here - we won't know all the node's parentWays.
        // Don't worry, as more map tiles are loaded, we'll have additional chances to validate it.
        const osm = context.services.osm;
        if (osm && !osm.isDataLoaded((entity as OsmNode).loc!)) return [];

        const parents = graph.parentWays(entity);
        const hasParentCrossing = parents.some(parent => _isCrossingWay(parent.tags));
        if (hasParentCrossing) return [];
      }
    }

    const oldTags: OsmTags = Object.assign({}, entity.tags);  // shallow copy
    let subtype = 'deprecated_tags';

    // Note: We are going to modify `graph` and `entity` locally in here, but these things will not change.
    // It's just a working graph where we can apply changes in order to determine the final tag diff.

    // Upgrade preset, if a replacement is available..
    if (preset.props.replacement) {
      const newPreset = schema.getScope('osm').presets.get(preset.props.replacement);
      if (!newPreset) {
        console.warn(`validationOutdatedTags: warning "${preset.id}" wants replacement "${preset.props.replacement}" not found`);  // eslint-disable-line no-console
        return [];
      }
      graph = actionChangePreset(entity.id, preset, newPreset, true /* skip field defaults */)(graph);
      entity = graph.entity(entity.id);
      preset = newPreset;
    }

    // Upgrade deprecated tags..
    const deprecatedTags = schema.getDeprecatedTags(entity.tags);
    for (const tag of deprecatedTags) {
      graph = actionUpgradeTags(entity.id, tag.old, tag.replace)(graph);
      entity = graph.entity(entity.id);
    }

    // Add missing addTags from the detected preset
    let newTags: OsmTags = Object.assign({}, entity.tags);  // shallow copy
    if (preset.tags !== preset.addTags) {
      for (const [k, v] of Object.entries(preset.addTags)) {
        if (!newTags[k]) {
          if (v === '*') {
            newTags[k] = 'yes';
          } else {
            newTags[k] = v;
          }
        }
      }
    }

    // Attempt to match a canonical record in the name-suggestion-index.
    const nsi = context.services.nsi;
    let isWaitingForNsi = false;
    let nsiResult: any;
    if (nsi) {
      isWaitingForNsi = (nsi.status === 'loading');
      if (!isWaitingForNsi) {
        const loc = entity.extent()!.center();
        nsiResult = nsi.upgradeTags(newTags, loc);
        if (nsiResult) {
          newTags = nsiResult.newTags;
          subtype = 'noncanonical_brand';
        }
      }
    }

    const issues: ValidatorResult = [];
    issues.provisional = isWaitingForNsi;

    // determine diff
    const tagDiff = utilTagDiff(oldTags, newTags);
    if (!tagDiff.length) return issues;

    const isOnlyAddingTags = tagDiff.every(d => d.type === '+');

    let prefix = '';
    if (nsiResult) {
      prefix = 'noncanonical_brand.';
    } else if (subtype === 'deprecated_tags' && isOnlyAddingTags) {
      subtype = 'incomplete_tags';
      prefix = 'incomplete.';
    }

    // Allow autofix for simple upgrades..
    // `noncanonical_brand` upgrades may have false positives, so they should be reviewed manually.
    let autoArgs: unknown[] | undefined;
    if (subtype !== 'noncanonical_brand') {
      autoArgs = [actionDoTagUpgrade, l10n.t('issues.fix.upgrade_tags.annotation')];
    }

    issues.push(new ValidationIssue(context, {
      type: type,
      subtype: subtype,
      severity: 'warning',
      message: showUpgradeMessage,
      reference: showUpgradeReference,
      entityIds: [entity.id],
      hash: String(utilHashcode(JSON.stringify(tagDiff))),
      autoArgs: autoArgs,
      dynamicFixes: () => {
        const fixes = [
          new ValidationFix({
            title: l10n.t('issues.fix.upgrade_tags.title'),
            onClick: () => {
              editor.perform(actionDoTagUpgrade);
              editor.commit({
                annotation: l10n.t('issues.fix.upgrade_tags.annotation'),
                selectedIDs: [entity.id]
              });
            }
          })
        ];

        const item = nsiResult?.matched;
        if (item) {
          fixes.push(
            new ValidationFix({
              title: l10n.t('issues.fix.tag_as_not.title', { name: item.displayName }),
              onClick: () => {
                editor.perform(actionAddNotTag);
                editor.commit({
                  annotation: l10n.t('issues.fix.tag_as_not.annotation'),
                  selectedIDs: [entity.id]
                });
              }
            })
          );
        }
        return fixes;

      }
    }));

    return issues;


    /**
     * Applies the computed tag upgrade to the graph.
     * @param graph - The current graph state
     * @returns Updated graph with upgraded tags
     */
    function actionDoTagUpgrade(graph: Graph): Graph {
      const currEntity = graph.hasEntity(entity.id);
      if (!currEntity) return graph;

      const newTags: OsmTags = Object.assign({}, currEntity.tags);  // shallow copy
      for (const diff of tagDiff) {
        if (diff.type === '-') {
          delete newTags[diff.key];
        } else if (diff.type === '+') {
          newTags[diff.key] = diff.newVal!;
        }
      }

      return actionChangeTags(currEntity.id, newTags)(graph);
    }


    /**
     * Adds a `not:brand:wikidata` tag to indicate this entity was reviewed
     * and is not the suggested brand.
     * @param graph - The current graph state
     * @returns Updated graph with the not-tag added
     */
    function actionAddNotTag(graph: Graph): Graph {
      const currEntity = graph.hasEntity(entity.id);
      if (!currEntity) return graph;

      const item = nsiResult?.matched;
      if (!item) return graph;

      const newTags: OsmTags = Object.assign({}, currEntity.tags);  // shallow copy
      const wd = item.mainTag;     // e.g. `brand:wikidata`
      const notwd = `not:${wd}`;   // e.g. `not:brand:wikidata`
      const qid = item.tags[wd];
      newTags[notwd] = qid;

      if (newTags[wd] === qid) {   // if `brand:wikidata` was set to that qid
        const wp = item.mainTag.replace('wikidata', 'wikipedia');
        delete newTags[wd];        // remove `brand:wikidata`
        delete newTags[wp];        // remove `brand:wikipedia`
      }

      return actionChangeTags(currEntity.id, newTags)(graph);
    }


    /** Returns the localized upgrade message for display. */
    function showUpgradeMessage(this: any): string {
      const graph = editor.staging.graph;
      const currEntity = graph.hasEntity(entity.id);
      if (!currEntity) return '';

      let stringID = `issues.outdated_tags.${prefix}message`;
      if (subtype === 'noncanonical_brand' && isOnlyAddingTags) {
        stringID += '_incomplete';
      }
      return l10n.t(stringID, {
        feature: l10n.displayLabel(currEntity, graph, true /* verbose */)
      });
    }


    /** Renders the issue reference text and suggested tag changes. */
    function showUpgradeReference($selection: D3Selection): void {
      const enter = $selection.selectAll('.issue-reference')
        .data([0])
        .enter();

      enter
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t(`issues.outdated_tags.${prefix}reference`));

      enter
        .append('strong')
        .text(l10n.t('issues.suggested'));

      enter
        .append('table')
        .attr('class', 'tagDiff-table')
        .selectAll('.tagDiff-row')
        .data(tagDiff)
        .enter()
        .append('tr')
        .attr('class', 'tagDiff-row')
        .append('td')
        .attr('class', (d: TagDiff) => {
          const klass = (d.type === '+') ? 'add' : 'remove';
          return `tagDiff-cell tagDiff-cell-${klass}`;
        })
        .text((d: TagDiff) => d.display);
    }
  }


  /**
   * Delegates to `oldTagIssues` for the actual validation logic.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Array of issues for outdated tags
   */
  const validator = function checkOutdatedTags(entity: OsmEntity, graph: Graph): ValidatorResult {
    return oldTagIssues(entity, graph);
  };


  validator.type = type;

  return validator;
}
