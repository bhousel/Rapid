import { EventEmitter } from 'tseep/lib/ee-safe';
import { select } from 'd3-selection';
import { Extent, numWrap } from '@rapid-sdk/math';
import { JXON } from '../util/jxon.ts';
import { OsmChangeset } from '../data/OsmChangeset.ts';
import { uiIcon } from './icon.ts';
import { utilHighlightEntities, utilKeybinding, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Keybinding } from '../util/keybinding.ts';
import type { OsmChanges } from '../data/OsmChangeset.ts';


/**
 * A choice option within a conflict resolution (keep mine / keep theirs).
 */
interface ChoiceOption {
  id: EntityID;
  text: string;
  action: () => void;
}

/**
 * A single conflict to resolve.
 */
interface ConflictItem {
  id: EntityID;
  name: string;
  details?: string[];
  chosen?: EntityID;
  choices?: ChoiceOption[];
}


/**
 * The `UiConflicts` renders the conflict-resolution screen shown when a save fails
 * because of upstream edits. Set the conflict list and original changes via the public
 * `conflictList()` / `origChanges()` setters, then call `.render($selection)`.
 * Emits `cancel` and `save`.
 */
export class UiConflicts extends EventEmitter {
  public context: Context;

  protected _keybinding: Keybinding;
  protected _origChanges: OsmChanges | null;
  protected _conflictList: ConflictItem[] | null;
  protected _shownConflictIndex: number | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this._origChanges = null;
    this._conflictList = null;
    this._shownConflictIndex = null;

