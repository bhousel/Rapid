import { selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { UiTooltip } from './UiTooltip.ts';
import { utilDetect } from '../util/detect.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiProjectLinks` renders links for "help translate" and "report a bug"
 * into the footer section.
 */
export class UiProjectLinks {
  public context: Context;

  // Child components
  public BugTooltip: UiTooltip;
  public TranslateTooltip: UiTooltip;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Create child components
    this.BugTooltip = new UiTooltip(context).placement('top');
    this.TranslateTooltip = new UiTooltip(context).placement('top');

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.reportIssue = this.reportIssue.bind(this);
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

    // Create/remove wrapper div if necessary
    let $wrap: D3Selection = $parent.selectAll('.project-links')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'project-links');

    $$wrap
      .append('a')
      .attr('target', '_blank')
      .on('click', this.reportIssue)
      .call(uiIcon('#rapid-icon-bug', 'light'))
      .call(this.BugTooltip.attach);

    $$wrap
      .append('a')
      .attr('target', '_blank')
      .attr('href', 'https://github.com/facebook/Rapid/blob/main/CONTRIBUTING.md#translations')
      .call(uiIcon('#rapid-icon-translate', 'light'))
      .call(this.TranslateTooltip.attach);

    // update
    $wrap = $wrap.merge($$wrap);

    // localize tooltips
    this.BugTooltip.title(l10n.t('report_a_bug'));
    this.TranslateTooltip.title(l10n.t('help_translate'));
  }


  /**
   * Opens GitHub to report a bug.
   * @param [e] - the triggering event, if any
   */
  public reportIssue(e?: Event): void {
    e?.preventDefault();

    this.BugTooltip.hide();

    const link = new URL('https://github.com/facebook/Rapid/issues/new');

    // From the template we set up at https://github.com/facebook/Rapid/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml
    link.searchParams.append('template', 'bug_report.yml');
    const detected = utilDetect();
    const browser = `${detected.browser} v${detected.version}`;
    const os = `${detected.os}`;
    const userAgent = navigator.userAgent;

    link.searchParams.append('browser', browser);
    link.searchParams.append('os', os);
    link.searchParams.append('useragent', userAgent);
    link.searchParams.append('URL', window.location.href);
    link.searchParams.append('version', this.context.version);

    window.open(link.toString(), '_blank');
  }

}
