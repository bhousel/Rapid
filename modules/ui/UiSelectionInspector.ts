import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiSectionSelectionList } from './sections/UiSectionSelectionList.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * `UiSelectionInspector` shows a selection of several features that aren't all OSM entities,
 * as a list of what's selected.  (A selection of OSM entities gets the OSM inspector.)
 * Set the data IDs to show via the public `dataIDs` property, then call `.render($parent)`.
 * This is a stopgap until the multiselection UI (`design/data-ids.md`, Step 6).
 */
export class UiSelectionInspector {
  public context: Context;
  public dataIDs: DataID[];

  // Child components
  public SelectionList: UiSectionSelectionList;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.dataIDs = [];

    this.SelectionList = new UiSectionSelectionList(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;

    let $heading: D3Selection = $parent.selectAll('.heading')
      .data([0]);

    const $$heading: D3EnterSelection = $heading.enter()
      .append('div')
      .attr('class', 'heading fillL');

    $$heading
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$heading
      .append('h3');

    // update
    $heading = $heading.merge($$heading);

    $heading.select('h3')
      .text(l10n.t('inspector.multiselect'));


    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body inspector-body')
      .merge($body);

    this.SelectionList.dataIDs(this.dataIDs);
    $body.call(this.SelectionList.render);
  }
}
