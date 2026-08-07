import { select } from 'd3-selection';
import { utilTagDiff } from '@rapid-sdk/util';

import { actionChangePreset, actionChangeTags, actionSyncCrossingTags } from '../actions/index.ts';
import { Difference } from '../lib/Difference.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmTags, OsmWay } from '../data/types.ts';
import type { TagDiff } from '@rapid-sdk/util';
import type { ValidatorFunction, ValidatorResult } from './types.ts';

/**
 * OSM tags object, but where the values or the object itself may be `null`.
 * The code will treat a `null` value as a tag to be removed.
 */
type OsmNullableTags = Record<string, string | null> | null;

/** A crossing choice, identified by the tags that are being set */
interface CrossingChoice {
  setTags: OsmNullableTags;
}

/** Crossing information, includes inferred type string and identifying tags */
interface CrossingInfo {
  /**
   * Simplified type chosen by `inferCrossingType` after inspecting tags and dealing with `yes`/`no` values.
   * Will be something meaningful like 'zebra'/'marked'/'unspecified' (but not something like `yes`/`no`)
   */
  type: string;
  /**
   * The tags that should be changed if the user picks this choice.
   * Note that `null` values are allowed here, and will be treated as a tag to be removed.
   */
  tags: OsmNullableTags;
}

/** Crossing update details */
interface CrossingUpdate {
  /** Display name of the way being updated, usually a preset name like "Unmarked Crossing" */
  name: string;
  /** Details about the suggested tag diff to apply - may include additions, modifications, deletions */
  tagDiff: TagDiff[];
}


/**
 * Factory that creates a validator for resolving ambiguities between
 * crossing ways and their constituent crossing nodes.
 *
 * There are three classes of ambiguity:
 * - candidate crossings: nodes without crossing info that could be crossings
 * - marked/unmarked: one is marked and the other is not
 * - conflicting: both are marked but the markings differ
 * @param context
 * @returns Validator function
 */
