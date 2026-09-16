import { actionChangeTags } from '../actions/change_tags.ts';
import { KeyOperationBehavior } from '../behaviors/KeyOperationBehavior.ts';
import { AbstractOperation } from './AbstractOperation.ts';
import { utilCmd } from '../util/cmd.ts';

import type { Context } from '../Context.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmTags } from '../data/types.ts';


const buildingKeysToRetain = /architect|building|height|layer|nycdoitt:bin|source|type|wheelchair|roof/i;
const addressKeysToKeep = ['source'];


/**
 * `DowngradeOperation` removes most tags from the selected feature(s), keeping only
 * address, building, or generic tags depending on what was selected.
 */
export class DowngradeOperation extends AbstractOperation {

  /** How many features would be affected by the downgrade */
  protected _affectedFeatureCount: number;
  /** `'building'`, `'address'`, `'generic'`, `'building_address'`, or `undefined` */
  protected _downgradeType?: string;


  /**
   * @param  context - Global shared application context
   * @param  selectedIDs - The entityIDs to downgrade
   */
  public constructor(context: Context, selectedIDs: EntityID[]) {
    super(context, selectedIDs);

    const l10n = context.systems.l10n!;

    this._affectedFeatureCount = 0;
    this._downgradeType = this._downgradeTypeForEntityIDs(selectedIDs);

    this.id = 'downgrade';
    this.keys = [ utilCmd('⌫') ];
    this.title = l10n.t('operations.downgrade.title');
    this.behavior = new KeyOperationBehavior(context, this);
  }


  public run(): void {
    const editor = this.context.systems.editor!;

    const combinedAction = (graph: Graph): Graph => {
      for (const entityID of this.selectedIDs) {
        const type = this._downgradeTypeForEntityID(entityID);
        if (!type) continue;

        const tags: OsmTags = { ...graph.entity(entityID).tags };  // shallow copy
        for (const key in tags) {
          if (type === 'address' && addressKeysToKeep.indexOf(key) !== -1) continue;
          if (type === 'building' && buildingKeysToRetain.test(key)) continue;
          if (type !== 'generic') {
            if (key.match(/^addr:.{1,}/) || key.match(/^source:.{1,}/)) continue;
          }
          delete tags[key];
        }
        graph = actionChangeTags(entityID, tags)(graph);
      }
      return graph;
    };

    const annotation = this.annotation();
    editor.perform(combinedAction);
    editor.commit({ annotation: annotation, selectedIDs: this.selectedIDs });

    // refresh the select mode to enable the delete operation
    this.context.enter('select-osm', { selection: { osm: this.selectedIDs }} );
  }


  public available(): boolean {
    return Boolean(this._downgradeType);
  }


  public disabled(): string | false {
    const editor = this.context.systems.editor!;
    const graph = editor.staging.graph;

    if (this.selectedIDs.some(hasWikidataTag)) {
      return 'has_wikidata_tag';
    }
    return false;

    function hasWikidataTag(id: EntityID): boolean {
      const entity = graph.entity(id);
      return Boolean(entity.tags.wikidata && entity.tags.wikidata.trim().length > 0);
    }
  }


  public tooltip(): string {
    const l10n = this.context.systems.l10n!;

    const disabledReason = this.disabled();
    return disabledReason ?
      l10n.t(`operations.downgrade.${disabledReason}`, { n: this._affectedFeatureCount }) :
      l10n.t(`operations.downgrade.description.${this._downgradeType}`);
  }


  public annotation(): string {
    const l10n = this.context.systems.l10n!;

    const suffix = this._downgradeType === 'building_address' ? 'generic' : this._downgradeType;
    return l10n.t(`operations.downgrade.annotation.${suffix}`, { n: this._affectedFeatureCount });
  }


  protected _downgradeTypeForEntityIDs(entityIDs: EntityID[]): string | undefined {
    let downgradeType: string | undefined;
    this._affectedFeatureCount = 0;

    for (const entityID of entityIDs) {
      const type = this._downgradeTypeForEntityID(entityID);
      if (type) {
        this._affectedFeatureCount += 1;
        if (downgradeType && type !== downgradeType) {
          if (downgradeType !== 'generic' && type !== 'generic') {
            downgradeType = 'building_address';
          } else {
            downgradeType = 'generic';
          }
        } else {
          downgradeType = type;
        }
      }
    }
    return downgradeType;
  }


  protected _downgradeTypeForEntityID(entityID: EntityID): string | null {
    const editor = this.context.systems.editor!;
    const schema = this.context.systems.schema!;

    const graph = editor.staging.graph;
    const entity = graph.entity(entityID);
    const preset = schema.match(entity, graph);

    if (!preset || preset.isFallback()) return null;

    if (
      entity.type === 'node' && preset.id !== 'address' &&
      Object.keys(entity.tags).some(key => key.match(/^addr:.{1,}/))
    ) {
      return 'address';
    }

    const geometry = entity.geometry(graph);
    if (geometry === 'area' && entity.tags.building && !preset.tags.building) {
      return 'building';
    } else if (geometry === 'vertex' && Object.keys(entity.tags).length) {
      return 'generic';
    }

    return null;
  }
}