    this._keybinding = utilKeybinding('conflicts');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._cancel = this._cancel.bind(this);
    this._tryAgain = this._tryAgain.bind(this);
    this._showConflict = this._showConflict.bind(this);
    this._addChoices = this._addChoices.bind(this);
  }


  /** Binds the keyboard shortcuts used by the conflict screen. */
  protected _keybindingOn(): void {
    select(document)
      .call(this._keybinding.on('⎋', this._cancel, true));
  }

  /** Unbinds the keyboard shortcuts used by the conflict screen. */
  protected _keybindingOff(): void {
    select(document)
      .call(this._keybinding.unbind);
  }

  /** Dismisses the conflict screen and retries the save. */
  protected _tryAgain(): void {
    this._keybindingOff();
    this.emit('save');
  }

  /** Dismisses the conflict screen and cancels the save. */
  protected _cancel(): void {
    this._keybindingOff();
    this.emit('cancel');
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

    this._keybindingOn();

    const $$header = $selection.selectAll('.header')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'fr')
      .on('click', this._cancel)
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3')
      .html(l10n.tHtml('save.conflict.header'));

    const $$body = $selection.selectAll('.body')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'body fillL');

    const $$conflictsHelp = $$body
      .append('div')
      .attr('class', 'conflicts-help')
      .html(l10n.tHtml('save.conflict.help'));


    // Download changes link
    const changeset = new OsmChangeset(context);
    delete (changeset as { id?: string }).id;  // Export without changeset_id

    const data = JXON.stringify(changeset.osmChangeJXON(this._origChanges!));
    const blob = new Blob([data], { type: 'text/xml;charset=utf-8;' });
    const fileName = 'changes.osc';

    const $$link = $$conflictsHelp.selectAll('.download-changes')
      .append('a')
      .attr('class', 'download-changes');

    // All except IE11 and Edge
    $$link
      .attr('href', URL.createObjectURL(blob)) // download the data as a file
      .attr('download', fileName);

    $$link
      .call(uiIcon('#rapid-icon-load', 'inline'))
      .append('span')
      .html(l10n.tHtml('save.conflict.download_changes'));

    $$body
      .append('div')
      .attr('class', 'conflict-container fillL3')
      .call(this._showConflict, 0);

    $$body
      .append('div')
      .attr('class', 'conflicts-done')
      .attr('opacity', 0)
      .style('display', 'none')
      .html(l10n.tHtml('save.conflict.done'));

    const $$buttons = $$body
      .append('div')
      .attr('class','buttons col12 joined conflicts-buttons');

    $$buttons
      .append('button')
      .attr('disabled', this._conflictList!.length > 1)
      .attr('class', 'action conflicts-button col6')
      .html(l10n.tHtml('save.title'))
      .on('click.try_again', this._tryAgain);

    $$buttons
      .append('button')
      .attr('class', 'secondary-action conflicts-button col6')
      .html(l10n.tHtml('confirm.cancel'))
      .on('click.cancel', this._cancel);
  }


  /**
   * Renders a single conflict (by index) with its details and navigation.
   * @param $selection - A d3-selection to the HTMLElement this conflict renders into
   * @param index - the index of the conflict to show
   */
  protected _showConflict($selection: D3Selection, index: number): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;

    index = numWrap(index, 0, this._conflictList!.length);
    this._shownConflictIndex = index;

    const $parent = select(($selection.node() as HTMLElement).parentNode as HTMLElement);

    // enable save button if this is the last conflict being reviewed..
    if (index === this._conflictList!.length - 1) {
      scheduler?.setTimeout('conflicts-enable-save', () => {
        $parent.select('.conflicts-button')
          .attr('disabled', null);

        $parent.select('.conflicts-done')
          .transition()
          .attr('opacity', 1)
          .style('display', 'block');
      }, { ms: 250 });
    }

    const $conflict = $selection
      .selectAll('.conflict')
      .data([this._conflictList![index]]);

    $conflict.exit()
      .remove();

    const $$conflict = $conflict.enter()
      .append('div')
      .attr('class', 'conflict');

    $$conflict
      .append('h4')
      .attr('class', 'conflict-count')
      .html(l10n.tHtml('save.conflict.count', { num: index + 1, total: this._conflictList!.length }));

    $$conflict
      .append('a')
      .attr('class', 'conflict-description')
      .attr('href', '#')
      .text((d: ConflictItem) => d.name)
      .on('click', (d3_event: Event, d: ConflictItem) => {
        d3_event.preventDefault();
        this._showEntityID(d.id);
      });

    const $$details = $$conflict
      .append('div')
      .attr('class', 'conflict-detail-container');

    $$details
      .append('ul')
      .attr('class', 'conflict-detail-list')
      .selectAll('li')
      .data((d: ConflictItem) => d.details || [])
      .enter()
      .append('li')
      .attr('class', 'conflict-detail-item')
      .html((d: string) => utilSanitizeHTML(d));

    $$details
      .append('div')
      .attr('class', 'conflict-choices')
      .call(this._addChoices);

    $$details
      .append('div')
      .attr('class', 'conflict-nav-buttons joined')
      .selectAll('button')
      .data(['previous', 'next'])
      .enter()
      .append('button')
      .html((d: string) => l10n.tHtml(`save.conflict.${d}`))
      .attr('class', 'conflict-nav-button action col6')
      .attr('disabled', (d: string, i: number) => {
        return (i === 0 && index === 0) || (i === 1 && index === this._conflictList!.length - 1) || null;
      })
      .on('click', (d3_event: Event, d: string) => {
        d3_event.preventDefault();

        const $container = $parent.selectAll('.conflict-container');
        const sign = (d === 'previous') ? -1 : 1;

        $container
          .selectAll('.conflict')
          .remove();

        $container
          .call(this._showConflict, index + sign);
      });
  }


  /**
   * Renders the resolution choices (radio buttons) for a conflict.
   * @param $selection - A d3-selection to the HTMLElement the choices render into
   */
  protected _addChoices($selection: D3Selection): void {
    const $choices: D3Selection = $selection
      .append('ul')
      .attr('class', 'layer-list')
      .selectAll('li')
      .data((d: ConflictItem) => d.choices || []);

    // enter
    const $$choices = $choices.enter()
      .append('li')
      .attr('class', 'layer');

    const $$label = $$choices
      .append('label');

    $$label
      .append('input')
      .attr('type', 'radio')
      .attr('name', (d: ChoiceOption) => d.id)
      .on('change', (d3_event: Event, d: ChoiceOption) => {
        const ul = (d3_event.currentTarget as HTMLElement).parentNode!.parentNode!.parentNode as HTMLUListElement;
        (ul as any).__data__.chosen = d.id;
        this._choose(d3_event, ul, d);
      });

    $$label
      .append('span')
      .text((d: ChoiceOption) => d.text);

    // update
    $$choices
      .merge($choices)
      .each((d: ChoiceOption, i: number, nodes: ArrayLike<HTMLElement>) => {
        const ul = (nodes[i] as HTMLElement).parentNode as HTMLUListElement;
        if ((ul as any).__data__.chosen === d.id) {
          this._choose(null, ul, d);
        }
      });
  }


  /**
   * Applies the selected resolution choice and highlights the affected entity.
   * @param d3_event - the triggering event, or `null` when applied programmatically
   * @param ul - the `<ul>` element holding the choices
   * @param datum - the chosen resolution datum
   */
  protected _choose(d3_event: Event | null, ul: HTMLUListElement, datum: ChoiceOption): void {
    const context = this.context;
    const editor = context.systems.editor!;

    if (d3_event) d3_event.preventDefault();

    select(ul)
      .selectAll('li')
      .classed('active', (d: ChoiceOption) => d === datum)
      .selectAll('input')
      .property('checked', (d: ChoiceOption) => d === datum);

    // Gather the extent of the change (check entity pre- and post- action)
    const extent = new Extent();

    let graph = editor.staging.graph;
    let entity = graph.hasEntity(datum.id);
    let other = entity?.extent();
    if (other) {
      extent.extendSelf(other);
    }

    datum.action();

    graph = editor.staging.graph;
    entity = graph.hasEntity(datum.id);
    other = entity?.extent();
    if (other) {
      extent.extendSelf(other);
    }

    this._showEntityID(datum.id, extent);
  }


  /**
   * Highlights the given entity and moves the map to it.
   * @param id - the entity ID to show
   * @param extent - an optional extent to fit the map to
   */
  protected _showEntityID(id: EntityID, extent?: Extent): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;

    utilHighlightEntities(context, [], false);   // unhighlight

    const graph = editor.staging.graph;
    const entity = graph.hasEntity(id);
    if (entity) {
      if (extent) {
        map.trimmedExtent(extent);
      } else {
        map.fitEntitiesEase(entity);
      }
      utilHighlightEntities(context, [id], true);
    }
  }


  // The conflict list should be an Array of Objects like:
  // {
  //   id: id,
  //   name: entityName(local),
  //   details: merge.conflicts(),
  //   chosen: 1,
  //   choices: [
  //     choice(id, keepMine, forceLocal),
  //     choice(id, keepTheirs, forceRemote)
  //   ]
  // }
  /**
   * Gets or sets the list of conflicts to resolve.
   * @param val - the conflict list to set; omit to get the current value
   */
  public conflictList(val?: ConflictItem[]): any {
    if (val === undefined) return this._conflictList;
    this._conflictList = val;
    return this;
  }


  /**
   * Gets or sets the original changes captured before the conflict.
   * @param val - the original changes to set; omit to get the current value
   */
  public origChanges(val?: OsmChanges): any {
    if (val === undefined) return this._origChanges;
    this._origChanges = val;
    return this;
  }


  /** Returns the entity IDs for the currently shown conflict. */
  public shownEntityIds(): EntityID[] {
    if (this._conflictList && typeof this._shownConflictIndex === 'number') {
      return [this._conflictList[this._shownConflictIndex].id];
    }
    return [];
  }
}