export function validateAmbiguousCrossingTags(context: Context): ValidatorFunction {
  const type = 'ambiguous_crossing' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;

  /**
   * Checks the parent way for ambiguous crossing tags.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkAmbiguousCrossingTags(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!schema) return result;
    if (entity.type !== 'way' || entity.isDegenerate()) return result;

    result.issues = detectCrossingWayIssues(entity as OsmWay, graph);
    return result;
  };


  /**
   * Upgrades the preset and syncs crossing tags.
   * Like the upgrade steps in `outdated_tags.ts`, but applies further crossing-specific sync.
   * @param entityID - The entity whose crossing tags should be updated
   * @returns An action function that accepts and returns a Graph
   */
  function actionUpdateCrossing(entityID: EntityID): Action {
    return (graph: Graph): Graph => {
      const entity = graph.entity(entityID);
      const currPreset = schema!.match(entity, graph);
      const replacementID = currPreset?.props?.replacement;
      const replacement = replacementID ? schema!.getScope('osm').presets.get(replacementID) : undefined;

      if (replacementID && !replacement) {
        console.warn(`validateAmbiguousCrossingTags: warning "${currPreset.id}" wants replacement "${replacementID}" not found`);  // eslint-disable-line no-console
      }

      if (replacement) {
        graph = actionChangePreset(entityID, currPreset, replacement, true /* skip field defaults */)(graph);
        // `actionChangePreset` also does `actionSyncCrossingTags`, so we don't have to call it here.
      } else {
        graph = actionSyncCrossingTags(entityID)(graph);
      }

      return graph;
    };
  }


  /**
   * Runs `actionUpdateCrossing` and compares graphs to detect what changed.
   * @param startWay - The way being validated
   * @param startGraph - The graph being validated
   * @returns Array of validation issues detected
   */
  function detectCrossingWayIssues(startWay: OsmWay, startGraph: Graph): ValidationIssue[] {
    const wayID = startWay.id;
    const startPreset = schema!.match(startWay, startGraph);
    const snapshot = startGraph.snapshot();
    const copyGraph = startGraph.snapshot();
    const action = actionUpdateCrossing(wayID);
    const endGraph = action(copyGraph);
    const diff = new Difference(snapshot, endGraph);  // What changed?
    if (!diff.changes.size) return [];  // no updates needed

    // What does the original way look like after the changes?
    const endWay = endGraph.hasEntity(wayID);
    if (!endWay) return [];   // shouldn't happen

    // Choices being offered.
    const choices = new Map<string, CrossingChoice>();
    // Details about the entities involved in this issue.
    const updates = new Map<EntityID, CrossingUpdate>();

    // The default choice is, basically:
    // - If the parent is a crossing, upgrade parent way tagging and make the child nodes match.
    // - If the parent is not a crossing, to remove any stray crossing tags.
    const parentDetail = inferCrossingType(endWay.tags);
    const isParentCrossing = (parentDetail.type !== 'not a crossing');
    addChoice(parentDetail);

    // First, collect the parent way (include it whether it changed or not, tagDiff may be `[]`).
    const tagDiff = utilTagDiff(startWay.tags, endWay.tags);
    updates.set(wayID, { name: startPreset!.name, tagDiff: tagDiff });
    const isParentChanged = (tagDiff.length > 0);

    // Next, collect any child nodes that got changed.
    for (const change of diff.changes.values()) {
      const base = change?.base;    // Entity before change
      const head = change?.head;    // Entity after change
      if (!base || !head) continue;         // Shouldn't happen, a tag modification should include both.
      if (base.type !== 'node') continue;   // We collected the parent way already and only want child nodes.

      // Generate choices for the before and after states of this child node,
      // But only do this if the parent really is a crossing.  The parent might just be a sidewalk,
      //  and we dont want to suggest to turn the whole sidewalk into a crossing.
      if (isParentCrossing) {
        addChoice(inferCrossingType(base.tags));
        addChoice(inferCrossingType(head.tags));
      }

      // Include this child node's details in the updates Map.
      const startPreset = schema!.match(base, startGraph);
      const tagDiff = utilTagDiff(base.tags, head.tags);
      updates.set(base.id, { name: startPreset!.name, tagDiff: tagDiff });
    }

    // If we haven't already, create the 'not a crossing' choice to remove the crossing tags completely.
    addChoice(inferCrossingType({/* no tags */}));

    // If a single update, or multiple updates only adding tags, this is considered an "upgrade"..
    // If multiple updates with tag changes, this is consideredd a "conflict"..
    let isTagUpgrade = true;
    if (updates.size > 1) {
      for (const update of updates.values()) {
        if (!update.tagDiff?.length) continue;
        if (update.tagDiff.some(d => d.type === '-')) {
          isTagUpgrade = false;
          break;
        }
      }
    }

    return [
      new ValidationIssue(context, {
        type,
        subtype: 'crossing_conflict',
        severity: 'warning',
        entityIds: [ ...updates.keys() ],
        data: {
          isParentCrossing: isParentCrossing,
          isParentChanged: isParentChanged,
          isTagUpgrade: isTagUpgrade,
          updates: updates,
          choices: choices
        },
        autoArgs: [ action, l10n.t('issues.ambiguous_crossing.annotation.changed') ],
        message: getIssueTitle,
        reference: renderIssueReference,
        dynamicFixes: makeFixes
      })
    ];


    /**
     * Infers the crossing type from tags, returning the type string and
     * the tags that should be set if the user picks this type.
     * @param t - The tags to analyze
     * @returns The crossing type and associated tags
     */
    function inferCrossingType(t: OsmTags): CrossingInfo {
      const markings = t['crossing:markings'] ?? '';
      const crossing = t.crossing ?? '';

      const isUnspecified = t.highway === 'crossing' || t.path === 'crossing' || t.footway === 'crossing' ||
        t.cycleway === 'crossing' || t.bridleway === 'crossing'  || t.pedestrian === 'crossing';

      let type: string;
      let tags: OsmNullableTags;

      if (markings !== '' && markings !== 'yes' && markings !== 'no') {  // interesting values like 'lines', 'surface', etc
        type = markings;
        tags = { 'crossing:markings': markings };
      } else if (markings === 'yes') {
        type = 'marked';
        tags = { 'crossing:markings': 'yes' };
      } else if (markings === 'no') {
        type = 'unmarked';
        tags = { 'crossing:markings': 'no' };
      } else if (crossing !== '') {
        type = crossing;
        tags = { crossing: crossing };
      } else if (isUnspecified) {    // a crossing with no detail tags
        type = 'unspecified';
        tags = null;
      } else {
        type = 'not a crossing';
        tags = {
          footway: null, path: null, cycleway: null, bridleway: null, pedestrian: null,
          crossing: null, 'crossing:markings': null, 'crossing:signals': null
        };
      }

      return { type, tags };
    }


    /**
     * Adds a choice to the `choices` Map if it isn't there already.
     * @param data - The crossing type and tags
     */
    function addChoice(data: CrossingInfo): void {
      const type = data.type;
      const tags = data.tags;

      // Never offer this as a choice - it's a situation where someting is tagged incompletely,
      // e.g. parent way is a sidewalk, child node is a crossing with no detail tags.
      if (type === 'unspecified') return;

      let choice = choices.get(type);
      if (!choice) {
        choice = { setTags: tags };
        choices.set(type, choice);
      } else if (type !== 'not a crossing') {
        // Merge tags into an existing choice, if it's a real type.
        // This is useful if we first added `crossing=zebra` and then
        // later want to include a better tag like 'crossing:markings=zebra'
        choice.setTags = Object.assign(choice.setTags ?? {}, tags);
      }
    }


    /**
     * Builds the array of fixes for this crossing conflict issue.
     * @returns Array of validation fixes, one per crossing type choice
     */
    function makeFixes(this: any): ValidationFix[] {
      const wayID = this.entityIds[0];
      const choices = this.data.choices;
      const stringID = this.data.isTagUpgrade ? 'update_type' : 'choose_type';
      const fixes: ValidationFix[] = [];

      for (const [type, choice] of choices) {
        if (type === 'not a crossing') continue;  // will go at the end

        const title = l10n.t(`issues.ambiguous_crossing.fix.${stringID}`, { type: type });
        const fix = makeConflictFix(title, wayID, choice.setTags);
        fixes.push(fix);
      }

      // put this one at the end
      const choice = choices.get('not a crossing');
      const title = l10n.t('issues.ambiguous_crossing.fix.remove_all');
      const fix = makeConflictFix(title, wayID, choice.setTags);
      fixes.push(fix);

      return fixes;
    }


    /**
     * Creates a fix that applies the given crossing tags and syncs child nodes.
     * @param title - Display title for the fix
     * @param wayID - The parent way ID
     * @param setTags - Tags to set (or remove if value is `null`)
     * @returns A validation fix
     */
    function makeConflictFix(title: string, wayID: EntityID, setTags: OsmNullableTags): ValidationFix {
      return new ValidationFix({
        title: title,
        onClick: () => {
          const graph = editor.staging.graph;
          const way = graph.hasEntity(wayID);
          if (!way) return;

          if (setTags) {
            const tags: OsmTags = { ...way.tags };  // shallow copy
            for (const [k, v] of Object.entries(setTags)) {
              if (v) {
                tags[k] = v;
              } else {
                delete tags[k];
              }
            }
            editor.perform(actionChangeTags(way.id, tags));
          }

          editor.perform(action);
          editor.commit({
            annotation: l10n.t('issues.ambiguous_crossing.annotation.changed'),
            selectedIDs: [way.id]
          });
        }
      });
    }


    /** Returns the localized issue title based on the crossing ambiguity type. */
    function getIssueTitle(this: any): string {
      const data = this.data;

      if (data.isParentCrossing && !data.isParentChanged && data.isTagUpgrade) {
        return l10n.t('issues.ambiguous_crossing.message.candidate');
      } else if (data.isTagUpgrade) {
        return l10n.t('issues.ambiguous_crossing.message.update');
      } else {
        return l10n.t('issues.ambiguous_crossing.message.conflict');
      }
    }


    /**
     * Renders the issue reference with tag diff tables for each affected entity.
     * @param $selection
     */
    function renderIssueReference(this: any, $selection: D3Selection): void {
      const data = this.data;

      // convert `updates` Map to `suggestions` Array for d3.data join and display to user
      const suggestions = [];
      for (const [entityID, update] of data.updates) {
        suggestions.push({
          entityID: entityID,
          name: update.name,
          tagDiff: update.tagDiff || []
        });
      }

      const $$reference = $selection.selectAll('.issue-reference')
        .data([0])
        .enter();

      $$reference
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.ambiguous_crossing.reference.line1'));

      $$reference
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.ambiguous_crossing.reference.line2'));

      $$reference
        .append('strong')
        .text(l10n.t('issues.suggested'));  // "Suggested updates"

      const $$suggestions = $$reference.selectAll('.suggested-update')
        .data(suggestions, (d: any) => d.entityID)
        .enter()
        .append('div')
        .attr('class', 'suggested-update');

      $$suggestions
        .append('strong')
        .text((d: any) => {
          const lineOrPoint = d.entityID[0] === 'w' ? l10n.t('modes.add_line.title') : l10n.t('modes.add_point.title');
          return `${lineOrPoint} ${d.entityID} - ${d.name}:`;
        });

      // Render either the tagDiff or a message in its place.
      $$suggestions
        .each((d: any, i: number, nodes: any) => {
          const $$suggestion = select(nodes[i]);

          if (!d.tagDiff.length) {
            $$suggestion
              .append('div')
              .attr('class', 'tagDiff-message')
              .text((d: any) => {
                if (d.entityID === wayID && !data.isParentCrossing) {
                  return l10n.t('issues.ambiguous_crossing.not_a_crossing');
                } else {
                  return l10n.t('issues.ambiguous_crossing.no_changes');
                }
              });
          } else {
            $$suggestion
              .append('table')
              .attr('class', 'tagDiff-table')
              .selectAll('.tagDiff-row')
              .data((d: any) => d.tagDiff)
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
        });
    }
  }


  validator.type = type;
  return validator;
}
