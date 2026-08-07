import { selection } from 'd3-selection';
import { JXON } from '../../util/jxon.ts';
import { OsmChangeset } from '../../data/OsmChangeset.ts';
import { actionDiscardTags } from '../../actions/discard_tags.ts';
import { uiIcon } from '../icon.ts';
import { uiTooltip } from '../tooltip.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * A toolbar section for the "Download OSC" button
 * This is an hidden/undocumented feature that only appears
 * if the url hash contains `&download_osc=true`
 */
export class UiDownloadTool {
  public context: Context;
  public id: string;
  public stringID: string;
  public Tooltip: any;

  // D3 selections
  public $parent: D3Selection | null;

  public rerender: () => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.id = 'download_osc';
    this.stringID = 'download_osc.title';

    const editor = context.systems.editor!;

    // Create child components
    this.Tooltip = uiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument

    // Event listeners
    context.on('modechange', this.rerender);
    editor.on('stablechange', this.rerender);
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
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    this.Tooltip
      .placement('bottom')
      .scrollContainer(context.container().select('.map-toolbar'))
      .title(l10n.t(editor.hasChanges() ? 'download_osc.help' : 'download_osc.no_changes'));

    // Button
    let $button: D3Selection = $parent.selectAll('button.downloadOsc')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'downloadOsc disabled bar-button')
      .on('click', this.choose)
      .call(this.Tooltip)
      .call(uiIcon('#rapid-icon-download'));

    // update
    $button = $button.merge($$button);

    $button
      .classed('disabled', this.isDisabled());
  }


  /**
   * The button is disabled when there are no user changes to save
   * @return  `true` if disabled, `false` if enabled
   */
  public isDisabled(): boolean {
    const context = this.context;
    const editor = context.systems.editor!;
    return (context.inIntro || !editor.hasChanges());
  }


  /**
   * @param  e? - triggering event (if any)
   */
  public choose(e?: Event): void {
    e?.preventDefault();
    if (this.isDisabled()) return;

    const context = this.context;
    const editor = context.systems.editor!;

    const changes = editor.changes(actionDiscardTags(editor.difference()));
    const changeset = new OsmChangeset(context);
    const data = JXON.stringify(changeset.osmChangeJXON(changes));
    const fileName = 'change.osc';

    const a = document.createElement('a');   // Create an invisible link
    a.style.display = 'none';
    document.body.appendChild(a);

    // Set the HREF to a Blob representation of the data to be downloaded
    a.href = URL.createObjectURL(new Blob([data]));

    // Use download attribute to set set desired file name
    a.setAttribute('download', fileName);

    // Trigger the download by simulating click
    a.click();

    // Cleanup
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
  }

}
